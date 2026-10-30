// Tesla Light Show emulator: turns .fseq channels into what each model actually does.
// Rules come from the official teslamotors/light-show README: "Light Channels with Brightness Control",
// "Closures channels" and "Light channel mapping details".

export const VEHICLES = {
  m3: { name: 'Model 3', hint: '2021–2023, manual trunk', family: '3y' },
  m3h: { name: 'Model 3 Highland', hint: '2024 and newer, power trunk', family: '3y', liftgate: true },
  m3old: { name: 'Model 3 (before Oct 2020)', hint: 'Tail lights and license plate light work together', family: '3y', tailsPlate: true },
  my: { name: 'Model Y', hint: '2020–2024, with power liftgate', family: '3y', liftgate: true },
  myj: { name: 'Model Y Juniper', hint: '2025 and newer, front and rear light bars', family: '3y', liftgate: true },
  ms: { name: 'Model S', hint: '2021 and newer, with presenting door handles', family: 'sx', liftgate: true, handles: true },
  mx: { name: 'Model X', hint: '2021 and newer, with Falcon Wing doors', family: 'sx', liftgate: true, falcon: true, frontDoors: true, rearFogNA: true },
  ct: { name: 'Cybertruck', hint: 'Light bars, powered frunk', family: 'ct', liftgate: true },
};
export const REGIONS = {
  eu: { name: 'Europe', hint: 'Has a rear fog light, no side markers' },
  na: { name: 'North America', hint: 'Has side markers, no rear fog light (except Model X)' },
};
export const HEADLIGHTS = {
  reflector: { name: 'LED reflector', hint: 'Outer main beam ramps smoothly' },
  projector: { name: 'LED projector', hint: 'Outer main beam is on/off only' },
};

// Closures: channel, movement time (ms), Dance support, command limit, which models have them
export const CLOSURES = [
  { key: 'falconL', ch: 30, label: 'Left Falcon Wing door', open: 20000, close: 8000, dance: true, limit: 6, has: v => v.falcon },
  { key: 'falconR', ch: 31, label: 'Right Falcon Wing door', open: 20000, close: 8000, dance: true, limit: 6, has: v => v.falcon },
  { key: 'doorL', ch: 32, label: 'Left front door', open: 22000, close: 3000, dance: false, limit: 6, has: v => v.frontDoors },
  { key: 'doorR', ch: 33, label: 'Right front door', open: 22000, close: 3000, dance: false, limit: 6, has: v => v.frontDoors },
  { key: 'mirrorL', ch: 34, label: 'Left mirror', open: 2000, close: 2000, dance: false, limit: 20, has: () => true },
  { key: 'mirrorR', ch: 35, label: 'Right mirror', open: 2000, close: 2000, dance: false, limit: 20, has: () => true },
  { key: 'winLF', ch: 36, label: 'Left front window', open: 4000, close: 4000, dance: true, limit: 6, has: () => true },
  { key: 'winLR', ch: 37, label: 'Left rear window', open: 4000, close: 4000, dance: true, limit: 6, has: () => true },
  { key: 'winRF', ch: 38, label: 'Right front window', open: 4000, close: 4000, dance: true, limit: 6, has: () => true },
  { key: 'winRR', ch: 39, label: 'Right rear window', open: 4000, close: 4000, dance: true, limit: 6, has: () => true },
  { key: 'liftgate', ch: 40, label: 'Liftgate / frunk', open: 14000, close: 4000, dance: true, limit: 6, has: v => v.liftgate },
  { key: 'handleLF', ch: 41, label: 'Left front handle', open: 2000, close: 2000, dance: false, limit: 20, has: v => v.handles },
  { key: 'handleLR', ch: 42, label: 'Left rear handle', open: 2000, close: 2000, dance: false, limit: 20, has: v => v.handles },
  { key: 'handleRF', ch: 43, label: 'Right front handle', open: 2000, close: 2000, dance: false, limit: 20, has: v => v.handles },
  { key: 'handleRR', ch: 44, label: 'Right rear handle', open: 2000, close: 2000, dance: false, limit: 20, has: v => v.handles },
  { key: 'chargePort', ch: 45, label: 'Charge port', open: 2000, close: 2000, dance: true, limit: 3, has: () => true },
];

export const LAMP_COLOR = { white: '#f4f8ff', amber: '#ffa628', red: '#ff2b2b' };

