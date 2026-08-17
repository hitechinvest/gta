// Мир из реальных данных OpenStreetMap: контуры домов, улицы, зелень.
// Формат совместим с процедурным генератором — сервер и клиент работают
// с одинаковыми зданиями, коллизиями и точками спавна.
//
// Данные © участники OpenStreetMap, лицензия ODbL.


const KIND_COLORS = {
  panel: [0xc9c3b4, 0xb9bfc0, 0xd3cbb8, 0xa9b2ae],
  khrushchevka: [0xdcd7c2, 0xe0dcc8, 0xc9c4ae, 0xd4c9a8],
  series125: [0xc6c2b2, 0xd2cec0, 0xb9bfbe],
  stalinka: [0xd9b26a, 0xc98f5f, 0xd8c39a, 0xbf8b62],
  tower: [0xbfc7cc, 0xc4b9a6, 0xb0b6ba],
  factory: [0x9b8f80, 0x8c9298, 0xa3927f],
  private: [0x8fa07a, 0xa8785c, 0x9aa3ad, 0xb0a17f],
  garage: [0x7d8a6a, 0x8b6b4a, 0x6e7a86],
  church: [0xf0eadc],
  flemish: [0xa8443a, 0xb85a45, 0x9c4a3c],
};

/** Устойчивый хеш строки — чтобы цвет дома не менялся между запусками. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function bbox(points) {
  let minX = Infinity; let maxX = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** Площадь и периметр контура — нужны для отбраковки мусора. */
function polyArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(a / 2);
}


/** Точка внутри контура — по ней секции дома привязываются к дому. */
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Раскладывает секции building:part по домам. В OSM у дома со стилобатом и
 * башней размечена каждая секция со своей этажностью, и без этой раскладки
 * такой дом рисуется одной коробкой по внешнему контуру.
 */
function attachParts(buildings, rawParts) {
  if (!rawParts || !rawParts.length) return;
  const index = new Map();
  const CELL = 120;
  buildings.forEach((b, i) => {
    const key = `${Math.floor(b.x / CELL)}:${Math.floor(b.z / CELL)}`;
    let cell = index.get(key);
    if (!cell) index.set(key, cell = []);
    cell.push(i);
  });
  for (const part of rawParts) {
    if (!part.p || part.p.length < 3) continue;
    let sx = 0; let sz = 0;
    for (const [x, z] of part.p) { sx += x; sz += z; }
    const cx = sx / part.p.length;
    const cz = sz / part.p.length;
    const gx = Math.floor(cx / CELL);
    const gz = Math.floor(cz / CELL);
    let host = null;
    for (let dx = -1; dx <= 1 && !host; dx++) {
      for (let dz = -1; dz <= 1 && !host; dz++) {
        for (const i of index.get(`${gx + dx}:${gz + dz}`) || []) {
          const b = buildings[i];
          if (Math.abs(cx - b.x) > b.w / 2 + 2 || Math.abs(cz - b.z) > b.d / 2 + 2) continue;
          if (!inPoly(cx, cz, b.poly)) continue;
          host = b;
          break;
        }
      }
    }
    if (!host) continue;
    (host.parts || (host.parts = [])).push({
      poly: part.p,
      h: part.h,
      minH: part.mh || 0,
      roof: part.rs || '',
      roofLevels: part.rl || 0,
      roofColor: part.rc || 0,
      area: polyArea(part.p),
    });
    if (part.h > host.h) host.h = part.h;
  }
}

let cached = null;
let osm = null;

/** Данные загружаются снаружи: сервер читает файл, клиент делает fetch. */
export function setOsmData(data) {
  osm = data;
  cached = null;
}

/**
 * Собирает мир из выгрузки OSM. Здание хранит и реальный контур (для
 * отрисовки), и его габаритный прямоугольник — по нему считаются коллизии
 * и стрельба, как и в процедурном городе.
 */
