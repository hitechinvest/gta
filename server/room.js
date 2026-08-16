// Игровая комната: состояние мира, синхронизация игроков, транспорт,
// ИИ патрулей ДПС, розыск, урон и подборы.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateWorld, snapToRoad, resolveCircle, raycastBuildings, roadCenter, CONFIG,
} from '../shared/worldgen.js';
import { generateOsmWorld } from '../shared/osmworld.js';
import {
  buildNet, nearestNode, randomNodeNear, findPath, NET_DRIVE,
} from '../shared/roadnet.js';

const OSM_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shared/city-osm.json');

/** Реальный центр Йошкар-Олы, если выгрузка лежит рядом; иначе — генератор. */
function loadWorld(seed) {
  if (process.env.CITY === 'procedural' || !fs.existsSync(OSM_FILE)) return generateWorld(seed);
  try {
    const world = generateOsmWorld(JSON.parse(fs.readFileSync(OSM_FILE, 'utf8')));
    console.log(`[мир] реальный центр из OSM: ${world.buildings.length} зданий`);
    return world;
  } catch (err) {
    console.error('[мир] OSM не прочитался, строим процедурный:', err.message);
    return generateWorld(seed);
  }
}
import {
  NET, WEAPONS, VEHICLES, VEHICLE_ORDER, WANTED, PLAYER, PICKUP_TYPES,
  clampName, sanitizeChat, RESPAWN_TIME,
} from '../shared/protocol.js';

const r2 = (v) => Math.round(v * 100) / 100;
const now = () => Date.now();

const COP_NAMES = ['Патруль 12', 'Патруль 47', 'Экипаж 3', 'ППС 8', 'ДПС 21', 'Экипаж 9'];

let nextEntityId = 1;
const uid = (prefix) => `${prefix}${(nextEntityId++).toString(36)}`;

export class Room {
  constructor(seed = Math.floor(Math.random() * 1e9)) {
    this.seed = seed >>> 0;
    this.world = loadWorld(this.seed);
    this.clients = new Map(); // id -> client
    this.vehicles = new Map();
    this.npcs = new Map();
    this.pickups = new Map();
    this.startedAt = now();
    this.lastTick = now();
    // В реальном городе улицы кривые: патрулям нужен граф, а не сетка кварталов.
    this.driveNet = this.world.osm ? buildNet(this.world.roads, NET_DRIVE) : null;

    this.spawnVehicles();
    this.spawnPickups();
  }

  // --- инициализация мира ---------------------------------------------------

  spawnVehicles() {
    const spots = this.world.carSpawns;
    const rngSeq = (i) => ((Math.sin(i * 12.9898 + this.seed * 0.0001) * 43758.5453) % 1 + 1) % 1;
    const step = Math.max(1, Math.floor(spots.length / 54));
    let k = 0;
    for (let i = 0; i < spots.length; i += step) {
      const s = spots[i];
      const rv = rngSeq(i);
      const type = rv < 0.06 ? 'dps' : VEHICLE_ORDER[Math.floor(rngSeq(i + 7) * VEHICLE_ORDER.length)];
      const def = VEHICLES[type];
      const id = uid('v');
      this.vehicles.set(id, {
        id,
        type,
        x: s.x, y: 0, z: s.z,
        yaw: s.yaw,
        speed: 0, vx: 0, vz: 0,
        health: def.health,
        color: def.colors[Math.floor(rngSeq(i + 13) * def.colors.length)],
        driver: null,
        siren: false,
        npc: false,
        lastUpdate: now(),
        home: { x: s.x, z: s.z, yaw: s.yaw },
      });
      k++;
      if (k > 60) break;
    }
  }

