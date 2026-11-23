// Procedural engines. Each engine is a group of "pieces" that can fly apart (exploded view).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M, solid, glow } from './materials.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

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

function piece(list, obj, dir, label = null, extra = {}) {
  list.push({ obj, dir, label, ...extra });
  return obj;
}

function turbo(hot = true) {
  const g = new THREE.Group();
  const comp = mesh(new THREE.TorusGeometry(0.055, 0.032, 12, 28), M.alloy, { pos: [0.05, 0, 0], rot: [0, Math.PI / 2, 0] });
  const turb = mesh(new THREE.TorusGeometry(0.05, 0.03, 12, 28), hot ? M.hot : M.steel, { pos: [-0.05, 0, 0], rot: [0, Math.PI / 2, 0] });
  const core = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 20), M.steel, { rot: [0, 0, Math.PI / 2] });
  const inlet = mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.07, 20, 1, true), M.alloy, { pos: [0.11, 0, 0], rot: [0, 0, Math.PI / 2] });
  g.add(comp, turb, core, inlet);
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
  const accent = solid(spec.accent, 0.35, 0.3);
  const pistonMat = solid('#dfe3e8', 1, 0.18);

  const banks = spec.layout === 'I' ? 1 : 2;
  const rows = spec.layout === 'W' ? 2 : 1;
  const perBank = spec.cyl / banks;
  const along = perBank / rows;
  const pitch = 0.1;
  const blockLen = along * pitch + 0.16;
  const half = spec.layout === 'F' ? Math.PI / 2 : spec.layout === 'I' ? 0 : THREE.MathUtils.degToRad((spec.bank || 90) / 2);
  const bankAngles = banks === 1 ? [0] : [half, -half];
  const bankW = 0.19 * rows;

  // ---- cylinder block (crankcase + one housing per bank, merged)
  const blockGeos = [bake(rbox(blockLen, 0.22, banks === 1 ? 0.26 : 0.36, 0.03), { pos: [0, -0.02, 0] })];
  bankAngles.forEach((a) => {
    const dir = V3(0, Math.cos(a), Math.sin(a));
    blockGeos.push(bake(rbox(blockLen, 0.28, bankW, 0.02), { pos: dir.clone().multiplyScalar(0.2).toArray(), rot: [a, 0, 0] }));
  });
  const block = mesh(mergeGeometries(blockGeos), M.darkAlloy);
  piece(pieces, block, V3(0, 0, 0), `Cylinder block · ${spec.disp ?? ''} L ${spec.layoutName ?? ''}`.trim());
  g.add(block);

  // ---- heads with coloured valve covers
  bankAngles.forEach((a, b) => {
    const dir = V3(0, Math.cos(a), Math.sin(a));
    const head = new THREE.Group();
    head.add(mesh(rbox(blockLen - 0.02, 0.1, bankW + 0.04, 0.02), M.alloy));
    head.add(mesh(rbox(blockLen - 0.07, 0.06, bankW - 0.02, 0.02), accent, { pos: [0, 0.07, 0] }));
    for (let i = 0; i < along; i++) {
      head.add(mesh(new THREE.BoxGeometry(0.012, 0.02, bankW - 0.05), M.chrome, { pos: [-blockLen / 2 + 0.08 + pitch * (i + 0.5), 0.105, 0] }));
    }
    head.position.copy(dir.clone().multiplyScalar(0.39));
    head.rotation.x = a;
    g.add(head);
    piece(pieces, head, dir.clone().multiplyScalar(0.42), b === 0 ? (spec.diesel ? 'Cylinder head · common-rail injectors' : 'Cylinder heads · DOHC') : null);
  });

  // ---- pistons + rods (each one flies out along its bore)
  let first = true;
  bankAngles.forEach((a, b) => {
    const dir = V3(0, Math.cos(a), Math.sin(a));
    const lat = V3(0, -Math.sin(a), Math.cos(a));
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < along; i++) {
        const p = new THREE.Group();
        p.add(mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.055, 24), pistonMat));
        p.add(mesh(new THREE.BoxGeometry(0.022, 0.13, 0.03), M.steel, { pos: [0, -0.09, 0] }));
        const x = -blockLen / 2 + 0.08 + pitch * (i + 0.5) + (banks === 2 ? (b - 0.5) * 0.03 : 0) + r * 0.05;
        const rowOff = rows === 2 ? (r - 0.5) * 0.09 : 0;
        p.position.set(x, 0, 0).addScaledVector(dir, 0.25).addScaledVector(lat, rowOff);
        p.rotation.x = a;
        g.add(p);
        piece(pieces, p, dir.clone().multiplyScalar(0.62 + r * 0.1), first ? `Pistons ×${spec.cyl}` : null);
        first = false;
      }
    }
  });

  // ---- crankshaft
  const crankGeos = [bake(new THREE.CylinderGeometry(0.026, 0.026, blockLen + 0.12, 16), { rot: [0, 0, Math.PI / 2] })];
  for (let i = 0; i < along; i++) {
    const x = -blockLen / 2 + 0.08 + pitch * (i + 0.5);
    crankGeos.push(bake(new THREE.BoxGeometry(0.026, 0.11, 0.075), { pos: [x, -0.03 * (i % 2 ? 1 : -1), 0], rot: [i * 1.1, 0, 0] }));
  }
  const crank = mesh(mergeGeometries(crankGeos), M.steel);
  g.add(crank);
  piece(pieces, crank, V3(0, -0.38, 0), 'Crankshaft');

  // ---- oil sump
  const sump = mesh(rbox(blockLen * 0.82, 0.12, banks === 1 ? 0.24 : 0.3, 0.03), M.darkAlloy, { pos: [0, -0.19, 0] });
  g.add(sump);
  piece(pieces, sump, V3(0, -0.7, 0), spec.position === 'mid' ? 'Dry-sump oil system' : 'Oil sump');

  // ---- intake
  const intake = new THREE.Group();
  if (spec.layout === 'I') {
    intake.add(mesh(rbox(blockLen * 0.8, 0.12, 0.1, 0.03), M.carbon, { pos: [0, 0.38, -0.2] }));
    for (let i = 0; i < along; i++) {
      const x = -blockLen / 2 + 0.08 + pitch * (i + 0.5);
      intake.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 12), M.alloy, { pos: [x, 0.38, -0.1], rot: [Math.PI / 2, 0, 0] }));
    }
  } else if (spec.layout === 'F') {
    intake.add(mesh(rbox(blockLen * 0.85, 0.08, 0.3, 0.03), M.carbon, { pos: [0, 0.2, 0] }));
    intake.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 20), M.alloy, { pos: [blockLen * 0.35, 0.27, 0] }));
  } else {
    const y = spec.layout === 'W' ? 0.52 : 0.5;
    intake.add(mesh(rbox(blockLen * 0.86, 0.1, 0.24, 0.035), spec.na ? M.carbon : M.alloy, { pos: [0, y, 0] }));
    if (spec.na) {
      for (let i = 0; i < along; i++) {
        for (const s of [-1, 1]) {
          const x = -blockLen / 2 + 0.08 + pitch * (i + 0.5);
          intake.add(mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.08, 16, 1, true), M.chrome, { pos: [x, y + 0.09, s * 0.06] }));
        }
      }
    } else {
      intake.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 16), M.alloy, { pos: [blockLen * 0.45, y, 0], rot: [0, 0, Math.PI / 2] }));
    }
  }
  g.add(intake);
  piece(pieces, intake, V3(0, 0.6, 0), spec.na ? 'Intake plenum & velocity stacks' : 'Intake plenum');

  // ---- exhaust headers (one merged mesh per bank)
  const outSides = spec.layout === 'I' ? [1] : [1, -1];
  outSides.forEach((side, b) => {
    const a = banks === 1 ? 0 : bankAngles[b];
    const dir = V3(0, Math.cos(a), Math.sin(a));
    const tubes = [];
    for (let i = 0; i < along; i++) {
      const x = -blockLen / 2 + 0.08 + pitch * (i + 0.5);
      const start = V3(x, 0, 0).addScaledVector(dir, 0.33).add(V3(0, 0, side * (banks === 1 ? 0.15 : 0.08)));
      const curve = new THREE.CatmullRomCurve3([
        start,
        start.clone().add(V3(0, -0.02, side * 0.12)),
        V3(x * 0.6 - blockLen * 0.2, -0.08, side * (banks === 1 ? 0.32 : 0.4)),
        V3(-blockLen / 2 - 0.02, -0.12, side * (banks === 1 ? 0.3 : 0.38)),
      ]);
      tubes.push(new THREE.TubeGeometry(curve, 24, 0.019, 8));
    }
    const headers = mesh(mergeGeometries(tubes), M.titanium);
    g.add(headers);
    piece(pieces, headers, V3(0, -0.05, side * 0.38), b === 0 ? 'Exhaust manifolds' : null);
  });

  // ---- turbos
  const nT = spec.turbos || 0;
  for (let t = 0; t < nT; t++) {
    const tb = turbo(true);
    let side = 1, x = -blockLen / 2 + 0.02;
    if (spec.layout === 'I') { side = 1; x = nT > 1 ? (t === 0 ? 0.12 : -0.18) : -0.05; }
    else { side = t % 2 === 0 ? 1 : -1; x = nT > 2 ? (t < 2 ? -blockLen / 2 + 0.05 : 0.05) : -blockLen / 2 + 0.02; }
    tb.position.set(x, -0.02, side * (spec.layout === 'I' ? 0.38 : 0.48));
    g.add(tb);
    piece(pieces, tb, V3(0, 0.12, side * 0.42), t === 0 ? `Turbocharger ×${nT}` : null);
  }

  // ---- accessory drive (front)
  const acc = new THREE.Group();
  const fx = blockLen / 2 + 0.035;
  const pulleys = [[0.0, 0.0, 0.07], [0.22, 0.12, 0.05], [0.2, -0.14, 0.055], [0.38, 0, 0.045]];
  pulleys.forEach(([y, z, r]) => acc.add(mesh(new THREE.CylinderGeometry(r, r, 0.035, 24), M.steel, { pos: [fx, y, z], rot: [0, 0, Math.PI / 2] })));
  const belt = new THREE.CatmullRomCurve3(pulleys.map(([y, z, r]) => V3(fx, y + Math.sign(y || 1) * r * 0.5, z + Math.sign(z || 1) * r * 0.5)), true);
  acc.add(mesh(new THREE.TubeGeometry(belt, 64, 0.008, 6, true), M.rubber));
  g.add(acc);
  piece(pieces, acc, V3(0.42, 0.05, 0), 'Accessory belt drive');

  // ---- gearbox
  const gbDir = spec.position === 'rear' ? 1 : -1;
  const gbLen = 0.5;
  const gb = new THREE.Group();
  gb.add(mesh(new THREE.CylinderGeometry(0.2, 0.12, gbLen, 28), M.darkAlloy, { rot: [0, 0, gbDir * Math.PI / 2] }));
  gb.add(mesh(rbox(0.18, 0.2, 0.34, 0.04), M.darkAlloy, { pos: [gbDir * gbLen * 0.4, -0.05, 0] }));
  gb.position.set(gbDir * (blockLen / 2 + gbLen / 2 + 0.02), -0.02, 0);
  g.add(gb);
  piece(pieces, gb, V3(gbDir * 0.6, 0, 0), `Gearbox · ${spec.gearbox}`);

  // ---- radiator (front-engined cars)
  let front = fx + 0.1;
  if (spec.position === 'front') {
    const rad = new THREE.Group();
    rad.add(mesh(rbox(0.05, 0.4, 0.62, 0.01), M.radiator));
    for (let i = 0; i < 14; i++) rad.add(mesh(new THREE.BoxGeometry(0.052, 0.006, 0.6), M.steel, { pos: [0, -0.18 + i * 0.027, 0] }));
    rad.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 24), M.black, { pos: [-0.045, 0, 0], rot: [0, 0, Math.PI / 2] }));
    rad.position.set(fx + 0.2, 0.12, 0);
    g.add(rad);
    piece(pieces, rad, V3(0.55, 0.05, 0), 'Radiator & cooling fan');
    front = fx + 0.24;
  }

  const back = -(blockLen / 2 + (gbDir < 0 ? gbLen + 0.02 : 0)) - 0.05;
  const fwd = Math.max(front, gbDir > 0 ? blockLen / 2 + gbLen + 0.02 : 0);
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

  const tray = mesh(rbox(packL, 0.07, packW, 0.02), M.darkAlloy, { pos: [0, -0.03, 0] });
  g.add(tray);
  piece(pieces, tray, V3(0, -0.35, 0), 'Battery tray & cooling plate');

  const modules = new THREE.Group();
  const nx = 8, nz = 2;
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const w = (packL - 0.12) / nx, d = (packW - 0.12) / nz;
      const x = -packL / 2 + 0.06 + w * (i + 0.5), z = -packW / 2 + 0.06 + d * (k + 0.5);
      modules.add(mesh(new THREE.BoxGeometry(w - 0.02, 0.07, d - 0.03), M.darkAlloy, { pos: [x, 0.03, z] }));
      modules.add(mesh(new THREE.BoxGeometry(w - 0.05, 0.004, 0.01), M.cell, { pos: [x, 0.068, z - d * 0.3] }));
      modules.add(mesh(new THREE.BoxGeometry(w - 0.05, 0.004, 0.01), M.cell, { pos: [x, 0.068, z + d * 0.3] }));
    }
  }
  g.add(modules);
  piece(pieces, modules, V3(0, 0.15, 0), 'Battery modules · ~100 kWh');

  const cover = mesh(rbox(packL, 0.025, packW, 0.01), solid('#2a2e35', 0.6, 0.4), { pos: [0, 0.085, 0] });
  g.add(cover);
  piece(pieces, cover, V3(0, 0.7, 0), 'Battery top cover');

  const motor = (x, z, label, dir) => {
    const m = new THREE.Group();
    m.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 28), M.alloy, { rot: [Math.PI / 2, 0, 0] }));
    m.add(mesh(new THREE.TorusGeometry(0.13, 0.012, 8, 32), M.copper, { pos: [0, 0, 0.15] }));
    m.add(mesh(rbox(0.22, 0.12, 0.18, 0.02), solid(spec.accent, 0.3, 0.35), { pos: [0, 0.16, 0] }));
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
    const c = new THREE.CatmullRomCurve3([V3(Math.sign(x) * (packL / 2 - 0.1), 0.07, z * 0.5), V3(x * 0.85, 0.12, z), V3(x, 0.25, z)]);
    cables.push(new THREE.TubeGeometry(c, 20, 0.016, 8));
  }
  const hv = mesh(mergeGeometries(cables), M.hv);
  g.add(hv);
  piece(pieces, hv, V3(0, 0.4, 0), 'High-voltage cables');

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, pieces, length: Math.abs(fz - rz) + 0.4, center: 0, height: 0.4, width: packW, bottom: -0.07 };
}
