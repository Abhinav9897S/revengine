// Renderer, camera, controls and a photographic post-processing chain:
// render → ambient occlusion → hover outline → depth of field → bloom → tone map → film look.
import * as THREE from 'three';
import gsap from 'gsap';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

// Display-space "lens + film" pass: grade, chromatic aberration, vignette, grain, letterbox
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.035 }, uVignette: { value: 0.55 }, uCA: { value: 0.9 }, uBars: { value: 0 },
    uContrast: { value: 1.06 }, uSaturation: { value: 1.04 }, uShadowTint: { value: new THREE.Color('#0d2730') }, uHighTint: { value: new THREE.Color('#ffd9b0') }, uSplit: { value: 0.06 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uCA, uBars, uContrast, uSaturation, uSplit;
    uniform vec2 uRes; uniform vec3 uShadowTint, uHighTint;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uCA * 0.012;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col += uShadowTint * (1.0 - smoothstep(0.0, 0.5, l)) * uSplit;
      col *= mix(vec3(1.0), uHighTint, smoothstep(0.55, 1.0, l) * uSplit * 1.5);
      float v = smoothstep(0.95, 0.2, length(c * vec2(1.0, 0.82)));
      col *= mix(1.0, v, uVignette);
      col += (hash(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5) * uGrain;
      float aspect = uRes.x / uRes.y;
      float bar = max(0.0, (1.0 - aspect / 2.39) * 0.5) * uBars;
      if (vUv.y < bar || vUv.y > 1.0 - bar) col = vec3(0.0);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export function createStage(container, { quality = 'high' } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio, quality === 'high' ? 1.5 : 1.15);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
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

  const w = window.innerWidth, h = window.innerHeight;
  const size = new THREE.Vector2(w, h);
  const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));

  let gtao = null;
  if (quality === 'high') {
    gtao = new GTAOPass(scene, camera, w, h);
    gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
  }

  const outline = new OutlinePass(size.clone(), scene, camera);
  outline.edgeStrength = 4;
  outline.edgeGlow = 0.4;
  outline.edgeThickness = 1.4;
  outline.pulsePeriod = 2.4;
  outline.visibleEdgeColor.set('#7fe9ff');
  outline.hiddenEdgeColor.set('#1c4b5c');
  composer.addPass(outline);

  const bokeh = new BokehPass(scene, camera, { focus: 6, aperture: 0.0035, maxblur: 0.006 });
  bokeh.enabled = false;
  composer.addPass(bokeh);

  const bloom = new UnrealBloomPass(size.clone(), 0.22, 0.5, 1.4);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const film = new ShaderPass(FilmShader);
  composer.addPass(film);

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
    composer.setSize(ww, hh);
    labels.setSize(ww, hh);
    film.uniforms.uRes.value.set(ww * dpr, hh * dpr);
  };
  film.uniforms.uRes.value.set(w * dpr, h * dpr);
  window.addEventListener('resize', onResize);

  const dof = { on: false, focus: 6 };
  const tickers = new Set();
  const timer = new THREE.Timer();
  let running = false;
  const frame = (ts) => {
    if (!running) return;
    requestAnimationFrame(frame);
    timer.update(ts);
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    tickers.forEach((fn) => fn(dt, t));
    controls.update();
    film.uniforms.uTime.value = t;
    if (dof.on) {
      const target = dof.auto ? camera.position.distanceTo(controls.target) : dof.focus;
      bokeh.uniforms.focus.value += (target - bokeh.uniforms.focus.value) * 0.15;
    }
    composer.render();
    labels.render(scene, camera);
  };

  return {
    renderer, scene, camera, controls, composer, outline, bloom, labels, gtao, bokeh, film, quality,
    onTick: (fn) => { tickers.add(fn); return () => tickers.delete(fn); },
    start: () => { if (!running) { running = true; requestAnimationFrame(frame); } },
    shift, applyShift,
    setDof(on, { auto = true, focus = 6, aperture = 0.0035 } = {}) {
      dof.on = on; dof.auto = auto; dof.focus = focus;
      bokeh.enabled = on;
      bokeh.uniforms.aperture.value = aperture;
      if (on) bokeh.uniforms.focus.value = auto ? camera.position.distanceTo(controls.target) : focus;
    },
    setBars(on, duration = 0.9) { gsap.to(film.uniforms.uBars, { value: on ? 1 : 0, duration, ease: 'power2.inOut' }); },
    /** Render one object to a data URL (used for garage thumbnails). */
    snapshot(obj, { width = 480, height = 270, from, target } = {}) {
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
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, width / dpr, height / dpr);
      renderer.setScissor(0, 0, width / dpr, height / dpr);
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
