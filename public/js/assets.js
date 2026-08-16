// Загрузка внешних моделей в формате glTF/GLB.
//
// Игра полностью работает без единого файла: если моделей нет, всё рисуется
// процедурно, как и раньше. Но стоит положить .glb в public/models и описать
// его в public/models/manifest.json — движок подхватит модель и её анимации.
//
// Формат манифеста:
// {
//   "characters": { "ped": { "url": "ped.glb", "scale": 1, "yaw": 0,
//                            "clips": { "idle": "Idle", "walk": "Walk",
//                                       "run": "Run", "aim": "Aim" } } },
//   "vehicles":   { "zhiguli": { "url": "vaz2106.glb", "scale": 1, "yaw": 3.14159 } },
//   "props":      { "bench": { "url": "bench.glb", "scale": 1 } }
// }
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/loaders/GLTFLoader.js';

class AssetLibrary {
  constructor() {
    this.loader = new GLTFLoader();
    this.manifest = null;
    this.cache = new Map(); // url -> Promise<GLTF>
    this.ready = false;
  }

  /** Читает манифест. Его отсутствие — не ошибка, а штатный режим. */
  async init(basePath = '/models/') {
    this.base = basePath;
    try {
      const res = await fetch(`${basePath}manifest.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      this.manifest = await res.json();
      const n = Object.values(this.manifest).reduce(
        (sum, group) => sum + Object.keys(group || {}).length, 0,
      );
      console.info(`[assets] манифест найден: ${n} моделей`);
    } catch {
      this.manifest = null;
      console.info('[assets] моделей нет — рисуем процедурно');
    }
    this.ready = true;
    return this.manifest;
  }

  entry(group, id) {
    return this.manifest?.[group]?.[id] || null;
  }

  has(group, id) {
    return !!this.entry(group, id);
  }

  load(url) {
    if (!this.cache.has(url)) {
      this.cache.set(url, new Promise((resolve, reject) => {
        this.loader.load(url, resolve, undefined, reject);
      }));
    }
    return this.cache.get(url);
  }

  /**
   * Готовая модель: клон сцены (чтобы экземпляры не делили трансформации),
   * плюс микшер и клипы, если в файле есть анимации.
   */
  async instance(group, id) {
    const entry = this.entry(group, id);
    if (!entry) return null;
    let gltf;
    try {
      gltf = await this.load(`${this.base}${entry.url}`);
    } catch (err) {
      console.warn(`[assets] не загрузилась ${entry.url}:`, err.message || err);
      return null;
    }

    const root = new THREE.Group();
    const model = clone(gltf.scene);
    const scale = entry.scale || 1;
    model.scale.setScalar(scale);
    model.rotation.y = entry.yaw || 0;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = true;
      }
    });
    root.add(model);

    // Анимации могут лежать отдельным файлом: все персонажи набора сидят на
    // одном скелете, и держать по копии клипов в каждой модели — впустую
    // гонять мегабайты.
    let clips = gltf.animations || [];
    if (entry.anim) {
      try {
        const lib = await this.load(`${this.base}${entry.anim}`);
        if (lib.animations?.length) clips = lib.animations;
      } catch (err) {
        console.warn(`[assets] не загрузились анимации ${entry.anim}:`, err.message || err);
      }
    }

    let mixer = null;
    const actions = {};
    if (clips.length) {
      mixer = new THREE.AnimationMixer(model);
      const byName = new Map(clips.map((c) => [c.name, c]));
      const wanted = entry.clips || {};
      for (const [state, clipName] of Object.entries(wanted)) {
        // Имя клипа ищем и целиком, и по хвосту: у выгрузок FBX оно обычно
        // склеено с именем скелета через вертикальную черту.
        const clip = byName.get(clipName) || clips.find((c) => c.name.endsWith(clipName));
        if (clip) actions[state] = mixer.clipAction(clip);
      }
      // Если клипы не описаны, берём первый — лучше, чем застывшая поза.
      if (!Object.keys(actions).length) actions.idle = mixer.clipAction(clips[0]);
    }

    return { root, model, mixer, actions, entry };
  }
}

/**
 * Клон иерархии с поддержкой скиннинга: THREE.Object3D.clone() ломает
 * привязку костей, поэтому SkinnedMesh переносим со ссылкой на новый скелет.
 */
function clone(source) {
  const cloneLookup = new Map();
  const clonedRoot = source.clone(true);

  const srcNodes = [];
  const dstNodes = [];
  source.traverse((n) => srcNodes.push(n));
  clonedRoot.traverse((n) => dstNodes.push(n));
  for (let i = 0; i < srcNodes.length; i++) cloneLookup.set(srcNodes[i], dstNodes[i]);

  source.traverse((srcNode) => {
    if (!srcNode.isSkinnedMesh) return;
    const dstMesh = cloneLookup.get(srcNode);
    const srcBones = srcNode.skeleton.bones;
    dstMesh.skeleton = srcNode.skeleton.clone();
    dstMesh.skeleton.bones = srcBones.map((b) => cloneLookup.get(b) || b);
    dstMesh.bind(dstMesh.skeleton, srcNode.bindMatrix);
  });

  return clonedRoot;
}

export const assets = new AssetLibrary();
export { clone as cloneSkinned };
