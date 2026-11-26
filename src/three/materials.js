import * as THREE from 'three';
import { TEX, rep } from './textures.js';

const cache = new Map();
function once(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}
const V2 = (s) => new THREE.Vector2(s, s);
const phys = (o) => new THREE.MeshPhysicalMaterial(o);

// Real-world finishes for the mechanical parts (engine, chassis, battery): every metal gets a
// surface (cast grain, machining streaks, weave...) so it reads as a photographed part.
export function crinkle(color) {
  return once(`crinkle${color}`, () => phys({
    color, metalness: 0.15, roughness: 0.55, normalMap: rep(TEX.crinkleNormal(), 3), normalScale: V2(0.7),
    clearcoat: 0.35, clearcoatRoughness: 0.45,
  }));
}
export function anodized(color) {
  return once(`anod${color}`, () => phys({
    color, metalness: 0.85, roughness: 0.6, roughnessMap: rep(TEX.brushedRough(), 2), normalMap: rep(TEX.brushedNormal(), 2), normalScale: V2(0.2),
  }));
}

export function paint(color) {
  return once(`paint${color}`, () => new THREE.MeshPhysicalMaterial({
    color, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.25,
  }));
}

export function solid(color, metalness = 0.2, roughness = 0.5, extra = {}) {
  return once(`solid${color}${metalness}${roughness}${JSON.stringify(extra)}`, () =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra }));
}

export function glow(color, intensity = 3) {
  return once(`glow${color}${intensity}`, () =>
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4 }));
}

