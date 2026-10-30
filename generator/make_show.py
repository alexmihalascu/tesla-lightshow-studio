"""Generates a Tesla light show (lightshow.fseq + lightshow.wav) from an mp3.
Default target: Model 3 2022 (no power liftgate). Usage: python make_show.py "song.mp3"
"""
import hashlib, importlib.util, shutil, struct, subprocess, sys, time
from pathlib import Path
import numpy as np

FPS, STEP_MS, SR, NCH = 50, 20, 22050, 48
HOP = SR // FPS  # 441 samples = 20 ms
# Calibration: shifts every light in time (ms) if they look early/late on the car.
OFFSET_MS = 0

# Canale (0-based) din layout-ul oficial Tesla xLights
L_OUTER, R_OUTER, L_INNER, R_INNER, L_SIG, R_SIG = 0, 1, 2, 3, 4, 5
CH4 = (6, 7, 8, 9, 10, 11)  # one output (OR) on Model 3
L_FTURN, R_FTURN, L_FOG, R_FOG, L_AUX, R_AUX = 12, 13, 14, 15, 16, 17
L_MARK, R_MARK, L_REP, R_REP, L_RTURN, R_RTURN = 18, 19, 20, 21, 22, 23
BRAKE, L_TAIL, R_TAIL, REVERSE, REAR_FOG, PLATE = 24, 25, 26, 27, 28, 29
L_MIRROR, R_MIRROR, CHARGE_PORT = 34, 35, 45
WINDOWS = [36, 37, 38, 39]
LIFTGATE, HANDLES = 40, [41, 42, 43, 44]
# m3 = Model 3, my = Model Y, ms = Model S, mx = Model X, ct = Cybertruck (liftgate = frunk electric)
MODELS = ("m3", "my", "ms", "mx", "ct")
MODELS_WITH_LIFTGATE = {"my", "ms", "mx", "ct"}

# Valori (procent luminozitate xLights -> byte)
ON, OFF = 255, 0
RAMP_ON_2S, RAMP_OFF_500, RAMP_OFF_2S = 230, 26, 77
C_OPEN, C_DANCE, C_CLOSE = 64, 128, 192


