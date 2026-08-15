// Сборка 3D-города: земля, дороги, тротуары, дома, вывески, дворы.
// Геометрия домов сливается по материалам, мелочь рисуется через InstancedMesh.
import * as THREE from 'three';
import { mergeGeometries } from '/vendor/BufferGeometryUtils.js';
import { CONFIG, roadCenter, snapToRoad } from '/shared/worldgen.js';
import {
  panelFacade, stalinkaFacade, factoryFacade, privateFacade, garageFacade,
  flemishFacade, brickWall, khrushchevkaFacade, series125Facade, odekolonFacade, castleFacade, asphalt, sidewalkTex, groundTex, signTexture,
  facadeLights, normalFromTexture, clockFace,
} from './textures.js';
import { propPrototypes, churchDomes, columns } from './models.js';

const FACADE_TILE = {
  panel: [6.4, 5.8], tower: [6.4, 5.8], stalinka: [7.2, 7.2], factory: [12, 9],
  private: [6, 5], garage: [4, 3], church: [8, 8], admin: [7.2, 7.2], chimney: [8, 8],
  flemish: [5.6, 3.5], kremlinWall: [5, 5], kremlinTower: [5, 5], clockTower: [6, 6],
  khrushchevka: [6.5, 5.6], series125: [7, 5.8], odekolon: [6, 6], antenna: [2, 6],
  castle: [8, 8],
};

function facadeTexture(b) {
  switch (b.kind) {
    case 'panel': case 'tower': return panelFacade(b.color, b.balconies);
    case 'stalinka': case 'admin': case 'church': return stalinkaFacade(b.color);
    case 'factory': case 'chimney': return factoryFacade(b.color);
    case 'private': return privateFacade(b.color);
    case 'garage': return garageFacade(b.color);
    case 'flemish': case 'clockTower': return flemishFacade(b.color);
    case 'khrushchevka': return khrushchevkaFacade(b.color, b.brick);
    case 'series125': return series125Facade(b.color, b.accent);
    case 'kremlinWall': case 'kremlinTower': return brickWall(b.color);
    case 'odekolon': return odekolonFacade(b.color);
    case 'castle': return castleFacade(b.color);
    case 'antenna': return brickWall(0x9aa0a6);
    default: return panelFacade(b.color, false);
  }
}

/**
 * Запекает затенение в цвета вершин: нижние метры стены темнее.
 * В San Andreas свет был запечён в геометрию, и именно это «сажало»
 * дома на землю — динамическая тень такого не даёт.
 */
function bakeGroundAO(geo, fadeHeight = 4, floor = 0.52) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = Math.min(1, Math.max(0, y / fadeHeight));
    const shade = floor + (1 - floor) * (k * k * (3 - 2 * k)); // сглаженная ступенька
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Ступенчатый фламандский фронтон: коробки лесенкой над фасадом. */
function stepGable(b, geos) {
  const steps = b.gableSteps || 4;
  const alongX = b.face === 'z-' || b.face === 'z+';
  const width = alongX ? b.w : b.d;
  const depth = alongX ? b.d : b.w;
  const stepH = 1.1;
  const stepW = (width / 2) / (steps + 0.6);

  for (let i = 0; i <= steps; i++) {
    const w = width - i * stepW * 2;
    if (w < 1.2) break;
    const g = new THREE.BoxGeometry(alongX ? w : depth, stepH, alongX ? depth : w);
    g.translate(b.x, b.h + stepH / 2 + i * stepH, b.z);
    geos.push(bakeGroundAO(g, 0.001));
  }
  // Конёк с флюгером.
  const cap = new THREE.BoxGeometry(1.1, 1.6, 1.1);
  cap.translate(b.x, b.h + steps * stepH + 1.5, b.z);
  geos.push(bakeGroundAO(cap, 0.001));
}

/**
 * Подъезды хрущёвки: бетонный козырёк и ступеньки вдоль длинной стороны.
 * Мелочь, но именно она делает дом жилым, а не коробкой с окнами.
 */
