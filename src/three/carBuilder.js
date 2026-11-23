// Builds a complete, explodable 3D car from a design sheet (see data/designs.js).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M, paint, solid } from './materials.js';
import { buildEngine, mesh } from './engineBuilder.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// BVH-accelerated raycasting (placing lights/grilles on the body, and mouse picking)
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const TAU = Math.PI * 2;
const HALF = Math.PI / 2;
const HOOD_T = 0.74 * HALF;
const DOOR_BOTTOM = 0.6 * HALF;
const DOOR_TOP_TF = 0.6;
const G = { PAINT: 0, GLASS: 1, TRIM: 2, ROOF: 3 };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const inR = (f, r) => !!r && f >= r[0] && f <= r[1];
const lerp = (a, b, t) => a + (b - a) * t;
const rbox = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));

// Smooth Hermite curve through [f, value] keypoints
function curve(points) {
  const n = points.length;
  return (f) => {
    if (f <= points[0][0]) return points[0][1];
    if (f >= points[n - 1][0]) return points[n - 1][1];
    let i = 0;
    while (f > points[i + 1][0]) i++;
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n - 1, i + 2)];
    const h = p2[0] - p1[0];
    const t = (f - p1[0]) / h;
    const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0])) * h;
    const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0])) * h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
}

// ---------------------------------------------------------------------------
// Body surface: a loft of rounded cross-sections along the car
// ---------------------------------------------------------------------------
class BodyShape {
  constructor(d) {
    const k = d.dims;
    this.d = d;
    this.L = k.L;
    this.W = k.W;
    this.top = curve(d.top);
    this.belt = curve(d.belt);
    this.bot = curve(d.bottom);
    this.wc = curve(d.wcurve || [[0, 1], [1, 1]]);
    this.fa = k.fo / k.L;
    this.ra = (k.fo + k.wb) / k.L;
    this.xa = this.x(this.fa);
    this.xr = this.x(this.ra);
    this.gap = d.flares ? 0.065 : 0.045;
    this.st = d.style;
  }
  x(f) { return this.L / 2 - f * this.L; }
  hw(f) {
    const u = 2 * f - 1;
    const p = u < 0 ? this.d.plan.pF : this.d.plan.pR;
    const t = Math.max(0, 1 - Math.pow(Math.abs(u), p));
    return (this.W / 2) * this.wc(f) * Math.pow(t, 1 / p);
  }
  levels(f) {
    const yt = this.top(f);
    let yb = this.bot(f);
    const x = this.x(f);
    const k = this.d.dims;
    for (const [ax, R] of [[this.xa, k.rf], [this.xr, k.rr]]) {
      const Ra = R + this.gap;
      const dx = Math.abs(x - ax);
      if (dx < Ra) yb = Math.max(yb, R + Math.sqrt(Ra * Ra - dx * dx));
    }
    const ybelt = Math.min(this.belt(f), yt - 0.03);
    yb = Math.min(yb, ybelt - 0.05);
    return { yt, ybelt, yb, cab: smooth(0.1, 0.28, yt - ybelt) };
  }
  point(f, th, out = V3()) {
    th = ((th % TAU) + TAU) % TAU;
    const { yt, ybelt, yb, cab } = this.levels(f);
    const hw = Math.max(this.hw(f), 0.0004);
    let side = 1, t = th;
    if (th > Math.PI) { side = -1; t = TAU - th; }
    let y, z;
    if (t <= HALF) {
      const nU = this.st.nUlow + (this.st.nUcab - this.st.nUlow) * cab;
      const s = Math.pow(Math.max(0, Math.cos(t)), 2 / nU);
      z = hw * Math.pow(Math.sin(t), 2 / nU);
      y = ybelt + (yt - ybelt) * s;
      z *= 1 - this.st.tumble * cab * Math.pow(s, 0.9);
    } else {
      const tt = t - HALF;
      const b = Math.sin(tt);
      z = hw * Math.pow(Math.max(0, Math.cos(tt)), 2 / this.st.nL) * (1 - 0.07 * b * b * b);
      y = ybelt - (ybelt - yb) * Math.pow(b, 2 / this.st.nL);
    }
    return out.set(this.x(f), y, side * z);
  }
  normal(f, th, out = V3()) {
    const e = 0.0015;
    const a = this.point(Math.min(1, f + e), th);
    const b = this.point(Math.max(0, f - e), th);
    const c = this.point(f, th + e);
    const d = this.point(f, th - e);
    return out.crossVectors(a.sub(b), c.sub(d)).normalize();
  }
}

