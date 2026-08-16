// Отрисовка города по реальным данным OSM: дома выдавливаются из настоящих
// контуров, улицы кладутся лентами по осевым линиям, у домов висят таблички
// с названием и адресом.
import * as THREE from 'three';
import { mergeGeometries } from '/vendor/BufferGeometryUtils.js';
import {
  panelFacade, stalinkaFacade, factoryFacade, privateFacade, garageFacade,
  flemishFacade, khrushchevkaFacade, series125Facade, asphalt, groundTex,
  facadeLights, normalFromTexture, labelTexture,
} from './textures.js';

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
function bakeAO(geo, fade = 4.5, floor = 0.55) {
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
  const roofGeos = [];

  for (const b of world.buildings) {
    const key = `${b.kind}-${b.color}`;
    if (!byMaterial.has(key)) {
      const tex = facadeTexture(b).clone();
      const tile = FACADE_TILE[b.kind] || [6.4, 5.8];
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
      roofGeos.push(roofGeo);
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
  if (roofGeos.length) {
    const roofs = new THREE.Mesh(
      mergeGeometries(roofGeos, false),
      new THREE.MeshLambertMaterial({ color: 0x4a4a48 }),
    );
    roofs.castShadow = true;
    group.add(roofs);
    roofGeos.forEach((g) => g.dispose());
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
