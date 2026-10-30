// Emulator Tesla Light Show: transformă canalele din .fseq în ce face efectiv fiecare model.
// Sursa regulilor: documentația oficială teslamotors/light-show (README), secțiunile
// "Light Channels with Brightness Control", "Closures channels" și "Light channel mapping details".

export const VEHICLES = {
  m3: { name: 'Model 3', hint: '2021 și mai nou', family: '3y' },
  m3old: { name: 'Model 3 (până în oct. 2020)', hint: 'Stopurile și lumina de număr merg împreună', family: '3y', tailsPlate: true },
  my: { name: 'Model Y', hint: '2020–2024, cu hayon electric', family: '3y', liftgate: true },
  myj: { name: 'Model Y Juniper', hint: '2025 și mai nou, bară de lumini față și spate', family: '3y', liftgate: true },
  ms: { name: 'Model S', hint: '2021 și mai nou, cu mânere retractabile', family: 'sx', liftgate: true, handles: true },
  mx: { name: 'Model X', hint: '2021 și mai nou, cu uși Falcon', family: 'sx', liftgate: true, falcon: true, frontDoors: true, rearFogNA: true },
  ct: { name: 'Cybertruck', hint: 'Light bar-uri, frunk electric', family: 'ct', liftgate: true },
};
export const REGIONS = {
  eu: { name: 'Europa', hint: 'Are proiector de ceață spate, fără lumini de poziție laterale' },
  na: { name: 'America de Nord', hint: 'Are lumini de poziție laterale, fără ceață spate (excepție Model X)' },
};
export const HEADLIGHTS = {
  reflector: { name: 'LED cu reflector', hint: 'Faza lungă exterioară face ramp lin' },
  projector: { name: 'LED cu proiector', hint: 'Faza lungă exterioară doar aprins/stins' },
};

// Închideri: canal, durată mișcare (ms), suport Dance, limită comenzi, ce modele le au
export const CLOSURES = [
  { key: 'falconL', ch: 30, label: 'Ușă Falcon stânga', open: 20000, close: 8000, dance: true, limit: 6, has: v => v.falcon },
  { key: 'falconR', ch: 31, label: 'Ușă Falcon dreapta', open: 20000, close: 8000, dance: true, limit: 6, has: v => v.falcon },
  { key: 'doorL', ch: 32, label: 'Ușă față stânga', open: 22000, close: 3000, dance: false, limit: 6, has: v => v.frontDoors },
  { key: 'doorR', ch: 33, label: 'Ușă față dreapta', open: 22000, close: 3000, dance: false, limit: 6, has: v => v.frontDoors },
  { key: 'mirrorL', ch: 34, label: 'Oglindă stânga', open: 2000, close: 2000, dance: false, limit: 20, has: () => true },
  { key: 'mirrorR', ch: 35, label: 'Oglindă dreapta', open: 2000, close: 2000, dance: false, limit: 20, has: () => true },
  { key: 'winLF', ch: 36, label: 'Geam stânga față', open: 4000, close: 4000, dance: true, limit: 6, has: () => true },
  { key: 'winLR', ch: 37, label: 'Geam stânga spate', open: 4000, close: 4000, dance: true, limit: 6, has: () => true },
  { key: 'winRF', ch: 38, label: 'Geam dreapta față', open: 4000, close: 4000, dance: true, limit: 6, has: () => true },
  { key: 'winRR', ch: 39, label: 'Geam dreapta spate', open: 4000, close: 4000, dance: true, limit: 6, has: () => true },
  { key: 'liftgate', ch: 40, label: 'Portbagaj / frunk', open: 14000, close: 4000, dance: true, limit: 6, has: v => v.liftgate },
  { key: 'handleLF', ch: 41, label: 'Mâner stânga față', open: 2000, close: 2000, dance: false, limit: 20, has: v => v.handles },
  { key: 'handleLR', ch: 42, label: 'Mâner stânga spate', open: 2000, close: 2000, dance: false, limit: 20, has: v => v.handles },
  { key: 'handleRF', ch: 43, label: 'Mâner dreapta față', open: 2000, close: 2000, dance: false, limit: 20, has: v => v.handles },
  { key: 'handleRR', ch: 44, label: 'Mâner dreapta spate', open: 2000, close: 2000, dance: false, limit: 20, has: v => v.handles },
  { key: 'chargePort', ch: 45, label: 'Trapă de încărcare', open: 2000, close: 2000, dance: true, limit: 3, has: () => true },
];

export const LAMP_COLOR = { white: '#f4f8ff', amber: '#ffa628', red: '#ff2b2b' };

