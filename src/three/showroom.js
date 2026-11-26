// Interaction: hover glow, click-to-zoom, exploded views, X-ray, labels, car switching.
import * as THREE from 'three';
import gsap from 'gsap';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { makeXray } from './materials.js';

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const DEFAULT_VIEW = { pos: new THREE.Vector3(7.2, 2.3, 7.6), target: new THREE.Vector3(0, 0.6, 0) };
const lineMat = new THREE.LineBasicMaterial({ color: '#7df9ff', transparent: true, opacity: 0.9, depthTest: false });

export class Showroom {
  constructor(stage, cars, hooks = {}) {
    this.stage = stage;
    this.cars = cars;
    this.hooks = hooks;
    this.car = null;
    this.active = null;
    this.activePiece = null;
    this.exploded = false;
    this.xrayOn = false;
    this.busy = false;
    this.ghost = makeXray();
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hover = null;
    this.pointerDirty = false;
    this.idleTimer = 0;
    this.autoSpin = true;
    // soft key light that follows the camera while the car is opened up (X-ray / exploded),
    // so engine metal still reads in the dark night locations
    this.inspect = new THREE.SpotLight('#fff6ea', 0, 0, 0.5, 1, 0);
    stage.scene.add(this.inspect, this.inspect.target);

    const el = stage.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; this.idleTimer = 0; });
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointerleave', () => this.setHover(null));
    stage.controls.addEventListener('start', () => { this.idleTimer = 0; stage.controls.autoRotate = false; });
    stage.onTick((dt, t) => this.tick(dt, t));
  }

  // ------------------------------------------------------------ car switching
  async showCar(slug, { instant = false } = {}) {
    if (this.busy || this.car?.slug === slug) return;
    this.busy = true;
    let next;
    try { next = await this.cars.get(slug); } catch (err) { console.error(err); }
    if (!next || next === this.car) { this.busy = false; return; }
    await this.reset(true);
    const old = this.car;
    const scene = this.stage.scene;
    this.car = next;
    this.hooks.onCar?.(next);
    // the car that leaves gives its video memory back (it re-uploads if it comes back)
    if (old && !instant) {
      this.drive(old, 16, 1.0, 'power2.in').then(() => { scene.remove(old.root); if (this.car !== old) releaseGPU(old); });
    } else if (old) { scene.remove(old.root); releaseGPU(old); }
    next.root.position.set(instant ? 0 : -16, 0, 0);
    scene.add(next.root);
    this.flash(next);
    if (!instant) await this.drive(next, 16, 1.5, 'power3.out', old ? 0.45 : 0);
    this.busy = false;
    this.hooks.onArrive?.(next);
  }

  drive(car, dist, duration, ease, delay = 0) {
    return new Promise((resolve) => {
      let last = car.root.position.x;
      const R = car.design.dims.rf;
      gsap.to(car.root.position, {
        x: car.root.position.x + dist, duration, ease, delay,
        onUpdate: () => {
          const dx = car.root.position.x - last;
          last = car.root.position.x;
          car.spins.forEach((s) => { s.rotation.z -= dx / R; });
          car.root.rotation.x = 0;
        },
        onComplete: resolve,
      });
    });
  }

  flash(car) {
    car.leds.head.forEach((m) => {
      const base = m.material.emissiveIntensity;
      const mat = m.material;
      gsap.fromTo(mat, { emissiveIntensity: base }, { emissiveIntensity: base * 1.8, duration: 0.12, yoyo: true, repeat: 3, onComplete: () => { mat.emissiveIntensity = base; } });
    });
  }

  // ------------------------------------------------------------ picking
  onMove(e) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointer = { x: e.clientX, y: e.clientY };
    this.pointerDirty = true;
  }

  pick() {
    if (!this.car) return null;
    this.ray.setFromCamera(this.mouse, this.stage.camera);
    const list = this.car.pickables.filter((m) => m.material !== HIDDEN && isShown(m));
    const hits = this.ray.intersectObjects(list, false);
    for (const h of hits) {
      const o = h.object;
      if (o.userData.inner) continue;
      let partId = o.userData.partId;
      let label = o.userData.hover;
      const byGroup = o.userData.pickByGroup;
      if (byGroup && h.face && byGroup[h.face.materialIndex]) [partId, label] = byGroup[h.face.materialIndex];
      const zone = o.userData.zone?.(h); // e.g. the bonnet area of a one-piece body
      if (zone) [partId, label] = zone;
      if (!partId) continue;
      // when a part is open, prefer its individual pieces
      if (this.active === partId || this.exploded) {
        const part = this.car.parts.get(partId);
        const piece = part && findPiece(part, o);
        if (piece) return { partId, piece, label: piece.label || label, point: h.point };
      }
      return { partId, label, point: h.point };
    }
    return null;
  }

  setHover(h) {
    const key = h ? `${h.partId}|${h.piece ? h.piece.obj.uuid : ''}` : null;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.hover = h;
    const outline = this.stage.outline;
    if (!h) outline.selectedObjects = [];
    else if (h.piece) outline.selectedObjects = [h.piece.obj];
    // the bare body: no outline round the whole car, the tooltip and cursor are enough
    else if (h.partId === 'chassis' && !this.active && !this.exploded) outline.selectedObjects = [];
    else outline.selectedObjects = this.partMeshes(h.partId);
    this.stage.renderer.domElement.style.cursor = h ? 'pointer' : 'grab';
    this.hooks.onHover?.(h);
  }

  partMeshes(id) {
    const car = this.car;
    if (!car._pm) {
      car._pm = new Map();
      car.pickables.forEach((m) => {
        const pid = m.userData.partId;
        if (m.userData.inner) return;
        if (!car._pm.has(pid)) car._pm.set(pid, []);
        car._pm.get(pid).push(m);
      });
    }
    if (id === 'interior') return car._pm.get('interior') || [];
    return car._pm.get(id) || [];
  }

  onUp(e) {
    if (!this.down) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
    this.down = null;
    if (moved > 6 || this.busy) return;
    const h = this.pick();
    if (!h) { if (this.active || this.exploded) this.reset(); return; }
    if (h.piece && (this.active === h.partId || this.exploded)) {
      this.activePiece = h.piece;
      this.hooks.onPiece?.(h.piece, this.car.parts.get(h.partId));
      return;
    }
    this.activate(h.partId);
  }

  // ------------------------------------------------------------ parts
  async activate(id) {
    const car = this.car;
    const part = car?.parts.get(id);
    if (!part || this.busy) return;
    if (this.active === id) return;
    this.busy = true;
    if (this.active || this.exploded) await this.collapseAll(0.35);
    this.active = id;
    this.stage.controls.autoRotate = false;
    this.idleTimer = 0;
    this.hooks.onPart?.(part, car);
    this.setXray(part.xray);
    // (no depth of field here: it redraws the whole scene every frame; Ad mode keeps it)
    const hasMoves = part.moves.length > 0;
    this.focus(part.focus, 1.3);
    this.runMoves(part, true, 0.95);
    this.explodePieces(part, true, hasMoves ? 0.75 : 0.25);
    await wait((hasMoves ? 0.75 : 0.25) + 1.05);
    this.showLabels(part);
    this.busy = false;
  }

  async explodeAll() {
    if (!this.car || this.busy) return;
    if (this.exploded) return this.reset();
    this.busy = true;
    if (this.active) await this.collapseAll(0.35);
    this.exploded = true;
    this.hooks.onPart?.({ id: 'all', name: 'Exploded view', key: null }, this.car);
    this.setXray(true);
    this.focus({ target: new THREE.Vector3(0, 1.0, 0), dir: new THREE.Vector3(0.9, 0.75, 1), dist: Math.max(11.5, this.car.dims.L * 2.6) }, 1.6);
    this.car.parts.forEach((p) => {
      this.runMoves(p, true, 1.1);
      this.explodePieces(p, true, p.moves.length ? 0.8 : 0.4);
    });
    await wait(2.1);
    this.busy = false;
  }

  runMoves(part, open, duration) {
    part.moves.forEach((m) => {
      const o = m.obj;
      if (!m.base) m.base = { pos: o.position.clone(), rot: o.rotation.clone(), scale: o.scale.x };
      const pos = open ? m.pos : m.base.pos;
      const rot = open ? m.rot : m.base.rot;
      const sc = open ? m.scale : m.base.scale;
      if (pos) gsap.to(o.position, { x: pos.x, y: pos.y, z: pos.z, duration, ease: 'power3.inOut', overwrite: 'auto' });
      if (rot) gsap.to(o.rotation, { x: rot.x, y: rot.y, z: rot.z, duration, ease: 'power3.inOut', overwrite: 'auto' });
      if (sc) gsap.to(o.scale, { x: sc, y: sc, z: sc, duration, ease: 'power3.inOut', overwrite: 'auto' });
    });
  }

  explodePieces(part, open, delay = 0) {
    part.pieces.forEach((p, i) => {
      const o = p.obj;
      if (!p.base) p.base = o.position.clone();
      const to = open ? p.base.clone().add(p.dir) : p.base;
      gsap.to(o.position, { x: to.x, y: to.y, z: to.z, duration: open ? 1.0 : 0.6, delay: open ? delay + i * 0.018 : 0, ease: open ? 'expo.out' : 'power3.inOut', overwrite: 'auto' });
    });
  }

  async collapseAll(duration = 0.6) {
    const car = this.car;
    if (!car) return;
    this.clearLabels();
    car.parts.forEach((p) => {
      if (p.pieces.some((pc) => pc.base) || p.moves.some((m) => m.base)) {
        this.explodePieces(p, false);
        setTimeout(() => this.runMoves(p, false, duration + 0.3), duration * 600);
      }
    });
    this.active = null;
    this.exploded = false;
    this.activePiece = null;
    await wait(duration + 0.5);
  }

  async reset(silent = false) {
    if (!this.car) return;
    const was = this.active || this.exploded;
    this.busy = true;
    if (was) await this.collapseAll(0.45);
    this.setXray(false);
    this.stage.setDof(false);
    if (!silent) this.focus(null, 1.2);
    this.hooks.onPart?.(null, this.car);
    this.busy = false;
  }

  focus(f, duration = 1.2) {
    const { camera, controls } = this.stage;
    const wide = window.innerWidth > 820;
    const home = homeView(camera);
    gsap.to(this.stage.shift, { px: f ? (wide ? 150 : 0) : home.shift, duration, ease: 'power3.inOut', onUpdate: this.stage.applyShift, overwrite: 'auto' });
    const fit = viewFit(camera);
    let pos, target;
    if (!f) ({ pos, target } = home);
    else {
      target = this.car.root.localToWorld(f.target.clone());
      pos = target.clone().add(f.dir.clone().normalize().multiplyScalar(f.dist * fit));
      pos.y = Math.max(pos.y, 0.25);
    }
    gsap.to(camera.position, { x: pos.x, y: pos.y, z: pos.z, duration, ease: 'power3.inOut', overwrite: 'auto' });
    gsap.to(controls.target, { x: target.x, y: target.y, z: target.z, duration, ease: 'power3.inOut', overwrite: 'auto' });
  }

  // ------------------------------------------------------------ X-ray
  setXray(on) {
    if (!this.car || on === this.xrayOn) return;
    this.xrayOn = on;
    const car = this.car;
    if (!car._ghosts) {
      car._ghosts = [];
      car.exterior.forEach((m) => {
        if (m.userData.inner) return;
        const g = new THREE.Mesh(m.geometry, this.ghost);
        g.raycast = () => {};
        g.visible = false;
        g.renderOrder = 5;
        m.add(g);
        car._ghosts.push(g);
      });
    }
    const u = this.ghost.uniforms;
    this.stage.shadowsDirty = 3; // the body stops (or starts) casting shadows
    gsap.to(this.inspect, { intensity: on ? 2.6 : 0, duration: 0.6, overwrite: 'auto' });
    car.internals?.forEach((g) => { g.visible = on; });
    if (on) {
      car.exterior.forEach((m) => { m.userData.mat = m.material; m.material = HIDDEN; m.castShadow = false; });
      car._ghosts.forEach((g) => { g.visible = true; });
      u.uOpacity.value = 0;
      gsap.to(u.uOpacity, { value: 1, duration: 0.6, ease: 'power2.out' });
      u.uScan.value = car.dims.L / 2 + 0.5;
      gsap.fromTo(u.uScan, { value: car.root.position.x + car.dims.L / 2 + 0.3 }, { value: car.root.position.x - car.dims.L / 2 - 0.3, duration: 0.9, ease: 'power2.inOut' });
    } else {
      car.exterior.forEach((m) => { if (m.userData.mat) m.material = m.userData.mat; m.castShadow = !m.material.transparent; });
      car._ghosts.forEach((g) => { g.visible = false; });
    }
    this.hooks.onXray?.(on);
  }

  toggleXray() {
    if (this.busy) return;
    if (this.active && this.car.parts.get(this.active)?.xray && this.xrayOn) return;
    this.setXray(!this.xrayOn);
  }

  // ------------------------------------------------------------ labels
  showLabels(part) {
    this.clearLabels();
    const tmpBox = new THREE.Box3();
    const all = new THREE.Box3();
    part.pieces.forEach((p) => all.expandByObject(p.obj));
    const partCenter = all.getCenter(new THREE.Vector3());
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.stage.camera.matrixWorld, 0);
    this._labels = [];
    const placed = [];
    part.pieces.filter((p) => p.label).forEach((p, i) => {
      tmpBox.setFromObject(p.obj);
      const c = tmpBox.getCenter(new THREE.Vector3());
      const out = c.clone().sub(partCenter);
      if (out.lengthSq() < 1e-4) out.set(0, 1, 0);
      out.normalize();
      const side = Math.sign(out.dot(camRight)) || 1;
      const anchor = c.clone().addScaledVector(out, 0.22).add(new THREE.Vector3(0, 0.1 + (i % 2) * 0.06, 0)).addScaledVector(camRight, side * 0.12);
      // pieces that share a centre (tyre and rim) would stack their labels: lift until clear
      for (let k = 0; k < 8 && placed.some((q) => q.distanceTo(anchor) < 0.13); k++) anchor.y += 0.13;
      placed.push(anchor.clone());
      const lc = p.obj.worldToLocal(c.clone());
      const la = p.obj.worldToLocal(anchor.clone());
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([lc, la]), lineMat);
      line.renderOrder = 999;
      const el = document.createElement('div');
      el.className = 'callout-anchor';
      const inner = document.createElement('div');
      inner.className = `callout ${side < 0 ? 'left' : ''}`;
      const [title, ...rest] = p.label.split(' · ');
      inner.innerHTML = `<i></i><b>${title}</b>${rest.length ? `<small>${rest.join(' · ')}</small>` : ''}`;
      inner.style.animationDelay = `${i * 45}ms`;
      el.appendChild(inner);
      el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      el.addEventListener('click', () => this.hooks.onPiece?.(p, part));
      const css = new CSS2DObject(el);
      css.center.set(side < 0 ? 1 : 0, 0.5);
      css.position.copy(la);
      p.obj.add(line, css);
      this._labels.push({ obj: p.obj, line, css });
    });
  }

  clearLabels() {
    (this._labels || []).forEach(({ obj, line, css }) => {
      obj.remove(line, css);
      line.geometry.dispose();
      css.element.remove();
    });
    this._labels = [];
  }

  // ------------------------------------------------------------ per-frame
  tick(dt, t) {
    this.ghost.uniforms.uTime.value = t;
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.setHover(this.busy ? null : this.pick());
    }
    this.idleTimer += dt;
    const c = this.stage.controls;
    if (this.inspect.intensity > 0) {
      const cam = this.stage.camera.position;
      this.inspect.position.set(cam.x, cam.y + 1.2, cam.z).lerp(c.target, -0.15);
      this.inspect.target.position.copy(c.target);
    }
    if (this.autoSpin && !this.active && !this.exploded && this.idleTimer > 4 && !c.autoRotate) c.autoRotate = true;
  }
}