  spawnPickups() {
    const types = ['health', 'armor', 'ak', 'obrez', 'cash', 'cash', 'health'];
    const g = CONFIG.gridSize;
    let n = 0;
    for (let i = 0; i <= g; i++) {
      for (let j = 0; j <= g; j++) {
        if ((i * 5 + j * 3) % 4 !== 0) continue;
        const type = types[(i + j * 3 + this.seed) % types.length];
        const id = uid('p');
        this.pickups.set(id, {
          id,
          type,
          x: roadCenter(i) + (j % 2 ? 6.5 : -6.5),
          z: roadCenter(j) + (i % 2 ? 6.5 : -6.5),
          takenUntil: 0,
        });
        n++;
      }
    }
    // Пара «жирных» точек во дворах.
    for (const d of this.world.districts) {
      if (d.kind !== 'panel') continue;
      if ((d.i + d.j) % 3 !== 0) continue;
      const id = uid('p');
      this.pickups.set(id, { id, type: 'ak', x: d.x + 6, z: d.z + 6, takenUntil: 0 });
    }
  }

  randomFootSpawn() {
    const list = this.world.footSpawns;
    const s = list[Math.floor(Math.random() * list.length)];
    return { x: s.x, z: s.z, yaw: s.yaw };
  }

  // --- клиенты --------------------------------------------------------------

  addClient(ws) {
    const id = uid('u');
    const spawn = this.randomFootSpawn();
    const client = {
      id,
      ws,
      alive: true,
      joined: false,
      name: 'Гость',
      skin: 0,
      x: spawn.x, y: 0, z: spawn.z,
      yaw: spawn.yaw, pitch: 0,
      anim: 'idle',
      health: PLAYER.maxHealth,
      armor: 0,
      weapon: 'pm',
      kills: 0, deaths: 0, money: 500,
      wanted: 0,
      lastCrime: 0,
      vehicle: null,
      deadUntil: 0,
      lastState: 0,
      hitTokens: 6,
      lastHitRefill: now(),
      chatCooldown: 0,
      lastVehicleDamage: 0,
    };
    this.clients.set(id, client);
    return client;
  }

  removeClient(client) {
    if (!this.clients.has(client.id)) return;
    const veh = client.vehicle && this.vehicles.get(client.vehicle);
    if (veh && veh.driver === client.id) veh.driver = null;
    this.clients.delete(client.id);
    this.broadcast({ t: 'leave', id: client.id });
  }

  send(client, obj) {
    if (client.ws.readyState !== 1) return;
    try {
      client.ws.send(JSON.stringify(obj));
    } catch { /* сокет уже закрыт */ }
  }

  broadcast(obj, exceptId = null) {
    const raw = JSON.stringify(obj);
    for (const c of this.clients.values()) {
      if (c.id === exceptId || !c.joined) continue;
      if (c.ws.readyState !== 1) continue;
      try { c.ws.send(raw); } catch { /* пропускаем */ }
    }
  }

  publicPlayer(c) {
    return {
      i: c.id, n: c.name, s: c.skin,
      x: r2(c.x), y: r2(c.y), z: r2(c.z), r: r2(c.yaw), p: r2(c.pitch),
      a: c.anim, h: Math.round(c.health), ar: Math.round(c.armor),
      w: c.weapon, v: c.vehicle, k: c.kills, d: c.deaths, wl: Math.floor(c.wanted),
      dead: c.deadUntil > now(),
    };
  }

  publicVehicle(v) {
    return {
      i: v.id, t: v.type, x: r2(v.x), y: r2(v.y), z: r2(v.z), r: r2(v.yaw),
      sp: r2(v.speed), c: v.color, dr: v.driver, hp: Math.round(v.health),
      si: v.siren ? 1 : 0, npc: v.npc ? 1 : 0,
    };
  }

  // --- обработка сообщений --------------------------------------------------

  onMessage(client, raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;

    switch (m.t) {
      case 'join': return this.onJoin(client, m);
      case 'state': return this.onState(client, m);
      case 'vstate': return this.onVehicleState(client, m);
      case 'enter': return this.onEnter(client, m);
      case 'exit': return this.onExit(client, m);
      case 'shot': return this.onShot(client, m);
      case 'hit': return this.onHit(client, m);
      case 'crime': return this.onCrime(client, m);
      case 'roadkill': return this.onRoadkill(client, m);
      case 'pickup': return this.onPickup(client, m);
      case 'chat': return this.onChat(client, m);
      case 'respawn': return this.onRespawn(client);
      case 'weapon': return this.onWeapon(client, m);
      case 'vdamage': return this.onVehicleDamage(client, m);
      case 'ping': return this.send(client, { t: 'pong', c: m.c, s: now() });
      default: return undefined;
    }
  }

