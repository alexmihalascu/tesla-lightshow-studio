"""Generează un Tesla light show (lightshow.fseq + lightshow.wav) dintr-un mp3.
Țintă: Model 3 2022 (fără hayon electric). Folosire: python make_show.py "melodie.mp3"
"""
import struct, subprocess, sys, time
from pathlib import Path
import numpy as np

FPS, STEP_MS, SR, NCH = 50, 20, 22050, 48
HOP = SR // FPS  # 441 eșantioane = 20 ms
# Calibrare: deplasează toate luminile în timp (ms) dacă pe mașină par în avans/întârziere.
OFFSET_MS = 0

# Canale (0-based) din layout-ul oficial Tesla xLights
L_OUTER, R_OUTER, L_INNER, R_INNER, L_SIG, R_SIG = 0, 1, 2, 3, 4, 5
CH4 = (6, 7, 8, 9, 10, 11)  # pe Model 3 sunt o singură ieșire (OR)
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
    low = flux(freqs < 150)                       # tobă mare / bas
    mid = flux((freqs > 1000) & (freqs < 4000))   # snare, clap
    high = flux((freqs > 2000) & (freqs < 8000))  # cinele
    energy = np.sqrt((frames ** 2).mean(axis=1))
    return onset, low, mid, high, energy


def tempo_period(onset):
    o = onset - onset.mean()
    ac = np.correlate(o, o, "full")[len(o) - 1:]
    lags = np.arange(15, 50.01, 0.05)  # 200..60 BPM, rezoluție sub un cadru
    # comb: perioada reală e puternică și la 2, 3, 4 beat-uri; sincopele (1.5 beat) nu
    comb = sum(np.interp(lags * k, np.arange(len(ac)), ac) for k in (1, 2, 3, 4))
    best = lags[np.argmax(comb)]
    # comb-ul favorizează jumătate de tempo; ia tempo dublu dacă e aproape la fel de puternic (<= 180 BPM)
    near = (lags > best / 2 * 0.97) & (lags < best / 2 * 1.03) & (lags >= 60 * FPS / 180)
    if near.any() and comb[near].max() >= 0.6 * comb.max():
        best = lags[near][np.argmax(comb[near])]
    return float(best)


def track_beats(onset, period, alpha=100.0):
    """Beat tracking prin programare dinamică (Ellis 2007)."""
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
    """0 = liniștit, 1 = mediu, 2 = refren/drop. Netezit pe ~3 s."""
    s = np.convolve(energy, np.ones(3 * FPS) / (3 * FPS), "same")
    return np.digitize(s, np.percentile(s, cuts))


def segments(mask):
    edges = np.flatnonzero(np.diff(np.r_[0, mask.astype(int), 0]))
    return list(zip(edges[::2], edges[1::2]))


