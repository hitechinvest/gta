// Copies the three.js ESM build into public/vendor so the browser loads it
// from our own origin (no CDN required, works fully offline).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  ['node_modules/three/build/three.module.js', 'public/vendor/three.module.js'],
  ['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'public/vendor/BufferGeometryUtils.js'],
];

mkdirSync(resolve(root, 'public/vendor'), { recursive: true });

for (const [from, to] of targets) {
  const src = resolve(root, from);
  if (!existsSync(src)) {
    console.warn(`[vendor] missing ${from} — run "npm install" first`);
    process.exit(0);
  }
  copyFileSync(src, resolve(root, to));
  console.log(`[vendor] ${from} -> ${to}`);
}