  onJoin(client, m) {
    if (client.joined) return;
    client.name = clampName(m.name);
    client.skin = Math.max(0, Math.min(5, Math.floor(m.skin || 0)));
    client.joined = true;

    this.send(client, {
      t: 'init',
      id: client.id,
      seed: this.seed,
      osm: !!this.world.osm,
      you: this.publicPlayer(client),
      players: [...this.clients.values()].filter((c) => c.joined && c.id !== client.id).map((c) => this.publicPlayer(c)),
      vehicles: [...this.vehicles.values()].map((v) => this.publicVehicle(v)),
      pickups: [...this.pickups.values()].map((p) => ({ i: p.id, t: p.type, x: r2(p.x), z: r2(p.z), u: p.takenUntil })),
      serverTime: now(),
    });

    this.broadcast({ t: 'join', p: this.publicPlayer(client) }, client.id);
    this.broadcast({ t: 'sys', m: `${client.name} в игре` });
  }

  onState(client, m) {
    if (!client.joined) return;
    if (typeof m.x !== 'number' || !Number.isFinite(m.x)) return;
    const lim = CONFIG.total;
    client.x = Math.max(-lim, Math.min(lim, m.x));
    client.y = Math.max(-5, Math.min(200, m.y || 0));
    client.z = Math.max(-lim, Math.min(lim, m.z));
    client.yaw = m.r || 0;
    client.pitch = m.p || 0;
    client.anim = typeof m.a === 'string' ? m.a.slice(0, 12) : 'idle';
    client.lastState = now();
  }

  onVehicleState(client, m) {
    const v = this.vehicles.get(m.i);
    if (!v || v.driver !== client.id) return;
    v.x = m.x; v.y = m.y || 0; v.z = m.z;
    v.yaw = m.r; v.speed = m.sp || 0;
    v.lastUpdate = now();
  }

  onEnter(client, m) {
    const v = this.vehicles.get(m.i);
    if (!v || client.deadUntil > now()) return;
    if (v.driver && v.driver !== client.id) {
      this.send(client, { t: 'sys', m: 'Машина занята' });
      return;
    }
    if (v.health <= 0) return;
    const dist = Math.hypot(v.x - client.x, v.z - client.z);
    if (dist > 6) return;

    if (client.vehicle) this.leaveVehicle(client);
    v.driver = client.id;
    client.vehicle = v.id;
    if (!v.npc) this.addWanted(client, WANTED.CAR_THEFT);
    this.broadcast({ t: 'veh', i: v.id, dr: client.id });
  }

  leaveVehicle(client) {
    const v = client.vehicle && this.vehicles.get(client.vehicle);
    client.vehicle = null;
    if (v && v.driver === client.id) {
      v.driver = null;
      v.speed = 0;
      this.broadcast({ t: 'veh', i: v.id, dr: null });
    }
  }

  onExit(client) {
    if (!client.vehicle) return;
    this.leaveVehicle(client);
  }

  onShot(client, m) {
    if (!client.joined || client.deadUntil > now()) return;
    const w = WEAPONS[m.w];
    if (!w) return;
    if (w.noise) this.addWanted(client, WANTED.SHOT_FIRED);
    this.broadcast({
      t: 'shot', i: client.id, w: m.w,
      ox: r2(m.ox), oy: r2(m.oy), oz: r2(m.oz),
      dx: r2(m.dx), dy: r2(m.dy), dz: r2(m.dz),
      len: r2(m.len || w.range),
    }, client.id);
  }