function entrances(b, geos) {
  const count = b.entrances || 4;
  const alongX = b.w > b.d;
  const len = alongX ? b.w : b.d;
  const step = len / count;
  const depth = alongX ? b.d : b.w;

  for (let i = 0; i < count; i++) {
    const offset = -len / 2 + step * (i + 0.5);
    const px = b.x + (alongX ? offset : depth / 2 + 0.55);
    const pz = b.z + (alongX ? depth / 2 + 0.55 : offset);

    const canopy = new THREE.BoxGeometry(alongX ? 2.6 : 1.5, 0.22, alongX ? 1.5 : 2.6);
    canopy.translate(px, 2.75, pz);
    geos.push(canopy);

    const stoop = new THREE.BoxGeometry(alongX ? 2.2 : 1.2, 0.4, alongX ? 1.2 : 2.2);
    stoop.translate(px, 0.2, pz);
    geos.push(stoop);
  }
}

/**
 * Парапеты лоджий серии 125: на фасаде они нарисованы, но без выступающих
 * плит дом остаётся плоской картинкой — тени от них и дают объём.
 */
function loggiaParapets(b, geos) {
  const sections = b.sections || 4;
  const alongX = b.w > b.d;
  const len = alongX ? b.w : b.d;
  const depth = alongX ? b.d : b.w;
  const step = len / sections;
  const floorH = b.h / (b.floors || 9);
  const slabW = step * 0.42;

  for (let s = 0; s < sections; s++) {
    const offset = -len / 2 + step * (s + 0.72);
    for (let f = 1; f < (b.floors || 9); f++) {
      const y = f * floorH + floorH * 0.32;
      // По обе стороны дома: лоджии выходят на оба фасада.
      for (const side of [1, -1]) {
        const g = new THREE.BoxGeometry(
          alongX ? slabW : 0.36,
          floorH * 0.4,
          alongX ? 0.36 : slabW,
        );
        g.translate(
          b.x + (alongX ? offset : side * (depth / 2 + 0.12)),
          y,
          b.z + (alongX ? side * (depth / 2 + 0.12) : offset),
        );
        geos.push(g);
      }
    }
  }
}

/**
 * Круглые башни замка: барабан из камня, синий шатёр и флажок.
 * Возвращает группу — цилиндры не сливаются с коробками фасадов.
 */
function castleTowers(b) {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({
    map: castleFacade(b.color), roughness: 0.9, metalness: 0.02,
  });
  const towerMat = (t) => {
    const m = wallMat.clone();
    m.map = wallMat.map.clone();
    m.map.wrapS = THREE.RepeatWrapping;
    m.map.wrapT = THREE.RepeatWrapping;
    m.map.repeat.set(Math.max(2, Math.round((2 * Math.PI * t.r) / 5)), Math.max(2, Math.round(t.h / 5)));
    m.map.needsUpdate = true;
    return m;
  };
  const roofMat = new THREE.MeshStandardMaterial({
    color: b.roofColor || 0x2e4a6e, roughness: 0.55, metalness: 0.15,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xd8b24a, roughness: 0.4, metalness: 0.6,
  });

  for (const t of b.towers || []) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r, t.h, 12), towerMat(t));
    drum.position.set(b.x + t.dx, t.h / 2, b.z + t.dz);
    drum.castShadow = true;
    drum.receiveShadow = true;
    g.add(drum);

    // Карниз под шатром.
    const cornice = new THREE.Mesh(
      new THREE.CylinderGeometry(t.r * 1.18, t.r * 1.18, 0.5, 12), wallMat,
    );
    cornice.position.set(b.x + t.dx, t.h + 0.2, b.z + t.dz);
    g.add(cornice);

    const spire = new THREE.Mesh(
      new THREE.ConeGeometry(t.r * 1.22, t.spire || t.r * 3, 12), roofMat,
    );
    spire.position.set(b.x + t.dx, t.h + (t.spire || t.r * 3) / 2 + 0.4, b.z + t.dz);
    spire.castShadow = true;
    g.add(spire);

    // Шпиль с флажком на верхушке.
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 6), goldMat);
    pin.position.set(b.x + t.dx, t.h + (t.spire || t.r * 3) + 1.2, b.z + t.dz);
    g.add(pin);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5), new THREE.MeshStandardMaterial({
      color: 0xb03a3a, side: THREE.DoubleSide, roughness: 0.8,
    }));
    flag.position.set(b.x + t.dx + 0.55, t.h + (t.spire || t.r * 3) + 1.7, b.z + t.dz);
    g.add(flag);
  }

  // Зубчатый парапет по верху основного объёма.
  const merlonMat = wallMat;
  const perX = Math.max(3, Math.floor(b.w / 2.4));
  for (let i = 0; i < perX; i++) {
    const x = b.x - b.w / 2 + (b.w / perX) * (i + 0.5);
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w / perX * 0.55, 1.1, 0.5), merlonMat);
      m.position.set(x, b.h + 0.55, b.z + side * (b.d / 2 - 0.25));
      g.add(m);
    }
  }
  return g;
}

