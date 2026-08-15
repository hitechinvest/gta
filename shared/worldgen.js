// Детерминированный генератор российского города.
// Общий модуль: сервер и клиент строят одинаковый мир по одному seed,
// поэтому коллизии, точки спавна и миникарта всегда совпадают.

export const CONFIG = {
  gridSize: 7, // кварталов по оси
  block: 56, // сторона квартала
  road: 16, // ширина дороги
  sidewalk: 3, // тротуар внутри квартала
};

CONFIG.pitch = CONFIG.block + CONFIG.road;
CONFIG.total = CONFIG.gridSize * CONFIG.pitch + CONFIG.road;
CONFIG.origin = -CONFIG.total / 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Йошкар-Ола: краснокирпичная «набережная Брюгге» с фламандскими фронтонами
// и кремлёвские стены. Цвета — кирпич разных обжигов и светлая штукатурка.
const FLEMISH_COLORS = [0xa8443a, 0x8f3b33, 0xb85a45, 0x9c4a3c, 0xc06a4e, 0x7e3a34, 0xb0503c, 0xcf7a52];
const ROOF_TILE_COLORS = [0x5a4038, 0x6b4a3a, 0x4a3630, 0x7a5240];

// Цвета: выцветшие панели, охра сталинок, силикатный кирпич.
// Хрущёвки: силикатный кирпич, выцветшая штукатурка, серая панель.
const KHRUSHCHEVKA_COLORS = [0xdcd7c2, 0xe0dcc8, 0xc9c4ae, 0xd4c9a8, 0xcfd2cc, 0xe2d9bd];

const PANEL_COLORS = [0xc9c3b4, 0xb9bfc0, 0xd3cbb8, 0xa9b2ae, 0xc4b9a6, 0xbfc7cc];
const STALINKA_COLORS = [0xd9b26a, 0xc98f5f, 0xd8c39a, 0xbf8b62, 0xd6cba8];
const FACTORY_COLORS = [0x9b8f80, 0x8c9298, 0xa3927f];
const PRIVATE_COLORS = [0x8fa07a, 0xa8785c, 0x9aa3ad, 0xb0a17f, 0x7f8b93];

export const SHOP_SIGNS = [
  'ПРОДУКТЫ', 'АПТЕКА', 'ПОЧТА', 'ПАРИКМАХЕРСКАЯ', 'ШАУРМА', 'АВТОЗАПЧАСТИ',
  'ХОЗТОВАРЫ', 'ПИВО', 'ЦВЕТЫ', 'РЕМОНТ ОБУВИ', 'СТОЛОВАЯ', 'ЛОМБАРД',
  'ОПТИКА', 'КНИГИ', 'МЯСО РЫБА', 'ОБМЕН ВАЛЮТ',
];

export const STREET_NAMES = [
  'ул. Ленина', 'ул. Гагарина', 'пр. Мира', 'ул. Советская', 'ул. Кирова',
  'ул. Пушкина', 'ул. Строителей', 'ул. Заводская', 'ул. Победы', 'ул. Комсомольская',
  'пер. Школьный', 'ул. Молодёжная', 'ул. Садовая', 'наб. Речная',
];

/** Осевая линия i-й дороги (0..gridSize). */
export function roadCenter(i) {
  return CONFIG.origin + CONFIG.road / 2 + i * CONFIG.pitch;
}