// Ramp duration from the effect brightness (README "Ramping light channels"):
// off 10/20/30% = 500/1000/2000 ms, on 70/80/90% = 500/1000/2000 ms, 0% and 100% instant
const rampMs = v => {
  const p = Math.round(v * 100 / 255);
  if (v > 127) return p >= 95 ? 0 : p >= 85 ? 2000 : p >= 75 ? 1000 : p >= 65 ? 500 : 0;
  return p <= 5 ? 0 : p <= 15 ? 500 : p <= 25 ? 1000 : p <= 35 ? 2000 : 0;
};
export const closureState = v => (Math.floor(v / 32) + 1) >> 1; // 0 idle, 1 open, 2 dance, 3 close, 4 stop

function rampable(ch, v, cfg) {
  const fam = v.family;
  if (ch <= 1) return fam === 'ct' || cfg.headlights === 'reflector';
  if (ch <= 3) return true;
  if (ch <= 5) return fam === '3y';
  if (ch <= 11) return fam !== 'ct';
  if (ch <= 13) return fam !== 'sx';
  if (ch === 18 || ch === 19) return fam === 'ct';
  return false;
}

export function createEmulator(cfg) {
  const v = VEHICLES[cfg.vehicle] || VEHICLES.m3;
  const lv = new Float32Array(30);
  const cl = {};
  const out = { rgb: {}, frontBar: new Float32Array(60), rearBar: new Float32Array(52), offroad: new Float32Array(6) };

  // pos = how open (0..1). Mirrors start open (unfolded); Close folds them.
  function reset() {
    for (const c of CLOSURES) {
      const start = c.key.startsWith('mirror') ? 1 : 0;
      cl[c.key] = { pos: start, target: start, dance: false, phase: Math.random() * 6 };
    }
  }
  reset();

  const approach = (o, ms, dt) => { o.pos += Math.sign(o.target - o.pos) * Math.min(Math.abs(o.target - o.pos), dt / ms); };

  function stepClosures(frame, dt) {
    for (const c of CLOSURES) {
      const o = cl[c.key];
      if (!c.has(v) || c.ch >= frame.length) { o.dance = false; continue; }
      const s = closureState(frame[c.ch]);
      o.dance = false;
      if (s === 2 && c.dance && (c.key.startsWith('win') || o.pos > 0.95 || o.danceStarted)) {
        // Dance: windows can dance anytime; everything else only once fully open
        o.dance = o.danceStarted = true;
        o.phase += dt / 2200 * Math.PI * 2;
        o.target = c.key.startsWith('win') ? 0.4 + 0.3 * Math.sin(o.phase) : 0.8 + 0.2 * Math.sin(o.phase);
        approach(o, 1500, dt);
        continue;
      }
      if (s !== 2) o.danceStarted = false;
      if (s === 1) o.target = 1; else if (s === 3) o.target = 0; else if (s === 4) o.target = o.pos;
      approach(o, o.target > o.pos ? c.open : c.close, dt);
    }
  }

  function step(frame, dt, snap, history) {
    for (let ch = 0; ch < 30; ch++) {
      const val = frame[ch];
      const fullBrightness = v.family === 'ct' && (ch === 24 || ch === 22 || ch === 23);
      if (fullBrightness) { lv[ch] = val / 255; continue; }
      const target = val > 127 ? 1 : 0;
      // Channels 5 and 6 use channel 4's ramp duration (the "leader" channel)
      const rampSource = ch >= 8 && ch <= 11 ? frame[6 + (ch % 2)] : val;
      const dur = rampable(ch, v, cfg) ? rampMs(rampSource) : 0;
      if (snap || dur === 0) lv[ch] = target;
      else lv[ch] += Math.sign(target - lv[ch]) * Math.min(Math.abs(target - lv[ch]), dt / dur);
    }
    if (snap && history) { reset(); history(f => stepClosures(f, history.step)); }
    else stepClosures(frame, dt);
    map(frame);
    return out;
  }

  function map(frame) {
    const L = i => lv[i];
    const fam = v.family, na = cfg.region === 'na', ct = fam === 'ct';
    out.outerL = L(0); out.outerR = L(1); out.innerL = L(2); out.innerR = L(3);
    out.sigL = ct ? 0 : L(4); out.sigR = ct ? 0 : L(5);
    if (fam === '3y') { // channels 4-6 are a single output per side
      out.c4L = out.c5L = out.c6L = Math.max(L(6), L(8), L(10));
      out.c4R = out.c5R = out.c6R = Math.max(L(7), L(9), L(11));
    } else if (ct) { out.c4L = out.c5L = out.c6L = out.c4R = out.c5R = out.c6R = 0; }
    else { out.c4L = L(6); out.c4R = L(7); out.c5L = L(8); out.c5R = L(9); out.c6L = L(10); out.c6R = L(11); }
    out.fturnL = L(12); out.fturnR = L(13);
    out.fogL = L(14); out.fogR = L(15);
    if (fam === '3y') { // aux park + side markers: one output for all 4 channels
      const all = Math.max(L(16), L(17), L(18), L(19));
      out.auxL = out.auxR = all;
      out.markerL = out.markerR = na ? all : 0;
    } else if (ct) {
      out.auxL = out.auxR = 0;
      out.frunkLight = Math.max(L(16), L(17)); // Frunk light <- aux park
      out.markerL = L(18); out.markerR = L(19);
    } else {
      out.auxL = Math.max(L(16), L(18)); out.auxR = Math.max(L(17), L(19));
      out.markerL = na ? out.auxL : 0; out.markerR = na ? out.auxR : 0;
    }
    out.repL = L(20); out.repR = L(21);
    out.rsmL = ct ? L(20) : 0; out.rsmR = ct ? L(21) : 0; // CT: rear side markers <- side repeaters
    out.rturnL = ct ? 0 : L(22); out.rturnR = ct ? 0 : L(23); // CT: rear turn signals are disabled
    out.brake = L(24);
    if (v.tailsPlate) { const t = Math.max(L(25), L(26)); out.tailL = out.tailR = out.plate = t; }
    else { out.tailL = L(25); out.tailR = L(26); out.plate = L(29); }
    if (ct) { out.reverseL = L(25); out.reverseR = L(26); out.bed = L(27); out.tailL = out.tailR = 0; } // CT: reverse lights <- tail lights
    else { out.reverseL = out.reverseR = L(27); out.bed = 0; }
    out.rearFog = (!na || v.rearFogNA) ? L(28) : 0;
    // Cybertruck light bars (200 channels), interior RGB
    const has200 = frame.length >= 194;
    for (let i = 0; i < 60; i++) out.frontBar[i] = has200 && ct ? frame[46 + i] / 255 : 0;
    for (let i = 0; i < 52; i++) out.rearBar[i] = has200 && ct ? frame[110 + i] / 255 : 0;
    for (let i = 0; i < 6; i++) out.offroad[i] = has200 && ct ? frame[166 + i] / 255 : 0;
    const rgb = s => has200 ? [frame[s], frame[s + 1], frame[s + 2]] : [0, 0, 0];
    out.rgb = { display: rgb(175), rr: rgb(178), rf: rgb(181), cf: rgb(184), lf: rgb(187), lr: rgb(190) };
    out.closures = cl;
  }

  return { vehicle: v, step, reset };
}

