// Photo-real "car advert" locations: real 360° HDR photos (Poly Haven, CC0) projected onto the
// ground, image-based lighting, sun shadows found automatically, contact shadows, studio cove,
// night headlight beams and rain.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

export const SCENES = [
  {
    id: 'rooftop', name: 'Rooftop car park', time: 'Twilight', credit: 'Rooftop Night · Poly Haven (CC0)',
    hdr: '/env/rooftop_night.hdr', bg: '/env/rooftop_night_bg.jpg', height: 2.2, radius: 70, rot: 2.2,
    envIntensity: 0.95, exposure: 1.0, night: true, sun: 0.4,
  },
  {
    id: 'neon', name: 'Neon riverside', time: 'Night · rain', credit: 'Shanghai Bund · Poly Haven (CC0)',
    hdr: '/env/shanghai_bund.hdr', bg: '/env/shanghai_bund_bg.jpg', height: 2.0, radius: 90, rot: 1.8,
    envIntensity: 0.9, exposure: 1.0, night: true, rain: true, sun: 0.25,
  },
  {
    id: 'desert', name: 'Desert highway', time: 'Midday sun', credit: 'Nowhere Road · Poly Haven (CC0)',
    hdr: '/env/nowhere_road.hdr', bg: '/env/nowhere_road_bg.jpg', height: 1.8, radius: 120, rot: 0.6, bgGain: 3.7,
    envIntensity: 1.0, exposure: 0.9, night: false, sun: 2.4,
  },
  {
    id: 'garage', name: 'Underground garage', time: 'Fluorescent', credit: 'Parking Garage · Poly Haven (CC0)',
    hdr: '/env/parking_garage.hdr', bg: '/env/parking_garage_bg.jpg', height: 2.0, radius: 26, rot: 3.14,
    envIntensity: 1.0, exposure: 1.0, night: true, sun: 0.5,
  },
  {
    id: 'studio', name: 'Studio reveal', time: 'Softbox', credit: 'Studio Small 09 · Poly Haven (CC0)',
    hdr: '/env/studio_small_09.hdr', studio: true, rot: 0, envIntensity: 0.5, exposure: 0.95, night: false, sun: 0,
  },
];

const hdrLoader = new HDRLoader();
const texLoader = new THREE.TextureLoader();

