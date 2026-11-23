import './styles.css';
import * as THREE from 'three';
import gsap from 'gsap';
import { openDatabase, getAllCars, getParts } from './db/db.js';
import { DESIGNS } from './data/designs.js';
import { REAL_MODELS } from './data/realModels.js';
import { createStage } from './three/stage.js';
import { Atmosphere, SCENES } from './three/atmosphere.js';
import { buildCar } from './three/carBuilder.js';
import { loadRealCar } from './three/realCar.js';
import { Showroom } from './three/showroom.js';
import { Cinema } from './three/cinema.js';
import { EngineAudio } from './ui/audio.js';
import { createUI } from './ui/ui.js';

const $ = (s) => document.querySelector(s);
gsap.ticker.lagSmoothing(0);
const params = new URLSearchParams(location.search);
const quality = params.get('q') || (matchMedia('(max-width: 820px)').matches ? 'low' : 'high');
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

const TIPS = [
  'Click the bonnet to switch on X-ray vision and lift the engine out.',
  'Press C for Ad mode: a looping car-commercial camera with letterbox bars.',
  'Change the location (bottom right) to see the car in a different real photo.',
  'Every number on screen comes from a real SQL query, running in your browser.',
  'Press E to blow the whole car apart into a technical cutaway.',
  'Click a wheel to split it into tyre, rim, brake disc and caliper.',
];
let tipI = 0;
const tipTimer = setInterval(() => { $('#load-tip').textContent = TIPS[tipI++ % TIPS.length]; }, 2600);
$('#load-tip').textContent = TIPS[tipI++];

function progress(p, text) {
  $('#load-bar').style.width = `${Math.round(p * 100)}%`;
  $('#load-pct').textContent = `${Math.round(p * 100)}%`;
  if (text) $('#load-status').textContent = text;
}

function infoFor(row, parts) {
  const w = parts.wheels?.spec || '';
  const m = w.match(/^(.*?) front, (.*?) rear$/);
  const both = w.replace(/ all round| all-terrain/g, '');
  return {
    ...row,
    tyreF: m ? m[1] : both, tyreR: m ? m[2] : both,
    brakes: parts.brakes?.spec, doors: parts.doors?.spec, lights: parts.lights?.spec,
    exhaust: parts.exhaust?.spec, aero: parts.aero?.spec, chassis: parts.chassis?.spec,
  };
}

