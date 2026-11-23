import * as THREE from 'three';

const cache = new Map();
function once(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
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
  get black() { return solid('#0a0a0b', 0.1, 0.6); },
  get gloss() { return solid('#060607', 0.3, 0.15); },
  get rubber() { return solid('#121214', 0.0, 0.85); },
  get chrome() { return solid('#ffffff', 1.0, 0.08); },
  get alloy() { return solid('#c7cbd1', 1.0, 0.28); },
  get darkAlloy() { return solid('#3b3f46', 0.9, 0.35); },
  get steel() { return solid('#8d939b', 0.95, 0.38); },
  get titanium() { return solid('#8f8aa8', 1.0, 0.25); },
  get carbon() { return once('carbon', () => new THREE.MeshPhysicalMaterial({ color: 0x1a1c20, metalness: 0.4, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 })); },
  get leather() { return solid('#1b1716', 0.0, 0.7); },
  get alcantara() { return solid('#232326', 0.0, 0.95); },
  get mesh() { return solid('#0c0c0d', 0.5, 0.55); },
  get disc() { return solid('#7e8288', 0.9, 0.45); },
  get mirror() { return solid('#dfe6ee', 1.0, 0.02); },
  get screen() { return glow('#38bdf8', 1.6); },
  get headLed() { return glow('#e9f4ff', 3.2); },
  get tailLed() { return glow('#ff1028', 3.2); },
  get hot() { return glow('#ff5a1a', 2.2); },
  get cell() { return glow('#22d3ee', 1.4); },
  get hv() { return solid('#ff7a00', 0.1, 0.5); },
  get copper() { return solid('#c27c4e', 1.0, 0.3); },
  get radiator() { return solid('#24272c', 0.8, 0.55); },
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
