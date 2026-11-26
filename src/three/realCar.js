// Turns a downloaded, artist-made car model (glTF) into an interactive RevEngine car:
// orientation + real-world scale, upgraded PBR materials, and automatically rigged parts
// (wheels, doors, bonnet, lights, wing, exhaust, cabin) that can open and explode.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const HALF = Math.PI / 2;

const RX = {
  junk: /shadow|ground|floor|backdrop|studio|stage|turntable|podium|platform|environment|\bsky\b|^plane\b|plane[._\s]?\d*$/i,
  steer: /steer|lenkrad|volante/i,
  light: /light|lamp|headl|taill|\bled\b|\bdrl\b|faro|indicator|blinker|signal|turn.?sig|reflector/i,
  door: /door|puerta|portiere|t[üu]r\b/i,
  hood: /hood|bonnet|capot|\bcapo\b|motorhaube|frunk/i,
  cover: /trunk|\bboot\b|tailgate|engine.?(cover|lid|hood|bay.?cover)|deck.?lid|liftgate|maletero|rear.?hood/i,
  wing: /wing(?!.?mirror)|spoiler|aler[oó]n/i,
  exhaust: /exhaust|muffler|tail.?pipe|escape|\bexh\b/i,
  wheelEx: /arch|house|well|liner|steer|spare/i,
  wheel: /wheel|tire|tyre|\brims?\b|brake|\bdisc|\bdisk|rotor|calip|\bhub\b|llanta|rueda|felge|reifen|neum|lug|bolt.?wheel|centercap|center.?cap/i,
  glass: /glass|window|windshield|windscreen|vidrio|cristal|verre|scheibe/i,
  interior: /interior|seat|dashboard|\bdash\b|cockpit|pedal|carpet|console|seatbelt|gauge|cabin|asiento|gear.?(stick|shift|lever)|paddle|headliner|speedo|screen|display|airbag|roof.?lining|trim.?in/i,
  tire: /tire|tyre|rubber|reifen|neum/i,
  disc: /\bdisc|\bdisk|rotor|brake(?!.*calip)/i,
  caliper: /calip|pinza|brembo/i,
  rim: /rim|wheel|llanta|felge|spoke|rueda/i,
  mirror: /mirror|espejo|retrov|spiegel/i,
  chrome: /chrome|cromo|chrom|polish/i,
  paint: /paint|lacquer|carrosserie|carroc|\black(ier)?\b|body.?colou?r/i,
  // never the main paint, whatever its area
  notPaint: /carbon|cf_|_cf\b|glass|window|plastic|rubber|tyre|tire|chrome|grille|badge|plate|interior|leather|alcantara|light|lamp|engine|calip|brake|wheel|\brims?\b|chassis|base_material/i,
  carbon: /carbon|cf_|_cf\b/i,
};

// Copy a geometry with plain float attributes (quantised glTF data can't be transformed or merged as is)
const comp = (attr, i, c) => (c === 0 ? attr.getX(i) : c === 1 ? attr.getY(i) : c === 2 ? attr.getZ(i) : attr.getW(i));
function floatGeometry(g, matrix) {
  const ng = new THREE.BufferGeometry();
  const n = g.attributes.position.count;
  for (const [name, attr] of Object.entries(g.attributes)) {
    const size = attr.itemSize;
    const arr = new Float32Array(n * size);
    for (let k = 0; k < n; k++) for (let c = 0; c < size; c++) arr[k * size + c] = comp(attr, k, c);
    ng.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = [];
  if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i));
  else for (let i = 0; i < n; i++) idx.push(i);
  // a mirrored piece (negative scale) is drawn flipped by three.js; once baked, flip its triangles instead
  if (matrix && matrix.determinant() < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  ng.setIndex(idx);
  if (matrix) ng.applyMatrix4(matrix);
  return ng;
}

let flakeTex = null;
function flakes() {
  if (flakeTex) return flakeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 128 + (Math.random() - 0.5) * 120;
    img.data[i + 1] = 128 + (Math.random() - 0.5) * 120;
    img.data[i + 2] = 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  flakeTex = new THREE.CanvasTexture(c);
  flakeTex.wrapS = flakeTex.wrapT = THREE.RepeatWrapping;
  flakeTex.repeat.set(30, 30);
  return flakeTex;
}

// Average brightness and colour spread of a texture (small canvas sample)
function textureStats(tex) {
  const img = tex?.image;
  if (!img) return null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    const n = d.length / 4;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    r /= n * 255; gr /= n * 255; b /= n * 255;
    let spread = 0;
    for (let i = 0; i < d.length; i += 4) spread += Math.abs(d[i] / 255 - r) + Math.abs(d[i + 1] / 255 - gr) + Math.abs(d[i + 2] / 255 - b);
    return { lum: 0.2126 * r + 0.7152 * gr + 0.0722 * b, spread: spread / n };
  } catch {
    return null;
  }
}

