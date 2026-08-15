// Copies the three.js ESM build into public/vendor so the browser loads it
// from our own origin (no CDN required, works fully offline).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PP = ['EffectComposer', 'RenderPass', 'ShaderPass', 'MaskPass', 'UnrealBloomPass', 'OutputPass', 'Pass'];
const SHADERS = ['CopyShader', 'LuminosityHighPassShader', 'OutputShader', 'FXAAShader'];

const targets = [
  ['node_modules/three/build/three.module.js', 'public/vendor/three.module.js'],
  ['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'public/vendor/BufferGeometryUtils.js'],
  ...PP.map((n) => [`node_modules/three/examples/jsm/postprocessing/${n}.js`, `public/vendor/postprocessing/${n}.js`]),
  ['node_modules/three/examples/jsm/loaders/GLTFLoader.js', 'public/vendor/loaders/GLTFLoader.js'],
  ['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'public/vendor/utils/BufferGeometryUtils.js'],
  ...SHADERS.map((n) => [`node_modules/three/examples/jsm/shaders/${n}.js`, `public/vendor/shaders/${n}.js`]),
];

for (const dir of ['public/vendor', 'public/vendor/postprocessing', 'public/vendor/shaders', 'public/vendor/loaders', 'public/vendor/utils']) {
  mkdirSync(resolve(root, dir), { recursive: true });
}

for (const [from, to] of targets) {
  const src = resolve(root, from);
  if (!existsSync(src)) {
    console.warn(`[vendor] missing ${from} — run "npm install" first`);
    process.exit(0);
  }
  copyFileSync(src, resolve(root, to));
  console.log(`[vendor] ${from} -> ${to}`);
}