export class Atmosphere {
  constructor(stage, { quality = 'high' } = {}) {
    this.stage = stage;
    this.quality = quality;
    this.scene = stage.scene;
    this.renderer = stage.renderer;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.cache = new Map();
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.current = null;
    this.car = null;
    this.time = 0;
    RectAreaLightUniformsLib.init();

    // sun (direction measured from the photo) + shadow catcher on the ground
    this.sun = new THREE.DirectionalLight('#ffffff', 0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -5; sc.right = 5; sc.top = 5; sc.bottom = -5; sc.near = 0.5; sc.far = 40;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 6;
    this.sun.shadow.blurSamples = 16;
    this.scene.add(this.sun, this.sun.target);
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.5, depthWrite: false }));
    this.catcher.position.y = 0.002;
    this.catcher.receiveShadow = true;
    this.catcher.renderOrder = 2;
    this.scene.add(this.catcher);

    this.initContactShadow();
    this.initHeadlights();
    this.initRain();
  }

  // ------------------------------------------------------------------ loading
  async preload(id, onProgress) {
    if (this.cache.has(id)) return this.cache.get(id);
    const cfg = SCENES.find((s) => s.id === id);
    const job = (async () => {
      const hdr = await hdrLoader.loadAsync(cfg.hdr, (e) => onProgress?.(e.total ? e.loaded / e.total : 0));
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const sun = findSun(hdr);
      const env = this.pmrem.fromEquirectangular(hdr).texture;
      let bg = null;
      if (cfg.bg) {
        bg = await texLoader.loadAsync(cfg.bg);
        bg.colorSpace = THREE.SRGBColorSpace;
        bg.mapping = THREE.EquirectangularReflectionMapping;
        bg.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        const max = this.renderer.capabilities.maxTextureSize;
        if (bg.image.width > max) bg.image = downscale(bg.image, max);
      }
      return { cfg, hdr, env, bg, sun };
    })();
    this.cache.set(id, job);
    return job;
  }

  async set(id, onProgress) {
    const a = await this.preload(id, onProgress);
    this.apply(a);
    return a.cfg;
  }

  apply({ cfg, hdr, env, bg, sun }) {
    this.clear();
    this.current = cfg;
    const scene = this.scene;
    const rot = cfg.rot || 0;
    scene.environment = env;
    scene.environmentIntensity = cfg.envIntensity;
    scene.environmentRotation.set(0, rot, 0);
    scene.backgroundRotation.set(0, rot, 0);
    scene.fog = null;
    this.renderer.toneMappingExposure = cfg.exposure;

    if (cfg.studio) this.buildStudio(cfg);
    else {
      const sky = new GroundedSkybox(bg, cfg.height, cfg.radius, 160);
      sky.position.y = cfg.height - 0.01;
      sky.rotation.y = rot;
      sky.material.fog = false;
      sky.material.color.setScalar(cfg.bgGain || 1);
      if (cfg.skyFromHdr) {
        // sharp 8K photo for the ground and horizon, correctly exposed HDR for the open sky
        sky.material.dispose();
        sky.material = new THREE.ShaderMaterial({
          uniforms: { tPhoto: { value: bg }, tHdr: { value: hdr }, uGain: { value: cfg.bgGain || 1 }, uSky: { value: cfg.skyFromHdr } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: /* glsl */`
            uniform sampler2D tPhoto, tHdr; uniform float uGain, uSky; varying vec2 vUv;
            void main(){
              vec3 photo = texture2D(tPhoto, vUv).rgb * uGain;
              vec3 sky = texture2D(tHdr, vUv).rgb * uSky;
              float t = smoothstep(0.525, 0.6, vUv.y);
              gl_FragColor = vec4(mix(photo, sky, t), 1.0);
            }`,
          depthWrite: false,
        });
      }
      sky.renderOrder = -10;
      sky.raycast = () => {};
      this.group.add(sky);
      scene.background = new THREE.Color('#000');
    }

    // sun: real direction from the brightest point of the photo
    const dir = sun.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    if (dir.y < 0.12) dir.y = 0.12;
    dir.normalize();
    this.sunDir = dir;
    this.sun.intensity = cfg.sun ?? 0;
    this.sun.color.copy(sun.color);
    this.sun.position.copy(dir).multiplyScalar(15);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = (cfg.sun ?? 0) > 0.3;
    this.catcher.visible = this.sun.castShadow && !cfg.studio;
    this.catcher.material.opacity = Math.min(0.62, 0.2 + (cfg.sun || 0) * 0.18);

    this.setNight(!!cfg.night);
    this.rain.visible = !!cfg.rain;
  }

  clear() {
    this.group.children.slice().forEach((c) => {
      this.group.remove(c);
      c.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose && !o.userData.keepMaterial) o.material.dispose();
        if (o.isReflector) o.dispose();
      });
    });
  }

  // ------------------------------------------------------------------ studio cove
  buildStudio() {
    const g = this.group;
    this.scene.background = new THREE.Color('#050506');
    this.scene.fog = new THREE.FogExp2('#050506', 0.018);
    // infinity cove: floor that curves up into a back wall
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * (Math.PI / 2);
      pts.push(new THREE.Vector2(16 + Math.sin(a) * 4, 4 - Math.cos(a) * 4));
    }
    pts.unshift(new THREE.Vector2(0.01, 0));
    pts.push(new THREE.Vector2(20, 14));
    const cove = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.85, metalness: 0, side: THREE.BackSide, envMapIntensity: 0.15 }));
    cove.receiveShadow = true;
    cove.raycast = () => {};
    g.add(cove);
    // polished black floor: a mirror, darkened by a plain black layer (no specular sheen of its own)
    const high = this.quality === 'high';
    if (high) {
      const mirror = new Reflector(new THREE.CircleGeometry(12, 96), {
        clipBias: 0.003, textureWidth: Math.min(2048, innerWidth), textureHeight: Math.min(2048, innerHeight), color: 0x8a8a90,
      });
      mirror.rotation.x = -Math.PI / 2;
      mirror.position.y = 0.0005;
      mirror.raycast = () => {};
      mirror.isReflector = true;
      g.add(mirror);
    }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 96).rotateX(-Math.PI / 2), high
      ? new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.5, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: '#060607', roughness: 0.45, metalness: 0 }));
    floor.position.y = 0.001;
    floor.receiveShadow = true;
    floor.raycast = () => {};
    g.add(floor);
    // softboxes: big overhead panel + two tall strips (they draw the long light lines on the paint)
    const panel = (w, h, intensity, pos, look) => {
      const light = new THREE.RectAreaLight('#fff4ea', intensity, w, h);
      light.position.set(...pos);
      light.lookAt(...look);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4ea').multiplyScalar(1.25), side: THREE.DoubleSide, fog: false }));
      mesh.position.copy(light.position);
      mesh.quaternion.copy(light.quaternion);
      mesh.raycast = () => {};
      g.add(light, mesh);
    };
    panel(7, 2.6, 4, [0, 5.2, 0], [0, 0, 0]);
    panel(0.5, 3.8, 7, [-1.2, 2.3, 8.2], [0, 0.7, 0]);
    panel(0.5, 3.8, 7, [-1.2, 2.3, -8.2], [0, 0.7, 0]);
    panel(3.2, 0.5, 5, [-6.5, 2.2, 0], [0, 0.6, 0]);
  }

  // ------------------------------------------------------------------ contact shadow
  initContactShadow() {
    const size = 9, res = this.quality === 'high' ? 512 : 256;
    this.cs = { size, height: 0.9, darkness: 1.7, blur: 2.6, res };
    const rt = new THREE.WebGLRenderTarget(res, res);
    rt.texture.generateMipmaps = false;
    const rtBlur = new THREE.WebGLRenderTarget(res, res);
    rtBlur.texture.generateMipmaps = false;
    const geo = new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2);
    const plane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: rt.texture, transparent: true, depthWrite: false, opacity: 0.92 }));
    plane.renderOrder = 3;
    plane.scale.y = -1;
    plane.position.y = 0.004;
    plane.raycast = () => {};
    const blurPlane = new THREE.Mesh(geo);
    blurPlane.visible = false;
    const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, this.cs.height);
    cam.rotation.x = Math.PI / 2;
    cam.layers.set(2);
    const depth = new THREE.MeshDepthMaterial();
    depth.userData.darkness = { value: this.cs.darkness };
    depth.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = depth.userData.darkness;
      shader.fragmentShader = `uniform float darkness;\n${shader.fragmentShader.replace(
        'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );',
      )}`;
    };
    depth.depthTest = false;
    depth.depthWrite = false;
    const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
    hBlur.depthTest = false;
    const vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
    vBlur.depthTest = false;
    const grp = new THREE.Group();
    grp.add(plane, blurPlane, cam);
    this.scene.add(grp);
    Object.assign(this.cs, { rt, rtBlur, plane, blurPlane, cam, depth, hBlur, vBlur, grp });
  }

  renderContactShadow() {
    const { rt, rtBlur, blurPlane, cam, depth, hBlur, vBlur, blur, res } = this.cs;
    const r = this.renderer;
    const scene = this.scene;
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = depth;
    const clearAlpha = r.getClearAlpha();
    r.setClearAlpha(0);
    const shadowsOn = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(rt);
    r.clear();
    r.render(scene, cam);
    scene.overrideMaterial = null;
    const pass = (amount) => {
      blurPlane.visible = true;
      blurPlane.material = hBlur;
      hBlur.uniforms.tDiffuse.value = rt.texture;
      hBlur.uniforms.h.value = amount / res;
      r.setRenderTarget(rtBlur);
      r.render(blurPlane, cam);
      blurPlane.material = vBlur;
      vBlur.uniforms.tDiffuse.value = rtBlur.texture;
      vBlur.uniforms.v.value = amount / res;
      r.setRenderTarget(rt);
      r.render(blurPlane, cam);
      blurPlane.visible = false;
    };
    pass(blur);
    pass(blur * 0.4);
    r.setRenderTarget(null);
    r.setClearAlpha(clearAlpha);
    r.shadowMap.autoUpdate = shadowsOn;
    scene.background = bg;
    scene.fog = fog;
  }

  // ------------------------------------------------------------------ headlights at night
  initHeadlights() {
    const uniforms = {
      uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(1, -0.1, 0) },
      uColor: { value: new THREE.Color('#ffe9cf') }, uStrength: { value: 0 },
    };
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        uniform vec3 uA, uB, uDir, uColor; uniform float uStrength; varying vec3 vW;
        float lamp(vec3 p){
          vec3 v = vW - p; float d = max(length(v), 0.001); vec3 n = v / d;
          float c = dot(n, normalize(uDir));
          float cone = smoothstep(0.86, 0.97, c);
          return cone * 2.2 / (1.0 + d * d * 0.45) * smoothstep(0.3, 1.4, d);
        }
        void main(){
          float k = (lamp(uA) + lamp(uB)) * uStrength;
          gl_FragColor = vec4(uColor * k, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    pool.position.y = 0.005;
    pool.renderOrder = 4;
    pool.raycast = () => {};
    pool.visible = false;
    const beams = new THREE.Group();
    const mat = beamMaterial("#fff0dc", 0.045);
    for (let i = 0; i < 2; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.3, 7, 32, 1, true), mat);
      cone.geometry.translate(0, -3.5, 0);
      cone.geometry.rotateZ(Math.PI / 2);
      cone.raycast = () => {};
      beams.add(cone);
    }
    beams.visible = false;
    this.scene.add(pool, beams);
    this.lights = { uniforms, pool, beams };
  }

  setNight(on) {
    this.night = on;
    this.lights.pool.visible = on;
    this.lights.beams.visible = on && this.quality === 'high';
    this.lights.uniforms.uStrength.value = on ? 1 : 0;
    this.car?.setHeadlights?.(on);
  }

  // ------------------------------------------------------------------ rain
  initRain() {
    const N = this.quality === 'high' ? 5000 : 2000;
    const pos = new Float32Array(N * 6);
    this.rainData = { N, box: new THREE.Vector3(26, 12, 26), speed: new Float32Array(N) };
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 26, y = Math.random() * 12, z = (Math.random() - 0.5) * 26, l = 0.25 + Math.random() * 0.25;
      pos.set([x, y, z, x + 0.03, y - l, z], i * 6);
      this.rainData.speed[i] = 14 + Math.random() * 8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#a9c8ff', transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.raycast = () => {};
    this.scene.add(this.rain);
  }

  // ------------------------------------------------------------------ per frame
  setCar(car) {
    this.car = car;
    car.root.traverse((o) => { if (o.isMesh) o.layers.enable(2); });
    car.setHeadlights?.(this.night);
  }

  update(dt) {
    this.time += dt;
    const car = this.car;
    if (car) {
      const root = car.root;
      this.cs.grp.position.set(root.position.x, 0, root.position.z);
      const s = Math.max(car.dims.L, 4) / 4.6;
      this.cs.grp.scale.set(s, 1, s);
      this.renderContactShadow();
      if (this.night && car.headlightPos) {
        const [a, b] = car.headlightPos;
        const { uniforms, beams } = this.lights;
        uniforms.uA.value.copy(a).applyMatrix4(root.matrixWorld);
        uniforms.uB.value.copy(b).applyMatrix4(root.matrixWorld);
        uniforms.uDir.value.set(1, -0.09, 0).transformDirection(root.matrixWorld);
        beams.children.forEach((cone, i) => {
          cone.position.copy(i ? uniforms.uB.value : uniforms.uA.value);
          cone.rotation.set(0, 0, -0.07);
        });
      }
    }
    if (this.rain.visible) {
      const p = this.rain.geometry.attributes.position.array;
      const { N, speed } = this.rainData;
      for (let i = 0; i < N; i++) {
        const k = i * 6;
        const d = speed[i] * dt;
        p[k + 1] -= d; p[k + 4] -= d;
        if (p[k + 4] < 0) { const h = 12 + Math.random() * 2; p[k + 1] += h; p[k + 4] += h; }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      const t = this.stage.controls.target;
      this.rain.position.set(t.x, 0, t.z);
    }
  }
}

