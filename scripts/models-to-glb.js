// Перегон исходных моделей (FBX со скелетом, OBJ с материалами) в GLB на
// этапе сборки: в игру попадает только glTF, чтобы в браузере жил один
// загрузчик и не тратилось время на разбор чужих форматов.
//
//   node scripts/models-to-glb.js <файл|каталог> <каталог-назначения> [флаги]
//
//   --clips Walk,Run,Idle   оставить только эти анимации (по подстроке)
//   --height 1.8            привести рост персонажа к метрам, ступни на ноль
//   --strip-anim            выкинуть анимации совсем (меши отдельно)
//   --only-anim             сохранить только анимации, без мешей
//
// Все персонажи Quaternius сидят на одном скелете, поэтому клипы выгодно
// хранить одним файлом и надевать на любую модель.
//
// Загрузчики и экспортёр three рассчитаны на браузер, поэтому подставляем
// минимальные заглушки DOM: моделям без текстур ничего больше не нужно.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve, dirname } from 'node:path';

globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = {
  createElementNS: () => ({ style: {} }),
  createElement: () => ({ style: {}, getContext: () => null }),
};
globalThis.URL.createObjectURL = () => '';
globalThis.URL.revokeObjectURL = () => {};
// Экспортёр складывает GLB через Blob и FileReader — в Node есть первый,
// но нет второго.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.();
      this.onload?.();
    });
  }
};

const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const src = resolve(args[0] || '.');
const dst = resolve(args[1] || '.');
const keep = (value('clips') || '').split(',').filter(Boolean);
mkdirSync(dst, { recursive: true });

const SUPPORTED = ['.fbx', '.obj'];
const files = statSync(src).isDirectory()
  ? readdirSync(src).filter((f) => SUPPORTED.includes(extname(f).toLowerCase())).map((f) => join(src, f))
  : [src];

/** OBJ красится материалами из MTL: без них модель выходит белой. */
function loadObj(file) {
  const objLoader = new OBJLoader();
  const mtlFile = file.replace(/\.obj$/i, '.mtl');
  try {
    const mtl = new MTLLoader().parse(readFileSync(mtlFile, 'utf8'), dirname(file));
    mtl.preload();
    objLoader.setMaterials(mtl);
  } catch { /* без .mtl — оставляем материал по умолчанию */ }
  return objLoader.parse(readFileSync(file, 'utf8'));
}

/**
 * Экспортёр ругается на MeshPhong из OBJ и FBX: переводим всё в Standard,
 * чтобы материалы доехали до glTF без потерь.
 */
function toStandard(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const converted = list.map((m) => {
      if (m.isMeshStandardMaterial) return m;
      const std = new THREE.MeshStandardMaterial({
        name: m.name,
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        map: m.map || null,
        roughness: m.shininess != null ? Math.max(0.2, 1 - m.shininess / 200) : 0.75,
        metalness: 0.02,
        transparent: m.transparent,
        opacity: m.opacity,
        side: m.side,
      });
      return std;
    });
    o.material = Array.isArray(o.material) ? converted : converted[0];
  });
}

/**
 * Склеивает куски геометрии с одинаковым материалом. В исходных FBX их до
 * полутора сотен на персонажа, и каждый становится отдельным вызовом
 * отрисовки — на шестнадцати прохожих это тысячи вызовов на кадр.
 */
function mergeGroups(root) {
  root.traverse((o) => {
    let geo = o.geometry;
    if (!o.isMesh || !geo || geo.groups.length < 2) return;

    // Исходники не индексированы: каждая вершина повторяется трижды.
    // Склейка совпадающих вершин режет файл персонажа вдвое, а порядок
    // треугольников сохраняется, поэтому границы групп остаются верными.
    const groupsBefore = geo.groups.map((g) => ({ ...g }));
    const merged = mergeVertices(geo, 1e-4);
    merged.groups = groupsBefore;
    o.geometry = merged;
    geo = merged;

    const index = geo.getIndex();
    const byMaterial = new Map();
    for (const g of geo.groups) {
      let arr = byMaterial.get(g.materialIndex);
      if (!arr) byMaterial.set(g.materialIndex, arr = []);
      for (let i = g.start; i < g.start + g.count; i++) arr.push(index ? index.getX(i) : i);
    }
    const flat = [];
    const groups = [];
    for (const [materialIndex, arr] of byMaterial) {
      groups.push({ start: flat.length, count: arr.length, materialIndex });
      for (const v of arr) flat.push(v);
    }
    geo.setIndex(flat);
    geo.clearGroups();
    for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
  });
}

/**
 * Переносит точку вращения колеса в его центр. В OBJ опорных точек нет
 * вообще, поэтому колесо крутилось бы вокруг центра машины и улетало над
 * крышей. Делаем это при конвертации: в игре геометрия общая для всех
 * экземпляров, и править её там уже нельзя.
 */
function centerWheelPivots(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !/wheel/i.test(o.name || '')) return;
    o.geometry.computeBoundingBox();
    const c = o.geometry.boundingBox.getCenter(new THREE.Vector3());
    o.geometry.translate(-c.x, -c.y, -c.z);
    o.position.add(c);
  });
}

/**
 * Приводит рост персонажа к игровому и ставит ступни на ноль. Меряем по
 * костям, а не по габариту меша: у скиннед-меша габарит считается в позе
 * привязки и у выгрузок FBX врёт на порядки.
 */
function normalizeCharacter(root, targetHeight) {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  let bones = 0;
  root.traverse((o) => {
    if (!o.isBone) return;
    o.getWorldPosition(v);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
    bones += 1;
  });
  if (!bones || maxY - minY < 1e-6) return null;

  // Верхняя кость сидит в основании черепа, макушка выше примерно на десятую.
  const scale = targetHeight / ((maxY - minY) * 1.1);
  root.scale.multiplyScalar(scale);
  root.position.y -= minY * scale;
  return { bones, scale, height: (maxY - minY) * scale };
}

const exporter = new GLTFExporter();

for (const file of files) {
  const name = basename(file, extname(file));
  let root;
  let clips = [];

  if (extname(file).toLowerCase() === '.fbx') {
    const buffer = readFileSync(file);
    root = new FBXLoader().parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '',
    );
    clips = root.animations || [];
  } else {
    root = loadObj(file);
  }
  toStandard(root);
  mergeGroups(root);
  centerWheelPivots(root);
  const height = parseFloat(value('height'));
  const norm = Number.isFinite(height) ? normalizeCharacter(root, height) : null;

  if (keep.length) clips = clips.filter((c) => keep.some((k) => c.name.toLowerCase().includes(k.toLowerCase())));
  if (flag('strip-anim')) clips = [];
  if (flag('only-anim')) {
    // Сцена без мешей: остаётся только скелет, на который лягут клипы.
    root.traverse((o) => { if (o.isMesh) o.visible = false; });
    for (const mesh of [...root.children]) if (mesh.isMesh) root.remove(mesh);
  }
  root.animations = clips;

  const glb = await new Promise((ok, fail) => {
    exporter.parse(root, ok, fail, { binary: true, animations: clips, onlyVisible: false });
  });
  const out = join(dst, `${name}.glb`);
  writeFileSync(out, Buffer.from(glb));
  const grown = norm ? `, рост ${norm.height.toFixed(2)} м` : '';
  console.log(`[glb] ${basename(file)} -> ${basename(out)} (${(glb.byteLength / 1024).toFixed(0)} КБ, клипов: ${clips.length}${grown})`);
}
