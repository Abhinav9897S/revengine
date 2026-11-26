// Procedural engines, modelled like the real hardware and finished in real materials:
// cast-aluminium block and heads, wrinkle-finish cam covers with the engine code cast in,
// ringed pistons on I-beam rods, a counterweighted crankshaft and flywheel, heat-tinted
// headers, cast turbo scrolls, ribbed belts and a finned radiator. Each engine is a group of
// "pieces" that fly apart in the exploded view.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M, solid, crinkle, anodized } from './materials.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const P2 = (x, y) => new THREE.Vector2(x, y);
const HALF = Math.PI / 2;

export function bake(geo, { pos, rot, scale } = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0])));
  m.compose(pos ? V3(...pos) : V3(), q, scale ? V3(...scale) : V3(1, 1, 1));
  return geo.applyMatrix4(m);
}

export function mesh(geo, mat, { pos, rot, cast = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = cast;
  return m;
}

const rbox = (w, h, d, r = 0.015) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
// many small baked parts drawn as one mesh
const flat = (geo) => (geo.index ? geo.toNonIndexed() : geo);
const merged = (geos, mat) => mesh(mergeGeometries(geos.map(flat)), mat);

function piece(list, obj, dir, label = null, extra = {}) {
  list.push({ obj, dir, label, ...extra });
  return obj;
}

// ---------------------------------------------------------------- shared part geometry
const geoCache = new Map();
const cached = (key, make) => { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); };

// piston: domed crown, three ring grooves, skirt, hollow underside
function pistonGeo(r) {
  return cached(`piston${r}`, () => {
    const g = 0.0028;
    const pts = [
      P2(0.0001, 0.031), P2(r * 0.6, 0.031), P2(r - 0.003, 0.0295), P2(r, 0.026),
      P2(r, 0.022), P2(r - g, 0.022), P2(r - g, 0.0195), P2(r, 0.0195),
      P2(r, 0.016), P2(r - g, 0.016), P2(r - g, 0.0135), P2(r, 0.0135),
      P2(r, 0.010), P2(r - g, 0.010), P2(r - g, 0.006), P2(r, 0.006),
      P2(r - 0.0006, -0.03), P2(r - 0.006, -0.03), P2(r - 0.006, -0.003), P2(0.0001, -0.003),
    ];
    return new THREE.LatheGeometry(pts, 40);
  });
}

// connecting rod: I-beam outline with small and big end bores, lying across the crank axis (x)
function rodGeo(len) {
  return cached(`rod${len}`, () => {
    const rs = 0.016, rb = 0.03;
    const s = new THREE.Shape();
    s.moveTo(rs, 0);
    s.absarc(0, 0, rs, 0, Math.PI, false);
    s.lineTo(-0.009, -0.03);
    s.lineTo(-0.014, -len + rb * 0.75);
    s.absarc(0, -len, rb, Math.PI * 0.72, Math.PI * 2.28, false);
    s.lineTo(0.009, -0.03);
    s.lineTo(rs, 0);
    const h1 = new THREE.Path(); h1.absarc(0, 0, 0.0095, 0, Math.PI * 2, true);
    const h2 = new THREE.Path(); h2.absarc(0, -len, 0.019, 0, Math.PI * 2, true);
    s.holes.push(h1, h2);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.002, bevelSegments: 2, curveSegments: 20 });
    geo.translate(0, 0, -0.008);
    geo.rotateY(HALF);
    return geo;
  });
}

// crank web: pin boss on top, counterweight sweeping round the bottom; thickness along x
function webGeo() {
  return cached('web', () => {
    const s = new THREE.Shape();
    s.moveTo(0.03, 0.04);
    s.absarc(0, 0.04, 0.03, 0, Math.PI, false);
    s.lineTo(-0.035, 0);
    s.absarc(0, 0, 0.066, Math.PI + 0.35, Math.PI * 2 - 0.35, false);
    s.lineTo(0.03, 0.04);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 18 });
    geo.translate(0, 0, -0.008);
    geo.rotateY(HALF);
    return geo;
  });
}

