// Генератор фасадных текстур зданий из фотографий.
//
//   node scripts/facade-tool.js fetch          — скачать оригиналы снимков
//   node scripts/facade-tool.js build          — собрать текстуры и facades.json
//   node scripts/facade-tool.js build --debug  — плюс раскладка этапов обработки
//
// Зачем инструмент. Раньше снимок просто натягивался на дом целиком: вместе
// с фасадом на стену попадали небо, дорога и деревья, а окна растягивались
// на всю высоту дома. Здесь снимок сначала разбирается: где кончается небо,
// под каким углом снят фасад, какого размера этаж и оконная ось. После
// этого текстура режется по целому числу этажей и осей — её можно повторять
// по стене метрами, а не тянуть от земли до карниза.
//
// Источники. Только свободные лицензии: фотографии Викисклада (CC BY / CC
// BY-SA) и любые снимки, которые вы положите сами. Снимки Яндекс.Карт и
// Google Maps сюда подключать нельзя — их условия запрещают выгрузку и
// производные работы.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'assets/facade-src');
const OUT_DIR = path.join(ROOT, 'public/textures/buildings');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
const OSM = path.join(ROOT, 'shared/city-osm.json');
const DEBUG_DIR = path.join(ROOT, 'assets/facade-debug');

// Метрика застройки: этаж жилого дома около трёх метров, оконная ось —
// расстояние между осями окон — около трёх с небольшим. По ним текстура
// переводится из пикселей в метры.
const FLOOR_M = 3.1;
const BAY_M = 3.3;
const MAX_W = 1024;

const args = process.argv.slice(2);
const cmd = args[0] || 'build';
const hasFlag = (f) => args.includes(`--${f}`);

// --- картинка ---------------------------------------------------------------

function readImage(file) {
  const raw = jpeg.decode(fs.readFileSync(file), { useTArray: true });
  return { w: raw.width, h: raw.height, d: raw.data };
}

function writeImage(file, img, quality = 84) {
  const enc = jpeg.encode({ width: img.w, height: img.h, data: img.d }, quality);
  fs.writeFileSync(file, enc.data);
}

const at = (img, x, y) => (y * img.w + x) * 4;

function crop(img, x0, y0, w, h) {
  const out = { w, h, d: new Uint8Array(w * h * 4) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = at(img, Math.min(img.w - 1, x0 + x), Math.min(img.h - 1, y0 + y));
      const t = (y * w + x) * 4;
      out.d[t] = img.d[s];
      out.d[t + 1] = img.d[s + 1];
      out.d[t + 2] = img.d[s + 2];
      out.d[t + 3] = 255;
    }
  }
  return out;
}

/** Уменьшение усреднением по блоку: без него на текстуре лезет муар. */
function resize(img, w, h) {
  const out = { w, h, d: new Uint8Array(w * h * 4) };
  const sx = img.w / w;
  const sy = img.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let yy = y0; yy < y1 && yy < img.h; yy++) {
        for (let xx = x0; xx < x1 && xx < img.w; xx++) {
          const s = at(img, xx, yy);
          r += img.d[s]; g += img.d[s + 1]; b += img.d[s + 2]; n++;
        }
      }
      const t = (y * w + x) * 4;
      out.d[t] = r / n; out.d[t + 1] = g / n; out.d[t + 2] = b / n; out.d[t + 3] = 255;
    }
  }
  return out;
}

/**
 * Сдвиг строк и столбцов (скос). Фасад почти всегда снят с угла и снизу,
 * поэтому ряды окон идут по диагонали. Полноценное исправление перспективы
 * требует поиска точек схода; скоса хватает, чтобы ряды и оси окон встали
 * параллельно краям кадра — а именно от этого зависит, можно ли повторять
 * текстуру по стене.
 */
function shear(img, ky, kx) {
  const out = { w: img.w, h: img.h, d: new Uint8Array(img.w * img.h * 4) };
  const cx = img.w / 2;
  const cy = img.h / 2;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      // Обратное отображение: берём исходную точку для каждой точки итога.
      const srcX = x + kx * (y - cy);
      const srcY = y + ky * (x - cx);
      const xi = Math.round(srcX);
      const yi = Math.round(srcY);
      const t = (y * img.w + x) * 4;
      if (xi < 0 || yi < 0 || xi >= img.w || yi >= img.h) {
        out.d[t + 3] = 0;
        continue;
      }
      const s = at(img, xi, yi);
      out.d[t] = img.d[s]; out.d[t + 1] = img.d[s + 1];
      out.d[t + 2] = img.d[s + 2]; out.d[t + 3] = 255;
    }
  }
  return out;
}

