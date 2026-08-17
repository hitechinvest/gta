// Городской трафик: машины едут по полосам, тормозят перед препятствием
// и поворачивают на перекрёстках. Живёт на клиенте, как и прохожие —
// это декорация, но именно она отличает город от макета.
import * as THREE from 'three';
import { CONFIG, roadCenter, snapToRoad } from '/shared/worldgen.js';
import { VEHICLE_ORDER, VEHICLES } from '/shared/protocol.js';
import { VehicleEntity } from './vehicle.js';
import { nearestRoad } from '/shared/osmworld.js';

// Половина машин в кадре должна стоять у обочины, чтобы было что угонять:
// движущийся поток держим чуть меньше, чем парковку (её наполняет сервер).
const MAX_CARS = 10;
const SPAWN_MIN = 60;
const SPAWN_MAX = 150;
const CELL = 96; // сторона ячейки индекса улиц
// Мягкая граница — за спиной у игрока, жёсткая — совсем далеко: машина
// не должна исчезать на глазах.
const DESPAWN_SOFT = 150;
const DESPAWN_HARD = 320;
const WRECK_TIME = 40; // сколько секунд разбитая машина стоит на дороге
const LANE = 4.2; // смещение от осевой линии: правостороннее движение

/**
 * Пересекаются ли кузова. Круг вокруг машины ловил бы встречную в соседней
 * полосе: на узкой улице полосы всего в трёх метрах. Поэтому меряем в
 * системе координат каждой машины по её длине и ширине.
 */
function overlap(a, b) {
  return boxHit(a, b) && boxHit(b, a);
}

function boxHit(car, other) {
  const dx = other.x - car.x;
  const dz = other.z - car.z;
  const cos = Math.cos(-car.yaw);
  const sin = Math.sin(-car.yaw);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const [w, , l] = car.def.size;
  const [ow, , ol] = other.def.size;
  return Math.abs(localX) < (w + ow) / 2 && Math.abs(localZ) < (l + ol) / 2;
}