  refillTokens(client) {
    const t = now();
    const dt = (t - client.lastHitRefill) / 1000;
    client.lastHitRefill = t;
    client.hitTokens = Math.min(12, client.hitTokens + dt * 12);
  }

  onHit(client, m) {
    if (!client.joined || client.deadUntil > now()) return;
    const w = WEAPONS[m.w];
    if (!w) return;
    this.refillTokens(client);
    if (client.hitTokens < 1) return;
    client.hitTokens -= 1;

    if (m.kind === 'npc') {
      const npc = this.npcs.get(m.i);
      if (!npc || npc.health <= 0) return;
      const d = Math.hypot(npc.x - client.x, npc.z - client.z);
      if (d > w.range * 1.4) return;
      npc.health -= w.damage * (m.hs ? 1.8 : 1);
      this.addWanted(client, WANTED.HIT_COP);
      if (npc.health <= 0) {
        this.killNpc(npc, client);
        this.addWanted(client, WANTED.KILL_COP);
      }
      return;
    }

    const victim = this.clients.get(m.i);
    if (!victim || !victim.joined || victim.id === client.id) return;
    if (victim.deadUntil > now()) return;

    const dist = Math.hypot(victim.x - client.x, victim.z - client.z);
    if (dist > w.range * 1.4) return;
    // Проверка стены между стрелком и целью.
    const dx = victim.x - client.x, dy = (victim.y + 1) - (client.y + 1.5), dz = victim.z - client.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const blocked = raycastBuildings(
      this.world, client.x, client.y + 1.5, client.z,
      dx / len, dy / len, dz / len, len - 0.6,
    );
    if (blocked < len - 0.8) return;

    const dmg = w.damage * (m.hs ? 2 : 1);
    this.applyDamage(victim, dmg, client, m.w);
    this.addWanted(client, WANTED.HIT_PLAYER);
  }

  applyDamage(victim, amount, attacker, weapon) {
    if (victim.deadUntil > now()) return;
    let left = amount;
    if (victim.armor > 0) {
      const absorbed = Math.min(victim.armor, left * 0.65);
      victim.armor -= absorbed;
      left -= absorbed;
    }
    victim.health -= left;

    this.send(victim, {
      t: 'dmg', hp: Math.round(victim.health), ar: Math.round(victim.armor),
      from: attacker ? attacker.id : null, w: weapon,
      fx: attacker ? r2(attacker.x) : 0, fz: attacker ? r2(attacker.z) : 0,
    });

    if (victim.health <= 0) this.killPlayer(victim, attacker, weapon);
  }

  killPlayer(victim, attacker, weapon) {
    victim.health = 0;
    victim.armor = 0;
    victim.deaths += 1;
    victim.deadUntil = now() + RESPAWN_TIME;
    victim.wanted = 0;
    victim.money = Math.max(0, Math.round(victim.money * 0.8));
    if (victim.vehicle) this.leaveVehicle(victim);

    if (attacker && attacker.id !== victim.id) {
      attacker.kills += 1;
      attacker.money += 250;
      this.addWanted(attacker, WANTED.KILL_PLAYER);
    }

    this.broadcast({
      t: 'kill',
      k: attacker ? attacker.id : null,
      kn: attacker ? attacker.name : 'ДПС',
      v: victim.id, vn: victim.name,
      w: weapon || 'pm',
    });
    this.send(victim, { t: 'died', until: victim.deadUntil });
  }

  onRespawn(client) {
    if (client.deadUntil > now()) return;
    const s = this.randomFootSpawn();
    client.x = s.x; client.y = 0; client.z = s.z; client.yaw = s.yaw;
    client.health = PLAYER.maxHealth;
    client.armor = 0;
    client.weapon = 'pm';
    client.wanted = 0;
    client.deadUntil = 0;
    this.send(client, { t: 'spawn', x: r2(s.x), y: 0, z: r2(s.z), r: r2(s.yaw), hp: client.health });
  }

  onWeapon(client, m) {
    if (WEAPONS[m.w]) client.weapon = m.w;
  }