// --- разбор снимка ----------------------------------------------------------

/** Яркость и «зернистость»: карта модуля градиента, размытая по окну. */
function textureMap(img) {
  const n = img.w * img.h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * 4;
    lum[i] = (img.d[s] * 0.3 + img.d[s + 1] * 0.59 + img.d[s + 2] * 0.11);
  }
  const grad = new Float32Array(n);
  for (let y = 1; y < img.h - 1; y++) {
    for (let x = 1; x < img.w - 1; x++) {
      const i = y * img.w + x;
      grad[i] = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + img.w] - lum[i - img.w]);
    }
  }
  // Размытие боксом: одиночный контур провода не должен считаться фактурой.
  const box = new Float32Array(n);
  const r = 3;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(img.h - 1, y + r); yy += 2) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(img.w - 1, x + r); xx += 2) {
          sum += grad[yy * img.w + xx]; cnt++;
        }
      }
      box[y * img.w + x] = sum / cnt;
    }
  }
  return box;
}

/**
 * Небо: либо голубое (синего заметно больше красного), либо пересвеченное
 * белёсое. Одного цвета мало — на этом прежняя обрезка и ломалась: светлая
 * штукатурка пасмурного дня по цвету неотличима от белого неба, и половина
 * снимков обрезалась до узкой полоски. Поэтому к цвету добавлено условие
 * гладкости: у неба нет деталей, у стены есть окна, швы и карнизы.
 */
function skyMask(img) {
  const mask = new Uint8Array(img.w * img.h);
  const tex = textureMap(img);
  let sum = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    const s = i * 4;
    sum += (img.d[s] + img.d[s + 1] + img.d[s + 2]) / 3;
  }
  const mean = sum / (img.w * img.h);
  for (let i = 0; i < img.w * img.h; i++) {
    const s = i * 4;
    const r = img.d[s]; const g = img.d[s + 1]; const b = img.d[s + 2];
    const v = (r + g + b) / 3;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const blue = b - r > 14 && b > 110 && v > 90;
    const overcast = max - min < 26 && v > Math.max(165, mean * 1.12);
    mask[i] = ((blue || overcast) && tex[i] < 9) ? 1 : 0;
  }
  return mask;
}

/** Доля пикселей маски в строке. */
function rowFraction(mask, w, y) {
  let n = 0;
  for (let x = 0; x < w; x++) n += mask[y * w + x];
  return n / w;
}

/**
 * Глубина неба по каждому столбцу: сколько строк сверху занято небом.
 * Считаем именно по столбцам, потому что крыша почти никогда не бывает
 * горизонтальной — по строкам граница размазывается.
 */
function skyDepths(mask, w, h) {
  const depths = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    let y = 0;
    let gap = 0;
    for (; y < h; y++) {
      if (mask[y * w + x]) { gap = 0; continue; }
      gap++;
      if (gap >= 4) break; // четыре не-небесных пикселя подряд — это уже дом
    }
    depths[x] = Math.max(0, y - 4);
  }
  return depths;
}

function quantile(arr, q) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/** Профиль «тёмного» по строкам или столбцам: окна темнее стены. */
function darkProfile(img, axis) {
  const n = axis === 'rows' ? img.h : img.w;
  const m = axis === 'rows' ? img.w : img.h;
  const prof = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let dark = 0;
    let seen = 0;
    for (let j = 0; j < m; j++) {
      const x = axis === 'rows' ? j : i;
      const y = axis === 'rows' ? i : j;
      const s = at(img, x, y);
      if (img.d[s + 3] === 0) continue;
      seen++;
      const v = (img.d[s] + img.d[s + 1] + img.d[s + 2]) / 3;
      if (v < 92) dark++;
    }
    prof[i] = seen ? dark / seen : 0;
  }
  return prof;
}

function smooth(prof, window) {
  const out = new Float64Array(prof.length);
  for (let i = 0; i < prof.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(prof.length - 1, i + window); j++) {
      sum += prof[j]; n++;
    }
    out[i] = sum / n;
  }
  return out;
}

