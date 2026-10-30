// Scenă 3D: modelele oficiale Tesla din proiectul xLights (servite local la /tesla/...) sau un model propriu
// din models/*.glb (servit la /models/...). Pe modelele oficiale, lămpile stau la coordonatele exacte din
// xlights_rgbeffects.xml; pe modelul propriu se aprind chiar materialele farurilor, stopurilor, semnalizărilor.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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

// Model propriu (.glb): material -> lămpi. Partea (stânga/dreapta) se decide după poziția reală a piesei.
const GLB_LIGHTS = [
  // [material, culoare, lămpi, intensitate] — roșul are intensitate mică ca să nu se satureze în alb
  [/front_light/i, WHITE, s => [`outer${s}`, `inner${s}`, `sig${s}`, `c4${s}`], 1.6],
  [/indicator_.f|indicator_lights/i, AMBER, s => [`fturn${s}`], 2],
  [/indicator_.r|light_turn_.r/i, AMBER, s => [`rturn${s}`], 2],
  [/fog/i, WHITE, s => [`fog${s}`], 1.2],
  [/rear_light/i, RED, s => [`tail${s}`, 'brake'], 1.1, { tail: 0.2 }], // poziție slab, frână puternic
  [/break|brake/i, RED, () => ['brake'], 1.1],
  [/rev(light|ese)/i, WHITE, s => [`reverse${s}`], 1],
  [/platnomor|plate/i, WHITE, () => ['plate'], 0.5],
];

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
  const P = a => new THREE.Vector3(...a);
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

// ---- Geometrie pentru modelele .glb ----
// Pozițiile vârfurilor unui mesh în coordonate de lume (x, y, z consecutive)
function worldPositions(mesh) {
  const P = mesh.geometry.attributes.position, e = mesh.matrixWorld.elements, out = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    out[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}
const triIndex = g => g.index ? g.index.array : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);

// Împarte triunghiurile unui mesh pe grupuri (după centrul lor în lume); geometriile noi sunt deja în lume
function splitTriangles(mesh, classify) {
  const W = worldPositions(mesh), idx = triIndex(mesh.geometry), buckets = {};
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const key = classify((W[a] + W[b] + W[c]) / 3, (W[a + 1] + W[b + 1] + W[c + 1]) / 3, (W[a + 2] + W[b + 2] + W[c + 2]) / 3);
    if (key) (buckets[key] ||= []).push(idx[i], idx[i + 1], idx[i + 2]);
  }
  const out = {};
  for (const [k, list] of Object.entries(buckets)) {
    const g = mesh.geometry.clone();
    g.setIndex(list);
    g.applyMatrix4(mesh.matrixWorld);
    out[k] = g;
  }
  return out;
}

// Oglinzile exterioare: triunghiurile de deasupra liniei roților care ies lateral peste lățimea caroseriei
function mirrorTriangles(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const data = [];
  root.traverse(o => { if (o.isMesh && o.visible) data.push({ m: o, W: worldPositions(o), idx: triIndex(o.geometry) }); });
  let half = 0; // jumătate din lățimea caroseriei (jos, fără bare)
  for (const { W } of data) {
    for (let i = 0; i < W.length; i += 3) {
      if (W[i + 1] - box.min.y < 0.42 * s.y && Math.abs(W[i] - c.x) < 0.33 * s.x) half = Math.max(half, Math.abs(W[i + 2] - c.z));
    }
  }
  const res = { count: 0, sumX: 0, per: [] };
  for (const { m, W, idx } of data) {
    const L = [], R = [], K = [];
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, d = idx[i + 2] * 3;
      const x = (W[a] + W[b] + W[d]) / 3 - c.x, y = (W[a + 1] + W[b + 1] + W[d + 1]) / 3 - box.min.y, z = (W[a + 2] + W[b + 2] + W[d + 2]) / 3 - c.z;
      const hit = y > 0.45 * s.y && y < 0.8 * s.y && Math.abs(x) < 0.38 * s.x && Math.abs(z) > half + 0.012 * s.z;
      (hit ? (z < 0 ? L : R) : K).push(idx[i], idx[i + 1], idx[i + 2]);
      if (hit) { res.count++; res.sumX += x; }
    }
    if (L.length || R.length) res.per.push({ m, L, R, K });
  }
  return res;
}

