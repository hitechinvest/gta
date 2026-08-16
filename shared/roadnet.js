// Граф уличной сети из данных OSM: вершины ломаных становятся узлами,
// совпадающие координаты разных линий склеиваются в перекрёстки.
// Один и тот же граф нужен и пешеходам (тротуары), и ДПС (проезжая часть),
// поэтому модуль общий и не знает ничего про Three.js.

const CELL = 48; // размер ячейки индекса: примерно длина квартала

const DRIVABLE = ['residential', 'secondary', 'tertiary', 'primary', 'trunk', 'unclassified', 'living_street'];
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

  return { nodes, grid, cell: CELL };
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
export function randomNodeNear(net, x, z, minDist, maxDist) {
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

/** A* по графу: маршрут узлов от старта к цели. */
export function findPath(net, start, goal, limit = 4000) {
  if (start === goal) return [start];
  const nodes = net.nodes;
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