def build(onset, low, mid, high, energy, max_mode=False, model="m3"):
    n = len(onset)
    data = np.zeros((n, NCH), np.uint8)
    lvl = levels(energy, (25, 55) if max_mode else (35, 70))
    period = tempo_period(onset)
    beats = track_beats(onset, period)
    # Sincronizare: fiecare beat pe vârful real al loviturii (±2 cadre = ±40 ms)
    beats = np.array([b - 2 + int(np.argmax(onset[max(0, b - 2):b + 3])) if b >= 2 else b for b in beats])
    grid = np.unique(np.concatenate([beats + int(round(k * period / 4)) for k in range(4)]))  # șaisprezecimi

    def snap(events):
        """Evenimentele apropiate de grila ritmică (<= 2 cadre) cad exact pe ea."""
        if not len(events):
            return events
        idx = np.clip(np.searchsorted(grid, events), 1, len(grid) - 1)
        near = np.where(events - grid[idx - 1] < grid[idx] - events, grid[idx - 1], grid[idx])
        return np.where(np.abs(near - events) <= 2, near, events)

    kicks = snap(pick_peaks(low, min_gap=11, k=1.2))   # >= 220 ms între flash-uri
    snares = snap(pick_peaks(mid, min_gap=11, k=1.4))
    hats = snap(pick_peaks(high, min_gap=11, k=1.5))
    flash = 6  # 120 ms (Tesla recomandă >= 100 ms)
    # Măsuri de 4 timpi: primul timp e faza cu cel mai mult bas pe beat
    phase = int(np.argmax([low[beats[p::4]].sum() for p in range(4)]))
    bars = beats[phase::4]
    bar_end = np.r_[bars[1:], n]
    # Nivelul pe măsură (stabil, nu pe cadru); „build” = cele 2 măsuri dinaintea unui refren
    bar_lvl = [int(np.median(lvl[a:max(a + 1, b)])) for a, b in zip(bars, bar_end)]
    build_bar = [0] * len(bars)  # 0 = nu, 1 = prima măsură de build, 2 = ultima (mai rapidă)
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

    def pulse(chs, t, decay=RAMP_OFF_500, tail=28):
        put(chs, t, t + flash, ON)
        put(chs, t + flash, t + flash + tail, decay)

    end = n - 3 * FPS
    # Intro: stopuri + semnătură intră lin; outro: totul se stinge în 2 s
    put([L_TAIL, R_TAIL], 0, end, ON)
    put([L_TAIL, R_TAIL, L_SIG, R_SIG], 0, 2 * FPS + 3, RAMP_ON_2S)
    put([L_TAIL, R_TAIL, L_SIG, R_SIG, L_INNER, R_INNER], end, n - 5, RAMP_OFF_2S)

    q = period / 4  # o șaisprezecime
    half = max(flash, int(period * 0.4))
    POS = [L_AUX, R_AUX, L_MARK, R_MARK]  # pe Model 3/Y sunt o singură ieșire: pauzele contează
    CHASE = [L_FTURN, L_FOG, L_SIG, L_INNER, L_OUTER, R_OUTER, R_INNER, R_SIG, R_FOG, R_FTURN]
    for bi, (a, b) in enumerate(zip(bars, bar_end)):
        if a >= end:
            break
        b = min(int(b), end)
        L = bar_lvl[bi]
        bar_beats = beats[(beats >= a) & (beats < b)]
        if build_bar[bi]:
            # Pregătirea refrenului: lumina fuge stânga-dreapta, întâi pe optimi, apoi pe șaisprezecimi
            step = period / 2 if build_bar[bi] == 1 else q
            for k, t in enumerate(np.arange(a, b, step)):
                ch = CHASE[k % len(CHASE)] if (k // len(CHASE)) % 2 == 0 else CHASE[::-1][k % len(CHASE)]
                put([ch], int(t), int(t) + flash, ON)
                if build_bar[bi] == 2 and k % 2 == 0:
                    put([BRAKE], int(t), int(t) + flash, ON)
            continue
        if L == 0:
            # Liniștit: farurile „respiră” (ramp lent), pozițiile stau aprinse, semnătura pulsează pe beat
            mid_bar = a + (b - a) // 2
            put([L_INNER, R_INNER], a, mid_bar, RAMP_ON_2S)
            put([L_INNER, R_INNER], mid_bar, b, RAMP_OFF_2S)
            put(POS, a, b, ON)
            for t in bar_beats:
                pulse([L_SIG, R_SIG, *CH4], int(t))
            continue
        for i, t in enumerate(bar_beats):
            t = int(t)
            pulse([L_SIG, R_SIG, *CH4], t)
            if L == 1:
                # Strofă: faza lungă alternează stânga/dreapta, cu semnalizarea spate de pe aceeași parte
                put([L_OUTER, L_RTURN] if i % 2 == 0 else [R_OUTER, R_RTURN], t, t + half, ON)
                continue
            # Refren: baleiaj „matrix” pe faruri, exterior -> interior -> interior -> exterior,
            # cu direcția inversată la fiecare măsură
            sweep = [L_OUTER, L_INNER, R_INNER, R_OUTER]
            for s, ch in enumerate(sweep if bi % 2 == 0 else sweep[::-1]):
                put([ch], int(t + s * q), int(t + s * q) + max(flash, int(q)), ON)
            off = int(t + period / 2)  # contratimp: lumini de poziție
            put(POS, off, off + flash, ON)
            if i % 2 == 1:  # timpii 2 și 4: ceață față + spate
                put([L_FOG, R_FOG, REAR_FOG], t, t + half, ON)
        if L == 2 and bi % 4 == 0:  # la fiecare 4 măsuri de refren: lovitură cu tot
            put([L_OUTER, R_OUTER, L_INNER, R_INNER, *POS, L_REP, R_REP, BRAKE, REVERSE, PLATE], a, a + 2 * flash, ON)
            pulse([L_FTURN, R_FTURN], a, RAMP_OFF_2S, 2 * FPS + 3)

    for t in kicks:
        if t < end and lvl_at(t) >= 1:
            put([BRAKE], t, t + flash, ON)
            if lvl_at(t) == 1:
                pulse([L_INNER, R_INNER], t)
            else:
                put([REAR_FOG], t, t + flash, ON)
    for t in snares:
        if t < end and lvl_at(t) >= 1:
            # snare: procitoare + repetoare în strofă, flash cu toate farurile în refren
            put([L_FOG, R_FOG, L_REP, R_REP] if lvl_at(t) == 1 else [L_FOG, R_FOG, L_OUTER, R_OUTER, L_INNER, R_INNER], t, t + flash, ON)
    for j, t in enumerate(hats):
        if t < end and lvl_at(t) == 2:
            pulse([L_FTURN, L_REP] if j % 2 == 0 else [R_FTURN, R_REP], t)

    # Oglinzi: se pliază pe cele mai puternice kick-uri din refren (8 perechi = 16/20, în --max 10 = 20/20)
    strong = sorted((t for t in kicks if lvl[t] == 2 and 2 * FPS < t < end - 5 * FPS), key=lambda t: -low[t])
    chosen = []
    for t in strong:
        if len(chosen) < (10 if max_mode else 8) and all(abs(t - c) > (6 if max_mode else 8) * FPS for c in chosen):
            chosen.append(t)
    for t in sorted(chosen):
        data[t:t + FPS, [L_MIRROR, R_MIRROR]] = C_CLOSE
        data[t + 3 * FPS:t + 4 * FPS, [L_MIRROR, R_MIRROR]] = C_OPEN

    # Trapa de încărcare: se deschide + LED curcubeu în cel mai lung refren (3/3 comenzi)
    loud = [s for s in segments(lvl == 2) if s[1] - s[0] >= 10 * FPS and s[1] < end]
    if loud:
        a, b = max(loud, key=lambda s: s[1] - s[0])
        dance_end = min(b, a + 3 * FPS + 25 * FPS)  # dans max ~25 s (limite termice)
        data[a:a + FPS, CHARGE_PORT] = C_OPEN
        data[a + 3 * FPS:dance_end, CHARGE_PORT] = C_DANCE
        data[dance_end:dance_end + FPS, CHARGE_PORT] = C_CLOSE

    choruses = [s for s in segments(lvl == 2) if s[1] - s[0] >= 4 * FPS and s[1] < end]
    if max_mode and choruses:
        # Geamuri: dans în cele mai lungi 3 refrene, max 8 s fiecare (~24 s total, sub limita termică),
        # apoi Close la final => 4/6 comenzi per geam
        for a, b in sorted(sorted(choruses, key=lambda s: s[0] - s[1])[:3]):
            data[a:min(b, a + 8 * FPS), WINDOWS] = C_DANCE
        data[end:end + FPS, WINDOWS] = C_CLOSE

    if max_mode and model in MODELS_WITH_LIFTGATE and loud:
        # Portbagaj/frunk: se deschide (~14 s) înainte de cel mai lung refren, dansează în refren, apoi se închide
        a, b = max(loud, key=lambda s: s[1] - s[0])
        open_at = max(2 * FPS, a - 15 * FPS)
        dance_from = max(a, open_at + 15 * FPS)
        dance_to = min(b, dance_from + 15 * FPS)
        if dance_to - dance_from >= 4 * FPS and dance_to + 5 * FPS < end:
            data[open_at:open_at + FPS, LIFTGATE] = C_OPEN
            data[dance_from:dance_to, LIFTGATE] = C_DANCE
            data[dance_to:dance_to + FPS, LIFTGATE] = C_CLOSE

    if max_mode and model == "ms":
        # Mânerele ușilor (doar Model S) ies odată cu plierea oglinzilor => 2 comenzi per moment, max 20
        for t in sorted(chosen):
            data[t:t + FPS, HANDLES] = C_OPEN
            data[t + 3 * FPS:t + 4 * FPS, HANDLES] = C_CLOSE

    shift = round(OFFSET_MS / STEP_MS)
    if shift:
        data = np.roll(data, shift, axis=0)
    return data, 60 * FPS / period, len(beats)


def closure_commands(col):
    """Comenzi Open/Dance/Close (cele care contează la limită) pe un canal."""
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
    """Secvență xLights (proiectul oficial Tesla): efecte 'On' cu luminozitate = valoarea canalului."""
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
    """Analizează `src` și scrie <out>/<name>.fseq, .xsq, .wav. Întoarce (data, bpm, nbeats, dance_s)."""
    if model not in MODELS:
        raise ValueError(f"model necunoscut: {model} (alege din {', '.join(MODELS)})")
    out.mkdir(parents=True, exist_ok=True)
    onset, low, mid, high, energy = analyze(load_audio(src))
    data, bpm, nbeats = build(onset, low, mid, high, energy, max_mode, model)

    # Limitele oficiale Tesla per închidere (Open/Dance/Close contează)
    limits = {L_MIRROR: 20, R_MIRROR: 20, CHARGE_PORT: 3, LIFTGATE: 6,
              **{w: 6 for w in WINDOWS}, **{h: 20 for h in HANDLES}}
    for ch, lim in limits.items():
        c = closure_commands(data[:, ch])
        assert c <= lim, f"canal {ch}: {c} comenzi > limita {lim}"
    dance_s = (data[:, WINDOWS[0]] == C_DANCE).sum() / FPS
    assert dance_s <= 30, f"geamuri: {dance_s:.0f} s de dans > 30 s (limită termică)"
    assert not data[:, 30:34].any(), "ușile (inclusiv Falcon) rămân idle: risc de oprire anti-prindere"

    write_fseq(out / f"{name}.fseq", data)
    write_xsq(out / f"{name}.xsq", data, media=f"{name}.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ar", "44100", "-ac", "2",
                    str(out / f"{name}.wav")], check=True)
    return data, bpm, nbeats, dance_s


if __name__ == "__main__":
    # python make_show.py melodie.mp3 [--max] [--model m3|my|ms|mx|ct] [--out DIR] [--name NUME]
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    opt = lambda k, d: args[args.index(k) + 1] if k in args else d
    src = Path(args[0])
    out = Path(opt("--out", src.parent / "LightShow"))
    data, bpm, nbeats, dance_s = generate(src, out, opt("--name", "lightshow"), "--max" in args, opt("--model", "m3"))
    print(f"{len(data)} cadre ({len(data) / FPS:.1f} s), ~{bpm:.0f} BPM, {nbeats} beat-uri")
    print(f"oglinzi: {closure_commands(data[:, L_MIRROR])}/20, trapă: {closure_commands(data[:, CHARGE_PORT])}/3, "
          f"geamuri: {closure_commands(data[:, WINDOWS[0]])}/6 ({dance_s:.0f} s dans), "
          f"portbagaj: {closure_commands(data[:, LIFTGATE])}/6, mânere: {closure_commands(data[:, HANDLES[0]])}/20")
    print(f"-> {out}")
