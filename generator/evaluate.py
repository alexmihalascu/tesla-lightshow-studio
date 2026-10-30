"""Scores how well a light show matches its song.

python evaluate.py show.fseq song.mp3

Metrics:
  sync      – distance from each light turning on to the nearest audio onset (ms); share within 40 ms
  lag       – global offset where lights and music line up best (should be ~0 ms)
  beats     – share of beats that get a light reaction within 60 ms
  dynamics  – correlation between how much light is on and how loud the song is (smoothed over 1 s)
  coverage  – share of the song with at least one light on

What it looks like (calibrated on hand-made shows, where ~65% of big moves land on a sound you hear):
  precision – share of visible moves (>= 3 lamps change) that sit on an audible hit (-40..+80 ms)
  accents   – share of the strongest hits (top 20%) that get a visible move
  big moves – moves of >= 6 lamps per second; hand-made shows sit around 1-2.5, more reads as noise
  hold      – median time a lamp stays on (hand-made: 350-450 ms; 120 ms blips look like flicker)
  symmetry  – how often left and right lamps match (hand-made: ~98%)
  calm      – how often each lamp flashes (median, per second; hand-made: ~0.45)
  contrast  – some fully dark moments, tail lights not on all the time
"""
import struct
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_show as ms  # noqa: E402


def read_fseq(path):
    b = Path(path).read_bytes()
    off, = struct.unpack("<H", b[4:6])
    ch, frames = struct.unpack("<II", b[10:18])
    step = b[18]
    if b[20] & 0x0F:
        raise SystemExit("compressed .fseq is not supported")
    return np.frombuffer(b[off:off + ch * frames], np.uint8).reshape(frames, ch), step


def resample(data, step):
    """Light data on the analysis grid (20 ms frames)."""
    if step == ms.STEP_MS:
        return data
    idx = np.minimum((np.arange(int(len(data) * step / ms.STEP_MS)) * ms.STEP_MS / step).astype(int), len(data) - 1)
    return data[idx]


def evaluate(fseq, audio):
    data, step = read_fseq(fseq)
    data = resample(data, step)
    onset, low, mid, high, energy, _vocal = ms.analyze(ms.load_audio(audio))
    n = min(len(data), len(onset))
    lights = data[:n, :30] > 127
    onset, energy = onset[:n], energy[:n]

    rises = np.flatnonzero((np.diff(lights.astype(int), axis=0) > 0).any(axis=1)) + 1
    peaks = ms.pick_peaks(onset, min_gap=5, k=0.5)
    if not len(rises) or not len(peaks):
        return {"error": "no light events or no onsets"}
    idx = np.clip(np.searchsorted(peaks, rises), 1, len(peaks) - 1)
    dist = np.minimum(np.abs(rises - peaks[idx - 1]), np.abs(peaks[idx] - rises)) * ms.STEP_MS

    # global lag: cross-correlation of the light-onset train with the audio onset envelope, ±300 ms
    train = np.zeros(n)
    train[rises] = 1
    o = (onset - onset.mean()) / (onset.std() + 1e-9)
    lags = range(-15, 16)
    corr = [float(np.dot(np.roll(train, -k), o)) for k in lags]
    best_lag = list(lags)[int(np.argmax(corr))] * ms.STEP_MS

    period = ms.tempo_period(onset)
    beats = ms.track_beats(onset, period)
    hit = sum(1 for b in beats if np.any(np.abs(rises - b) <= 3))

    smooth = lambda x: np.convolve(x, np.ones(ms.FPS) / ms.FPS, "same")
    amount = smooth(lights.sum(axis=1).astype(float))
    dyn = float(np.corrcoef(amount, smooth(energy))[0, 1]) if amount.std() > 0 else 0.0

    # what the eye sees: visible moves, how long lamps hold, symmetry, contrast
    lit = lights.astype(int)
    moved = np.abs(np.diff(lit, axis=0)).sum(axis=1)
    moves = np.flatnonzero(moved >= 3) + 1
    near = lambda t: np.any((t - peaks >= -2) & (t - peaks <= 4))  # eye forgives late more than early
    strong = peaks[onset[peaks] >= np.percentile(onset[peaks], 80)]
    runs = [b - a for c in range(30) for a, b in ms.segments(lights[:, c])]
    pairs = [(0, 1), (2, 3), (4, 5), (6, 7), (12, 13), (14, 15), (16, 17), (18, 19), (20, 21), (22, 23), (25, 26)]

    return {
        "precision": float(np.mean([near(t) for t in moves])) if len(moves) else 0.0,
        "accents": float(np.mean([np.any((moves - p >= -2) & (moves - p <= 4)) for p in strong])) if len(strong) else 0.0,
        "big_per_s": float((moved >= 6).sum() / (n / ms.FPS)),
        "hold_ms": float(np.median(runs) * ms.STEP_MS) if runs else 0.0,
        "lamp_rate": float(np.median(r[r > 0])) if (r := (np.diff(lit, axis=0) > 0).sum(axis=0) / (n / ms.FPS)).any() else 0.0,
        "symmetry": float(np.mean([np.mean(lights[:, a] == lights[:, b]) for a, b in pairs])),
        "dark": float(np.mean(lit.sum(axis=1) == 0)),
        "tail": float(lights[:, 25].mean()),
        "sync_median_ms": float(np.median(dist)),
        "sync_within_40ms": float(np.mean(dist <= 40)),
        "lag_ms": best_lag,
        "beats_with_light": hit / max(1, len(beats)),
        "dynamics_corr": dyn,
        "coverage": float(lights.any(axis=1).mean()),
        "bpm": 60 * ms.FPS / period,
    }


