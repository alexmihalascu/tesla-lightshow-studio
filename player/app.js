import { VEHICLES, REGIONS, HEADLIGHTS, closureState, createEmulator, compatibility } from './emulator.js';
import { createScene2D } from './scene2d.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const audio = $('#audio');
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stocare indisponibilă: setarea rămâne doar în sesiune */ } },
};
const ELEMENTS = {
  max: { name: 'Tot ce se mișcă', hint: 'Lumini, oglinzi, geamuri, trapă și ce mai are modelul ales' },
  lights: { name: 'Lumini, oglinzi și trapă', hint: 'Fără geamuri și portbagaj' },
};
const cfg = {
  vehicle: store.get('vehicle', 'm3'), region: store.get('region', 'eu'),
  headlights: store.get('headlights', 'reflector'), elements: store.get('elements', 'max'),
};
if (!VEHICLES[cfg.vehicle]) cfg.vehicle = 'm3';
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Stare ----------
let library = { local: [], usb: [] }, current = null, seq = null, objectUrl = null;
let emu = createEmulator(cfg), scene2d = null, scene3d = null, view = store.get('view', '2d'), layout = null;
let snapNext = true, last = performance.now();

// ---------- Meniuri (popover) ----------
const MENUS = {
  vehicle: () => ({ search: true, items: Object.entries(VEHICLES).map(([k, v], i) => ({ k, title: v.name, hint: v.hint, kbd: `Ctrl+${i + 1}` })), value: cfg.vehicle, set: k => setCfg('vehicle', k) }),
  region: () => ({ items: Object.entries(REGIONS).map(([k, v]) => ({ k, title: v.name, hint: v.hint })), value: cfg.region, set: k => setCfg('region', k) }),
  headlights: () => ({ items: Object.entries(HEADLIGHTS).map(([k, v]) => ({ k, title: v.name, hint: v.hint })), value: cfg.headlights, set: k => setCfg('headlights', k) }),
  elements: () => ({ items: Object.entries(ELEMENTS).map(([k, v]) => ({ k, title: v.name, hint: v.hint })), value: cfg.elements, set: k => setCfg('elements', k) }),
};
const menu = $('#menu');
let menuOwner = null;
function openMenu(btn) {
  const def = MENUS[btn.dataset.menu]();
  menuOwner = btn;
  btn.setAttribute('aria-expanded', 'true');
  const draw = (q = '') => {
    const items = def.items.filter(i => !q || i.title.toLowerCase().includes(q.toLowerCase()));
    menu.querySelector('.menu-list').innerHTML = items.map(i => `
      <button class="menu-item" role="menuitemradio" aria-checked="${i.k === def.value}" data-k="${i.k}">
        <strong>${esc(i.title)}</strong>${i.hint ? `<small>${esc(i.hint)}</small>` : ''}
        <span class="kbd">${i.kbd ? `<kbd>${i.kbd}</kbd>` : ''}${i.k === def.value ? '<svg class="check" viewBox="0 0 20 20"><path d="m5 10 3 3 7-7"/></svg>' : ''}</span>
      </button>`).join('') || '<p class="empty-note">Nimic găsit</p>';
  };
  menu.innerHTML = `${def.search ? '<label class="menu-search"><svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="5.5"/><path d="m13 13 4 4"/></svg><input placeholder="Caută modele…" aria-label="Caută modele"></label>' : ''}<div class="menu-list"></div>`;
  draw();
  menu.hidden = false;
  const r = btn.getBoundingClientRect(), mh = menu.offsetHeight;
  const below = r.bottom + 6 + mh < innerHeight;
  menu.style.left = `${Math.min(r.left, innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - mh - 6)}px`;
  const input = menu.querySelector('input');
  if (input) { input.focus(); input.addEventListener('input', () => draw(input.value)); }
  else menu.querySelector('.menu-item')?.focus();
  menu.onclick = e => { const it = e.target.closest('.menu-item'); if (it) { def.set(it.dataset.k); closeMenu(); } };
}
function closeMenu() {
  if (menu.hidden) return;
  menu.hidden = true;
  menuOwner?.setAttribute('aria-expanded', 'false');
  menuOwner?.focus();
  menuOwner = null;
}
document.addEventListener('click', e => {
  const chip = e.target.closest('[data-menu]');
  if (chip) { e.stopPropagation(); menu.hidden || menuOwner !== chip ? openMenu(chip) : closeMenu(); return; }
  if (!e.target.closest('#menu')) closeMenu();
});
menu.addEventListener('keydown', e => {
  const items = [...menu.querySelectorAll('.menu-item')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0])?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1])?.focus(); }
  if (e.key === 'Escape') closeMenu();
});

