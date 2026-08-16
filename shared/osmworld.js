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
    const color = palette[Math.floor(hash(key) * palette.length) % palette.length];

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
      // Подпись показываем только у заметных или названных домов.
      label: b.n || address,
      sign: '',
      brick: hash(key + 'b') < 0.5,
      accent: 0x8fa2a8,
      sections: Math.max(2, Math.round(w / 14)),
      features: {},
    });
  }

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
    carSpawns: carSpawns.length ? carSpawns : [{ x: 0, z: 0, yaw: 0 }],
    footSpawns: footSpawns.length ? footSpawns : [{ x: 0, z: 0, yaw: 0 }],
    bounds,
  };
  return cached;
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