function findPiece(part, obj) {
  let o = obj;
  while (o) {
    const p = part.pieces.find((pc) => pc.obj === o);
    if (p) return p;
    o = o.parent;
  }
  return null;
}

// Free a car's textures and vertex buffers on the GPU. Three.js uploads them again by itself
// the next time the car is drawn; the images and geometry stay in memory.
export function releaseGPU(car) {
  const seen = new Set();
  car.root.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (!m) return;
      for (const k in m) {
        const t = m[k];
        if (t && t.isTexture && !seen.has(t)) { seen.add(t); t.dispose(); }
      }
    });
  });
}

// Camera distances are tuned for a 16:9 window; a narrower one sees less to the sides, so back
// off until the car (or the exploded parts and their labels) fit between the HUD panels again.
export function viewFit(camera) {
  return Math.min(2.2, Math.max(1, 1.75 / camera.aspect));
}

// The resting camera. The car panel sits top-left, so on desktop the view is shifted right
// (shift = horizontal view offset in px; negative moves the picture right) and, on shorter
// screens, aimed a little lower and closer: the car fills the free space beside and below
// the panel, above the car strip.
export function homeView(camera) {
  const wide = window.innerWidth > 820;
  const short = window.innerHeight < 900;
  const target = new THREE.Vector3(0, short ? 0.8 : DEFAULT_VIEW.target.y, 0);
  const pos = DEFAULT_VIEW.pos.clone().sub(DEFAULT_VIEW.target).multiplyScalar(viewFit(camera) * (short ? 0.92 : 1)).add(target);
  const shift = wide ? -Math.round(window.innerWidth * (short ? 0.16 : 0.12)) : 0;
  return { pos, target, shift };
}

function isShown(o) {
  while (o) { if (!o.visible) return false; o = o.parent; }
  return true;
}

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
