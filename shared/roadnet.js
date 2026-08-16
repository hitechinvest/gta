// Граф уличной сети из данных OSM: вершины ломаных становятся узлами,
// совпадающие координаты разных линий склеиваются в перекрёстки.
// Один и тот же граф нужен и пешеходам (тротуары), и ДПС (проезжая часть),
// поэтому модуль общий и не знает ничего про Three.js.

const CELL = 48; // размер ячейки индекса: примерно длина квартала

// Проезды и дворовые заезды (service) держим в сети ДПС: без них связность
// центра падает с 92 до 79 процентов и патруль упирается в тупики.
const DRIVABLE = ['residential', 'secondary', 'tertiary', 'primary', 'trunk',
  'unclassified', 'living_street', 'service'];
const WALKABLE = ['footway', 'pedestrian', 'path', 'steps', 'living_street', 'service',
  'residential', 'secondary', 'tertiary', 'primary', 'unclassified'];

// По этим линиям ходят посередине: это уже тротуары и дорожки.
const FOOT_KINDS = new Set(['footway', 'pedestrian', 'path', 'steps', 'living_street']);

export const NET_DRIVE = { kinds: DRIVABLE, foot: false };
export const NET_WALK = { kinds: WALKABLE, foot: true };

/**
 * Строит граф по ломаным улиц. Узлы склеиваются по сетке в полметра —
 * OSM отдаёт координаты с округлением, и точное сравнение теряло бы часть
 * перекрёстков.
 */