// Report: what the show uses and what the selected model ignores.
export function compatibility(seq, cfg) {
  const v = VEHICLES[cfg.vehicle] || VEHICLES.m3;
  const at = (f, c) => seq.data[seq.off + f * seq.ch + c];
  const used = c => { for (let f = 0; f < seq.frames; f++) if (at(f, c) > 127) return true; return false; };
  const commands = c => {
    let prev = 0, n = 0;
    for (let f = 0; f < seq.frames; f++) {
      const s = closureState(at(f, c));
      if (s !== prev && s >= 1 && s <= 3) n++;
      prev = s;
    }
    return n;
  };
  const rows = [];
  for (const c of CLOSURES) {
    if (c.ch >= seq.ch) continue;
    const n = commands(c.ch);
    if (!n) continue;
    rows.push({ label: c.label, detail: `${n} ${n === 1 ? 'command' : 'commands'} of ${c.limit}`,
      ok: c.has(v) && n <= c.limit,
      note: !c.has(v) ? `${v.name} doesn't have this, so the commands are ignored.`
        : n > c.limit ? `Over Tesla's limit: the car only runs the first ${c.limit}.` : '' });
  }
  const na = cfg.region === 'na';
  const lightNotes = [
    [28, 'Rear fog light', (!na || v.rearFogNA), 'Only on cars outside North America, and on Model X.'],
    [18, 'Side markers', na || v.family === 'ct', 'Only on North American cars.'],
    [22, 'Rear turn signals', v.family !== 'ct', 'Disabled on Cybertruck.'],
    [4, 'Signature', v.family !== 'ct', 'Cybertruck has no such channel.'],
  ];
  for (const [c, label, ok, note] of lightNotes) if (c < seq.ch && used(c)) rows.push({ label, detail: 'used in the show', ok, note: ok ? '' : note });
  if (v.family === 'ct' && seq.ch < 194) rows.push({ label: 'Cybertruck light bars', detail: '48-channel show', ok: false, note: 'Light bars need a 200-channel show.' });
  return rows;
}