  onCrime(client, m) {
    const map = {
      ped: WANTED.RUN_OVER,
      vandal: 0.2,
      speeding: 0.05,
    };
    const add = map[m.k];
    if (add) this.addWanted(client, add);
  }

  /**
   * Игрока сбила машина городского потока. Поток живёт на клиенте, поэтому
   * о столкновении сообщает он; сервер ограничивает частоту и урон, чтобы
   * сообщением нельзя было выбить чужое здоровье.
   */
  onRoadkill(client, m) {
    if (!client.joined || client.vehicle || client.deadUntil > now()) return;
    const t = now();
    if (t - (client.lastRoadkill || 0) < 1000) return;
    client.lastRoadkill = t;
    const speed = Math.max(0, Math.min(40, Number(m.s) || 0));
    if (speed < 6) return;
    this.applyDamage(client, 18 + speed * 1.6, null, 'car');
  }

  onVehicleDamage(client, m) {
    const v = this.vehicles.get(m.i);
    if (!v) return;
    const t = now();
    if (t - client.lastVehicleDamage < 60) return;
    client.lastVehicleDamage = t;
    const amount = Math.max(0, Math.min(45, Number(m.d) || 0));
    if (v.health <= 0) return;
    v.health -= amount;
    if (v.health <= 0) {
      v.health = 0;
      const driver = v.driver && this.clients.get(v.driver);
      if (driver) {
        this.applyDamage(driver, 65, client.id === driver.id ? null : client, 'explosion');
        this.leaveVehicle(driver);
      }
      this.broadcast({ t: 'vboom', i: v.id, x: r2(v.x), z: r2(v.z) });
      setTimeout(() => this.respawnVehicle(v), 20000);
    }
  }

  respawnVehicle(v) {
    if (!this.vehicles.has(v.id)) return;
    v.health = VEHICLES[v.type].health;
    v.x = v.home.x; v.z = v.home.z; v.yaw = v.home.yaw;
    v.speed = 0; v.driver = null;
    this.broadcast({ t: 'vrespawn', v: this.publicVehicle(v) });
  }

  onPickup(client, m) {
    const p = this.pickups.get(m.i);
    if (!p || p.takenUntil > now()) return;
    if (Math.hypot(p.x - client.x, p.z - client.z) > 4) return;

    switch (p.type) {
      case 'health': client.health = Math.min(PLAYER.maxHealth, client.health + 50); break;
      case 'armor': client.armor = Math.min(PLAYER.maxArmor, client.armor + 75); break;
      case 'cash': client.money += 150 + Math.floor(Math.random() * 350); break;
      case 'ak': case 'obrez': client.weapon = p.type; break;
      default: break;
    }
    p.takenUntil = now() + PICKUP_TYPES[p.type].respawn;
    this.broadcast({ t: 'taken', i: p.id, by: client.id, u: p.takenUntil });
    this.send(client, {
      t: 'stats', hp: Math.round(client.health), ar: Math.round(client.armor),
      money: client.money, w: client.weapon, give: p.type,
    });
  }

  onChat(client, m) {
    const text = sanitizeChat(m.m);
    if (!text) return;
    const t = now();
    if (t < client.chatCooldown) return;
    client.chatCooldown = t + 700;
    this.broadcast({ t: 'chat', i: client.id, n: client.name, m: text });
  }

  addWanted(client, amount) {
    if (!client.joined) return;
    const before = Math.floor(client.wanted);
    client.wanted = Math.min(WANTED.MAX, client.wanted + amount);
    client.lastCrime = now();
    const after = Math.floor(client.wanted);
    if (after !== before) this.send(client, { t: 'wanted', l: after });
  }

  // --- ИИ ДПС ---------------------------------------------------------------

