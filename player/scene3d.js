// 3D scene: official Tesla models from the xLights project (served locally at /tesla/...) or your own model
// from models/*.glb (served at /models/...). On official models the lamps sit at the exact coordinates from
// xlights_rgbeffects.xml; on your own model the headlight, tail and turn signal materials themselves light up.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';

const VEHICLE_LIFTGATE = new Set(['m3h', 'my', 'myj', 'mx']); // .glb vehicles with a power liftgate/trunk
const BEAM_LAYER = 1; // headlight beams: only cameras that look at them from the side or at an angle
const WHITE = '#f4f8ff', AMBER = '#ffa628', RED = '#ff2b2b', CLOSURE = '#e8c547';

// xLights model name (without the "CT " prefix) -> [emulator key, color]
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

// Your own model (.glb): material -> lamps. Left/right is decided by where the part actually is.
const GLB_LIGHTS = [
  // [material, color, lamps, intensity] — red stays dim so it doesn't saturate to white
  [/front_light/i, WHITE, s => [`outer${s}`, `inner${s}`, `sig${s}`, `c4${s}`], 1.6],
  [/indicator_.f|indicator_lights/i, AMBER, s => [`fturn${s}`], 2],
  [/indicator_.r|light_turn_.r/i, AMBER, s => [`rturn${s}`], 2],
  [/fog/i, WHITE, s => [`fog${s}`], 1.2],
  [/rear_light/i, RED, s => [`tail${s}`, 'brake'], 1.1, { tail: 0.2 }], // tail dim, brake bright
  [/brea?k_?light/i, RED, () => ['brake'], 1.1], // not "brakes1": brake discs
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

// Node positions of an xLights model (single line, segmented polyline or custom model)
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
// Mesh vertex positions in world coordinates (consecutive x, y, z)
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

// Bounding box of the triangles a geometry actually draws. computeBoundingBox() counts every vertex,
// so on a clone with a subset index (a cut-out mirror or liftgate) it spans the whole original mesh.
function drawnBox(g, box = new THREE.Box3()) {
  const P = g.attributes.position, v = new THREE.Vector3();
  for (const i of triIndex(g)) box.expandByPoint(v.fromBufferAttribute(P, i));
  return box;
}

// Zero-length normals turn into NaN in the shader; bloom then smears those pixels over the whole
// image and it renders black (the official Cybertruck has a few). Point them up instead.
function fixNormals(root) {
  root.traverse(o => {
    const n = o.isMesh && o.geometry.attributes.normal;
    if (!n) return;
    for (let i = 0; i < n.count; i++) {
      if (n.getX(i) ** 2 + n.getY(i) ** 2 + n.getZ(i) ** 2 < 1e-12) n.setXYZ(i, 0, 1, 0);
    }
  });
}

// Splits a mesh's triangles into groups (by world-space centroid); new geometries are already in world space
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

// Exterior mirrors: triangles above the wheel line that stick out past the body width
function mirrorTriangles(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const data = [];
  root.traverse(o => { if (o.isMesh && o.visible) data.push({ m: o, W: worldPositions(o), idx: triIndex(o.geometry) }); });
  let half = 0; // half the body width (low, without bumpers)
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

// Headlight beam: additive cone, brighter near the lamp and on its axis, fading at the edges and the end
// (classic fake volumetric light: intensity depends on how head-on we see the cone surface)
function beamMesh(origin, side) {
  const len = 1150, geo = new THREE.ConeGeometry(260, len, 48, 12, true);
  geo.translate(0, -len / 2, 0);
  geo.rotateZ(Math.PI / 2 - 0.07); // apex at the lamp, opening toward +X, slightly down
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
  mesh.layers.set(BEAM_LAYER);
  return mesh;
}

// Ce model 3D folosim pentru fiecare vehicul
export function pickModel(layout, vehicleKey) {
  const custom = layout.custom || [];
  const want = { m3: ['model3'], m3old: ['model3'], m3h: ['model3'], my: ['modely', 'modely-juniper', 'model3'],
    myj: ['modely-juniper', 'modely', 'model3'], mx: ['modelx'] }[vehicleKey] || [];
  const file = want.find(f => custom.includes(f));
  if (file) return { kind: 'glb', file, exact: file === want[0] };
  if (vehicleKey === 'ct') return { kind: 'official', mesh: 'Cybertruck', exact: true };
  return { kind: 'official', mesh: 'Tesla Model S', exact: vehicleKey === 'ms' };
}

// The car: scene, lamps and moving parts. Loaded once, then watched by the 3D view and the 2D views.
export async function loadCar(layout, vehicleKey) {
  const pick = pickModel(layout, vehicleKey);
  const isCT = pick.mesh === 'Cybertruck';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000');
  scene.fog = new THREE.Fog('#000', 2200, 5200);
  const center = isCT ? new THREE.Vector3(0, 170, -1000) : new THREE.Vector3(0, 110, 0);
  let body; // the car itself, for framing the 2D views

  // .glb models have real PBR materials (light paint): night needs much less light
  const glb = pick.kind === 'glb';
  scene.add(new THREE.HemisphereLight('#a9b8cf', '#080808', glb ? 0.6 : 1.25));
  const key = new THREE.DirectionalLight('#dfe6f0', glb ? 0 : 1.5); // .glb: no "moon", clearcoat reflections would bloom
  key.position.set(600, 1200, 800);
  const rim = new THREE.DirectionalLight('#7f93b3', glb ? 0.45 : 1.1);
  rim.position.set(-900, 600, -1200);
  scene.add(key, rim);
  // Slightly wet asphalt: the car's lights reflect in it
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 64), new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.72, metalness: 0.15 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.copy(center).setY(0);
  scene.add(ground);

  const tex = glowTexture();
  const sprites = [];      // {s, get | rgb | closure}
  const emissive = [];     // {mat, keys, base}
  const parts = [];        // {pivot, apply, box}
  const anchors = {};      // lamp key -> positions, for real lights and beams
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
    if (!meshInfo) throw new Error('The official Tesla xLights project is missing (tesla_xlights_show_folder).');
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
    body = car;

    // Moving parts (only Model S has separate parts in the OBJ)
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
        if (vehicleKey === 'mx' && (name === 'Window_LR' || name === 'Window_RR')) continue; // on X the rear window moves with the Falcon Wing door
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
        const weight = k.startsWith('tail') ? 0.4 : 1; // tail lights are much dimmer than the brake
        nodes.forEach(p => sprites.push({ s: sprite(p, color, size), get: o => (o[k] || 0) * weight }));
        anchor([k], nodes[Math.floor(nodes.length / 2)]);
      } else if (BARS[name]) {
        const [k, color] = BARS[name];
        nodes.forEach((p, i) => sprites.push({ s: sprite(p, color, 18), get: o => o[k][i] || 0 }));
      } else if (RGB[name]) {
        nodes.forEach(p => sprites.push({ s: sprite(p, '#ffffff', 60), rgb: RGB[name] }));
      } else if (CLOSURE_KEYS[name] && isCT) {
        // The official Cybertruck is one piece: moving parts show as yellow markers
        sprites.push({ s: sprite(nodes[0], CLOSURE, 34), closure: CLOSURE_KEYS[name] });
      }
    }
  } else {
    // ---- Model propriu .glb ----
    const gltf = await new GLTFLoader().loadAsync(`/models/${pick.file}.glb`);
    const extras = gltf.parser.json.asset?.extras || {};
    if (extras.title) attribution = `${extras.title}${extras.author ? ` by ${extras.author.replace(/\s*\(.*\)/, '')}` : ''}${extras.license ? `, ${extras.license.replace(/\s*\(.*\)/, '')}` : ''}`;
    const model = gltf.scene;
    // Perfectly smooth glass and clearcoat (roughness 0) reflect lights as extremely bright points, which
    // bloom turns into squares. A minimum roughness gives soft reflections, like on a real car.
    model.traverse(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if ('roughness' in m) m.roughness = Math.max(m.roughness, 0.22);
        if ('clearcoatRoughness' in m) m.clearcoatRoughness = Math.max(m.clearcoatRoughness, 0.2);
        // No environment map at night: fully metallic surfaces render pitch black, and so does black
        // paint (Model Y). Keep the shape readable.
        if ('metalness' in m) m.metalness = Math.min(m.metalness, 0.45);
        if (/body|paint|primary/i.test(m.name) && m.color && m.color.getHSL({}).l < 0.16) m.color.setHSL(0.6, 0.06, 0.16);
      }
    });
    model.updateMatrixWorld(true);
    // Orientation from the wheels: forward = +X, left = -Z (like the official models)
    const wp = n => model.getObjectByName(n)?.getWorldPosition(new THREE.Vector3());
    const rf = wp('hub_rf'), rb = wp('hub_rb'), lf = wp('hub_lf');
    const holder = new THREE.Group();
    holder.add(model);
    const hubs = rf && rb && lf;
    if (hubs) {
      const F = rf.clone().sub(rb).normalize(), Lf = lf.clone().sub(rf).normalize();
      const U = new THREE.Vector3().crossVectors(F, Lf).normalize();
      Lf.crossVectors(U, F).normalize(); // re-orthogonalized: left
      const A = new THREE.Matrix4().makeBasis(F, U, Lf.clone().negate());
      holder.quaternion.setFromRotationMatrix(A.invert());
    } else {
      // glTF is Y-up; put the car's length on X
      const s0 = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      if (s0.z > s0.x) holder.rotation.y = Math.PI / 2;
    }
    scene.add(holder);
    body = holder;
    // Scale: a Tesla is ~4.7–5 m long, at the official models' scale (~5 mm per unit), then center
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
    // No named wheels: the front is where the mirrors are (widest points above the wheels)
    if (!hubs) {
      const m = mirrorTriangles(model);
      if (m.count && m.sumX / m.count < 0) { holder.rotation.y += Math.PI; fit(); }
    }
    const final = new THREE.Box3().setFromObject(holder), fsize = final.getSize(new THREE.Vector3());
    center.set(0, fsize.y * 0.42, 0);

    const animated = new Set();
    const meshes = [];
    model.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) meshes.push(o); });
    const L = fsize.x, W = fsize.z, H = fsize.y;

    // Lights, precise version: materials named per lamp (e.g. the Model 3 by Ameer Studio)
    let precise = 0;
    for (const o of meshes) {
      const name = o.material?.name || ''; // match on material only: nodes can also contain black trims
      const rule = GLB_LIGHTS.find(([re]) => re.test(name));
      if (!rule) continue;
      const [, color, keysFor, base = 1, w = {}] = rule;
      const pos = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      const side = pos.z < 0 ? 'L' : 'R';
      // Center piece (e.g. a full-width reverse light): follows both sides
      const keys = Math.abs(pos.z) < 40 ? [...new Set([...keysFor('L'), ...keysFor('R')])] : keysFor(side);
      const mat = o.material.clone();
      mat.emissive = new THREE.Color(color);
      mat.emissiveIntensity = 0;
      o.material = mat;
      emissive.push({ mat, keys, base, w, name, pos });
      anchor(keys, pos);
      if (keys.some(k => /^(outer|tail)/.test(k))) precise++; // a plate or fog lamp alone doesn't make it precise
    }

    // Lights, generic version: "light/lamp" materials split by triangle into front/rear and left/center/right
    if (!precise) {
      for (const o of meshes) {
        const name = o.material?.name || '', c = o.material?.color;
        // red plastic at the rear is a tail light, whatever the material is called (Model Y: "material")
        const red = c && c.r > 0.6 && c.g < 0.2 && c.b < 0.2;
        if (emissive.some(e => e.mat === o.material)) continue;
        if (!(red || /light|lamp|led/i.test(name)) || /glass|night|interior/i.test(name)) continue;
        // lamps sit at the ends of the car; the rest of a "lights" material is trim and stays as it is
        const groups = splitTriangles(o, (cx, cy, cz) => Math.abs(cx) < L * 0.36 || (red && cx > 0) ? 'K'
          : `${cx > 0 ? 'F' : 'R'}${Math.abs(cz) < W * 0.12 ? 'C' : cz < 0 ? 'L' : 'R'}`);
        for (const [g, geo] of Object.entries(groups)) {
          // red away from the rear isn't a lamp; on the Model Y it's a hidden layer that speckles through the paint
          if (g === 'K') { if (!red) scene.add(new THREE.Mesh(geo, o.material)); continue; }
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
    // Model without light materials (e.g. a textured Model X): lamps placed on the body with raycasts
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
    // Amber turn signals at the corners, if the model doesn't have them as a separate material
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

    // Door windows drop into the door (the door's local Z axis is up, in meters)
    for (const [door, k] of [['door_lf', 'winLF'], ['door_lr', 'winLR'], ['door_rf', 'winRF'], ['door_rr', 'winRR']]) {
      model.getObjectByName(door)?.traverse(o => {
        if (!o.isMesh || !/^glass/.test(o.material?.name || '')) return;
        const rest = o.position.z;
        parts.push({ pivot: o, apply: (p, c) => { p.position.z = rest - 0.42 * c[k].pos; } });
        animated.add(k);
      });
    }
    // Mirrors: cut out of the body (widest points above the wheels) and folded backward,
    // around the vertical axis at their base
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
      pieces.forEach(m => drawnBox(m.geometry, mb));
      const pivot = new THREE.Group();
      pivot.position.set((mb.min.x + mb.max.x) / 2, mb.min.y, side === 'L' ? mb.max.z : mb.min.z); // baza oglinzii
      pieces.forEach(m => { m.geometry.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z); pivot.add(m); });
      scene.add(pivot);
      // left (-Z): positive rotation swings the outer end toward -X (rear); right is the opposite
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
      const rest = boot.quaternion.clone(), axis = new THREE.Vector3(1, 0, 0); // lateral axis in the part's space
      parts.push({ pivot: boot, apply: (p, c) => { p.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromAxisAngle(axis, -1.1 * c.liftgate.pos)); } });
      animated.add('liftgate');
    } else if (VEHICLE_LIFTGATE.has(vehicleKey)) {
      // No separate liftgate in the model: cut the rear above the bumper out of the body (like the
      // mirrors) and swing it up around its top edge
      model.updateMatrixWorld(true);
      const pieces = [];
      for (const m of meshes) {
        if (!m.visible) continue;
        const Wp = worldPositions(m), idx = triIndex(m.geometry), gate = [], keep = [];
        for (let i = 0; i < idx.length; i += 3) {
          const a = idx[i] * 3, b = idx[i + 1] * 3, d = idx[i + 2] * 3;
          const x = (Wp[a] + Wp[b] + Wp[d]) / 3, y = (Wp[a + 1] + Wp[b + 1] + Wp[d + 1]) / 3, z = (Wp[a + 2] + Wp[b + 2] + Wp[d + 2]) / 3;
          const hit = x < final.min.x + 0.2 * L && y > final.min.y + 0.45 * H && Math.abs(z) < 0.42 * W;
          (hit ? gate : keep).push(idx[i], idx[i + 1], idx[i + 2]);
        }
        if (!gate.length) continue;
        const g = m.geometry.clone();
        g.setIndex(gate);
        g.applyMatrix4(m.matrixWorld);
        pieces.push(new THREE.Mesh(g, m.material));
        const k = m.geometry.clone();
        k.setIndex(keep);
        m.geometry = k;
      }
      if (pieces.length) {
        const gb = new THREE.Box3();
        pieces.forEach(m => drawnBox(m.geometry, gb));
        const pivot = new THREE.Group();
        pivot.position.set(gb.max.x, gb.max.y, 0); // hinge: top front edge of the liftgate
        pieces.forEach(m => { m.geometry.translate(-pivot.position.x, -pivot.position.y, 0); pivot.add(m); });
        scene.add(pivot);
        parts.push({ pivot, apply: (p, c) => { p.rotation.z = -1.0 * c.liftgate.pos; } }); // rear end swings up
        animated.add('liftgate');
      }
    }
    // Anything that isn't a separate part shows as a small marker on the body
    const at = (fx, fy, fz) => new THREE.Vector3(final.min.x + fsize.x * fx, final.min.y + fsize.y * fy, final.min.z + fsize.z * fz);
    for (const [k, p] of [['mirrorL', at(0.64, 0.62, 0.02)], ['mirrorR', at(0.64, 0.62, 0.98)], ['chargePort', at(0.1, 0.62, 0.03)],
      ['liftgate', at(0.04, 0.72, 0.5)], ['winLF', at(0.55, 0.78, 0.08)], ['winLR', at(0.4, 0.78, 0.08)],
      ['winRF', at(0.55, 0.78, 0.92)], ['winRR', at(0.4, 0.78, 0.92)], ['falconL', at(0.4, 0.95, 0.25)], ['falconR', at(0.4, 0.95, 0.75)]]) {
      if (!animated.has(k)) sprites.push({ s: sprite(p, CLOSURE, 14), closure: k });
    }
  }

  // ---- Real lights: light up the body and the asphalt, plus headlight beams ----
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
      // below the windows and slightly outside the car, so it doesn't reflect in the glass
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

  fixNormals(scene);
  body.updateMatrixWorld(true);
  return {
    scene, center, isCT, glb, attribution, exact: pick.exact,
    bounds: new THREE.Box3().setFromObject(body),
    official: pick.kind === 'official',
    lamps: emissive.map(e => ({ name: e.name, keys: e.keys, pos: e.pos?.toArray().map(Math.round) })),
    update(out, t) {
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
    },
  };
}

function makeRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  return renderer;
}
// .glb: high threshold so glass/hood reflections don't bloom; only emissive lamps pass
const bloom = glb => new UnrealBloomPass(new THREE.Vector2(1, 1), glb ? 0.9 : 1.15, glb ? 0.75 : 0.55, glb ? 1.0 : 0.12);

export function createScene3D(container, car) {
  const { scene, center, isCT } = car;
  const renderer = makeRenderer(container);
  const camera = new THREE.PerspectiveCamera(32, 1, 10, 20000);
  camera.layers.enable(BEAM_LAYER);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.5;
  controls.minDistance = 300;
  controls.maxDistance = 4000;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom(car.glb));
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

  // Camera angles (the car's front faces +X, its left side -Z)
  const dist = isCT ? 2300 : 1700;
  const PRESETS = { three: [1250, 420, 1080], front: [dist, 260, 0], side: [0, 300, -dist], rear: [-dist, 320, 0], top: [40, dist * 1.25, 0] };
  let tween = null;
  function setPreset(name, instant = false) {
    controls.autoRotate = name === 'orbit';
    controls.autoRotateSpeed = 1.2;
    if (name === 'orbit') return;
    const fit = Math.max(1, 1.5 / camera.aspect); // narrow panel (2D + 3D): the camera backs off
    const off = PRESETS[name].map(v => v * fit * (isCT ? 1.35 : 1));
    const to = center.clone().add(new THREE.Vector3(...off));
    if (instant) { camera.position.copy(to); return; }
    tween = { from: camera.position.clone(), to, t0: performance.now() };
  }
  camera.position.copy(center).add(new THREE.Vector3(...PRESETS.three));

  return {
    setPreset,
    attribution: car.attribution,
    lamps: car.lamps,
    official: car.official,
    render(out, t) {
      if (tween) {
        const k = Math.min(1, (performance.now() - tween.t0) / 700), e = 1 - (1 - k) ** 3;
        camera.position.lerpVectors(tween.from, tween.to, e);
        if (k === 1) tween = null;
      }
      car.update(out, t);
      controls.update();
      composer.render();
    },
    dispose() {
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // browsers allow ~16 WebGL contexts; free this one now
      container.innerHTML = '';
    },
  };
}

