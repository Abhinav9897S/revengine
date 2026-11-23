// Finds the car models you downloaded from Sketchfab (in your Downloads folder),
// compresses each into public/models/<slug>.glb and updates public/models/manifest.json.
//   npm run models                 (looks in ~/Downloads, skips cars already imported)
//   npm run models -- <folder>     (look somewhere else)
//   npm run models -- --force      (re-import everything)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REAL_MODELS } from '../src/data/realModels.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const dir = args.find((a) => !a.startsWith('--')) || path.join(os.homedir(), 'Downloads');
// Windows' own tar (bsdtar) can unzip; Git Bash's GNU tar cannot
const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const tar = fs.existsSync(winTar) ? winTar : 'tar';

const findInside = (folder) => {
  const stack = [folder];
  let gltf = null;
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.glb$/i.test(e.name)) return p;
      else if (/\.gltf$/i.test(e.name)) gltf = p;
    }
  }
  return gltf;
};

const entries = fs.readdirSync(dir, { withFileTypes: true })
  .filter((e) => (e.isFile() && /\.(glb|gltf|zip)$/i.test(e.name)) || e.isDirectory())
  .map((e) => ({ f: e.name, dir: e.isDirectory(), full: path.join(dir, e.name), t: fs.statSync(path.join(dir, e.name)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

let done = 0;
const failed = [];
for (const [slug, cfg] of Object.entries(REAL_MODELS)) {
  const hit = entries.find(({ f, dir: isDir }) => cfg.match.test(f.replace(/[_-]+/g, ' ')) && (!isDir || findInside(path.join(dir, f))));
  if (!hit) { console.log(`- ${slug}: not found`); continue; }
  const out = `public/models/${slug}.glb`;
  if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs > hit.t) { console.log(`= ${slug}: already imported`); continue; }
  try {
    let input = hit.full;
    if (hit.dir) input = findInside(hit.full);
    else if (/\.zip$/i.test(hit.f)) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `revengine-${slug}-`));
      execFileSync(tar, ['-xf', hit.full, '-C', tmp]);
      input = findInside(tmp);
    }
    if (!input) throw new Error(`no .glb/.gltf inside ${hit.f}`);
    console.log(`> ${slug} <- ${hit.f}`);
    execFileSync(process.execPath, ['tools/optimize-model.mjs', input, slug], { stdio: 'inherit' });
    done++;
  } catch (err) {
    console.log(`! ${slug}: ${err.message.split('\n')[0]}`);
    failed.push(slug);
  }
}

const have = Object.keys(REAL_MODELS).filter((s) => fs.existsSync(`public/models/${s}.glb`));
fs.mkdirSync('public/models', { recursive: true });
fs.writeFileSync('public/models/manifest.json', JSON.stringify({ models: have, updated: new Date().toISOString() }, null, 1));
console.log(`\nImported ${done} model(s)${failed.length ? `, failed: ${failed.join(', ')}` : ''}. Real models available: ${have.length}/10 (${have.join(', ') || 'none'})`);
