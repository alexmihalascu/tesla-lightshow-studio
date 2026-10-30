// Scenă 3D cu modelele oficiale Tesla din proiectul xLights (servite local de studio.py la /tesla/...).
// Lămpile stau la coordonatele exacte din xlights_rgbeffects.xml; piesele Model S (portbagaj, oglinzi,
// geamuri, trapă, uși) se mișcă după starea închiderilor calculată de emulator.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const WHITE = '#f4f8ff', AMBER = '#ffa628', RED = '#ff2b2b', CLOSURE = '#e8c547';

// Nume model xLights (fără prefixul "CT ") -> [cheie emulator, culoare]
const LAMPS = {
  'Left Outer Main Beam': ['outerL', WHITE], 'Right Outer Main Beam': ['outerR', WHITE],
  'Left Inner Main Beam': ['innerL', WHITE], 'Right Inner Main Beam': ['innerR', WHITE],
  'Left Signature': ['sigL', WHITE], 'Right Signature': ['sigR', WHITE],
  'Left Channel 4': ['c4L', WHITE], 'Right Channel 4': ['c4R', WHITE], 'Left Channel 5': ['c5L', WHITE],
  'Right Channel 5': ['c5R', WHITE], 'Left Channel 6': ['c6L', WHITE], 'Right Channel 6': ['c6R', WHITE],
  'Left Front Turn': ['fturnL', AMBER], 'Right Front Turn': ['fturnR', AMBER],
  'Left Front Fog': ['fogL', WHITE], 'Right Front Fog': ['fogR', WHITE],
  'Left Aux Park': ['auxL', WHITE], 'Right Aux Park': ['auxR', WHITE],
  'Left Side Marker': ['markerL', AMBER], 'Right Side Marker': ['markerR', AMBER],
  'Left Front Side Marker': ['markerL', AMBER], 'Right Front Side Marker': ['markerR', AMBER],
  'Left Side Repeater': ['repL', AMBER], 'Right Side Repeater': ['repR', AMBER],
  'Left Rear Side Marker': ['rsmL', AMBER], 'Right Rear Side Marker': ['rsmR', AMBER],
  'Left Rear Turn': ['rturnL', AMBER], 'Right Rear Turn': ['rturnR', AMBER],
  'Brake Lights': ['brake', RED], 'Brake Light': ['brake', RED],
  'Left Tail': ['tailL', RED], 'Right Tail': ['tailR', RED],
  'Reverse Lights': ['reverseL', WHITE], 'Left Reverse Light': ['reverseL', WHITE], 'Right Reverse Light': ['reverseR', WHITE],
  'Rear Fog Lights': ['rearFog', RED], 'License Plate': ['plate', WHITE],
  'Frunk Light': ['frunkLight', WHITE], 'Left Bed Light': ['bed', WHITE], 'Right Bed Light': ['bed', WHITE],
};
const RGB = { 'Center Front Display': 'display', 'Left Front RGB': 'lf', 'Left Rear RGB': 'lr',
  'Right Front RGB': 'rf', 'Right Rear RGB': 'rr', 'Center Front RGB': 'cf' };