export const M = {
  get glass() {
    return once('glass', () => new THREE.MeshPhysicalMaterial({
      color: 0x0a0e14, metalness: 0.1, roughness: 0.02, transparent: true, opacity: 0.5,
      envMapIntensity: 1.6, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false,
    }));
  },
  get lens() {
    return once('lens', () => new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.0, transparent: true, opacity: 0.22, envMapIntensity: 2, depthWrite: false,
    }));
  },
  get redLens() {
    return once('redLens', () => new THREE.MeshPhysicalMaterial({
      color: 0x8a0008, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.75, envMapIntensity: 1.5, clearcoat: 1,
    }));
  },
  get inner() { return once('inner', () => new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9, side: THREE.BackSide })); },
  // satin black powder coat (frames, trim, brackets)
  get black() { return once('black', () => phys({ color: '#0c0c0e', metalness: 0.2, roughness: 0.5, normalMap: rep(TEX.castNormal(), 3), normalScale: V2(0.12) })); },
  get gloss() { return solid('#060607', 0.3, 0.15); },
  get rubber() { return once('rubber', () => phys({ color: '#141416', metalness: 0, roughness: 0.88, normalMap: rep(TEX.castNormal(), 5), normalScale: V2(0.3) })); },
  get chrome() { return solid('#ffffff', 1.0, 0.08); },
  // cast aluminium (heads, intake, housings): bright, grainy, satin
  get alloy() {
    return once('alloy', () => phys({
      color: '#c9ccd1', metalness: 1, roughness: 0.55, roughnessMap: rep(TEX.castRough(), 3),
      normalMap: rep(TEX.castNormal(), 4), normalScale: V2(0.22),
    }));
  },
  // darker cast aluminium / magnesium (block, sump, gearbox case)
  get darkAlloy() {
    return once('darkAlloy', () => phys({
      color: '#7a7f87', metalness: 1, roughness: 0.62, roughnessMap: rep(TEX.castRough(), 3),
      normalMap: rep(TEX.castNormal(), 5), normalScale: V2(0.3),
    }));
  },
  // cast iron (turbine housings, exhaust flanges)
  get castIron() {
    return once('castIron', () => phys({
      color: '#4d5056', metalness: 0.9, roughness: 0.85, roughnessMap: rep(TEX.castRough(), 3),
      normalMap: rep(TEX.castNormal(), 3), normalScale: V2(1.2),
    }));
  },
  // machined steel (crankshaft, rods, discs): streaky, polished
  get steel() {
    return once('steel', () => phys({
      color: '#b9bfc7', metalness: 1, roughness: 0.42, roughnessMap: rep(TEX.brushedRough(), 1, 3),
      normalMap: rep(TEX.brushedNormal(), 1, 3), normalScale: V2(0.25),
    }));
  },
  // brushed titanium (tailpipe tips, exhaust system)
  get titanium() {
    return once('titanium', () => phys({
      color: '#a7a4b4', metalness: 1, roughness: 0.28, roughnessMap: rep(TEX.brushedRough(), 1, 2),
      normalMap: rep(TEX.brushedNormal(), 1, 2), normalScale: V2(0.15),
    }));
  },
  // exhaust headers: heat tint along each tube, blue-grey at the hot head end fading to gold and silver
  get headers() {
    return once('headers', () => phys({
      color: '#ffffff', map: rep(TEX.heatColor(), -1, 1), metalness: 1, roughness: 0.3,
      normalMap: rep(TEX.brushedNormal(), 4, 1), normalScale: V2(0.12),
    }));
  },
  // twill carbon fibre under clear coat
  get carbon() {
    return once('carbon', () => phys({
      color: '#ffffff', map: rep(TEX.carbonColor(), 3), metalness: 0.25, roughness: 0.32,
      normalMap: rep(TEX.carbonNormal(), 3), normalScale: V2(0.5), clearcoat: 1, clearcoatRoughness: 0.04,
    }));
  },
  get leather() { return solid('#1b1716', 0.0, 0.7); },
  get alcantara() { return solid('#232326', 0.0, 0.95); },
  get mesh() { return solid('#0c0c0d', 0.5, 0.55); },
  get disc() {
    return once('disc', () => phys({
      color: '#8b8f95', metalness: 1, roughness: 0.5, roughnessMap: rep(TEX.brushedRough(), 2),
      normalMap: rep(TEX.brushedNormal(), 2), normalScale: V2(0.3),
    }));
  },
  get mirror() { return solid('#dfe6ee', 1.0, 0.02); },
  get screen() { return glow('#38bdf8', 1.6); },
  get headLed() { return glow('#e9f4ff', 3.2); },
  get tailLed() { return glow('#ff1028', 3.2); },
  get hot() { return glow('#ff5a1a', 1.2); },
  get cell() { return glow('#22d3ee', 0.8); },
  // orange high-voltage cable in corrugated sleeve
  get hv() { return once('hv', () => phys({ color: '#ff6a10', metalness: 0, roughness: 0.5, normalMap: rep(TEX.ribsNormal(), 6, 1), normalScale: V2(0.8) })); },
  get copper() {
    return once('copper', () => phys({
      color: '#c0703f', metalness: 1, roughness: 0.32, roughnessMap: rep(TEX.brushedRough(), 2), normalMap: rep(TEX.brushedNormal(), 2), normalScale: V2(0.2),
    }));
  },
  get radiator() { return once('radiator', () => phys({ color: '#2d3035', metalness: 0.85, roughness: 0.45, normalMap: TEX.finsNormal(), normalScale: V2(1) })); },
  // fasteners, black plastics, hoses, battery cells
  get bolt() { return once('bolt', () => phys({ color: '#b3b8be', metalness: 1, roughness: 0.3 })); },
  get plastic() { return once('plastic', () => phys({ color: '#141416', metalness: 0, roughness: 0.55, normalMap: rep(TEX.castNormal(), 4), normalScale: V2(0.1) })); },
  get hose() { return once('hose', () => phys({ color: '#18181b', metalness: 0, roughness: 0.75, normalMap: rep(TEX.ribsNormal(), 8, 1), normalScale: V2(0.25) })); },
  get belt() { return once('belt', () => phys({ color: '#121214', metalness: 0, roughness: 0.8, normalMap: rep(TEX.ribsNormal(), 1, 40), normalScale: V2(0.6) })); },
  get cells() { return once('cells', () => phys({ color: '#ffffff', map: TEX.cellsColor(), metalness: 0.6, roughness: 0.4 })); },
};

// ---------- X-ray ghost shader ----------
export function makeXray(color = '#38e1ff') {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uScan: { value: -100 },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uScan;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float f = pow(max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vV)))), 2.0);
        float lines = smoothstep(0.92, 1.0, sin(vW.y * 90.0 + uTime * 4.0) * 0.5 + 0.5) * 0.25;
        float scan = exp(-pow((vW.x - uScan) * 9.0, 2.0));
        float a = (f * 0.85 + 0.05 + lines * f) * uOpacity + scan * 0.9;
        gl_FragColor = vec4(uColor * (f * 1.8 + 0.12 + lines) + vec3(0.6, 1.0, 1.0) * scan * 3.0, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}