/**
 * Полоса фасада: самый длинный участок, где есть окна. Обрезать поля по
 * краям оказалось мало — на снимке администрации дорога занимает больше
 * половины кадра, а на других полкадра забирает газон. Окна же дают
 * тёмные пятна, которых нет ни у асфальта, ни у неба, ни у травы, поэтому
 * фасад ищем как участок с их устойчивым присутствием. Разрывы в пару
 * процентов высоты терпим: между этажами идёт глухой простенок.
 */
function windowBand(prof, gapAllowed, minLen) {
  const p90 = quantile(prof, 0.9);
  const thr = Math.max(0.015, p90 * 0.3);
  let best = null;
  let start = -1;
  let gap = 0;
  for (let i = 0; i < prof.length; i++) {
    if (prof[i] >= thr) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > gapAllowed) {
        const end = i - gap;
        if (!best || end - start > best.end - best.start) best = { start, end };
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) {
    const end = prof.length - 1;
    if (!best || end - start > best.end - best.start) best = { start, end };
  }
  if (!best || best.end - best.start < minLen) return { start: 0, end: prof.length - 1 };
  return best;
}

/** Вычитание скользящего среднего: убирает общий перепад освещения. */
function detrend(prof, window) {
  const out = new Float64Array(prof.length);
  for (let i = 0; i < prof.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(prof.length - 1, i + window); j++) {
      sum += prof[j]; n++;
    }
    out[i] = prof[i] - sum / n;
  }
  return out;
}

/** Резкость профиля: у выровненного снимка ряды окон дают высокий разброс. */
function contrast(prof) {
  let mean = 0;
  for (const v of prof) mean += v;
  mean /= prof.length;
  let acc = 0;
  for (const v of prof) acc += (v - mean) ** 2;
  return acc / prof.length;
}

/**
 * Угол скоса подбираем перебором: правильный тот, при котором ряды окон
 * дают самый резкий профиль. Это надёжнее поиска прямых — на фасаде полно
 * случайных линий (провода, тени, бордюры), а вот полосатость профиля
 * возникает только когда окна выстроились.
 */
function bestShear(img, axis, limit = 0.22) {
  let best = { k: 0, score: -1 };
  for (let k = -limit; k <= limit + 1e-9; k += Math.max(0.005, limit / 22)) {
    const test = Math.abs(k) < 1e-6 ? img : shear(img, axis === 'rows' ? k : 0, axis === 'rows' ? 0 : k);
    const prof = detrend(darkProfile(test, axis), Math.max(4, Math.round(test[axis === 'rows' ? 'h' : 'w'] / 12)));
    const score = contrast(prof);
    if (score > best.score) best = { k, score };
  }
  return best.k;
}

/**
 * Сколько этажей в полосе. Свободный поиск периода по автокорреляции
 * цеплялся то за переплёт окна, то за пояс между этажами и давал у
 * двухэтажного дома десять этажей. Поэтому проверяем только осмысленные
 * варианты: полоса делится ровно на один, два, три… этажа. Из близких по
 * качеству вариантов берём меньший — переплёт окна похож на этаж, но
 * этажей от этого не прибавляется.
 */
function bandCount(prof, maxCount, minCount = 1) {
  const d = detrend(prof, Math.max(4, Math.round(prof.length / 8)));
  let norm = 0;
  for (const v of d) norm += v * v;
  norm = norm || 1;
  let best = { count: minCount, score: 0, lag: Math.round(prof.length / minCount) };
  for (let n = minCount; n <= maxCount; n++) {
    const lag = Math.round(prof.length / n);
    if (lag < 8) break;
    let acc = 0;
    let cnt = 0;
    for (let i = 0; i + lag < d.length; i++) { acc += d[i] * d[i + lag]; cnt++; }
    const score = cnt ? (acc / cnt) / (norm / d.length) : 0;
    if (score > best.score * 1.12) best = { count: n, score, lag };
  }
  return best;
}

/** Фаза: сдвиг, при котором границы реза попадают в межоконные простенки. */
function bestPhase(prof, p, count) {
  const span = p * count;
  let best = { start: 0, score: Infinity };
  for (let start = 0; start + span <= prof.length; start++) {
    let acc = 0;
    for (let k = 0; k <= count; k++) acc += prof[Math.min(prof.length - 1, start + k * p)];
    if (acc < best.score) best = { start, score: acc };
  }
  return best.start;
}

// --- обработка одного снимка ------------------------------------------------

