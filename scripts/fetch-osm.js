// Выгрузка реального центра Йошкар-Олы из OpenStreetMap через Overpass API
// и перевод в компактный формат игры.
//
//   node scripts/fetch-osm.js [--radius 1200] [--out shared/city-osm.json]
//
// Данные OpenStreetMap распространяются по лицензии ODbL: их можно свободно
// использовать при указании источника. Результат кладётся в репозиторий,
// поэтому в рантайме игра никуда не ходит.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Патриаршая площадь — центр нашей карты.
const CENTER = { lat: 56.6316, lon: 47.8869 };
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const RADIUS = Number(argValue('radius', 1200)); // метры от центра
const OUT = argValue('out', 'shared/city-osm.json');
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Перевод градусов в метры: на таком масштабе плоской проекции достаточно.
const M_PER_DEG_LAT = 111320;
const mPerDegLon = Math.cos((CENTER.lat * Math.PI) / 180) * 111320;

const dLat = RADIUS / M_PER_DEG_LAT;
const dLon = RADIUS / mPerDegLon;
const BBOX = [
  (CENTER.lat - dLat).toFixed(6),
  (CENTER.lon - dLon).toFixed(6),
  (CENTER.lat + dLat).toFixed(6),
  (CENTER.lon + dLon).toFixed(6),
].join(',');

const QUERY = `
[out:json][timeout:180];
(
  way["building"](${BBOX});
  relation["building"]["type"="multipolygon"](${BBOX});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|pedestrian|footway)$"](${BBOX});
  way["natural"="water"](${BBOX});
  way["waterway"="riverbank"](${BBOX});
  way["leisure"~"^(park|garden|pitch|playground)$"](${BBOX});
  way["landuse"~"^(grass|forest|cemetery|industrial)$"](${BBOX});
);
out body geom;
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass() {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
  for (const url of ENDPOINTS) {
    process.stdout.write(`[osm] запрос к ${new URL(url).host}… `);
    try {
      // Через прокси POST на Overpass возвращает 406, GET проходит.
      const res = await fetch(`${url}?${new URLSearchParams({ data: QUERY })}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      console.log(`ок, элементов: ${json.elements.length}`);
      return json;
    } catch (err) {
      console.log(`не вышло (${err.message})`);
      lastError = err;
    }
  }
  const wait = 30000 + attempt * 30000;
  console.log(`[osm] пауза ${wait / 1000} с перед повтором`);
  await sleep(wait);
  }
  throw lastError;
}

const toLocal = (lat, lon) => [
  +((lon - CENTER.lon) * mPerDegLon).toFixed(2), // x — на восток
  +((CENTER.lat - lat) * M_PER_DEG_LAT).toFixed(2), // z — на юг
];

/** Высота здания: сначала явная, потом по этажам, потом по типу. */
function buildingHeight(tags) {
  const h = parseFloat(tags.height || tags['building:height']);
  if (Number.isFinite(h) && h > 2) return Math.min(120, h);
  const levels = parseFloat(tags['building:levels']);
  if (Number.isFinite(levels) && levels >= 1) return Math.min(120, levels * 3.1 + 1.2);
  const kind = tags.building;
  if (kind === 'garage' || kind === 'garages' || kind === 'shed') return 2.8;
  if (kind === 'kiosk') return 3;
  if (kind === 'church' || kind === 'cathedral') return 16;
  if (kind === 'industrial' || kind === 'warehouse') return 9;
  if (kind === 'house' || kind === 'detached') return 6;
  return 12;
}

/** Грубая классификация под наши фасады. */
function buildingKind(tags, height) {
  const b = tags.building || '';
  if (tags.amenity === 'place_of_worship' || b === 'church' || b === 'cathedral' || b === 'chapel') return 'church';
  if (b === 'garage' || b === 'garages') return 'garage';
  if (b === 'industrial' || b === 'warehouse' || b === 'factory' || tags.landuse === 'industrial') return 'factory';
  if (b === 'house' || b === 'detached' || b === 'hut' || b === 'bungalow') return 'private';
  if (b === 'kiosk' || b === 'retail' || b === 'commercial' || b === 'office') return 'stalinka';
  // Соцкультбыт: школы и детсады строили по типовым сериям, панель им ближе
  // сталинского фасада, даром что этажей мало.
  if (b === 'school' || b === 'kindergarten' || b === 'hospital' || b === 'university') return 'panel';
  if (b === 'dormitory' && height < 20) return 'khrushchevka';
  if (height >= 30) return 'tower';
  if (height >= 22) return 'series125';
  if (height <= 16 && height >= 12) return 'khrushchevka';
  if (height < 12) return 'stalinka';
  return 'panel';
}