def score(r):
    """0–100, how good it looks: precision 25, accents 15, dynamics 15, big-move rate 10, calm 10,
    hold 5, symmetry 10, contrast 10 (lag penalized)."""
    clip = lambda x: min(1.0, max(0.0, x))
    big = r["big_per_s"]
    density = 1.0 if 0.8 <= big <= 2.5 else (big / 0.8 if big < 0.8 else 2.5 / big)
    contrast = (0.5 * clip(r["dark"] / 0.05) + 0.5 * (1.0 if r["tail"] <= 0.6 else clip((1 - r["tail"]) / 0.4)))
    s = (25 * clip(r["precision"] / 0.7) + 15 * clip(r["accents"] / 0.8) + 15 * clip(r["dynamics_corr"] / 0.5)
         + 10 * density + 10 * clip(0.6 / max(r["lamp_rate"], 1e-9)) + 5 * clip(r["hold_ms"] / 350) + 10 * clip((r["symmetry"] - 0.8) / 0.18) + 10 * contrast)
    return round(max(0.0, s - min(20, abs(r["lag_ms"]) / 10)), 1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    r = evaluate(sys.argv[1], sys.argv[2])
    if "error" in r:
        raise SystemExit(r["error"])
    print(f"score {score(r)}/100  ~{r['bpm']:.0f} BPM")
    print(f"  looks: {r['precision']:.0%} of visible moves on a hit, {r['accents']:.0%} of strong hits answered, "
          f"{r['big_per_s']:.1f} big moves/s, each lamp {r['lamp_rate']:.2f}x/s, lamps hold {r['hold_ms']:.0f} ms, {r['symmetry']:.0%} symmetric, "
          f"{r['dark']:.0%} dark, tail lights on {r['tail']:.0%}")
    print(f"  sync: median {r['sync_median_ms']:.0f} ms, {r['sync_within_40ms']:.0%} within 40 ms, best lag {r['lag_ms']:+.0f} ms")
    print(f"  beats with a light reaction: {r['beats_with_light']:.0%}")
    print(f"  dynamics (light vs loudness): {r['dynamics_corr']:+.2f}")
    print(f"  coverage: {r['coverage']:.0%} of the song has lights on")