/**
 * Этажность домов из OSM по адресу. Для снимков, привязанных к конкретному
 * дому, число этажей известно из данных — и это надёжнее любого разбора
 * картинки: у карниза с лепниной автокорреляция легко насчитывает лишние
 * этажи. Используем как потолок, а не как точное значение: в кадр может
 * попасть не весь дом.
 */
function osmLevels() {
  if (!fs.existsSync(OSM)) return new Map();
  const data = JSON.parse(fs.readFileSync(OSM, 'utf8'));
  const map = new Map();
  for (const b of data.buildings || []) {
    if (!b.hn || !b.st) continue;
    const levels = b.l || Math.round(b.h / FLOOR_M);
    if (levels > 0) map.set(`${b.st}, ${b.hn}`, levels);
  }
  return map;
}

function processPhoto(img, name, debug, maxFloors = 10) {
  const steps = {};
  // 1. Небо. Режем ниже той высоты, на которой неба уже нет почти нигде:
  // оставить полоску неба на стене хуже, чем потерять карниз.
  const mask = skyMask(img);
  const depths = skyDepths(mask, img.w, img.h);
  let top = Math.min(Math.round(img.h * 0.55), quantile(depths, 0.94));
  while (top < img.h * 0.55 && rowFraction(mask, img.w, top) > 0.04) top += 2;

  // 2. Полоса фасада по окнам: и снизу (дорога, газон, машины), и по бокам
  // (деревья, соседние дома, пустое небо сбоку от здания).
  const body = crop(img, 0, top, img.w, img.h - top);
  const rowsRaw = smooth(darkProfile(body, 'rows'), Math.max(1, Math.round(body.h * 0.01)));
  const band = windowBand(rowsRaw, Math.round(body.h * 0.05), Math.round(body.h * 0.12));
  const bandTop = Math.max(0, band.start - Math.round(body.h * 0.02));
  const bandBottom = Math.min(body.h - 1, band.end + Math.round(body.h * 0.02));
  const strip = crop(body, 0, bandTop, body.w, bandBottom - bandTop + 1);

  const colsRaw = smooth(darkProfile(strip, 'cols'), Math.max(1, Math.round(strip.w * 0.01)));
  const side = windowBand(colsRaw, Math.round(strip.w * 0.06), Math.round(strip.w * 0.2));
  const left = Math.max(0, side.start - Math.round(strip.w * 0.01));
  const right = Math.min(strip.w - 1, side.end + Math.round(strip.w * 0.01));

  const cut = crop(strip, left, 0, Math.max(8, right - left + 1), strip.h);
  if (debug) steps.cut = cut;

  // 4. Скос: сперва по рядам, потом по осям окон. Наклон ограничиваем
  // формой полосы: на широкой и низкой полосе сильный скос съел бы её
  // целиком — поля, которые он оставляет пустыми, приходится отрезать.
  const maxKy = Math.min(0.22, (cut.h * 0.16 * 2) / Math.max(1, cut.w));
  const maxKx = Math.min(0.22, (cut.w * 0.16 * 2) / Math.max(1, cut.h));
  const ky = bestShear(cut, 'rows', maxKy);
  const kx = bestShear(cut, 'cols', maxKx);
  let flat = cut;
  if (Math.abs(ky) > 0.004 || Math.abs(kx) > 0.004) flat = shear(cut, ky, kx);
  const padY = Math.min(Math.floor(flat.h * 0.2), Math.ceil(Math.abs(ky) * flat.w / 2) + 1);
  const padX = Math.min(Math.floor(flat.w * 0.2), Math.ceil(Math.abs(kx) * flat.h / 2) + 1);
  flat = crop(flat, padX, padY, Math.max(8, flat.w - padX * 2), Math.max(8, flat.h - padY * 2));
  if (debug) steps.flat = flat;

  // 5. Этажи. Режем полосу на целое число этажей, чтобы её можно было
  // повторять по стене без стыка посреди окна.
  const rows = darkProfile(flat, 'rows');
  const cols = darkProfile(flat, 'cols');
  // На высокой полосе один этаж не бывает: полоса ловится по окнам, а
  // одноэтажный дом такой высоты в кадр не попадает.
  const fl = bandCount(rows, maxFloors, flat.h >= 260 ? 2 : 1);
  const floors = fl.count;
  let out = flat;
  if (fl.lag > 0 && fl.lag * floors <= out.h) {
    const start = bestPhase(rows, fl.lag, floors);
    out = crop(out, 0, start, out.w, fl.lag * floors);
  }
  // По горизонтали режем по оконным осям — тем же способом.
  const bc = bandCount(cols, 16);
  const bays = bc.count;
  if (bc.lag > 0 && bc.lag * bays <= out.w) {
    const start = bestPhase(cols, bc.lag, bays);
    out = crop(out, start, 0, bc.lag * bays, out.h);
  }

  // 6. Небо сбоку. На видах вдоль улицы дом занимает левую половину кадра,
  // а справа остаётся просвет: срезаем крайние столбцы, пока они небесные.
  {
    const m = skyMask(out);
    const colSky = new Float64Array(out.w);
    for (let x = 0; x < out.w; x++) {
      let n = 0;
      for (let y = 0; y < out.h; y++) n += m[y * out.w + x];
      colSky[x] = n / out.h;
    }
    let l = 0;
    let r = out.w - 1;
    const guard = Math.round(out.w * 0.42);
    while (l < guard && colSky[l] > 0.08) l++;
    while (out.w - 1 - r < guard && colSky[r] > 0.08) r--;
    if (l > 0 || r < out.w - 1) out = crop(out, l, 0, Math.max(8, r - l + 1), out.h);
  }

  // 7. Приводим к рабочему размеру: пропорции этажа сохраняем.
  const scale = Math.min(1, MAX_W / out.w, 512 / out.h);
  if (scale < 1) out = resize(out, Math.round(out.w * scale), Math.round(out.h * scale));
  if (debug) steps.out = out;

  // Проверка: если после всего в верхней полосе всё ещё небо — снимок
  // непригоден, лучше отдать его процедурному фасаду, чем клеить небо.
  const outSky = skyMask(out);
  let skyLeft = 0;
  for (let y = 0; y < Math.max(2, Math.round(out.h * 0.12)); y++) skyLeft += rowFraction(outSky, out.w, y);
  const skyShare = skyLeft / Math.max(1, Math.round(out.h * 0.12));

  // Годность снимка. На стену нельзя клеить ни небо, ни газон, ни узкую
  // полоску: лучше отдать дом процедурному фасаду. Зелень проверяем
  // отдельно — на одном снимке полоса «с окнами» нашлась в кроне дерева,
  // и дом уехал под траву. Окна ищем по доле тёмного: у глухой стены,
  // травы и асфальта её почти нет.
  let green = 0;
  let dark = 0;
  for (let i = 0; i < out.w * out.h; i++) {
    const s = i * 4;
    const r = out.d[s]; const g = out.d[s + 1]; const b = out.d[s + 2];
    if (g > r + 12 && g > b + 12) green++;
    if ((r + g + b) / 3 < 92) dark++;
  }
  const greenShare = green / (out.w * out.h);
  const darkShare = dark / (out.w * out.h);
  const reasons = [];
  if (skyShare > 0.1) reasons.push('небо');
  if (greenShare > 0.22) reasons.push('зелень');
  if (darkShare < 0.03) reasons.push('нет окон');
  if (out.h < 120 || out.w < 200) reasons.push('мелко');
  const usable = reasons.length === 0;

  return {
    image: out,
    steps,
    usable,
    reasons,
    greenShare: +greenShare.toFixed(3),
    darkShare: +darkShare.toFixed(3),
    floors,
    bays,
    skyShare: +skyShare.toFixed(3),
    shear: [+ky.toFixed(3), +kx.toFixed(3)],
    crop: { top, left, right, band: [bandTop, bandBottom] },
    // Высота плитки — по этажам, ширина — из пропорций самого снимка.
    // Считать ширину по числу оконных осей нельзя: ошибка в подсчёте осей
    // сплющивала текстуру, и окна превращались в вертикальные щели.
    tileW: +((Math.max(1, floors) * FLOOR_M * out.w) / out.h).toFixed(2),
    tileH: +(Math.max(1, floors) * FLOOR_M).toFixed(2),
    name,
  };
}

