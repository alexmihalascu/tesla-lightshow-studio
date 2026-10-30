import { VEHICLES, REGIONS, HEADLIGHTS, closureState, createEmulator, compatibility } from './emulator.js';
import { createScene2D } from './scene2d.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const audio = $('#audio');
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable: the setting only lasts this session */ } },
};
const ELEMENTS = {
  max: { name: 'Everything that moves', hint: 'Lights, mirrors, windows, charge port and whatever else the model has' },
  lights: { name: 'Lights, mirrors and charge port', hint: 'No windows or liftgate' },
};
const cfg = {
  vehicle: store.get('vehicle', 'm3'), region: store.get('region', 'eu'),
  headlights: store.get('headlights', 'reflector'), elements: store.get('elements', 'max'),
  syncMs: +store.get('syncMs', '0') || 0,
};
if (!VEHICLES[cfg.vehicle]) cfg.vehicle = 'm3';
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- State ----------
let library = { local: [], usb: [] }, current = null, seq = null, objectUrl = null;
let emu = createEmulator(cfg), scene2d = null, scene3d = null, view = store.get('view', '2d'), layout = null;
let snapNext = true, last = performance.now();

// ---------- Menus (popover) ----------
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
      </button>`).join('') || '<p class="empty-note">Nothing found</p>';
  };
  menu.innerHTML = `${def.search ? '<label class="menu-search"><svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="5.5"/><path d="m13 13 4 4"/></svg><input placeholder="Search models…" aria-label="Search models"></label>' : ''}<div class="menu-list"></div>`;
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

// ---------- Views ----------
// One loaded car per vehicle, shared by the 3D view and the 2D views
let carCache = null;
async function getCar(key) {
  if (!layout) {
    const r = await fetch('/api/layout');
    if (!r.ok) throw new Error((await r.json()).error);
    layout = await r.json();
  }
  if (carCache?.key !== key) carCache = { key, p: import('./scene3d.js').then(m => m.loadCar(layout, key)) };
  return carCache.p;
}
function mountViews() {
  scene2d?.dispose?.();
  $('#view2d').classList.remove('gl');
  scene2d = createScene2D($('#view2d'), cfg.vehicle); // the drawing, until the real car is loaded
  if (view !== '3d' && seq) mount2d();
  if (has3d() && seq) mount3d();
}
// 2D from the real 3D model (side, front, rear, flat), when that model really is this car
let mount2dToken = 0;
async function mount2d() {
  const token = ++mount2dToken, key = cfg.vehicle;
  try {
    const [car, { createViews2D }] = await Promise.all([getCar(key), import('./scene3d.js')]);
    if (token !== mount2dToken || key !== cfg.vehicle || !car.exact) return;
    const box = $('#view2d');
    box.innerHTML = '';
    box.classList.add('gl');
    scene2d = createViews2D(box, car);
  } catch { /* keep the drawing */ }
}
async function mount3d() {
  scene3d?.dispose();
  scene3d = null;
  const box = $('#view3d');
  box.innerHTML = '<p class="view-msg">Loading the 3D model…</p>';
  try {
    const { createScene3D } = await import('./scene3d.js');
    const key = cfg.vehicle;
    const s = createScene3D(box, await getCar(key));
    if (key !== cfg.vehicle || !has3d()) { s.dispose(); return; }
    box.querySelector('.view-msg')?.remove();
    const note = document.createElement('p');
    note.className = 'view-note';
    note.textContent = !s.official ? `3D model: ${s.attribution || 'custom model'}`
      : key === 'ct' ? 'Official Tesla Cybertruck. Moving parts show as yellow markers.'
      : key === 'ms' ? 'Official Tesla Model S'
      : `Official Tesla Model S, emulating ${VEHICLES[key].name}`;
    const bar = document.createElement('div');
    bar.className = 'cam-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Camera angle');
    const presets = [['orbit', 'Orbit'], ['three', '3/4'], ['front', 'Front'], ['side', 'Side'], ['rear', 'Rear'], ['top', 'Top']];
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
    box.innerHTML = `<p class="view-msg">The 3D model couldn't load: ${esc(err.message)}<br>Unzip tesla_xlights_show_folder.zip from the teslamotors/light-show repo into Downloads.</p>`;
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
  if (v !== '3d' && seq && !$('#view2d').classList.contains('gl')) mount2d();
  if (!has3d() && scene3d) { scene3d.dispose(); scene3d = null; }
}
$$('.seg-btn[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ---------- Timeline ----------
const ROWS = [
  ['Headlights', [0, 1, 2, 3], '#f5f5f5'],
  ['Signature', [4, 5, 6, 7, 8, 9, 10, 11], '#b9c7dc'],
  ['Turn signals', [12, 13, 20, 21, 22, 23], '#ffa628'],
  ['Fog, park', [14, 15, 16, 17, 18, 19, 28], '#d0d0d0'],
  ['Brake', [24], '#ff5a4f'],
  ['Tail', [25, 26], '#b23a33'],
  ['Reverse, plate', [27, 29], '#d0d0d0'],
  ['Light bar', Array.from({ length: 120 }, (_, i) => 46 + i), '#f5f5f5'],
  ['Mirrors', [34, 35], '#3b82f6', true],
  ['Windows', [36, 37, 38, 39], '#3b82f6', true],
  ['Liftgate', [40], '#3b82f6', true],
  ['Doors, handles', [30, 31, 32, 33, 41, 42, 43, 44], '#3b82f6', true],
  ['Charge port', [45], '#3b82f6', true],
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

// ---------- Playback ----------
const frameView = i => seq.data.subarray(seq.off + i * seq.ch, seq.off + (i + 1) * seq.ch);
const frameAt = t => Math.min(seq.frames - 1, Math.max(0, Math.floor(t * 1000 / seq.step)));
audio.addEventListener('seeked', () => { snapNext = true; });
audio.addEventListener('play', () => $('#playIcon').setAttribute('d', 'M6 4h3v12H6zM11 4h3v12h-3z'));
audio.addEventListener('pause', () => $('#playIcon').setAttribute('d', 'M6 4 16 10 6 16Z'));
$('#play').addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && /^[1-7]$/.test(e.key)) {
    e.preventDefault();
    setCfg('vehicle', Object.keys(VEHICLES)[+e.key - 1]);
    return;
  }
  if (!seq || e.target.closest('input, select, dialog, .menu')) return;
  if (e.key === ',' || e.key === '.') { setSync(cfg.syncMs + (e.key === '.' ? 10 : -10)); return; }
  if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
  if (e.code === 'ArrowRight') audio.currentTime += 5;
  if (e.code === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
});
(function loop(now) {
  if (seq) {
    // syncMs > 0 = sound reaches you later than the browser reports (Bluetooth, external speakers)
    const t = Math.max(0, audio.currentTime - cfg.syncMs / 1000), total = seq.frames * seq.step / 1000, f = frameAt(t);
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

// ---------- Library ----------
const partsOf = s => [s.mirrors && 'mirrors', s.windows && 'windows', s.liftgate && 'liftgate', s.chargePort && 'charge port'].filter(Boolean);
const metaOf = s => s.lights == null ? 'compressed show' : [`${s.lights} lights`, ...partsOf(s)].join(', ');
let lastLibrary = '';
async function refresh() {
  const text = await (await fetch('/api/shows')).text();
  if (text === lastLibrary) return; // nothing new (polled for the USB drive)
  lastLibrary = text;
  library = JSON.parse(text);
  library.usb = library.drives.flatMap(d => d.shows);
  renderLibrary();
}
const showsOf = source => source === 'local' ? library.local : library.usb.filter(s => s.source === source);
const driveName = d => `${d.drive}:${d.label ? ` ${d.label}` : ''}`;
function renderLibrary() {
  const q = $('#search').value.trim().toLowerCase();
  // "synced" = already on the drive shows get copied to
  const onUsb = new Map(showsOf(library.target).map(s => [s.name, s.size]));
  const target = library.drives.find(d => d.drive === library.target);
  const item = s => {
    const active = current && current.name === s.name && current.source === s.source;
    const playing = active && !audio.paused;
    const synced = s.source === 'local' && onUsb.get(s.name) === s.size;
    return `<li><button class="item${active ? ' active' : ''}" data-source="${s.source}" data-name="${esc(s.name)}">
      <span class="meta"><span>${esc(metaOf(s))}</span>${fmt(s.duration)}</span>
      <span class="title"><span>${esc(s.name)}</span>${playing ? '<i class="spark" aria-label="playing">✺</i>' : synced
        ? '<svg viewBox="0 0 20 20" aria-label="also on the drive"><title>Also on the drive</title><rect x="6" y="2.5" width="8" height="6" rx="1"/><rect x="4" y="8.5" width="12" height="9" rx="2"/></svg>' : ''}</span>
    </button></li>`;
  };
  const filt = list => list.filter(s => !q || s.name.toLowerCase().includes(q));
  const local = filt(library.local);
  $('#local').innerHTML = local.map(item).join('') || `<p class="empty-note">${q ? 'Nothing found' : 'No shows yet'}</p>`;
  $('#localCount').textContent = library.local.length || '';
  // one group per USB drive; keep the collapsed state across refreshes
  const closed = new Set($$('#drives .group-head[aria-expanded="false"]').map(h => h.dataset.drive));
  $('#drives').innerHTML = library.drives.map(d => {
    const shows = filt(d.shows), isTarget = d.drive === library.target;
    // Tesla: the show drive must NOT have TeslaCam at its root, or shows won't be listed
    const warn = isTarget && d.teslaCam;
    return `<section class="group">
      <button class="group-head" data-drive="${d.drive}" aria-expanded="${!closed.has(d.drive)}"><span>${esc(driveName(d))}</span><span class="count">${d.shows.length || ''}</span><svg class="chev" viewBox="0 0 20 20"><path d="m6 8 4 4 4-4"/></svg></button>
      ${warn ? `<button class="notice" data-settings="usb"><svg viewBox="0 0 20 20"><path d="M10 3 18 17H2z"/><path d="M10 8v4M10 14.5v.5"/></svg><span>The drive has a TeslaCam folder. Tesla won't list your shows while it's there.</span></button>` : ''}
      <ul class="items">${shows.map(item).join('') || `<p class="empty-note">${q && d.shows.length ? 'Nothing found'
        : d.lightShow ? 'No shows on the drive' : isTarget ? 'Shows you copy go here' : 'No LightShow folder'}</p>`}</ul>
    </section>`;
  }).join('') || `<section class="group"><p class="empty-note">No USB drive connected</p></section>`;
  if (!current) renderGrid(onUsb);
  $('#teslaCamRow').hidden = !target?.teslaCam;
  $('#usbInfo').textContent = library.drives.length
    ? `${target ? `Shows are copied to ${driveName(target)}.` : 'No drive to copy shows to.'} Connected: ${library.drives.map(driveName).join(', ')}.`
    : 'No USB drive connected.';
  const showCopy = current?.source === 'local';
  $('#copyBtn').hidden = !showCopy;
  if (showCopy) {
    const s = library.local.find(x => x.name === current.name);
    const synced = s && onUsb.get(s.name) === s.size;
    $('#copyBtn').disabled = synced || !target;
    $('#copyBtn span').textContent = synced ? `On drive ${target.drive}:` : target ? `Copy to ${target.drive}:` : 'Copy to drive';
  }
}
const ICON_USB = '<svg viewBox="0 0 20 20"><rect x="6" y="2.5" width="8" height="6" rx="1"/><rect x="4" y="8.5" width="12" height="9" rx="2"/></svg>';
const ICON_PC = '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="10" rx="1.5"/><path d="M7 17h6M10 14v3"/></svg>';
function setCrumbs() {
  $('#crumbs').innerHTML = current
    ? `<button class="crumb-link" id="homeCrumb">Projects</button><span class="sep">/</span>
       <span class="crumb-muted">${current.source !== 'local' ? `${ICON_USB}On drive ${esc(current.source)}:` : `${ICON_PC}On computer`}</span>
       <span class="sep">/</span><strong>${esc(current.name)}</strong>`
    : '<strong>Projects</strong>';
  $('#homeCrumb')?.addEventListener('click', showEmpty);
}

// Project cards: activity fingerprint drawn from server data
let gridFilter = 'all';
function renderGrid(onUsb) {
  const q = $('#search').value.trim().toLowerCase();
  const list = [...(gridFilter !== 'usb' ? library.local : []), ...(gridFilter !== 'local' ? library.usb : [])]
    .filter(s => !q || s.name.toLowerCase().includes(q));
  $('#grid').innerHTML = list.map((s, i) => `
    <button class="card-p" data-source="${s.source}" data-name="${esc(s.name)}" data-i="${i}">
      <span class="meta">${s.source !== 'local' ? `${ICON_USB}On drive ${s.source}:` : `${ICON_PC}On computer${onUsb.get(s.name) === s.size ? ', also on drive' : ''}`}<span class="dur">${fmt(s.duration)}</span></span>
      <span class="name">${esc(s.name)}</span>
      <canvas width="500" height="92" aria-hidden="true"></canvas>
      <span class="tags">${s.lights != null ? `<span>${s.lights} lights</span>` : '<span>compressed</span>'}${partsOf(s).map(p => `<span>${p}</span>`).join('')}</span>
      <span class="play-fab" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M6 4 16 10 6 16Z" class="fill"/></svg></span>
    </button>`).join('') || `<p class="empty-note">${q ? 'No projects found' : 'No projects yet. Drop a song above.'}</p>`;
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

// Card preview: on hover, a small car (front + rear) plays the show's busiest ~10 s, muted
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
  // Front: left of the image = right side of the car
  for (const [side, dx] of [['R', -1], ['L', 1]]) {
    const x = W1 + dx * 58;
    lamp(Math.max(o[`outer${side}`], o[`inner${side}`]), '#f4f8ff', () => { g.beginPath(); g.ellipse(x, 50, 16, 5, 0, 0, 7); g.fill(); });
    lamp(Math.max(o[`sig${side}`], o[`c4${side}`]), '#dfe9ff', () => { g.fillRect(x - 20, 42, 40, 2.5); });
    lamp(o[`fturn${side}`], '#ffa628', () => { g.fillRect(x + dx * 18, 44, 7, 4); });
    lamp(o[`fog${side}`], '#f4f8ff', () => { g.beginPath(); g.ellipse(x + dx * 8, 66, 6, 2.5, 0, 0, 7); g.fill(); });
  }
  // Rear: left of the image = left side of the car
  for (const [side, dx] of [['L', -1], ['R', 1]]) {
    const x = W2 + dx * 56;
    lamp(o[`tail${side}`] * 0.5, '#ff2b2b', () => { g.fillRect(x - 26, 44, 52, 6); });
    lamp(o.brake, '#ff2b2b', () => { g.fillRect(x - 26, 44, 52, 6); });
    lamp(o[`rturn${side}`], '#ffa628', () => { g.fillRect(x + dx * 18, 44, 10, 6); });
    lamp(o[`reverse${side}`], '#f4f8ff', () => { g.fillRect(x - dx * 18, 52, 10, 3); });
  }
  lamp(o.brake, '#ff2b2b', () => { g.fillRect(W2 - 14, 14, 28, 2.5); });
  lamp(o.plate * 0.8, '#f4f8ff', () => { g.fillRect(W2 - 18, 58, 36, 10); });
  // Marker for moving parts
  const moving = Object.values(o.closures).some(c => c.dance || (c.pos > 0.02 && c.pos < 0.98));
  if (moving) { g.fillStyle = '#3b82f6'; g.beginPath(); g.arc(W - 12, 12, 4 + Math.sin(t * 8), 0, 7); g.fill(); }
}
async function startPreview(card) {
  stopPreview();
  const s = showsOf(card.dataset.source).find(x => x.name === card.dataset.name);
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
  drawActivity(card.querySelector('canvas'), showsOf(card.dataset.source).find(x => x.name === card.dataset.name));
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
$('.groups').addEventListener('click', e => {
  const h = e.target.closest('.group-head'); // delegated: drive groups are re-rendered
  if (h) h.setAttribute('aria-expanded', String(h.getAttribute('aria-expanded') !== 'true'));
  if (e.target.closest('[data-settings]')) openSettings('usb');
  const it = e.target.closest('.item');
  if (it) openShow(it.dataset.source, it.dataset.name);
});
audio.addEventListener('play', renderLibrary);
audio.addEventListener('pause', renderLibrary);

function parseFseq(buf) {
  const b = new Uint8Array(buf), dv = new DataView(buf);
  if (String.fromCharCode(...b.slice(0, 4)) !== 'PSEQ') throw new Error('The .fseq file is not valid.');
  if (b[20] & 0x0f) throw new Error('The show is compressed. Export it from xLights as uncompressed FSEQ v2.');
  return { data: b, off: dv.getUint16(4, true), ch: dv.getUint32(10, true), frames: dv.getUint32(14, true), step: b[18] };
}

async function openShow(source, name, autoplay = true) {
  const s = showsOf(source).find(x => x.name === name);
  if (!s) return;
  stopPreview();
  audio.pause();
  current = { source, name };
  setCrumbs();
  renderLibrary();
  $('#empty').hidden = true;
  $('#dock').hidden = false;
  $('#time').textContent = 'Loading…';
  try {
    const base = `/files/${source}/${encodeURIComponent(name)}`;
    const [buf, blob] = await Promise.all([
      fetch(base + '.fseq').then(r => { if (!r.ok) throw new Error("Can't read the .fseq file."); return r.arrayBuffer(); }),
      fetch(base + s.audio).then(r => { if (!r.ok) throw new Error("Can't read the song."); return r.blob(); }),
    ]);
    const parsed = parseFseq(buf);
    if (current?.name !== name || current?.source !== source) return;
    seq = parsed;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    // Autoplay; if the browser blocks it, the Play button stays
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

// ---------- Compatibility ----------
function renderCompat() {
  const v = VEHICLES[cfg.vehicle];
  $('#compatTitle').textContent = `On ${v.name}`;
  if (!seq) { $('#compatSub').textContent = 'Pick a show to see what it does on your car.'; $('#compatList').innerHTML = ''; return; }
  const rows = compatibility(seq, cfg);
  const bad = rows.filter(r => !r.ok).length;
  $('#compatSub').textContent = `${REGIONS[cfg.region].name}, ${HEADLIGHTS[cfg.headlights].name.toLowerCase()}. ${bad ? `${bad} ${bad === 1 ? 'part is' : 'parts are'} not visible on your car.` : 'The whole show works on your car.'}`;
  $('#compatList').innerHTML = rows.map(r => `<li class="${r.ok ? '' : 'bad'}"><span class="dot"></span><strong>${esc(r.label)}</strong><small>${esc(r.detail)}${r.note ? `. ${esc(r.note)}` : ''}</small></li>`).join('')
    || '<li><span class="dot"></span><strong>Lights only</strong><small>This show has no moving parts.</small></li>';
}
$('#compatBtn').addEventListener('click', () => {
  const open = $('#inspector').hidden;
  $('#inspector').hidden = !open;
  $('#compatBtn').setAttribute('aria-pressed', String(open));
  store.set('inspector', open ? '1' : '0');
  requestAnimationFrame(drawTimeline);
});

// ---------- New show ----------
const song = $('#song');
let picked = null;
function setPicked(file) {
  picked = file;
  const drop = $('#dropText');
  if (!file) {
    drop.innerHTML = 'Drop a song here or <button type="button" class="link" id="pickBtn">choose a file</button>';
    $('#showName').hidden = true;
  } else {
    drop.innerHTML = `<span class="file-chip"><span>${esc(file.name)}</span><button type="button" id="clearFile" aria-label="Remove file"><svg viewBox="0 0 20 20"><path d="m6 6 8 8M14 6l-8 8"/></svg></button></span>`;
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
  else { $('#genStatus').textContent = 'Drop an .mp3 or .wav file.'; $('#genStatus').classList.add('err'); }
});
$('#newForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#showName').value.trim(), st = $('#genStatus');
  st.classList.remove('err');
  if (!picked) return;
  if (!/^[\w\- ăâîșțĂÂÎȘȚ]{1,60}$/.test(name)) { st.textContent = 'Names can only contain letters, digits, spaces and dashes.'; st.classList.add('err'); return; }
  st.textContent = `Analyzing the song and generating the show for ${VEHICLES[cfg.vehicle].name}. Usually takes under a minute.`;
  $('#genBtn').disabled = true;
  try {
    const r = await fetch('/api/generate', {
      method: 'POST', body: picked,
      headers: { 'X-Name': encodeURIComponent(name), 'X-Filename': encodeURIComponent(picked.name),
        'X-Max': cfg.elements === 'max' ? '1' : '0', 'X-Model': { m3old: 'm3', m3h: 'my', myj: 'my' }[cfg.vehicle] || cfg.vehicle },
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

// ---------- Copy to drive ----------
$('#copyBtn').addEventListener('click', async () => {
  const btn = $('#copyBtn');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Copying…';
  const r = await fetch('/api/copy-to-usb', { method: 'POST', body: JSON.stringify({ name: current.name }) });
  const j = await r.json();
  if (!r.ok) { btn.querySelector('span').textContent = j.error; setTimeout(renderLibrary, 3500); return; }
  await refresh();
});

// ---------- Presentation mode ----------
let presenting = false, viewBefore = view, presentList = [], presentIdx = 0;
function playPresent() {
  const s = presentList[presentIdx % presentList.length];
  $('#presentName').textContent = s.name;
  $('#presentSub').textContent = `${VEHICLES[cfg.vehicle].name}, ${presentIdx % presentList.length + 1} of ${presentList.length}. Esc to exit`;
  openShow(s.source, s.name, true);
}
function startPresentation() {
  // Shows on the computer first, then the ones only on the drive
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

// ---------- Sync offset ----------
function setSync(ms) {
  cfg.syncMs = Math.max(-500, Math.min(500, Math.round(ms)));
  store.set('syncMs', String(cfg.syncMs));
  $('#syncRange').value = cfg.syncMs;
  $('#syncValue').textContent = `${cfg.syncMs > 0 ? '+' : ''}${cfg.syncMs} ms`;
  snapNext = true;
}
$('#syncRange').addEventListener('input', e => setSync(+e.target.value));
setSync(cfg.syncMs);

// ---------- Settings + sidebar ----------
const dlg = $('#settings');
function openSettings(pane = 'car') {
  for (const b of $$('.nav-item[data-pane]')) b.classList.toggle('active', b.dataset.pane === pane);
  for (const p of $$('.pane')) p.hidden = p.dataset.pane !== pane;
  $('#paneTitle').textContent = pane === 'usb' ? 'USB drive' : 'Car';
  if (!dlg.open) dlg.showModal();
}
$('#settingsBtn').addEventListener('click', () => openSettings());
$('#closeSettings').addEventListener('click', () => dlg.close());
$$('.nav-item[data-pane]').forEach(b => b.addEventListener('click', () => openSettings(b.dataset.pane)));
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
const setCollapsed = c => { $('#app').classList.toggle('collapsed', c); store.set('collapsed', c ? '1' : '0'); requestAnimationFrame(drawTimeline); };
$('#collapseBtn').addEventListener('click', () => setCollapsed(true));
$('#expandBtn').addEventListener('click', () => setCollapsed(false));

// ---------- Startup ----------
labelChips();
setCrumbs();
setCollapsed(store.get('collapsed', '0') === '1');
if (store.get('inspector', '0') === '1') { $('#inspector').hidden = false; $('#compatBtn').setAttribute('aria-pressed', 'true'); }
mountViews();
setView(view);
refresh().catch(() => { $('#emptySub').textContent = "The Studio server isn't responding. Start it with python studio.py."; });
setInterval(() => refresh().catch(() => {}), 5000); // the drive can be plugged in anytime
