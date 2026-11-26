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
import { Showroom, homeView, releaseGPU } from './three/showroom.js';
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

// card placeholder until the real model's photo exists: dark card, a glow of the car's colour,
// a plain silhouette
function placeholderThumb(paint) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
<defs><radialGradient id="g" cx="50%" cy="78%" r="60%"><stop offset="0" stop-color="${paint}" stop-opacity="0.45"/><stop offset="1" stop-color="#15111b" stop-opacity="0"/></radialGradient></defs>
<rect width="480" height="270" fill="#15111b"/><rect width="480" height="270" fill="url(#g)"/>
<path d="M70 196 C78 172 118 162 168 154 L214 124 C252 106 322 104 356 126 L404 152 C426 158 438 172 440 196 Z" fill="#ffffff" fill-opacity="0.07"/>
<circle cx="146" cy="198" r="25" fill="#0b090e"/><circle cx="368" cy="198" r="25" fill="#0b090e"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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
  // first visit: the studio (black infinity cove, mirror floor) shows the cars at their cleanest
  const startScene = SCENES.find((s) => s.id === saved) || SCENES.find((s) => s.id === 'studio');
  progress(0.1, `Developing the ${startScene.name.toLowerCase()} photo…`);
  await atmosphere.set(startScene.id, (p) => progress(0.1 + p * 0.2));

  // code-built cars: the X-ray engines/chassis of the real models, and the fallback if a model
  // fails. Built on demand (the first one now, the rest as their real models load), so the
  // showroom opens without building all ten up front.
  const partsBySlug = new Map(rows.map((r) => [r.slug, getParts(r.slug)]));
  const proc = new Map();
  const procOf = (slug) => {
    if (!proc.has(slug)) {
      const row = rows.find((r) => r.slug === slug);
      const parts = partsBySlug.get(slug);
      const car = buildCar(slug, DESIGNS[slug], infoFor(row, parts));
      car.info = row;
      car.partsDb = parts;
      proc.set(slug, car);
    }
    return proc.get(slug);
  };

  const manifest = await fetch(`${import.meta.env.BASE_URL}models/manifest.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const realSet = new Set((manifest.models || []).filter((s) => REAL_MODELS[s]));
  const firstSlug = params.get('car') && rows.some((r) => r.slug === params.get('car')) ? params.get('car') : rows[0].slug;
  progress(0.4, `Preparing the ${rows.find((r) => r.slug === firstSlug).model}…`);
  await frame();
  procOf(firstSlug);

  // carousel thumbnails: photos of the real models, kept in the browser after the first visit.
  // Until a car's photo exists its card shows a neutral placeholder, never the blocky stand-in.
  const shoot = (car) => {
    const s = car.dims.L / 4.6;
    return stage.snapshot(car.root, { from: new THREE.Vector3(4.6 * s, 1.25 * s, 5.0 * s), target: new THREE.Vector3(-0.1, car.dims.H * 0.42, 0) });
  };
  const thumbKey = (slug) => `rev-thumb-v3-${slug}`;
  const thumbs = new Map();
  for (const r of rows) {
    let cached = null;
    try { cached = realSet.has(r.slug) ? localStorage.getItem(thumbKey(r.slug)) : null; } catch { /* storage blocked */ }
    thumbs.set(r.slug, cached || placeholderThumb(DESIGNS[r.slug].paint));
  }
  const keepThumb = (slug, url) => { try { localStorage.setItem(thumbKey(slug), url); } catch { /* storage full or blocked */ } };

  let ui;
  let showroom; // created below; the registry callbacks only run after it exists
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
          slug, cfg: REAL_MODELS[slug], design: DESIGNS[slug], info: infoFor(row, parts), proc: procOf(slug),
          onProgress: (f) => say?.loading(null, f),
        }).then((car) => {
          car.info = row;
          car.partsDb = parts;
          // photograph the car for its card only if no photo is cached; drawing it uploads all its
          // textures, so a car that isn't on screen gives that memory straight back
          if (thumbs.get(slug).startsWith('data:image/svg')) {
            thumbs.set(slug, shoot(car));
            keepThumb(slug, thumbs.get(slug));
            ui?.setThumb(slug, thumbs.get(slug));
            if (showroom?.car !== car) releaseGPU(car);
          }
          say?.loading(false);
          return car;
        }).catch((err) => {
          console.error(err);
          say?.loading(false);
          ui?.toast(`Couldn't load the ${row.model} model, showing the blueprint car`);
          realSet.delete(slug);
          const fallback = procOf(slug);
          thumbs.set(slug, shoot(fallback));
          ui?.setThumb(slug, thumbs.get(slug));
          return fallback;
        });
      } else {
        const car = procOf(slug);
        if (thumbs.get(slug).startsWith('data:image/svg')) { thumbs.set(slug, shoot(car)); ui?.setThumb(slug, thumbs.get(slug)); }
        job = Promise.resolve(car);
      }
      loaded.set(slug, job);
      return job;
    },
  };

  progress(0.9, 'Warming up shaders…');
  await frame();
  const firstProc = procOf(firstSlug);
  stage.scene.add(firstProc.root);
  stage.renderer.compile(stage.scene, stage.camera);
  stage.scene.remove(firstProc.root);

  const audio = new EngineAudio();
  showroom = new Showroom(stage, registry, {
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
    const m = await fetch(`${import.meta.env.BASE_URL}models/manifest.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
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
    const home = homeView(stage.camera);
    gsap.to(stage.camera.position, { x: home.pos.x, y: home.pos.y, z: home.pos.z, duration: 3.2, ease: 'power3.inOut' });
    gsap.to(stage.controls.target, { x: home.target.x, y: home.target.y, z: home.target.z, duration: 3.2, ease: 'power3.inOut' });
    gsap.to(stage.shift, { px: home.shift, duration: 3.2, ease: 'power3.inOut', onUpdate: stage.applyShift });
    showroom.showCar(firstSlug).then(() => {
      // quietly preload the other real models (their photos replace the placeholder cards) and
      // the other locations
      const queue = rows.map((r) => r.slug).filter((s) => s !== firstSlug);
      const next = () => {
        const s = queue.shift();
        if (s) setTimeout(() => registry.get(s, { silent: true }).then(next), 1200);
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