/**
 * Кондиционеры, спутниковые тарелки и водосточные трубы на жилых домах.
 * Мелочь, но именно она отличает жилой дом от макета: голый фасад
 * читается как декорация, а с блоками и тарелками — как обитаемый.
 */
function wallClutter(b, boxes, dishes, rng) {
  const floors = b.floors || Math.max(2, Math.round(b.h / 3));
  const floorH = b.h / floors;
  const alongX = b.w > b.d;
  const len = alongX ? b.w : b.d;
  const depth = alongX ? b.d : b.w;
  const count = Math.max(2, Math.floor(len / 7));

  for (let i = 0; i < count; i++) {
    for (const side of [1, -1]) {
      if (rng() < 0.45) continue;
      const along = -len / 2 + len * ((i + 0.5) / count) + (rng() - 0.5) * 2;
      const floor = 1 + Math.floor(rng() * Math.max(1, floors - 2));
      const y = floor * floorH + floorH * 0.55;
      const x = b.x + (alongX ? along : side * (depth / 2 + 0.22));
      const z = b.z + (alongX ? side * (depth / 2 + 0.22) : along);

      if (rng() < 0.65) {
        // Наружный блок кондиционера.
        const g = new THREE.BoxGeometry(alongX ? 0.85 : 0.44, 0.6, alongX ? 0.44 : 0.85);
        g.translate(x, y, z);
        boxes.push(g);
      } else {
        // Тарелка: неглубокая чаша на кронштейне.
        const dish = new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
        dish.rotateX(alongX ? (side > 0 ? Math.PI / 1.7 : -Math.PI / 1.7) : Math.PI / 2);
        if (!alongX) dish.rotateZ(side > 0 ? -Math.PI / 1.7 : Math.PI / 1.7);
        dish.translate(x, y, z);
        dishes.push(dish);
      }
    }
  }

  // Водосточная труба по углу дома.
  const pipe = new THREE.CylinderGeometry(0.1, 0.1, b.h, 6);
  pipe.translate(b.x + b.w / 2 - 0.14, b.h / 2, b.z + b.d / 2 - 0.14);
  boxes.push(pipe);
}

/** Зубцы «ласточкин хвост» поверх кремлёвской стены. */
function crenellations(b, geos, bake = true) {
  const alongX = b.w > b.d;
  const len = alongX ? b.w : b.d;
  const count = Math.max(2, Math.floor(len / 3));
  const step = len / count;
  for (let i = 0; i < count; i++) {
    const offset = -len / 2 + step * (i + 0.5);
    const g = new THREE.BoxGeometry(
      alongX ? step * 0.55 : b.w + 0.2,
      1.7,
      alongX ? b.d + 0.2 : step * 0.55,
    );
    g.translate(
      b.x + (alongX ? offset : 0),
      b.h + 0.85,
      b.z + (alongX ? 0 : offset),
    );
    geos.push(bake ? bakeGroundAO(g, 0.001) : g);
  }
}