// hex bolt head + washer, standing on +y
const boltGeo = () => mergeGeometries([
  new THREE.CylinderGeometry(0.0065, 0.0065, 0.006, 6).translate(0, 0.006, 0),
  new THREE.CylinderGeometry(0.009, 0.009, 0.0025, 16).translate(0, 0.0015, 0),
].map(flat));

// cast plate with raised lettering (engine code on the cam cover)
const plateCache = new Map();
function plateMaterial(text) {
  if (plateCache.has(text)) return plateCache.get(text);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#26282c';
  g.fillRect(0, 0, 512, 96);
  g.font = '700 58px "Chakra Petch", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#0d0e10';
  g.fillText(text, 258, 52); // cast shadow
  g.fillStyle = '#d9dce0';
  g.fillText(text, 256, 49);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.7, roughness: 0.38, clearcoat: 0.4 });
  plateCache.set(text, mat);
  return mat;
}

function turbo() {
  const g = new THREE.Group();
  // cold side: cast-aluminium compressor scroll, inlet bell with the wheel inside, outlet
  g.add(mesh(new THREE.TorusGeometry(0.058, 0.034, 16, 40), M.alloy, { pos: [0.05, 0, 0], rot: [0, HALF, 0] }));
  g.add(mesh(new THREE.LatheGeometry([P2(0.03, 0), P2(0.032, 0.025), P2(0.04, 0.05), P2(0.048, 0.06), P2(0.046, 0.062)], 32), M.alloy, { pos: [0.07, 0, 0], rot: [0, 0, -HALF] }));
  const blades = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    blades.push(bake(new THREE.BoxGeometry(0.03, 0.022, 0.0016), { pos: [0.1, Math.cos(a) * 0.012, Math.sin(a) * 0.012], rot: [a, 0.35, 0] }));
  }
  blades.push(bake(new THREE.ConeGeometry(0.008, 0.03, 16), { pos: [0.115, 0, 0], rot: [0, 0, -HALF] }));
  g.add(merged(blades, M.alloy));
  g.add(mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.08, 20), M.alloy, { pos: [0.05, 0.08, 0.03] }));
  // hot side: cast-iron turbine scroll and downpipe flange
  g.add(mesh(new THREE.TorusGeometry(0.052, 0.033, 16, 40), M.castIron, { pos: [-0.05, 0, 0], rot: [0, HALF, 0] }));
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 24), M.castIron, { pos: [-0.095, 0, 0], rot: [0, 0, HALF] }));
  // bearing cartridge + oil feed
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 24), M.steel, { rot: [0, 0, HALF] }));
  const oil = new THREE.CatmullRomCurve3([V3(0, 0.03, 0), V3(0.01, 0.08, 0.02), V3(0.05, 0.12, 0.03)]);
  g.add(mesh(new THREE.TubeGeometry(oil, 16, 0.004, 8), M.steel));
  return g;
}

/**
 * spec: { layout: 'V'|'I'|'F'|'W'|'EV', cyl, bank, turbos, na, diesel, accent, position, gearbox, code, disp }
 * Returns { group, pieces, length, height, width, bottom }
 */