const RAMP_MS = [0, 500, 1000, 2000];
const rampState = v => Math.min((Math.floor((v > 127 ? 255 - v : v) / 13) + 1) >> 1, 3);
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

  // pos = cât e deschis (0..1). Oglinzile pornesc deschise (desfăcute); Close le pliază.
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
        // Dance: geamurile pot dansa oricând; restul doar dacă sunt deja deschise
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
      // Canalele 5 și 6 folosesc durata de ramp a canalului 4 (canalul "lider")
      const rampSource = ch >= 8 && ch <= 11 ? frame[6 + (ch % 2)] : val;
      const dur = rampable(ch, v, cfg) ? RAMP_MS[rampState(rampSource)] : 0;
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
    if (fam === '3y') { // canalele 4-6 sunt o singură ieșire pe fiecare parte
      out.c4L = out.c5L = out.c6L = Math.max(L(6), L(8), L(10));
      out.c4R = out.c5R = out.c6R = Math.max(L(7), L(9), L(11));
    } else if (ct) { out.c4L = out.c5L = out.c6L = out.c4R = out.c5R = out.c6R = 0; }
    else { out.c4L = L(6); out.c4R = L(7); out.c5L = L(8); out.c5R = L(9); out.c6L = L(10); out.c6R = L(11); }
    out.fturnL = L(12); out.fturnR = L(13);
    out.fogL = L(14); out.fogR = L(15);
    if (fam === '3y') { // poziție + lumini laterale: o singură ieșire pentru toate 4 canalele
      const all = Math.max(L(16), L(17), L(18), L(19));
      out.auxL = out.auxR = all;
      out.markerL = out.markerR = na ? all : 0;
    } else if (ct) {
      out.auxL = out.auxR = 0;
      out.frunkLight = Math.max(L(16), L(17)); // Frunk Light <- Aux Park
      out.markerL = L(18); out.markerR = L(19);
    } else {
      out.auxL = Math.max(L(16), L(18)); out.auxR = Math.max(L(17), L(19));
      out.markerL = na ? out.auxL : 0; out.markerR = na ? out.auxR : 0;
    }
    out.repL = L(20); out.repR = L(21);
    out.rsmL = ct ? L(20) : 0; out.rsmR = ct ? L(21) : 0; // CT: marcaje laterale spate <- repetoare
    out.rturnL = ct ? 0 : L(22); out.rturnR = ct ? 0 : L(23); // CT: semnalizările spate sunt dezactivate
    out.brake = L(24);
    if (v.tailsPlate) { const t = Math.max(L(25), L(26)); out.tailL = out.tailR = out.plate = t; }
    else { out.tailL = L(25); out.tailR = L(26); out.plate = L(29); }
    if (ct) { out.reverseL = L(25); out.reverseR = L(26); out.bed = L(27); out.tailL = out.tailR = 0; } // CT: marșarier <- stopuri
    else { out.reverseL = out.reverseR = L(27); out.bed = 0; }
    out.rearFog = (!na || v.rearFogNA) ? L(28) : 0;
    // Cybertruck light bar (200 canale), RGB interior
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

// Raport: ce folosește show-ul și ce ignoră modelul ales.
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
    rows.push({ label: c.label, detail: `${n} ${n === 1 ? 'comandă' : 'comenzi'} din ${c.limit}`,
      ok: c.has(v) && n <= c.limit,
      note: !c.has(v) ? `${v.name} nu are acest element, comenzile sunt ignorate.`
        : n > c.limit ? `Peste limita Tesla: mașina execută doar primele ${c.limit}.` : '' });
  }
  const na = cfg.region === 'na';
  const lightNotes = [
    [28, 'Ceață spate', (!na || v.rearFogNA), 'Doar pe mașinile din afara Americii de Nord și pe Model X.'],
    [18, 'Lumini de poziție laterale', na || v.family === 'ct', 'Există doar pe mașinile din America de Nord.'],
    [22, 'Semnalizări spate', v.family !== 'ct', 'Dezactivate pe Cybertruck.'],
    [4, 'Semnătură', v.family !== 'ct', 'Cybertruck nu are acest canal.'],
  ];
  for (const [c, label, ok, note] of lightNotes) if (c < seq.ch && used(c)) rows.push({ label, detail: 'folosit în show', ok, note: ok ? '' : note });
  if (v.family === 'ct' && seq.ch < 194) rows.push({ label: 'Light bar Cybertruck', detail: 'show cu 48 de canale', ok: false, note: 'Light bar-urile au nevoie de un show cu 200 de canale.' });
  return rows;
}