export function buildNet(roads, { kinds, foot = false } = NET_DRIVE) {
  const allowed = new Set(kinds);
  const nodes = [];
  const byKey = new Map();
  const grid = new Map();

  function nodeAt(x, z) {
    const key = `${Math.round(x * 2)}:${Math.round(z * 2)}`;
    let i = byKey.get(key);
    if (i === undefined) {
      i = nodes.length;
      nodes.push({ x, z, links: [] });
      byKey.set(key, i);
      const gk = `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
      let bucket = grid.get(gk);
      if (!bucket) grid.set(gk, bucket = []);
      bucket.push(i);
    }
    return i;
  }

  for (const road of roads || []) {
    if (!allowed.has(road.k) || !road.p || road.p.length < 2) continue;
    // Пешеход идёт по тротуару вдоль проезжей части, а не по осевой.
    // Запас к полуширине берём с избытком: иначе поток сбивает пешеходов,
    // идущих по краю проезжей части.
    const offset = foot && !FOOT_KINDS.has(road.k)
      ? Math.min(10, road.w / 2 + 2.2)
      : 0;
    for (let i = 1; i < road.p.length; i++) {
      const [ax, az] = road.p[i - 1];
      const [bx, bz] = road.p[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.6) continue;
      const a = nodeAt(ax, az);
      const b = nodeAt(bx, bz);
      if (a === b) continue;
      const link = { len, offset, kind: road.k, name: road.n || '', width: road.w };
      nodes[a].links.push({ ...link, to: b });
      nodes[b].links.push({ ...link, to: a });
    }
  }

  markComponents(nodes);
  return { nodes, grid, cell: CELL };
}

/**
 * Помечает связные куски сети. Улицы центра распадаются на острова, и без
 * метки экипаж мог родиться там, откуда до игрока дороги нет вовсе.
 */
function markComponents(nodes) {
  for (const n of nodes) n.comp = -1;
  let comp = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].comp >= 0 || !nodes[i].links.length) continue;
    const stack = [i];
    nodes[i].comp = comp;
    while (stack.length) {
      const c = stack.pop();
      for (const l of nodes[c].links) {
        if (nodes[l.to].comp < 0) {
          nodes[l.to].comp = comp;
          stack.push(l.to);
        }
      }
    }
    comp += 1;
  }
}

/** Ближайший узел графа. Перебираем только соседние ячейки индекса. */
export function nearestNode(net, x, z, maxDist = 80) {
  const rings = Math.max(1, Math.ceil(maxDist / net.cell));
  const gx = Math.floor(x / net.cell);
  const gz = Math.floor(z / net.cell);
  let best = -1;
  let bestD = maxDist;
  for (let dx = -rings; dx <= rings; dx++) {
    for (let dz = -rings; dz <= rings; dz++) {
      const bucket = net.grid.get(`${gx + dx}:${gz + dz}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const n = net.nodes[i];
        const d = Math.hypot(n.x - x, n.z - z);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
  }
  return best >= 0 ? { index: best, dist: bestD, node: net.nodes[best] } : null;
}

/** Случайный узел в кольце [minDist, maxDist] вокруг точки. */
export function randomNodeNear(net, x, z, minDist, maxDist, comp = null) {
  const rings = Math.max(1, Math.ceil(maxDist / net.cell));
  const gx = Math.floor(x / net.cell);
  const gz = Math.floor(z / net.cell);
  const found = [];
  for (let dx = -rings; dx <= rings; dx++) {
    for (let dz = -rings; dz <= rings; dz++) {
      const bucket = net.grid.get(`${gx + dx}:${gz + dz}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const n = net.nodes[i];
        if (!n.links.length) continue;
        if (comp !== null && n.comp !== comp) continue;
        const d = Math.hypot(n.x - x, n.z - z);
        if (d >= minDist && d <= maxDist) found.push(i);
      }
    }
  }
  return found.length ? found[Math.floor(Math.random() * found.length)] : -1;
}

/**
 * Следующее ребро на перекрёстке. Разворот берём только в тупике —
 * иначе персонаж топчется на месте.
 */
export function pickNextLink(net, nodeIndex, cameFrom, forwardX = 0, forwardZ = 0) {
  const node = net.nodes[nodeIndex];
  if (!node || !node.links.length) return null;
  const options = node.links.filter((l) => l.to !== cameFrom);
  const pool = options.length ? options : node.links;
  if (pool.length === 1) return pool[0];

  // Небольшое предпочтение прямому направлению: движение выглядит осмысленным.
  let best = null;
  let bestScore = -Infinity;
  for (const l of pool) {
    const t = net.nodes[l.to];
    const dx = t.x - node.x;
    const dz = t.z - node.z;
    const len = Math.hypot(dx, dz) || 1;
    const straight = (dx / len) * forwardX + (dz / len) * forwardZ;
    const score = straight * 0.8 + Math.random();
    if (score > bestScore) { bestScore = score; best = l; }
  }
  return best;
}

/**
 * Точка на текущем ребре с боковым смещением (тротуар, полоса).
 * Состояние: { from, to, link, t, side }. У перекрёстков и тупиков смещение
 * сходит на нет — тротуары разных улиц сходятся к одной точке, и без этого
 * персонаж прыгал бы поперёк проезжей части.
 */
export function netPoint(net, s, ramp = 6, out = { x: 0, z: 0, yaw: 0 }) {
  const a = net.nodes[s.from];
  const b = net.nodes[s.to];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const fx = dx / len;
  const fz = dz / len;

  let k = 1;
  if (a.links.length !== 2) k = Math.min(k, Math.min(1, (s.t * len) / ramp));
  if (b.links.length !== 2) k = Math.min(k, Math.min(1, ((1 - s.t) * len) / ramp));
  const off = (s.link?.offset || 0) * (s.side || 0) * k;

  out.x = a.x + dx * s.t + fz * off;
  out.z = a.z + dz * s.t - fx * off;
  out.yaw = Math.atan2(fx, fz);
  return out;
}

/** Продвижение по сети с переходом на следующее ребро на перекрёстке. */
export function netAdvance(net, s, dist) {
  let remaining = dist;
  for (let guard = 0; guard < 6 && remaining > 0; guard++) {
    const a = net.nodes[s.from];
    const b = net.nodes[s.to];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    s.t += remaining / len;
    if (s.t < 1) return true;

    remaining = (s.t - 1) * len;
    const next = pickNextLink(net, s.to, s.from, (b.x - a.x) / len, (b.z - a.z) / len);
    if (!next) { s.t = 1; return false; }
    s.from = s.to;
    s.to = next.to;
    s.link = next;
    s.t = 0;
  }
  return true;
}

/** Стартовое состояние на случайном ребре рядом с точкой. */
export function netSpawn(net, x, z, minDist, maxDist) {
  const from = randomNodeNear(net, x, z, minDist, maxDist);
  if (from < 0) return null;
  const node = net.nodes[from];
  const link = node.links[Math.floor(Math.random() * node.links.length)];
  if (!link) return null;
  return {
    from, to: link.to, link, t: Math.random() * 0.4,
    side: Math.random() < 0.5 ? 1 : -1,
  };
}

/** A* по графу: маршрут узлов от старта к цели. */
export function findPath(net, start, goal, limit = 4000) {
  if (start === goal) return [start];
  const nodes = net.nodes;
  // Разные острова сети — искать нечего, и незачем обходить полграфа.
  if (nodes[start].comp !== nodes[goal].comp) return null;
  const gScore = new Map([[start, 0]]);
  const cameFrom = new Map();
  const open = [{ i: start, f: dist(nodes[start], nodes[goal]) }];
  let steps = 0;

  while (open.length && steps++ < limit) {
    // Очередь короткая (сотни узлов), поэтому обходимся линейным поиском.
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0].i;
    if (cur === goal) {
      const path = [cur];
      let c = cur;
      while (cameFrom.has(c)) { c = cameFrom.get(c); path.push(c); }
      return path.reverse();
    }
    const base = gScore.get(cur) ?? Infinity;
    for (const l of nodes[cur].links) {
      const g = base + l.len;
      if (g >= (gScore.get(l.to) ?? Infinity)) continue;
      gScore.set(l.to, g);
      cameFrom.set(l.to, cur);
      open.push({ i: l.to, f: g + dist(nodes[l.to], nodes[goal]) });
    }
  }
  return null;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
