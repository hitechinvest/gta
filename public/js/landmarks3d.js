// Узнаваемые ориентиры реального центра поверх контуров OSM.
//
// В данных у кремля, соборов и башен есть настоящий контур и имя, но нет ни
// шатров, ни зубцов, ни высоты башен: по одному контуру Благовещенская башня
// неотличима от трансформаторной будки. Поэтому здание, узнанное по имени
// или по попаданию внутрь контура кремля, получает свой фасад и надстройки.
//
// Высоты башен в OSM не проставлены, берём известные: Благовещенская — 55 м
// со шпилем, Спасская — вдвое ниже.
import * as THREE from 'three';
import { mergeGeometries } from '/vendor/BufferGeometryUtils.js';
import { clockFace } from './textures.js';

const BRICK = 0xa8503a;
const WHITE = 0xf2ece0;
const ROOF_GREEN = 0x2f5c4a;

/** Правила по имени здания. Первое подошедшее и применяется. */
const RULES = [
  {
    re: /Благовещенская башня/i,
    style: { facade: 'brick', color: BRICK, height: 55, tent: 14, clock: true, spire: 9 },
  },
  {
    re: /Спасская башня/i,
    style: { facade: 'brick', color: BRICK, height: 27, tent: 8, clock: true, spire: 5 },
  },
  {
    re: /театр кукол/i,
    style: { facade: 'castle', color: 0xe6d8b8, turrets: true, crenels: true },
  },
  {
    // Соборы и часовни: белёные стены вместо кирпичной хрущёвки.
    re: /^(собор|церковь|храм|часовня)/i,
    style: { facade: 'castle', color: WHITE },
  },
];

// Фламандский квартал: три улицы застроены домами с уступчатыми фронтонами,
// это и есть та самая набережная Брюгге.
const FLEMISH_STREETS = /набережная Брюгге|Воскресенская набережная|Воскресенский проспект/i;

function bbox(poly) {
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ, w: maxX - minX, d: maxZ - minZ };
}

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Стиль ориентира для здания: по имени, по улице или по попаданию внутрь
 * крепостного контура. Возвращает null для обычной застройки.
 */
export function landmarkStyle(b, sights) {
  for (const rule of RULES) {
    if (b.name && rule.re.test(b.name)) return rule.style;
  }
  // Безымянные часовни в данных тоже помечены культовыми: белим и их,
  // иначе часовня стоит кирпичной хрущёвкой с окнами в пол.
  if (b.kind === 'church' || b.amenity === 'place_of_worship') {
    return { facade: 'castle', color: WHITE };
  }
  for (const s of sights || []) {
    if (s.k !== 'castle' || !pointInPoly(b.x, b.z, s.p)) continue;
    // Внутри кремля круглые башни отличаются от прясел стен: они компактные
    // и многоугольные, поэтому им ставим шатёр, а стенам — зубцы.
    const box = bbox(b.poly);
    const tower = Math.max(box.w, box.d) < 20 && b.poly.length > 5;
    return tower
      ? { facade: 'brick', color: BRICK, height: Math.max(b.h, 14), tent: 6 }
      // Кровля прясла — тёс по кирпичу, а не зелёная жесть жилого дома.
      : { facade: 'brick', color: BRICK, crenels: true, roofColor: 0x6b3a2a };
  }
  if (b.address && FLEMISH_STREETS.test(b.address) && b.h < 20) {
    return { facade: 'flemish', gable: true };
  }
  return null;
}

/** Зубцы по контуру стены: коробочки через равные промежутки. */
function crenels(poly, y) {
  const geos = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 2) continue;
    const step = 2.4;
    const count = Math.floor(len / step);
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count;
      const g = new THREE.BoxGeometry(1.2, 1.3, 0.7);
      g.rotateY(Math.atan2(dx, dz));
      g.translate(ax + dx * t, y + 0.65, az + dz * t);
      geos.push(g);
    }
  }
  return geos;
}

/** Шатёр: четырёхгранная пирамида по габаритам контура. */
function tent(box, baseY, height, color) {
  const r = Math.max(box.w, box.d) * 0.62;
  const geo = new THREE.ConeGeometry(r, height, 4);
  geo.rotateY(Math.PI / 4);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  mesh.position.set((box.minX + box.maxX) / 2, baseY + height / 2, (box.minZ + box.maxZ) / 2);
  mesh.castShadow = true;
  return mesh;
}