// Soft light beam / haze: additive, fading along the beam. Plain material (no custom maths), so it can
// never produce NaN pixels that the bloom pass would smear across the whole frame.
let beamGradient = null;
function beamMaterial(color, strength) {
  if (!beamGradient) {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 256, 0, 0);
    gr.addColorStop(0, '#000');
    gr.addColorStop(0.55, '#555');
    gr.addColorStop(1, '#fff');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 256);
    beamGradient = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(strength * 2.2), alphaMap: beamGradient, map: beamGradient,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: true,
  });
}

// Brightest point of the upper half of an equirectangular HDR = the sun (or main lamp)
function findSun(tex) {
  const { data, width, height } = tex.image;
  const ch = Math.round(data.length / (width * height));
  const half = tex.type === THREE.HalfFloatType;
  const f = half ? THREE.DataUtils.fromHalfFloat : (v) => v;
  let best = 0, bi = 0;
  for (let y = 0; y < height / 2; y++) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * ch;
      const l = f(data[i]) * 0.2126 + f(data[i + 1]) * 0.7152 + f(data[i + 2]) * 0.0722;
      if (l > best) { best = l; bi = y * width + x; }
    }
  }
  const px = bi % width, py = Math.floor(bi / width);
  const u = (px + 0.5) / width, v = 1 - (py + 0.5) / height;
  const phi = (u - 0.5) * 2 * Math.PI, lat = (v - 0.5) * Math.PI;
  const i = bi * ch;
  const color = new THREE.Color(f(data[i]), f(data[i + 1]), f(data[i + 2]));
  const m = Math.max(color.r, color.g, color.b) || 1;
  color.multiplyScalar(1 / m);
  return { dir: new THREE.Vector3(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat)), peak: best, color };
}

function downscale(img, max) {
  const c = document.createElement('canvas');
  c.width = max;
  c.height = max / 2;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