function blockOrigin(i, j) {
  return {
    x: CONFIG.origin + CONFIG.road + i * CONFIG.pitch,
    z: CONFIG.origin + CONFIG.road + j * CONFIG.pitch,
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// --- застройка кварталов по типам районов -----------------------------------

/** Центр: сталинки по периметру квартала, двор внутри. */
function buildStalinkaBlock(rng, x0, z0, size, out, props) {
  const depth = 14;
  const floors = 4 + Math.floor(rng() * 3); // 4-6 этажей
  const h = floors * 3.6 + 1.5;
  const color = pick(rng, STALINKA_COLORS);
  const len = size - 8;

  const sides = [
    { x: x0 + size / 2, z: z0 + depth / 2 + 2, w: len, d: depth },
    { x: x0 + size / 2, z: z0 + size - depth / 2 - 2, w: len, d: depth },
    { x: x0 + depth / 2 + 2, z: z0 + size / 2, w: depth, d: len - depth * 2 },
    { x: x0 + size - depth / 2 - 2, z: z0 + size / 2, w: depth, d: len - depth * 2 },
  ];
  for (const s of sides) {
    if (s.w < 6 || s.d < 6) continue;
    if (rng() < 0.12) continue; // разрыв в застройке
    out.push({
      kind: 'stalinka', x: s.x, z: s.z, w: s.w, d: s.d,
      h: h + (rng() < 0.3 ? 3.6 : 0),
      floors, color,
      sign: rng() < 0.55 ? pick(rng, SHOP_SIGNS) : '',
      arch: rng() < 0.5,
    });
  }
  // Двор: деревья и лавочки.
  for (let t = 0; t < 5; t++) {
    props.push({
      type: rng() < 0.5 ? 'poplar' : 'birch',
      x: x0 + size / 2 + (rng() - 0.5) * (size - depth * 2 - 6),
      z: z0 + size / 2 + (rng() - 0.5) * (size - depth * 2 - 6),
      rot: rng() * Math.PI * 2, scale: 0.9 + rng() * 0.5,
    });
  }
}

/**
 * «Набережная Брюгге»: плотный ряд узких домов с фламандскими фронтонами,
 * плечом к плечу вдоль улицы. Главная примета Йошкар-Олы.
 */
function buildFlemishBlock(rng, x0, z0, size, out, props) {
  const depth = 13;
  // Каждая сторона квартала — своя улица, дома фасадом наружу.
  const sides = [
    { face: 'z-', along: 'x', fixed: z0 + depth / 2 + 1 },
    { face: 'z+', along: 'x', fixed: z0 + size - depth / 2 - 1 },
    { face: 'x-', along: 'z', fixed: x0 + depth / 2 + 1 },
    { face: 'x+', along: 'z', fixed: x0 + size - depth / 2 - 1 },
  ];

  for (const side of sides) {
    const alongX = side.along === 'x';
    const start = (alongX ? x0 : z0) + (alongX ? 0 : depth) + 2;
    const end = (alongX ? x0 : z0) + size - (alongX ? 0 : depth) - 2;
    let cursor = start;
    while (cursor < end - 7) {
      const width = 7.5 + rng() * 4.5;
      if (cursor + width > end) break;
      if (rng() < 0.07) { cursor += width; continue; } // проулок
      const floors = 3 + Math.floor(rng() * 2);
      const h = floors * 3.5 + 1.5;
      const centerAlong = cursor + width / 2;
      out.push({
        kind: 'flemish',
        x: alongX ? centerAlong : side.fixed,
        z: alongX ? side.fixed : centerAlong,
        w: alongX ? width - 0.3 : depth,
        d: alongX ? depth : width - 0.3,
        h,
        floors,
        color: pick(rng, FLEMISH_COLORS),
        roofColor: pick(rng, ROOF_TILE_COLORS),
        gable: true,
        gableSteps: 3 + Math.floor(rng() * 3),
        face: side.face,
        sign: rng() < 0.4 ? pick(rng, SHOP_SIGNS) : '',
      });
      cursor += width;
    }
  }

  // Внутри квартала — двор с деревьями и лавками.
  for (let t = 0; t < 5; t++) {
    props.push({
      type: rng() < 0.5 ? 'birch' : 'poplar',
      x: x0 + size / 2 + (rng() - 0.5) * (size - depth * 2 - 8),
      z: z0 + size / 2 + (rng() - 0.5) * (size - depth * 2 - 8),
      rot: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.5,
    });
  }
  props.push({ type: 'bench', x: x0 + size / 2, z: z0 + size / 2, rot: rng() * Math.PI, scale: 1 });
}

/**
 * Квартал хрущёвок: два-три длинных пятиэтажных дома параллельно,
 * между ними двор с сушилками и лавками. Классика 60-х.
 */
function buildKhrushchevkaBlock(rng, x0, z0, size, out, props) {
  const horizontal = rng() < 0.5;
  const rows = rng() < 0.55 ? 2 : 3;
  const gap = size / rows;
  const brick = rng() < 0.5; // силикатный кирпич или панель

  for (let r = 0; r < rows; r++) {
    const floors = 5;
    const h = floors * 2.8 + 1.1;
    const long = size - 10 - rng() * 8;
    const thick = 11.5;
    const jitter = (rng() - 0.5) * 3;
    const b = horizontal
      ? { x: x0 + size / 2 + jitter, z: z0 + gap * r + gap / 2, w: long, d: thick }
      : { x: x0 + gap * r + gap / 2, z: z0 + size / 2 + jitter, w: thick, d: long };

    out.push({
      kind: 'khrushchevka',
      x: b.x, z: b.z, w: b.w, d: b.d, h,
      floors,
      color: pick(rng, KHRUSHCHEVKA_COLORS),
      brick,
      entrances: Math.max(3, Math.round((horizontal ? b.w : b.d) / 13)),
      horizontal,
      sign: rng() < 0.25 ? pick(rng, SHOP_SIGNS) : '',
    });
  }

  // Двор: лавки, сушилка, тополя вдоль торцов.
  const cx = x0 + size / 2;
  const cz = z0 + size / 2;
  props.push({ type: 'carpetBeater', x: cx + (rng() - 0.5) * 12, z: cz + (rng() - 0.5) * 12, rot: rng() * Math.PI, scale: 1 });
  props.push({ type: 'bench', x: cx + 6, z: cz - 6, rot: rng() * Math.PI, scale: 1 });
  props.push({ type: 'trash', x: x0 + 6, z: z0 + 6, rot: 0, scale: 1 });
  for (let t = 0; t < 7; t++) {
    props.push({
      type: rng() < 0.6 ? 'poplar' : 'birch',
      x: x0 + 5 + rng() * (size - 10),
      z: z0 + 5 + rng() * (size - 10),
      rot: rng() * Math.PI * 2, scale: 0.85 + rng() * 0.5,
    });
  }
}

/** Спальный микрорайон: длинные панельки, двор с площадкой. */
function buildPanelBlock(rng, x0, z0, size, out, props) {
  const rows = 2;
  const gap = size / rows;
  const horizontal = rng() < 0.5; // все дома квартала смотрят в одну сторону
  for (let r = 0; r < rows; r++) {
    const floors = pick(rng, [5, 5, 9, 9, 12, 16]);
    const h = floors * 2.9 + 1.2;
    const long = size - 12 - rng() * 10;
    const thick = floors >= 12 ? 15 : 12;
    const b = horizontal
      ? {
        x: x0 + size / 2 + (rng() - 0.5) * 6,
        z: z0 + gap * r + gap / 2 + (rng() - 0.5) * 4,
        w: long, d: thick,
      }
      : {
        x: x0 + gap * r + gap / 2 + (rng() - 0.5) * 4,
        z: z0 + size / 2 + (rng() - 0.5) * 6,
        w: thick, d: long,
      };
    out.push({
      kind: floors >= 12 ? 'tower' : 'panel',
      x: b.x, z: b.z, w: b.w, d: b.d, h,
      floors,
      color: pick(rng, PANEL_COLORS),
      sign: rng() < 0.35 ? pick(rng, SHOP_SIGNS) : '',
      balconies: true,
    });
  }
  // Дворовая инфраструктура.
  const cx = x0 + size / 2;
  const cz = z0 + size / 2;
  props.push({ type: 'playground', x: cx + (rng() - 0.5) * 10, z: cz + (rng() - 0.5) * 10, rot: rng() * Math.PI, scale: 1 });
  props.push({ type: 'carpetBeater', x: cx + 10 + rng() * 6, z: cz - 8 - rng() * 6, rot: rng() * Math.PI, scale: 1 });
  for (let t = 0; t < 6; t++) {
    props.push({
      type: rng() < 0.55 ? 'poplar' : 'birch',
      x: x0 + 5 + rng() * (size - 10),
      z: z0 + 5 + rng() * (size - 10),
      rot: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.6,
    });
  }
  props.push({ type: 'trash', x: x0 + 6 + rng() * 8, z: z0 + 6 + rng() * 8, rot: rng() * Math.PI, scale: 1 });
}

/** Промзона: широкие корпуса, трубы, ангары. */
function buildFactoryBlock(rng, x0, z0, size, out, props) {
  const count = 1 + Math.floor(rng() * 2);
  for (let k = 0; k < count; k++) {
    const w = 24 + rng() * (size - 30);
    const d = 18 + rng() * 20;
    out.push({
      kind: 'factory',
      x: x0 + 6 + w / 2 + rng() * (size - w - 12),
      z: z0 + 6 + d / 2 + rng() * (size - d - 12),
      w, d,
      h: 9 + rng() * 8,
      floors: 2,
      color: pick(rng, FACTORY_COLORS),
      sign: rng() < 0.4 ? 'ЗАВОД' : '',
    });
  }
  if (rng() < 0.8) {
    out.push({
      kind: 'chimney',
      x: x0 + 10 + rng() * (size - 20),
      z: z0 + 10 + rng() * (size - 20),
      w: 6, d: 6, h: 40 + rng() * 30, floors: 1,
      color: 0xb85c4a, sign: '',
    });
  }
  props.push({ type: 'fence', x: x0 + size / 2, z: z0 + 1.5, rot: 0, scale: size / 10 });
  props.push({ type: 'fence', x: x0 + size / 2, z: z0 + size - 1.5, rot: 0, scale: size / 10 });
}

/** Гаражный кооператив: ряды ракушек. */
function buildGarageBlock(rng, x0, z0, size, out, props) {
  const rows = 3;
  for (let r = 0; r < rows; r++) {
    const z = z0 + 8 + r * ((size - 16) / (rows - 1));
    const count = Math.floor((size - 12) / 4);
    for (let c = 0; c < count; c++) {
      out.push({
        kind: 'garage',
        x: x0 + 6 + c * 4 + 2,
        z,
        w: 3.8, d: 6,
        h: 2.6 + rng() * 0.4,
        floors: 1,
        color: [0x7d8a6a, 0x8b6b4a, 0x6e7a86, 0x94714f][Math.floor(rng() * 4)],
        sign: '',
      });
    }
  }
  props.push({ type: 'trash', x: x0 + 4, z: z0 + 4, rot: 0, scale: 1 });
}

/** Частный сектор: домики с заборами и огородами. */
function buildPrivateBlock(rng, x0, z0, size, out, props) {
  const n = 2;
  const cell = size / n;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (rng() < 0.15) continue;
      const cx = x0 + a * cell + cell / 2;
      const cz = z0 + b * cell + cell / 2;
      out.push({
        kind: 'private',
        x: cx, z: cz,
        w: 9 + rng() * 4, d: 8 + rng() * 4,
        h: 4 + rng() * 2.5,
        floors: 1,
        color: pick(rng, PRIVATE_COLORS),
        sign: '',
        roof: true,
      });
      props.push({ type: 'fence', x: cx, z: cz + cell / 2 - 2, rot: 0, scale: cell / 12 });
      if (rng() < 0.6) {
        props.push({ type: 'birch', x: cx + (rng() - 0.5) * 10, z: cz + (rng() - 0.5) * 10, rot: 0, scale: 1 + rng() * 0.5 });
      }
    }
  }
}

