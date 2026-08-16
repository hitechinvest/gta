// Общие константы клиента и сервера: тайминги, оружие, транспорт.

export const NET = {
  TICK_HZ: 20, // частота снапшотов сервера
  CLIENT_HZ: 20, // частота отправки своего состояния
  INTERP_DELAY: 100, // мс буфера интерполяции удалённых сущностей
  MAX_NAME: 16,
  MAX_CHAT: 120,
};

export const RESPAWN_TIME = 5000; // мс

export const WEAPONS = {
  fists: {
    id: 'fists', name: 'Кулаки', damage: 9, rpm: 140, mag: Infinity,
    range: 2.4, spread: 0, auto: false, melee: true, noise: 0,
  },
  pm: {
    id: 'pm', name: 'ПМ', damage: 20, rpm: 320, mag: 8,
    range: 70, spread: 0.014, auto: false, pellets: 1, noise: 1,
  },
  ak: {
    id: 'ak', name: 'АК-74', damage: 24, rpm: 600, mag: 30,
    range: 130, spread: 0.028, auto: true, pellets: 1, noise: 1,
  },
  obrez: {
    id: 'obrez', name: 'Обрез', damage: 11, rpm: 95, mag: 2,
    range: 26, spread: 0.09, auto: false, pellets: 8, noise: 1,
  },
};

export const WEAPON_ORDER = ['fists', 'pm', 'ak', 'obrez'];