export function buildEngine(spec, ctx = {}) {
  if (spec.layout === 'EV') return buildEV(spec, ctx);

  const g = new THREE.Group();
  const pieces = [];
  const cover = crinkle(spec.accent);
  const pistonMat = M.steel;

  const banks = spec.layout === 'I' ? 1 : 2;
  const rows = spec.layout === 'W' ? 2 : 1;
  const perBank = spec.cyl / banks;
  const along = perBank / rows;
  const pitch = 0.1;
  const blockLen = along * pitch + 0.16;
  const half = spec.layout === 'F' ? Math.PI / 2 : spec.layout === 'I' ? 0 : THREE.MathUtils.degToRad((spec.bank || 90) / 2);
  const bankAngles = banks === 1 ? [0] : [half, -half];
  const bankW = 0.19 * rows;
  const cylX = (i) => -blockLen / 2 + 0.08 + pitch * (i + 0.5);
  const gbDir = spec.position === 'rear' ? 1 : -1;

  // ---- cylinder block: crankcase + one barrel housing per bank, cast ribs, oil filter
  const blockGeos = [bake(rbox(blockLen, 0.22, banks === 1 ? 0.26 : 0.36, 0.03), { pos: [0, -0.02, 0] })];
  bankAngles.forEach((a) => {
    const dir = V3(0, Math.cos(a), Math.sin(a));
    blockGeos.push(bake(rbox(blockLen, 0.28, bankW, 0.02), { pos: dir.clone().multiplyScalar(0.2).toArray(), rot: [a, 0, 0] }));
  });
  for (let i = 0; i <= along; i++) {
    const x = -blockLen / 2 + 0.08 + pitch * i;
    blockGeos.push(bake(rbox(0.014, 0.17, banks === 1 ? 0.28 : 0.38, 0.005), { pos: [x, -0.04, 0] }));
  }
  const block = new THREE.Group();
  block.add(mesh(mergeGeometries(blockGeos), M.darkAlloy));
  block.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 28), solid('#1d2a4a', 0.3, 0.35), { pos: [blockLen * 0.18, -0.06, (banks === 1 ? 0.13 : 0.18) + 0.05], rot: [HALF, 0, 0] }));
  block.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 28), M.alloy, { pos: [blockLen * 0.18, -0.06, (banks === 1 ? 0.13 : 0.18) + 0.003], rot: [HALF, 0, 0] }));
  piece(pieces, block, V3(0, 0, 0), `Cylinder block · ${spec.disp ?? ''} L ${spec.layoutName ?? ''}`.trim());
  g.add(block);

  // ---- heads: cast head, wrinkle-finish cam cover with the engine code, bolts, coils or injectors
  bankAngles.forEach((a, b) => {
    const dir = V3(0, Math.cos(a), Math.sin(a));
    const head = new THREE.Group();
    head.add(mesh(rbox(blockLen - 0.02, 0.1, bankW + 0.04, 0.02), M.alloy));
    head.add(mesh(rbox(blockLen - 0.07, 0.06, bankW - 0.02, 0.025), cover, { pos: [0, 0.075, 0] }));
    const ribs = [];
    for (const z of [-1, 1]) ribs.push(bake(rbox(blockLen - 0.14, 0.012, 0.012, 0.004), { pos: [0, 0.108, z * (bankW - 0.02) * 0.3] }));
    head.add(mesh(mergeGeometries(ribs), cover));
    const bolts = [];
    const nb = Math.max(3, Math.round(along) + 1);
    for (let i = 0; i < nb; i++) {
      const x = -(blockLen - 0.11) / 2 + ((blockLen - 0.11) * i) / (nb - 1);
      for (const z of [-1, 1]) bolts.push(bake(boltGeo(), { pos: [x, 0.104, z * ((bankW - 0.02) / 2 - 0.012)] }));
    }
    head.add(merged(bolts, M.bolt));
    const tops = [];
    const caps = [];
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < along; i++) {
        const x = cylX(i) + r * 0.05;
        const z = rows === 2 ? (r - 0.5) * 0.09 : 0;
        if (spec.diesel) tops.push(bake(new THREE.CylinderGeometry(0.007, 0.009, 0.06, 12), { pos: [x, 0.13, z] }));
        else {
          tops.push(bake(new THREE.CylinderGeometry(0.015, 0.017, 0.035, 18), { pos: [x, 0.123, z] }));
          caps.push(bake(rbox(0.026, 0.014, 0.03, 0.004), { pos: [x, 0.146, z + 0.004] }));
        }
      }
    }
    if (spec.diesel) {
      head.add(merged(tops, M.steel));
      const rail = new THREE.CatmullRomCurve3([V3(-blockLen / 2 + 0.03, 0.16, 0.04), V3(blockLen / 2 - 0.03, 0.16, 0.04)]);
      head.add(mesh(new THREE.TubeGeometry(rail, 8, 0.011, 16), M.steel));
    } else {
      head.add(merged(tops, M.plastic));
      head.add(merged(caps, M.plastic));
    }
    head.position.copy(dir.clone().multiplyScalar(0.39));
    head.rotation.x = a;
    g.add(head);
    piece(pieces, head, dir.clone().multiplyScalar(0.42), b === 0 ? (spec.diesel ? 'Cylinder head · common-rail injectors' : 'Cylinder heads · DOHC') : null);
  });

  // ---- pistons + rods (each one flies out along its bore)
  const rodLen = 0.19;
  let first = true;
  bankAngles.forEach((a, b) => {
    const dir = V3(0, Math.cos(a), Math.sin(a));
    const lat = V3(0, -Math.sin(a), Math.cos(a));
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < along; i++) {
        const p = new THREE.Group();
        p.add(mesh(pistonGeo(0.042), pistonMat));
        p.add(mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.07, 16), M.chrome, { pos: [0, -0.012, 0], rot: [HALF, 0, 0] }));
        p.add(mesh(rodGeo(rodLen), M.steel, { pos: [0, -0.012, 0] }));
        const x = cylX(i) + (banks === 2 ? (b - 0.5) * 0.03 : 0) + r * 0.05;
        const rowOff = rows === 2 ? (r - 0.5) * 0.09 : 0;
        p.position.set(x, 0, 0).addScaledVector(dir, 0.25).addScaledVector(lat, rowOff);
        p.rotation.x = a;
        g.add(p);
        piece(pieces, p, dir.clone().multiplyScalar(0.62 + r * 0.1), first ? `Pistons ×${spec.cyl}` : null);
        first = false;
      }
    }
  });

  // ---- crankshaft: main journals, counterweighted webs, crank pins, flywheel
  const crankGeos = [bake(new THREE.CylinderGeometry(0.024, 0.024, 0.09, 24), { pos: [blockLen / 2 + 0.02, 0, 0], rot: [0, 0, HALF] })];
  for (let i = 0; i < along; i++) {
    const x = cylX(i);
    const th = (i % 2) * Math.PI + Math.floor(i / 2) * ((Math.PI * 2) / Math.max(along, 2));
    for (const s of [-1, 1]) crankGeos.push(bake(webGeo().clone(), { pos: [x + s * pitch * 0.3, 0, 0], rot: [th, 0, 0] }));
    crankGeos.push(bake(new THREE.CylinderGeometry(0.02, 0.02, pitch * 0.5, 20), { pos: [x, Math.cos(th) * 0.04, Math.sin(th) * 0.04], rot: [0, 0, HALF] }));
    crankGeos.push(bake(new THREE.CylinderGeometry(0.027, 0.027, pitch * 0.22, 24), { pos: [x + pitch / 2, 0, 0], rot: [0, 0, HALF] }));
  }
  crankGeos.push(bake(new THREE.CylinderGeometry(0.027, 0.027, 0.05, 24), { pos: [cylX(0) - pitch / 2, 0, 0], rot: [0, 0, HALF] }));
  const crank = new THREE.Group();
  crank.add(mesh(mergeGeometries(crankGeos.map(flat)), M.steel));
  const fx0 = gbDir * (blockLen / 2 + 0.035);
  crank.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.022, 48), M.steel, { pos: [fx0, 0, 0], rot: [0, 0, HALF] }));
  crank.add(mesh(new THREE.CylinderGeometry(0.137, 0.137, 0.016, 64, 1, true), M.belt, { pos: [fx0, 0, 0], rot: [0, 0, HALF] }));
  g.add(crank);
  piece(pieces, crank, V3(0, -0.38, 0), 'Crankshaft & flywheel');

  // ---- oil sump with cooling fins and drain plug
  const sumpGeos = [bake(rbox(blockLen * 0.82, 0.12, banks === 1 ? 0.24 : 0.3, 0.03), { pos: [0, -0.19, 0] })];
  for (let k = -2; k <= 2; k++) sumpGeos.push(bake(rbox(blockLen * 0.7, 0.025, 0.01, 0.003), { pos: [0, -0.255, k * 0.045] }));
  const sump = new THREE.Group();
  sump.add(mesh(mergeGeometries(sumpGeos), M.darkAlloy));
  sump.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 6), M.bolt, { pos: [-blockLen * 0.25, -0.265, 0] }));
  g.add(sump);
  piece(pieces, sump, V3(0, -0.7, 0), spec.position === 'mid' ? 'Dry-sump oil system' : 'Oil sump');

  // ---- intake
  const intake = new THREE.Group();
  const trumpet = () => new THREE.LatheGeometry([P2(0.021, 0), P2(0.022, 0.05), P2(0.027, 0.075), P2(0.036, 0.088), P2(0.038, 0.09)], 28);
  // engine-code plaque on top of the plenum: [x, y, z, max height]
  let plaque;
  if (spec.layout === 'I') {
    plaque = [0, 0.4415, -0.21, 0.07];
    intake.add(mesh(rbox(blockLen * 0.8, 0.12, 0.1, 0.035), M.carbon, { pos: [0, 0.38, -0.21] }));
    const runners = [];
    for (let i = 0; i < along; i++) {
      const x = cylX(i);
      const c = new THREE.CatmullRomCurve3([V3(x, 0.38, -0.16), V3(x, 0.4, -0.08), V3(x, 0.36, -0.02)]);
      runners.push(new THREE.TubeGeometry(c, 16, 0.02, 14));
    }
    intake.add(merged(runners, M.alloy));
    intake.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.07, 28), M.alloy, { pos: [blockLen * 0.42, 0.38, -0.21], rot: [0, 0, HALF] }));
  } else if (spec.layout === 'F') {
    plaque = [-0.04, 0.2415, 0, 0.06];
    intake.add(mesh(rbox(blockLen * 0.85, 0.08, 0.3, 0.03), M.carbon, { pos: [0, 0.2, 0] }));
    intake.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 28), M.alloy, { pos: [blockLen * 0.35, 0.27, 0] }));
  } else {
    const y = spec.layout === 'W' ? 0.52 : 0.5;
    plaque = [0, y + 0.0515, 0, 0.038];
    intake.add(mesh(rbox(blockLen * 0.86, 0.1, 0.24, 0.04), spec.na ? M.carbon : M.alloy, { pos: [0, y, 0] }));
    if (spec.na) {
      const stacks = [];
      for (let i = 0; i < along; i++) for (const s of [-1, 1]) stacks.push(bake(trumpet(), { pos: [cylX(i), y + 0.045, s * 0.06] }));
      intake.add(merged(stacks, M.chrome));
    } else {
      intake.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 28), M.alloy, { pos: [blockLen * 0.45, y, 0], rot: [0, 0, HALF] }));
      intake.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 28), M.darkAlloy, { pos: [blockLen * 0.45 + 0.16, y, 0], rot: [0, 0, HALF] }));
    }
  }
  if (spec.code) {
    const pw = Math.min(plaque[3] / 0.19, blockLen * 0.55);
    intake.add(mesh(new THREE.PlaneGeometry(pw, pw * 0.19), plateMaterial(String(spec.code)), { pos: plaque.slice(0, 3), rot: [-HALF, 0, 0], cast: false }));
  }
  g.add(intake);
  piece(pieces, intake, V3(0, 0.6, 0), spec.na ? 'Intake plenum & velocity stacks' : 'Intake plenum');

  // ---- exhaust headers: heat-tinted tubes, flange plate, collector
  const outSides = spec.layout === 'I' ? [1] : [1, -1];
  outSides.forEach((side, b) => {
    const a = banks === 1 ? 0 : bankAngles[b];
    const dir = V3(0, Math.cos(a), Math.sin(a));
    const tubes = [];
    for (let i = 0; i < along; i++) {
      const x = cylX(i);
      const start = V3(x, 0, 0).addScaledVector(dir, 0.33).add(V3(0, 0, side * (banks === 1 ? 0.15 : 0.08)));
      const curve = new THREE.CatmullRomCurve3([
        start,
        start.clone().add(V3(0, -0.02, side * 0.12)),
        V3(x * 0.6 - blockLen * 0.2, -0.08, side * (banks === 1 ? 0.32 : 0.4)),
        V3(-blockLen / 2 - 0.02, -0.12, side * (banks === 1 ? 0.3 : 0.38)),
      ]);
      tubes.push(new THREE.TubeGeometry(curve, 32, 0.019, 12));
    }
    const headers = new THREE.Group();
    headers.add(merged(tubes, M.headers));
    const fl = V3(0, 0, 0).addScaledVector(dir, 0.33).add(V3(0, 0, side * (banks === 1 ? 0.15 : 0.08)));
    headers.add(mesh(rbox(blockLen - 0.08, 0.05, 0.012, 0.004), M.castIron, { pos: [0, fl.y, fl.z], rot: [a, 0, 0] }));
    headers.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.12, 24), M.headers, { pos: [-blockLen / 2 - 0.06, -0.12, side * (banks === 1 ? 0.3 : 0.38)], rot: [0, 0, HALF] }));
    g.add(headers);
    piece(pieces, headers, V3(0, -0.05, side * 0.38), b === 0 ? 'Exhaust manifolds' : null);
  });

  // ---- turbos
  const nT = spec.turbos || 0;
  for (let t = 0; t < nT; t++) {
    const tb = turbo();
    let side = 1, x = -blockLen / 2 + 0.02;
    if (spec.layout === 'I') { side = 1; x = nT > 1 ? (t === 0 ? 0.12 : -0.18) : -0.05; }
    else { side = t % 2 === 0 ? 1 : -1; x = nT > 2 ? (t < 2 ? -blockLen / 2 + 0.05 : 0.05) : -blockLen / 2 + 0.02; }
    tb.position.set(x, -0.02, side * (spec.layout === 'I' ? 0.38 : 0.48));
    g.add(tb);
    piece(pieces, tb, V3(0, 0.12, side * 0.42), t === 0 ? `Turbocharger ×${nT}` : null);
  }

  // ---- accessory drive (front): crank pulley, alternator, A/C compressor, tensioner, ribbed belt
  const acc = new THREE.Group();
  const fx = blockLen / 2 + 0.035;
  const pulleys = [[0.0, 0.0, 0.07], [0.22, 0.12, 0.05], [0.2, -0.14, 0.055], [0.38, 0, 0.045], [0.1, 0.17, 0.025]];
  pulleys.forEach(([y, z, r]) => acc.add(mesh(new THREE.CylinderGeometry(r, r, 0.035, 32), M.steel, { pos: [fx, y, z], rot: [0, 0, HALF] })));
  acc.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.13, 28), M.alloy, { pos: [fx - 0.08, 0.22, 0.12], rot: [0, 0, HALF] }));
  acc.add(mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.15, 28), M.darkAlloy, { pos: [fx - 0.09, 0.2, -0.14], rot: [0, 0, HALF] }));
  const belt = new THREE.CatmullRomCurve3(pulleys.slice(0, 4).map(([y, z, r]) => V3(fx, y + Math.sign(y || 1) * r * 0.5, z + Math.sign(z || 1) * r * 0.5)), true);
  acc.add(mesh(new THREE.TubeGeometry(belt, 80, 0.009, 8, true), M.belt));
  g.add(acc);
  piece(pieces, acc, V3(0.42, 0.05, 0), 'Accessory belt drive');

  // ---- gearbox: cast bellhousing with ribs and a bolt flange
  const gbLen = 0.5;
  const gb = new THREE.Group();
  gb.add(mesh(new THREE.CylinderGeometry(0.2, 0.12, gbLen, 36), M.darkAlloy, { rot: [0, 0, gbDir * HALF] }));
  const gbRibs = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    gbRibs.push(bake(rbox(gbLen * 0.8, 0.016, 0.03, 0.005), { pos: [0, Math.cos(a) * 0.16, Math.sin(a) * 0.16], rot: [a, 0, 0] }));
  }
  gb.add(mesh(mergeGeometries(gbRibs), M.darkAlloy));
  const flange = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    flange.push(bake(boltGeo(), { pos: [-gbDir * gbLen / 2 + gbDir * 0.004, Math.cos(a) * 0.19, Math.sin(a) * 0.19], rot: [0, 0, -gbDir * HALF] }));
  }
  gb.add(merged(flange, M.bolt));
  gb.add(mesh(rbox(0.18, 0.2, 0.34, 0.04), M.darkAlloy, { pos: [gbDir * gbLen * 0.4, -0.05, 0] }));
  gb.position.set(gbDir * (blockLen / 2 + gbLen / 2 + 0.06), -0.02, 0);
  g.add(gb);
  piece(pieces, gb, V3(gbDir * 0.6, 0, 0), `Gearbox · ${spec.gearbox}`);

  // ---- radiator (front-engined cars): finned core, end tanks, shrouded fan, hoses
  let front = fx + 0.1;
  if (spec.position === 'front') {
    const rad = new THREE.Group();
    rad.add(mesh(new THREE.BoxGeometry(0.04, 0.4, 0.6), M.radiator));
    for (const s of [-1, 1]) rad.add(mesh(rbox(0.06, 0.42, 0.05, 0.012), M.plastic, { pos: [0, 0, s * 0.32] }));
    rad.add(mesh(new THREE.TorusGeometry(0.16, 0.012, 10, 48), M.plastic, { pos: [-0.045, 0, 0], rot: [0, HALF, 0] }));
    const fan = [bake(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 20), { rot: [0, 0, HALF] })];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      fan.push(bake(rbox(0.006, 0.13, 0.05, 0.003), { pos: [0, Math.cos(a) * 0.085, Math.sin(a) * 0.085], rot: [a, 0.45, 0] }));
    }
    rad.add(mesh(mergeGeometries(fan.map(flat)), M.plastic, { pos: [-0.05, 0, 0] }));
    const hose = new THREE.CatmullRomCurve3([V3(-0.02, 0.15, 0.32), V3(-0.12, 0.2, 0.25), V3(-0.22, 0.22, 0.12)]);
    rad.add(mesh(new THREE.TubeGeometry(hose, 20, 0.018, 12), M.hose));
    rad.position.set(fx + 0.2, 0.12, 0);
    g.add(rad);
    piece(pieces, rad, V3(0.55, 0.05, 0), 'Radiator & cooling fan');
    front = fx + 0.24;
  }

  const back = -(blockLen / 2 + (gbDir < 0 ? gbLen + 0.06 : 0)) - 0.05;
  const fwd = Math.max(front, gbDir > 0 ? blockLen / 2 + gbLen + 0.06 : 0);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, pieces, length: fwd - back, center: (fwd + back) / 2, height: 0.85, width: 1.0, bottom: -0.25 };
}

