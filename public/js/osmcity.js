// Отрисовка города по реальным данным OSM: дома выдавливаются из настоящих
// контуров, улицы кладутся лентами по осевым линиям, у домов висят таблички
// с названием и адресом.
import * as THREE from 'three';
import { mergeGeometries } from '/vendor/BufferGeometryUtils.js';
import {
  panelFacade, stalinkaFacade, factoryFacade, privateFacade, garageFacade,
  flemishFacade, khrushchevkaFacade, series125Facade, asphalt, groundTex,
  facadeLights, normalFromTexture, labelTexture, signTexture, facadePhoto, poolPhoto,
} from './textures.js';
import { churchDomes } from './models.js';

// Формы кровли из OSM. rise — доля от меньшей стороны дома: настоящий подъём
// в данных почти не проставлен, а по пропорции он выходит правдоподобным.
const ROOF_SHAPES = {
  gabled: { rise: 0.42 },
  hipped: { rise: 0.36 },
  pyramidal: { rise: 0.55 },
  mansard: { rise: 0.3 },
  gambrel: { rise: 0.4 },
  saltbox: { rise: 0.4 },
  dome: { rise: 0.6 },
};
const DEFAULT_ROOF_COLOR = 0x8a4a3a; // некрашеная кровля центра — рыжий шифер

const FACADE_TILE = {
  panel: [6.4, 5.8], tower: [6.4, 5.8], stalinka: [7.2, 7.2], factory: [12, 9],
  private: [6, 5], garage: [4, 3], church: [8, 8], flemish: [5.6, 3.5],
  khrushchevka: [6.5, 5.6], series125: [7, 5.8],
};

function facadeTexture(b) {
  switch (b.kind) {
    case 'panel': case 'tower': return panelFacade(b.color, true);
    case 'stalinka': case 'church': return stalinkaFacade(b.color);
    case 'factory': return factoryFacade(b.color);
    case 'private': return privateFacade(b.color);
    case 'garage': return garageFacade(b.color);
    case 'flemish': return flemishFacade(b.color);
    case 'khrushchevka': return khrushchevkaFacade(b.color, b.brick);
    case 'series125': return series125Facade(b.color, b.accent);
    default: return panelFacade(b.color, true);
  }
}

/** Запекает затенение у земли в цвета вершин. */
function bakeAO(geo, fade = 4.5, floor = 0.68) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.min(1, Math.max(0, pos.getY(i) / fade));
    const shade = floor + (1 - floor) * (k * k * (3 - 2 * k));
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Лента дороги по ломаной: четырёхугольник на каждый сегмент. */
function roadRibbon(points, width) {
  const geos = [];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const g = new THREE.PlaneGeometry(width, len + 0.6);
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.atan2(dx, dz));
    g.translate((ax + bx) / 2, 0, (az + bz) / 2);
    geos.push(g);
  }
  return geos;
}

/**
 * Минимальный по площади охватывающий прямоугольник контура: через него
 * строятся скатные крыши. Перебираем направления рёбер — для домов, где все
 * углы прямые, этого достаточно и работает мгновенно.
 */
function orientedBox(points) {
  let best = null;
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[(i + 1) % points.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
    for (const [x, z] of points) {
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      best = {
        area, ux, uz, minU, maxU, minV, maxV,
        // Центр — обратно в мировые координаты.
        cx: ((minU + maxU) / 2) * ux - ((minV + maxV) / 2) * uz,
        cz: ((minU + maxU) / 2) * uz + ((minV + maxV) / 2) * ux,
        len: maxU - minU,
        width: maxV - minV,
        angle: Math.atan2(ux, uz),
      };
    }
  }
  return best;
}

/** Треугольник в геометрию: крыши строим вручную, форма у каждой своя. */
function tri(out, a, b, c) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function geoFromTris(verts) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(verts);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // Набор атрибутов должен совпадать с плитой кровли: mergeGeometries
  // отказывается сливать геометрии с разным составом.
  const count = pos.length / 3;
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    uv[i * 2] = pos[i * 3] * 0.25;
    uv[i * 2 + 1] = pos[i * 3 + 2] * 0.25;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Скатная крыша по форме из OSM. Двускатную и вальмовую строим над
 * охватывающим прямоугольником — почти вся застройка центра прямоугольная;
 * если контур сложный, прямоугольник врал бы, и мы оставляем плоскую плиту.
 */
