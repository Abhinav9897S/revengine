// Procedural PBR detail maps, generated once in the browser (no image downloads):
// sand-cast grain, machined (brushed) streaks, wrinkle-finish paint, carbon-fibre twill,
// radiator fins, battery cell tops and the heat tint of a titanium exhaust.
// Each getter returns a fresh Texture that shares the cached pixels, so materials can set
// their own repeat.
import * as THREE from 'three';

const cache = new Map();

// tileable value noise (lattice wraps at `period`)
function valueNoise(size, period, seed) {
  const rnd = new Float32Array(period * period);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < rnd.length; i++) { s = (s * 9301 + 49297) % 233280; rnd[i] = s / 233280; }
  const out = new Float32Array(size * size);
  const fade = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * period, y0 = Math.floor(fy), ty = fade(fy - y0);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period, x0 = Math.floor(fx), tx = fade(fx - x0);
      const a = rnd[(y0 % period) * period + (x0 % period)], b = rnd[(y0 % period) * period + ((x0 + 1) % period)];
      const c = rnd[((y0 + 1) % period) * period + (x0 % period)], d = rnd[((y0 + 1) % period) * period + ((x0 + 1) % period)];
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

function fbm(size, base, octaves, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base << o, seed + o * 17);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function dataTexture(data, size, srgb = false) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// height field (0..1) -> tangent-space normal map
function normalMap(h, size, strength) {
  const d = new Uint8Array(size * size * 4);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  return d;
}