// Renders the scene once per view, each into its own rectangle of the same target (CSS pixels)
class ViewsPass extends Pass {
  constructor(scene, views) {
    super();
    this.scene = scene;
    this.views = views;
    this.needsSwap = false;
    this.cssWidth = 1; // view rects are in CSS px; the composer's targets are in device px
  }
  render(renderer, writeBuffer, readBuffer) {
    const target = this.renderToScreen ? null : readBuffer;
    const k = target ? target.width / this.cssWidth : 1;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    for (const v of this.views) {
      const [x, y, w, h] = v.rect.map(n => n * k);
      if (target) {
        target.viewport.set(x, y, w, h);
        target.scissor.set(x, y, w, h);
        target.scissorTest = true;
        renderer.setRenderTarget(target); // the renderer reads the target's viewport only here
      } else {
        renderer.setViewport(x, y, w, h);
        renderer.setScissor(x, y, w, h);
        renderer.setScissorTest(true);
      }
      renderer.render(this.scene, v.camera);
    }
    if (target) {
      target.viewport.set(0, 0, target.width, target.height);
      target.scissor.set(0, 0, target.width, target.height);
      target.scissorTest = false;
      renderer.setRenderTarget(target);
    } else {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, this.cssWidth, renderer.domElement.clientHeight);
    }
  }
}