/**
 * Центральная площадь Йошкар-Олы: Благовещенская башня со шпилем,
 * краснокирпичная кремлёвская стена с башнями, храм и памятник.
 */
function buildSquare(rng, x0, z0, size, out, props) {
  const cx = x0 + size / 2;
  const cz = z0 + size / 2;
  props.push({ type: 'statue', x: cx - 12, z: cz + 10, rot: Math.PI / 4, scale: 1 });

  // Башня с часами и шпилем — доминанта площади.
  out.push({
    kind: 'clockTower',
    x: cx + 6, z: cz - 4,
    w: 9, d: 9, h: 26, floors: 5,
    color: 0xe8e2d4, roofColor: 0x2f5d4a, sign: '',
  });

  // Кремлёвская стена с зубцами вдоль двух сторон квартала.
  const wallH = 7;
  const wallT = 2.2;
  out.push({
    kind: 'kremlinWall',
    x: x0 + size / 2, z: z0 + 3,
    w: size - 14, d: wallT, h: wallH, floors: 1,
    color: 0x9c4a3c, sign: '',
  });
  out.push({
    kind: 'kremlinWall',
    x: x0 + 3, z: z0 + size / 2,
    w: wallT, d: size - 14, h: wallH, floors: 1,
    color: 0x9c4a3c, sign: '',
  });
  for (const [tx, tz] of [[x0 + 3, z0 + 3], [x0 + size - 8, z0 + 3], [x0 + 3, z0 + size - 8]]) {
    out.push({
      kind: 'kremlinTower',
      x: tx, z: tz, w: 6.5, d: 6.5, h: 12, floors: 2,
      color: 0x9c4a3c, roofColor: 0x3f4a52, sign: '',
    });
  }

  out.push({
    kind: 'church',
    x: x0 + size - 16, z: z0 + 16,
    w: 16, d: 18, h: 14, floors: 1,
    color: 0xf0eadc, sign: '',
  });
  out.push({
    kind: 'admin', // здание администрации с колоннами
    x: x0 + 14, z: z0 + size - 14,
    w: 22, d: 14, h: 13, floors: 3,
    color: 0xd9c9a8, sign: 'АДМИНИСТРАЦИЯ',
  });
  for (let t = 0; t < 10; t++) {
    props.push({
      type: 'poplar',
      x: x0 + 6 + rng() * (size - 12),
      z: z0 + 6 + rng() * (size - 12),
      rot: rng() * Math.PI * 2, scale: 0.9 + rng() * 0.4,
    });
  }
  for (let t = 0; t < 6; t++) {
    props.push({ type: 'bench', x: cx + Math.cos(t) * 12, z: cz + Math.sin(t) * 12, rot: t, scale: 1 });
  }
}