export function generateOsmWorld(data) {
  if (data) setOsmData(data);
  if (!osm) throw new Error('данные OSM не загружены: вызовите setOsmData');
  if (cached) return cached;

  const buildings = [];
  for (const b of osm.buildings) {
    if (!b.p || b.p.length < 3) continue;
    const area = polyArea(b.p);
    if (area < 20) continue;

    const box = bbox(b.p);
    const w = box.maxX - box.minX;
    const d = box.maxZ - box.minZ;
    if (w < 2 || d < 2) continue;

    const kind = KIND_COLORS[b.k] ? b.k : 'panel';
    const palette = KIND_COLORS[kind];
    const key = `${b.n}${b.st}${b.hn}${box.minX.toFixed(1)}${box.minZ.toFixed(1)}`;
    // Если цвет стен указан в OSM — он честнее любой нашей палитры.
    const color = b.bc || palette[Math.floor(hash(key) * palette.length) % palette.length];

    const address = b.hn ? `${b.st ? `${b.st}, ` : ''}${b.hn}` : '';
    buildings.push({
      kind,
      poly: b.p,
      x: (box.minX + box.maxX) / 2,
      z: (box.minZ + box.maxZ) / 2,
      w,
      d,
      h: b.h,
      floors: b.l || Math.max(1, Math.round(b.h / 3.1)),
      color,
      area,
      name: b.n || '',
      address,
      amenity: b.am || '',
      // Форма и цвет кровли из OSM: у 145 домов центра они проставлены,
      // и именно они отличают вальмовую крышу от плоской панельной.
      roof: b.rs || '',
      roofLevels: b.rl || 0,
      roofColor: b.rc || 0,
      wallColor: b.bc || 0,
      material: b.bm || '',
      // Подпись показываем только у заметных или названных домов.
      label: b.n || address,
      sign: '',
      brick: hash(key + 'b') < 0.5,
      accent: 0x8fa2a8,
      sections: Math.max(2, Math.round(w / 14)),
      features: {},
    });
  }

  attachParts(buildings, osm.parts);

  // Точки спавна: вдоль проезжих улиц, подальше от домов.
  const carSpawns = [];
  const footSpawns = [];
  for (const road of osm.roads) {
    if (!['residential', 'secondary', 'tertiary', 'primary', 'unclassified'].includes(road.k)) continue;
    for (let i = 1; i < road.p.length; i++) {
      const [ax, az] = road.p[i - 1];
      const [bx, bz] = road.p[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 12) continue;
      const t = 0.5;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const yaw = Math.atan2(bx - ax, bz - az);
      if (isFree({ buildings }, x, z, 3)) carSpawns.push({ x, z, yaw });
      if (isFree({ buildings }, x + 6, z + 6, 1.5)) footSpawns.push({ x: x + 6, z: z + 6, yaw });
    }
  }

  const bounds = { min: -osm.radius, max: osm.radius };
  cached = {
    seed: 0,
    osm: true,
    source: osm.source,
    center: osm.center,
    radius: osm.radius,
    config: { total: osm.radius * 2, origin: -osm.radius, road: 12, block: 60, pitch: 72, gridSize: 1 },
    buildings,
    props: [],
    districts: [],
    streets: [...new Set(osm.roads.map((r) => r.n).filter(Boolean))].map((n) => ({ name: n })),
    roads: osm.roads,
    green: osm.green,
    water: osm.water,
    sights: osm.sights || [],
    carSpawns: carSpawns.length ? carSpawns : [{ x: 0, z: 0, yaw: 0 }],
    footSpawns: footSpawns.length ? footSpawns : [{ x: 0, z: 0, yaw: 0 }],
    bounds,
  };
  return cached;
}

/**
 * Ближайшая точка уличной сети: возвращает саму точку, направление
 * сегмента и название улицы. Нужна и подписи в HUD, и навигации.
 */
export function nearestRoad(world, x, z, maxDist = 60) {
  let best = null;
  for (const road of world.roads || []) {
    for (let i = 1; i < road.p.length; i++) {
      const [ax, az] = road.p[i - 1];
      const [bx, bz] = road.p[i];
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      if (len2 < 1) continue;
      let t = ((x - ax) * dx + (z - az) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t;
      const pz = az + dz * t;
      const dist = Math.hypot(x - px, z - pz);
      if (!best || dist < best.dist) {
        best = { x: px, z: pz, dist, yaw: Math.atan2(dx, dz), name: road.n, kind: road.k, width: road.w };
      }
    }
  }
  return best && best.dist <= maxDist ? best : null;
}

/** Свободно ли место — используется при отборе точек спавна. */
export function isFree(world, x, z, r) {
  for (const b of world.buildings) {
    if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return false;
  }
  return true;
}

export function osmMeta() {
  return osm ? {
    source: osm.source, center: osm.center, radius: osm.radius,
    fetched: osm.fetched, buildings: osm.buildings.length,
  } : null;
}