/** BoxGeometry с UV, растянутыми под реальный размер стены. */
function facadeBox(w, h, d, tileW, tileH) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const ru = [d / tileW, d / tileW, w / tileW, w / tileW, w / tileW, w / tileW];
  const rv = [h / tileH, h / tileH, d / tileH, d / tileH, h / tileH, h / tileH];
  for (let face = 0; face < 6; face++) {
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      uv.setXY(i, uv.getX(i) * ru[face], uv.getY(i) * rv[face]);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export function buildCity(scene, world, quality = 'high') {
  const rich = quality !== 'low';
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  const { total, origin, road, block, gridSize, pitch } = CONFIG;

  // --- земля ---------------------------------------------------------------
  const gTex = groundTex();
  gTex.repeat.set(total / 12, total / 12);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(total + 400, total + 400),
    new THREE.MeshLambertMaterial({ map: gTex }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // --- дороги --------------------------------------------------------------
  const roadMatX = new THREE.MeshLambertMaterial({ map: asphalt(true).clone() });
  roadMatX.map.repeat.set(road / 8, total / 8);
  roadMatX.map.needsUpdate = true;
  const roadMatZ = new THREE.MeshLambertMaterial({ map: asphalt(true).clone() });
  roadMatZ.map.repeat.set(total / 8, road / 8);
  roadMatZ.map.needsUpdate = true;
  roadMatZ.map.rotation = 0;

  for (let i = 0; i <= gridSize; i++) {
    const x = roadCenter(i);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(road, total), roadMatX);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.02, origin + total / 2);
    strip.receiveShadow = true;
    group.add(strip);

    const z = roadCenter(i);
    const strip2 = new THREE.Mesh(new THREE.PlaneGeometry(total, road), roadMatZ);
    strip2.rotation.x = -Math.PI / 2;
    strip2.position.set(origin + total / 2, 0.025, z);
    strip2.receiveShadow = true;
    group.add(strip2);
  }

  // --- тротуары и дворы ----------------------------------------------------
  const swTex = sidewalkTex();
  swTex.repeat.set(block / 4, block / 4);
  const swMat = new THREE.MeshLambertMaterial({ map: swTex });
  const yardTex = groundTex().clone();
  yardTex.repeat.set(block / 6, block / 6);
  yardTex.needsUpdate = true;
  const yardMat = new THREE.MeshLambertMaterial({ map: yardTex });

  const sidewalkGeos = [];
  const yardGeos = [];
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const x = origin + road + i * pitch + block / 2;
      const z = origin + road + j * pitch + block / 2;
      const slab = new THREE.BoxGeometry(block + road * 0.5, 0.18, block + road * 0.5);
      slab.translate(x, 0.09, z);
      sidewalkGeos.push(slab);

      const yard = new THREE.BoxGeometry(block - 6, 0.06, block - 6);
      yard.translate(x, 0.2, z);
      yardGeos.push(yard);
    }
  }
  const sidewalkMesh = new THREE.Mesh(mergeGeometries(sidewalkGeos, false), swMat);
  sidewalkMesh.receiveShadow = true;
  group.add(sidewalkMesh);
  const yardMesh = new THREE.Mesh(mergeGeometries(yardGeos, false), yardMat);
  yardMesh.receiveShadow = true;
  group.add(yardMesh);

  // --- дома ----------------------------------------------------------------
  const byMaterial = new Map(); // ключ -> {material, geos[]}
  const roofGeos = [];
  const concreteGeos = []; // козырьки подъездов и парапеты лоджий
  const clutterGeos = []; // кондиционеры и трубы
  const dishGeos = [];
  let clutterSeed = 1;
  const clutterRng = () => {
    clutterSeed = (clutterSeed * 1103515245 + 12345) & 0x7fffffff;
    return clutterSeed / 0x7fffffff;
  };
  const tileRoofs = new Map(); // цвет черепицы -> геометрии
  const signMeshes = [];

  for (const b of world.buildings) {
    const key = `${b.kind}-${b.color}`;
    if (!byMaterial.has(key)) {
      const tex = facadeTexture(b).clone();
      tex.needsUpdate = true;
      const lights = facadeLights(b.kind).clone();
      lights.needsUpdate = true;
      const params = {
        map: tex,
        emissiveMap: lights,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 1,
      };
      let material;
      if (rich) {
        const normal = normalFromTexture(tex, b.kind === 'flemish' || b.kind === 'kremlinWall' ? 2.2 : 1.4);
        material = new THREE.MeshStandardMaterial({
          ...params,
          normalMap: normal || undefined,
          normalScale: new THREE.Vector2(0.9, 0.9),
          roughness: 0.92,
          metalness: 0.02,
          vertexColors: true,
        });
      } else {
        material = new THREE.MeshLambertMaterial({ ...params, vertexColors: true });
      }
      byMaterial.set(key, { material, geos: [] });
    }
    const tile = FACADE_TILE[b.kind] || [6.4, 5.8];
    const base = b.y0 || 0;
    const height = b.h - base;
    const geo = facadeBox(b.w, height, b.d, tile[0], tile[1]);
    // AO считаем в локальных координатах, до переноса на место.
    geo.translate(0, height / 2, 0);
    bakeGroundAO(geo, base > 0 ? 0.001 : 4.5);
    geo.translate(b.x, base, b.z);
    const bucket = byMaterial.get(key);
    bucket.geos.push(geo);

    // Фламандский фронтон и кремлёвские зубцы — той же кладкой.
    if (b.kind === 'flemish' && b.gable) stepGable(b, bucket.geos);
    if (b.kind === 'kremlinWall' || b.kind === 'kremlinTower') crenellations(b, bucket.geos);
    if (b.kind === 'khrushchevka') entrances(b, concreteGeos);
    if (b.kind === 'series125') loggiaParapets(b, concreteGeos);
    if (['panel', 'khrushchevka', 'series125', 'tower', 'stalinka'].includes(b.kind) && !b.y0) {
      wallClutter(b, clutterGeos, dishGeos, clutterRng);
    }

    if (b.kind === 'flemish') {
      // Черепичная кровля вместо плоской плиты.
      const rc = b.roofColor || 0x5a4038;
      if (!tileRoofs.has(rc)) tileRoofs.set(rc, []);
      const alongX = b.face === 'z-' || b.face === 'z+';
      const roof = new THREE.BoxGeometry(b.w + 0.5, 0.5, b.d + 0.5);
      roof.translate(b.x, b.h + 0.25, b.z);
      tileRoofs.get(rc).push(roof);
      const ridge = new THREE.CylinderGeometry(
        (alongX ? b.d : b.w) * 0.52, (alongX ? b.d : b.w) * 0.52, alongX ? b.w : b.d, 4, 1,
      );
      ridge.rotateZ(Math.PI / 2);
      if (!alongX) ridge.rotateY(Math.PI / 2);
      ridge.rotateY(alongX ? 0 : 0);
      ridge.translate(b.x, b.h + 1.1, b.z);
      tileRoofs.get(rc).push(ridge);
    } else if (b.kind !== 'kremlinWall') {
      const roof = new THREE.BoxGeometry(b.w + 0.4, 0.4, b.d + 0.4);
      roof.translate(b.x, b.h + 0.2, b.z);
      roofGeos.push(roof);
    }

    // Скатная крыша частного дома.
    if (b.kind === 'private') {
      const gable = new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.78, 2.6, 4);
      gable.rotateY(Math.PI / 4);
      gable.translate(b.x, b.h + 1.5, b.z);
      roofGeos.push(gable);
    }

    // Шатёр кремлёвской башни.
    if (b.kind === 'kremlinTower') {
      const tent = new THREE.ConeGeometry(b.w * 0.85, 7, 4);
      tent.rotateY(Math.PI / 4);
      tent.translate(b.x, b.h + 5.2, b.z);
      if (!tileRoofs.has(0x3f4a52)) tileRoofs.set(0x3f4a52, []);
      tileRoofs.get(0x3f4a52).push(tent);
    }

    // Благовещенская башня: шпиль с флагом и циферблаты.
    if (b.kind === 'clockTower') {
      const tent = new THREE.ConeGeometry(b.w * 0.8, 9, 4);
      tent.rotateY(Math.PI / 4);
      tent.translate(b.x, b.h + 5.5, b.z);
      if (!tileRoofs.has(0x2f5d4a)) tileRoofs.set(0x2f5d4a, []);
      tileRoofs.get(0x2f5d4a).push(tent);

      const spire = new THREE.CylinderGeometry(0.06, 0.16, 5, 6);
      spire.translate(b.x, b.h + 12, b.z);
      tileRoofs.get(0x2f5d4a).push(spire);

      const clockMat = new THREE.MeshBasicMaterial({ map: clockFace(), toneMapped: false });
      for (const [dx, dz, ry] of [[0, b.d / 2 + 0.06, 0], [0, -b.d / 2 - 0.06, Math.PI], [b.w / 2 + 0.06, 0, Math.PI / 2], [-b.w / 2 - 0.06, 0, -Math.PI / 2]]) {
        const face = new THREE.Mesh(new THREE.CircleGeometry(2.1, 20), clockMat);
        face.position.set(b.x + dx, b.h - 4, b.z + dz);
        face.rotation.y = ry;
        group.add(face);
      }
    }

    const f = b.features || {};
    if (b.towers) group.add(castleTowers(b));
    if (b.kind === 'church' || f.domes) {
      const domes = churchDomes(b.w, b.d, b.h);
      if (f.domes) domes.position.set(b.x, 0, b.z);
      group.add(domes);
    }
    if (f.spire) {
      const spireMat = new THREE.MeshStandardMaterial({
        color: f.spireColor || 0x3f5c4a, roughness: 0.5, metalness: 0.3,
      });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.min(b.w, b.d) * 0.42, f.spire, 8), spireMat);
      cone.position.set(b.x, b.h + f.spire / 2, b.z);
      cone.castShadow = true;
      group.add(cone);
      const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, f.spire * 0.35, 6),
        new THREE.MeshStandardMaterial({ color: 0xd8b24a, metalness: 0.7, roughness: 0.35 }),
      );
      pin.position.set(b.x, b.h + f.spire + f.spire * 0.16, b.z);
      group.add(pin);
    }
    if (f.crenels) crenellations(b, concreteGeos, false);
    if (f.glassRoof) {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(Math.min(b.w, b.d) * 0.46, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({
          color: 0x9fc4d6, transparent: true, opacity: 0.62, roughness: 0.2, metalness: 0.5,
        }),
      );
      cap.position.set(b.x, b.h, b.z);
      group.add(cap);
    }
    if (b.kind === 'admin' || f.columns) {
      const col = columns(b.w, b.d, b.h);
      col.position.set(b.x, 0, b.z);
      group.add(col);
    }

    // Вывеска на фасаде, обращённом к ближайшей дороге.
    if (b.sign) {
      const dx = Math.abs(b.x - snapToRoad(b.x));
      const dz = Math.abs(b.z - snapToRoad(b.z));
      const faceZ = dz <= dx;
      const wSign = Math.min((faceZ ? b.w : b.d) * 0.8, 7);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(wSign, wSign * 0.22),
        new THREE.MeshBasicMaterial({
          map: signTexture(b.sign, b.kind === 'factory' ? '#3a4a5a' : '#c1272d'),
          toneMapped: false,
        }),
      );
      const y = Math.min(b.h - 1, b.kind === 'stalinka' ? 4.4 : 3.4);
      if (faceZ) {
        const side = Math.sign(snapToRoad(b.z) - b.z) || 1;
        plane.position.set(b.x, y, b.z + side * (b.d / 2 + 0.08));
        plane.rotation.y = side > 0 ? 0 : Math.PI;
      } else {
        const side = Math.sign(snapToRoad(b.x) - b.x) || 1;
        plane.position.set(b.x + side * (b.w / 2 + 0.08), y, b.z);
        plane.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      signMeshes.push(plane);
      group.add(plane);
    }
  }

  for (const { material, geos } of byMaterial.values()) {
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  const roofMesh = new THREE.Mesh(
    mergeGeometries(roofGeos, false),
    new THREE.MeshLambertMaterial({ color: 0x4a4a48 }),
  );
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  group.add(roofMesh);

  if (clutterGeos.length) {
    const clutter = new THREE.Mesh(
      mergeGeometries(clutterGeos, false),
      new THREE.MeshLambertMaterial({ color: 0xd6d4cd }),
    );
    clutter.castShadow = true;
    group.add(clutter);
    clutterGeos.forEach((g) => g.dispose());
  }
  if (dishGeos.length) {
    const dishes = new THREE.Mesh(
      mergeGeometries(dishGeos, false),
      new THREE.MeshLambertMaterial({ color: 0xe6e4dc, side: THREE.DoubleSide }),
    );
    group.add(dishes);
    dishGeos.forEach((g) => g.dispose());
  }

  if (concreteGeos.length) {
    const concrete = new THREE.Mesh(
      mergeGeometries(concreteGeos, false),
      rich
        ? new THREE.MeshStandardMaterial({ color: 0xb7b4ab, roughness: 0.95, metalness: 0.02 })
        : new THREE.MeshLambertMaterial({ color: 0xb7b4ab }),
    );
    concrete.castShadow = true;
    concrete.receiveShadow = true;
    group.add(concrete);
    concreteGeos.forEach((g) => g.dispose());
  }

  // Черепица и шатры — свой цвет на каждую группу.
  for (const [color, geos] of tileRoofs) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(
      mergeGeometries(geos, false),
      rich
        ? new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 })
        : new THREE.MeshLambertMaterial({ color }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.forEach((g) => g.dispose());
  }

  // --- уличная мелочь через инстансы --------------------------------------
  const protos = propPrototypes();
  const byType = new Map();
  for (const p of world.props) {
    if (!byType.has(p.type)) byType.set(p.type, []);
    byType.get(p.type).push(p);
  }

  const dummy = new THREE.Object3D();
  const lampMeshes = [];
  for (const [type, list] of byType) {
    const proto = protos[type];
    if (!proto) continue;
    for (let partIndex = 0; partIndex < proto.length; partIndex++) {
      const part = proto[partIndex];
      const inst = new THREE.InstancedMesh(part.geo, part.mat, list.length);
      inst.castShadow = type !== 'fence';
      inst.receiveShadow = false;
      inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      for (let k = 0; k < list.length; k++) {
        const p = list[k];
        dummy.position.set(p.x, 0.18, p.z);
        dummy.rotation.set(0, p.rot || 0, 0);
        const s = p.scale || 1;
        dummy.scale.set(s, type === 'fence' ? 1 : s, type === 'fence' ? 1 : s);
        dummy.updateMatrix();
        // Смещение части внутри прототипа с учётом поворота.
        const off = new THREE.Vector3(...part.offset);
        off.applyEuler(dummy.rotation);
        off.multiplyScalar(1);
        const sy = type === 'fence' ? 1 : s;
        dummy.position.add(new THREE.Vector3(off.x * s, off.y * sy, off.z * sy));
        dummy.updateMatrix();
        inst.setMatrixAt(k, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = true;
      group.add(inst);
      if (type === 'lamp' && partIndex === 2) lampMeshes.push(inst);
    }
  }

  // Бордюры вдоль дорог для читаемости геометрии улиц.
  const curbGeos = [];
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const x = origin + road + i * pitch + block / 2;
      const z = origin + road + j * pitch + block / 2;
      const half = (block + road * 0.5) / 2;
      for (const [ox, oz, w, d] of [
        [0, -half, block + road * 0.5, 0.35],
        [0, half, block + road * 0.5, 0.35],
        [-half, 0, 0.35, block + road * 0.5],
        [half, 0, 0.35, block + road * 0.5],
      ]) {
        const g = new THREE.BoxGeometry(w, 0.26, d);
        g.translate(x + ox, 0.2, z + oz);
        curbGeos.push(g);
      }
    }
  }
  const curbs = new THREE.Mesh(
    mergeGeometries(curbGeos, false),
    new THREE.MeshLambertMaterial({ color: 0xb9b6ad }),
  );
  group.add(curbs);

  // --- дорожная разметка ---------------------------------------------------
  // Зебры и стоп-линии рисуются отдельными плитами поверх асфальта: без них
  // перекрёсток читается как пустое пятно, а с ними улица выглядит живой.
  const paintGeos = [];
  const stripe = (x, z, w, d) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.035, z);
    paintGeos.push(g);
  };

  for (let i = 0; i <= gridSize; i++) {
    for (let j = 0; j <= gridSize; j++) {
      const cx = roadCenter(i);
      const cz = roadCenter(j);
      const half = road / 2;
      const bandOuter = half + 2.6; // зебра лежит за краем перекрёстка
      const bars = 6;

      // Переходы поперёк дороги с каждой стороны перекрёстка.
      for (const sign of [1, -1]) {
        for (let b = 0; b < bars; b++) {
          const off = -half + 1.4 + ((road - 2.8) / (bars - 1)) * b;
          // Зебра поперёк вертикальной дороги.
          stripe(cx + off, cz + sign * bandOuter, 0.85, 3.2);
          // Зебра поперёк горизонтальной дороги.
          stripe(cx + sign * bandOuter, cz + off, 3.2, 0.85);
        }
        // Стоп-линии перед зебрами.
        stripe(cx - sign * (half / 2), cz + sign * (bandOuter + 2.6), half - 1, 0.6);
        stripe(cx + sign * (bandOuter + 2.6), cz + sign * (half / 2), 0.6, half - 1);
      }
    }
  }

  const paint = new THREE.Mesh(
    mergeGeometries(paintGeos, false),
    new THREE.MeshLambertMaterial({
      color: 0xe8e4d6, transparent: true, opacity: 0.78, depthWrite: false,
    }),
  );
  paint.receiveShadow = false;
  paint.renderOrder = 1;
  group.add(paint);
  paintGeos.forEach((g) => g.dispose());

  // Световые пятна под фонарями — включаются ночью.
  const lampList = byType.get('lamp') || [];
  const poolGeo = new THREE.CircleGeometry(4.6, 14);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xffdc9a, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, Math.max(1, lampList.length));
  pools.visible = false;
  for (let k = 0; k < lampList.length; k++) {
    const p = lampList[k];
    dummy.position.set(p.x + Math.sin(p.rot || 0) * 1.2, 0.24, p.z + Math.cos(p.rot || 0) * 1.2);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    pools.setMatrixAt(k, dummy.matrix);
  }
  pools.instanceMatrix.needsUpdate = true;
  group.add(pools);

  const buildingMaterials = [...byMaterial.values()].map((v) => v.material);
  let nightState = null;

  return {
    group,
    lampMeshes,
    signMeshes,
    /** Ночью зажигаем окна, фонари и световые пятна. */
    setNight(isNight) {
      if (nightState === isNight) return;
      nightState = isNight;
      for (const m of lampMeshes) m.material.color.setHex(isNight ? 0xffe9b0 : 0x9a978a);
      for (const m of buildingMaterials) {
        m.emissive.setHex(isNight ? 0xffffff : 0x000000);
        m.emissiveIntensity = isNight ? 0.85 : 0;
        m.needsUpdate = true;
      }
      pools.visible = isNight;
    },
  };
}