export const VEHICLES = {
  zhiguli: {
    id: 'zhiguli', name: 'Жигули',
    size: [1.72, 1.42, 4.1], mass: 1, maxSpeed: 32, accel: 15, brake: 26,
    grip: 5.2, steer: 0.95, health: 100,
    colors: [0xc9d3d9, 0x2f6b45, 0x9a2f2f, 0xdad2b8, 0x2e4a7a, 0xe0d24a],
    seats: 2, body: 'sedan',
  },
  volga: {
    id: 'volga', name: 'Волга',
    size: [1.86, 1.5, 4.85], mass: 1.25, maxSpeed: 36, accel: 14, brake: 24,
    grip: 4.6, steer: 0.82, health: 120,
    colors: [0xe8e6e0, 0x1f2a33, 0x6b7d8a, 0x274b33],
    seats: 4, body: 'sedan',
  },
  niva: {
    id: 'niva', name: 'Нива',
    size: [1.75, 1.72, 3.75], mass: 1.15, maxSpeed: 28, accel: 16, brake: 25,
    grip: 6.0, steer: 1.05, health: 130,
    colors: [0xd8dbcf, 0x8a6f3f, 0x3f5c4a, 0xb03b2e],
    seats: 4, body: 'suv',
  },
  bukhanka: {
    id: 'bukhanka', name: 'УАЗ «Буханка»',
    size: [1.95, 2.15, 4.4], mass: 1.6, maxSpeed: 24, accel: 11, brake: 20,
    grip: 4.4, steer: 0.9, health: 180,
    colors: [0xdfe3e0, 0x4a5a3a, 0x8a9aa5],
    seats: 6, body: 'van',
  },
  gazelle: {
    id: 'gazelle', name: 'Газель',
    size: [2.05, 2.5, 5.6], mass: 1.9, maxSpeed: 27, accel: 10, brake: 19,
    grip: 3.9, steer: 0.72, health: 200,
    colors: [0xe6e6e6, 0x3a6fb0, 0xd6d0c0],
    seats: 3, body: 'truck',
  },
vaz2109: {
    id: 'vaz2109', name: 'ВАЗ-2109 «Девятка»',
    size: [1.65, 1.4, 4.0], mass: 0.95, maxSpeed: 34, accel: 16, brake: 26,
    grip: 5.4, steer: 1.0, health: 95,
    colors: [0xc9d3d9, 0x2f6b45, 0x8a1f1f, 0x1f2a33, 0xd8d24a],
    seats: 5, body: 'hatch',
  },
  priora: {
    id: 'priora', name: 'Лада Приора',
    size: [1.7, 1.44, 4.35], mass: 1.05, maxSpeed: 38, accel: 17, brake: 28,
    grip: 5.6, steer: 0.98, health: 105,
    colors: [0x1a1a1e, 0xb0b6ba, 0x2b4c7e, 0x8a1f1f],
    seats: 5, body: 'sedan',
  },
  vesta: {
    id: 'vesta', name: 'Лада Веста',
    size: [1.76, 1.5, 4.41], mass: 1.1, maxSpeed: 40, accel: 18, brake: 30,
    grip: 6.0, steer: 1.0, health: 115,
    colors: [0xd94a3a, 0xe8e6e0, 0x2a3b4a, 0x6b7d8a],
    seats: 5, body: 'sedan',
  },
  largus: {
    id: 'largus', name: 'Лада Ларгус',
    size: [1.75, 1.68, 4.47], mass: 1.2, maxSpeed: 32, accel: 14, brake: 25,
    grip: 5.0, steer: 0.9, health: 125,
    colors: [0xe8e6e0, 0x3a6fb0, 0xb9bfc0],
    seats: 7, body: 'van',
  },
  moskvich: {
    id: 'moskvich', name: 'Москвич-412',
    size: [1.62, 1.48, 4.1], mass: 1.0, maxSpeed: 29, accel: 13, brake: 22,
    grip: 4.8, steer: 0.92, health: 95,
    colors: [0xd8d24a, 0x2f6b45, 0xc9d3d9, 0x8a5a2a],
    seats: 5, body: 'sedan',
  },
  zaporozhets: {
    id: 'zaporozhets', name: 'ЗАЗ-968 «Запорожец»',
    size: [1.54, 1.38, 3.77], mass: 0.85, maxSpeed: 24, accel: 11, brake: 20,
    grip: 4.4, steer: 1.08, health: 80,
    colors: [0x7fa8d0, 0xdad2b8, 0x9a2f2f, 0x2f6b45],
    seats: 4, body: 'hatch',
  },
  uazPatriot: {
    id: 'uazPatriot', name: 'УАЗ «Патриот»',
    size: [1.9, 1.91, 4.75], mass: 1.45, maxSpeed: 31, accel: 15, brake: 26,
    grip: 5.8, steer: 0.95, health: 160,
    colors: [0x1f2a33, 0xe8e6e0, 0x4a5a3a, 0x8a9aa5],
    seats: 5, body: 'suv',
  },
  sobol: {
    id: 'sobol', name: 'ГАЗ «Соболь»',
    size: [1.98, 2.2, 4.81], mass: 1.5, maxSpeed: 28, accel: 12, brake: 22,
    grip: 4.6, steer: 0.85, health: 165,
    colors: [0xe6e6e6, 0x3a6fb0, 0xd6d0c0],
    seats: 6, body: 'van',
  },
  kamaz: {
    id: 'kamaz', name: 'КамАЗ-5320',
    size: [2.5, 3.0, 7.4], mass: 3.2, maxSpeed: 25, accel: 8, brake: 16,
    grip: 3.4, steer: 0.6, health: 320,
    colors: [0x2f6b45, 0x8a5a2a, 0x3a6fb0, 0xc9c3b4],
    seats: 3, body: 'heavy',
  },
  paz: {
    id: 'paz', name: 'ПАЗ-3205',
    size: [2.4, 2.9, 7.0], mass: 3.0, maxSpeed: 24, accel: 8, brake: 17,
    grip: 3.5, steer: 0.62, health: 300,
    colors: [0xe0c840, 0xe8e6e0, 0x3a6fb0],
    seats: 25, body: 'bus',
  },
  // Иномарки: модели Kenney Car Kit (CC0). Габариты заданы в метрах, модель
  // подгоняется под них — физика и картинка всегда совпадают.
  hatchIm: {
    id: 'hatchIm', name: 'Хэтчбек', size: [1.72, 1.44, 4.05], mass: 1.0,
    maxSpeed: 40, accel: 18, brake: 30, grip: 6.0, steer: 1.02, health: 105,
    colors: [0xd94a3a, 0xe8e6e0, 0x2a3b4a, 0x6b7d8a, 0x1a1a1e],
    seats: 5, body: 'hatch', foreign: true,
  },
  sedanIm: {
    id: 'sedanIm', name: 'Седан', size: [1.8, 1.46, 4.6], mass: 1.15,
    maxSpeed: 42, accel: 17, brake: 29, grip: 5.8, steer: 0.94, health: 115,
    colors: [0xe8e6e0, 0x1f2a33, 0x8a9aa5, 0x2b4c7e, 0x9a2f2f],
    seats: 5, body: 'sedan', foreign: true,
  },
  sportIm: {
    id: 'sportIm', name: 'Спорт-седан', size: [1.84, 1.4, 4.68], mass: 1.1,
    maxSpeed: 48, accel: 22, brake: 33, grip: 6.6, steer: 1.0, health: 110,
    colors: [0x1a1a1e, 0xd94a3a, 0xe0d24a, 0xb0b6ba],
    seats: 4, body: 'sedan', foreign: true,
  },
  coupeIm: {
    id: 'coupeIm', name: 'Пикап', size: [1.92, 1.95, 4.9], mass: 1.5,
    maxSpeed: 33, accel: 13, brake: 24, grip: 5.0, steer: 0.84, health: 165,
    colors: [0xe8e6e0, 0x2b4c7e, 0x8a5a2a, 0x4a5a3a],
    seats: 3, body: 'truck', foreign: true,
  },
  crossIm: {
    id: 'crossIm', name: 'Кроссовер', size: [1.86, 1.72, 4.55], mass: 1.3,
    maxSpeed: 38, accel: 16, brake: 27, grip: 6.2, steer: 0.96, health: 140,
    colors: [0xb9bfc0, 0x2f4a3a, 0x1f2a33, 0xd6d0c0],
    seats: 5, body: 'suv', foreign: true,
  },
  suvIm: {
    id: 'suvIm', name: 'Внедорожник', size: [1.96, 1.86, 4.92], mass: 1.5,
    maxSpeed: 36, accel: 15, brake: 26, grip: 6.4, steer: 0.9, health: 175,
    colors: [0x1a1a1e, 0xe8e6e0, 0x4a5a3a, 0x8a9aa5],
    seats: 7, body: 'suv', foreign: true,
  },
  minivanIm: {
    id: 'minivanIm', name: 'Минивэн', size: [1.9, 1.95, 4.75], mass: 1.4,
    maxSpeed: 33, accel: 13, brake: 24, grip: 5.2, steer: 0.86, health: 150,
    colors: [0xd6d0c0, 0x3a6fb0, 0xb9bfc0],
    seats: 7, body: 'van', foreign: true,
  },
  vanIm: {
    id: 'vanIm', name: 'Фургон', size: [2.02, 2.4, 5.35], mass: 1.8,
    maxSpeed: 30, accel: 11, brake: 21, grip: 4.4, steer: 0.76, health: 200,
    colors: [0xe6e6e6, 0xd94a3a, 0x3a6fb0],
    seats: 3, body: 'van', foreign: true,
  },
  truckIm: {
    id: 'truckIm', name: 'Грузовик', size: [2.35, 2.85, 6.6], mass: 2.8,
    maxSpeed: 27, accel: 9, brake: 18, grip: 3.6, steer: 0.64, health: 300,
    colors: [0x2b4c7e, 0xe6e6e6, 0x8a5a2a],
    seats: 3, body: 'heavy', foreign: true,
  },
  taxiIm: {
    id: 'taxiIm', name: 'Такси', size: [1.8, 1.62, 4.6], mass: 1.15,
    maxSpeed: 40, accel: 16, brake: 28, grip: 5.6, steer: 0.94, health: 120,
    colors: [0xe0c840],
    seats: 5, body: 'sedan', foreign: true,
  },
  dps: {
    id: 'dps', name: 'ДПС',
    size: [1.86, 1.5, 4.85], mass: 1.25, maxSpeed: 40, accel: 18, brake: 28,
    grip: 5.6, steer: 0.95, health: 150,
    colors: [0xf2f2f2],
    seats: 4, body: 'sedan', police: true,
  },
};