const BARS = { 'Front Light Bar': ['frontBar', WHITE], 'Rear Light Bar': ['rearBar', RED], 'Offroad Light Bar': ['offroad', WHITE] };
const CLOSURE_KEYS = {
  'Left Falcon Door': 'falconL', 'Right Falcon Door': 'falconR', 'Left Front Door': 'doorL', 'Right Front Door': 'doorR',
  'Left Mirror': 'mirrorL', 'Right Mirror': 'mirrorR', 'Left Front Window': 'winLF', 'Left Rear Window': 'winLR',
  'Right Front Window': 'winRF', 'Right Rear Window': 'winRR', 'Liftgate': 'liftgate', 'Powered Frunk': 'liftgate',
  'Left Front Door Handle': 'handleLF', 'Left Rear Door Handle': 'handleLR', 'Right Front Door Handle': 'handleRF',
  'Right Rear Door Handle': 'handleRR', 'Charge Port': 'chargePort',
};

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Pozițiile nodurilor unui model xLights (linie simplă, polilinie cu segmente sau model custom)
function nodePositions(m) {
  const P = (a) => new THREE.Vector3(...a);
  if (m.points.length >= 2) {
    const pts = m.points.map(p => P(p).multiply(P(m.scale)).add(P(m.pos)));
    const out = [];
    if (m.segs.length) {
      m.segs.forEach((count, s) => {
        for (let i = 0; i < count && s + 1 < pts.length; i++) out.push(pts[s].clone().lerp(pts[s + 1], (i + 0.5) / count));
      });
    } else {
      for (let i = 0; i < m.nodes; i++) out.push(pts[0].clone().lerp(pts[pts.length - 1], (i + 0.5) / m.nodes));
    }
    return out;
  }
  const a = P(m.pos), b = a.clone().add(P(m.end)), len = a.distanceTo(b);
  const n = m.nodes > 1 ? m.nodes : Math.max(1, Math.min(6, Math.round(len / 10)));
  return Array.from({ length: n }, (_, i) => n === 1 ? a.clone().lerp(b, 0.5) : a.clone().lerp(b, i / (n - 1)));
}