// grey value map (roughness lives in the green channel)
function greyMap(h, size, lo, hi) {
  const d = new Uint8Array(size * size * 4);
  for (let i = 0; i < h.length; i++) {
    const v = (lo + (hi - lo) * h[i]) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  return d;
}

function make(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  const base = cache.get(key);
  const t = base.clone();
  t.needsUpdate = true;
  return t;
}

const S = 256;

export const TEX = {
  // sand-cast aluminium / iron: fine grain with soft pitting
  castNormal: () => make('castN', () => {
    const h = fbm(S, 16, 4, 3, 0.55);
    return dataTexture(normalMap(h, S, 2.4), S);
  }),
  castRough: () => make('castR', () => dataTexture(greyMap(fbm(S, 8, 3, 7), S, 0.4, 1.0), S)),

  // machined / brushed metal: long streaks along U
  brushedNormal: () => make('brushN', () => {
    // one random height per row (the streak), drifting slowly along it
    const h = new Float32Array(S * S);
    const n = fbm(S, 64, 2, 11);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = n[y * S] * 0.7 + n[((y * 7) % S) * S + (x >> 4)] * 0.3;
    return dataTexture(normalMap(h, S, 0.9), S);
  }),
  brushedRough: () => make('brushR', () => {
    const d = new Uint8Array(S * S * 4);
    const n = fbm(S, 64, 2, 13);
    for (let y = 0; y < S; y++) {
      const row = 0.55 + 0.45 * n[y * S + 3];
      for (let x = 0; x < S; x++) {
        const v = Math.min(1, row * (0.85 + 0.15 * n[((y * 5) % S) * S + x])) * 255;
        const i = (y * S + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
    }
    return dataTexture(d, S);
  }),

  // wrinkle ("crinkle") finish of painted cam covers
  crinkleNormal: () => make('crinkleN', () => {
    const warp = fbm(S, 8, 2, 21);
    const n = fbm(S, 32, 3, 23, 0.6);
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const wx = (x + Math.round(warp[y * S + x] * 18)) & (S - 1);
      h[y * S + x] = Math.abs(n[y * S + wx] - 0.5) * 2;
    }
    return dataTexture(normalMap(h, S, 5), S);
  }),

  // 2x2 twill carbon weave: colour + normal
  carbonColor: () => make('carbonC', () => {
    const d = new Uint8Array(S * S * 4);
    const tows = 16, tw = S / tows;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const tx = Math.floor(x / tw), ty = Math.floor(y / tw);
      const over = ((tx + ty) >> 1) % 2 === 0; // twill: diagonal steps of two
      const u = (over ? x : y) % tw / tw;
      const sheen = over ? 0.75 + 0.25 * Math.sin(u * Math.PI) : 0.45 + 0.2 * Math.sin(u * Math.PI);
      const v = 14 + sheen * 30;
      const i = (y * S + x) * 4;
      d[i] = v; d[i + 1] = v + 1; d[i + 2] = v + 4; d[i + 3] = 255;
    }
    return dataTexture(d, S, true);
  }),
  carbonNormal: () => make('carbonN', () => {
    const h = new Float32Array(S * S);
    const tows = 16, tw = S / tows;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const tx = Math.floor(x / tw), ty = Math.floor(y / tw);
      const over = ((tx + ty) >> 1) % 2 === 0;
      const u = (over ? y : x) % tw / tw;
      h[y * S + x] = Math.sin(u * Math.PI) * (over ? 1 : 0.6);
    }
    return dataTexture(normalMap(h, S, 1.6), S);
  }),

  // radiator / cooler core: tight horizontal fins
  finsNormal: () => make('finsN', () => {
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = Math.abs(Math.sin((y / S) * Math.PI * 48)) * (0.8 + 0.2 * Math.sin((x / S) * Math.PI * 128));
    return dataTexture(normalMap(h, S, 3), S);
  }),

  // ribbed belt / corrugated cable conduit
  ribsNormal: () => make('ribsN', () => {
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = Math.pow(Math.abs(Math.sin((x / S) * Math.PI * 24)), 0.6);
    return dataTexture(normalMap(h, S, 3), S);
  }),

  // battery module top: rows of cylindrical cells
  cellsColor: () => make('cellsC', () => {
    const d = new Uint8Array(S * S * 4);
    const n = 16, c = S / n;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const ox = (Math.floor(y / c) % 2) * c * 0.5;
      const cx = ((x + ox) % c) - c / 2, cy = (y % c) - c / 2;
      const r = Math.hypot(cx, cy) / (c / 2);
      let v = r < 0.82 ? (r < 0.3 ? 175 : 120 - r * 40) : 38;
      if (r > 0.78 && r < 0.86) v = 200;
      const i = (y * S + x) * 4;
      d[i] = v * 0.92; d[i + 1] = v * 0.95; d[i + 2] = v; d[i + 3] = 255;
    }
    return dataTexture(d, S, true);
  }),

  // titanium exhaust heat tint along U: polished silver -> straw gold -> bronze -> purple -> blue -> grey
  heatColor: () => make('heatC', () => {
    const d = new Uint8Array(S * S * 4);
    // muted, the way the tint sits on real metal rather than looking painted
    const stops = [[0, [200, 202, 206]], [0.14, [205, 186, 140]], [0.28, [178, 134, 92]], [0.42, [132, 98, 120]], [0.56, [92, 104, 150]], [0.72, [104, 120, 146]], [0.88, [128, 131, 138]], [1, [146, 148, 152]]];
    const n = fbm(S, 8, 3, 31);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = Math.min(1, Math.max(0, x / S + (n[y * S + x] - 0.5) * 0.12));
      let k = 0;
      while (k < stops.length - 2 && u > stops[k + 1][0]) k++;
      const [u0, c0] = stops[k], [u1, c1] = stops[k + 1];
      const t = (u - u0) / (u1 - u0);
      const i = (y * S + x) * 4;
      for (let ch = 0; ch < 3; ch++) d[i + ch] = c0[ch] + (c1[ch] - c0[ch]) * t;
      d[i + 3] = 255;
    }
    return dataTexture(d, S, true);
  }),
};

// set the repeat of a texture and return it (chainable inside material definitions)
export function rep(tex, u, v = u) {
  tex.repeat.set(u, v);
  return tex;
}
