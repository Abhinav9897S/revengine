// "Ad mode": a looping car-commercial shot list with letterbox, depth of field and title cards.
import * as THREE from 'three';
import gsap from 'gsap';

export class Cinema {
  constructor(stage, showroom, hooks = {}) {
    this.stage = stage;
    this.showroom = showroom;
    this.hooks = hooks;
    this.on = false;
    this.i = 0;
    this.tl = null;
  }

  shots(car) {
    const { L, W, H } = car.dims;
    const d = car.design.dims;
    const k = L / d.L;
    const xa = L / 2 - d.fo * k;
    const xr = xa - d.wb * k;
    const R = d.rf;
    const hy = car.design.head.y;
    const hz = (car.design.head.z * W) / 2;
    const ty = car.design.tail.y;
    return [
      { name: 'hero', from: [L * 1.05, 0.48, W * 1.6], to: [L * 0.8, 0.56, W * 2.0], look: [L * 0.12, 0.55, 0], lookTo: [L * 0.04, 0.6, 0], fov: 30, dur: 6.5, card: 'title' },
      { name: 'profile', from: [L * 0.85, 0.6, W * 2.45], to: [-L * 0.85, 0.6, W * 2.45], look: [L * 0.42, 0.55, 0], lookTo: [-L * 0.42, 0.55, 0], fov: 32, dur: 7 },
      { name: 'wheel', from: [xa + 1.0, R * 0.95, W / 2 + 1.0], to: [xa + 0.55, R * 1.05, W / 2 + 0.72], look: [xa, R, W * 0.46], fov: 26, dur: 5, dof: 0.006 },
      { name: 'rear', from: [-L * 1.2, 0.7, -W * 1.05], to: [-L * 1.02, 0.95, -W * 1.7], look: [-L * 0.22, ty * 0.8, 0], fov: 30, dur: 6, card: 'spec' },
      { name: 'lamp', from: [L / 2 + 1.0, hy + 0.1, hz + 1.0], to: [L / 2 + 0.55, hy + 0.04, hz + 0.6], look: [L / 2 - 0.08, hy, hz], fov: 24, dur: 5, dof: 0.007 },
      { name: 'crane', from: [L * 0.25, H + 4.6, W * 1.9], to: [-L * 0.25, H + 3.2, W * 2.3], look: [0, 0.4, 0], fov: 32, dur: 6.5 },
      { name: 'rear-wheel', from: [xr - 1.1, 0.4, -W / 2 - 1.2], to: [xr - 0.6, 0.45, -W / 2 - 0.9], look: [xr, R, -W * 0.46], fov: 27, dur: 4.5, dof: 0.006 },
      { name: 'low-front', from: [L * 1.7, 0.26, 0.6], to: [L * 1.3, 0.3, 0.15], look: [0, 0.6, 0], fov: 30, dur: 5.5, card: 'end' },
    ];
  }

  async start() {
    if (this.on || !this.showroom.car) return;
    this.on = true;
    const sr = this.showroom;
    await sr.reset(true);
    sr.autoSpin = false;
    this.stage.controls.autoRotate = false;
    this.stage.controls.enabled = false;
    this.stage.setBars(true);
    gsap.to(this.stage.shift, { px: 0, duration: 0.5, onUpdate: this.stage.applyShift });
    document.body.classList.add('cinema');
    this.hooks.onStart?.();
    this.i = 0;
    this.play();
  }

  play() {
    if (!this.on) return;
    const car = this.showroom.car;
    const list = this.shots(car);
    const s = list[this.i % list.length];
    const { camera, controls } = this.stage;
    const root = car.root;
    const P = (a) => root.localToWorld(new THREE.Vector3(...a));
    const from = P(s.from), to = P(s.to), look = P(s.look), lookTo = P(s.lookTo || s.look);
    gsap.killTweensOf(camera.position);
    gsap.killTweensOf(controls.target);
    this.hooks.onCut?.(s, car);
    camera.position.copy(from);
    controls.target.copy(look);
    camera.fov = s.fov;
    camera.updateProjectionMatrix();
    if (s.dof) this.stage.setDof(true, { auto: true, aperture: s.dof });
    else this.stage.setDof(false);
    this.tl = gsap.timeline({ onComplete: () => { this.i++; this.play(); } });
    this.tl.to(camera.position, { x: to.x, y: to.y, z: to.z, duration: s.dur, ease: 'sine.inOut' }, 0);
    this.tl.to(controls.target, { x: lookTo.x, y: lookTo.y, z: lookTo.z, duration: s.dur, ease: 'sine.inOut' }, 0);
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    this.tl?.kill();
    const { camera, controls } = this.stage;
    this.stage.setBars(false);
    this.stage.setDof(false);
    controls.enabled = true;
    gsap.to(camera, { fov: 30, duration: 0.8, onUpdate: () => camera.updateProjectionMatrix() });
    this.showroom.autoSpin = true;
    this.showroom.focus(null, 1.4);
    document.body.classList.remove('cinema');
    this.hooks.onStop?.();
  }

  toggle() { if (this.on) this.stop(); else this.start(); }
}