export class Traffic {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.cars = [];
    this.seq = 0;
  }

  /** Полоса для направления: справа по ходу движения. */
  laneOffset(axis, dir) {
    // По оси Z «право» — это меньший X, по оси X — больший Z.
    return axis === 'z' ? -dir * LANE : dir * LANE;
  }

  /** Проезжие улицы реального города, разбитые на сегменты. */
  drivableRoads() {
    if (this.roads) return this.roads;
    const ok = ['residential', 'secondary', 'tertiary', 'primary', 'trunk', 'unclassified', 'living_street'];
    this.roads = (this.world.roads || []).filter((r) => ok.includes(r.k) && r.p.length > 1);
    return this.roads;
  }

  /**
   * Сетка сегментов по ячейкам. Улиц в городе три тысячи, и слепой выбор
   * случайной почти всегда попадал за километр от игрока: после расширения
   * мира поток из четырнадцати машин выродился в одну.
   */
  segmentGrid() {
    if (this.grid) return this.grid;
    this.grid = new Map();
    for (const road of this.drivableRoads()) {
      for (let i = 1; i < road.p.length; i++) {
        const [ax, az] = road.p[i - 1];
        const [bx, bz] = road.p[i];
        const key = `${Math.floor((ax + bx) / 2 / CELL)}:${Math.floor((az + bz) / 2 / CELL)}`;
        let cell = this.grid.get(key);
        if (!cell) this.grid.set(key, cell = []);
        cell.push({ road, i });
      }
    }
    return this.grid;
  }

  /** Сегменты в кольце спавна вокруг точки. */
  segmentsNear(cx, cz) {
    const grid = this.segmentGrid();
    const out = [];
    const r = Math.ceil(SPAWN_MAX / CELL);
    const gx = Math.floor(cx / CELL);
    const gz = Math.floor(cz / CELL);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const cell = grid.get(`${gx + dx}:${gz + dz}`);
        if (cell) out.push(...cell);
      }
    }
    return out;
  }

  /** Спавн на реальной улице: машина встаёт на сегмент и едет по нему. */
  spawnOnRoad(cx, cz) {
    const near = this.segmentsNear(cx, cz);
    if (!near.length) return;
    for (let tries = 0; tries < 60; tries++) {
      const { road, i } = near[Math.floor(Math.random() * near.length)];
      const [ax, az] = road.p[i - 1];
      const [bx, bz] = road.p[i];
      const t = Math.random();
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const d = Math.hypot(x - cx, z - cz);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;

      const forward = Math.random() < 0.5;
      const type = VEHICLE_ORDER[Math.floor(Math.random() * VEHICLE_ORDER.length)];
      const def = VEHICLES[type];
      const car = new VehicleEntity(this.scene, {
        i: `t${this.seq++}`, t: type,
        c: def.colors[Math.floor(Math.random() * def.colors.length)],
        x, z, r: Math.atan2(bx - ax, bz - az),
      });
      car.path = { road, seg: i, t, forward, cruise: 8 + Math.random() * 7 };
      car.speed = car.path.cruise;
      this.cars.push(car);
      return;
    }
  }

  /** Продвижение по ломаной улицы с переходом на соседний сегмент. */
  advance(car, dt) {
    const path = car.path;
    const road = path.road;
    let remaining = car.speed * dt;

    for (let guard = 0; guard < 8 && remaining > 0; guard++) {
      const i = path.seg;
      const [ax, az] = road.p[i - 1];
      const [bx, bz] = road.p[i];
      const segLen = Math.hypot(bx - ax, bz - az) || 1;
      const dir = path.forward ? 1 : -1;
      const step = remaining / segLen;
      path.t += step * dir;

      if (path.t > 1) {
        remaining = (path.t - 1) * segLen;
        path.t = 1;
        if (i < road.p.length - 1) path.seg = i + 1, path.t = 0;
        else { path.forward = false; path.t = 1; }
      } else if (path.t < 0) {
        remaining = -path.t * segLen;
        path.t = 0;
        if (i > 1) path.seg = i - 1, path.t = 1;
        else { path.forward = true; path.t = 0; }
      } else {
        remaining = 0;
      }
    }

    const i = path.seg;
    const [ax, az] = road.p[i - 1];
    const [bx, bz] = road.p[i];
    const dirSign = path.forward ? 1 : -1;
    // Правая полоса: смещаем поперёк направления движения.
    const dx = (bx - ax) * dirSign;
    const dz = (bz - az) * dirSign;
    const len = Math.hypot(dx, dz) || 1;
    const offX = (-dz / len) * (road.w * 0.25);
    const offZ = (dx / len) * (road.w * 0.25);

    car.x = ax + (bx - ax) * path.t + offX;
    car.z = az + (bz - az) * path.t + offZ;
    car.yaw = Math.atan2(dx, dz);
  }

  spawnNear(cx, cz) {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const dir = Math.random() < 0.5 ? 1 : -1;

    // Осевая линия дороги, перпендикулярной направлению движения.
    const lineBase = axis === 'z' ? snapToRoad(cx) : snapToRoad(cz);
    const along = (axis === 'z' ? cz : cx)
      + dir * -(SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN));

    const cross = lineBase + this.laneOffset(axis, dir);
    const x = axis === 'z' ? cross : along;
    const z = axis === 'z' ? along : cross;

    const lim = CONFIG.origin + CONFIG.total - 10;
    if (x < CONFIG.origin + 10 || x > lim || z < CONFIG.origin + 10 || z > lim) return;

    const type = VEHICLE_ORDER[Math.floor(Math.random() * VEHICLE_ORDER.length)];
    const def = VEHICLES[type];
    const color = def.colors[Math.floor(Math.random() * def.colors.length)];
    const yaw = axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);

    const car = new VehicleEntity(this.scene, {
      i: `t${this.seq++}`, t: type, c: color, x, z, r: yaw,
    });
    car.traffic = { axis, dir, line: lineBase, cruise: 9 + Math.random() * 7, cooldown: 0 };
    car.speed = car.traffic.cruise;
    this.cars.push(car);
  }

  /** Есть ли кто-то прямо по курсу — игрок, его машина или другой поток. */
  blocked(car, ahead, obstacles) {
    const t = car.traffic;
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    const px = car.x + fx * ahead;
    const pz = car.z + fz * ahead;

    for (const o of obstacles) {
      if (o === car) continue;
      if (Math.hypot(o.x - px, o.z - pz) < 3.6) return true;
    }
    // Край карты — тоже препятствие. Границы у реального города свои.
    const b = this.world.bounds || { min: CONFIG.origin, max: CONFIG.origin + CONFIG.total };
    const lo = b.min + 8;
    const hi = b.max - 8;
    if (px < lo || px > hi || pz < lo || pz > hi) return true;
    return false;
  }

  /** На перекрёстке иногда сворачиваем — иначе поток выглядит рельсовым. */
  maybeTurn(car) {
    const t = car.traffic;
    if (t.cooldown > 0) return;
    const alongPos = t.axis === 'z' ? car.z : car.x;
    const nearest = snapToRoad(alongPos);
    if (Math.abs(alongPos - nearest) > 1.2) return;
    if (Math.random() > 0.35) {
      t.cooldown = 2.5;
      return;
    }

    const newAxis = t.axis === 'z' ? 'x' : 'z';
    const newDir = Math.random() < 0.5 ? 1 : -1;
    const newLine = nearest;
    const cross = newLine + this.laneOffset(newAxis, newDir);

    // Встаём ровно в новую полосу, чтобы не срезать угол по газону.
    if (newAxis === 'z') {
      car.x = cross;
      car.z = t.line + this.laneOffset(t.axis, t.dir) * 0;
    } else {
      car.z = cross;
    }
    t.axis = newAxis;
    t.dir = newDir;
    t.line = newLine;
    t.cooldown = 3.5;
    car.yaw = newAxis === 'z' ? (newDir > 0 ? 0 : Math.PI) : (newDir > 0 ? Math.PI / 2 : -Math.PI / 2);
  }

  /**
   * Машина убирается только за спиной у игрока. Раньше она пропадала по
   * дистанции, и на прямой улице это было видно: едет и вдруг исчезает.
   */
  outOfSight(car, px, pz, camera) {
    const dist = Math.hypot(car.x - px, car.z - pz);
    if (dist > DESPAWN_HARD) return true;
    if (dist < DESPAWN_SOFT) return false;
    if (!camera) return true;
    // Взгляд камеры против направления на машину: сзади — можно убирать.
    const fx = -Math.sin(camera.rotation.y);
    const fz = -Math.cos(camera.rotation.y);
    const len = Math.hypot(car.x - camera.position.x, car.z - camera.position.z) || 1;
    const dot = ((car.x - camera.position.x) / len) * fx + ((car.z - camera.position.z) / len) * fz;
    return dot < 0.1;
  }

  /**
   * Столкновения в потоке. Машины разъезжаются заранее по blocked(), но на
   * перекрёстках пути пересекаются — там раньше они проходили друг сквозь
   * друга. Теперь бьются: встают, дымят, на сильном ударе загораются.
   */
  collide(all, effects) {
    for (const car of this.cars) {
      if (car.crashed) continue;
      for (const other of all) {
        if (other === car || other.crashed) continue;
        if (!overlap(car, other)) continue;

        // Сходятся или просто разъезжаются? Считаем скорость сближения:
        // встречные машины в соседних полосах не должны считаться аварией.
        const dx = other.x - car.x;
        const dz = other.z - car.z;
        const len = Math.hypot(dx, dz) || 1;
        const closing = (Math.sin(car.yaw) * car.speed - Math.sin(other.yaw) * (other.speed || 0)) * (dx / len)
          + (Math.cos(car.yaw) * car.speed - Math.cos(other.yaw) * (other.speed || 0)) * (dz / len);
        if (closing < 3) continue;

        this.wreck(car, closing, effects);
        if (this.cars.includes(other)) this.wreck(other, closing, effects);
      }
    }
  }

  /** Переводит машину в разбитое состояние. */
  wreck(car, rel, effects) {
    if (car.crashed) return;
    car.crashed = true;
    car.crashTimer = WRECK_TIME;
    car.speed = 0;
    car.braking = false;
    car.smokeTimer = 0;
    if (effects) {
      effects.impact(new THREE.Vector3(car.x, 0.8, car.z), new THREE.Vector3(0, 1, 0), 'metal');
    }
    // Сильный удар — пожар, лёгкий — просто помятый капот и дым.
    if (rel > 12) {
      car.burning = true;
      car.setDestroyed(effects);
    }
  }

  /** Дым и огонь у разбитых машин. */
  updateWrecks(dt, effects) {
    for (const car of this.cars) {
      if (!car.crashed) continue;
      car.crashTimer -= dt;
      car.smokeTimer -= dt;
      if (car.smokeTimer <= 0 && effects) {
        car.smokeTimer = car.burning ? 0.18 : 0.5;
        effects.smoke(
          new THREE.Vector3(car.x, car.burning ? 1.0 : 0.8, car.z),
          car.burning ? 1.4 : 0.5,
        );
      }
      car.update(dt, { lights: false, siren: false });
    }
  }

  update(dt, px, pz, obstacles = [], camera = null, effects = null) {
    // Популяция вокруг игрока.
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      const spent = car.crashed && car.crashTimer <= 0;
      if (this.outOfSight(car, px, pz, camera) || spent) {
        car.dispose(this.scene);
        this.cars.splice(i, 1);
      }
    }
    const osm = !!this.world.osm;
    // Разбитые машины стоят на месте, поэтому в норму потока не считаются.
    const alive = this.cars.filter((c) => !c.crashed).length;
    for (let n = alive; n < MAX_CARS; n++) {
      const before = this.cars.length;
      if (osm) this.spawnOnRoad(px, pz);
      else this.spawnNear(px, pz);
      if (this.cars.length === before) break;
    }

    const all = [...this.cars, ...obstacles];

    if (osm) {
      for (const car of this.cars) {
        if (car.crashed) continue;
        const stop = this.blocked(car, 7 + car.speed * 0.45, all);
        car.speed += ((stop ? 0 : car.path.cruise) - car.speed) * Math.min(1, dt * (stop ? 4.5 : 1.6));
        car.braking = stop && car.speed > 1;
        this.advance(car, dt);
        car.syncMesh();
        car.update(dt, { lights: this.lights, siren: false });
      }
      this.collide(all, effects);
      this.updateWrecks(dt, effects);
      for (const car of this.cars) car.syncMesh();
      return;
    }

    for (const car of this.cars) {
      if (car.crashed) continue;
      const t = car.traffic;
      t.cooldown = Math.max(0, t.cooldown - dt);

      const stop = this.blocked(car, 7 + car.speed * 0.45, all);
      const target = stop ? 0 : t.cruise;
      car.speed += (target - car.speed) * Math.min(1, dt * (stop ? 4.5 : 1.6));
      car.braking = stop && car.speed > 1;

      this.maybeTurn(car);

      car.x += Math.sin(car.yaw) * car.speed * dt;
      car.z += Math.cos(car.yaw) * car.speed * dt;

      // Держим машину в своей полосе: без этого она уползает с дороги.
      const cross = t.line + this.laneOffset(t.axis, t.dir);
      if (t.axis === 'z') car.x += (cross - car.x) * Math.min(1, dt * 3);
      else car.z += (cross - car.z) * Math.min(1, dt * 3);

      car.syncMesh();
      car.update(dt, { lights: this.lights, siren: false });
    }
    this.collide(all, effects);
    this.updateWrecks(dt, effects);
    for (const car of this.cars) car.syncMesh();
  }

  clear() {
    for (const car of this.cars) car.dispose(this.scene);
    this.cars.length = 0;
  }
}