  spawnCop(target) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * 40;
    let x = snapToRoad(target.x + Math.cos(angle) * dist);
    let z = snapToRoad(target.z + Math.sin(angle) * dist);
    if (this.driveNet) {
      // Экипаж выезжает с настоящей улицы, и обязательно из того же куска
      // сети, что и цель: иначе доехать до игрока физически невозможно.
      const near = nearestNode(this.driveNet, target.x, target.z, 300);
      const comp = near ? near.node.comp : null;
      const i = randomNodeNear(this.driveNet, target.x, target.z, 60, 160, comp);
      const node = i >= 0 ? this.driveNet.nodes[i] : near?.node;
      if (node) { x = node.x; z = node.z; }
    }
    const id = uid('c');
    const npc = {
      id,
      name: COP_NAMES[Math.floor(Math.random() * COP_NAMES.length)],
      kind: 'copCar',
      x, y: 0, z,
      yaw: Math.atan2(target.x - x, target.z - z),
      speed: 0,
      health: 150,
      target: target.id,
      shootCd: 0,
      stuck: 0,
      color: 0xf2f2f2,
      born: now(),
    };
    this.npcs.set(id, npc);
    this.broadcast({ t: 'npc', n: this.publicNpc(npc) });
    return npc;
  }

  publicNpc(n) {
    return {
      i: n.id, k: n.kind, x: r2(n.x), y: r2(n.y), z: r2(n.z),
      r: r2(n.yaw), sp: r2(n.speed), hp: Math.round(n.health), n: n.name,
    };
  }

  killNpc(npc, killer) {
    npc.health = 0;
    this.npcs.delete(npc.id);
    this.broadcast({ t: 'npcdead', i: npc.id, x: r2(npc.x), z: r2(npc.z) });
    if (killer) killer.money += 120;
  }

  updateCops(dt) {
    const wantedPlayers = [...this.clients.values()]
      .filter((c) => c.joined && c.wanted >= 1 && c.deadUntil <= now());

    // Сколько экипажей должно быть в погоне.
    let desired = 0;
    for (const p of wantedPlayers) desired += Math.min(4, Math.floor(p.wanted));
    desired = Math.min(10, desired);

    if (this.npcs.size < desired && wantedPlayers.length) {
      const target = wantedPlayers[Math.floor(Math.random() * wantedPlayers.length)];
      this.spawnCop(target);
    }

    for (const npc of [...this.npcs.values()]) {
      let target = this.clients.get(npc.target);
      if (!target || !target.joined || target.wanted < 1 || target.deadUntil > now()) {
        target = wantedPlayers[0];
        if (!target) {
          // Погоня окончена — экипаж уезжает.
          this.npcs.delete(npc.id);
          this.broadcast({ t: 'npcgone', i: npc.id });
          continue;
        }
        npc.target = target.id;
      }

      this.driveCop(npc, target, dt);
    }
  }

  /**
   * Маршрут патруля по настоящим улицам: A* по графу до узла рядом с целью.
   * Пересчитываем редко — раз в секунду и когда цель заметно сдвинулась,
   * иначе десять экипажей будут считать путь каждый тик.
   */
  copWaypoint(npc, target, dt) {
    const net = this.driveNet;
    npc.repath = (npc.repath || 0) - dt;
    const moved = npc.goal
      ? Math.hypot(target.x - npc.goal.x, target.z - npc.goal.z)
      : Infinity;

    if (!npc.path || npc.repath <= 0 || moved > 30) {
      npc.repath = 1 + Math.random() * 0.4;
      npc.goal = { x: target.x, z: target.z };
      const from = nearestNode(net, npc.x, npc.z, 120);
      const to = nearestNode(net, target.x, target.z, 200);
      npc.path = from && to ? findPath(net, from.index, to.index) : null;
      npc.pi = 0;
      // Первый узел — тот, на котором уже стоим, его пропускаем.
      if (npc.path && npc.path.length > 1) npc.pi = 1;
    }
    if (!npc.path || npc.pi >= npc.path.length) return null;

    let node = net.nodes[npc.path[npc.pi]];
    while (Math.hypot(node.x - npc.x, node.z - npc.z) < 8 && npc.pi < npc.path.length - 1) {
      npc.pi += 1;
      node = net.nodes[npc.path[npc.pi]];
    }

    // Держимся правой стороны: встречка выглядела бы как езда по газону.
    const prev = npc.pi > 0 ? net.nodes[npc.path[npc.pi - 1]] : { x: npc.x, z: npc.z };
    const dx = node.x - prev.x;
    const dz = node.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: node.x + (dz / len) * 1.8, z: node.z - (dx / len) * 1.8 };
  }

  driveCop(npc, target, dt) {
    if (this.driveNet) {
      this.driveCopOsm(npc, target, dt);
      return;
    }
    // Манхэттенская навигация по сетке улиц.
    const targetXLine = snapToRoad(target.x);
    const targetZLine = snapToRoad(target.z);
    const myZLine = snapToRoad(npc.z);
    const myXLine = snapToRoad(npc.x);

    let wx, wz;
    if (Math.abs(npc.x - targetXLine) > 5 && Math.abs(npc.z - myZLine) < 6) {
      wx = targetXLine; wz = myZLine;
    } else if (Math.abs(npc.z - targetZLine) > 5 && Math.abs(npc.x - myXLine) < 6) {
      wx = myXLine; wz = targetZLine;
    } else if (Math.abs(npc.x - targetXLine) < 8) {
      wx = targetXLine; wz = target.z;
    } else {
      wx = target.x; wz = targetZLine;
    }

    const dist = Math.hypot(target.x - npc.x, target.z - npc.z);
    if (dist < 26) { wx = target.x; wz = target.z; } // финальный рывок

    this.copSteer(npc, target, wx, wz, dist, dt);
  }

  /** Патруль по настоящим улицам: едет по маршруту, у цели идёт напролом. */
  driveCopOsm(npc, target, dt) {
    const dist = Math.hypot(target.x - npc.x, target.z - npc.z);
    let wx = target.x;
    let wz = target.z;
    if (dist >= 26) {
      const wp = this.copWaypoint(npc, target, dt);
      if (wp) { wx = wp.x; wz = wp.z; }
    }
    this.copSteer(npc, target, wx, wz, dist, dt);
  }

  /** Руление к точке, столкновения, таран и огонь — общее для обоих режимов. */
  copSteer(npc, target, wx, wz, dist, dt) {
    const desiredYaw = Math.atan2(wx - npc.x, wz - npc.z);
    let diff = desiredYaw - npc.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turnRate = 2.4;
    npc.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));

    const maxSpeed = dist < 14 ? 8 : 26;
    const targetSpeed = Math.abs(diff) > 1.1 ? maxSpeed * 0.45 : maxSpeed;
    npc.speed += (targetSpeed - npc.speed) * Math.min(1, dt * 2.2);

    const nx = npc.x + Math.sin(npc.yaw) * npc.speed * dt;
    const nz = npc.z + Math.cos(npc.yaw) * npc.speed * dt;
    const res = resolveCircle(this.world, nx, nz, 1.6);
    npc.x = res.x;
    npc.z = res.z;

    if (res.hit) {
      npc.speed *= 0.35;
      npc.stuck += dt;
      npc.yaw += (Math.random() - 0.5) * 1.2 * dt * 4;
    } else {
      npc.stuck = Math.max(0, npc.stuck - dt);
    }
    if (npc.stuck > 4) {
      // Застрял между домами — вернуть на ближайший перекрёсток.
      if (this.driveNet) {
        const back = nearestNode(this.driveNet, npc.x, npc.z, 200);
        if (back) { npc.x = back.node.x; npc.z = back.node.z; }
        npc.path = null;
      } else {
        npc.x = snapToRoad(npc.x);
        npc.z = snapToRoad(npc.z);
      }
      npc.stuck = 0;
    }

    // Сбиваем пешего игрока корпусом.
    if (npc.speed > 10) {
      for (const c of this.clients.values()) {
        if (!c.joined || c.vehicle || c.deadUntil > now()) continue;
        if (Math.hypot(c.x - npc.x, c.z - npc.z) < 2.4) {
          this.applyDamage(c, 30 + npc.speed, null, 'car');
        }
      }
    }

    // Огонь на поражение.
    npc.shootCd -= dt;
    if (dist < 42 && npc.shootCd <= 0) {
      const dx = target.x - npc.x;
      const dy = (target.y + 1.2) - 1.2;
      const dz = target.z - npc.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const clear = raycastBuildings(this.world, npc.x, 1.2, npc.z, dx / len, dy / len, dz / len, len - 1);
      if (clear >= len - 1.2) {
        npc.shootCd = 0.75 + Math.random() * 0.6;
        this.broadcast({
          t: 'shot', i: npc.id, w: 'pm',
          ox: r2(npc.x), oy: 1.3, oz: r2(npc.z),
          dx: r2(dx / len), dy: r2(dy / len), dz: r2(dz / len), len: r2(len),
        });
        const hitChance = target.vehicle ? 0.35 : 0.5;
        if (Math.random() < hitChance) {
          this.applyDamage(target, 10 + Math.random() * 8, null, 'police');
        }
      }
    }
  }

  // --- главный тик ----------------------------------------------------------

  tick() {
    const t = now();
    const dt = Math.min(0.25, (t - this.lastTick) / 1000);
    this.lastTick = t;

    // Спад розыска.
    for (const c of this.clients.values()) {
      if (c.wanted > 0 && t - c.lastCrime > WANTED.DECAY_MS) {
        const before = Math.floor(c.wanted);
        c.wanted = Math.max(0, c.wanted - 1);
        c.lastCrime = t;
        if (Math.floor(c.wanted) !== before) this.send(c, { t: 'wanted', l: Math.floor(c.wanted) });
      }
      // Лёгкая регенерация здоровья вне боя.
      if (c.health > 0 && c.health < 100 && t - c.lastCrime > 12000 && c.deadUntil <= t) {
        c.health = Math.min(100, c.health + 2 * dt);
      }
    }

    this.updateCops(dt);
    this.checkRunOver();

    // Снапшот: игроки, активный транспорт, ДПС.
    const players = [];
    for (const c of this.clients.values()) {
      if (!c.joined) continue;
      players.push({
        i: c.id, x: r2(c.x), y: r2(c.y), z: r2(c.z), r: r2(c.yaw), p: r2(c.pitch),
        a: c.anim, h: Math.round(c.health), ar: Math.round(c.armor), w: c.weapon,
        v: c.vehicle, k: c.kills, d: c.deaths, wl: Math.floor(c.wanted),
        dd: c.deadUntil > t ? 1 : 0, m: c.money,
      });
    }

    const vehicles = [];
    for (const v of this.vehicles.values()) {
      const active = v.driver || Math.abs(v.speed) > 0.2 || t - v.lastUpdate < 1500;
      if (!active) continue;
      vehicles.push(this.publicVehicle(v));
    }

    const npcs = [...this.npcs.values()].map((n) => this.publicNpc(n));

    this.broadcast({ t: 'snap', s: t, pl: players, vh: vehicles, np: npcs });
  }

  checkRunOver() {
    const t = now();
    for (const v of this.vehicles.values()) {
      if (!v.driver || Math.abs(v.speed) < 9) continue;
      const driver = this.clients.get(v.driver);
      if (!driver) continue;
      for (const c of this.clients.values()) {
        if (!c.joined || c.id === driver.id || c.vehicle || c.deadUntil > t) continue;
        if (Math.hypot(c.x - v.x, c.z - v.z) < 2.5) {
          this.applyDamage(c, 25 + Math.abs(v.speed) * 1.8, driver, 'car');
          this.addWanted(driver, WANTED.RUN_OVER);
        }
      }
    }
  }

  stats() {
    return {
      players: this.clients.size,
      vehicles: this.vehicles.size,
      cops: this.npcs.size,
      seed: this.seed,
      uptime: Math.round((now() - this.startedAt) / 1000),
    };
  }
}
