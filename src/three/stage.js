// Renderer, camera and controls. Lean on purpose: the scene is drawn straight to the screen
// with the GPU's own anti-aliasing and filmic tone mapping, no post-processing passes, so it
// stays smooth on laptops. The few "film" touches are cheap: a static CSS vignette, CSS
// letterbox bars in Ad mode, and a soft rim highlight drawn only on the hovered part.
import * as THREE from 'three';
import gsap from 'gsap';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

// quality: 'low' (phones) or 'high' (default)
export function createStage(container, { quality = 'high' } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: false, powerPreference: 'high-performance' });
  // resolution: capped, then scaled down automatically while frames are slow (see adapt())
  const baseDpr = Math.min(window.devicePixelRatio, quality === 'low' ? 1 : 1.25);
  renderer.setPixelRatio(baseDpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // shadow maps are redrawn only when something moves (Atmosphere sets needsUpdate)
  renderer.shadowMap.autoUpdate = false;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.setSize(window.innerWidth, window.innerHeight);
  labels.domElement.className = 'label-layer';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 1200);
  camera.position.set(7.5, 2.0, 8);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.6, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.4;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotateSpeed = 0.45;
  controls.enablePan = true;
  controls.screenSpacePanning = true;

  // hover highlight: a soft cyan rim on the hovered part only (one extra draw of that part)
  const rim = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#a6ecff') } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
        gl_FragColor = vec4(uColor * (0.06 + f * 0.55), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  let lit = [];
  const highlight = (list) => {
    lit.forEach((o) => { o.visible = false; });
    lit = [];
    (list || []).forEach((m) => {
      if (!m?.isMesh) return;
      let o = m.userData.rim;
      if (!o) {
        o = new THREE.Mesh(m.geometry, rim);
        o.raycast = () => {};
        o.renderOrder = 6;
        o.castShadow = false;
        m.add(o);
        m.userData.rim = o;
      }
      o.visible = true;
      lit.push(o);
    });
  };
  // same shape as the old OutlinePass API, so callers just set selectedObjects
  const outline = {
    _sel: [],
    get selectedObjects() { return this._sel; },
    set selectedObjects(v) { this._sel = v || []; highlight(this._sel); },
  };

  // horizontal view shift (keeps the subject centred in the free area beside HUD panels)
  const shift = { px: 0 };
  const applyShift = () => {
    const ww = window.innerWidth, hh = window.innerHeight;
    if (Math.abs(shift.px) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(ww, hh, shift.px, 0, ww, hh);
  };
  const onResize = () => {
    const ww = window.innerWidth, hh = window.innerHeight;
    camera.aspect = ww / hh;
    camera.updateProjectionMatrix();
    applyShift();
    renderer.setSize(ww, hh);
    labels.setSize(ww, hh);
  };
  window.addEventListener('resize', onResize);

  // automatic resolution: if frames take too long (a slower GPU), render fewer pixels;
  // step back up when there is headroom again
  const perf = { scale: 1, acc: 0, n: 0 };
  const setScale = (s) => {
    perf.scale = s;
    renderer.setPixelRatio(baseDpr * s);
  };
  const adapt = (dt) => {
    // a hidden, unfocused or hitching page throttles its frames: that is not the GPU being slow
    if (dt > 0.25 || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    perf.acc += dt;
    perf.n++;
    if (perf.acc < 2) return;
    const avg = perf.acc / perf.n;
    perf.acc = 0;
    perf.n = 0;
    if (avg > 0.024 && perf.scale > 0.7) setScale(Math.max(0.7, perf.scale * 0.85));
    else if (avg < 0.0175 && perf.scale < 1) setScale(Math.min(1, perf.scale * 1.15));
  };

  // after a few seconds without input (the camera just drifts round the car) 30 fps is plenty
  let lastInput = performance.now();
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) window.addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true });
  let busyUntil = 0; // callers can ask for full frame rate for a while
  const busy = (seconds) => { busyUntil = Math.max(busyUntil, performance.now() + seconds * 1000); };
  // any running tween (car drive-in, doors, explode, Ad-mode camera) also needs full frame rate
  const animating = () => gsap.globalTimeline.getChildren(true, true, false).some((tw) => tw.isActive());

  const tickers = new Set();
  const timer = new THREE.Timer();
  let running = false;
  // while a full-page view (Garage, Compare, SQL Lab, Credits) covers the scene, redraw it only
  // a few times a second: the GPU stays cool and the page stays smooth
  let idle = false, lastRender = -1, lastFrameT = -1;
  const frame = (ts) => {
    if (!running) return;
    requestAnimationFrame(frame);
    timer.update(ts);
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    tickers.forEach((fn) => fn(dt, t));
    if (idle && t - lastRender < 0.25) return;
    const now = performance.now();
    const calm = !idle && now - lastInput > 4000 && now > busyUntil && !animating();
    if (calm && t - lastRender < 1 / 31) return;
    // measure only full-rate frames, so the 30 fps cap and the idle views don't read as slowness
    if (!idle && !calm && lastFrameT >= 0) adapt(t - lastFrameT);
    lastFrameT = t;
    lastRender = t;
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  };

  return {
    renderer, scene, camera, controls, outline, labels, quality,
    onTick: (fn) => { tickers.add(fn); return () => tickers.delete(fn); },
    start: () => { if (!running) { running = true; requestAnimationFrame(frame); } },
    setIdle: (v) => { idle = v; },
    busy,
    perf,
    // frames of shadow redraw requested by whoever changed the car (X-ray, explode...)
    shadowsDirty: 3,
    shift, applyShift,
    setDof() { /* depth of field was a full extra scene pass; dropped for speed */ },
    // Ad-mode letterbox: two CSS bars (no extra pass over the image)
    setBars(on) { document.body.classList.toggle('bars', on); },
    /** Render one object to a data URL (used for garage thumbnails). */
    snapshot(obj, { width = 480, height = 270, from, target } = {}) {
      // the picture is cut out of the canvas: never ask for more pixels than it has right now
      const k = Math.min(1, renderer.domElement.width / width, renderer.domElement.height / height);
      width = Math.floor(width * k);
      height = Math.floor(height * k);
      const cam = new THREE.PerspectiveCamera(28, width / height, 0.1, 100);
      cam.position.copy(from);
      cam.lookAt(target);
      const was = scene.background;
      const hidden = [];
      scene.children.forEach((c) => { if (c !== obj && c.visible && !c.isLight) { hidden.push(c); c.visible = false; } });
      const parent = obj.parent;
      const pos = obj.position.clone();
      scene.add(obj);
      obj.position.set(0, 0, 0);
      scene.background = new THREE.Color('#15111b');
      const fullH = renderer.domElement.height;
      const pr = renderer.getPixelRatio();
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, width / pr, height / pr);
      renderer.setScissor(0, 0, width / pr, height / pr);
      renderer.render(scene, cam);
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d').drawImage(renderer.domElement, 0, fullH - height, width, height, 0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      if (parent && parent !== scene) parent.add(obj); else if (!parent) scene.remove(obj);
      obj.position.copy(pos);
      scene.background = was;
      hidden.forEach((hh) => { hh.visible = true; });
      return c.toDataURL('image/jpeg', 0.86);
    },
  };
}
