// Самокатчики и мотоциклисты. Живут только на клиенте, как трафик и
// прохожие: это декорация улицы, но именно она делает город обитаемым.
//
// Самокаты идут по пешеходной сети (тротуары и дорожки), мотоциклы — по
// проезжей части. Если на одном самокате едут двое, за ними приезжает
// патруль ДПС: вдвоём на самокате ездить нельзя, и город об этом помнит.
import * as THREE from 'three';
import {
  buildNet, netPoint, netAdvance, netSpawn, nearestNode, randomNodeNear, findPath,
  NET_WALK, NET_DRIVE,
} from '/shared/roadnet.js';
import { createCharacter, createScooter, createMotorcycle, SKINS } from './models.js';
import { VehicleEntity } from './vehicle.js';

const MAX_SCOOTERS = 5;
const MAX_BIKES = 3;
const SPAWN_MIN = 25;
const SPAWN_MAX = 85;
const DESPAWN = 160;
// Доля самокатов с пассажиром: нарушение должно попадаться, но не в каждом.
const DOUBLE_CHANCE = 0.35;
const BUST_DISTANCE = 6;

export class Riders {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.onBusted = null;
    this.walkNet = world.osm ? buildNet(world.roads, NET_WALK) : null;
    this.driveNet = world.osm ? buildNet(world.roads, NET_DRIVE) : null;
    this.seq = 0;
  }

  get active() {
    return !!(this.walkNet && this.driveNet);
  }

  spawn(kind, cx, cz) {
    const net = kind === 'scooter' ? this.walkNet : this.driveNet;
    const state = netSpawn(net, cx, cz, SPAWN_MIN, SPAWN_MAX);
    if (!state) return;

    const mesh = kind === 'scooter'
      ? createScooter(SCOOTER_COLORS[Math.floor(Math.random() * SCOOTER_COLORS.length)])
      : createMotorcycle(BIKE_COLORS[Math.floor(Math.random() * BIKE_COLORS.length)]);
    this.scene.add(mesh);

    // Мотоциклист держится своей полосы, самокат — края тротуара.
    const rider = {
      id: `r${this.seq++}`,
      kind,
      net,
      mesh,
      riders: [],
      ...state,
      side: kind === 'scooter' ? state.side : 1,
      speed: kind === 'scooter' ? 4.2 + Math.random() * 2.2 : 9 + Math.random() * 6,
      double: kind === 'scooter' && Math.random() < DOUBLE_CHANCE,
      busted: false,
      bustTimer: 0,
      patrol: null,
      x: 0, z: 0, yaw: 0,
    };

    const seats = rider.double ? 2 : 1;
    for (let i = 0; i < seats; i++) {
      const person = createCharacter(Math.floor(Math.random() * SKINS.length));
      this.scene.add(person);
      rider.riders.push(person);
    }

    // Мотоцикл держится правой полосы, как и поток: по осевой его сбивала бы
    // каждая встречная машина.
    rider.lane = kind === 'moto' ? (state.link?.width || 8) * 0.25 : 0;
    this.point(rider);
    this.place(rider);
    this.list.push(rider);
  }

  /** Точка маршрута с поправкой на полосу движения. */
  point(r) {
    netPoint(r.net, r, 5, r);
    if (!r.lane) return;
    r.x += Math.cos(r.yaw) * r.lane;
    r.z -= Math.sin(r.yaw) * r.lane;
  }

  /** Ставит технику и седоков на текущую точку маршрута. */
  place(r) {
    r.mesh.position.set(r.x, 0, r.z);
    r.mesh.rotation.y = r.yaw;

    const fx = Math.sin(r.yaw);
    const fz = Math.cos(r.yaw);
    r.riders.forEach((person, i) => {
      // Самокатчики стоят на деке, мотоциклист сидит в седле; второй седок
      // всегда позади первого — на деке места ровно на двоих.
      const back = r.kind === 'scooter' ? -0.3 - 0.34 * i : -0.28 - 0.45 * i;
      const lift = r.kind === 'scooter' ? 0.19 : 0.5;
      person.position.set(r.x + fx * back, r.busted ? 0 : lift, r.z + fz * back);
      person.rotation.y = r.yaw;
    });
  }

  /**
   * Патруль на нарушителя. Экипаж — тоже декорация: сервер о нём не знает,
   * поэтому и розыск игроку за эту сцену не начисляется.
   */
  callPatrol(r) {
    const near = nearestNode(this.driveNet, r.x, r.z, 120);
    if (!near) return;
    const start = randomNodeNear(this.driveNet, r.x, r.z, 40, 110, near.node.comp);
    if (start < 0) return;
    const node = this.driveNet.nodes[start];

    const car = new VehicleEntity(this.scene, {
      i: `p${this.seq++}`, t: 'dps', c: 0xf2f2f2, npc: 1,
      x: node.x, z: node.z, r: Math.atan2(r.x - node.x, r.z - node.z),
    });
    r.patrol = { car, node: start, path: null, pi: 0, repath: 0 };
  }

  /** Патруль едет к нарушителю по проезжей части. */
  drivePatrol(r, dt) {
    const p = r.patrol;
    const car = p.car;
    const net = this.driveNet;
    p.repath -= dt;

    if (!p.path || p.repath <= 0) {
      p.repath = 1.2;
      const from = nearestNode(net, car.x, car.z, 120);
      const to = nearestNode(net, r.x, r.z, 120);
      p.path = from && to ? findPath(net, from.index, to.index) : null;
      p.pi = p.path && p.path.length > 1 ? 1 : 0;
    }

    let tx = r.x;
    let tz = r.z;
    const dist = Math.hypot(r.x - car.x, r.z - car.z);
    if (p.path && p.pi < p.path.length && dist > 18) {
      let node = net.nodes[p.path[p.pi]];
      while (Math.hypot(node.x - car.x, node.z - car.z) < 8 && p.pi < p.path.length - 1) {
        p.pi += 1;
        node = net.nodes[p.path[p.pi]];
      }
      tx = node.x;
      tz = node.z;
    }

    const desired = Math.atan2(tx - car.x, tz - car.z);
    let diff = desired - car.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.yaw += Math.max(-2.6 * dt, Math.min(2.6 * dt, diff));

    const target = dist < BUST_DISTANCE ? 0 : Math.min(18, 6 + dist * 0.6);
    car.speed += (target - car.speed) * Math.min(1, dt * 2.2);
    car.x += Math.sin(car.yaw) * car.speed * dt;
    car.z += Math.cos(car.yaw) * car.speed * dt;
    car.syncMesh();
    car.update(dt, { siren: true, lights: this.lights });

    return dist;
  }

  update(dt, cx, cz, effects) {
    if (!this.active) return;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      if (Math.hypot(r.x - cx, r.z - cz) > DESPAWN) this.remove(i);
    }
    let scooters = 0;
    let bikes = 0;
    for (const r of this.list) (r.kind === 'scooter' ? scooters++ : bikes++);
    if (scooters < MAX_SCOOTERS) this.spawn('scooter', cx, cz);
    if (bikes < MAX_BIKES) this.spawn('moto', cx, cz);

    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];

      // Нарушителя замечают, когда он рядом с игроком: гонять патрули по
      // всему городу ради невидимой сцены незачем.
      if (r.double && !r.patrol && !r.busted && Math.hypot(r.x - cx, r.z - cz) < 70) {
        this.callPatrol(r);
      }

      if (r.busted) {
        r.bustTimer -= dt;
        if (r.patrol) this.drivePatrol(r, dt);
        for (const person of r.riders) person.update(dt, { speed: 0 });
        if (r.bustTimer <= 0) this.remove(i);
        continue;
      }

      if (r.patrol) {
        const dist = this.drivePatrol(r, dt);
        if (dist < BUST_DISTANCE) {
          r.busted = true;
          r.bustTimer = 9;
          r.speed = 0;
          // Седоки слезают и встают рядом с самокатом.
          r.riders.forEach((person, k) => {
            person.position.set(r.x + 0.7 * (k ? 1 : -1), 0, r.z + 0.6);
          });
          if (this.onBusted) this.onBusted(r);
          continue;
        }
      }

      netAdvance(r.net, r, r.speed * dt);
      this.point(r);
      this.place(r);
      r.mesh.update(dt, { speed: r.speed });
      for (const person of r.riders) person.update(dt, { speed: 0, sitting: r.kind === 'moto' });
    }
  }

  /** Сбит машиной: седоки падают, техника остаётся лежать. */
  checkRunOver(vx, vz, speed, effects) {
    if (Math.abs(speed) < 6) return 0;
    let hits = 0;
    for (const r of this.list) {
      // Мотоциклист едет в общем потоке, поэтому задеваем его только в упор:
      // иначе его «сбивала» бы любая машина в соседней полосе.
      const reach = r.kind === 'moto' ? 1.5 : 2.2;
      if (r.busted || Math.hypot(r.x - vx, r.z - vz) > reach) continue;
      r.busted = true;
      r.bustTimer = 6;
      r.speed = 0;
      hits += 1;
      if (effects) effects.bloodSpray(new THREE.Vector3(r.x, 0.9, r.z), new THREE.Vector3(0, 1, 0));
      for (const person of r.riders) person.update(0, { dead: true, speed: 0 });
    }
    return hits;
  }

  remove(i) {
    const r = this.list[i];
    this.scene.remove(r.mesh);
    for (const person of r.riders) this.scene.remove(person);
    if (r.patrol) r.patrol.car.dispose(this.scene);
    this.list.splice(i, 1);
  }

  clear() {
    while (this.list.length) this.remove(this.list.length - 1);
  }
}

const SCOOTER_COLORS = [0x2b2f36, 0xd94a3a, 0xe0c840, 0x2b4c7e, 0x3f8f6a];
const BIKE_COLORS = [0x8a1f1f, 0x1a1a1e, 0x2b4c7e, 0x2f6b45, 0xb0b6ba];
