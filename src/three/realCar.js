// Turns a downloaded, artist-made car model (glTF) into an interactive RevEngine car:
// orientation + real-world scale, upgraded PBR materials, and automatically rigged parts
// (wheels, doors, bonnet, lights, wing, exhaust, cabin) that can open and explode.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

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
  paint: /paint|carpaint|car_paint|\bbody|coat|exterior|carroc|\black\b|lacquer/i,
  carbon: /carbon|cf_|_cf\b/i,
};

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
// keyOf(x, z) returns the bucket name for a triangle centre.
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
    const key = keyOf((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3);
    (buckets[key] || (buckets[key] = [])).push(i0, i1, i2);
  }
  const comp = (attr, i, c) => (c === 0 ? attr.getX(i) : c === 1 ? attr.getY(i) : c === 2 ? attr.getZ(i) : attr.getW(i));
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
  const gltf = await loader.loadAsync(url || `/models/${slug}.glb`, (e) => onProgress?.(e.total ? e.loaded / e.total : 0));
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
    if (R.glass.test(t)) return 'glass';
    if (R.interior.test(t)) return 'interior';
    return 'body';
  };
  meshes.forEach((m) => cat.set(m, classify(m)));

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
    if (s.x > 0.45 * L || s.z > 0.55 * W) {
      const parts = splitByQuadrant(m, 0, 0);
      cat.delete(m);
      parts.forEach((p) => cat.set(p, 'wheel'));
      meshes.splice(meshes.indexOf(m), 1, ...parts);
    }
  }
  // split door and lamp meshes that hold both sides at once (left + right in one object)
  for (const m of [...meshes]) {
    const c = cat.get(m);
    if (c !== 'door' && c !== 'light') continue;
    const b = boxOf(m);
    if (Math.abs(b.getCenter(V3()).z) < 0.12 * W && b.getSize(V3()).z > 0.5 * W) {
      const parts = splitBySide(m);
      cat.delete(m);
      parts.forEach((p) => cat.set(p, c));
      meshes.splice(meshes.indexOf(m), 1, ...parts);
    }
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
      if (!out.normalMap) { out.normalMap = flakes(); out.normalScale = new THREE.Vector2(0.035, 0.035); }
      if (!cfg.keepPaint) repaint(out, design.paint);
    } else if (kind === 'glass') {
      const c = (mat.color || new THREE.Color('#111')).clone().multiplyScalar(0.35);
      out = new THREE.MeshPhysicalMaterial({
        color: c, metalness: 0, roughness: 0.03, transparent: true, opacity: Math.min(0.55, Math.max(0.22, mat.opacity ?? 0.4)),
        envMapIntensity: 1.6, depthWrite: false, side: mat.side, clearcoat: 1, clearcoatRoughness: 0.02, name: mat.name,
      });
    } else if (kind === 'lens') {
      out = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0.02, transparent: true, opacity: Math.min(0.3, mat.opacity ?? 0.3), envMapIntensity: 1.6, depthWrite: false, side: mat.side, name: mat.name });
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
    const top = [...area.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) paintMats.add(top[0]);
    area.forEach((_, mt) => { const n = mt.name || ''; if (R.paint.test(n) && !R.glass.test(n) && !R.carbon.test(n)) paintMats.add(mt); });
  }

  const kindOf = (m, mt) => {
    const t = `${textOf(m, model)} ${mt?.name || ''}`;
    const c = cat.get(m);
    if (!mt) return 'other';
    if (paintMats.has(mt)) return 'paint';
    if (R.carbon.test(mt.name || '')) return 'carbon';
    if (c === 'light' && (mt.transparent || R.glass.test(t) || /lens/i.test(t))) return 'lens';
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
  const wheelNames = { fr: 'Front-right wheel', fl: 'Front-left wheel', rr: 'Rear-right wheel', rl: 'Rear-left wheel' };
  Object.entries(corners).forEach(([key, list]) => {
    if (!list.length) return;
    const side = key[1] === 'r' ? 1 : -1;
    const front = key[0] === 'f';
    let big = null, bigSize = 0;
    list.forEach((m) => { const s = boxOf(m).getSize(V3()); const d = Math.max(s.x, s.y); if (d > bigSize) { bigSize = d; big = m; } });
    const center = boxOf(big).getCenter(V3());
    const pivot = new THREE.Group();
    pivot.position.copy(center);
    root.add(pivot);
    root.updateMatrixWorld(true);
    const fixed = new THREE.Group();
    pivot.add(fixed);
    const id = `wheel-${key}`;
    const part = addPart(id, { key: 'wheels', name: wheelNames[key] });
    const seen = new Set();
    const tyreSpec = front ? info.tyreF : info.tyreR;
    list.forEach((m) => {
      const t = textOf(m, model);
      const isCal = R.caliper.test(t);
      (isCal ? fixed : pivot).attach(m);
      let dir, label = null, type;
      if (isCal) { type = 'caliper'; dir = V3(0, 0.22, side * 0.36); }
      else if (R.tire.test(t)) { type = 'tyre'; dir = V3(0, 0, side * 0.9); }
      else if (R.disc.test(t)) { type = 'disc'; dir = V3(0, 0, side * 0.32); }
      else if (R.rim.test(t)) { type = 'rim'; dir = V3(0, 0, side * 0.6); }
      else { type = 'other'; dir = V3(0, 0, side * 0.45); }
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
    mats.forEach((mt) => {
      if (!mt || mt.transparent) return;
      if (front) { if ((mt.metalness ?? 0) < 0.85 && mt.color && mt.color.r + mt.color.g + mt.color.b > 1.2) headMats.add(mt); }
      else if (mt.color && mt.color.r > 0.35 && mt.color.g < 0.25) tailMats.add(mt);
    });
  });
  if (cfg.lamps) {
    // explicit per-model choice of the lamp emitter materials (front = headlights, rear = tail lights)
    headMats.clear();
    tailMats.clear();
    meshes.forEach((m) => {
      const front = boxOf(m).getCenter(V3()).x > 0;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => {
        if (mt && !mt.transparent && cfg.lamps.test(mt.name || '')) (front ? headMats : tailMats).add(mt);
      });
    });
  }
  [...headMats, ...tailMats].forEach((mt) => {
    if (mt.emissive) { mt.userData.emissive0 = mt.emissive.clone(); mt.userData.emissiveIntensity0 = mt.emissiveIntensity; }
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
  const restore = (mt) => { mt.emissive.copy(mt.userData.emissive0); mt.emissiveIntensity = mt.userData.emissiveIntensity0; };
  const setHeadlights = (on) => {
    headMats.forEach((mt) => { if (!mt.emissive) return; if (on) { mt.emissive.set('#fff3e2'); mt.emissiveIntensity = 2.4; } else restore(mt); });
    tailMats.forEach((mt) => { if (!mt.emissive) return; if (on) { mt.emissive.set('#ff1022'); mt.emissiveIntensity = 2.6; } else restore(mt); });
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
  };

  return {
    slug, design, root, parts, pickables, exterior, spins, internals, real: true,
    leds: { head: [], tail: [] }, headlightPos, setHeadlights,
    dims: { L, W, H, radius: Math.hypot(L, W, H) / 2 },
    credit: cfg.credit, debug,
  };
}