export function generateWorld(seed = 1337) {
  const rng = mulberry32(seed);
  const { gridSize, block } = CONFIG;

  const buildings = [];
  const props = [];
  const carSpawns = [];
  const footSpawns = [];
  const districts = [];

  const center = Math.floor(gridSize / 2);

  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const { x, z } = blockOrigin(i, j);
      const ring = Math.max(Math.abs(i - center), Math.abs(j - center));
      let kind;

      if (ring === 0) kind = 'square';
      else if (ring === 1) kind = rng() < 0.75 ? 'flemish' : 'stalinka';
      else if (ring === 2) kind = rng() < 0.45 ? 'khrushchevka' : rng() < 0.55 ? 'panel' : rng() < 0.5 ? 'flemish' : 'stalinka';
      else {
        const r = rng();
        if (r < 0.3) kind = 'factory';
        else if (r < 0.5) kind = 'garage';
        else if (r < 0.7) kind = 'private';
        else if (r < 0.88) kind = 'khrushchevka';
        else kind = 'panel';
      }

      districts.push({ i, j, kind, x: x + block / 2, z: z + block / 2 });

      switch (kind) {
        case 'square': buildSquare(rng, x, z, block, buildings, props); break;
        case 'flemish': buildFlemishBlock(rng, x, z, block, buildings, props); break;
        case 'khrushchevka': buildKhrushchevkaBlock(rng, x, z, block, buildings, props); break;
        case 'stalinka': buildStalinkaBlock(rng, x, z, block, buildings, props); break;
        case 'panel': buildPanelBlock(rng, x, z, block, buildings, props); break;
        case 'factory': buildFactoryBlock(rng, x, z, block, buildings, props); break;
        case 'garage': buildGarageBlock(rng, x, z, block, buildings, props); break;
        case 'private': buildPrivateBlock(rng, x, z, block, buildings, props); break;
      }

      footSpawns.push({ x: x + block / 2, z: z + block / 2, yaw: rng() * Math.PI * 2 });
    }
  }

  // Улицы: фонари, остановки, киоски, столбы, точки спавна машин.
  const streets = [];
  for (let i = 0; i <= gridSize; i++) {
    const rx = roadCenter(i);
    streets.push({ axis: 'x', v: rx, name: STREET_NAMES[i % STREET_NAMES.length] });
    for (let j = 0; j <= gridSize; j++) {
      const rz = roadCenter(j);
      const off = CONFIG.road / 2 + 1.4;

      props.push({ type: 'lamp', x: rx - off, z: rz - off, rot: 0, scale: 1 });
      props.push({ type: 'lamp', x: rx + off, z: rz + off, rot: Math.PI, scale: 1 });
      props.push({ type: 'pole', x: rx + off + 0.4, z: rz - off - 0.4, rot: 0, scale: 1 });

      if ((i + j) % 3 === 0) {
        props.push({ type: 'busStop', x: rx - off - 1.5, z: rz + off + 6, rot: Math.PI / 2, scale: 1 });
      }
      if ((i * 3 + j) % 4 === 0) {
        props.push({ type: 'kiosk', x: rx + off + 2, z: rz + off + 4, rot: rng() * Math.PI * 2, scale: 1 });
      }
      if (i > 0 && i < gridSize && j > 0 && j < gridSize && (i + j) % 2 === 0) {
        props.push({ type: 'trafficLight', x: rx - off, z: rz + off, rot: Math.PI / 2, scale: 1 });
      }

      footSpawns.push({ x: rx + off + 1.5, z: rz + off + 1.5, yaw: rng() * Math.PI * 2 });

      if (i < gridSize) {
        carSpawns.push({ x: rx + 4, z: rz + 14 + rng() * 22, yaw: 0 });
        carSpawns.push({ x: rx - 4, z: rz - 14 - rng() * 22, yaw: Math.PI });
      }
      if (j < gridSize) {
        carSpawns.push({ x: rx + 14 + rng() * 22, z: rz - 4, yaw: Math.PI / 2 });
        carSpawns.push({ x: rx - 14 - rng() * 22, z: rz + 4, yaw: -Math.PI / 2 });
      }
    }
  }
  for (let j = 0; j <= gridSize; j++) {
    streets.push({ axis: 'z', v: roadCenter(j), name: STREET_NAMES[(j + 5) % STREET_NAMES.length] });
  }

  const world = {
    seed,
    config: CONFIG,
    buildings,
    props,
    districts,
    streets,
    carSpawns,
    footSpawns,
    bounds: { min: CONFIG.origin, max: CONFIG.origin + CONFIG.total },
  };

  // Точки спавна не должны оказаться внутри дома.
  world.footSpawns = footSpawns.filter((s) => isFree(world, s.x, s.z, 0.8));
  world.carSpawns = carSpawns.filter((s) => isFree(world, s.x, s.z, 1.6));
  return world;
}

