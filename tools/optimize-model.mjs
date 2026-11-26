// Compress a downloaded car model for the web and write a report of its parts.
//   node tools/optimize-model.mjs <input .glb or .gltf> <slug>
// Output: public/models/<slug>.glb  (meshopt geometry, WebP textures ≤ 2048 px)
//         tools/reports/<slug>.json (node names, materials, sizes; used to map clickable parts)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt, getBounds, metalRough, weld, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const [, , input, slug] = process.argv;
if (!input || !slug) {
  console.error('usage: node tools/optimize-model.mjs <input> <slug>');
  process.exit(1);
}
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(input);
const root = doc.getRoot();
const before = fs.statSync(input).size;

// report
const scene = root.getDefaultScene() || root.listScenes()[0];
const nodes = [];
const walk = (node, depth, parent) => {
  const mesh = node.getMesh();
  let tris = 0;
  const mats = new Set();
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      tris += idx ? idx.getCount() / 3 : pos.getCount() / 3;
      if (prim.getMaterial()) mats.add(prim.getMaterial().getName());
    }
  }
  let bounds = null;
  if (mesh) {
    try { const b = getBounds(node); bounds = { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) }; } catch { /* ignore */ }
  }
  nodes.push({ depth, name: node.getName(), parent, mesh: mesh ? mesh.getName() : null, tris: Math.round(tris), materials: [...mats], bounds });
  node.listChildren().forEach((c) => walk(c, depth + 1, node.getName()));
};
scene.listChildren().forEach((n) => walk(n, 0, null));
const sceneBounds = getBounds(scene);
const report = {
  slug, input: path.basename(input), bytesIn: before,
  bounds: { min: sceneBounds.min, max: sceneBounds.max },
  materials: root.listMaterials().map((m) => ({ name: m.getName(), color: m.getBaseColorFactor().map((v) => +v.toFixed(3)), metal: m.getMetallicFactor(), rough: m.getRoughnessFactor(), alpha: m.getAlphaMode(), tex: !!m.getBaseColorTexture() })),
  textures: root.listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(), size: t.getSize() })),
  nodes,
};

// Older Sketchfab conversions use spec/gloss materials, which three.js no longer reads, and some
// (game rips) keep every colour in the specular texture over a black diffuse. Move such colour
// into the diffuse slot before converting, or the car comes out as speckled chrome.
const darkImage = async (tex) => {
  try {
    const c = (await sharp(Buffer.from(tex.getImage())).stats()).channels.map((ch) => ch.mean);
    const lum = c.length >= 3 ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : c[0]; // grey images have one channel
    return lum < 14;
  } catch { return false; }
};
for (const mat of root.listMaterials()) {
  const sg = mat.getExtension('KHR_materials_pbrSpecularGlossiness');
  const spec = sg?.getSpecularGlossinessTexture();
  if (!spec) continue;
  const diffTex = sg.getDiffuseTexture();
  const f = sg.getDiffuseFactor();
  const diffDark = diffTex ? await darkImage(diffTex) : 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2] < 0.05;
  if (!diffDark) continue;
  const uv = sg.getSpecularGlossinessTextureInfo().getTexCoord();
  sg.setDiffuseFactor([1, 1, 1, f[3]]);
  sg.setDiffuseTexture(spec);
  sg.getDiffuseTextureInfo().setTexCoord(uv);
  sg.setSpecularGlossinessTexture(null);
  sg.setSpecularFactor([0.04, 0.04, 0.04]);
  sg.setGlossinessFactor(0.6);
}

// Web budget: textures at most 1024 px (a quarter of the video memory of 2048 px, and at
// showroom distance they look the same), and very dense models simplified to about 450k
// triangles with a tight error bound so the silhouette and panel lines don't move.
await MeshoptSimplifier.ready;
const TRI_BUDGET = 450000;
const totalTris = nodes.reduce((a, n) => a + n.tris, 0);
const reduce = totalTris > TRI_BUDGET ? [weld(), simplify({ simplifier: MeshoptSimplifier, ratio: TRI_BUDGET / totalTris, error: 0.0015 })] : [];
await doc.transform(
  metalRough(),
  dedup(),
  ...reduce,
  prune({ keepLeaves: true, keepAttributes: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 86 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
if (reduce.length) {
  let after = 0;
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) { const idx = prim.getIndices(); after += idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3; }
  console.log(`${slug}: simplified ${Math.round(totalTris / 1000)}k -> ${Math.round(after / 1000)}k triangles`);
}
fs.mkdirSync('public/models', { recursive: true });
fs.mkdirSync('tools/reports', { recursive: true });
const out = `public/models/${slug}.glb`;
await io.write(out, doc);
report.bytesOut = fs.statSync(out).size;
fs.writeFileSync(`tools/reports/${slug}.json`, JSON.stringify(report, null, 1));
console.log(`${slug}: ${(before / 1e6).toFixed(1)} MB -> ${(report.bytesOut / 1e6).toFixed(1)} MB, ${nodes.length} nodes, ${report.materials.length} materials`);