const DOMESTIC_CARS = [
  'zhiguli', 'vaz2109', 'priora', 'vesta', 'largus', 'moskvich', 'zaporozhets',
  'volga', 'niva', 'uazPatriot', 'bukhanka', 'gazelle', 'sobol', 'kamaz', 'paz',
];

const FOREIGN_CARS = [
  'hatchIm', 'sedanIm', 'sportIm', 'coupeIm', 'crossIm', 'suvIm',
  'minivanIm', 'vanIm', 'truckIm', 'taxiIm',
];

/**
 * Из этого списка случайно выбираются машины на улицах. Доли заданы
 * повторами: 10 иномарок по 7 записей против 15 наших по 2 — ровно 70 на 30.
 */
export const VEHICLE_ORDER = [
  ...FOREIGN_CARS.flatMap((id) => Array(7).fill(id)),
  ...DOMESTIC_CARS.flatMap((id) => Array(2).fill(id)),
];

export const WANTED = {
  MAX: 5,
  DECAY_MS: 22000, // без преступлений — минус звезда каждые N мс
  SHOT_FIRED: 0.12,
  HIT_PLAYER: 0.5,
  KILL_PLAYER: 1.4,
  RUN_OVER: 0.9,
  CAR_THEFT: 0.35,
  HIT_COP: 0.8,
  KILL_COP: 1.2,
};

export const PICKUP_TYPES = {
  health: { id: 'health', name: 'Аптечка', respawn: 25000 },
  armor: { id: 'armor', name: 'Бронежилет', respawn: 35000 },
  ak: { id: 'ak', name: 'АК-74', respawn: 30000 },
  obrez: { id: 'obrez', name: 'Обрез', respawn: 30000 },
  cash: { id: 'cash', name: 'Деньги', respawn: 18000 },
};

export const PLAYER = {
  height: 1.8,
  radius: 0.42,
  walkSpeed: 3.1,
  runSpeed: 6.4,
  maxHealth: 100,
  maxArmor: 100,
  jump: 5.4,
  gravity: 22,
};

export function clampName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, NET.MAX_NAME) || 'Гость';
}

export function sanitizeChat(text) {
  return String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NET.MAX_CHAT);
}