// Fascicul de far: con aditiv, mai luminos lângă far și pe axă, estompat spre margini și capăt
// (lumina „volumetrică” clasică: intensitatea depinde de cât de frontal privim suprafața conului)
function beamMesh(origin, side) {
  const len = 1150, geo = new THREE.ConeGeometry(260, len, 48, 12, true);
  geo.translate(0, -len / 2, 0);
  geo.rotateZ(Math.PI / 2 - 0.07); // vârful în far, deschiderea spre +X, ușor în jos
  geo.rotateY(side === 'L' ? 0.04 : -0.04);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uLen: { value: len }, uColor: { value: new THREE.Color('#fff1d6') } },
    vertexShader: `varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() { vAlong = position.x; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uOpacity; uniform float uLen; uniform vec3 uColor; varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() { float along = pow(clamp(1.0 - vAlong / uLen, 0.0, 1.0), 2.4);
        float facing = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        gl_FragColor = vec4(uColor * along * facing * uOpacity, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(origin);
  return mesh;
}

// Ce model 3D folosim pentru fiecare vehicul
export function pickModel(layout, vehicleKey) {
  const custom = layout.custom || [];
  const want = { m3: ['model3'], m3old: ['model3'], my: ['modely', 'modely-juniper', 'model3'],
    myj: ['modely-juniper', 'modely', 'model3'], mx: ['modelx'] }[vehicleKey] || [];
  const file = want.find(f => custom.includes(f));
  if (file) return { kind: 'glb', file };
  if (vehicleKey === 'ct') return { kind: 'official', mesh: 'Cybertruck' };
  return { kind: 'official', mesh: 'Tesla Model S' };
}

export async function createScene3D(container, layout, vehicleKey) {
  const pick = pickModel(layout, vehicleKey);
  const isCT = pick.mesh === 'Cybertruck';
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
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.5;
  controls.minDistance = 300;
  controls.maxDistance = 4000;

  // Modelele .glb au materiale PBR reale (vopsea deschisă): noaptea are nevoie de mult mai puțină lumină
  const glb = pick.kind === 'glb';
  scene.add(new THREE.HemisphereLight('#a9b8cf', '#080808', glb ? 0.32 : 1.25));
  const key = new THREE.DirectionalLight('#dfe6f0', glb ? 0 : 1.5); // .glb: fără „lună”, reflexiile pe clearcoat ar înflori
  key.position.set(600, 1200, 800);
  const rim = new THREE.DirectionalLight('#7f93b3', glb ? 0.45 : 1.1);
  rim.position.set(-900, 600, -1200);
  scene.add(key, rim);
  // Asfalt ușor umed: luminile mașinii se reflectă în el
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 64), new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.72, metalness: 0.15 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.copy(center).setY(0);
  scene.add(ground);

  const tex = glowTexture();
  const sprites = [];      // {s, get | rgb | closure}
  const emissive = [];     // {mat, keys, base}
  const parts = [];        // {pivot, apply, box}
  const anchors = {};      // cheie lampă -> poziții, pentru luminile reale și fascicule
  const anchor = (keys, pos) => { for (const k of keys) (anchors[k] ||= []).push(pos.clone()); };
  let attribution = '';

  const sprite = (pos, color, size) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(pos);
    s.scale.setScalar(size);
    scene.add(s);
    return s;
  };

  if (pick.kind === 'official') {
    // ---- Mesh oficial Tesla ----
    const meshInfo = layout.meshes.find(m => m.name === pick.mesh);
    if (!meshInfo) throw new Error('Lipsește proiectul oficial Tesla xLights (tesla_xlights_show_folder).');
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

    // Piese mobile (doar Model S are piesele separate în OBJ)
    const byName = name => car.children.filter(c => c.name === name);
    const hinge = (names, pivotFn, apply) => {
      const meshes = names.flatMap(byName);
      if (!meshes.length) return;
      const box = new THREE.Box3();
      meshes.forEach(m => { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); });
      const pivot = new THREE.Group();
      pivot.position.copy(pivotFn(box));
      car.add(pivot);
      meshes.forEach(m => { m.position.sub(pivot.position); pivot.add(m); });
      parts.push({ pivot, apply, box });
    };
    const deg = THREE.MathUtils.degToRad;
    if (!isCT) {
      hinge(['Trunk', 'Spoiler'], b => new THREE.Vector3(b.max.x, b.max.y, (b.min.z + b.max.z) / 2),
        (p, c) => { p.rotation.z = deg(-55) * c.liftgate.pos; });
      hinge(['Door_LF_Mirror'], b => new THREE.Vector3(b.max.x, b.min.y, b.max.z), (p, c) => { p.rotation.y = deg(70) * (1 - c.mirrorL.pos); });
      hinge(['Door_RF_Mirror'], b => new THREE.Vector3(b.max.x, b.min.y, b.min.z), (p, c) => { p.rotation.y = deg(-70) * (1 - c.mirrorR.pos); });
      for (const [name, k] of [['Window_LF', 'winLF'], ['Window_LR', 'winLR'], ['Window_RF', 'winRF'], ['Window_RR', 'winRR']]) {
        if (vehicleKey === 'mx' && (name === 'Window_LR' || name === 'Window_RR')) continue; // la X geamul spate merge cu ușa Falcon
        hinge([name], b => b.min.clone(), (p, c, box) => { p.position.y = box.min.y - (box.max.y - box.min.y) * 0.95 * c[k].pos; });
      }
      hinge(['Charge_Cap'], b => new THREE.Vector3(b.min.x, b.min.y, (b.min.z + b.max.z) / 2), (p, c) => { p.rotation.y = deg(85) * c.chargePort.pos; });
      if (vehicleKey === 'mx') {
        hinge(['Door_LR', 'Window_LR'], b => new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, b.max.z), (p, c) => { p.rotation.x = deg(100) * c.falconL.pos; });
        hinge(['Door_RR', 'Window_RR'], b => new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, b.min.z), (p, c) => { p.rotation.x = deg(-100) * c.falconR.pos; });
        hinge(['Door_LF'], b => new THREE.Vector3(b.max.x, b.min.y, b.min.z), (p, c) => { p.rotation.y = deg(-60) * c.doorL.pos; });
        hinge(['Door_RF'], b => new THREE.Vector3(b.max.x, b.min.y, b.max.z), (p, c) => { p.rotation.y = deg(60) * c.doorR.pos; });
      }
    }

    for (const m of layout.models) {
      const ctModel = m.name.startsWith('CT ') || m.ct;
      if (isCT ? !(ctModel || m.name === 'Powered Frunk') : (ctModel || m.name === 'Powered Frunk')) continue;
      const name = m.name.replace(/^CT /, '');
      const nodes = nodePositions(m);
      const size = m.type === 'Custom' ? 46 : isCT ? 26 : 20;
      if (LAMPS[name]) {
        const [k, color] = LAMPS[name];
        const weight = k.startsWith('tail') ? 0.4 : 1; // stopul de poziție e mult mai slab decât frâna
        nodes.forEach(p => sprites.push({ s: sprite(p, color, size), get: o => (o[k] || 0) * weight }));
        anchor([k], nodes[Math.floor(nodes.length / 2)]);
      } else if (BARS[name]) {
        const [k, color] = BARS[name];
        nodes.forEach((p, i) => sprites.push({ s: sprite(p, color, 18), get: o => o[k][i] || 0 }));
      } else if (RGB[name]) {
        nodes.forEach(p => sprites.push({ s: sprite(p, '#ffffff', 60), rgb: RGB[name] }));
      } else if (CLOSURE_KEYS[name] && isCT) {
        // Cybertruck-ul oficial e o singură piesă: mișcările apar ca indicatori galbeni
        sprites.push({ s: sprite(nodes[0], CLOSURE, 34), closure: CLOSURE_KEYS[name] });
      }
    }
  } else {
    // ---- Model propriu .glb ----
    const gltf = await new GLTFLoader().loadAsync(`/models/${pick.file}.glb`);
    const extras = gltf.parser.json.asset?.extras || {};
    if (extras.title) attribution = `${extras.title}${extras.author ? ` de ${extras.author.replace(/\s*\(.*\)/, '')}` : ''}${extras.license ? `, ${extras.license.replace(/\s*\(.*\)/, '')}` : ''}`;
    const model = gltf.scene;
    // Sticla și lacul perfect netede (rugozitate 0) reflectă luminile ca puncte extrem de intense, pe care
    // bloom-ul le transformă în pătrate. O rugozitate minimă dă reflexii moi, ca pe o mașină reală.
    model.traverse(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if ('roughness' in m) m.roughness = Math.max(m.roughness, 0.22);
        if ('clearcoatRoughness' in m) m.clearcoatRoughness = Math.max(m.clearcoatRoughness, 0.2);
      }
    });
    model.updateMatrixWorld(true);
    // Orientare din roți: înainte = +X, stânga = -Z (ca la modelele oficiale)
    const wp = n => model.getObjectByName(n)?.getWorldPosition(new THREE.Vector3());
    const rf = wp('hub_rf'), rb = wp('hub_rb'), lf = wp('hub_lf');
    const holder = new THREE.Group();
    holder.add(model);
    const hubs = rf && rb && lf;
    if (hubs) {
      const F = rf.clone().sub(rb).normalize(), Lf = lf.clone().sub(rf).normalize();
      const U = new THREE.Vector3().crossVectors(F, Lf).normalize();
      Lf.crossVectors(U, F).normalize(); // re-ortogonalizat: stânga
      const A = new THREE.Matrix4().makeBasis(F, U, Lf.clone().negate());
      holder.quaternion.setFromRotationMatrix(A.invert());
    } else {
      // glTF e cu Y în sus; lungimea mașinii o punem pe X
      const s0 = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      if (s0.z > s0.x) holder.rotation.y = Math.PI / 2;
    }
    scene.add(holder);
    // Scară: lungimea unui Tesla (~4,7–5 m) la scara modelelor oficiale (~5 mm pe unitate), apoi centrare
    const fit = () => {
      holder.scale.setScalar(1);
      holder.position.set(0, 0, 0);
      holder.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
      holder.scale.setScalar((pick.file === 'modelx' ? 1010 : 940) / Math.max(size.x, 1e-6));
      holder.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(holder), c = b.getCenter(new THREE.Vector3());
      holder.position.set(-c.x, -b.min.y, -c.z);
      holder.updateMatrixWorld(true);
    };
    fit();
    // Fără roți numite: fața e partea spre care stau oglinzile (cele mai late puncte de deasupra roților)
    if (!hubs) {
      const m = mirrorTriangles(model);
      if (m.count && m.sumX / m.count < 0) { holder.rotation.y += Math.PI; fit(); }
    }
    const final = new THREE.Box3().setFromObject(holder), fsize = final.getSize(new THREE.Vector3());
    center.set(0, fsize.y * 0.42, 0);
    controls.target.copy(center);

    const animated = new Set();
    const meshes = [];
    model.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) meshes.push(o); });
    const L = fsize.x, W = fsize.z, H = fsize.y;

    // Lumini, varianta precisă: materiale numite pe lămpi (ex. Model 3 de Ameer Studio)
    let precise = 0;
    for (const o of meshes) {
      const name = o.material?.name || ''; // potrivire doar pe material: nodurile pot conține și rame negre
      const rule = GLB_LIGHTS.find(([re]) => re.test(name));
      if (!rule) continue;
      const [, color, keysFor, base = 1, w = {}] = rule;
      const pos = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      const side = pos.z < 0 ? 'L' : 'R';
      // Piesă centrală (ex. lampa de marșarier pe toată lățimea): ascultă de ambele părți
      const keys = Math.abs(pos.z) < 40 ? [...new Set([...keysFor('L'), ...keysFor('R')])] : keysFor(side);
      const mat = o.material.clone();
      mat.emissive = new THREE.Color(color);
      mat.emissiveIntensity = 0;
      o.material = mat;
      emissive.push({ mat, keys, base, w, name, pos });
      anchor(keys, pos);
      precise++;
    }

    // Lumini, varianta generică: materiale „light/lamp” împărțite pe triunghiuri în față/spate și stânga/centru/dreapta
    if (!precise) {
      for (const o of meshes) {
        const name = o.material?.name || '';
        if (!/light|lamp|led/i.test(name) || /glass|night|interior/i.test(name)) continue;
        const groups = splitTriangles(o, (cx, cy, cz) => `${cx > 0 ? 'F' : 'R'}${Math.abs(cz) < W * 0.12 ? 'C' : cz < 0 ? 'L' : 'R'}`);
        for (const [g, geo] of Object.entries(groups)) {
          const front = g[0] === 'F', side = g[1];
          const color = front ? WHITE : RED;
          const mat = (Array.isArray(o.material) ? o.material[0] : o.material).clone();
          mat.emissive = new THREE.Color(color);
          mat.emissiveIntensity = 0;
          if (!front) mat.color = new THREE.Color('#5a0b0b');
          const piece = new THREE.Mesh(geo, mat);
          scene.add(piece);
          const pos = new THREE.Box3().setFromObject(piece).getCenter(new THREE.Vector3());
          const keys = front
            ? (side === 'C' ? ['sigL', 'sigR', 'c4L', 'c4R'] : [`outer${side}`, `inner${side}`, `sig${side}`, `c4${side}`])
            : (side === 'C' ? ['tailL', 'tailR', 'brake'] : [`tail${side}`, 'brake']);
          emissive.push({ mat, keys, base: front ? 1.6 : 0.7, w: front ? {} : { tail: 0.28 }, name: `${name} ${g}`, pos });
          anchor(keys, pos);
        }
        o.visible = false;
      }
    }
    // Model fără materiale de lumini (ex. Model X cu texturi): lămpi lipite pe caroserie, găsite cu raze
    const ray = new THREE.Raycaster();
    const surface = (x, y, z, dirX) => {
      ray.set(new THREE.Vector3(x - dirX * L, y, z), new THREE.Vector3(dirX, 0, 0));
      const hit = ray.intersectObjects(meshes.filter(m => m.visible), false)[0];
      return hit ? hit.point.add(new THREE.Vector3(-dirX * 4, 0, 0)) : new THREE.Vector3(x, y, z);
    };
    if (!emissive.length) {
      for (const side of ['L', 'R']) {
        const zs = side === 'L' ? -1 : 1;
        for (let i = 0; i < 3; i++) {
          const head = surface(final.max.x, H * 0.44 + i * 3, zs * W * (0.27 + i * 0.05), -1);
          sprites.push({ s: sprite(head, WHITE, 18), get: o => Math.max(o[`outer${side}`], o[`inner${side}`], o[`sig${side}`]) || 0 });
          anchor([`outer${side}`], head);
          const tail = surface(final.min.x, H * 0.57, zs * W * (0.26 + i * 0.06), 1);
          sprites.push({ s: sprite(tail, RED, 18), get: o => Math.max(0.45 * (o[`tail${side}`] || 0), o.brake || 0) });
          anchor([`tail${side}`], tail);
        }
      }
    }
    // Semnalizări portocalii la colțuri, dacă modelul nu le are ca material separat
    if (!precise) {
      for (const side of ['L', 'R']) {
        const zs = side === 'L' ? -1 : 1;
        const f = surface(final.max.x, H * 0.45, zs * W * 0.4, -1), r = surface(final.min.x, H * 0.57, zs * W * 0.42, 1);
        sprites.push({ s: sprite(f, AMBER, 16), get: o => o[`fturn${side}`] || 0 });
        sprites.push({ s: sprite(r, AMBER, 16), get: o => o[`rturn${side}`] || 0 });
        anchor([`fturn${side}`], f);
        anchor([`rturn${side}`], r);
      }
    }

    // Geamurile ușilor coboară în ușă (axa Z locală a ușii e în sus, unități de metri)
    for (const [door, k] of [['door_lf', 'winLF'], ['door_lr', 'winLR'], ['door_rf', 'winRF'], ['door_rr', 'winRR']]) {
      model.getObjectByName(door)?.traverse(o => {
        if (!o.isMesh || !/^glass/.test(o.material?.name || '')) return;
        const rest = o.position.z;
        parts.push({ pivot: o, apply: (p, c) => { p.position.z = rest - 0.42 * c[k].pos; } });
        animated.add(k);
      });
    }
    // Oglinzile: decupate din caroserie (cele mai late puncte de deasupra roților) și pliate spre spate,
    // în jurul axei verticale de la baza lor
    const mt = mirrorTriangles(model);
    for (const side of ['L', 'R']) {
      const k = `mirror${side}`, pieces = [];
      for (const p of mt.per) {
        if (!p[side].length) continue;
        const g = p.m.geometry.clone();
        g.setIndex(p[side]);
        g.applyMatrix4(p.m.matrixWorld);
        pieces.push(new THREE.Mesh(g, p.m.material));
      }
      if (!pieces.length) continue;
      const mb = new THREE.Box3();
      pieces.forEach(m => { m.geometry.computeBoundingBox(); mb.union(m.geometry.boundingBox); });
      const pivot = new THREE.Group();
      pivot.position.set((mb.min.x + mb.max.x) / 2, mb.min.y, side === 'L' ? mb.max.z : mb.min.z); // baza oglinzii
      pieces.forEach(m => { m.geometry.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z); pivot.add(m); });
      scene.add(pivot);
      // stânga (-Z): rotația pozitivă duce exteriorul spre -X (spate); dreapta invers
      parts.push({ pivot, apply: (p, c) => { p.rotation.y = (side === 'L' ? 1 : -1) * 1.2 * (1 - c[k].pos); } });
      animated.add(k);
    }
    for (const p of mt.per) { // triunghiurile oglinzilor dispar din caroserie
      const g = p.m.geometry.clone();
      g.setIndex(p.K);
      p.m.geometry = g;
    }

    // Portbagaj pe balamaua din model (boot_dummy la Model 3)
    const boot = model.getObjectByName('boot_dummy');
    if (boot) {
      const rest = boot.quaternion.clone(), axis = new THREE.Vector3(1, 0, 0); // axa laterală în spațiul piesei
      parts.push({ pivot: boot, apply: (p, c) => { p.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromAxisAngle(axis, -1.1 * c.liftgate.pos)); } });
      animated.add('liftgate');
    }
    // Ce nu există ca piesă separată apare ca indicator mic, pe caroserie
    const at = (fx, fy, fz) => new THREE.Vector3(final.min.x + fsize.x * fx, final.min.y + fsize.y * fy, final.min.z + fsize.z * fz);
    for (const [k, p] of [['mirrorL', at(0.64, 0.62, 0.02)], ['mirrorR', at(0.64, 0.62, 0.98)], ['chargePort', at(0.1, 0.62, 0.03)],
      ['liftgate', at(0.04, 0.72, 0.5)], ['winLF', at(0.55, 0.78, 0.08)], ['winLR', at(0.4, 0.78, 0.08)],
      ['winRF', at(0.55, 0.78, 0.92)], ['winRR', at(0.4, 0.78, 0.92)], ['falconL', at(0.4, 0.95, 0.25)], ['falconR', at(0.4, 0.95, 0.75)]]) {
      if (!animated.has(k)) sprites.push({ s: sprite(p, CLOSURE, 14), closure: k });
    }
  }

  // ---- Lumini reale: luminează caroseria și asfaltul, plus fasciculele farurilor ----
  const avg = list => list.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(Math.max(1, list.length));
  const at = keys => { const pts = keys.flatMap(k => anchors[k] || []); return pts.length ? avg(pts) : null; };
  const rig = [];
  const maxOf = (o, keys) => keys.reduce((m, k) => Math.max(m, o[k] || 0), 0);
  for (const side of ['L', 'R']) {
    const head = at([`outer${side}`, `inner${side}`]);
    if (head) {
      const l = new THREE.SpotLight('#fff3dc', 0, 2800, 0.42, 0.65, 0);
      l.position.copy(head);
      l.target.position.copy(head).add(new THREE.Vector3(900, -head.y + 10, side === 'L' ? -60 : 60));
      const beam = beamMesh(head, side);
      scene.add(l, l.target, beam);
      rig.push({ l, k: 2.6, f: o => maxOf(o, [`outer${side}`, `inner${side}`]), beam });
    }
    const tail = at([`tail${side}`]) || at(['brake']);
    if (tail) {
      const l = new THREE.PointLight(RED, 0, 750, 0);
      l.position.copy(tail).add(new THREE.Vector3(-45, -25, 0));
      scene.add(l);
      rig.push({ l, k: 1.6, f: o => Math.max(0.3 * (o[`tail${side}`] || 0), o.brake || 0) });
    }
    for (const [keys, pos, dx] of [[[`fturn${side}`], at([`fturn${side}`]), 40], [[`rturn${side}`, `rep${side}`, `rsm${side}`], at([`rturn${side}`]), -40]]) {
      if (!pos) continue;
      // sub nivelul geamurilor și puțin în afara mașinii, ca să nu se reflecte în parbriz/lunetă
      const l = new THREE.PointLight(AMBER, 0, 380, 0);
      l.position.copy(pos).add(new THREE.Vector3(dx * 2, -45, side === 'L' ? -30 : 30));
      scene.add(l);
      rig.push({ l, k: 0.9, f: o => maxOf(o, keys) });
    }
    const fog = at([`fog${side}`]);
    if (fog) {
      const l = new THREE.SpotLight('#f4f1e6', 0, 1200, 0.7, 0.8, 0);
      l.position.copy(fog);
      l.target.position.copy(fog).add(new THREE.Vector3(500, -fog.y, side === 'L' ? -120 : 120));
      scene.add(l, l.target);
      rig.push({ l, k: 1.4, f: o => o[`fog${side}`] || 0 });
    }
  }
  const rev = at(['reverseL', 'reverseR']);
  if (rev) {
    const l = new THREE.SpotLight('#f4f8ff', 0, 1200, 0.6, 0.7, 0);
    l.position.copy(rev);
    l.target.position.copy(rev).add(new THREE.Vector3(-600, -rev.y, 0));
    scene.add(l, l.target);
    rig.push({ l, k: 1.6, f: o => maxOf(o, ['reverseL', 'reverseR']) });
  }

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // .glb: prag mare, ca reflexiile de pe parbriz/capotă să nu „înflorească”; doar lămpile emisive trec
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), glb ? 0.9 : 1.15, glb ? 0.75 : 0.55, glb ? 1.0 : 0.12));
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
  const PRESETS = { three: [1250, 420, 1080], front: [dist, 260, 0], side: [0, 300, -dist], rear: [-dist, 320, 0], top: [40, dist * 1.25, 0] };
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
  camera.position.copy(center).add(new THREE.Vector3(...PRESETS.three));

  return {
    setPreset,
    attribution,
    lamps: emissive.map(e => ({ name: e.name, keys: e.keys, pos: e.pos?.toArray().map(Math.round) })),
    official: pick.kind === 'official',
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
      for (const e of emissive) {
        let v = 0;
        for (const k of e.keys) v = Math.max(v, (out[k] || 0) * (k.startsWith('tail') ? (e.w?.tail ?? 1) : 1));
        e.mat.emissiveIntensity = v * e.base * 4;
      }
      for (const r of rig) {
        const v = r.f(out);
        r.l.intensity = r.k * v;
        if (r.beam) r.beam.material.uniforms.uOpacity.value = 0.13 * v;
      }
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