function pitchedRoof(poly, shape, baseY, height) {
  const ob = orientedBox(poly);
  if (!ob) return null;
  const fill = polyArea(poly) / (ob.area || 1);

  const verts = [];
  const { cx, cz } = ob;
  let { ux, uz, len, width } = ob;
  // Конёк идёт вдоль длинной стороны дома. Без этого над вытянутым корпусом
  // вырастал бы поперечный шатёр в высоту этажа.
  if (width > len) {
    [ux, uz] = [-uz, ux];
    [len, width] = [width, len];
  }
  // Оси прямоугольника: вдоль конька и поперёк.
  const vx = -uz;
  const vz = ux;
  const hl = len / 2;
  const hw = width / 2;
  const pt = (u, v, y) => [cx + ux * u + vx * v, baseY + y, cz + uz * u + vz * v];

  if (shape === 'pyramidal' || shape === 'dome' || fill < 0.82) {
    // Шатёр строится прямо по контуру, поэтому годится для любой формы.
    const apex = [0, 0];
    for (const [x, z] of poly) { apex[0] += x; apex[1] += z; }
    apex[0] /= poly.length;
    apex[1] /= poly.length;
    const top = [apex[0], baseY + height, apex[1]];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      tri(verts, [a[0], baseY, a[1]], [b[0], baseY, b[1]], top);
    }
    return geoFromTris(verts);
  }

  // Вальмовая крыша: конёк короче основания на вынос скатов с торцов.
  const hipInset = shape === 'hipped' || shape === 'mansard' ? Math.min(hw, hl * 0.5) : 0;
  const ridgeA = pt(-hl + hipInset, 0, height);
  const ridgeB = pt(hl - hipInset, 0, height);
  const c1 = pt(-hl, -hw, 0);
  const c2 = pt(hl, -hw, 0);
  const c3 = pt(hl, hw, 0);
  const c4 = pt(-hl, hw, 0);

  // Два ската.
  tri(verts, c1, c2, ridgeB); tri(verts, c1, ridgeB, ridgeA);
  tri(verts, c3, c4, ridgeA); tri(verts, c3, ridgeA, ridgeB);
  // Торцы: у вальмовой — тоже скаты, у двускатной — вертикальные фронтоны.
  tri(verts, c2, c3, ridgeB);
  tri(verts, c4, c1, ridgeA);
  return geoFromTris(verts);
}

function polyArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(a / 2);
}

/**
 * Заправка: навес на четырёх стойках и две колонки под ним. Само здание
 * кассы остаётся домом, а узнаваемой заправку делает именно навес.
 */
function fuelCanopy(w, d, h) {
  const g = new THREE.Group();
  const canopyW = Math.max(9, Math.min(w * 1.6, 18));
  const canopyD = Math.max(7, Math.min(d * 1.6, 14));
  const top = Math.max(5.4, h + 1.2); // под навесом должна проходить машина

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(canopyW, 0.55, canopyD),
    new THREE.MeshLambertMaterial({ color: 0xe8e6e0 }),
  );
  roof.position.set(0, top, 0);
  roof.castShadow = true;
  g.add(roof);

  // Фирменная полоса по краю навеса — по ней заправка читается издалека.
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(canopyW + 0.12, 0.32, canopyD + 0.12),
    new THREE.MeshLambertMaterial({ color: 0xd23a2a }),
  );
  band.position.set(0, top - 0.32, 0);
  g.add(band);

  const postM = new THREE.MeshLambertMaterial({ color: 0xb9bfc0 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.42, top, 0.42), postM);
      post.position.set(sx * (canopyW / 2 - 0.8), top / 2, sz * (canopyD / 2 - 0.8));
      post.castShadow = true;
      g.add(post);
    }
  }

  const pumpM = new THREE.MeshLambertMaterial({ color: 0xd9d6cc });
  for (const sz of [-1, 1]) {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.7), pumpM);
    pump.position.set(0, 0.95, sz * canopyD * 0.22);
    pump.castShadow = true;
    g.add(pump);
    const island = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.16, 1.4),
      new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }),
    );
    island.position.set(0, 0.08, sz * canopyD * 0.22);
    g.add(island);
  }
  return g;
}