// ---------- Electric drivetrain (battery + motors) ----------
function buildEV(spec, ctx) {
  const g = new THREE.Group();
  const pieces = [];
  const packL = ctx.packLength || 2.3;
  const packW = ctx.packWidth || 1.45;
  const fz = ctx.frontAxle ?? 1.4; // x of front axle relative to group origin
  const rz = ctx.rearAxle ?? -1.5;

  // extruded-aluminium tray with crash rails and a cooling plate
  const tray = new THREE.Group();
  tray.add(mesh(rbox(packL, 0.05, packW, 0.015), M.alloy, { pos: [0, -0.04, 0] }));
  for (const s of [-1, 1]) tray.add(mesh(rbox(packL, 0.09, 0.06, 0.012), M.darkAlloy, { pos: [0, -0.01, s * (packW / 2 - 0.03)] }));
  const lines = [];
  for (let k = -3; k <= 3; k++) lines.push(bake(new THREE.CylinderGeometry(0.008, 0.008, packL - 0.2, 10), { pos: [0, -0.012, k * packW * 0.12], rot: [0, 0, HALF] }));
  tray.add(merged(lines, M.alloy));
  g.add(tray);
  piece(pieces, tray, V3(0, -0.35, 0), 'Battery tray & cooling plate');

  // modules: aluminium cases with the cell tops showing, copper bus bars between them
  const modules = new THREE.Group();
  const nx = 8, nz = 2;
  const w = (packL - 0.12) / nx, d = (packW - 0.12) / nz;
  const caseMats = [M.alloy, M.alloy, M.cells, M.alloy, M.alloy, M.alloy];
  // one module case; the cell texture on its top face is scaled to real size (one tile = 0.4 m)
  const caseGeo = new THREE.BoxGeometry(w - 0.02, 0.07, d - 0.03);
  const uv = caseGeo.attributes.uv;
  for (let v = 8; v < 12; v++) uv.setXY(v, uv.getX(v) * (w - 0.02) / 0.4, uv.getY(v) * (d - 0.03) / 0.4);
  const bars = [];
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const x = -packL / 2 + 0.06 + w * (i + 0.5), z = -packW / 2 + 0.06 + d * (k + 0.5);
      modules.add(mesh(caseGeo, caseMats, { pos: [x, 0.03, z] }));
      if (i < nx - 1) bars.push(bake(new THREE.BoxGeometry(0.05, 0.006, 0.025), { pos: [x + w / 2, 0.068, z + (k ? -1 : 1) * d * 0.32] }));
    }
  }
  modules.add(merged(bars, M.copper));
  g.add(modules);
  piece(pieces, modules, V3(0, 0.15, 0), 'Battery modules · ~100 kWh');

  const cover = mesh(rbox(packL, 0.025, packW, 0.01), anodized('#2a2e35'), { pos: [0, 0.085, 0] });
  g.add(cover);
  piece(pieces, cover, V3(0, 0.7, 0), 'Battery top cover');

  // motors: finned housing, copper stator end, inverter with an orange HV connector
  const motor = (x, z, label, dir) => {
    const m = new THREE.Group();
    m.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 40), M.alloy, { rot: [HALF, 0, 0] }));
    const fins = [];
    for (let k = -4; k <= 4; k++) fins.push(bake(new THREE.CylinderGeometry(0.142, 0.142, 0.012, 40), { pos: [0, 0, k * 0.03], rot: [HALF, 0, 0] }));
    m.add(merged(fins, M.alloy));
    m.add(mesh(new THREE.TorusGeometry(0.1, 0.022, 12, 40), M.copper, { pos: [0, 0, 0.155] }));
    m.add(mesh(rbox(0.22, 0.12, 0.18, 0.02), anodized(spec.accent), { pos: [0, 0.17, 0] }));
    m.add(mesh(rbox(0.05, 0.04, 0.06, 0.008), M.hv, { pos: [0.09, 0.24, 0] }));
    m.position.set(x, 0.12, z);
    g.add(m);
    piece(pieces, m, dir, label);
    return m;
  };
  motor(fz, 0, 'Front motor · induction', V3(0.55, 0.2, 0));
  motor(rz, 0.17, 'Rear motors ×2 · carbon-sleeved', V3(-0.55, 0.2, 0.25));
  motor(rz, -0.17, null, V3(-0.55, 0.2, -0.25));

  const cables = [];
  for (const [x, z] of [[fz, 0], [rz, 0.17], [rz, -0.17]]) {
    const c = new THREE.CatmullRomCurve3([V3(Math.sign(x) * (packL / 2 - 0.1), 0.07, z * 0.5), V3(x * 0.85, 0.12, z), V3(x + Math.sign(-x) * 0.02, 0.27, z)]);
    cables.push(new THREE.TubeGeometry(c, 28, 0.019, 12));
  }
  const hv = merged(cables, M.hv);
  g.add(hv);
  piece(pieces, hv, V3(0, 0.4, 0), 'High-voltage cables');

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, pieces, length: Math.abs(fz - rz) + 0.4, center: 0, height: 0.4, width: packW, bottom: -0.07 };
}