// 2D: the real car seen flat (orthographic) from its left side, the front and the rear, like a blueprint.
// Front faces +X and the left side is -Z, like the official models.
export function createViews2D(container, car) {
  const renderer = makeRenderer(container);
  const size = car.bounds.getSize(new THREE.Vector3()), mid = car.bounds.getCenter(new THREE.Vector3());
  const D = Math.max(size.x, size.z) * 1.5; // camera distance: outside the car, well before the fog
  const view = dir => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, D * 3);
    camera.position.copy(mid).addScaledVector(dir, D);
    camera.lookAt(mid);
    return { camera, rect: [0, 0, 1, 1] };
  };
  const side = view(new THREE.Vector3(0, 0, -1)), front = view(new THREE.Vector3(1, 0, 0)), rear = view(new THREE.Vector3(-1, 0, 0));
  side.camera.layers.enable(BEAM_LAYER);
  const composer = new EffectComposer(renderer), views = new ViewsPass(car.scene, [side, front, rear]);
  composer.addPass(views);
  composer.addPass(bloom(car.glb));
  composer.addPass(new OutputPass());

  // rect in CSS px (WebGL: y from the bottom); the car's bounding box sits centered, a bit of ground below
  const frame = (v, rect, scale) => {
    v.rect = rect;
    const c = v.camera, hw = rect[2] / 2 / scale, h = rect[3] / scale;
    // wheels just above the bottom edge; the room above is for an opened liftgate or Falcon Wing doors
    const bottom = car.bounds.min.y - size.y * 0.05 - mid.y;
    Object.assign(c, { left: -hw, right: hw, bottom, top: bottom + h });
    c.updateProjectionMatrix();
  };
  function resize() {
    const W = container.clientWidth, H = container.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    composer.setSize(W, H);
    views.cssWidth = W;
    const pad = 12, gap = 12;
    const sideW = size.x * 1.06, endW = size.z * 1.12, rowH = size.y * 1.5;
    // side view on top, front and rear next to each other below, all at the same scale
    const scale = Math.min((W - 2 * pad) / sideW, (W - 2 * pad - gap) / (2 * endW), (H - 2 * pad - gap) / (2 * rowH));
    const h = rowH * scale, y0 = (H - 2 * h - gap) / 2, half = (W - gap) / 2;
    frame(side, [0, y0 + h + gap, W, h], scale);
    frame(front, [0, y0, half, h], scale);
    frame(rear, [half + gap, y0, half, h], scale);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  return {
    render(out, t) {
      car.update(out, t);
      composer.render();
    },
    dispose() {
      ro.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