// Recolour a paint material to the car's factory colour. A painted texture keeps its
// light/dark detail (panel shading, dirt, decals) via its luminance; a shared texture
// atlas (many colours) is left alone so tyres and lights don't get tinted.
function repaint(mat, hex) {
  if (!hex) return;
  if (!mat.map) { mat.color.set(hex); return; }
  const st = textureStats(mat.map);
  if (!st || st.spread > 0.35) return;
  mat.color.set(hex);
  const ref = Math.max(0.03, Math.pow(st.lum, 2.2));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintRef = { value: ref };
    shader.fragmentShader = `uniform float uPaintRef;\n${shader.fragmentShader.replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float pLum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  diffuseColor.rgb *= clamp( pLum / uPaintRef, 0.0, 2.0 );
  diffuseColor.a *= sampledDiffuseColor.a;
#endif`)}`;
  };
  mat.customProgramCacheKey = () => `repaint-${ref.toFixed(3)}`;
}

const cleanName = (s) => {
  const t = String(s || '')
    .replace(/[_\-.:|]+/g, ' ')
    .replace(/\b(object|mesh|geo|primitive|node|polysurface|default|mat|material|lod\d*|low|high|sketchfab|model|root|gltf|scene|collada|visual|fbx|obj)\b/gi, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 3) return null;
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
};

function textOf(o, stop) {
  const parts = [];
  let p = o;
  while (p && p !== stop) { if (p.name) parts.push(p.name); p = p.parent; }
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  mats.forEach((m) => m && m.name && parts.push(m.name));
  return parts.join(' ');
}

// Split one mesh into several by where each triangle sits (in car space).
// keyOf(x, z, y, a, b, c) returns the bucket name for a triangle (centre x/y/z, corners a/b/c).
function splitMesh(mesh, keyOf) {
  const g = mesh.geometry;
  if (Array.isArray(mesh.material)) return [mesh];
  const pos = g.attributes.position;
  const index = g.index;
  const m = mesh.matrixWorld;
  const a = V3(), b = V3(), c = V3();
  const tri = index ? index.count / 3 : pos.count / 3;
  const buckets = {};
  for (let t = 0; t < tri; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(m);
    b.fromBufferAttribute(pos, i1).applyMatrix4(m);
    c.fromBufferAttribute(pos, i2).applyMatrix4(m);
    const key = keyOf((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, (a.y + b.y + c.y) / 3, a, b, c);
    (buckets[key] || (buckets[key] = [])).push(i0, i1, i2);
  }
  const keys = Object.keys(buckets);
  if (keys.length === 1) { mesh.userData.splitKey = keys[0]; return [mesh]; } // nothing to cut
  const out = [];
  for (const [key, idx] of Object.entries(buckets)) {
    if (!idx.length) continue;
    // keep only the vertices this piece uses, so its bounding box (and centre) is its own
    const remap = new Map();
    const order = [];
    const newIdx = idx.map((i) => {
      if (!remap.has(i)) { remap.set(i, order.length); order.push(i); }
      return remap.get(i);
    });
    const ng = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const size = attr.itemSize;
      const arr = new Float32Array(order.length * size);
      for (let k = 0; k < order.length; k++) for (let c = 0; c < size; c++) arr[k * size + c] = comp(attr, order[k], c);
      ng.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    ng.setIndex(newIdx);
    ng.computeBoundingBox();
    ng.computeBoundingSphere();
    const nm = new THREE.Mesh(ng, mesh.material);
    nm.name = `${mesh.name}_${key}`;
    nm.userData.splitKey = key;
    nm.position.copy(mesh.position);
    nm.quaternion.copy(mesh.quaternion);
    nm.scale.copy(mesh.scale);
    mesh.parent.add(nm);
    out.push(nm);
  }
  mesh.parent.remove(mesh);
  return out;
}
const splitByQuadrant = (mesh, cx, cz) => splitMesh(mesh, (x, z) => (x > cx ? 'f' : 'r') + (z > cz ? 'r' : 'l'));
const splitBySide = (mesh) => splitMesh(mesh, (x, z) => (z > 0 ? 'r' : 'l'));

const boxOf = (o) => new THREE.Box3().setFromObject(o);

/**
 * @param {object} o  { slug, cfg, design, info, proc (procedural car for internals), onProgress }
 */
export async function loadRealCar({ slug, cfg, design, info, proc, onProgress, url }) {
  // per-model name patterns (src/data/realModels.js `rx`) override the built-in ones
  const R = { ...RX, ...(cfg.rx || {}) };
  const gltf = await loader.loadAsync(url || `${import.meta.env.BASE_URL}models/${slug}.glb`, (e) => onProgress?.(e.total ? e.loaded / e.total : 0));
  const model = gltf.scene;
  const root = new THREE.Group();
  root.name = slug;
  const holder = new THREE.Group();
  holder.add(model);
  root.add(holder);
  root.updateMatrixWorld(true);

  // ---------------- clean up: drop lights/cameras and ground planes / backdrops shipped with some models
  const extras = [];
  model.traverse((o) => { if (o.isLight || o.isCamera) extras.push(o); });
  extras.forEach((o) => o.parent?.remove(o));
  let meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const all = new THREE.Box3();
  meshes.forEach((m) => all.union(boxOf(m)));
  const allSize = all.getSize(V3());
  meshes.forEach((m) => {
    const s = boxOf(m).getSize(V3());
    const flat = s.y < 0.01 * Math.max(s.x, s.z);
    const huge = s.x > allSize.x * 0.98 && s.z > allSize.z * 0.98;
    const wide = s.x > allSize.x * 0.9 && s.z > allSize.z * 0.9;
    const t = textOf(m, model);
    if ((R.junk.test(t) && (flat || wide)) || (flat && huge) || (cfg.hide && cfg.hide.test(t))) m.parent.remove(m);
  });
  meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });

  // ---------------- orientation: length along +X, front facing +X
  root.updateMatrixWorld(true);
  let box = new THREE.Box3();
  meshes.forEach((m) => box.union(boxOf(m)));
  let size = box.getSize(V3());
  let yaw = cfg.yaw;
  if (yaw == null) {
    yaw = size.z > size.x ? HALF : 0;
    holder.rotation.y = yaw;
    root.updateMatrixWorld(true);
    // taillights are red: they must end up at the back (-X)
    let sx = 0, n = 0;
    meshes.forEach((m) => {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const red = mats.some((mt) => mt && mt.color && mt.color.r > 0.45 && mt.color.g < 0.2 && mt.color.b < 0.2 && (mt.transparent || R.light.test(mt.name || '')));
      if (red || /tail|rear.?light|brake.?light|stop.?light/i.test(textOf(m, model))) {
        sx += boxOf(m).getCenter(V3()).x; n++;
      }
    });
    if (n && sx / n > 0) yaw += Math.PI;
    else if (!n) {
      let hx = 0, hn = 0;
      meshes.forEach((m) => { if (/head.?l|front.?light|headlamp/i.test(textOf(m, model))) { hx += boxOf(m).getCenter(V3()).x; hn++; } });
      if (hn && hx / hn < 0) yaw += Math.PI;
    }
  }
  holder.rotation.y = yaw;
  root.updateMatrixWorld(true);
  box = new THREE.Box3();
  meshes.forEach((m) => box.union(boxOf(m)));
  size = box.getSize(V3());
  const scale = (design.dims.L / size.x) * (cfg.scale || 1);
  holder.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  box = new THREE.Box3();
  meshes.forEach((m) => box.union(boxOf(m)));
  const ctr = box.getCenter(V3());
  holder.position.set(-ctr.x, -box.min.y + (cfg.lift || 0), -ctr.z);
  root.updateMatrixWorld(true);
  box = new THREE.Box3();
  meshes.forEach((m) => box.union(boxOf(m)));
  size = box.getSize(V3());
  const L = size.x, W = size.z, H = size.y;

  // ---------------- classify meshes
  const cat = new Map();
  const matsOf = (m) => (Array.isArray(m.material) ? m.material : [m.material]).filter(Boolean);
  // red see-through "glass" is a tail-light lens
  const redLens = (m, t) => /red.?glass/i.test(t) || matsOf(m).some((mt) => mt.color && mt.color.r > 0.12 && mt.color.r > 5 * mt.color.g && mt.color.r > 5 * mt.color.b);
  const classify = (m) => {
    const t = textOf(m, model);
    if (R.steer.test(t)) return 'interior';
    if (R.light.test(t)) return 'light';
    if (R.door.test(t)) return 'door';
    if (R.hood.test(t)) return 'hood';
    if (R.cover.test(t)) return 'cover';
    if (R.exhaust.test(t)) return 'exhaust';
    if (R.wing.test(t)) return 'wing';
    if (R.wheel.test(t) && !R.wheelEx.test(t)) return 'wheel';
    if (R.glass.test(t)) return redLens(m, t) ? 'light' : 'glass';
    if (R.interior.test(t)) return 'interior';
    return 'body';
  };
  meshes.forEach((m) => cat.set(m, classify(m)));
  // swap a mesh for the pieces it was split into; c is a category or (piece) => category
  const replace = (m, parts, c) => {
    cat.delete(m);
    parts.forEach((p) => cat.set(p, typeof c === 'function' ? c(p) : c));
    meshes.splice(meshes.indexOf(m), 1, ...parts);
  };

  // ---------------- wheels by geometry. Only the tyres touch the ground, so their contact patches
  // give each wheel's position; the wheel is the tyre-radius cylinder around that axle.
  const cyl = {};
  {
    const pts = { fr: [], fl: [], rr: [], rl: [] };
    const v = V3();
    const yMax = 0.012 * H + 0.006;
    meshes.forEach((m) => {
      if (boxOf(m).min.y > yMax) return;
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (v.y <= yMax && Math.abs(v.x) > 0.15 * L && Math.abs(v.z) > 0.15 * W) pts[(v.x > 0 ? 'f' : 'r') + (v.z > 0 ? 'r' : 'l')].push(v.x, v.z);
      }
    });
    for (const [k, p] of Object.entries(pts)) {
      if (p.length < 6) continue;
      const xs = p.filter((_, i) => i % 2 === 0).sort((a, b) => a - b);
      let z0 = Infinity, z1 = -Infinity;
      for (let i = 1; i < p.length; i += 2) { z0 = Math.min(z0, p[i]); z1 = Math.max(z1, p[i]); }
      const r = (k[0] === 'f' ? design.dims.rf : design.dims.rr) || 0.34;
      // the contact patch is the tread; reach outwards for the sidewall, inwards for brake and hub
      const outer = k[1] === 'r';
      cyl[k] = { x: xs[xs.length >> 1], y: r, r: r * 1.04, zMin: outer ? z0 - 0.16 : z0 - 0.07, zMax: outer ? z1 + 0.07 : z1 + 0.16 };
    }
  }
  const haveCyl = Object.keys(cyl).length === 4;
  const inCyl = (x, z, y) => {
    for (const k in cyl) {
      const c = cyl[k];
      if (z >= c.zMin && z <= c.zMax && Math.hypot(x - c.x, y - c.y) < c.r) return k;
    }
    return null;
  };

  if (haveCyl) {
    // meshes that reach into several wheels come from models merged by material (all four tyres, or
    // tyres + bumpers, in one object): cut the wheels out of them. Something inside a single wheel
    // (a brake duct, a hub) is left alone; a wheel-named mesh near no wheel (the spare) becomes body.
    const boxes = Object.values(cyl).map((c) => new THREE.Box3(V3(c.x - c.r, 0, c.zMin), V3(c.x + c.r, c.y + c.r, c.zMax)));
    for (const m of [...meshes]) {
      const c = cat.get(m);
      if (c !== 'wheel' && c !== 'body') continue;
      const b = boxOf(m);
      const hits = boxes.filter((cb) => cb.intersectsBox(b)).length;
      if (c === 'wheel' && hits === 0) { cat.set(m, 'body'); continue; }
      if (hits < 2) continue;
      // tyre-type meshes: a triangle belongs to the wheel its centre is in. Body meshes: only when
      // all three corners are inside, so big arch-liner triangles poking into the wheel stay put
      const keyOf = c === 'wheel'
        ? (x, z, y) => inCyl(x, z, y) || 'keep'
        : (x, z, y, a, b, t) => { const k = inCyl(a.x, a.z, a.y); return k && inCyl(b.x, b.z, b.y) === k && inCyl(t.x, t.z, t.y) === k ? k : 'keep'; };
      replace(m, splitMesh(m, keyOf), (p) => {
        const k = p.userData.splitKey;
        return !k ? c : k === 'keep' ? 'body' : 'wheel'; // no key: multi-material mesh, left whole
      });
    }
  } else {
    // geometric fallback for wheels when names don't say "wheel"
    const wheelCount = [...cat.values()].filter((c) => c === 'wheel').length;
    if (wheelCount < 4) {
      meshes.forEach((m) => {
        if (cat.get(m) !== 'body') return;
        const b = boxOf(m), s = b.getSize(V3()), c = b.getCenter(V3());
        const round = Math.abs(s.x - s.y) < 0.25 * Math.max(s.x, s.y) && s.y > 0.35 && s.y < 1.1;
        const corner = Math.abs(c.x) > 0.18 * L && Math.abs(c.z) > 0.2 * W && c.y < 0.65;
        const spans = s.x > 0.5 * L || s.z > 0.6 * W;
        if ((round && corner) || (spans && /rubber|tire|tyre|rim|wheel|black/i.test(textOf(m, model)) && c.y < 0.6)) cat.set(m, 'wheel');
      });
    }
    // split wheel meshes that contain several wheels at once
    for (const m of [...meshes]) {
      if (cat.get(m) !== 'wheel') continue;
      const s = boxOf(m).getSize(V3());
      if (s.x > 0.45 * L || s.z > 0.55 * W) replace(m, splitByQuadrant(m, 0, 0), 'wheel');
    }
  }

  // lamp meshes running the whole length of the car (head + tail lights in one object): cut front from rear
  for (const m of [...meshes]) {
    if (cat.get(m) === 'light' && boxOf(m).getSize(V3()).x > 0.5 * L) replace(m, splitMesh(m, (x) => (x > 0 ? 'f' : 'r')), 'light');
  }
  // split door and lamp meshes that hold both sides at once (left + right in one object)
  for (const m of [...meshes]) {
    const c = cat.get(m);
    if (c !== 'door' && c !== 'light') continue;
    const b = boxOf(m);
    if (Math.abs(b.getCenter(V3()).z) < 0.12 * W && b.getSize(V3()).z > 0.5 * W) replace(m, splitBySide(m), c);
  }
  root.updateMatrixWorld(true);

  // ---------------- materials
  const matCache = new Map();
  const upgrade = (mat, kind) => {
    if (!mat) return mat;
    const key = `${mat.uuid}|${kind}`;
    if (matCache.has(key)) return matCache.get(key);
    let out = mat;
    const base = {
      color: mat.color?.clone(), map: mat.map || null, normalMap: mat.normalMap || null, normalScale: mat.normalScale?.clone(),
      roughnessMap: mat.roughnessMap || null, metalnessMap: mat.metalnessMap || null, aoMap: mat.aoMap || null,
      emissive: mat.emissive?.clone(), emissiveMap: mat.emissiveMap || null, emissiveIntensity: mat.emissiveIntensity ?? 1,
      alphaMap: mat.alphaMap || null, side: mat.side, name: mat.name,
    };
    if (kind === 'paint') {
      out = new THREE.MeshPhysicalMaterial({
        ...base, metalness: Math.min(0.85, Math.max(0.35, mat.metalness ?? 0.5)), roughness: Math.min(mat.roughness ?? 0.4, 0.34),
        clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.05,
      });
      if (!out.normalMap && cfg.flakes !== false) { out.normalMap = flakes(); out.normalScale = new THREE.Vector2(0.035, 0.035); }
      if (!cfg.keepPaint) repaint(out, design.paint);
    } else if (kind === 'glass') {
      const c = (mat.color || new THREE.Color('#111')).clone().multiplyScalar(0.35);
      out = new THREE.MeshPhysicalMaterial({
        color: c, metalness: 0, roughness: 0.03, transparent: true, opacity: Math.min(0.55, Math.max(0.22, mat.opacity ?? 0.4)),
        envMapIntensity: 1.6, depthWrite: false, side: mat.side, clearcoat: 1, clearcoatRoughness: 0.02, name: mat.name,
      });
    } else if (kind === 'lens') {
      // clear headlamp glass; red or amber lenses keep their tint
      const tint = mat.color && mat.color.r > 0.12 && mat.color.r > 3 * mat.color.g && mat.color.r > 3 * mat.color.b;
      out = new THREE.MeshPhysicalMaterial({
        color: tint ? mat.color.clone() : '#ffffff', metalness: 0, roughness: 0.02, transparent: true,
        opacity: tint ? Math.max(0.5, mat.opacity ?? 0.5) : Math.min(0.3, mat.opacity ?? 0.3),
        envMapIntensity: 1.6, depthWrite: false, side: mat.side, name: mat.name,
      });
    } else if (kind === 'chrome') {
      out = mat.clone(); out.metalness = 1; out.roughness = Math.min(out.roughness ?? 0.1, 0.07);
    } else if (kind === 'rubber') {
      out = mat.clone(); out.metalness = 0; out.roughness = Math.max(out.roughness ?? 0.85, 0.82);
    } else if (kind === 'carbon') {
      out = new THREE.MeshPhysicalMaterial({ ...base, metalness: 0.3, roughness: Math.min(mat.roughness ?? 0.4, 0.4), clearcoat: 1, clearcoatRoughness: 0.06 });
    } else {
      out = mat.clone();
    }
    if ('envMapIntensity' in out && kind !== 'glass' && kind !== 'lens' && kind !== 'paint') out.envMapIntensity = 1;
    if (cfg.frontSide && !out.transparent) { if (out === mat) out = mat.clone(); out.side = THREE.FrontSide; }
    matCache.set(key, out);
    return out;
  };
  // main paint = the body material covering the largest area
  const area = new Map();
  meshes.forEach((m) => {
    if (cat.get(m) !== 'body' && cat.get(m) !== 'door' && cat.get(m) !== 'hood') return;
    const s = boxOf(m).getSize(V3());
    const a = s.x * s.y + s.y * s.z + s.x * s.z;
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => {
      if (!mt || mt.transparent || (mt.metalness ?? 0) > 0.95) return;
      const l = mt.color ? mt.color.r + mt.color.g + mt.color.b : 0;
      if (l < 0.06 && !R.paint.test(mt.name || '')) return; // black plastics are not paint
      area.set(mt, (area.get(mt) || 0) + a);
    });
  });
  const paintMats = new Set();
  if (cfg.paint) {
    // explicit per-model choice of the paint material(s)
    meshes.forEach((m) => (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => { if (mt && cfg.paint.test(mt.name || '')) paintMats.add(mt); }));
  } else {
    // a material named as paint wins; otherwise the biggest body material that isn't trim
    const named = [...area.keys()].filter((mt) => R.paint.test(mt.name || '') && !R.notPaint.test(mt.name || ''));
    if (named.length) named.forEach((mt) => paintMats.add(mt));
    else {
      const top = [...area.entries()].filter(([mt]) => !R.notPaint.test(mt.name || '')).sort((a, b) => b[1] - a[1])[0];
      if (top) paintMats.add(top[0]);
    }
  }

  const kindOf = (m, mt) => {
    const t = `${textOf(m, model)} ${mt?.name || ''}`;
    const c = cat.get(m);
    if (!mt) return 'other';
    // a wheel that shares the body material (one atlas for everything) keeps its own colours
    if (paintMats.has(mt)) return c === 'wheel' ? 'other' : 'paint';
    if (R.carbon.test(mt.name || '')) return 'carbon';
    if (c === 'light' && ((mt.transparent && (mt.opacity ?? 1) < 0.9) || R.glass.test(t) || /lens/i.test(t))) return 'lens';
    if (R.glass.test(mt.name || '') || (mt.transparent && (mt.opacity ?? 1) < 0.9 && c !== 'light')) return 'glass';
    if (R.tire.test(mt.name || '') || (c === 'wheel' && R.tire.test(t) && !R.rim.test(mt.name || ''))) return 'rubber';
    if (R.chrome.test(mt.name || '') || ((mt.metalness ?? 0) > 0.9 && (mt.roughness ?? 1) < 0.25)) return 'chrome';
    return 'other';
  };
  meshes.forEach((m) => {
    if (Array.isArray(m.material)) m.material = m.material.map((mt) => upgrade(mt, kindOf(m, mt)));
    else m.material = upgrade(m.material, kindOf(m, m.material));
    m.castShadow = true;
    m.receiveShadow = true;
  });

  // ---------------- parts
  const parts = new Map();
  const pickables = [];
  const exterior = [];
  const addPart = (id, def) => { const p = { id, meshes: [], pieces: [], moves: [], xray: false, ...def }; parts.set(id, p); return p; };
  const tag = (m, partId, hover, ext) => {
    m.userData.partId = partId;
    m.userData.hover = hover;
    if (ext) { m.userData.exterior = true; exterior.push(m); }
    if (m.geometry.index && m.geometry.index.count > 3000 && !m.geometry.boundsTree && m.geometry.computeBoundsTree) {
      try { m.geometry.computeBoundsTree(); } catch { /* picking falls back to brute force */ }
    }
    pickables.push(m);
  };
  const labelFor = (m, fallback) => cleanName(m.name) || cleanName(m.parent?.name) || fallback;

  // wheels
  const spins = [];
  const corners = { fr: [], fl: [], rr: [], rl: [] };
  meshes.forEach((m) => {
    if (cat.get(m) !== 'wheel') return;
    const c = boxOf(m).getCenter(V3());
    if (c.y > 0.9 || Math.abs(c.z) < 0.15 * W) { cat.set(m, 'body'); return; }
    corners[(c.x > 0 ? 'f' : 'r') + (c.z > 0 ? 'r' : 'l')].push(m);
  });
  // piece type from its name, else from its material (dark and matte = tyre)
  const typeOf = (m) => {
    const t = textOf(m, model);
    if (R.caliper.test(t)) return 'caliper';
    if (R.tire.test(t)) return 'tyre';
    if (R.disc.test(t)) return 'disc';
    if (R.rim.test(t)) return 'rim';
    const mt = matsOf(m)[0];
    if (!mt?.color) return 'other';
    let lum = 0.2126 * mt.color.r + 0.7152 * mt.color.g + 0.0722 * mt.color.b;
    if (mt.map) { const st = textureStats(mt.map); if (st) lum *= Math.pow(st.lum, 2.2); }
    return lum < 0.03 && (mt.metalness ?? 0) < 0.6 ? 'tyre' : 'rim';
  };
  const wheelNames = { fr: 'Front-right wheel', fl: 'Front-left wheel', rr: 'Rear-right wheel', rl: 'Rear-left wheel' };
  Object.entries(corners).forEach(([key, list0]) => {
    if (!list0.length) return;
    const side = key[1] === 'r' ? 1 : -1;
    const front = key[0] === 'f';
    list0.forEach((m) => { m.userData.wheelType = typeOf(m); });
    // spin axis: the wheel's own box (calipers left out) when it is round, else the ground-contact
    // cylinder, else the biggest piece
    const ub = new THREE.Box3();
    list0.forEach((m) => { if (m.userData.wheelType !== 'caliper') ub.union(boxOf(m)); });
    const us = ub.getSize(V3());
    let center;
    if (!ub.isEmpty() && us.y > 0.4 && us.y < 1.2 && Math.abs(us.x - us.y) < 0.2 * us.y) center = ub.getCenter(V3());
    else if (cyl[key]) center = V3(cyl[key].x, cyl[key].y, ub.isEmpty() ? (side * W) / 2 - 0.2 : ub.getCenter(V3()).z);
    else {
      let big = null, bigSize = 0;
      list0.forEach((m) => { const s = boxOf(m).getSize(V3()); const d = Math.max(s.x, s.y); if (d > bigSize) { bigSize = d; big = m; } });
      center = boxOf(big).getCenter(V3());
    }
    const pivot = new THREE.Group();
    pivot.position.copy(center);
    root.add(pivot);
    root.updateMatrixWorld(true);
    const fixed = new THREE.Group();
    pivot.add(fixed);

    // some models build a wheel from hundreds of tiny pieces: merge them into one mesh per type and
    // material (same look, far fewer draw calls)
    const inv = pivot.matrixWorld.clone().invert();
    const groups = new Map();
    list0.forEach((m) => {
      const mt = Array.isArray(m.material) ? null : m.material;
      const k = mt && list0.length > 8 ? `${m.userData.wheelType}|${mt.uuid}|${Object.keys(m.geometry.attributes).sort().join()}` : m.uuid;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    });
    const list = [];
    groups.forEach((g) => {
      if (g.length < 2) { list.push(g[0]); return; }
      let merged = null;
      try { merged = mergeGeometries(g.map((m) => floatGeometry(m.geometry, inv.clone().multiply(m.matrixWorld))), false); } catch { merged = null; }
      if (!merged) { list.push(...g); return; }
      const mm = new THREE.Mesh(merged, g[0].material);
      mm.name = g[0].name;
      mm.userData.wheelType = g[0].userData.wheelType;
      mm.castShadow = mm.receiveShadow = true;
      pivot.add(mm);
      g.forEach((m) => { m.parent?.remove(m); cat.delete(m); meshes.splice(meshes.indexOf(m), 1); });
      cat.set(mm, 'wheel');
      meshes.push(mm);
      list.push(mm);
    });

    const id = `wheel-${key}`;
    const part = addPart(id, { key: 'wheels', name: wheelNames[key] });
    const seen = new Set();
    const tyreSpec = front ? info.tyreF : info.tyreR;
    list.forEach((m) => {
      const type = m.userData.wheelType;
      const isCal = type === 'caliper';
      (isCal ? fixed : pivot).attach(m);
      let dir, label = null;
      if (isCal) dir = V3(0, 0.22, side * 0.36);
      else if (type === 'tyre') dir = V3(0, 0, side * 0.9);
      else if (type === 'disc') dir = V3(0, 0, side * 0.32);
      else if (type === 'rim') dir = V3(0, 0, side * 0.6);
      else dir = V3(0, 0, side * 0.45);
      if (!seen.has(type)) {
        seen.add(type);
        label = { tyre: `Tyre · ${tyreSpec || ''}`, rim: 'Forged alloy wheel', disc: `Brake disc · ${info.brakes || ''}`, caliper: 'Brake caliper', other: labelFor(m, 'Wheel hardware') }[type];
      }
      part.pieces.push({ obj: m, dir, label });
      tag(m, id, `${wheelNames[key]} · ${tyreSpec || ''}`, false);
    });
    spins.push(pivot);
    part.moves.push({ obj: pivot, pos: pivot.position.clone().add(V3(0, 0.05, side * 0.3)) });
    part.focus = { target: center.clone().add(V3(0, 0.15, side * 0.75)), dir: V3(front ? 0.4 : -0.4, 0.32, side), dist: 3.7 };
  });

  // doors
  for (const side of [1, -1]) {
    const list = meshes.filter((m) => cat.get(m) === 'door' && Math.sign(boxOf(m).getCenter(V3()).z) === side);
    if (!list.length) continue;
    const b = new THREE.Box3();
    list.forEach((m) => b.union(boxOf(m)));
    const pivot = new THREE.Group();
    pivot.position.set(b.max.x, (b.min.y + b.max.y) / 2, side > 0 ? b.max.z : b.min.z);
    root.add(pivot);
    root.updateMatrixWorld(true);
    const id = side > 0 ? 'door-r' : 'door-l';
    const part = addPart(id, { key: 'doors', name: side > 0 ? 'Right door' : 'Left door' });
    let biggest = null, bv = 0;
    list.forEach((m) => { const s = boxOf(m).getSize(V3()); const v = s.x * s.y; if (v > bv) { bv = v; biggest = m; } });
    const seen = new Set();
    list.forEach((m) => {
      pivot.attach(m);
      const t = textOf(m, model);
      let dir, label = null;
      if (R.glass.test(t)) { dir = V3(0, 0.42, side * 0.22); if (!seen.has('g')) { seen.add('g'); label = 'Door window glass'; } }
      else if (m === biggest) { dir = V3(0, 0.04, side * 0.5); label = 'Door skin'; }
      else if (R.mirror.test(t)) { dir = V3(0.05, 0.16, side * 0.42); if (!seen.has('m')) { seen.add('m'); label = 'Side mirror'; } }
      else { dir = V3(0, 0.02, side * (0.2 + Math.random() * 0.15)); if (!seen.has('o')) { seen.add('o'); label = labelFor(m, 'Door trim'); } }
      part.pieces.push({ obj: m, dir, label });
      tag(m, id, `${side > 0 ? 'Right' : 'Left'} door · ${info.doors || 'click to open'}`, true);
    });
    const open = design.doorType === 'scissor' ? new THREE.Euler(0, side * 0.1, -1.15)
      : design.doorType === 'dihedral' ? new THREE.Euler(-side * 0.3, side * 0.45, -0.95)
        : new THREE.Euler(0, side * 1.0, 0);
    part.moves.push({ obj: pivot, rot: open });
    part.focus = { target: b.getCenter(V3()).add(V3(0, 0.15, side * 0.45)), dir: V3(-0.25, 0.38, side), dist: 4.8 };
  }

  // lids, found by position rather than name (artists call a rear engine lid "hood" and a frunk "trunk"):
  // the front lid always opens for the X-ray engine; the rear lid does too on mid/rear-engined cars
  const engineAtRear = design.engine.position === 'mid' || design.engine.position === 'rear';
  const lidMeshes = meshes.filter((m) => cat.get(m) === 'hood' || cat.get(m) === 'cover');
  const makeLid = (list, front) => {
    if (!list.length) return null;
    const b = new THREE.Box3();
    list.forEach((m) => b.union(boxOf(m)));
    const pivot = new THREE.Group();
    pivot.position.set(front ? b.min.x : b.max.x, b.max.y - 0.02, 0);
    root.add(pivot);
    root.updateMatrixWorld(true);
    list.forEach((m) => pivot.attach(m));
    return { pivot, list, rot: new THREE.Euler(0, 0, front ? 0.9 : -0.9) };
  };
  const frontList = lidMeshes.filter((m) => boxOf(m).getCenter(V3()).x > 0);
  const rearList = lidMeshes.filter((m) => !frontList.includes(m));
  const hood = makeLid(frontList, true);
  const cover = engineAtRear ? makeLid(rearList, false) : null;

  // lights
  const headPart = addPart('lights-front', { key: 'lights', name: 'Headlights', hover: `Headlights · ${info.lights || ''}` });
  const tailPart = addPart('lights-rear', { key: 'lights', name: 'Tail lights', hover: 'Tail lights' });
  const headMats = new Set();
  const tailMats = new Set();
  const headCandidates = [];
  meshes.filter((m) => cat.get(m) === 'light').forEach((m) => {
    const c = boxOf(m).getCenter(V3());
    const front = c.x > 0;
    const part = front ? headPart : tailPart;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const isLens = mats.some((mt) => mt && mt.transparent);
    part.pieces.push({ obj: m, dir: V3((front ? 1 : -1) * (isLens ? 0.42 : 0.24), isLens ? 0.06 : 0.02, 0), label: null });
    tag(m, part.id, part.hover, true);
    if (front && c.y > 0.25 && c.y < 1.3) headCandidates.push({ m, c });
  });
  // lamp emitters: bright, red or textured lamp materials (not lenses, housings or chrome).
  // A material used at both ends (one lamp texture for the whole car) belongs to the end where
  // most of its meshes sit: front = headlights, rear = tail lights.
  const votes = new Map();
  const vote = (m, mt) => votes.set(mt, (votes.get(mt) || 0) + Math.sign(boxOf(m).getCenter(V3()).x));
  if (cfg.lamps) {
    // explicit per-model choice (may include a red lens that should glow)
    meshes.forEach((m) => matsOf(m).forEach((mt) => { if (cfg.lamps.test(mt.name || '')) vote(m, mt); }));
  } else {
    // only materials used mostly on lamps (not the cabin trim or badges a lamp happens to share)
    const use = new Map();
    meshes.forEach((m) => matsOf(m).forEach((mt) => { const u = use.get(mt) || [0, 0]; u[cat.get(m) === 'light' ? 0 : 1]++; use.set(mt, u); }));
    meshes.filter((m) => cat.get(m) === 'light').forEach((m) => matsOf(m).forEach((mt) => {
      const bright = mt.color && mt.color.r + mt.color.g + mt.color.b > 1.2;
      const red = mt.color && mt.color.r > 0.12 && mt.color.r > 4 * mt.color.g && mt.color.r > 4 * mt.color.b;
      if (use.get(mt)[0] < use.get(mt)[1]) return;
      if ((mt.transparent && mt.opacity < 0.9 && !red) || /plastic|chrome|housing|black|rubber|carbon|trim|badge|logo|emblem|interior/i.test(mt.name || '')) return;
      if (mt.map || ((mt.metalness ?? 0) < 0.85 && (bright || red))) vote(m, mt);
    }));
  }
  votes.forEach((v, mt) => { if (mt.emissive) (v >= 0 ? headMats : tailMats).add(mt); });
  [...headMats, ...tailMats].forEach((mt) => {
    mt.userData.emissive0 = mt.emissive.clone();
    mt.userData.emissiveIntensity0 = mt.emissiveIntensity;
    mt.userData.emissiveMap0 = mt.emissiveMap;
  });
  const firstLabel = (part, text) => { const p = part.pieces[0]; if (p) p.label = text; const lens = part.pieces.find((x) => x.dir.x * x.dir.x > 0.1); if (lens && lens !== p) lens.label = `${text.split(' ')[0]} lens`; };
  firstLabel(headPart, 'Headlamp unit');
  firstLabel(tailPart, 'Tail lamp unit');
  headPart.focus = { target: V3(L / 2 + 0.05, design.head.y, 0), dir: V3(1, 0.32, 0.6), dist: 4.0 };
  tailPart.focus = { target: V3(-L / 2 - 0.05, design.tail.y, 0), dir: V3(-1, 0.32, 0.6), dist: 4.0 };
  if (!headPart.pieces.length) parts.delete('lights-front');
  if (!tailPart.pieces.length) parts.delete('lights-rear');

  // headlight positions for the night light pools
  let headlightPos;
  if (headCandidates.length >= 2) {
    const r = headCandidates.reduce((a, b) => (b.c.z > a.c.z ? b : a));
    const l = headCandidates.reduce((a, b) => (b.c.z < a.c.z ? b : a));
    headlightPos = [V3(boxOf(r.m).max.x, r.c.y, r.c.z), V3(boxOf(l.m).max.x, l.c.y, l.c.z)];
  } else {
    const z = (design.head.z * W) / 2;
    headlightPos = [V3(L / 2 - 0.05, design.head.y, z), V3(L / 2 - 0.05, design.head.y, -z)];
  }
  // the light colour switches with the scene: headlights on at night
  const glowFallback = new THREE.Group();
  headlightPos.forEach((p) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff6e8').multiplyScalar(6) }));
    s.position.copy(p).add(V3(-0.03, 0, 0));
    glowFallback.add(s);
  });
  glowFallback.visible = false;
  root.add(glowFallback);
  const setEmissiveMap = (mt, map) => { if (mt.emissiveMap !== map) { mt.emissiveMap = map; mt.needsUpdate = true; } };
  const restore = (mt) => {
    mt.emissive.copy(mt.userData.emissive0);
    mt.emissiveIntensity = mt.userData.emissiveIntensity0;
    setEmissiveMap(mt, mt.userData.emissiveMap0);
  };
  // a textured lamp glows with its own texture (white LEDs stay white, red lenses stay red);
  // a red lens glows red wherever it sits
  const light = (mt, color, intensity) => {
    const red = mt.color && mt.color.r > 0.12 && mt.color.r > 4 * mt.color.g && mt.color.r > 4 * mt.color.b;
    if (mt.map) { setEmissiveMap(mt, mt.map); mt.emissive.set('#ffffff'); mt.emissiveIntensity = intensity * 0.8; }
    else { mt.emissive.set(red ? '#ff1022' : color); mt.emissiveIntensity = intensity; }
  };
  const setHeadlights = (on) => {
    headMats.forEach((mt) => (on ? light(mt, '#fff3e2', 2.4) : restore(mt)));
    tailMats.forEach((mt) => (on ? light(mt, '#ff1022', 2.6) : restore(mt)));
    glowFallback.visible = on && headMats.size === 0;
  };

  // wing, exhaust, cabin
  const wingList = meshes.filter((m) => cat.get(m) === 'wing');
  if (wingList.length) {
    const part = addPart('wing', { key: 'aero', name: 'Rear wing', hover: `Rear wing · ${info.aero || ''}` });
    const b = new THREE.Box3();
    wingList.forEach((m, i) => { b.union(boxOf(m)); part.pieces.push({ obj: m, dir: V3(-0.05, 0.42 + i * 0.03, 0), label: i ? null : labelFor(m, 'Rear wing') }); tag(m, 'wing', part.hover, true); });
    part.focus = { target: b.getCenter(V3()).add(V3(0, 0.25, 0)), dir: V3(-1, 0.7, 0.8), dist: 4.2 };
  }

  const exhaustList = meshes.filter((m) => cat.get(m) === 'exhaust');
  const procEx = proc?.parts.get('exhaust');
  if (exhaustList.length || procEx) {
    const part = addPart('exhaust', { key: 'exhaust', name: 'Exhaust system', xray: true, hover: `Exhaust · ${info.exhaust || ''}` });
    exhaustList.forEach((m, i) => { part.pieces.push({ obj: m, dir: V3(-0.45, 0.04, 0), label: i ? null : 'Tailpipes' }); tag(m, 'exhaust', part.hover, false); });
    part.focus = { target: V3(-L / 2 + 0.9, 0.25, 0), dir: V3(-1, 0.05, 0.9), dist: 4.8 };
  }

  const interiorList = meshes.filter((m) => cat.get(m) === 'interior');
  const interior = addPart('interior', { key: 'interior', name: 'Cabin', xray: true, hover: 'Cabin · click to look inside' });
  const seenI = new Set();
  interiorList.forEach((m) => {
    const t = textOf(m, model);
    let up = 0.5, type = 'other';
    if (/seat|asiento/i.test(t)) { up = 0.95; type = 'Seats'; }
    else if (R.steer.test(t)) { up = 0.8; type = 'Steering wheel'; }
    else if (/dash/i.test(t)) { up = 0.62; type = 'Dashboard'; }
    else if (/screen|display/i.test(t)) { up = 0.75; type = 'Display'; }
    else if (/console/i.test(t)) { up = 0.55; type = 'Centre console'; }
    const label = type !== 'other' && !seenI.has(type) ? type : null;
    if (label) seenI.add(type);
    interior.pieces.push({ obj: m, dir: V3(0, up, 0), label });
    tag(m, 'interior', 'Cabin', false);
  });

  // glass + body
  const onLid = (m) => (hood && hood.list.includes(m)) || (cover && cover.list.includes(m));
  meshes.forEach((m) => {
    const c = cat.get(m);
    if (onLid(m)) return;
    if (c === 'glass') tag(m, 'interior', 'Cabin · click to look inside', true);
    else if (c === 'body' || c === 'hood' || c === 'cover') tag(m, 'chassis', `Body · ${info.chassis || 'click for the chassis'}`, true);
  });
  if (hood) hood.list.forEach((m) => tag(m, 'engine', `${engineAtRear ? 'Front lid' : 'Bonnet'} · click for X-RAY engine`, true));
  if (cover) cover.list.forEach((m) => tag(m, 'engine', 'Engine cover · click for X-RAY engine', true));
  // one-piece bodies (no separate bonnet): the top of the body over the engine still opens the X-ray
  if (!hood || (engineAtRear && !cover)) {
    const n = V3(), p = V3();
    const zone = (h) => {
      if (!h.face) return null;
      n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
      if (n.y < 0.5) return null; // only surfaces facing up
      root.worldToLocal(p.copy(h.point));
      if (!hood && p.x > 0.2 * L) return ['engine', `${engineAtRear ? 'Front lid' : 'Bonnet'} · click for X-RAY engine`];
      if (engineAtRear && !cover && p.x < -0.12 * L) return ['engine', 'Engine cover · click for X-RAY engine'];
      return null;
    };
    meshes.forEach((m) => { if (m.userData.partId === 'chassis') m.userData.zone = zone; });
  }

  // ---------------- engine, chassis and exhaust internals borrowed from the procedural car
  const internals = [];
  if (proc) {
    const eng = proc.parts.get('engine');
    const eg = proc.engineGroup;
    root.add(eg);
    internals.push(eg);
    const engine = addPart('engine', { key: 'engine', name: eng.name, xray: true });
    eng.pieces.forEach((p) => engine.pieces.push(p));
    const rise = eng.moves.find((mv) => mv.obj === eg);
    if (rise) engine.moves.push(rise);
    if (hood) engine.moves.push({ obj: hood.pivot, rot: hood.rot });
    if (cover) engine.moves.push({ obj: cover.pivot, rot: cover.rot });
    engine.focus = eng.focus;
    eg.traverse((o) => { if (o.isMesh) { o.userData.partId = 'engine'; o.userData.hover = eng.name; pickables.push(o); } });

    const ch = proc.parts.get('chassis');
    const cg = ch.pieces[0]?.obj.parent;
    if (cg) {
      root.add(cg);
      internals.push(cg);
      const chassis = addPart('chassis', { key: 'chassis', name: 'Chassis', xray: true, hover: ch.hover });
      ch.pieces.forEach((p) => chassis.pieces.push(p));
      chassis.focus = ch.focus;
      cg.traverse((o) => { if (o.isMesh) { o.userData.partId = 'chassis'; pickables.push(o); } });
    }
    if (procEx) {
      const sys = procEx.pieces[0]?.obj.parent;
      if (sys) {
        const tips = procEx.pieces.find((p) => p.label === 'Tailpipes');
        if (tips) sys.remove(tips.obj);
        root.add(sys);
        internals.push(sys);
        const ex = parts.get('exhaust');
        procEx.pieces.filter((p) => p !== tips).forEach((p) => ex.pieces.push(p));
        sys.traverse((o) => { if (o.isMesh) { o.userData.partId = 'exhaust'; pickables.push(o); } });
      }
    }
    internals.forEach((g) => { g.visible = false; });
  }
  if (!interior.pieces.length) parts.delete('interior');
  interior.focus = { target: V3(0.1 * L, H + 0.35, 0), dir: V3(0.25, 0.9, 0.85), dist: 4.6 };

  root.traverse((o) => { if (o.isMesh && o.material && o.material.transparent) o.castShadow = false; });
  root.updateMatrixWorld(true);

  // debug report: how every mesh was classified (used to tune the regexes per model)
  const debug = {
    yaw, scale,
    meshes: [...cat.entries()].map(([m, c]) => {
      const b = boxOf(m);
      return { cat: c, name: m.name, text: textOf(m, model).slice(0, 120), tris: Math.round((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3), c: b.getCenter(V3()).toArray().map((v) => +v.toFixed(2)), s: b.getSize(V3()).toArray().map((v) => +v.toFixed(2)) };
    }),
    paint: [...paintMats].map((m) => m.name),
    lamps: { head: [...headMats].map((m) => m.name), tail: [...tailMats].map((m) => m.name) },
    cyl,
  };

  return {
    slug, design, root, parts, pickables, exterior, spins, internals, real: true,
    leds: { head: [], tail: [] }, headlightPos, setHeadlights,
    dims: { L, W, H, radius: Math.hypot(L, W, H) / 2 },
    credit: cfg.credit, debug,
  };
}
