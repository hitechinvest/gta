// Знаковые здания и памятники города.
//
// Каждая запись — компактное описание: габариты, тип фасада и набор деталей
// (колоннада, купола, башни, шпиль, зубцы, стеклянный купол). Рендер собирает
// здание из этих признаков, поэтому новый ориентир добавляется одной строкой.
//
// Прототипы взяты с реальных зданий Йошкар-Олы и типовой застройки
// российских городов: администрации, театры, вокзалы, дворцы культуры.

export const LANDMARKS = [
  // --- центр, Патриаршая площадь и набережная -------------------------------
  { id: 'gallery', name: 'Национальная художественная галерея', w: 30, d: 18, h: 18,
    kind: 'flemish', color: 0xb85a45, sign: 'ГАЛЕРЕЯ',
    features: { crenels: true }, tower: { r: 4, h: 30, spire: 12, dx: -13, dz: -7 } },
  { id: 'wedding', name: 'Дворец бракосочетаний', w: 22, d: 16, h: 16,
    kind: 'flemish', color: 0xa8443a, sign: 'ЗАГС',
    features: { spire: 14, spireColor: 0x2e4a6e } },
  { id: 'opera', name: 'Театр оперы и балета', w: 34, d: 22, h: 19,
    kind: 'stalinka', color: 0xd8c39a, sign: 'ОПЕРА И БАЛЕТ',
    features: { columns: true } },
  { id: 'drama', name: 'Марийский драмтеатр', w: 30, d: 20, h: 17,
    kind: 'stalinka', color: 0xd6cba8, sign: 'ДРАМТЕАТР', features: { columns: true } },
  { id: 'philharmonic', name: 'Филармония', w: 26, d: 18, h: 16,
    kind: 'stalinka', color: 0xd9b26a, sign: 'ФИЛАРМОНИЯ', features: { columns: true } },
  { id: 'museum', name: 'Национальный музей', w: 24, d: 16, h: 14,
    kind: 'stalinka', color: 0xc98f5f, sign: 'МУЗЕЙ', features: { columns: true } },

  // --- власть и общественные здания -----------------------------------------
  { id: 'government', name: 'Дом Правительства', w: 36, d: 20, h: 24,
    kind: 'admin', color: 0xd9c9a8, sign: 'ПРАВИТЕЛЬСТВО', features: { columns: true } },
  { id: 'cityhall', name: 'Городская администрация', w: 28, d: 18, h: 18,
    kind: 'admin', color: 0xd8c39a, sign: 'АДМИНИСТРАЦИЯ', features: { columns: true } },
  { id: 'court', name: 'Верховный суд', w: 26, d: 18, h: 17,
    kind: 'stalinka', color: 0xd6cba8, sign: 'СУД', features: { columns: true } },
  { id: 'police', name: 'Управление МВД', w: 24, d: 16, h: 16,
    kind: 'stalinka', color: 0xbf8b62, sign: 'МВД' },
  { id: 'post', name: 'Главпочтамт', w: 22, d: 16, h: 15,
    kind: 'stalinka', color: 0xd9b26a, sign: 'ПОЧТАМТ' },
  { id: 'bank', name: 'Национальный банк', w: 20, d: 18, h: 20,
    kind: 'stalinka', color: 0xd8c39a, sign: 'БАНК', features: { columns: true } },

  // --- образование и наука ---------------------------------------------------
  { id: 'university', name: 'Марийский госуниверситет', w: 38, d: 20, h: 22,
    kind: 'stalinka', color: 0xd9c9a8, sign: 'УНИВЕРСИТЕТ', features: { columns: true } },
  { id: 'techuni', name: 'Технологический университет', w: 32, d: 18, h: 20,
    kind: 'panel', color: 0xc4b9a6, sign: 'ПОЛИТЕХ' },
  { id: 'library', name: 'Национальная библиотека', w: 26, d: 20, h: 16,
    kind: 'stalinka', color: 0xd6cba8, sign: 'БИБЛИОТЕКА', features: { columns: true } },
  { id: 'school', name: 'Школа №1', w: 30, d: 16, h: 13, kind: 'khrushchevka',
    color: 0xdcd7c2, brick: true, sign: 'ШКОЛА №1' },
  { id: 'planetarium', name: 'Планетарий', w: 18, d: 18, h: 12,
    kind: 'panel', color: 0xbfc7cc, sign: 'ПЛАНЕТАРИЙ', features: { glassRoof: true } },

  // --- культура и досуг ------------------------------------------------------
  { id: 'circus', name: 'Цирк', w: 26, d: 26, h: 14,
    kind: 'panel', color: 0xd3cbb8, sign: 'ЦИРК', features: { glassRoof: true } },
  { id: 'palace', name: 'Дворец культуры', w: 32, d: 20, h: 16,
    kind: 'stalinka', color: 0xd8c39a, sign: 'ДК ЛЕНИНА', features: { columns: true } },
  { id: 'cinema', name: 'Кинотеатр «Россия»', w: 24, d: 18, h: 12,
    kind: 'panel', color: 0xc9c3b4, sign: 'КИНОТЕАТР РОССИЯ' },
  { id: 'sport', name: 'Дворец спорта', w: 34, d: 24, h: 15,
    kind: 'factory', color: 0x8c9298, sign: 'ДВОРЕЦ СПОРТА' },
  { id: 'pool', name: 'Бассейн «Дельфин»', w: 26, d: 18, h: 11,
    kind: 'panel', color: 0xbcc4c8, sign: 'БАССЕЙН' },
  { id: 'market', name: 'Центральный рынок', w: 30, d: 22, h: 10,
    kind: 'factory', color: 0xa3927f, sign: 'ЦЕНТРАЛЬНЫЙ РЫНОК' },
  { id: 'univermag', name: 'Универмаг', w: 28, d: 20, h: 14,
    kind: 'panel', color: 0xc9c0ad, sign: 'УНИВЕРМАГ' },
  { id: 'hotel', name: 'Гостиница «Йошкар-Ола»', w: 22, d: 16, h: 30,
    kind: 'series125', color: 0xd2cec0, accent: 0x8fa2a8, sign: 'ГОСТИНИЦА' },

  // --- транспорт и инфраструктура --------------------------------------------
  { id: 'station', name: 'Железнодорожный вокзал', w: 34, d: 18, h: 15,
    kind: 'stalinka', color: 0xd9b26a, sign: 'ВОКЗАЛ',
    features: { columns: true, spire: 10, spireColor: 0x7a3a34 } },
  { id: 'busstation', name: 'Автовокзал', w: 26, d: 18, h: 11,
    kind: 'panel', color: 0xbfc7cc, sign: 'АВТОВОКЗАЛ' },
  { id: 'hospital', name: 'Республиканская больница', w: 34, d: 18, h: 21,
    kind: 'khrushchevka', color: 0xe0dcc8, brick: false, sign: 'БОЛЬНИЦА' },
  { id: 'church2', name: 'Собор Воскресения', w: 18, d: 22, h: 16,
    kind: 'church', color: 0xf0eadc, sign: '', features: { domes: true } },
  { id: 'chapel', name: 'Часовня', w: 9, d: 9, h: 10,
    kind: 'church', color: 0xf0eadc, sign: '', features: { spire: 8, spireColor: 0xd8b24a } },
];

// --- памятники ---------------------------------------------------------------

export const MONUMENTS = [
  { id: 'lenin', type: 'monLenin', name: 'Памятник Ленину' },
  { id: 'obelisk', type: 'monObelisk', name: 'Обелиск Славы' },
  { id: 'tank', type: 'monTank', name: 'Танк на постаменте' },
  { id: 'plane', type: 'monPlane', name: 'Самолёт-памятник' },
  { id: 'rocket', type: 'monRocket', name: 'Ракета' },
  { id: 'locomotive', type: 'monLoco', name: 'Паровоз-памятник' },
  { id: 'flame', type: 'monFlame', name: 'Вечный огонь' },
  { id: 'horseman', type: 'monHorseman', name: 'Конный памятник' },
  { id: 'bust', type: 'monBust', name: 'Бюст героя' },
  { id: 'globe', type: 'monGlobe', name: 'Стела с шаром' },
];