/** Циферблаты на все четыре стороны башни. */
function clocks(box, y) {
  const g = new THREE.Group();
  const size = Math.min(box.w, box.d) * 0.55;
  const mat = new THREE.MeshBasicMaterial({ map: clockFace(), toneMapped: false });
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const sides = [
    [0, box.d / 2 + 0.15, 0],
    [0, -box.d / 2 - 0.15, Math.PI],
    [box.w / 2 + 0.15, 0, Math.PI / 2],
    [-box.w / 2 - 0.15, 0, -Math.PI / 2],
  ];
  for (const [dx, dz, rot] of sides) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    face.position.set(cx + dx, y, cz + dz);
    face.rotation.y = rot;
    g.add(face);
  }
  return g;
}

/** Угловые башенки с коническими крышами — замок театра кукол. */
function turrets(box, height) {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xe6d8b8 });
  const roofMat = new THREE.MeshLambertMaterial({ color: ROOF_GREEN });
  const r = Math.min(6, Math.max(3, Math.min(box.w, box.d) * 0.1));
  const corners = [
    [box.minX + r, box.minZ + r], [box.maxX - r, box.minZ + r],
    [box.minX + r, box.maxZ - r], [box.maxX - r, box.maxZ - r],
  ];
  for (const [x, z] of corners) {
    // Башенка чуть выше карниза. Высоту дома берём с потолком: у театра
    // кукол секции разной этажности, и по самой высокой башни выходили
    // втрое выше самого замка.
    const h = Math.min(height, 16) + 6;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), wallMat);
    body.position.set(x, h / 2, z);
    body.castShadow = true;
    g.add(body);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 1.15, r * 2.2, 12), roofMat);
    cone.position.set(x, h + r * 1.1, z);
    cone.castShadow = true;
    g.add(cone);
  }
  return g;
}

/**
 * Уступчатые фронтоны фламандского дома. Контуры на набережной длинные —
 * это сросшийся ряд домов, поэтому ставим фронтон каждые двенадцать метров
 * вдоль обеих длинных сторон: именно этот пилообразный силуэт и делает
 * набережную похожей на Брюгге.
 */
function stepGables(box, height, color) {
  const geos = [];
  const along = box.w >= box.d;
  const length = along ? box.w : box.d;
  const bays = Math.max(1, Math.round(length / 12));
  const bay = length / bays;
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  for (let i = 0; i < bays; i++) {
    const offset = -length / 2 + bay * (i + 0.5);
    for (let step = 0; step < 3; step++) {
      const w = bay * 0.86 * (1 - step * 0.3);
      const y = height + 0.7 + step * 1.4;
      for (const side of [-1, 1]) {
        const g = new THREE.BoxGeometry(along ? w : 1.4, 1.4, along ? 1.4 : w);
        g.translate(
          cx + (along ? offset : (box.w / 2 - 0.7) * side),
          y,
          cz + (along ? (box.d / 2 - 0.7) * side : offset),
        );
        geos.push(g);
      }
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshLambertMaterial({ color }));
  geos.forEach((g) => g.dispose());
  mesh.castShadow = true;
  return mesh;
}

/** Надстройки ориентира: шатры, зубцы, циферблаты, башенки, фронтоны. */
export function buildLandmark(b, style) {
  const group = new THREE.Group();
  const box = bbox(b.poly);
  const height = style.height || b.h;

  if (style.crenels) {
    const geos = crenels(b.poly, height + 0.4);
    if (geos.length) {
      const mesh = new THREE.Mesh(
        mergeGeometries(geos, false),
        new THREE.MeshLambertMaterial({ color: style.color || BRICK }),
      );
      mesh.castShadow = true;
      group.add(mesh);
      geos.forEach((g) => g.dispose());
    }
  }
  if (style.tent) {
    group.add(tent(box, height + 0.4, style.tent, ROOF_GREEN));
    if (style.clock) group.add(clocks(box, height - Math.min(box.w, box.d) * 0.45));
    if (style.spire) {
      const spire = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, style.spire, 6),
        new THREE.MeshLambertMaterial({ color: 0xe8c04a, emissive: 0x3a2c08 }),
      );
      spire.position.set(
        (box.minX + box.maxX) / 2,
        height + 0.4 + style.tent + style.spire / 2,
        (box.minZ + box.maxZ) / 2,
      );
      group.add(spire);
    }
  }
  if (style.turrets) group.add(turrets(box, height));
  if (style.gable) group.add(stepGables(box, height, b.roofColor || 0x8a4a3a));

  return group.children.length ? group : null;
}