function labelChips() {
  for (const c of $$('[data-menu]')) {
    const k = c.dataset.menu;
    const src = { vehicle: VEHICLES, region: REGIONS, headlights: HEADLIGHTS, elements: ELEMENTS }[k];
    c.querySelector('.chip-label').textContent = src[cfg[k]].name;
  }
  for (const [id, src, k] of [['#setVehicle', VEHICLES, 'vehicle'], ['#setRegion', REGIONS, 'region'], ['#setHeadlights', HEADLIGHTS, 'headlights']]) {
    $(id).innerHTML = Object.entries(src).map(([v, o]) => `<option value="${v}" ${v === cfg[k] ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  }
}
function setCfg(k, v) {
  cfg[k] = v;
  store.set(k, v);
  labelChips();
  if (k === 'elements') return;
  emu = createEmulator(cfg);
  snapNext = true;
  mountViews();
  renderCompat();
}
for (const [id, k] of [['#setVehicle', 'vehicle'], ['#setRegion', 'region'], ['#setHeadlights', 'headlights']]) {
  $(id).addEventListener('change', e => setCfg(k, e.target.value));
}

// ---------- Vizualizări ----------
function mountViews() {
  scene2d = createScene2D($('#view2d'), cfg.vehicle);
  if (has3d() && seq) mount3d();
}
async function mount3d() {
  scene3d?.dispose();
  scene3d = null;
  const box = $('#view3d');
  box.innerHTML = '<p class="view-msg">Se încarcă modelul 3D oficial Tesla…</p>';
  try {
    if (!layout) {
      const r = await fetch('/api/layout');
      if (!r.ok) throw new Error((await r.json()).error);
      layout = await r.json();
    }
    const { createScene3D } = await import('./scene3d.js');
    const key = cfg.vehicle;
    const s = await createScene3D(box, layout, key);
    if (key !== cfg.vehicle || !has3d()) { s.dispose(); return; }
    box.querySelector('.view-msg')?.remove();
    const note = document.createElement('p');
    note.className = 'view-note';
    note.textContent = key === 'ct' ? 'Cybertruck oficial Tesla. Mișcările apar ca indicatori galbeni.'
      : key === 'ms' ? 'Model S oficial Tesla'
      : `Model S oficial Tesla, cu emulatorul pentru ${VEHICLES[key].name}`;
    const bar = document.createElement('div');
    bar.className = 'cam-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Unghi cameră');
    const presets = [['orbit', 'Orbită'], ['three', '3/4'], ['front', 'Față'], ['side', 'Lateral'], ['rear', 'Spate'], ['top', 'Sus']];
    const cam = presenting ? 'orbit' : store.get('camera', 'three');
    bar.innerHTML = presets.map(([k, l]) => `<button data-cam="${k}" aria-pressed="${k === cam}">${l}</button>`).join('');
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-cam]');
      if (!b) return;
      s.setPreset(b.dataset.cam);
      store.set('camera', b.dataset.cam);
      bar.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    box.append(note, bar);
    s.setPreset(cam, true);
    scene3d = s;
  } catch (err) {
    box.innerHTML = `<p class="view-msg">Modelul 3D nu s-a putut încărca: ${esc(err.message)}<br>Dezarhivează tesla_xlights_show_folder.zip din repo-ul teslamotors/light-show în Downloads.</p>`;
  }
}
const has3d = () => view === '3d' || view === 'split';
function setView(v) {
  view = v;
  store.set('view', v);
  for (const b of $$('.seg-btn[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
  $('#views').hidden = !seq;
  $('.top-actions .seg').hidden = !current;
  $('#compatBtn').hidden = !current;
  $('#views').classList.toggle('split', v === 'split');
  $('#view2d').hidden = v === '3d';
  $('#view3d').hidden = v === '2d';
  if (has3d() && seq && !scene3d) mount3d();
  if (!has3d() && scene3d) { scene3d.dispose(); scene3d = null; }
}
$$('.seg-btn[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ---------- Timeline ----------
const ROWS = [
  ['Faruri', [0, 1, 2, 3], '#f5f5f5'],
  ['Semnătură', [4, 5, 6, 7, 8, 9, 10, 11], '#b9c7dc'],
  ['Semnalizări', [12, 13, 20, 21, 22, 23], '#ffa628'],
  ['Ceață, poziție', [14, 15, 16, 17, 18, 19, 28], '#d0d0d0'],
  ['Frână', [24], '#ff5a4f'],
  ['Stopuri', [25, 26], '#b23a33'],
  ['Marșarier, număr', [27, 29], '#d0d0d0'],
  ['Light bar', Array.from({ length: 120 }, (_, i) => 46 + i), '#f5f5f5'],
  ['Oglinzi', [34, 35], '#3b82f6', true],
  ['Geamuri', [36, 37, 38, 39], '#3b82f6', true],
  ['Portbagaj', [40], '#3b82f6', true],
  ['Uși, mânere', [30, 31, 32, 33, 41, 42, 43, 44], '#3b82f6', true],
  ['Trapă', [45], '#3b82f6', true],
];
const ROW_H = 11;
let rows = ROWS;
function drawTimeline() {
  rows = seq ? ROWS.filter(([label, chs]) => chs[0] < seq.ch && (label !== 'Light bar' || seq.ch >= 194)) : ROWS;
  $('#labels').innerHTML = rows.map(r => `<span style="height:${ROW_H}px">${r[0]}</span>`).join('');
  $('#track').style.height = rows.length * ROW_H + 'px';
  const cv = $('#tl'), dpr = devicePixelRatio || 1, w = cv.clientWidth, h = rows.length * ROW_H;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  if (!seq || !w) return;
  const at = (f, c) => seq.data[seq.off + f * seq.ch + c];
  rows.forEach(([, chs, color, isClosure], r) => {
    g.fillStyle = color;
    for (let x = 0; x < w; x++) {
      const f0 = Math.floor(x / w * seq.frames), f1 = Math.max(f0 + 1, Math.floor((x + 1) / w * seq.frames));
      let on = 0;
      for (let f = f0; f < f1; f++) {
        for (const c of chs) {
          if (c >= seq.ch) break;
          const v = at(f, c), s = closureState(v);
          if (isClosure ? s >= 1 && s <= 3 : v > 127) { on++; break; }
        }
      }
      if (on) { g.globalAlpha = 0.3 + 0.7 * on / (f1 - f0); g.fillRect(x, r * ROW_H + 2, 1, ROW_H - 4); }
    }
  });
  g.globalAlpha = 1;
}
addEventListener('resize', drawTimeline);
let dragging = false;
const seek = e => {
  if (!seq) return;
  const r = $('#track').getBoundingClientRect();
  audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * seq.frames * seq.step / 1000;
};
$('#track').addEventListener('pointerdown', e => { dragging = true; $('#track').setPointerCapture(e.pointerId); seek(e); });
$('#track').addEventListener('pointermove', e => dragging && seek(e));
$('#track').addEventListener('pointerup', () => { dragging = false; });

// ---------- Redare ----------
const frameView = i => seq.data.subarray(seq.off + i * seq.ch, seq.off + (i + 1) * seq.ch);
const frameAt = t => Math.min(seq.frames - 1, Math.max(0, Math.floor(t * 1000 / seq.step)));
audio.addEventListener('seeked', () => { snapNext = true; });
audio.addEventListener('play', () => $('#playIcon').setAttribute('d', 'M6 4h3v12H6zM11 4h3v12h-3z'));
audio.addEventListener('pause', () => $('#playIcon').setAttribute('d', 'M6 4 16 10 6 16Z'));
$('#play').addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && /^[1-6]$/.test(e.key)) {
    e.preventDefault();
    setCfg('vehicle', Object.keys(VEHICLES)[+e.key - 1]);
    return;
  }
  if (!seq || e.target.closest('input, select, dialog, .menu')) return;
  if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
  if (e.code === 'ArrowRight') audio.currentTime += 5;
  if (e.code === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
});
(function loop(now) {
  if (seq) {
    const t = audio.currentTime, total = seq.frames * seq.step / 1000, f = frameAt(t);
    const history = cb => { for (let i = 0; i <= f; i++) cb(frameView(i)); };
    history.step = seq.step;
    const out = emu.step(frameView(f), Math.min(100, now - last), snapNext, history);
    snapNext = false;
    if (view !== '3d') scene2d?.render(out, t);
    if (has3d()) scene3d?.render(out, t);
    $('#time').textContent = `${fmt(t)} / ${fmt(total)}`;
    $('#playhead').style.left = `${Math.min(100, t / total * 100)}%`;
  }
  last = now;
  requestAnimationFrame(loop);
})(performance.now());

// ---------- Bibliotecă ----------
const partsOf = s => [s.mirrors && 'oglinzi', s.windows && 'geamuri', s.liftgate && 'portbagaj', s.chargePort && 'trapă'].filter(Boolean);
const metaOf = s => s.lights == null ? 'show comprimat' : [`${s.lights} lumini`, ...partsOf(s)].join(', ');
let lastLibrary = '';
async function refresh() {
  const text = await (await fetch('/api/shows')).text();
  if (text === lastLibrary) return; // nimic nou (verificat periodic pentru stick)
  lastLibrary = text;
  library = JSON.parse(text);
  renderLibrary();
}
function renderLibrary() {
  const q = $('#search').value.trim().toLowerCase();
  const onUsb = new Map(library.usb.map(s => [s.name, s.size]));
  const item = s => {
    const active = current && current.name === s.name && current.source === s.source;
    const playing = active && !audio.paused;
    const synced = s.source === 'local' && onUsb.get(s.name) === s.size;
    return `<li><button class="item${active ? ' active' : ''}" data-source="${s.source}" data-name="${esc(s.name)}">
      <span class="meta"><span>${esc(metaOf(s))}</span>${fmt(s.duration)}</span>
      <span class="title"><span>${esc(s.name)}</span>${playing ? '<i class="spark" aria-label="se redă">✺</i>' : synced
        ? '<svg viewBox="0 0 20 20" aria-label="e și pe stick"><title>E și pe stick</title><rect x="6" y="2.5" width="8" height="6" rx="1"/><rect x="4" y="8.5" width="12" height="9" rx="2"/></svg>' : ''}</span>
    </button></li>`;
  };
  const filt = list => list.filter(s => !q || s.name.toLowerCase().includes(q));
  const local = filt(library.local), usb = filt(library.usb);
  $('#local').innerHTML = local.map(item).join('') || `<p class="empty-note">${q ? 'Nimic găsit' : 'Niciun show încă'}</p>`;
  $('#localCount').textContent = library.local.length || '';
  $('#usbTitle').textContent = library.usbDrive ? `Pe stick ${library.usbDrive}` : 'Pe stick';
  $('#usbCount').textContent = library.usb.length || '';
  $('#usb').innerHTML = library.usbDrive ? (usb.map(item).join('') || `<p class="empty-note">${q ? 'Nimic găsit' : 'Stickul nu are show-uri'}</p>`)
    : '<p class="empty-note">Stickul nu e conectat</p>';
  if (!current) renderGrid(onUsb);
  $('#teslaCamNotice').hidden = !library.usbHasTeslaCam;
  $('#teslaCamRow').hidden = !library.usbHasTeslaCam;
  $('#usbInfo').textContent = library.usbDrive ? `${library.usbDrive}, ${library.usb.length} show-uri în LightShow` : 'Niciun stick Tesla conectat.';
  const showCopy = current?.source === 'local';
  $('#copyBtn').hidden = !showCopy;
  if (showCopy) {
    const s = library.local.find(x => x.name === current.name);
    const synced = s && onUsb.get(s.name) === s.size;
    $('#copyBtn').disabled = synced || !library.usbDrive;
    $('#copyBtn span').textContent = synced ? 'E pe stick' : 'Copiază pe stick';
  }
}
const ICON_USB = '<svg viewBox="0 0 20 20"><rect x="6" y="2.5" width="8" height="6" rx="1"/><rect x="4" y="8.5" width="12" height="9" rx="2"/></svg>';
const ICON_PC = '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="10" rx="1.5"/><path d="M7 17h6M10 14v3"/></svg>';
function setCrumbs() {
  $('#crumbs').innerHTML = current
    ? `<button class="crumb-link" id="homeCrumb">Proiecte</button><span class="sep">/</span>
       <span class="crumb-muted">${current.source === 'usb' ? `${ICON_USB}Pe stick ${esc(library.usbDrive || '')}` : `${ICON_PC}Pe calculator`}</span>
       <span class="sep">/</span><strong>${esc(current.name)}</strong>`
    : '<strong>Proiecte</strong>';
  $('#homeCrumb')?.addEventListener('click', showEmpty);
}

// Cardurile de proiect: amprenta de activitate desenată din datele serverului
let gridFilter = 'all';
function renderGrid(onUsb) {
  const q = $('#search').value.trim().toLowerCase();
  const list = [...(gridFilter !== 'usb' ? library.local : []), ...(gridFilter !== 'local' ? library.usb : [])]
    .filter(s => !q || s.name.toLowerCase().includes(q));
  $('#grid').innerHTML = list.map((s, i) => `
    <button class="card-p" data-source="${s.source}" data-name="${esc(s.name)}" data-i="${i}">
      <span class="meta">${s.source === 'usb' ? `${ICON_USB}Pe stick` : `${ICON_PC}Pe calculator${onUsb.get(s.name) === s.size ? ', și pe stick' : ''}`}<span class="dur">${fmt(s.duration)}</span></span>
      <span class="name">${esc(s.name)}</span>
      <canvas width="500" height="92" aria-hidden="true"></canvas>
      <span class="tags">${s.lights != null ? `<span>${s.lights} lumini</span>` : '<span>comprimat</span>'}${partsOf(s).map(p => `<span>${p}</span>`).join('')}</span>
      <span class="play-fab" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M6 4 16 10 6 16Z" class="fill"/></svg></span>
    </button>`).join('') || `<p class="empty-note">${q ? 'Niciun proiect găsit' : 'Niciun proiect încă. Trage o melodie mai sus.'}</p>`;
  $$('#grid .card-p').forEach(card => drawActivity(card.querySelector('canvas'), list[+card.dataset.i]));
}
function drawActivity(cv, s) {
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  if (!s?.activity) return;
  const n = s.activity.length, w = cv.width / n;
  s.activity.forEach((a, i) => {
    const h = Math.max(3, a * 70);
    g.fillStyle = `rgba(245,245,245,${0.25 + a * 0.75})`;
    g.fillRect(i * w + 1, 78 - h, w - 2, h);
    if (s.moving[i]) { g.fillStyle = '#3b82f6'; g.fillRect(i * w + 1, 84, w - 2, 5); }
  });
}
$('#grid').addEventListener('click', e => {
  const c = e.target.closest('.card-p');
  if (c) openShow(c.dataset.source, c.dataset.name);
});

// Preview pe card: la hover, o mașină mică (față + spate) rulează cele mai intense ~10 s din show, fără sunet
const previewCache = new Map();
let preview = null;
function drawMini(g, o, W, H, t) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#030303';
  g.fillRect(0, 0, W, H);
  const lamp = (v, color, draw) => {
    if (v <= 0.02) return;
    g.save();
    g.globalAlpha = v;
    g.fillStyle = g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 14;
    draw();
    g.restore();
  };
  const body = cx => {
    g.fillStyle = '#25282c';
    g.beginPath();
    g.roundRect(cx - 95, 34, 190, 40, 16);
    g.fill();
    g.fillStyle = '#121418';
    g.beginPath();
    g.moveTo(cx - 62, 36); g.quadraticCurveTo(cx, 6, cx + 62, 36); g.fill();
  };
  const W1 = W * 0.27, W2 = W * 0.73;
  body(W1); body(W2);
  // Față: partea stângă a imaginii = dreapta mașinii
  for (const [side, dx] of [['R', -1], ['L', 1]]) {
    const x = W1 + dx * 58;
    lamp(Math.max(o[`outer${side}`], o[`inner${side}`]), '#f4f8ff', () => { g.beginPath(); g.ellipse(x, 50, 16, 5, 0, 0, 7); g.fill(); });
    lamp(Math.max(o[`sig${side}`], o[`c4${side}`]), '#dfe9ff', () => { g.fillRect(x - 20, 42, 40, 2.5); });
    lamp(o[`fturn${side}`], '#ffa628', () => { g.fillRect(x + dx * 18, 44, 7, 4); });
    lamp(o[`fog${side}`], '#f4f8ff', () => { g.beginPath(); g.ellipse(x + dx * 8, 66, 6, 2.5, 0, 0, 7); g.fill(); });
  }
  // Spate: stânga imaginii = stânga mașinii
  for (const [side, dx] of [['L', -1], ['R', 1]]) {
    const x = W2 + dx * 56;
    lamp(o[`tail${side}`] * 0.5, '#ff2b2b', () => { g.fillRect(x - 26, 44, 52, 6); });
    lamp(o.brake, '#ff2b2b', () => { g.fillRect(x - 26, 44, 52, 6); });
    lamp(o[`rturn${side}`], '#ffa628', () => { g.fillRect(x + dx * 18, 44, 10, 6); });
    lamp(o[`reverse${side}`], '#f4f8ff', () => { g.fillRect(x - dx * 18, 52, 10, 3); });
  }
  lamp(o.brake, '#ff2b2b', () => { g.fillRect(W2 - 14, 14, 28, 2.5); });
  lamp(o.plate * 0.8, '#f4f8ff', () => { g.fillRect(W2 - 18, 58, 36, 10); });
  // Indicator pentru elementele care se mișcă
  const moving = Object.values(o.closures).some(c => c.dance || (c.pos > 0.02 && c.pos < 0.98));
  if (moving) { g.fillStyle = '#3b82f6'; g.beginPath(); g.arc(W - 12, 12, 4 + Math.sin(t * 8), 0, 7); g.fill(); }
}
async function startPreview(card) {
  stopPreview();
  const s = library[card.dataset.source]?.find(x => x.name === card.dataset.name);
  if (!s || s.compressed) return;
  const key = `${s.source}/${s.name}/${s.size}`;
  const token = {};
  preview = { card, token };
  let pseq = previewCache.get(key);
  if (!pseq) {
    try {
      pseq = parseFseq(await (await fetch(`/files/${s.source}/${encodeURIComponent(s.name)}.fseq`)).arrayBuffer());
      previewCache.set(key, pseq);
    } catch { return; }
  }
  if (preview?.token !== token) return;
  const peak = s.activity ? s.activity.indexOf(Math.max(...s.activity)) : 0;
  const start = Math.max(0, Math.floor(peak / 96 * pseq.frames) - 100);
  const span = Math.min(pseq.frames - start, Math.round(10000 / pseq.step));
  const pemu = createEmulator(cfg), cv = card.querySelector('canvas'), g = cv.getContext('2d');
  const t0 = performance.now();
  let prev = t0, lastF = -1;
  const frameOf = f => pseq.data.subarray(pseq.off + f * pseq.ch, pseq.off + (f + 1) * pseq.ch);
  (function tick(now) {
    if (preview?.token !== token) return;
    const f = start + Math.floor((now - t0) / pseq.step) % span;
    const out = pemu.step(frameOf(f), Math.min(100, now - prev), f < lastF || lastF < 0, null);
    lastF = f; prev = now;
    drawMini(g, out, cv.width, cv.height, now / 1000);
    requestAnimationFrame(tick);
  })(t0);
}
function stopPreview() {
  if (!preview) return;
  const card = preview.card;
  preview = null;
  drawActivity(card.querySelector('canvas'), library[card.dataset.source]?.find(x => x.name === card.dataset.name));
}
$('#grid').addEventListener('pointerover', e => {
  const c = e.target.closest('.card-p');
  if (c && preview?.card !== c) startPreview(c);
});
$('#grid').addEventListener('pointerleave', stopPreview);
$('#grid').addEventListener('focusin', e => { const c = e.target.closest('.card-p'); if (c) startPreview(c); });
$$('[data-filter]').forEach(b => b.addEventListener('click', () => {
  gridFilter = b.dataset.filter;
  $$('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  renderLibrary();
}));
$('#search').addEventListener('input', renderLibrary);
$$('.group-head').forEach(h => h.addEventListener('click', () => h.setAttribute('aria-expanded', String(h.getAttribute('aria-expanded') !== 'true'))));
$('.groups').addEventListener('click', e => {
  const it = e.target.closest('.item');
  if (it) openShow(it.dataset.source, it.dataset.name);
});
$('#teslaCamNotice').addEventListener('click', () => openSettings('usb'));
audio.addEventListener('play', renderLibrary);
audio.addEventListener('pause', renderLibrary);

function parseFseq(buf) {
  const b = new Uint8Array(buf), dv = new DataView(buf);
  if (String.fromCharCode(...b.slice(0, 4)) !== 'PSEQ') throw new Error('Fișierul .fseq nu e valid.');
  if (b[20] & 0x0f) throw new Error('Show-ul e comprimat. Exportă-l din xLights ca FSEQ v2 necomprimat.');
  return { data: b, off: dv.getUint16(4, true), ch: dv.getUint32(10, true), frames: dv.getUint32(14, true), step: b[18] };
}

async function openShow(source, name, autoplay = true) {
  const s = library[source].find(x => x.name === name);
  if (!s) return;
  stopPreview();
  audio.pause();
  current = { source, name };
  setCrumbs();
  renderLibrary();
  $('#empty').hidden = true;
  $('#dock').hidden = false;
  $('#time').textContent = 'Se încarcă…';
  try {
    const base = `/files/${source}/${encodeURIComponent(name)}`;
    const [buf, blob] = await Promise.all([
      fetch(base + '.fseq').then(r => { if (!r.ok) throw new Error('Nu pot citi fișierul .fseq.'); return r.arrayBuffer(); }),
      fetch(base + s.audio).then(r => { if (!r.ok) throw new Error('Nu pot citi melodia.'); return r.blob(); }),
    ]);
    const parsed = parseFseq(buf);
    if (current?.name !== name || current?.source !== source) return;
    seq = parsed;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    // Pornește singur; dacă browserul blochează redarea automată, rămâne butonul Play
    if (autoplay) audio.play().catch(() => {});
    snapNext = true;
    emu = createEmulator(cfg);
    setView(view);
    if (!scene2d) mountViews();
    drawTimeline();
    renderCompat();
  } catch (err) {
    seq = null;
    setView(view);
    $('#time').textContent = err.message;
  }
}

function showEmpty() {
  audio.pause();
  current = null;
  seq = null;
  setCrumbs();
  $('#empty').hidden = false;
  $('#dock').hidden = true;
  setView(view);
  renderLibrary();
  renderCompat();
}
['#newBtn', '#newBtn2'].forEach(id => $(id).addEventListener('click', () => { showEmpty(); $('#pickBtn')?.focus(); }));

// ---------- Compatibilitate ----------
function renderCompat() {
  const v = VEHICLES[cfg.vehicle];
  $('#compatTitle').textContent = `Pe ${v.name}`;
  if (!seq) { $('#compatSub').textContent = 'Alege un show ca să vezi ce face pe mașina ta.'; $('#compatList').innerHTML = ''; return; }
  const rows = compatibility(seq, cfg);
  const bad = rows.filter(r => !r.ok).length;
  $('#compatSub').textContent = `${REGIONS[cfg.region].name}, ${HEADLIGHTS[cfg.headlights].name.toLowerCase()}. ${bad ? `${bad} ${bad === 1 ? 'element nu se vede' : 'elemente nu se văd'} pe mașina ta.` : 'Tot show-ul se vede pe mașina ta.'}`;
  $('#compatList').innerHTML = rows.map(r => `<li class="${r.ok ? '' : 'bad'}"><span class="dot"></span><strong>${esc(r.label)}</strong><small>${esc(r.detail)}${r.note ? `. ${esc(r.note)}` : ''}</small></li>`).join('')
    || '<li><span class="dot"></span><strong>Doar lumini</strong><small>Show-ul nu folosește elemente mobile.</small></li>';
}
$('#compatBtn').addEventListener('click', () => {
  const open = $('#inspector').hidden;
  $('#inspector').hidden = !open;
  $('#compatBtn').setAttribute('aria-pressed', String(open));
  store.set('inspector', open ? '1' : '0');
  requestAnimationFrame(drawTimeline);
});

// ---------- Show nou ----------
const song = $('#song');
let picked = null;
function setPicked(file) {
  picked = file;
  const drop = $('#dropText');
  if (!file) {
    drop.innerHTML = 'Trage melodia aici sau <button type="button" class="link" id="pickBtn">alege fișierul</button>';
    $('#showName').hidden = true;
  } else {
    drop.innerHTML = `<span class="file-chip"><span>${esc(file.name)}</span><button type="button" id="clearFile" aria-label="Scoate fișierul"><svg viewBox="0 0 20 20"><path d="m6 6 8 8M14 6l-8 8"/></svg></button></span>`;
    const name = $('#showName');
    name.hidden = false;
    if (!name.value) name.value = file.name.replace(/\.[^.]+$/, '').replace(/[^\w\- ăâîșțĂÂÎȘȚ]/g, '').trim().slice(0, 60);
    name.focus();
  }
  $('#genBtn').disabled = !file;
}
$('#drop').addEventListener('click', e => {
  if (e.target.closest('#pickBtn')) song.click();
  if (e.target.closest('#clearFile')) { $('#showName').value = ''; setPicked(null); }
});
song.addEventListener('change', () => setPicked(song.files[0] || null));
for (const t of ['dragenter', 'dragover']) $('#drop').addEventListener(t, e => { e.preventDefault(); $('#drop').classList.add('over'); });
for (const t of ['dragleave', 'drop']) $('#drop').addEventListener(t, e => { e.preventDefault(); $('#drop').classList.remove('over'); });
$('#drop').addEventListener('drop', e => {
  const f = [...e.dataTransfer.files].find(x => /\.(mp3|wav)$/i.test(x.name));
  if (f) setPicked(f);
  else { $('#genStatus').textContent = 'Trage un fișier .mp3 sau .wav.'; $('#genStatus').classList.add('err'); }
});
$('#newForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#showName').value.trim(), st = $('#genStatus');
  st.classList.remove('err');
  if (!picked) return;
  if (!/^[\w\- ăâîșțĂÂÎȘȚ]{1,60}$/.test(name)) { st.textContent = 'Numele poate avea doar litere, cifre, spații și cratime.'; st.classList.add('err'); return; }
  st.textContent = `Analizez melodia și generez show-ul pentru ${VEHICLES[cfg.vehicle].name}. Durează de obicei sub un minut.`;
  $('#genBtn').disabled = true;
  try {
    const r = await fetch('/api/generate', {
      method: 'POST', body: picked,
      headers: { 'X-Name': encodeURIComponent(name), 'X-Filename': encodeURIComponent(picked.name),
        'X-Max': cfg.elements === 'max' ? '1' : '0', 'X-Model': cfg.vehicle === 'm3old' ? 'm3' : cfg.vehicle },
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    st.textContent = '';
    $('#showName').value = '';
    setPicked(null);
    await refresh();
    openShow('local', j.name);
  } catch (err) {
    st.textContent = err.message;
    st.classList.add('err');
  } finally {
    $('#genBtn').disabled = !picked;
  }
});

// ---------- Copiere pe stick ----------
$('#copyBtn').addEventListener('click', async () => {
  const btn = $('#copyBtn');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Se copiază…';
  const r = await fetch('/api/copy-to-usb', { method: 'POST', body: JSON.stringify({ name: current.name }) });
  const j = await r.json();
  if (!r.ok) { btn.querySelector('span').textContent = j.error; setTimeout(renderLibrary, 3500); return; }
  await refresh();
});

// ---------- Mod prezentare ----------
let presenting = false, viewBefore = view, presentList = [], presentIdx = 0;
function playPresent() {
  const s = presentList[presentIdx % presentList.length];
  $('#presentName').textContent = s.name;
  $('#presentSub').textContent = `${VEHICLES[cfg.vehicle].name}, ${presentIdx % presentList.length + 1} din ${presentList.length}. Esc pentru ieșire`;
  openShow(s.source, s.name, true);
}
function startPresentation() {
  // Show-urile de pe calculator, apoi cele doar de pe stick
  const local = new Set(library.local.map(s => s.name));
  presentList = [...library.local, ...library.usb.filter(s => !local.has(s.name))].filter(s => !s.compressed);
  if (!presentList.length) return;
  presenting = true;
  viewBefore = view;
  presentIdx = current ? Math.max(0, presentList.findIndex(s => s.name === current.name)) : 0;
  $('#app').classList.add('present');
  document.documentElement.requestFullscreen?.().catch(() => {});
  setView('3d');
  scene3d?.setPreset('orbit');
  playPresent();
}
function stopPresentation() {
  if (!presenting) return;
  presenting = false;
  $('#app').classList.remove('present');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setView(viewBefore);
}
$('#presentBtn').addEventListener('click', startPresentation);
audio.addEventListener('ended', () => { if (presenting) { presentIdx++; playPresent(); } });
audio.addEventListener('timeupdate', () => {
  if (presenting && audio.duration) $('#presentBar').style.width = `${audio.currentTime / audio.duration * 100}%`;
});
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) stopPresentation(); });
addEventListener('keydown', e => { if (e.key === 'Escape') stopPresentation(); });

// ---------- Setări + bara laterală ----------
const dlg = $('#settings');
function openSettings(pane = 'car') {
  for (const b of $$('.nav-item[data-pane]')) b.classList.toggle('active', b.dataset.pane === pane);
  for (const p of $$('.pane')) p.hidden = p.dataset.pane !== pane;
  $('#paneTitle').textContent = pane === 'usb' ? 'Stick USB' : 'Mașină';
  if (!dlg.open) dlg.showModal();
}
$('#settingsBtn').addEventListener('click', () => openSettings());
$('#closeSettings').addEventListener('click', () => dlg.close());
$$('.nav-item[data-pane]').forEach(b => b.addEventListener('click', () => openSettings(b.dataset.pane)));
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
const setCollapsed = c => { $('#app').classList.toggle('collapsed', c); store.set('collapsed', c ? '1' : '0'); requestAnimationFrame(drawTimeline); };
$('#collapseBtn').addEventListener('click', () => setCollapsed(true));
$('#expandBtn').addEventListener('click', () => setCollapsed(false));

// ---------- Pornire ----------
labelChips();
setCrumbs();
setCollapsed(store.get('collapsed', '0') === '1');
if (store.get('inspector', '0') === '1') { $('#inspector').hidden = false; $('#compatBtn').setAttribute('aria-pressed', 'true'); }
mountViews();
setView(view);
refresh().catch(() => { $('#emptySub').textContent = 'Serverul Studio nu răspunde. Pornește-l cu python studio.py.'; });
setInterval(() => refresh().catch(() => {}), 5000); // stickul poate fi conectat oricând