// Цвет в OSM пишут и как #rrggbb, и словом. Разбираем оба, иначе теряем
// половину проставленных кровель.
const NAMED_COLORS = {
  red: 0xa03a2c, darkred: 0x7a2a20, brown: 0x7a5230, maroon: 0x6a2a24,
  green: 0x3d6b3a, darkgreen: 0x2c4f2b, blue: 0x2f5c8a, darkblue: 0x27436b,
  grey: 0x8a8a8a, gray: 0x8a8a8a, silver: 0xb0b4b8, black: 0x2a2c30,
  white: 0xdedede, yellow: 0xc9a63a, orange: 0xc07a3a, beige: 0xd8cba8,
  copper: 0x8a5a3a, terracotta: 0xa85a3a,
};

function colorTag(value) {
  if (!value) return 0;
  const v = String(value).trim().toLowerCase();
  const hex = v.match(/^#?([0-9a-f]{6})$/);
  if (hex) return parseInt(hex[1], 16);
  return NAMED_COLORS[v] || 0;
}

const ROAD_WIDTH = {
  motorway: 16, trunk: 15, primary: 14, secondary: 12, tertiary: 11,
  residential: 9, unclassified: 8, living_street: 7, service: 5.5,
  pedestrian: 5, footway: 2.6,
};

function area(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(a / 2);
}

const data = await overpass();

const buildings = [];
const roads = [];
const water = [];
const green = [];

for (const el of data.elements) {
  const tags = el.tags || {};
  const geom = el.geometry
    || (el.members || []).filter((m) => m.role === 'outer' && m.geometry).flatMap((m) => m.geometry);
  if (!geom || geom.length < 3) continue;

  const pts = geom.map((g) => toLocal(g.lat, g.lon));
  // Замкнутый контур: последняя точка дублирует первую — убираем.
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed = Math.abs(first[0] - last[0]) < 0.5 && Math.abs(first[1] - last[1]) < 0.5;
  if (closed) pts.pop();

  if (tags.building) {
    if (pts.length < 3 || area(pts) < 12) continue; // сараи и будки пропускаем
    const h = buildingHeight(tags);
    buildings.push({
      p: pts,
      h: +h.toFixed(1),
      k: buildingKind(tags, h),
      n: tags.name || tags['name:ru'] || '',
      // Адрес: улица и номер дома — то, чем город подписан в реальности.
      st: tags['addr:street'] || '',
      hn: tags['addr:housenumber'] || '',
      am: tags.amenity || tags.shop || tags.office || tags.tourism || '',
      l: parseInt(tags['building:levels'], 10) || 0,
      // Крыша и материал: в центре они проставлены у сотен домов, и именно
      // они отличают вальмовую кровлю сталинки от плоской панельки.
      rs: tags['roof:shape'] || '',
      rl: parseFloat(tags['roof:levels']) || 0,
      rc: colorTag(tags['roof:colour']),
      bc: colorTag(tags['building:colour']),
      bm: tags['building:material'] || '',
      bt: tags.building,
    });
  } else if (tags.highway) {
    roads.push({
      p: pts,
      w: ROAD_WIDTH[tags.highway] || 8,
      k: tags.highway,
      n: tags.name || '',
    });
  } else if (tags.natural === 'water' || tags.waterway === 'riverbank') {
    if (pts.length >= 3) water.push({ p: pts });
  } else if (tags.leisure || tags.landuse) {
    if (pts.length >= 3 && area(pts) > 200) {
      green.push({ p: pts, k: tags.leisure || tags.landuse });
    }
  }
}

const out = {
  source: 'OpenStreetMap contributors, ODbL',
  center: CENTER,
  radius: RADIUS,
  fetched: new Date().toISOString().slice(0, 10),
  buildings,
  roads,
  water,
  green,
};

mkdirSync(resolve(ROOT, dirname(OUT)), { recursive: true });
writeFileSync(resolve(ROOT, OUT), JSON.stringify(out));

const named = buildings.filter((b) => b.n).length;
const addressed = buildings.filter((b) => b.hn).length;
console.log(`[osm] здания: ${buildings.length} (с названиями: ${named}, с адресами: ${addressed})`);
console.log(`[osm] дороги: ${roads.length}, вода: ${water.length}, зелень: ${green.length}`);
console.log(`[osm] сохранено в ${OUT}`);