def load_audio(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR),
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def analyze(y):
    n_fft = 2048
    y = np.pad(y, n_fft // 2)
    frames = np.lib.stride_tricks.sliding_window_view(y, n_fft)[::HOP]
    win = np.hanning(n_fft).astype(np.float32)
    mag = np.log1p(10 * np.abs(np.fft.rfft(frames * win, axis=1))).astype(np.float32)
    freqs = np.fft.rfftfreq(n_fft, 1 / SR)

    def flux(mask):
        d = np.diff(mag[:, mask], axis=0, prepend=mag[:1, mask])
        f = np.maximum(d, 0).sum(axis=1)
        return f / (f.std() + 1e-9)

    onset = flux(freqs < 11000)
    low = flux(freqs < 150)                       # kick / bass
    mid = flux((freqs > 1000) & (freqs < 4000))   # snare, clap
    high = flux((freqs > 2000) & (freqs < 8000))  # cinele
    energy = np.sqrt((frames ** 2).mean(axis=1))
    # vocal/melody band level (not flux): sustained while someone sings or a lead plays
    vocal = np.convolve(mag[:, (freqs > 300) & (freqs < 3000)].mean(axis=1), np.ones(15) / 15, "same")
    return onset, low, mid, high, energy, vocal


STEMS_CACHE = Path(__file__).resolve().parent.parent / "shows" / ".stems"


def separate(src):
    """Splits the song into vocals/drums/bass/other with Demucs (cached per song).
    Returns None when Demucs isn't installed, so the generator falls back to the full mix."""
    if importlib.util.find_spec("demucs") is None:
        return None
    out = STEMS_CACHE / hashlib.sha1(Path(src).read_bytes()).hexdigest()[:16]
    stems = {s: out / f"{s}.wav" for s in ("vocals", "drums", "bass", "other")}
    if not all(p.exists() for p in stems.values()):
        tmp = STEMS_CACHE / "_run"
        subprocess.run([sys.executable, "-m", "demucs", "-n", "htdemucs", "-o", str(tmp), str(src)],
                       check=True, capture_output=True)
        found = next((tmp / "htdemucs").iterdir())
        out.mkdir(parents=True, exist_ok=True)
        for s, p in stems.items():
            shutil.move(str(found / f"{s}.wav"), p)
        shutil.rmtree(tmp, ignore_errors=True)
    return {s: load_audio(p) for s, p in stems.items()}


def tempo_period(onset):
    o = onset - onset.mean()
    ac = np.correlate(o, o, "full")[len(o) - 1:]
    lags = np.arange(15, 50.01, 0.05)  # 200..60 BPM, sub-frame resolution
    # comb: the real period is also strong at 2, 3, 4 beats; syncopation (1.5 beats) is not
    comb = sum(np.interp(lags * k, np.arange(len(ac)), ac) for k in (1, 2, 3, 4))
    best = lags[np.argmax(comb)]
    # the comb favours half tempo; take double tempo if it is almost as strong (<= 180 BPM)
    near = (lags > best / 2 * 0.97) & (lags < best / 2 * 1.03) & (lags >= 60 * FPS / 180)
    if near.any() and comb[near].max() >= 0.6 * comb.max():
        best = lags[near][np.argmax(comb[near])]
    return float(best)


def track_beats(onset, period, alpha=100.0):
    """Beat tracking with dynamic programming (Ellis 2007)."""
    n = len(onset)
    score, back = onset.astype(float).copy(), -np.ones(n, int)
    lo, hi = int(period * 2), max(1, int(period / 2))
    offs = np.arange(lo, hi - 1, -1)
    penalty = -alpha * np.log(offs / period) ** 2
    for t in range(lo, n):
        cand = score[t - offs] + penalty
        k = np.argmax(cand)
        score[t] += cand[k]
        back[t] = t - offs[k]
    t = int(np.argmax(score[-lo:]) + n - lo)
    beats = []
    while t >= 0:
        beats.append(t)
        t = back[t]
    return np.array(beats[::-1])


def pick_peaks(x, min_gap, k=1.0):
    local = np.convolve(x, np.ones(FPS) / FPS, "same")
    thr = local + k * x.std()
    out = []
    for i in range(3, len(x) - 3):
        if x[i] > thr[i] and x[i] == x[i - 3:i + 4].max() and (not out or i - out[-1] >= min_gap):
            out.append(i)
    return np.array(out, int)


def levels(energy, cuts=(35, 70)):
    """0 = quiet, 1 = medium, 2 = chorus/drop. Smoothed over ~3 s."""
    s = np.convolve(energy, np.ones(3 * FPS) / (3 * FPS), "same")
    return np.digitize(s, np.percentile(s, cuts))


def segments(mask):
    edges = np.flatnonzero(np.diff(np.r_[0, mask.astype(int), 0]))
    return list(zip(edges[::2], edges[1::2]))


def build(onset, low, mid, high, energy, max_mode=False, model="m3", vocal=None, stems=None):
    n = len(onset)
    fit = lambda x: np.pad(x[:n], (0, max(0, n - len(x))))
    voice = other_on = bass_on = None
    if stems:
        # Separated tracks: drums give cleaner kick/snare/hi-hat, vocals say when someone actually sings,
        # "other" (synths, guitars, piano) leads the instrumental parts, bass drives the park lights
        _, low, mid, high, _, _ = (fit(x) for x in stems["drums"])
        v = fit(stems["vocals"][4])
        voice = np.convolve(v > 0.3 * np.percentile(v, 95), np.ones(13) / 13, "same") > 0.5
        other_on, bass_on = fit(stems["other"][0]), fit(stems["bass"][1])
    data = np.zeros((n, NCH), np.uint8)
    lvl = levels(energy, (25, 55) if max_mode else (35, 70))
    period = tempo_period(onset)
    beats = track_beats(onset, period)
    # Sync: move each beat onto the actual onset peak (±2 frames = ±40 ms)
    beats = np.array([b - 2 + int(np.argmax(onset[max(0, b - 2):b + 3])) if b >= 2 else b for b in beats])
    grid = np.unique(np.concatenate([beats + int(round(k * period / 4)) for k in range(4)]))  # 16th notes

    def snap(events):
        """Events close to the rhythmic grid (<= 2 frames) land exactly on it."""
        if not len(events):
            return events
        idx = np.clip(np.searchsorted(grid, events), 1, len(grid) - 1)
        near = np.where(events - grid[idx - 1] < grid[idx] - events, grid[idx - 1], grid[idx])
        return np.where(np.abs(near - events) <= 2, near, events)

    hits = pick_peaks(onset, min_gap=5, k=0.5)  # anything audible: grid patterns land on these

    def on_hit(t, tol=2):
        """Nearest audible hit within `tol` frames of t, or None."""
        i = int(np.searchsorted(hits, t))
        near = [h for h in hits[max(0, i - 1):i + 1] if abs(h - t) <= tol]
        return int(min(near, key=lambda h: abs(h - t))) if near else None

    # band peaks can sit a few frames off the audible attack: move them onto it
    attack = lambda ev: np.array([on_hit(t, 3) or t for t in ev], int)
    kicks = snap(attack(pick_peaks(low, min_gap=11, k=1.2)))   # >= 220 ms between flashes
    snares = snap(attack(pick_peaks(mid, min_gap=11, k=1.4)))
    hats = snap(attack(pick_peaks(high, min_gap=11, k=1.5)))
    # one hit = one instrument: a "snare" on top of a kick is the same full hit, the kick keeps it
    snares = np.array([t for t in snares if not len(kicks) or np.abs(kicks - t).min() > 2], int)
    flash = 6  # 120 ms (Tesla recommends >= 100 ms)
    # 4/4 bars: the downbeat is the beat phase with the most bass
    phase = int(np.argmax([low[beats[p::4]].sum() for p in range(4)]))
    bars = beats[phase::4]
    bar_end = np.r_[bars[1:], n]
    # Level per bar (stable, not per frame); "build" = the 2 bars before a chorus
    bar_lvl = [int(np.median(lvl[a:max(a + 1, b)])) for a, b in zip(bars, bar_end)]
    build_bar = [0] * len(bars)  # 0 = no, 1 = first build bar, 2 = last (faster)
    for i in range(1, len(bars)):
        if bar_lvl[i] == 2 and bar_lvl[i - 1] < 2:
            for j, kind in ((i - 2, 1), (i - 1, 2)):
                if j >= 0 and bar_lvl[j] < 2:
                    build_bar[j] = kind
    lvl_at = lambda t: bar_lvl[max(0, int(np.searchsorted(bars, t, "right")) - 1)]

    def put(chs, a, b, v):
        a, b = max(0, a), min(n, b)
        if a < b:
            data[a:b, chs] = np.maximum(data[a:b, chs], v)

    # Choreography rules, from comparing against hand-made shows (see evaluate.py):
    # - each instrument owns one lamp group, so layers don't pile onto the same lamps
    # - lamps hold until the next note of the same instrument (~0.4 s), not 120 ms blips
    # - left/right mirror each other; the car reads as one gesture
    # - big moves (many lamps at once) only on strong accents, so a big move always has a big sound
    end = n - 3 * FPS
    gap = 5  # 100 ms dark between two notes, so a repeated note is visible as a new flash
    accent = onset[hits] if len(hits) else np.zeros(1)
    strong_thr = np.percentile(accent, 70)
    strong = lambda t: onset[max(0, t - 2):t + 3].max() >= strong_thr

    def held(times, longest, every=None):
        """(start, stop) per note: holds until the next note of the same instrument, at most `longest`.
        The lamp goes off on the last audible hit before that, so turning off is a move on the music too.
        `every`: at most one note per that many frames, keeping the loudest (hand-made shows flash each
        lamp ~0.5x per second; every kick or snare on the same lamp reads as flicker)."""
        times = sorted({int(t) for t in times if t < end})
        if every:
            kept = []
            for t in sorted(times, key=lambda t: -onset[t]):
                if all(abs(t - k) >= every for k in kept):
                    kept.append(t)
            times = sorted(kept)
        out = []
        for t, u in zip(times, times[1:] + [end]):
            stop = min(t + int(longest), u - gap)
            i = int(np.searchsorted(hits, stop, "right")) - 1
            out.append((t, int(hits[i]) if i >= 0 and hits[i] >= t + flash else max(t + flash, stop)))
        return out

    # Intro: signature fades in; outro: everything fades out over 2 s
    put([L_TAIL, R_TAIL, L_SIG, R_SIG], 0, 2 * FPS + 3, RAMP_ON_2S)
    put([L_TAIL, R_TAIL, L_SIG, R_SIG, L_INNER, R_INNER], end, n - 5, RAMP_OFF_2S)

    q = period / 4  # one 16th note
    beat_hold = period * 0.75
    two_beats = 2 * period - 2  # one note per lamp group per half bar, at most
    POS = [L_AUX, R_AUX, L_MARK, R_MARK]  # one output on Model 3/Y: gaps matter
    # build-up chase, outside in, both sides at once
    CHASE = [[L_FTURN, R_FTURN], [L_FOG, R_FOG], [L_SIG, R_SIG], [L_OUTER, R_OUTER], [L_INNER, R_INNER]]
    HEAD = [L_OUTER, R_OUTER, L_INNER, R_INNER]
    sig_free = []  # beats where no vocal holds the signature: it pulses there instead
    for bi, (a, b) in enumerate(zip(bars, bar_end)):
        if a >= end:
            break
        b = min(int(b), end)
        L = bar_lvl[bi]
        played = [h for h in (on_hit(int(t)) for t in beats[(beats >= a) & (beats < b)]) if h is not None]
        if build_bar[bi]:
            # Build-up: light runs from the corners to the middle, on 8ths then on 16ths
            step = period / 2 if build_bar[bi] == 1 else q
            for k, t in enumerate(np.arange(a, b, step)):
                t = on_hit(int(t)) or int(t)
                put(CHASE[k % len(CHASE)], t, t + max(flash, int(step) - 1), ON)
                if build_bar[bi] == 2 and k % 2 == 0:
                    put([BRAKE], t, t + flash, ON)
            continue
        if L == 0:
            # Quiet: headlights "breathe" once every 4 bars, park lights mark a played downbeat
            if bi % 4 == 0:
                mid_bar = a + (b - a) // 2
                put([L_INNER, R_INNER], a, mid_bar, RAMP_ON_2S)
                put([L_INNER, R_INNER], mid_bar, b, RAMP_OFF_2S)
            if played and played[0] - a <= 2:
                put(POS, a, a + int(beat_hold), ON)
            sig_free += [t for t in played if strong(t)]
            continue
        if L == 2:
            put([L_TAIL, R_TAIL], a, b, ON)  # chorus: tail lights steady, brake does the kicks
        for i, (t, u) in enumerate(held(played, period * 0.6)):
            if L == 1:
                # Verse: outer pair on beats 1 and 3, inner pair on 2 and 4
                put(HEAD[:2] if i % 2 == 0 else HEAD[2:], t, u, ON)
            elif i % 2 == 0:
                # Chorus, beats 1 and 3: opens from the middle, inner pair on the beat, outer pair on the
                # next hit, held through beat 2/4 (strong snares flash every headlight there)
                u = held([t, t + 2 * period], period * 1.6)[0][1]
                put(HEAD[2:], t, u, ON)
                o = on_hit(int(t + period / 2))
                if o is not None and o > t + flash:
                    put(HEAD[:2], o, max(o + flash, u), ON)
        sig_free += [t for t in played if strong(t)]
        if L == 2 and bi % 4 == 0 and played and played[0] - a <= 2 and strong(played[0]):
            # every 4 chorus bars, on a strong downbeat: everything at once
            put([*HEAD, *POS, L_REP, R_REP, L_FOG, R_FOG, BRAKE, REVERSE, PLATE], a, a + int(beat_hold), ON)

    # Vocals own the signature + channels 4-6: lit while someone sings (>= 0.5 s), then fade.
    # Without vocals there, they pulse on the strong beats instead.
    sing = np.zeros(n, bool)
    if vocal is not None:
        sing = voice if voice is not None else vocal > np.percentile(vocal, 65)
        for a, b in segments(sing):
            if b - a >= FPS // 2 and a < end and lvl_at(a) >= 1:
                put([L_SIG, R_SIG, *CH4], a, min(b, end), ON)
                put([L_SIG, R_SIG, *CH4], min(b, end), min(b, end) + 28, RAMP_OFF_500)
    for t, u in held([t for t in sig_free if not sing[t]], beat_hold, two_beats):
        put([L_SIG, R_SIG, *CH4], t, u, ON)

    # Kick: brake lights (tail lights are steady in choruses only)
    for t, u in held([t for t in kicks if lvl_at(t) >= 1], beat_hold, two_beats):
        put([BRAKE], t, u, ON)
    # Snare: front + rear fog; a strong chorus snare also flashes every headlight
    for t, u in held([t for t in snares if lvl_at(t) >= 1], beat_hold, two_beats):
        put([L_FOG, R_FOG, REAR_FOG], t, u, ON)
        if lvl_at(t) == 2 and strong(t):
            put(HEAD, t, t + 2 * flash, ON)
    # Hi-hats (choruses only): front turn signals + repeaters, short, only on the off-beat "and"
    # (every 16th reads as flicker)
    off_beat = lambda t: (i := int(np.searchsorted(beats, t, "right")) - 1) >= 0 and abs(t - beats[i] - period / 2) <= 2
    for t, _u in held([t for t in hats if lvl_at(t) == 2 and off_beat(t)], flash, two_beats):
        put([L_FTURN, R_FTURN, L_REP, R_REP], t, t + flash, ON)

    if voice is not None:
        # Instrumental parts (no voice): the lead instrument plays the turn signals + repeaters
        lead = [t for t in pick_peaks(other_on, min_gap=9, k=1.0) if lvl_at(t) >= 1 and not voice[t]]
        for t, u in held(lead, beat_hold, two_beats):
            put([L_FTURN, R_FTURN, L_REP, R_REP], t, u, ON)
        # Bass notes: park lights / side markers (one output on Model 3/Y, so the gaps matter)
        for t, u in held([t for t in pick_peaks(bass_on, min_gap=12, k=1.2) if lvl_at(t) >= 1], beat_hold, two_beats):
            put(POS, t, u, ON)

    # Silence (breaks, pauses, fade-outs >= 1 s): every light goes dark, even though the beat grid keeps going
    calm = np.convolve(energy, np.ones(FPS // 2) / (FPS // 2), "same") < 0.03 * np.percentile(energy, 90)  # -30 dB
    for a, b in segments(calm):
        if b - a >= FPS and a < end:
            data[a:min(b, end), :30] = OFF

    # Mirrors: fold on the strongest chorus kicks (8 pairs = 16/20, 10 = 20/20 with --max)
    strong = sorted((t for t in kicks if lvl[t] == 2 and 2 * FPS < t < end - 5 * FPS), key=lambda t: -low[t])
    chosen = []
    for t in strong:
        if len(chosen) < (10 if max_mode else 8) and all(abs(t - c) > (6 if max_mode else 8) * FPS for c in chosen):
            chosen.append(t)
    for t in sorted(chosen):
        data[t:t + FPS, [L_MIRROR, R_MIRROR]] = C_CLOSE
        data[t + 3 * FPS:t + 4 * FPS, [L_MIRROR, R_MIRROR]] = C_OPEN

    # Charge port: opens + rainbow LED in the longest chorus (3/3 commands)
    loud = [s for s in segments(lvl == 2) if s[1] - s[0] >= 10 * FPS and s[1] < end]
    if loud:
        a, b = max(loud, key=lambda s: s[1] - s[0])
        dance_end = min(b, a + 3 * FPS + 25 * FPS)  # dans max ~25 s (limite termice)
        data[a:a + FPS, CHARGE_PORT] = C_OPEN
        data[a + 3 * FPS:dance_end, CHARGE_PORT] = C_DANCE
        data[dance_end:dance_end + FPS, CHARGE_PORT] = C_CLOSE

    choruses = [s for s in segments(lvl == 2) if s[1] - s[0] >= 4 * FPS and s[1] < end]
    if max_mode and choruses:
        # Windows: dance in the 3 longest choruses, max 8 s each (~24 s total, under the thermal limit),
        # apoi Close la final => 4/6 comenzi per geam
        for a, b in sorted(sorted(choruses, key=lambda s: s[0] - s[1])[:3]):
            data[a:min(b, a + 8 * FPS), WINDOWS] = C_DANCE
        data[end:end + FPS, WINDOWS] = C_CLOSE

    if max_mode and model in MODELS_WITH_LIFTGATE:
        # Liftgate/frunk: opens (~14 s) before a chorus, dances in it, then closes. Tries the longest
        # choruses first, then any louder part, so short songs or fragmented choruses still get it.
        # (a chorus running into the outro still counts: the dance is cut 5 s before the end)
        cands = [s for x in (lvl == 2, lvl >= 1) for s in sorted(segments(x), key=lambda s: s[0] - s[1])
                 if s[1] - s[0] >= 4 * FPS]
        for a, b in cands:
            open_at = max(2 * FPS, a - 15 * FPS)
            dance_from = max(a, open_at + 15 * FPS)
            dance_to = min(b, dance_from + 15 * FPS, end - 5 * FPS - 1)
            if dance_to - dance_from >= 4 * FPS:
                data[open_at:open_at + FPS, LIFTGATE] = C_OPEN
                data[dance_from:dance_to, LIFTGATE] = C_DANCE
                data[dance_to:dance_to + FPS, LIFTGATE] = C_CLOSE
                break

    if max_mode and model == "ms":
        # Door handles (Model S only) present together with the mirror folds => 2 commands per hit, max 20
        for t in sorted(chosen):
            data[t:t + FPS, HANDLES] = C_OPEN
            data[t + 3 * FPS:t + 4 * FPS, HANDLES] = C_CLOSE

    shift = round(OFFSET_MS / STEP_MS)
    if shift:
        data = np.roll(data, shift, axis=0)
    return data, 60 * FPS / period, len(beats)


def closure_commands(col):
    """Open/Dance/Close commands (the ones that count toward the limit) on one channel."""
    st = (col // 32 + 1) // 2
    starts = np.flatnonzero(np.diff(np.r_[0, st]) != 0)
    return int(np.isin(st[starts], [1, 2, 3]).sum())


MODEL_NAMES = ["Left Outer Main Beam", "Right Outer Main Beam", "Left Inner Main Beam", "Right Inner Main Beam",
    "Left Signature", "Right Signature", "Left Channel 4", "Right Channel 4", "Left Channel 5", "Right Channel 5",
    "Left Channel 6", "Right Channel 6", "Left Front Turn", "Right Front Turn", "Left Front Fog", "Right Front Fog",
    "Left Aux Park", "Right Aux Park", "Left Side Marker", "Right Side Marker", "Left Side Repeater",
    "Right Side Repeater", "Left Rear Turn", "Right Rear Turn", "Brake Lights", "Left Tail", "Right Tail",
    "Reverse Lights", "Rear Fog Lights", "License Plate", "Left Falcon Door", "Right Falcon Door",
    "Left Front Door", "Right Front Door", "Left Mirror", "Right Mirror", "Left Front Window", "Left Rear Window",
    "Right Front Window", "Right Rear Window", "Liftgate", "Left Front Door Handle", "Left Rear Door Handle",
    "Right Front Door Handle", "Right Rear Door Handle", "Charge Port"]


def write_xsq(path, data, media="lightshow.wav"):
    """xLights sequence (official Tesla project): 'On' effects with brightness = channel value."""
    pcts = sorted({round(int(v) * 100 / 255) for v in np.unique(data) if v})
    ref = {p: i for i, p in enumerate(pcts)}
    db = "".join(f"    <Effect>{'' if p == 100 else f'E_TEXTCTRL_Eff_On_End={p},E_TEXTCTRL_Eff_On_Start={p}'}</Effect>\n"
                 for p in pcts)
    elems, effs = [], []
    for ch, name in enumerate(MODEL_NAMES):
        col = data[:, ch].astype(int)
        edges = np.flatnonzero(np.diff(np.r_[-1, col, -1]))
        runs = [f'        <Effect ref="{ref[round(int(col[a]) * 100 / 255)]}" name="On" startTime="{a * STEP_MS}" '
                f'endTime="{b * STEP_MS}" palette="0"/>\n' for a, b in zip(edges[:-1], edges[1:]) if col[a]]
        elems.append(f'    <Element collapsed="0" type="model" name="{name}" visible="1"/>\n')
        effs.append(f'    <Element type="model" name="{name}">\n      <EffectLayer>\n{"".join(runs)}'
                    f'      </EffectLayer>\n    </Element>\n')
    path.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<xsequence BaseChannel="0" ChanCtrlBasic="0" ChanCtrlColor="0" FixedPointTiming="1" ModelBlending="true">
  <head>
    <version>2024.15</version>
    <sequenceTiming>{STEP_MS} ms</sequenceTiming>
    <sequenceType>Media</sequenceType>
    <mediaFile>{media}</mediaFile>
    <sequenceDuration>{len(data) * STEP_MS / 1000:.3f}</sequenceDuration>
  </head>
  <nextid>1</nextid>
  <ColorPalettes>
    <ColorPalette>C_BUTTON_Palette1=#FFFFFF,C_CHECKBOX_Palette1=1</ColorPalette>
  </ColorPalettes>
  <EffectDB>
{db}  </EffectDB>
  <DisplayElements>
{"".join(elems)}  </DisplayElements>
  <ElementEffects>
{"".join(effs)}  </ElementEffects>
</xsequence>
""", encoding="utf-8")


def write_fseq(path, data):
    n = len(data)
    hdr = struct.pack("<4sHBBHIIBBBBBBQ", b"PSEQ", 32, 0, 2, 32, NCH, n, STEP_MS,
                      0, 0, 0, 0, 0, int(time.time() * 1e6))
    path.write_bytes(hdr + np.ascontiguousarray(data).tobytes())


def generate(src, out, name="lightshow", max_mode=False, model="m3"):
    """Analyzes `src` and writes <out>/<name>.fseq, .xsq, .wav. Returns (data, bpm, nbeats, dance_s)."""
    if model not in MODELS:
        raise ValueError(f"unknown model: {model} (pick one of {', '.join(MODELS)})")
    out.mkdir(parents=True, exist_ok=True)
    onset, low, mid, high, energy, vocal = analyze(load_audio(src))
    stems = separate(src)
    feats = {k: analyze(y) for k, y in stems.items()} if stems else None
    data, bpm, nbeats = build(onset, low, mid, high, energy, max_mode, model, vocal, feats)

    # Tesla's official per-closure limits (Open/Dance/Close count)
    limits = {L_MIRROR: 20, R_MIRROR: 20, CHARGE_PORT: 3, LIFTGATE: 6,
              **{w: 6 for w in WINDOWS}, **{h: 20 for h in HANDLES}}
    for ch, lim in limits.items():
        c = closure_commands(data[:, ch])
        assert c <= lim, f"channel {ch}: {c} commands > limit {lim}"
    dance_s = (data[:, WINDOWS[0]] == C_DANCE).sum() / FPS
    assert dance_s <= 30, f"windows: {dance_s:.0f} s of dancing > 30 s (thermal limit)"
    assert not data[:, 30:34].any(), "doors (including Falcon Wing) stay idle: pinch protection could stop the show"

    write_fseq(out / f"{name}.fseq", data)
    write_xsq(out / f"{name}.xsq", data, media=f"{name}.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ar", "44100", "-ac", "2",
                    str(out / f"{name}.wav")], check=True)
    return data, bpm, nbeats, dance_s


if __name__ == "__main__":
    # python make_show.py song.mp3 [--max] [--model m3|my|ms|mx|ct] [--out DIR] [--name NAME]
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    opt = lambda k, d: args[args.index(k) + 1] if k in args else d
    src = Path(args[0])
    out = Path(opt("--out", src.parent / "LightShow"))
    data, bpm, nbeats, dance_s = generate(src, out, opt("--name", "lightshow"), "--max" in args, opt("--model", "m3"))
    print(f"{len(data)} frames ({len(data) / FPS:.1f} s), ~{bpm:.0f} BPM, {nbeats} beats")
    print(f"mirrors: {closure_commands(data[:, L_MIRROR])}/20, charge port: {closure_commands(data[:, CHARGE_PORT])}/3, "
          f"windows: {closure_commands(data[:, WINDOWS[0]])}/6 ({dance_s:.0f} s dancing), "
          f"liftgate: {closure_commands(data[:, LIFTGATE])}/6, handles: {closure_commands(data[:, HANDLES[0]])}/20")
    print(f"-> {out}")