export async function createScene3D(container, layout, vehicleKey) {
  const isCT = vehicleKey === 'ct';
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000');
  scene.fog = new THREE.Fog('#000', 2200, 5200);
  const camera = new THREE.PerspectiveCamera(32, 1, 10, 20000);
  const center = isCT ? new THREE.Vector3(0, 170, -1000) : new THREE.Vector3(0, 110, 0);
  camera.position.copy(center).add(isCT ? new THREE.Vector3(1700, 600, 1450) : new THREE.Vector3(1250, 420, 1080));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.5;
  controls.minDistance = 300;
  controls.maxDistance = 4000;

  scene.add(new THREE.HemisphereLight('#a9b8cf', '#080808', 1.25));
  const key = new THREE.DirectionalLight('#dfe6f0', 1.5);
  key.position.set(600, 1200, 800);
  const rim = new THREE.DirectionalLight('#7f93b3', 1.1);
  rim.position.set(-900, 600, -1200);
  scene.add(key, rim);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 64), new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.85, metalness: 0.1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.copy(center).setY(0);
  scene.add(ground);

  // ---- Mesh oficial ----
  const meshInfo = layout.meshes.find(m => m.name === (isCT ? 'Cybertruck' : 'Tesla Model S'));
  const [dir, objName] = meshInfo.obj.split('/');
  const base = `/tesla/${dir}/`;
  const materials = await new MTLLoader().setPath(base).loadAsync(objName.replace(/\.obj$/i, '.mtl'));
  materials.preload();
  const car = await new OBJLoader().setMaterials(materials).setPath(base).loadAsync(objName);
  car.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map(m => new THREE.MeshStandardMaterial({
      map: m.map || null, color: m.map ? '#ffffff' : m.color, roughness: m.map ? 0.38 : 0.6, metalness: m.map ? 0.35 : 0.2,
      transparent: m.opacity < 1, opacity: m.opacity,
    }));
    if (o.material.length === 1) o.material = o.material[0];
  });
  car.position.set(...meshInfo.pos);
  car.scale.set(...meshInfo.scale);
  car.rotation.set(...meshInfo.rot.map(THREE.MathUtils.degToRad));
  scene.add(car);

  // ---- Piese mobile (doar Model S are piesele separate în OBJ) ----
  const parts = [];
  const byName = name => car.children.filter(c => c.name === name);
  function hinge(names, pivotFn, apply) {
    const meshes = names.flatMap(byName);
    if (!meshes.length) return;
    const box = new THREE.Box3();
    meshes.forEach(m => { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); });
    const pivot = new THREE.Group();
    pivot.position.copy(pivotFn(box));
    car.add(pivot);
    meshes.forEach(m => { m.position.sub(pivot.position); pivot.add(m); });
    parts.push({ pivot, apply, box });
  }
  if (!isCT) {
    const v = vehicleKey;
    hinge(['Trunk', 'Spoiler'], b => new THREE.Vector3(b.max.x, b.max.y, (b.min.z + b.max.z) / 2),
      (p, c) => { p.rotation.z = THREE.MathUtils.degToRad(-55) * c.liftgate.pos; });
    hinge(['Door_LF_Mirror'], b => new THREE.Vector3(b.max.x, b.min.y, b.max.z),
      (p, c) => { p.rotation.y = THREE.MathUtils.degToRad(70) * c.mirrorL.pos; });
    hinge(['Door_RF_Mirror'], b => new THREE.Vector3(b.max.x, b.min.y, b.min.z),
      (p, c) => { p.rotation.y = THREE.MathUtils.degToRad(-70) * c.mirrorR.pos; });
    for (const [name, k] of [['Window_LF', 'winLF'], ['Window_LR', 'winLR'], ['Window_RF', 'winRF'], ['Window_RR', 'winRR']]) {
      if (v === 'mx' && (name === 'Window_LR' || name === 'Window_RR')) continue; // la X geamul spate merge cu ușa Falcon
      hinge([name], b => b.min.clone(), (p, c, box) => { p.position.y = box.min.y - (box.max.y - box.min.y) * 0.95 * c[k].pos; });
    }
    hinge(['Charge_Cap'], b => new THREE.Vector3(b.min.x, b.min.y, (b.min.z + b.max.z) / 2),
      (p, c) => { p.rotation.y = THREE.MathUtils.degToRad(85) * c.chargePort.pos; });
    if (v === 'mx') {
      hinge(['Door_LR', 'Window_LR'], b => new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, b.max.z),
        (p, c) => { p.rotation.x = THREE.MathUtils.degToRad(100) * c.falconL.pos; });
      hinge(['Door_RR', 'Window_RR'], b => new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, b.min.z),
        (p, c) => { p.rotation.x = THREE.MathUtils.degToRad(-100) * c.falconR.pos; });
      hinge(['Door_LF'], b => new THREE.Vector3(b.max.x, b.min.y, b.min.z),
        (p, c) => { p.rotation.y = THREE.MathUtils.degToRad(-60) * c.doorL.pos; });
      hinge(['Door_RF'], b => new THREE.Vector3(b.max.x, b.min.y, b.max.z),
        (p, c) => { p.rotation.y = THREE.MathUtils.degToRad(60) * c.doorR.pos; });
    }
  }

  // ---- Lămpi ----
  const tex = glowTexture();
  const sprites = [];
  const sprite = (pos, color, size) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(pos);
    s.scale.setScalar(size);
    scene.add(s);
    return s;
  };
  for (const m of layout.models) {
    const ctModel = m.name.startsWith('CT ') || m.ct;
    if (ctModel !== isCT && !(isCT && m.name === 'Powered Frunk')) continue;
    if (!isCT && m.name === 'Powered Frunk') continue;
    const name = m.name.replace(/^CT /, '');
    const nodes = nodePositions(m);
    const size = m.type === 'Custom' ? 46 : isCT ? 26 : 20;
    if (LAMPS[name]) {
      const [k, color] = LAMPS[name];
      nodes.forEach(p => sprites.push({ s: sprite(p, color, size), get: o => o[k] || 0 }));
    } else if (BARS[name]) {
      const [k, color] = BARS[name];
      nodes.forEach((p, i) => sprites.push({ s: sprite(p, color, 18), get: o => o[k][i] || 0 }));
    } else if (RGB[name]) {
      const k = RGB[name];
      nodes.forEach(p => sprites.push({ s: sprite(p, '#ffffff', 60), rgb: k }));
    } else if (CLOSURE_KEYS[name]) {
      const k = CLOSURE_KEYS[name];
      // Indicator galben pe piesa care se mișcă (pe Cybertruck mesh-ul nu are piese separate)
      // Pe Model S piesele se mișcă efectiv; indicatorul rămâne doar pe Cybertruck
      if (isCT) nodes.slice(0, 1).forEach(p => sprites.push({ s: sprite(p, CLOSURE, 34), closure: k }));
    }
  }

  // Lumini reale care luminează caroseria și asfaltul
  const lampPos = names => {
    const v = new THREE.Vector3(); let n = 0;
    for (const m of layout.models) if (names.includes(m.name)) { v.add(new THREE.Vector3(...m.pos)); n++; }
    return n ? v.divideScalar(n) : center.clone();
  };
  const pre = isCT ? 'CT ' : '';
  const heads = ['Left', 'Right'].map(side => {
    const p = lampPos([`${pre}${side} Outer Main Beam`, `${pre}${side} Inner Main Beam`]);
    const l = new THREE.SpotLight('#fff6e0', 0, 2600, 0.42, 0.6, 0);
    l.position.copy(p);
    l.target.position.copy(p).add(new THREE.Vector3(900, -p.y + 10, 0));
    scene.add(l, l.target);
    return { l, keys: side === 'Left' ? ['outerL', 'innerL'] : ['outerR', 'innerR'] };
  });
  const rear = new THREE.PointLight(RED, 0, 900, 0);
  rear.position.copy(lampPos([isCT ? 'CT Brake Light' : 'Brake Lights'])).add(new THREE.Vector3(-60, -40, 0));
  scene.add(rear);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.15, 0.55, 0.12);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Unghiuri de cameră (fața mașinii e spre +X, partea stângă spre -Z)
  const dist = isCT ? 2300 : 1700;
  const PRESETS = {
    three: [1250, 420, 1080], front: [dist, 260, 0], side: [0, 300, -dist], rear: [-dist, 320, 0], top: [40, dist * 1.25, 0],
  };
  let tween = null;
  function setPreset(name, instant = false) {
    controls.autoRotate = name === 'orbit';
    controls.autoRotateSpeed = 1.2;
    if (name === 'orbit') return;
    const fit = Math.max(1, 1.5 / camera.aspect); // panou îngust (2D + 3D): camera se depărtează
    const off = PRESETS[name].map(v => v * fit * (isCT ? 1.35 : 1));
    const to = center.clone().add(new THREE.Vector3(...off));
    if (instant) { camera.position.copy(to); return; }
    tween = { from: camera.position.clone(), to, t0: performance.now() };
  }

  return {
    setPreset,
    render(out, t) {
      if (tween) {
        const k = Math.min(1, (performance.now() - tween.t0) / 700), e = 1 - (1 - k) ** 3;
        camera.position.lerpVectors(tween.from, tween.to, e);
        if (k === 1) tween = null;
      }
      for (const sp of sprites) {
        if (sp.rgb) {
          const c = out.rgb[sp.rgb] || [0, 0, 0];
          sp.s.material.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
          sp.s.material.opacity = Math.max(...c) > 0 ? 0.9 : 0;
        } else if (sp.closure) {
          const c = out.closures[sp.closure];
          sp.s.material.opacity = c.dance ? 0.55 + 0.45 * Math.sin(t * 8) : c.pos > 0.02 && c.pos < 0.98 ? 0.8 : 0;
        } else sp.s.material.opacity = sp.get(out);
      }
      for (const h of heads) h.l.intensity = 2.4 * Math.max(...h.keys.map(k => out[k] || 0));
      rear.intensity = 2.2 * Math.max(out.brake || 0, 0.4 * Math.max(out.tailL || 0, out.tailR || 0));
      for (const p of parts) p.apply(p.pivot, out.closures, p.box);
      controls.update();
      composer.render();
    },
    dispose() {
      ro.disconnect();
      renderer.dispose();
      container.innerHTML = '';
    },
  };
}