async function boot() {
  progress(0.03, 'Starting the SQLite engine…');
  await openDatabase();
  const rows = getAllCars();
  await frame();

  progress(0.08, 'Loading the camera…');
  const stage = createStage($('#stage'), { quality });
  const atmosphere = new Atmosphere(stage, { quality });
  stage.onTick((dt) => atmosphere.update(dt));
  const saved = params.get('scene') || localStorage.getItem('rev-scene');
  const startScene = SCENES.find((s) => s.id === saved) || SCENES[0];
  progress(0.1, `Developing the ${startScene.name.toLowerCase()} photo…`);
  await atmosphere.set(startScene.id, (p) => progress(0.1 + p * 0.2));

  // code-built cars: used for thumbnails, as a fallback, and for the X-ray engines/chassis
  const proc = new Map();
  const partsBySlug = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    progress(0.32 + (0.4 * i) / rows.length, `Preparing the ${row.manufacturer} ${row.model}…`);
    await frame();
    const parts = getParts(row.slug);
    partsBySlug.set(row.slug, parts);
    const car = buildCar(row.slug, DESIGNS[row.slug], infoFor(row, parts));
    car.info = row;
    car.partsDb = parts;
    proc.set(row.slug, car);
  }

  const manifest = await fetch('/models/manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const realSet = new Set((manifest.models || []).filter((s) => REAL_MODELS[s]));

  progress(0.76, 'Photographing the garage…');
  await frame();
  const thumbs = new Map();
  const shoot = (car) => {
    const s = car.dims.L / 4.6;
    return stage.snapshot(car.root, { from: new THREE.Vector3(4.6 * s, 1.25 * s, 5.0 * s), target: new THREE.Vector3(-0.1, car.dims.H * 0.42, 0) });
  };
  for (const car of proc.values()) thumbs.set(car.slug, shoot(car));

  let ui;
  const loaded = new Map();
  const registry = {
    isReal: (slug) => realSet.has(slug),
    get(slug, { silent = false } = {}) {
      if (loaded.has(slug)) return loaded.get(slug);
      const say = silent ? null : ui;
      const row = rows.find((r) => r.slug === slug);
      const parts = partsBySlug.get(slug);
      let job;
      if (realSet.has(slug)) {
        say?.loading(`Loading the ${row.manufacturer} ${row.model}…`, 0);
        job = loadRealCar({
          slug, cfg: REAL_MODELS[slug], design: DESIGNS[slug], info: infoFor(row, parts), proc: proc.get(slug),
          onProgress: (f) => say?.loading(null, f),
        }).then((car) => {
          car.info = row;
          car.partsDb = parts;
          thumbs.set(slug, shoot(car));
          ui?.setThumb(slug, thumbs.get(slug));
          say?.loading(false);
          return car;
        }).catch((err) => {
          console.error(err);
          say?.loading(false);
          ui?.toast(`Couldn't load the ${row.model} model, showing the blueprint car`);
          realSet.delete(slug);
          return proc.get(slug);
        });
      } else job = Promise.resolve(proc.get(slug));
      loaded.set(slug, job);
      return job;
    },
  };

  progress(0.9, 'Warming up shaders…');
  await frame();
  const firstSlug = params.get('car') && proc.has(params.get('car')) ? params.get('car') : rows[0].slug;
  const firstProc = proc.get(firstSlug);
  stage.scene.add(firstProc.root);
  stage.renderer.compile(stage.scene, stage.camera);
  stage.scene.remove(firstProc.root);

  const audio = new EngineAudio();
  const showroom = new Showroom(stage, registry, {
    onCar: (car) => { ui.onCar(car); atmosphere.setCar(car); },
    onArrive: (car) => audio.rev({ cyl: car.design.engine.cyl, layout: car.design.engine.layout, diesel: car.design.engine.diesel }),
    onPart: (p, car) => ui.onPart(p, car),
    onPiece: (piece, part) => ui.onPiece(piece, part),
    onHover: (h) => ui.onHover(h),
    onXray: (on) => ui.onXray(on),
  });
  const cinema = new Cinema(stage, showroom, {
    onCut: (shot, car) => ui.adCut(shot, car),
    onStart: () => { ui.cinema(true); audio.rev({ cyl: showroom.car.design.engine.cyl, layout: showroom.car.design.engine.layout, diesel: showroom.car.design.engine.diesel }); },
    onStop: () => ui.cinema(false),
  });
  const switchScene = async (id) => {
    if (atmosphere.current?.id === id) return;
    localStorage.setItem('rev-scene', id);
    const cfg = SCENES.find((s) => s.id === id);
    ui.loading(`Developing the ${cfg.name.toLowerCase()} photo…`, 0);
    const job = atmosphere.preload(id, (f) => ui.loading(null, f));
    await gsap.to('#fade', { opacity: 1, duration: 0.35 });
    await job;
    atmosphere.set(id);
    ui.loading(false);
    ui.onScene(cfg);
    gsap.to('#fade', { opacity: 0, duration: 0.6, delay: 0.1 });
  };
  ui = createUI({ rows, thumbs, registry, showroom, audio, cinema, scenes: SCENES, switchScene, quality });
  ui.onScene(startScene);

  // pick up real models imported while the page is open (npm run models), no reload needed
  setInterval(async () => {
    const m = await fetch('/models/manifest.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    for (const slug of m.models || []) {
      if (!REAL_MODELS[slug] || realSet.has(slug)) continue;
      realSet.add(slug);
      loaded.delete(slug);
      ui.markReal(slug);
      const row = rows.find((r) => r.slug === slug);
      ui.toast(`${row.manufacturer} ${row.model}: real 3D model ready`);
      if (showroom.car?.slug === slug && !showroom.busy && !cinema.on) {
        // swap the draft on screen for the real model
        stage.scene.remove(showroom.car.root);
        showroom.car = null;
        showroom.showCar(slug, { instant: true });
      } else registry.get(slug, { silent: true });
    }
  }, 8000);

  stage.camera.position.set(14, 4, 13);
  stage.controls.target.set(0, 0.6, 0);
  stage.start();
  progress(1, 'Ready');
  clearInterval(tipTimer);
  $('#start').hidden = false;

  const start = () => {
    window.removeEventListener('keydown', onKey);
    $('#start').removeEventListener('click', start);
    audio.unlock();
    $('#loader').classList.add('out');
    setTimeout(() => $('#loader').remove(), 1000);
    document.body.classList.add('ready');
    gsap.to(stage.camera.position, { x: 7.0, y: 1.7, z: 7.4, duration: 3.2, ease: 'power3.inOut' });
    showroom.showCar(firstSlug).then(() => {
      // quietly preload the other real models and the other locations
      const queue = rows.map((r) => r.slug).filter((s) => realSet.has(s) && s !== firstSlug);
      const next = () => {
        const s = queue.shift();
        if (s) setTimeout(() => registry.get(s, { silent: true }).then(next), 2500);
        else SCENES.forEach((sc) => atmosphere.preload(sc.id));
      };
      next();
    });
  };
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') start(); };
  window.addEventListener('keydown', onKey);
  $('#start').addEventListener('click', start);
  if (params.has('auto')) start();

  window.__rev = { stage, showroom, registry, proc, atmosphere, cinema };
}

boot().catch((err) => {
  console.error(err);
  progress(1, `Something went wrong: ${err.message}`);
});
