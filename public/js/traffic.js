// Городской трафик: машины едут по полосам, тормозят перед препятствием
// и поворачивают на перекрёстках. Живёт на клиенте, как и прохожие —
// это декорация, но именно она отличает город от макета.
import * as THREE from 'three';
import { CONFIG, roadCenter, snapToRoad } from '/shared/worldgen.js';
import { VEHICLE_ORDER, VEHICLES } from '/shared/protocol.js';
import { VehicleEntity } from './vehicle.js';
import { nearestRoad } from '/shared/osmworld.js';

const MAX_CARS = 14;
const SPAWN_MIN = 60;
const SPAWN_MAX = 150;
const DESPAWN = 210;
const LANE = 4.2; // смещение от осевой линии: правостороннее движение

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

  /** Спавн на реальной улице: машина встаёт на сегмент и едет по нему. */
  spawnOnRoad(cx, cz) {
    const roads = this.drivableRoads();
    if (!roads.length) return;
    for (let tries = 0; tries < 60; tries++) {
      const road = roads[Math.floor(Math.random() * roads.length)];
      const i = 1 + Math.floor(Math.random() * (road.p.length - 1));
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
    // Край карты — тоже препятствие.
    const lim = CONFIG.origin + CONFIG.total - 8;
    if (px < CONFIG.origin + 8 || px > lim || pz < CONFIG.origin + 8 || pz > lim) return true;
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

  update(dt, px, pz, obstacles = []) {
    // Популяция вокруг игрока.
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      if (Math.hypot(car.x - px, car.z - pz) > DESPAWN || car.health <= 0) {
        car.dispose(this.scene);
        this.cars.splice(i, 1);
      }
    }
    const osm = !!this.world.osm;
    while (this.cars.length < MAX_CARS) {
      const before = this.cars.length;
      if (osm) this.spawnOnRoad(px, pz);
      else this.spawnNear(px, pz);
      if (this.cars.length === before) break;
    }

    const all = [...this.cars, ...obstacles];

    if (osm) {
      for (const car of this.cars) {
        const stop = this.blocked(car, 7 + car.speed * 0.45, all);
        car.speed += ((stop ? 0 : car.path.cruise) - car.speed) * Math.min(1, dt * (stop ? 4.5 : 1.6));
        car.braking = stop && car.speed > 1;
        this.advance(car, dt);
        car.syncMesh();
        car.update(dt, { lights: this.lights, siren: false });
      }
      return;
    }

    for (const car of this.cars) {
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
  }

  clear() {
    for (const car of this.cars) car.dispose(this.scene);
    this.cars.length = 0;
  }
}