// ---------------------------------------------------------------------------
export function buildCar(slug, d, info = {}) {
  const shape = new BodyShape(d);
  const { L, W, H } = d.dims;
  const root = new THREE.Group();
  root.name = slug;
  const parts = new Map();
  const pickables = [];
  const exterior = [];
  const spins = [];
  const leds = { head: [], tail: [] };

  const paintMat = paint(d.paint);
  const roofMat = d.roofColor ? paint(d.roofColor) : paintMat;
  const trimMat = M.gloss;
  const bodyMats = [paintMat, M.glass, trimMat, roofMat];

  const addPart = (id, def) => {
    const p = { id, meshes: [], pieces: [], moves: [], xray: false, ...def };
    parts.set(id, p);
    return p;
  };
  const tag = (obj, partId, hover, ext = true) => {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.partId = partId;
      o.userData.hover = hover;
      if (ext) { o.userData.exterior = true; exterior.push(o); }
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.geometry.index && o.geometry.index.count > 3000 && !o.geometry.boundsTree) o.geometry.computeBoundsTree();
      pickables.push(o);
    });
  };
  const pieceOf = (part, obj, dir, label = null) => { part.pieces.push({ obj, dir, label }); return obj; };

  // ---------------- body grid ----------------
  const NF = 200, NT = 112;
  const verts = new Float32Array((NF + 1) * (NT + 1) * 3);
  const norms = new Float32Array((NF + 1) * (NT + 1) * 3);
  const tmp = V3(), nrm = V3();
  const TH0 = Math.PI; // seam along the underside
  for (let i = 0; i <= NF; i++) {
    const f = i / NF;
    for (let j = 0; j <= NT; j++) {
      const th = TH0 + (TAU * j) / NT;
      shape.point(f, th, tmp);
      shape.normal(Math.min(0.995, Math.max(0.005, f)), th, nrm);
      const k = (i * (NT + 1) + j) * 3;
      verts[k] = tmp.x; verts[k + 1] = tmp.y; verts[k + 2] = tmp.z;
      norms[k] = nrm.x; norms[k + 1] = nrm.y; norms[k + 2] = nrm.z;
    }
  }

  const doorZone = (fc, t) => {
    for (let di = 0; di < d.doors.length; di++) {
      const [a, b] = d.doors[di];
      if (fc < a || fc > b) continue;
      if (t >= HALF) return (t - HALF) < DOOR_BOTTOM ? { di, g: G.PAINT } : null;
      const { cab } = shape.levels(fc);
      const tf = t / HALF;
      if (cab >= 0.35 && inR(fc, d.cabin)) return tf > DOOR_TOP_TF ? { di, g: G.GLASS } : null;
      return tf > 0.86 ? { di, g: G.PAINT } : null;
    }
    return null;
  };
  const sideGlassEnd = d.sideGlassEnd ?? Math.min(d.cabin[1], d.roof[1] + 0.07);
  const doorEnd = d.doors[d.doors.length - 1][1];

  // owner of each quad: body | hood | cover | door:<di>:<side>
  const owners = new Map();
  const put = (key, g, a, b, c, dd) => {
    if (!owners.has(key)) owners.set(key, [[], [], [], []]);
    owners.get(key)[g].push(a, c, b, b, c, dd);
  };
  for (let i = 0; i < NF; i++) {
    const fc = (i + 0.5) / NF;
    for (let j = 0; j < NT; j++) {
      const th = (TH0 + (TAU * (j + 0.5)) / NT) % TAU;
      const side = th <= Math.PI ? 1 : -1;
      const t = side > 0 ? th : TAU - th;
      const a = i * (NT + 1) + j, b = a + 1, c = a + NT + 1, dd = c + 1;
      if (inR(fc, d.hood) && t < HOOD_T) { put('hood', G.PAINT, a, b, c, dd); continue; }
      if (d.cover && inR(fc, d.cover.range) && t < HOOD_T) {
        put('cover', d.cover.type === 'glass' ? G.GLASS : d.cover.type === 'louvre' ? G.TRIM : G.PAINT, a, b, c, dd);
        continue;
      }
      const dz = doorZone(fc, t);
      if (dz) { put(`door:${dz.di}:${side}`, dz.g, a, b, c, dd); continue; }
      let g = G.PAINT;
      const { cab } = shape.levels(fc);
      if (t < HALF && cab >= 0.35 && inR(fc, d.cabin)) {
        const tf = t / HALF;
        if (inR(fc, d.roof)) {
          if (tf < 0.5) g = d.roofGlass ? G.GLASS : d.roofColor ? G.ROOF : G.PAINT;
          else if (Math.abs(fc - doorEnd) < 0.007) g = G.TRIM;
          else g = fc <= sideGlassEnd ? G.GLASS : (d.roofColor ? G.ROOF : G.PAINT);
        } else if (tf < 0.56) g = G.GLASS;
        else if (tf < 0.68) g = d.roofColor ? G.ROOF : G.PAINT;
        else g = fc <= sideGlassEnd ? G.GLASS : (d.roofColor ? G.ROOF : G.PAINT);
      }
      put('body', g, a, b, c, dd);
    }
  }

  // Make a mesh from the grid for one owner (optionally offset outward and re-centred on a pivot)
  const gridGeo = (groups, { offset = 0, pivot = null, only = null } = {}) => {
    const pos = new Float32Array(verts.length);
    for (let k = 0; k < verts.length; k += 3) {
      pos[k] = verts[k] + norms[k] * offset - (pivot ? pivot.x : 0);
      pos[k + 1] = verts[k + 1] + norms[k + 1] * offset - (pivot ? pivot.y : 0);
      pos[k + 2] = verts[k + 2] + norms[k + 2] * offset - (pivot ? pivot.z : 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const idx = [];
    let start = 0;
    groups.forEach((list, gi) => {
      if (!list.length || (only && !only.includes(gi))) return;
      geo.addGroup(start, list.length, gi);
      for (let q = 0; q < list.length; q++) idx.push(list[q]);
      start += list.length;
    });
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };
  const withInner = (geo, mats, innerGeo) => {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(geo, mats);
    const inner = new THREE.Mesh(innerGeo || geo, M.inner);
    inner.userData.inner = true;
    g.add(outer, inner);
    return { group: g, outer, inner };
  };

  // body shell
  const bodyGroups = owners.get('body');
  const body = withInner(gridGeo(bodyGroups), bodyMats, gridGeo(bodyGroups, { only: [G.PAINT, G.TRIM, G.ROOF] }));
  root.add(body.group);
  tag(body.group, 'chassis', 'Body shell · click to see the chassis');
  body.outer.userData.pickByGroup = { [G.GLASS]: ['interior', 'Cabin · click to look inside'] };

  // Raycast helpers against the finished outer skin
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  let targets = [body.outer];
  const hit = (o, dir) => {
    ray.set(o, dir);
    const h = ray.intersectObjects(targets, false)[0];
    if (!h) return null;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    if (n.dot(dir) > 0) n.negate();
    return { p: h.point.clone(), n };
  };
  const AX = {
    front: (u, v) => [V3(10, u, v), V3(-1, 0, 0)],
    back: (u, v) => [V3(-10, u, v), V3(1, 0, 0)],
    top: (u, v) => [V3(u, 10, v), V3(0, -1, 0)],
    right: (u, v) => [V3(u, v, 10), V3(0, 0, -1)],
    left: (u, v) => [V3(u, v, -10), V3(0, 0, 1)],
  };
  const project = (axis, u, v, lift = 0) => {
    const [o, dir] = AX[axis](u, v);
    const h = hit(o, dir);
    return h ? h.p.addScaledVector(h.n, lift) : null;
  };
  // tube that hugs the surface through control points [u, v]
  const stripGeo = (axis, ctrl, radius, lift) => {
    const pts = ctrl.map(([u, v]) => project(axis, u, v, lift)).filter(Boolean);
    if (pts.length < 2) return null;
    const c0 = new THREE.CatmullRomCurve3(pts);
    const dense = c0.getPoints(28).map((p) => {
      const uv = axis === 'top' ? [p.x, p.z] : axis === 'front' || axis === 'back' ? [p.y, p.z] : [p.x, p.y];
      return project(axis, uv[0], uv[1], lift) || p;
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(dense), 64, radius, 10, false);
  };
  // a grid patch projected onto the body (grilles, intakes, vents)
  const decalGeo = (axis, [u0, u1], [v0, v1], { nu = 10, nv = 16, lift = 0.004, mask = null } = {}) => {
    const P = [];
    const [, dir] = AX[axis](0, 0);
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) P.push(project(axis, lerp(u0, u1, i / nu), lerp(v0, v1, j / nv), lift));
    const pos = [];
    const add = (p) => pos.push(p.x, p.y, p.z);
    const e1 = V3(), e2 = V3(), n = V3();
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        if (mask && !mask((i + 0.5) / nu, (j + 0.5) / nv)) continue;
        const a = P[i * (nv + 1) + j], b = P[i * (nv + 1) + j + 1], c = P[(i + 1) * (nv + 1) + j], e = P[(i + 1) * (nv + 1) + j + 1];
        if (!a || !b || !c || !e) continue;
        n.crossVectors(e1.subVectors(c, a), e2.subVectors(b, a));
        if (n.dot(dir) < 0) { add(a); add(c); add(b); add(b); add(c); add(e); }
        else { add(a); add(b); add(c); add(b); add(e); add(c); }
      }
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  };
  const shiftGeo = (geo, pivot) => (pivot ? geo.translate(-pivot.x, -pivot.y, -pivot.z) : geo);
  root.updateMatrixWorld(true);

  // ---------------- bonnet ----------------
  const hoodPivot = V3(shape.x(d.hood[1]), shape.top(d.hood[1]) - 0.01, 0);
  const hoodGroup = new THREE.Group();
  hoodGroup.position.copy(hoodPivot);
  const hood = withInner(gridGeo(owners.get('hood'), { offset: 0.003, pivot: hoodPivot }), bodyMats);
  hoodGroup.add(hood.group);
  root.add(hoodGroup);
  tag(hood.group, 'engine', 'Bonnet · click for X-RAY engine');
  root.updateMatrixWorld(true);
  targets = [body.outer, hood.outer];

  // ---------------- engine cover (mid / rear engine) ----------------
  let coverGroup = null;
  if (d.cover && owners.has('cover')) {
    const cp = V3(shape.x(d.cover.range[0]), shape.top(d.cover.range[0]) - 0.01, 0);
    coverGroup = new THREE.Group();
    coverGroup.position.copy(cp);
    const cov = withInner(gridGeo(owners.get('cover'), { offset: 0.003, pivot: cp }), bodyMats);
    coverGroup.add(cov.group);
    root.add(coverGroup);
    root.updateMatrixWorld(true);
    if (d.cover.type === 'louvre') {
      targets = [cov.outer];
      const geos = [];
      for (let k = 0; k < 7; k++) {
        const x = shape.x(lerp(d.cover.range[0] + 0.012, d.cover.range[1] - 0.012, (k + 0.5) / 7));
        const g = stripGeo('top', [[x, -W * 0.3], [x, 0], [x, W * 0.3]], 0.009, 0.004);
        if (g) geos.push(shiftGeo(g, cp));
      }
      if (geos.length) coverGroup.add(new THREE.Mesh(mergeGeometries(geos), paintMat));
      targets = [body.outer, hood.outer];
    }
    targets.push(cov.outer);
    tag(coverGroup, 'engine', 'Engine cover · click for X-RAY engine');
  }

  // ---------------- doors ----------------
  const doorGroups = { 1: [], [-1]: [] };
  for (const side of [1, -1]) {
    const part = addPart(side > 0 ? 'door-r' : 'door-l', {
      key: 'doors', name: side > 0 ? 'Right door' : 'Left door',
    });
    d.doors.forEach(([a, b], di) => {
      const groups = owners.get(`door:${di}:${side}`);
      if (!groups) return;
      const lv = shape.levels(a);
      const pivot = V3(shape.x(a), lv.ybelt - 0.05, side * shape.hw(a) * 0.97);
      const dg = new THREE.Group();
      dg.position.copy(pivot);
      root.add(dg);
      doorGroups[side].push(dg);

      const skin = withInner(gridGeo(groups, { offset: 0.003, pivot, only: [G.PAINT] }), bodyMats);
      dg.add(skin.group);
      pieceOf(part, skin.group, V3(0, 0.04, side * 0.5), di === 0 ? 'Door skin' : null);
      if (groups[G.GLASS].length) {
        const glass = new THREE.Mesh(gridGeo(groups, { offset: 0.003, pivot, only: [G.GLASS] }), bodyMats);
        dg.add(glass);
        pieceOf(part, glass, V3(0, 0.42, side * 0.22), di === 0 ? 'Frameless window glass' : null);
      }
      const trim = new THREE.Mesh(gridGeo(groups, { offset: -0.045, pivot, only: [G.PAINT] }), solid('#2a2523', 0, 0.8, { side: THREE.DoubleSide }));
      dg.add(trim);
      pieceOf(part, trim, V3(0, 0, -side * 0.1), di === 0 ? 'Leather trim panel' : null);

      // side impact beam + speaker inside the door
      const p1 = shape.point(a + 0.03, side > 0 ? HALF + 0.35 : TAU - HALF - 0.35);
      const p2 = shape.point(b - 0.03, side > 0 ? HALF + 0.35 : TAU - HALF - 0.35);
      p1.z -= side * 0.035; p2.z -= side * 0.035;
      const beam = mesh(new THREE.CylinderGeometry(0.022, 0.022, p1.distanceTo(p2), 12), M.steel);
      beam.position.copy(p1.clone().add(p2).multiplyScalar(0.5).sub(pivot));
      beam.quaternion.setFromUnitVectors(V3(0, 1, 0), p2.clone().sub(p1).normalize());
      dg.add(beam);
      pieceOf(part, beam, V3(0, 0, side * 0.3), di === 0 ? 'Side-impact beam' : null);
      const sp = shape.point(lerp(a, b, 0.25), side > 0 ? HALF + 0.5 : TAU - HALF - 0.5);
      const speaker = mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.03, 24), M.darkAlloy, { rot: [HALF, 0, 0] });
      speaker.position.copy(sp.sub(pivot)).add(V3(0, 0, -side * 0.06));
      dg.add(speaker);
      pieceOf(part, speaker, V3(0, -0.06, side * 0.16), di === 0 ? 'Door speaker' : null);

      // side mirror on the front door
      if (di === 0) {
        const fm = Math.max(a + 0.012, d.cabin[0] + 0.03);
        const mp = shape.point(fm, side > 0 ? HALF - 0.05 : TAU - HALF + 0.05);
        const mg = new THREE.Group();
        mg.position.copy(mp.sub(pivot)).add(V3(0, 0.06, side * 0.02));
        mg.add(mesh(new THREE.BoxGeometry(0.04, 0.03, 0.09), M.black, { pos: [0, 0, side * 0.04] }));
        mg.add(mesh(rbox(0.1, 0.085, 0.17, 0.03), paintMat, { pos: [0, 0.025, side * 0.14] }));
        mg.add(mesh(new THREE.BoxGeometry(0.004, 0.07, 0.15), M.mirror, { pos: [-0.051, 0.025, side * 0.14] }));
        dg.add(mg);
        pieceOf(part, mg, V3(0.05, 0.16, side * 0.42), 'Side mirror');
      }

      // opening motion
      const open = d.doorType === 'scissor' ? new THREE.Euler(0, side * 0.12, -1.2)
        : d.doorType === 'dihedral' ? new THREE.Euler(-side * 0.3, side * 0.45, -0.95)
          : new THREE.Euler(0, side * (di === 0 ? 1.05 : 0.95), 0);
      part.moves.push({ obj: dg, rot: open });
      tag(dg, part.id, `${side > 0 ? 'Right' : 'Left'} door${d.doors.length > 1 ? 's' : ''} · ${info.doors || 'click to open'}`);
    });
    const ctr = shape.point(lerp(d.doors[0][0], d.doors[0][1], 0.5), side > 0 ? HALF : TAU - HALF);
    part.focus = { target: ctr.clone().add(V3(0, 0.15, side * 0.45)), dir: V3(-0.25, 0.38, side), dist: 4.8 };
  }

  // ---------------- underbody ----------------
  const floorY = shape.bot(0.5) + 0.02;
  const under = mesh(rbox(L * 0.86, 0.04, W * 0.78, 0.02), M.black, { pos: [0, floorY, 0] });
  root.add(under);

  // ---------------- wheels ----------------
  const tyre = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.88, side: THREE.DoubleSide });
  const rimMat = solid(d.rimColor || '#2d3036', 0.95, 0.3, { side: THREE.DoubleSide });
  const caliperMat = solid(d.caliper, 0.3, 0.35);
  const wheelGroups = [];
  const mkWheel = (front, side) => {
    const R = front ? d.dims.rf : d.dims.rr;
    const tw = front ? d.dims.twf : d.dims.twr;
    const rimR = R * (d.rimRatio || (R > 0.38 ? 0.58 : 0.74));
    const ax = front ? shape.xa : shape.xr;
    const f = front ? shape.fa : shape.ra;
    const zc = side * Math.max(0.5, shape.hw(f) - tw / 2 - 0.012);
    const id = `wheel-${front ? 'f' : 'r'}${side > 0 ? 'r' : 'l'}`;
    const name = `${front ? 'Front' : 'Rear'}-${side > 0 ? 'right' : 'left'} wheel`;
    const part = addPart(id, { key: 'wheels', name });

    const g = new THREE.Group();
    g.position.set(ax, R, zc);
    const spin = new THREE.Group();
    g.add(spin);
    spins.push(spin);

    const w = tw / 2;
    const prof = [[rimR * 0.97, -w * 0.8], [R - 0.05, -w], [R - 0.014, -w * 0.93], [R, -w * 0.72], [R, w * 0.72], [R - 0.014, w * 0.93], [R - 0.05, w], [rimR * 0.97, w * 0.8]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const tg = new THREE.LatheGeometry(prof, 64);
    tg.rotateX(HALF);
    const tyreM = new THREE.Mesh(tg, tyre);
    spin.add(tyreM);
    pieceOf(part, tyreM, V3(0, 0, side * 0.9), `Tyre · ${front ? info.tyreF || '' : info.tyreR || ''}`);

    const rim = new THREE.Group();
    const barrel = new THREE.CylinderGeometry(rimR, rimR * 0.96, tw * 0.82, 48, 1, true);
    barrel.rotateX(HALF);
    rim.add(new THREE.Mesh(barrel, rimMat));
    rim.add(mesh(new THREE.TorusGeometry(rimR, 0.011, 8, 56), M.chrome, { pos: [0, 0, side * tw * 0.4] }));
    const n = d.spokes || 10;
    const len = rimR * 0.86;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const sp = mesh(new THREE.BoxGeometry(n > 12 ? 0.018 : 0.034, len, 0.03), rimMat);
      sp.position.set(Math.cos(a) * (len / 2 + 0.05), Math.sin(a) * (len / 2 + 0.05), side * tw * 0.3);
      sp.rotation.z = a - HALF;
      rim.add(sp);
    }
    rim.add(mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.05, 24), rimMat, { pos: [0, 0, side * tw * 0.31], rot: [HALF, 0, 0] }));
    rim.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), M.chrome, { pos: [0, 0, side * (tw * 0.31 + 0.03)], rot: [HALF, 0, 0] }));
    spin.add(rim);
    pieceOf(part, rim, V3(0, 0, side * 0.58), 'Forged alloy wheel');

    const disc = new THREE.Group();
    disc.add(mesh(new THREE.CylinderGeometry(rimR * 0.8, rimR * 0.8, 0.032, 48), M.disc, { rot: [HALF, 0, 0] }));
    disc.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 24), M.darkAlloy, { pos: [0, 0, side * 0.02], rot: [HALF, 0, 0] }));
    disc.position.z = side * tw * 0.04;
    spin.add(disc);
    pieceOf(part, disc, V3(0, 0, side * 0.32), `Brake disc · ${info.brakes || ''}`);

    const cal = mesh(new THREE.TorusGeometry(rimR * 0.68, 0.042, 10, 16, 1.15), caliperMat);
    cal.rotation.z = Math.PI * 0.52;
    cal.position.z = side * tw * 0.04;
    cal.scale.set(1, 1, 1.15);
    g.add(cal);
    pieceOf(part, cal, V3(0, 0.24, side * 0.36), 'Brake caliper');

    const hub = new THREE.Group();
    hub.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 20), M.steel, { rot: [HALF, 0, 0] }));
    hub.add(mesh(rbox(0.07, 0.26, 0.06, 0.015), M.darkAlloy, { pos: [0, 0.02, -side * 0.07] }));
    hub.position.z = -side * 0.03;
    g.add(hub);
    pieceOf(part, hub, V3(0, 0, side * 0.14), 'Hub, bearing & upright');

    const coil = new THREE.Group();
    const helix = [];
    for (let k = 0; k <= 120; k++) { const a = (k / 120) * TAU * 6; helix.push(V3(Math.cos(a) * 0.05, -0.15 + (k / 120) * 0.3, Math.sin(a) * 0.05)); }
    coil.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 240, 0.009, 6), caliperMat));
    coil.add(mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.4, 14), M.steel));
    coil.position.set(0, 0.13, -side * (tw / 2 + 0.07));
    coil.scale.setScalar(0.8);
    coil.rotation.x = side * 0.12;
    g.add(coil);
    pieceOf(part, coil, V3(0, 0.42, -side * 0.04), 'Coil-over damper');

    root.add(g);
    wheelGroups.push(g);
    part.moves.push({ obj: g, pos: g.position.clone().add(V3(0, 0.05, side * 0.32)) });
    part.focus = { target: g.position.clone().add(V3(0, 0.15, side * 0.75)), dir: V3(front ? 0.4 : -0.4, 0.32, side), dist: 3.7 };
    tag(g, id, `${name} · ${front ? info.tyreF || '' : info.tyreR || ''}`, false);
  };
  for (const front of [true, false]) for (const side of [1, -1]) mkWheel(front, side);

  // ---------------- lights ----------------
  const lamp = (axis, cfg, ledMat, lensMat, part, labelPrefix) => {
    const sgn = axis === 'front' ? 1 : -1;
    const sides = cfg.style === 'bar' ? [0] : [1, -1];
    sides.forEach((side) => {
      const zc = (cfg.z * W) / 2;
      const strips = [];
      const discs = [];
      const y = cfg.y, w = cfg.w, h = cfg.h;
      const Z = (z) => (side === 0 ? z : side * z);
      switch (cfg.style) {
        case 'bar': {
          const pts = [];
          for (let k = 0; k <= 10; k++) pts.push([y, lerp(-zc, zc, k / 10)]);
          strips.push({ pts, r: h * 0.4 });
          break;
        }
        case 'blade': strips.push({ pts: [[y + 0.035, Z(zc - w * 0.5)], [y + 0.01, Z(zc)], [y - 0.03, Z(zc + w * 0.42)]], r: 0.018 }, { pts: [[y, Z(zc - w * 0.1)], [y - 0.05, Z(zc + w * 0.12)]], r: 0.011 }); break;
        case 'swept': strips.push({ pts: [[y + 0.03, Z(zc - w * 0.5)], [y + 0.01, Z(zc)], [y - 0.025, Z(zc + w * 0.5)]], r: 0.026 }, { pts: [[y + 0.065, Z(zc - w * 0.42)], [y + 0.045, Z(zc + w * 0.38)]], r: 0.007 }); break;
        case 'boomerang': strips.push({ pts: [[y + 0.04, Z(zc - w * 0.5)], [y, Z(zc)], [y - 0.05, Z(zc + w * 0.45)]], r: 0.03 }, { pts: [[y - 0.0, Z(zc - w * 0.3)], [y - 0.03, Z(zc - w * 0.05)], [y + 0.0, Z(zc + w * 0.15)]], r: 0.008 }); break;
        case 'angular': strips.push({ pts: [[y + 0.03, Z(zc - w * 0.5)], [y + 0.02, Z(zc + w * 0.2)], [y - 0.03, Z(zc + w * 0.5)]], r: 0.03 }, { pts: [[y + 0.045, Z(zc - w * 0.4)], [y + 0.045, Z(zc + w * 0.15)], [y - 0.02, Z(zc + w * 0.3)]], r: 0.008 }); break;
        case 'tri':
          if (axis === 'front') strips.push({ pts: [[y + 0.02, Z(zc - w * 0.5)], [y, Z(zc + w * 0.5)]], r: 0.03 });
          for (let k = -1; k <= 1; k++) strips.push({ pts: [[y + h * 0.5, Z(zc + k * w * 0.26)], [y - h * 0.5, Z(zc + k * w * 0.26 + 0.015)]], r: 0.012 });
          break;
        case 'slim': strips.push({ pts: [[y, Z(zc - w * 0.5)], [y + 0.008, Z(zc + w * 0.2)], [y - 0.015, Z(zc + w * 0.5)]], r: h * 0.4 }); break;
        case 'y': strips.push({ pts: [[y + 0.05, Z(zc - w * 0.35)], [y, Z(zc)], [y + 0.05, Z(zc + w * 0.35)]], r: 0.014 }, { pts: [[y, Z(zc)], [y - 0.06, Z(zc + 0.01)]], r: 0.014 }); break;
        case 'vertical': strips.push({ pts: [[y + h * 0.5, Z(zc)], [y - h * 0.5, Z(zc)]], r: w * 0.4 }); break;
        case 'round': discs.push({ y, z: Z(zc), r: w / 2 }); break;
        case 'socket': discs.push({ y, z: Z(zc), r: h * 0.6, socket: true }); strips.push({ pts: [[y + h * 0.25, Z(zc - w * 0.35)], [y + h * 0.25, Z(zc + w * 0.2)], [y - h * 0.3, Z(zc + w * 0.32)]], r: 0.01 }); break;
        case 'quad': for (let k = 0; k < 4; k++) discs.push({ y: y + 0.012 * (1.5 - k), z: Z(zc - w * 0.5 + (w * (k + 0.5)) / 4), r: 0.03 }); break;
        case 'twin-round': discs.push({ y, z: Z(zc), r: 0.052 }, { y, z: Z(zc - 0.2), r: 0.052 }); break;
        case 'quad-round': discs.push({ y, z: Z(zc), r: w / 2 }, { y, z: Z(zc - 0.25), r: w / 2 }); break;
        default: break;
      }
      const hous = [], led = [], lens = [];
      strips.forEach((s) => {
        const a = stripGeo(axis, s.pts, s.r * 2 + 0.01, 0.0);
        const b = stripGeo(axis, s.pts, s.r, s.r + 0.004);
        const c = stripGeo(axis, s.pts, s.r * 1.9 + 0.008, 0.01);
        if (a) hous.push(a); if (b) led.push(b); if (c) lens.push(c);
      });
      const grp = new THREE.Group();
      const ledMeshes = [];
      if (hous.length) {
        const hm = new THREE.Mesh(mergeGeometries(hous), M.gloss); grp.add(hm);
        pieceOf(part, hm, V3(sgn * 0.08, 0, 0), side >= 0 ? `${labelPrefix} housing` : null);
      }
      if (led.length) {
        const lm = new THREE.Mesh(mergeGeometries(led), ledMat); grp.add(lm); ledMeshes.push(lm);
        pieceOf(part, lm, V3(sgn * 0.26, 0.04, 0), side >= 0 ? `${labelPrefix} LED module` : null);
      }
      if (lens.length) {
        const cm = new THREE.Mesh(mergeGeometries(lens), lensMat); grp.add(cm);
        pieceOf(part, cm, V3(sgn * 0.44, 0.08, 0), side >= 0 ? `${labelPrefix} lens` : null);
      }
      discs.forEach((dc, k) => {
        const p = project(axis, dc.y, dc.z, 0);
        if (!p) return;
        const [, dir] = AX[axis](0, 0);
        const n = dir.clone().negate();
        const hh = hit(...AX[axis](dc.y, dc.z));
        if (hh) n.copy(hh.n);
        const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), n);
        const hous1 = mesh(new THREE.CylinderGeometry(dc.r * 1.12, dc.r * 1.12, 0.05, 32), M.gloss);
        hous1.position.copy(p); hous1.quaternion.copy(q);
        const ring = new THREE.Group();
        ring.add(mesh(new THREE.TorusGeometry(dc.r * 0.8, dc.r * 0.1, 8, 32), ledMat, { rot: [HALF, 0, 0] }));
        if (!dc.socket) ring.add(mesh(new THREE.SphereGeometry(dc.r * 0.42, 20, 12), axis === 'front' ? M.chrome : ledMat));
        ring.position.copy(p).addScaledVector(n, 0.03); ring.quaternion.copy(q);
        const lensD = mesh(new THREE.SphereGeometry(dc.r * 1.08, 28, 12, 0, TAU, 0, 0.9), lensMat);
        lensD.scale.set(1, 0.35, 1);
        lensD.position.copy(p).addScaledVector(n, 0.025); lensD.quaternion.copy(q);
        grp.add(hous1, ring, lensD);
        ring.traverse((o) => { if (o.isMesh && o.material === ledMat) ledMeshes.push(o); });
        const first = side >= 0 && k === 0 && !hous.length;
        pieceOf(part, hous1, n.clone().multiplyScalar(0.08), first ? `${labelPrefix} housing` : null);
        pieceOf(part, ring, n.clone().multiplyScalar(0.26), first ? `${labelPrefix} LED ring` : null);
        pieceOf(part, lensD, n.clone().multiplyScalar(0.44), first ? `${labelPrefix} lens` : null);
      });
      root.add(grp);
      tag(grp, part.id, part.hover);
      (axis === 'front' ? leds.head : leds.tail).push(...ledMeshes);
    });
  };
  const headPart = addPart('lights-front', { key: 'lights', name: 'Headlights', hover: `Headlights · ${info.lights || ''}` });
  lamp('front', d.head, M.headLed, M.lens, headPart, 'Headlamp');
  headPart.focus = { target: V3(L / 2 + 0.05, d.head.y, 0), dir: V3(1, 0.32, 0.6), dist: 4.0 };
  const tailPart = addPart('lights-rear', { key: 'lights', name: 'Tail lights', hover: 'Tail lights' });
  lamp('back', d.tail, M.tailLed, M.redLens, tailPart, 'Tail lamp');
  tailPart.focus = { target: V3(-L / 2 - 0.05, d.tail.y, 0), dir: V3(-1, 0.32, 0.6), dist: 4.0 };

  // ---------------- grille & intakes ----------------
  const front = (yr, zr, opts, mat) => {
    const g = decalGeo('front', yr, zr, opts);
    if (g) { const m = new THREE.Mesh(g, mat); root.add(m); tag(m, 'chassis', 'Front grille & intakes'); }
  };
  const ellipse = (u, v) => ((u - 0.5) / 0.5) ** 2 + ((v - 0.5) / 0.5) ** 2 < 1;
  const base = shape.bot(0.03);
  switch (d.grille.style) {
    case 'intake':
    case 'intake3':
      front([base + 0.05, base + 0.17], [-W * 0.2, W * 0.2], { nu: 4, nv: 18 }, M.mesh);
      for (const s of [1, -1]) front([base + 0.06, base + 0.24], s > 0 ? [W * 0.27, W * 0.42] : [-W * 0.42, -W * 0.27], { nu: 6, nv: 8 }, M.mesh);
      break;
    case 'kidney':
      for (const s of [1, -1]) {
        const zr = s > 0 ? [0.03, 0.25] : [-0.25, -0.03];
        front([base + 0.2, base + 0.55], zr, { nu: 14, nv: 8, lift: 0.006, mask: (u, v) => ((u - 0.5) / 0.5) ** 4 + ((v - 0.5) / 0.5) ** 4 < 1 }, M.chrome);
        front([base + 0.215, base + 0.535], [zr[0] + 0.015, zr[1] - 0.015], { nu: 14, nv: 8, lift: 0.01, mask: (u, v) => ((u - 0.5) / 0.5) ** 4 + ((v - 0.5) / 0.5) ** 4 < 1 }, M.mesh);
      }
      front([base + 0.04, base + 0.14], [-W * 0.3, W * 0.3], { nu: 3, nv: 16 }, M.mesh);
      break;
    case 'trapezoid':
      front([base + 0.12, base + 0.42], [-W * 0.27, W * 0.27], { nu: 10, nv: 18, mask: (u, v) => Math.abs(v - 0.5) < 0.38 + u * 0.12 }, M.mesh);
      break;
    case 'vmesh':
      front([base + 0.1, base + 0.38], [-W * 0.22, W * 0.22], { nu: 10, nv: 18, lift: 0.005, mask: (u, v) => Math.abs(v - 0.5) < 0.3 + u * 0.2 }, M.chrome);
      front([base + 0.115, base + 0.365], [-W * 0.21, W * 0.21], { nu: 10, nv: 18, lift: 0.009, mask: (u, v) => Math.abs(v - 0.5) < 0.28 + u * 0.2 }, M.mesh);
      break;
    case 'horseshoe':
      front([base + 0.1, base + 0.42], [-0.17, 0.17], { nu: 14, nv: 10, lift: 0.005, mask: ellipse }, M.chrome);
      front([base + 0.12, base + 0.4], [-0.15, 0.15], { nu: 14, nv: 10, lift: 0.009, mask: ellipse }, M.mesh);
      for (const s of [1, -1]) front([base + 0.04, base + 0.22], s > 0 ? [W * 0.22, W * 0.4] : [-W * 0.4, -W * 0.22], { nu: 6, nv: 8 }, M.mesh);
      break;
    case 'slots':
      for (let k = -2.5; k <= 2.5; k += 1) front([base + 0.22, base + 0.5], [k * 0.085 - 0.025, k * 0.085 + 0.025], { nu: 8, nv: 2 }, M.mesh);
      front([base + 0.03, base + 0.12], [-W * 0.42, W * 0.42], { nu: 2, nv: 16, lift: 0.01 }, M.black);
      break;
    default:
      front([base + 0.05, base + 0.14], [-W * 0.18, W * 0.18], { nu: 3, nv: 12 }, M.mesh);
  }

  // side intakes (mid-engine cars)
  if (d.sideIntake) {
    for (const s of [1, -1]) {
      const [fa, fb] = d.sideIntake;
      const yb = shape.bot(fb) + 0.14, yt = shape.levels(fa).ybelt - 0.06;
      const g = decalGeo(s > 0 ? 'right' : 'left', [shape.x(fb), shape.x(fa)], [yb, yt], { nu: 40, nv: 30, mask: (u, v) => u > 0.12 + (1 - v) * 0.42 && v > 0.04 && u < 0.97 });
      if (g) { const m = new THREE.Mesh(g, M.mesh); root.add(m); tag(m, 'chassis', 'Side air intake'); }
    }
  }

  // wheel-arch flares (SUV)
  if (d.flares) {
    for (const [ax, R] of [[shape.xa, d.dims.rf], [shape.xr, d.dims.rr]]) {
      for (const s of [1, -1]) {
        const f = shape.fa + (ax === shape.xr ? shape.ra - shape.fa : 0);
        const fl = mesh(new THREE.TorusGeometry(R + shape.gap + 0.02, 0.05, 8, 28, Math.PI), M.black);
        fl.position.set(ax, R, s * (shape.hw(f) - 0.01));
        fl.scale.set(1, 1, 0.55);
        root.add(fl);
        tag(fl, 'chassis', 'Wheel-arch cladding');
      }
    }
  }

  // ---------------- rear wing ----------------
  if (d.wing && d.wing !== 'none') {
    const part = addPart('wing', { key: 'aero', name: 'Rear wing', hover: `Rear wing · ${info.aero || ''}` });
    const wg = new THREE.Group();
    const fw = d.wing === 'big' ? 0.95 : d.wing === 'trunk' ? 0.93 : 0.965;
    const wx = shape.x(fw);
    const deck = shape.top(fw);
    const airfoil = (chord, thick) => {
      const s = new THREE.Shape();
      s.moveTo(chord / 2, 0);
      s.bezierCurveTo(chord / 4, thick * 0.9, -chord / 3, thick, -chord / 2, thick * 0.2);
      s.lineTo(-chord / 2, -thick * 0.1);
      s.bezierCurveTo(-chord / 4, -thick * 0.25, chord / 4, -thick * 0.2, chord / 2, 0);
      return s;
    };
    const plane = (chord, thick, span, mat) => {
      const g = new THREE.ExtrudeGeometry(airfoil(chord, thick), { depth: span, bevelEnabled: false, curveSegments: 16 });
      g.translate(0, 0, -span / 2);
      return new THREE.Mesh(g, mat);
    };
    if (d.wing === 'big' || d.wing === 'trunk' || d.wing === 'active') {
      const span = W * (d.wing === 'big' ? 0.9 : d.wing === 'trunk' ? 0.82 : 0.74);
      const hgt = d.wing === 'big' ? 0.3 : d.wing === 'trunk' ? 0.13 : 0.06;
      const mat = d.wing === 'active' ? paintMat : d.wing === 'trunk' ? paintMat : M.carbon;
      const main = plane(d.wing === 'active' ? 0.3 : 0.28, 0.05, span, mat);
      main.position.set(wx, deck + hgt, 0);
      main.rotation.z = d.wing === 'big' ? -0.12 : -0.05;
      wg.add(main);
      pieceOf(part, main, V3(0, 0.45, 0), d.wing === 'active' ? 'Active wing / air brake' : 'Carbon wing element');
      const struts = new THREE.Group();
      const zs = d.wing === 'trunk' ? span * 0.38 : 0.24;
      for (const s of [1, -1]) struts.add(mesh(new THREE.BoxGeometry(0.12, hgt + 0.04, 0.02), M.carbon, { pos: [wx + 0.02, deck + hgt / 2 - 0.01, s * zs] }));
      wg.add(struts);
      pieceOf(part, struts, V3(0, 0.18, 0), 'Wing struts');
      if (d.wing === 'big') {
        const ends = new THREE.Group();
        for (const s of [1, -1]) ends.add(mesh(rbox(0.36, 0.16, 0.012, 0.005), M.carbon, { pos: [wx, deck + hgt - 0.02, s * span / 2] }));
        wg.add(ends);
        pieceOf(part, ends, V3(0, 0.3, 0), 'End plates');
      }
    } else {
      const span = W * (d.wing === 'ducktail' ? 0.8 : 0.7);
      const lip = plane(d.wing === 'ducktail' ? 0.18 : 0.12, d.wing === 'ducktail' ? 0.06 : 0.025, span, d.wing === 'ducktail' ? paintMat : M.carbon);
      lip.position.set(wx, deck - 0.005, 0);
      lip.rotation.z = -0.25;
      wg.add(lip);
      pieceOf(part, lip, V3(-0.15, 0.4, 0), d.wing === 'ducktail' ? 'Integrated ducktail spoiler' : 'Carbon lip spoiler');
    }
    root.add(wg);
    tag(wg, 'wing', part.hover);
    part.focus = { target: V3(wx, deck + 0.3, 0), dir: V3(-1, 0.7, 0.8), dist: 4.2 };
  }

  // ---------------- engine / drivetrain ----------------
  const engPart = addPart('engine', { key: 'engine', name: d.engine.layout === 'EV' ? 'Electric drivetrain' : 'Engine', xray: true });
  const es = { ...d.engine, code: info.engine_code, disp: info.displacement_l, layoutName: info.engine_layout };
  let eng, engOrigin, engScale = 1;
  if (d.engine.layout === 'EV') {
    const cx = (shape.xa + shape.xr) / 2;
    eng = buildEngine(es, { frontAxle: shape.xa - cx, rearAxle: shape.xr - cx, packLength: shape.xa - shape.xr - 0.95, packWidth: W * 0.74 });
    engOrigin = V3(cx, shape.bot(0.5) + 0.09, 0);
  } else {
    eng = buildEngine(es);
    const pos = d.engine.position;
    const ox = pos === 'front' ? shape.xa - 0.42 : pos === 'mid' ? shape.xr + 0.6 : shape.xr - 0.42;
    const f = (L / 2 - ox) / L;
    const bottom = shape.bot(f);
    const room = shape.top(f) - bottom - 0.08;
    engScale = Math.min(1, room / 0.9, (pos === 'front' ? 1.05 : 1.1) / eng.length);
    engOrigin = V3(ox, bottom + 0.27 * engScale + 0.02, 0);
  }
  const eg = eng.group;
  eg.position.copy(engOrigin);
  eg.scale.setScalar(engScale);
  root.add(eg);
  eng.pieces.forEach((p) => pieceOf(engPart, p.obj, p.dir, p.label));
  tag(eg, 'engine', engPart.name, false);
  const riseY = H + 0.42;
  engPart.moves.push({ obj: eg, pos: V3(engOrigin.x, riseY, 0), scale: Math.max(1, engScale) });
  engPart.moves.push({ obj: hoodGroup, rot: new THREE.Euler(0, 0, 0.95) });
  if (coverGroup) engPart.moves.push({ obj: coverGroup, rot: new THREE.Euler(0, 0, -0.95) });
  engPart.focus = { target: V3(engOrigin.x, riseY + 0.12, 0), dir: V3(0.85, 0.55, 1), dist: d.engine.layout === 'EV' ? 6.8 : 5.9 };

  // ---------------- exhaust system ----------------
  const tips = d.exhaust.tips || [];
  if (tips.length) {
    const part = addPart('exhaust', { key: 'exhaust', name: 'Exhaust system', xray: true, hover: `Exhaust · ${info.exhaust || ''}` });
    const tipGroup = new THREE.Group();
    const pipes = [];
    const silX = shape.x(0.9);
    const lowY = shape.bot(0.5) + 0.07;
    const engX = engOrigin.x - (d.engine.position === 'rear' ? -0.1 : 0.25);
    tips.forEach(([y, z, r, oval = 1]) => {
      let p = project('back', y, z, 0);
      if (!p) p = V3(-L / 2 + 0.25, y, z);
      const tip = mesh(new THREE.CylinderGeometry(r, r * 0.92, 0.16, 28, 1, true), M.titanium);
      tip.material = solid('#b9b3c9', 1, 0.2, { side: THREE.DoubleSide });
      tip.rotation.z = HALF;
      tip.scale.set(1, 1, oval);
      tip.position.copy(p).add(V3(-0.03, 0, 0));
      const inner = mesh(new THREE.CircleGeometry(r * 0.9, 24), M.black, { rot: [0, HALF, 0] });
      inner.position.copy(p).add(V3(0.04, 0, 0));
      inner.scale.set(1, oval, 1);
      tipGroup.add(tip, inner);
      const startY = d.engine.position === 'front' ? lowY : Math.max(lowY, y - 0.05);
      const c = new THREE.CatmullRomCurve3([
        V3(engX, startY + 0.02, Math.sign(z || 1) * 0.12),
        V3(engX - 0.4, startY, Math.sign(z || 1) * 0.2),
        V3(silX + 0.25, Math.max(lowY, y - 0.08), z * 0.7),
        V3(p.x + 0.1, y, z),
      ]);
      pipes.push(new THREE.TubeGeometry(c, 40, Math.min(0.03, r * 0.6), 10));
    });
    const pipeM = new THREE.Mesh(mergeGeometries(pipes), M.titanium);
    const cats = new THREE.Group();
    for (const s of [1, -1]) cats.add(mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.3, 20), M.steel, { pos: [engX - 0.45, lowY + 0.01, s * 0.2], rot: [0, 0, HALF] }));
    const silencer = mesh(rbox(0.32, 0.18, W * 0.5, 0.06), M.steel, { pos: [silX + 0.15, Math.max(lowY + 0.04, (tips[0][0] || 0.4) - 0.04), 0] });
    const sys = new THREE.Group();
    sys.add(pipeM, cats, silencer, tipGroup);
    root.add(sys);
    pieceOf(part, pipeM, V3(0, -0.35, 0), 'Exhaust pipes');
    pieceOf(part, cats, V3(0.1, -0.55, 0), d.engine.diesel ? 'Diesel particulate filter' : 'Catalytic converters');
    pieceOf(part, silencer, V3(-0.1, -0.5, 0), 'Rear silencer (muffler)');
    pieceOf(part, tipGroup, V3(-0.45, 0.05, 0), 'Tailpipes');
    tag(tipGroup, 'exhaust', part.hover, false);
    tag(pipeM, 'exhaust', part.hover, false);
    tag(cats, 'exhaust', part.hover, false);
    tag(silencer, 'exhaust', part.hover, false);
    part.focus = { target: V3(-L / 2 + 0.9, 0.25, 0), dir: V3(-1, 0.05, 0.9), dist: 4.8 };
  }

  // ---------------- interior ----------------
  {
    const part = addPart('interior', { key: 'interior', name: 'Cabin', xray: true, hover: 'Cabin · click to look inside' });
    const ig = new THREE.Group();
    const twoSeat = (info.seats || 2) <= 2;
    const fSeat = twoSeat ? (d.roof[0] + d.roof[1]) / 2 - 0.015 : d.roof[0] + 0.035;
    const sx = shape.x(fSeat);
    const fl = shape.bot(fSeat) + 0.05;
    const s = Math.min(1, (shape.top(fSeat) - fl - 0.08) / 0.86);
    const sz = 0.26 * (W / 1.95);
    const driverZ = d.rhd ? sz : -sz;
    const seatMat = M.leather;
    const seat = (x, z, scale) => {
      const g = new THREE.Group();
      g.add(mesh(rbox(0.5, 0.11, 0.48, 0.04), seatMat, { pos: [0, 0.12, 0] }));
      g.add(mesh(rbox(0.12, 0.62, 0.48, 0.05), seatMat, { pos: [-0.24, 0.46, 0], rot: [0, 0, 0.22] }));
      g.add(mesh(rbox(0.1, 0.16, 0.26, 0.04), seatMat, { pos: [-0.33, 0.84, 0], rot: [0, 0, 0.22] }));
      for (const k of [1, -1]) g.add(mesh(rbox(0.42, 0.09, 0.06, 0.025), M.alcantara, { pos: [0, 0.2, k * 0.22] }));
      g.position.set(x, fl, z);
      g.scale.setScalar(scale);
      return g;
    };
    const dSeat = seat(sx, driverZ, s);
    const pSeat = seat(sx, -driverZ, s);
    ig.add(dSeat, pSeat);
    pieceOf(part, dSeat, V3(0, 0.95, 0), 'Sport bucket seats');
    pieceOf(part, pSeat, V3(0, 0.95, 0));
    if (!twoSeat) {
      const fr = d.roof[1] - 0.04;
      const rs = new THREE.Group();
      rs.add(mesh(rbox(0.46, 0.1, W * 0.62, 0.04), seatMat, { pos: [0, 0.12, 0] }));
      rs.add(mesh(rbox(0.12, 0.5, W * 0.62, 0.05), seatMat, { pos: [-0.22, 0.4, 0], rot: [0, 0, 0.25] }));
      rs.position.set(shape.x(fr), shape.bot(fr) + 0.05, 0);
      rs.scale.setScalar(Math.min(1, (shape.top(fr) - shape.bot(fr) - 0.1) / 0.7));
      ig.add(rs);
      pieceOf(part, rs, V3(-0.1, 0.75, 0), 'Rear bench');
    }
    const fDash = d.cabin[0] + 0.035;
    const dashY = shape.levels(fDash).ybelt - 0.06;
    const dx = shape.x(fDash) - 0.18;
    const dash = mesh(rbox(0.3, 0.16, W * 0.78, 0.06), M.alcantara, { pos: [dx, dashY, 0] });
    ig.add(dash);
    pieceOf(part, dash, V3(0.1, 0.7, 0), 'Dashboard');
    const screen = mesh(rbox(0.02, 0.15, 0.26, 0.01), M.screen, { pos: [dx - 0.16, dashY + 0.06, 0], rot: [0, 0, -0.3] });
    ig.add(screen);
    pieceOf(part, screen, V3(-0.05, 0.85, 0), 'Infotainment touchscreen');
    const wheel = new THREE.Group();
    const yoke = d.engine.layout === 'EV';
    wheel.add(mesh(new THREE.TorusGeometry(0.17, 0.017, 10, 36, yoke ? Math.PI * 1.25 : TAU), M.leather, { rot: [0, 0, yoke ? -Math.PI * 0.12 : 0] }));
    wheel.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 20), M.darkAlloy, { rot: [HALF, 0, 0] }));
    for (const a of [0, Math.PI, -HALF]) wheel.add(mesh(new THREE.BoxGeometry(0.15, 0.02, 0.015), M.darkAlloy, { pos: [Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0], rot: [0, 0, a] }));
    wheel.position.set(dx - 0.3, dashY + 0.0, driverZ);
    wheel.rotation.set(0, HALF, 0);
    wheel.rotateX(-0.35);
    ig.add(wheel);
    pieceOf(part, wheel, V3(-0.25, 0.8, 0), yoke ? 'Yoke steering wheel' : 'Steering wheel');
    const cons = mesh(rbox(Math.abs(dx - sx), 0.12, 0.18, 0.03), M.carbon, { pos: [(dx + sx) / 2, fl + 0.14, 0] });
    ig.add(cons);
    pieceOf(part, cons, V3(0, 0.55, 0), 'Centre console');
    root.add(ig);
    tag(ig, 'interior', 'Cabin', false);
    part.focus = { target: V3(sx + 0.3, shape.top(fSeat) + 0.45, 0), dir: V3(0.25, 0.9, 0.85), dist: 4.6 };
  }

  // ---------------- chassis ----------------
  {
    const part = addPart('chassis', { key: 'chassis', name: 'Chassis', xray: true, hover: `Chassis · ${info.chassis || ''}` });
    const cg = new THREE.Group();
    const track = shape.hw(0.5) * 0.82;
    if (d.ladder) {
      const frame = new THREE.Group();
      const y = shape.bot(0.5) - 0.06;
      for (const s of [1, -1]) frame.add(mesh(new THREE.BoxGeometry(L * 0.86, 0.12, 0.07), M.black, { pos: [0, y, s * 0.45] }));
      for (let k = 0; k < 5; k++) frame.add(mesh(new THREE.BoxGeometry(0.07, 0.1, 0.9), M.black, { pos: [lerp(L * 0.4, -L * 0.4, k / 4), y, 0] }));
      cg.add(frame);
      pieceOf(part, frame, V3(0, -0.3, 0), 'Ladder-frame chassis');
    } else {
      const tub = new THREE.Group();
      const x0 = shape.x(d.cabin[0] - 0.02), x1 = shape.x(Math.min(d.cabin[1], d.roof[1] + 0.06));
      const len = x0 - x1, cx = (x0 + x1) / 2;
      const y = shape.bot(0.5) + 0.04;
      const mat = info.chassis && /carbon|monocage/i.test(info.chassis) ? M.carbon : M.steel;
      tub.add(mesh(rbox(len, 0.05, track * 2, 0.02), mat, { pos: [cx, y, 0] }));
      for (const s of [1, -1]) tub.add(mesh(rbox(len, 0.22, 0.12, 0.03), mat, { pos: [cx, y + 0.1, s * (track - 0.06)] }));
      tub.add(mesh(rbox(0.06, 0.42, track * 2, 0.02), mat, { pos: [x0, y + 0.2, 0] }));
      tub.add(mesh(rbox(0.06, 0.42, track * 2, 0.02), mat, { pos: [x1, y + 0.2, 0] }));
      cg.add(tub);
      pieceOf(part, tub, V3(0, 0.15, 0), info.chassis || 'Monocoque');
    }
    const sub = (ax, sgn, label) => {
      const g = new THREE.Group();
      const y = shape.bot(sgn > 0 ? shape.fa : shape.ra) + 0.12;
      g.add(mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), M.steel, { pos: [ax, y, 0.32] }));
      g.add(mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), M.steel, { pos: [ax, y, -0.32] }));
      g.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.7), M.steel, { pos: [ax + 0.22, y, 0] }));
      g.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.7), M.steel, { pos: [ax - 0.22, y, 0] }));
      for (const s of [1, -1]) {
        const wz = s * (shape.hw(sgn > 0 ? shape.fa : shape.ra) - 0.2);
        for (const dy of [-0.06, 0.12]) {
          const a = V3(ax, y + dy, s * 0.32), b = V3(ax, (sgn > 0 ? d.dims.rf : d.dims.rr) + dy * 0.8, wz);
          const arm = mesh(new THREE.CylinderGeometry(0.014, 0.014, a.distanceTo(b), 8), M.darkAlloy);
          arm.position.copy(a).add(b).multiplyScalar(0.5);
          arm.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
          g.add(arm);
        }
      }
      cg.add(g);
      pieceOf(part, g, V3(sgn * 0.45, 0.2, 0), label);
    };
    sub(shape.xa, 1, 'Front subframe & wishbones');
    sub(shape.xr, -1, 'Rear subframe & suspension');
    if (d.engine.layout !== 'EV') {
      const tx = d.engine.position === 'front' ? shape.xr + 0.45 : shape.x(d.roof[1] + 0.02);
      const tank = mesh(rbox(0.36, 0.24, W * 0.5, 0.06), M.darkAlloy, { pos: [tx, shape.bot(0.6) + 0.17, 0] });
      cg.add(tank);
      pieceOf(part, tank, V3(0, -0.45, 0), 'Fuel tank');
    }
    root.add(cg);
    tag(cg, 'chassis', part.hover, false);
    part.focus = { target: V3(0, 0.55, 0), dir: V3(0.85, 0.95, 1), dist: Math.max(6.2, L * 1.35) };
  }

  // ---------------- spare wheel (SUV) ----------------
  if (d.spare) {
    const sp = new THREE.Group();
    const R = d.dims.rr;
    const tg = new THREE.LatheGeometry([[R * 0.58, -0.12], [R - 0.04, -0.13], [R, -0.08], [R, 0.08], [R - 0.04, 0.13], [R * 0.58, 0.12]].map(([x, y]) => new THREE.Vector2(x, y)), 48);
    tg.rotateZ(HALF);
    sp.add(new THREE.Mesh(tg, tyre));
    sp.add(mesh(new THREE.CylinderGeometry(R * 0.6, R * 0.6, 0.2, 32), M.black, { rot: [0, 0, HALF] }));
    const p = project('back', 1.05, 0, 0) || V3(-L / 2, 1.05, 0);
    sp.position.copy(p).add(V3(-0.13, 0, 0));
    root.add(sp);
    tag(sp, 'chassis', 'Spare wheel');
  }

  // turn off shadows on transparent bits, keep exterior list unique
  root.traverse((o) => { if (o.isMesh && o.material && o.material.transparent) o.castShadow = false; });

  const radius = Math.hypot(L, W, H) / 2;
  return {
    slug, design: d, root, parts, pickables, exterior, spins, leds,
    doorGroups, hoodGroup, coverGroup, engineGroup: eg, wheels: wheelGroups,
    dims: { L, W, H, radius }, shape,
  };
}