/** Свободно ли место под окружность радиуса r. */
export function isFree(world, x, z, r) {
  for (const b of world.buildings) {
    if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return false;
  }
  return true;
}

/** Точка на асфальте? (нужно ИИ ДПС и трафику) */
export function isOnRoad(x, z) {
  const { pitch, road, origin } = CONFIG;
  const lx = ((x - origin) % pitch + pitch) % pitch;
  const lz = ((z - origin) % pitch + pitch) % pitch;
  return lx < road || lz < road;
}

/** Ближайшая осевая линия дороги для координаты. */
export function snapToRoad(v) {
  const i = Math.round((v - CONFIG.origin - CONFIG.road / 2) / CONFIG.pitch);
  const clamped = Math.max(0, Math.min(CONFIG.gridSize, i));
  return roadCenter(clamped);
}

/**
 * Выталкивает окружность из всех зданий, которые она задевает.
 * Используется и физикой клиента, и ИИ на сервере.
 */
export function resolveCircle(world, x, z, radius, out = { x: 0, z: 0, hit: false, nx: 0, nz: 0 }) {
  out.x = x;
  out.z = z;
  out.hit = false;
  out.nx = 0;
  out.nz = 0;

  for (const b of world.buildings) {
    const hw = b.w / 2 + radius;
    const hd = b.d / 2 + radius;
    const dx = out.x - b.x;
    const dz = out.z - b.z;
    if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
      const penX = hw - Math.abs(dx);
      const penZ = hd - Math.abs(dz);
      if (penX < penZ) {
        const s = Math.sign(dx) || 1;
        out.x = b.x + s * hw;
        out.nx = s;
      } else {
        const s = Math.sign(dz) || 1;
        out.z = b.z + s * hd;
        out.nz = s;
      }
      out.hit = true;
    }
  }

  const pad = radius + 2;
  const min = CONFIG.origin + pad;
  const max = CONFIG.origin + CONFIG.total - pad;
  if (out.x < min) { out.x = min; out.nx = 1; out.hit = true; }
  if (out.x > max) { out.x = max; out.nx = -1; out.hit = true; }
  if (out.z < min) { out.z = min; out.nz = 1; out.hit = true; }
  if (out.z > max) { out.z = max; out.nz = -1; out.hit = true; }

  return out;
}

/** Луч против коробок зданий. Возвращает дистанцию или maxDist. */
export function raycastBuildings(world, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const b of world.buildings) {
    let t0 = 0;
    let t1 = best;
    const slabs = [
      [ox, dx, b.x - b.w / 2, b.x + b.w / 2],
      [oy, dy, 0, b.h],
      [oz, dz, b.z - b.d / 2, b.z + b.d / 2],
    ];
    let miss = false;
    for (const [o, d, lo, hi] of slabs) {
      if (Math.abs(d) < 1e-6) {
        if (o < lo || o > hi) { miss = true; break; }
        continue;
      }
      let ta = (lo - o) / d;
      let tb = (hi - o) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) { miss = true; break; }
    }
    if (!miss && t0 >= 0 && t0 < best) best = t0;
  }
  return best;
}