/** Плоский полигон (газон, вода, площадь) из контура. */
function polygonPlane(points, y) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2); // из плоскости XY в XZ
  geo.translate(0, y, 0);
  return geo;
}

export function buildOsmCity(scene, world, quality = 'high') {
  const rich = quality !== 'low';
  const group = new THREE.Group();
  group.name = 'osm-city';
  scene.add(group);

  const size = world.radius * 2.4;

  // --- земля ---------------------------------------------------------------
  const gTex = groundTex();
  gTex.repeat.set(size / 12, size / 12);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size + 600, size + 600),
    new THREE.MeshLambertMaterial({ map: gTex }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // --- зелёные зоны --------------------------------------------------------
  const greenGeos = [];
  for (const area of world.green || []) {
    if (area.p.length < 3) continue;
    try {
      greenGeos.push(polygonPlane(area.p, 0.05));
    } catch { /* самопересекающийся контур — пропускаем */ }
  }
  if (greenGeos.length) {
    const gt = groundTex().clone();
    gt.repeat.set(0.08, 0.08);
    gt.needsUpdate = true;
    const greens = new THREE.Mesh(
      mergeGeometries(greenGeos, false),
      new THREE.MeshLambertMaterial({ map: gt, color: 0x9fb27a, side: THREE.DoubleSide }),
    );
    greens.receiveShadow = true;
    group.add(greens);
    greenGeos.forEach((g) => g.dispose());
  }

  // --- улицы ---------------------------------------------------------------
  const roadGeos = [];
  const pathGeos = [];
  for (const road of world.roads || []) {
    const walk = road.k === 'footway' || road.k === 'pedestrian';
    const geos = roadRibbon(road.p, road.w);
    (walk ? pathGeos : roadGeos).push(...geos);
  }
  const asphaltTex = asphalt(false).clone();
  asphaltTex.repeat.set(0.12, 0.12);
  asphaltTex.needsUpdate = true;
  if (roadGeos.length) {
    const roads = new THREE.Mesh(
      mergeGeometries(roadGeos, false),
      new THREE.MeshLambertMaterial({ map: asphaltTex }),
    );
    roads.position.y = 0.06;
    roads.receiveShadow = true;
    group.add(roads);
    roadGeos.forEach((g) => g.dispose());
  }
  if (pathGeos.length) {
    const paths = new THREE.Mesh(
      mergeGeometries(pathGeos, false),
      new THREE.MeshLambertMaterial({ color: 0xa3a099 }),
    );
    paths.position.y = 0.08;
    paths.receiveShadow = true;
    group.add(paths);
    pathGeos.forEach((g) => g.dispose());
  }

  // --- дома по реальным контурам -------------------------------------------
  const byMaterial = new Map();
  // Кровли группируем по цвету: в OSM он проставлен у полутора сотен домов,
  // и общая серая плита на всех сразу выдавала бы условность.
  const roofsByColor = new Map();
  const pushRoof = (geo, color) => {
    const key = color || 0;
    let bucket = roofsByColor.get(key);
    if (!bucket) roofsByColor.set(key, bucket = []);
    bucket.push(geo);
  };

  for (const b of world.buildings) {
    // Дом, который сфотографировали, получает свой материал: одна фотография
    // на один адрес, делить её с другими домами нельзя.
    // Сначала снимок этого самого дома, потом общий по типу застройки.
    const own = facadePhoto(b.address);
    const photo = own || poolPhoto(b.kind, b.address || `${b.x.toFixed(0)}:${b.z.toFixed(0)}`);
    const key = own ? `photo-${b.address}` : (photo ? `pool-${b.kind}-${photo.uuid}` : `${b.kind}-${b.color}`);
    if (!byMaterial.has(key)) {
      const tex = (photo || facadeTexture(b)).clone();
      // Фотография растягивается на фасад целиком, процедурный тайл — по метрам.
      const tile = photo
        ? [Math.max(b.w, b.d), b.h]
        : (FACADE_TILE[b.kind] || [6.4, 5.8]);
      // Выдавливание нумерует UV в метрах, поэтому масштаб задаём повтором.
      tex.repeat.set(1 / tile[0], 1 / tile[1]);
      tex.needsUpdate = true;
      const lights = facadeLights(b.kind).clone();
      lights.repeat.copy(tex.repeat);
      lights.needsUpdate = true;

      const params = {
        map: tex,
        emissiveMap: lights,
        emissive: new THREE.Color(0x000000),
        vertexColors: true,
      };
      byMaterial.set(key, {
        material: rich
          ? new THREE.MeshStandardMaterial({
            ...params,
            normalMap: normalFromTexture(tex, 1.4) || undefined,
            roughness: 0.92,
            metalness: 0.02,
          })
          : new THREE.MeshLambertMaterial(params),
        geos: [],
      });
    }

    try {
      const shape = new THREE.Shape(b.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: b.h, bevelEnabled: false, curveSegments: 1,
      });
      // Выдавливание идёт по +Z: разворачиваем контур в горизонталь.
      geo.rotateX(-Math.PI / 2);
      bakeAO(geo);
      byMaterial.get(key).geos.push(geo);

      // Плита кровли, чтобы сверху не смотрел фасад.
      const roof = new THREE.Shape(b.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
      const roofGeo = new THREE.ExtrudeGeometry(roof, { depth: 0.35, bevelEnabled: false, curveSegments: 1 });
      roofGeo.rotateX(-Math.PI / 2);
      roofGeo.translate(0, b.h + 0.35, 0);
      pushRoof(roofGeo, b.roofColor);

      // Скатная кровля поверх плиты, если форма известна из OSM.
      const roofShape = ROOF_SHAPES[b.roof];
      if (roofShape) {
        const rise = b.roofLevels
          ? b.roofLevels * 2.6
          : Math.min(6.5, Math.max(1.8, Math.min(b.w, b.d) * roofShape.rise));
        const pitched = pitchedRoof(b.poly, b.roof, b.h + 0.35, rise);
        if (pitched) pushRoof(pitched, b.roofColor || DEFAULT_ROOF_COLOR);
      }
    } catch {
      // Кривой контур из OSM — пропускаем дом, чтобы не ронять сборку.
    }
  }

  for (const { material, geos } of byMaterial.values()) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  for (const [color, geos] of roofsByColor) {
    if (!geos.length) continue;
    const roofs = new THREE.Mesh(
      mergeGeometries(geos, false),
      new THREE.MeshLambertMaterial({ color: color || 0x77746d }),
    );
    roofs.castShadow = true;
    group.add(roofs);
    geos.forEach((g) => g.dispose());
  }

  // --- таблички с названиями и адресами ------------------------------------
  // Именованные здания подписаны постоянно, адреса — пулом ближайших:
  // 600 спрайтов разом съели бы память и кадры.
  const labelGroup = new THREE.Group();
  group.add(labelGroup);

  const named = world.buildings.filter((b) => b.name);
  for (const b of named) {
    const text = b.name.length > 34 ? `${b.name.slice(0, 33)}…` : b.name;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(text, { bg: 'rgba(12,14,18,0.78)', fg: '#ffd98a', size: 40 }),
      depthTest: true,
      transparent: true,
    }));
    sprite.position.set(b.x, b.h + 4, b.z);
    sprite.scale.set(22, 5.5, 1);
    sprite.userData.building = b;
    labelGroup.add(sprite);
  }

  // --- храмы и заправки ----------------------------------------------------
  // По контуру из OSM церковь неотличима от склада, а заправка — от сарая.
  // Тип объекта в данных есть, поэтому дорисовываем то, что делает их
  // узнаваемыми: главы с крестами и навес с колонками.
  for (const b of world.buildings) {
    if (b.kind === 'church' || b.amenity === 'place_of_worship') {
      const size = Math.min(b.w, b.d);
      const domes = churchDomes(Math.min(b.w, 18), Math.min(b.d, 18), b.h);
      const k = THREE.MathUtils.clamp(size / 14, 0.6, 1.6);
      // Масштаб тянет и высоту установки барабанов, поэтому опускаем группу
      // обратно на карниз: иначе главы висят в воздухе над крышей.
      domes.position.set(b.x, b.h * (1 - k), b.z);
      domes.scale.setScalar(k);
      group.add(domes);
    } else if (b.amenity === 'fuel') {
      const station = fuelCanopy(b.w, b.d, b.h);
      // Навес стоит рядом с кассой, а не поверх неё: под ним должны
      // помещаться машины.
      station.position.set(b.x + b.w / 2 + 7, 0, b.z);
      group.add(station);
    }
  }

  // Крышная вывеска на самом высоком доме в центре: заметный ориентир,
  // по которому игрок понимает, где находится, ещё издалека.
  const tall = world.buildings
    .filter((b) => Math.hypot(b.x, b.z) < 500 && b.area > 300)
    .sort((a, b) => b.h - a.h)[0];
  if (tall) {
    const width = Math.min(26, Math.max(12, Math.min(tall.w, tall.d) * 0.9));
    const signGeo = new THREE.PlaneGeometry(width, width / 4);
    const signMat = new THREE.MeshBasicMaterial({
      map: signTexture('Yandex.ru', '#ffdb4d'), toneMapped: false, side: THREE.DoubleSide,
    });
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(tall.x, tall.h + width / 8 + 0.6, tall.z);
    group.add(sign);
    const across = sign.clone();
    across.rotation.y = Math.PI / 2;
    group.add(across);
  }

  const POOL = 14;
  const addressPool = [];
  const withAddress = world.buildings.filter((b) => b.address && !b.name);
  for (let i = 0; i < POOL; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture('', { bg: 'rgba(10,12,16,0.6)', fg: '#e8eef4', size: 34 }),
      transparent: true,
    }));
    sprite.visible = false;
    sprite.scale.set(14, 3.6, 1);
    labelGroup.add(sprite);
    addressPool.push({ sprite, text: '' });
  }

  let refresh = 0;
  return {
    group,
    labelGroup,
    setNight(isNight) {
      for (const { material } of byMaterial.values()) {
        material.emissive.setHex(isNight ? 0xffffff : 0x000000);
        material.emissiveIntensity = isNight ? 0.85 : 0;
        material.needsUpdate = true;
      }
    },
    /** Подписи домов рядом с игроком и масштаб именных табличек. */
    update(dt, camera) {
      refresh -= dt;
      for (const sprite of labelGroup.children) {
        const b = sprite.userData.building;
        if (!b) continue;
        const dist = camera.position.distanceTo(sprite.position);
        sprite.visible = dist < 220;
        const s = THREE.MathUtils.clamp(dist / 40, 0.6, 3.2);
        sprite.scale.set(22 * s, 5.5 * s, 1);
      }
      if (refresh > 0) return;
      refresh = 0.5;

      const near = withAddress
        .map((b) => ({ b, d: Math.hypot(b.x - camera.position.x, b.z - camera.position.z) }))
        .filter((e) => e.d < 90)
        .sort((a, c) => a.d - c.d)
        .slice(0, POOL);

      addressPool.forEach((slot, i) => {
        const entry = near[i];
        if (!entry) {
          slot.sprite.visible = false;
          return;
        }
        const { b, d } = entry;
        if (slot.text !== b.address) {
          slot.sprite.material.map?.dispose();
          slot.sprite.material.map = labelTexture(b.address, {
            bg: 'rgba(10,12,16,0.6)', fg: '#e8eef4', size: 34,
          });
          slot.sprite.material.needsUpdate = true;
          slot.text = b.address;
        }
        slot.sprite.position.set(b.x, b.h + 2.4, b.z);
        const s = THREE.MathUtils.clamp(d / 45, 0.5, 2);
        slot.sprite.scale.set(14 * s, 3.6 * s, 1);
        slot.sprite.visible = true;
      });
    },
  };
}