// --- команды ----------------------------------------------------------------

const UA = 'RayonyGame/0.1 (https://myonlinegame.gdesite.ru; +facade-tool)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function commons(params, tries = 6) {
  const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ format: 'json', ...params })}`;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (res.ok) return res.json();
    await sleep(4000 + i * 4000);
  }
  throw new Error('Викисклад не отвечает');
}

/** Скачивает оригиналы по списку из manifest.json — в нём есть ссылки. */
async function cmdFetch() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  fs.mkdirSync(SRC_DIR, { recursive: true });
  const entries = [...Object.entries(manifest.byAddress || {}), ...Object.entries(manifest.pool || {})];
  let ok = 0;
  for (const [key, rec] of entries) {
    const title = decodeURIComponent((rec.page || '').split('/wiki/')[1] || '');
    if (!title) continue;
    const target = path.join(SRC_DIR, `${rec.file.replace(/\.jpg$/, '')}.src.jpg`);
    if (fs.existsSync(target)) { ok++; continue; }
    try {
      const data = await commons({
        action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '1600',
      });
      const info = Object.values(data.query.pages)[0]?.imageinfo?.[0];
      if (!info) { console.log(`нет файла: ${key}`); continue; }
      const img = await fetch(info.thumburl || info.url, { headers: { 'User-Agent': UA } });
      fs.writeFileSync(target, Buffer.from(await img.arrayBuffer()));
      console.log(`${key} — ${info.width}x${info.height}`);
      ok++;
      await sleep(1000);
    } catch (err) {
      console.log(`${key}: ${err.message}`);
    }
  }
  console.log(`[фасады] оригиналов на диске: ${ok} из ${entries.length}`);
}

function cmdBuild() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const debug = hasFlag('debug');
  if (debug) fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const facades = { byAddress: {}, pool: [] };
  const levelsByAddress = osmLevels();
  const report = [];

  const entries = [
    ...Object.entries(manifest.byAddress || {}).map(([k, v]) => ({ key: k, rec: v, kind: 'address' })),
    ...(manifest.pool || []).map((v, i) => ({ key: v.kind || `pool${i}`, rec: v, kind: 'pool' })),
  ];

  for (const { key, rec, kind } of entries) {
    const src = path.join(SRC_DIR, `${rec.file.replace(/\.jpg$/, '')}.src.jpg`);
    const file = fs.existsSync(src) ? src : path.join(OUT_DIR, rec.file);
    if (!fs.existsSync(file)) { console.log(`нет снимка: ${key}`); continue; }

    const img = readImage(file);
    const levels = levelsByAddress.get(key);
    const res = processPhoto(img, rec.file, debug, levels ? levels + 1 : 10);
    const outName = rec.file.replace(/\.jpg$/, '') + '.facade.jpg';
    // Отбракованные не сохраняем: в игру они всё равно не попадут, а вес
    // репозитория поднимут. Причина отказа остаётся в facades.json.
    const outPath = path.join(OUT_DIR, outName);
    if (res.usable) writeImage(outPath, res.image);
    else if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    if (debug) {
      for (const [step, im] of Object.entries(res.steps)) {
        writeImage(path.join(DEBUG_DIR, `${rec.file.replace(/\.jpg$/, '')}.${step}.jpg`), im, 80);
      }
    }

    const entry = {
      file: outName,
      usable: res.usable,
      rejected: res.reasons.join(', ') || undefined,
      floors: res.floors,
      bays: res.bays,
      tileW: res.tileW,
      tileH: res.tileH,
      sky: res.skyShare,
      author: rec.author || '',
      license: rec.license || '',
      page: rec.page || '',
    };
    if (kind === 'address') facades.byAddress[key] = entry;
    else facades.pool.push({ ...entry, kind: rec.kind || '' });

    report.push(`${key}: ${img.w}x${img.h} -> ${res.image.w}x${res.image.h}, `
      + `этажей ${res.floors}${levels ? `/${levels} в OSM` : ''}, плитка ${res.tileW}x${res.tileH} м, неба ${res.skyShare}`
      + `, зелени ${res.greenShare}`
      + `${res.usable ? '' : ` — отбраковано: ${res.reasons.join(', ')}`}`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'facades.json'), JSON.stringify(facades, null, 1));
  console.log(report.join('\n'));
  const good = [...Object.values(facades.byAddress), ...facades.pool].filter((e) => e.usable).length;
  console.log(`[фасады] готово: ${Object.keys(facades.byAddress).length} адресных, `
    + `${facades.pool.length} общих; годных ${good}`);
}

if (cmd === 'fetch') await cmdFetch();
else if (cmd === 'build') cmdBuild();
else console.log('команды: fetch | build [--debug]');
