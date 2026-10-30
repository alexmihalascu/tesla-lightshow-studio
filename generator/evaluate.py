"""Scores how well a light show matches its song.

python evaluate.py show.fseq song.mp3

Metrics:
  sync      – distance from each light turning on to the nearest audio onset (ms); share within 40 ms
  lag       – global offset where lights and music line up best (should be ~0 ms)
  beats     – share of beats that get a light reaction within 60 ms
  dynamics  – correlation between how much light is on and how loud the song is (smoothed over 1 s)
  coverage  – share of the song with at least one light on
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

    return {
        "sync_median_ms": float(np.median(dist)),
        "sync_within_40ms": float(np.mean(dist <= 40)),
        "lag_ms": best_lag,
        "beats_with_light": hit / max(1, len(beats)),
        "dynamics_corr": dyn,
        "coverage": float(lights.any(axis=1).mean()),
        "bpm": 60 * ms.FPS / period,
    }


def score(r):
    """0–100: sync 40%, beats 25%, dynamics 20%, coverage 15% (lag penalized)."""
    s = (40 * r["sync_within_40ms"] + 25 * r["beats_with_light"] + 20 * max(0.0, r["dynamics_corr"])
         + 15 * min(1.0, r["coverage"] / 0.8))
    return round(max(0.0, s - min(20, abs(r["lag_ms"]) / 10)), 1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    r = evaluate(sys.argv[1], sys.argv[2])
    if "error" in r:
        raise SystemExit(r["error"])
    print(f"score {score(r)}/100  ~{r['bpm']:.0f} BPM")
    print(f"  sync: median {r['sync_median_ms']:.0f} ms, {r['sync_within_40ms']:.0%} within 40 ms, best lag {r['lag_ms']:+.0f} ms")
    print(f"  beats with a light reaction: {r['beats_with_light']:.0%}")
    print(f"  dynamics (light vs loudness): {r['dynamics_corr']:+.2f}")
    print(f"  coverage: {r['coverage']:.0%} of the song has lights on")
