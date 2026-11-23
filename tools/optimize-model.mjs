// Compress a downloaded car model for the web and write a report of its parts.
//   node tools/optimize-model.mjs <input .glb or .gltf> <slug>
// Output: public/models/<slug>.glb  (meshopt geometry, WebP textures ≤ 2048 px)
//         tools/reports/<slug>.json (node names, materials, sizes; used to map clickable parts)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
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

await doc.transform(
  dedup(),
  prune({ keepLeaves: true, keepAttributes: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 86 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
fs.mkdirSync('public/models', { recursive: true });
fs.mkdirSync('tools/reports', { recursive: true });
const out = `public/models/${slug}.glb`;
await io.write(out, doc);
report.bytesOut = fs.statSync(out).size;
fs.writeFileSync(`tools/reports/${slug}.json`, JSON.stringify(report, null, 1));
console.log(`${slug}: ${(before / 1e6).toFixed(1)} MB -> ${(report.bytesOut / 1e6).toFixed(1)} MB, ${nodes.length} nodes, ${report.materials.length} materials`);
