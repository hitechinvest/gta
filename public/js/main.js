// Точка входа: сцена, игровой цикл, сеть, стрельба, транспорт и HUD.
import * as THREE from 'three';
import {
  generateWorld, CONFIG, raycastBuildings, snapToRoad, STREET_NAMES,
} from '/shared/worldgen.js';
import { WEAPONS, NET, PICKUP_TYPES } from '/shared/protocol.js';
import { buildCity } from './city.js';
import { buildOsmCity } from './osmcity.js';
import { generateOsmWorld } from '/shared/osmworld.js';
import { LocalPlayer } from './player.js';
import { VehicleEntity } from './vehicle.js';
import { RemotePlayer } from './remote.js';
import { Peds } from './peds.js';
import { Traffic } from './traffic.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { Minimap } from './minimap.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { sfx } from './audio.js';
import { SKINS } from './models.js';
import { Sky } from './sky.js';
import { PostFX } from './postfx.js';
import { assets } from './assets.js';

const DAY_LENGTH = 600; // секунд на полный цикл суток

const game = {
  scene: null,
  camera: null,
  renderer: null,
  world: null,
  city: null,
  player: null,
  remotes: new Map(),
  vehicles: new Map(),
  cops: new Map(),
  pickups: new Map(),
  effects: null,
  peds: null,
  hud: null,
  minimap: null,
  input: null,
  net: null,
  myId: null,
  serverOffset: 0,
  running: false,
  lastSend: 0,
  time: DAY_LENGTH * 0.34, // стартуем ближе к вечеру
  clock: null,
  engineSound: null,
  sirenTimer: 0,
  deathUntil: 0,
  fps: 60,
};

// --- меню -------------------------------------------------------------------

const menu = document.getElementById('menu');
const nameInput = document.getElementById('name-input');
const playBtn = document.getElementById('play-btn');
const statusEl = document.getElementById('menu-status');
const skinPicker = document.getElementById('skin-picker');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

let chosenSkin = Number(localStorage.getItem('gta.skin') || 0);
nameInput.value = localStorage.getItem('gta.name') || '';

SKINS.forEach((skin, i) => {
  const b = document.createElement('button');
  b.className = `skin${i === chosenSkin ? ' active' : ''}`;
  b.type = 'button';
  b.textContent = skin.name;
  b.addEventListener('click', () => {
    chosenSkin = i;
    localStorage.setItem('gta.skin', String(i));
    [...skinPicker.children].forEach((c, k) => c.classList.toggle('active', k === i));
  });
  skinPicker.appendChild(b);
});

fetch('/api/status')
  .then((r) => r.json())
  .then((s) => {
    statusEl.textContent = `Сервер на связи · игроков: ${s.players} · машин: ${s.vehicles}`;
  })
  .catch(() => {
    statusEl.textContent = 'Сервер недоступен — запустите «npm start»';
    statusEl.classList.add('error');
  });

playBtn.addEventListener('click', () => {
  playBtn.disabled = true;
  const name = (nameInput.value || 'Игрок').slice(0, 16);
  localStorage.setItem('gta.name', name);
  start(name, chosenSkin).catch((err) => {
    console.error(err);
    statusEl.textContent = `Ошибка: ${err.message}`;
    statusEl.classList.add('error');
    playBtn.disabled = false;
    loading.classList.remove('show');
    menu.classList.remove('hide');
  });
});

// --- запуск -----------------------------------------------------------------

async function start(name, skin) {
  loading.classList.add('show');
  loadingText.textContent = 'Подключаемся к серверу…';
  menu.classList.add('hide');

  game.net = new Net();
  await game.net.connect();

  const init = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('сервер молчит')), 10000);
    game.net.on('init', (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    game.net.send({ t: 'join', name, skin });
  });

  loadingText.textContent = 'Ищем модели…';
  await assets.init();

  loadingText.textContent = 'Строим город…';
  await nextFrame();

  game.myId = init.id;
  game.serverOffset = init.serverTime - Date.now();
  // Сервер сообщает, по какому миру играем: реальному или процедурному.
  let osmData = null;
  if (init.osm) {
    loadingText.textContent = 'Загружаем карту города…';
    try {
      osmData = await (await fetch('/shared/city-osm.json')).json();
    } catch (err) {
      console.warn('карта OSM не загрузилась:', err);
    }
  }
  game.world = osmData ? generateOsmWorld(osmData) : generateWorld(init.seed);

  game.quality = detectQuality();
  setupScene();
  game.city = osmData
    ? buildOsmCity(game.scene, game.world, game.quality)
    : buildCity(game.scene, game.world, game.quality);

  game.effects = new Effects(game.scene);
  game.peds = new Peds(game.scene, game.world);
  game.traffic = new Traffic(game.scene, game.world);
  game.hud = new Hud();
  game.minimap = new Minimap(document.getElementById('minimap'), game.world);
  game.input = new Input(game.renderer.domElement);

  game.player = new LocalPlayer(game.scene, skin);
  game.player.x = init.you.x;
  game.player.z = init.you.z;
  game.player.yaw = init.you.r || 0;
  game.player.camYaw = game.player.yaw;
  game.player.name = name;

  for (const p of init.players) addRemote(p);
  for (const v of init.vehicles) addVehicle(v);
  for (const p of init.pickups) addPickup(p);

  bindNetEvents();
  bindLocalEvents();

  game.peds.onKilled = () => {
    game.net.send({ t: 'crime', k: 'ped' });
    game.hud.toast('Сбит пешеход! +Розыск');
  };

  game.clock = new THREE.Clock();
  game.running = true;
  loading.classList.remove('show');
  document.getElementById('hud').classList.add('show');
  game.hud.chatMessage('', 'Добро пожаловать в Районы. F — сесть в машину, T — чат.', 'system');
  game.input.requestLock();
  renderLoop();
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** Качество подбирается автоматически, но игрок может переопределить. */
function detectQuality() {
  const saved = localStorage.getItem('gta.quality');
  if (saved && ['low', 'medium', 'high'].includes(saved)) return saved;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  if (touch || cores <= 4) return 'medium';
  return 'high';
}

function setupScene() {
  const canvas = document.getElementById('game');
  const q = game.quality;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: q === 'low' && window.devicePixelRatio < 2,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = q === 'low' ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Плёночная кривая: света не выжигаются, ночь не проваливается в чёрное.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  game.renderer = renderer;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8fa6bd, 120, 620);
  game.scene = scene;

  const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.15, 900);
  camera.position.set(0, 6, 10);
  game.camera = camera;

  game.sky = new Sky(scene, q === 'low' ? 500 : 720);

  game.hemi = new THREE.HemisphereLight(0xbcd0e0, 0x51503f, 1.05);
  scene.add(game.hemi);

  game.sun = new THREE.DirectionalLight(0xffe9c4, 1.5);
  game.sun.position.set(60, 90, 40);
  game.sun.castShadow = true;
  game.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
  const d = 70;
  game.sun.shadow.camera.left = -d;
  game.sun.shadow.camera.right = d;
  game.sun.shadow.camera.top = d;
  game.sun.shadow.camera.bottom = -d;
  game.sun.shadow.camera.near = 1;
  game.sun.shadow.camera.far = 320;
  game.sun.shadow.bias = -0.0008;
  scene.add(game.sun);
  scene.add(game.sun.target);

  game.postfx = new PostFX(renderer, scene, camera, q);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    game.postfx?.setSize(window.innerWidth, window.innerHeight);
  });
}

// --- сущности ---------------------------------------------------------------

function addRemote(data) {
  if (data.i === game.myId || game.remotes.has(data.i)) return;
  game.remotes.set(data.i, new RemotePlayer(game.scene, data));
}

function addVehicle(data) {
  if (game.vehicles.has(data.i)) return;
  const v = new VehicleEntity(game.scene, data);
  game.vehicles.set(v.id, v);
  return v;
}

const PICKUP_STYLE = {
  health: { color: 0xffffff, accent: 0xd93a3a, label: '+' },
  armor: { color: 0x4a86d6, accent: 0xffffff, label: 'Б' },
  ak: { color: 0x6b5a3a, accent: 0x2a2a2a, label: 'А' },
  obrez: { color: 0x7a4a2a, accent: 0x2a2a2a, label: 'О' },
  cash: { color: 0x4fbf6a, accent: 0xffffff, label: '₽' },
};

function addPickup(data) {
  const style = PICKUP_STYLE[data.t] || PICKUP_STYLE.cash;
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.55, 0.55),
    new THREE.MeshLambertMaterial({ color: style.color, emissive: new THREE.Color(style.color).multiplyScalar(0.18) }),
  );
  body.castShadow = true;
  group.add(body);
  const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.58), new THREE.MeshBasicMaterial({ color: style.accent }));
  group.add(bar1);
  const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.58), new THREE.MeshBasicMaterial({ color: style.accent }));
  group.add(bar2);
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 2.4, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  );
  glow.position.y = 0.8;
  group.add(glow);

  group.position.set(data.x, 1, data.z);
  game.scene.add(group);
  game.pickups.set(data.i, { id: data.i, type: data.t, x: data.x, z: data.z, takenUntil: data.u || 0, mesh: group });
}

// --- сетевые события --------------------------------------------------------

function bindNetEvents() {
  const net = game.net;

  net.on('join', (m) => {
    addRemote(m.p);
    game.hud.chatMessage('', `${m.p.n} подключился`, 'system');
  });

  net.on('leave', (m) => {
    const r = game.remotes.get(m.id);
    if (r) {
      r.dispose(game.scene);
      game.remotes.delete(m.id);
    }
  });

  net.on('sys', (m) => game.hud.chatMessage('', m.m, 'system'));

  net.on('snap', (m) => {
    const t = m.s;
    for (const p of m.pl) {
      if (p.i === game.myId) {
        applyOwnState(p);
        continue;
      }
      let r = game.remotes.get(p.i);
      if (!r) {
        addRemote(p);
        r = game.remotes.get(p.i);
        if (!r) continue;
      }
      r.pushState(p, t);
    }

    for (const v of m.vh) {
      let veh = game.vehicles.get(v.i);
      if (!veh) veh = addVehicle(v);
      if (!veh) continue;
      veh.driver = v.dr;
      veh.health = v.hp;
      if (v.dr !== game.myId) veh.pushNetState(v, t);
      if (v.hp <= 0 && !veh.destroyed) veh.setDestroyed(game.effects);
    }

    const seen = new Set();
    for (const n of m.np) {
      seen.add(n.i);
      let cop = game.cops.get(n.i);
      if (!cop) {
        cop = new VehicleEntity(game.scene, { i: n.i, t: 'dps', c: 0xf2f2f2, x: n.x, z: n.z, r: n.r, npc: 1 });
        game.cops.set(n.i, cop);
      }
      cop.pushNetState({ x: n.x, y: n.y, z: n.z, r: n.r, sp: n.sp, hp: n.hp }, t);
      cop.health = n.hp;
    }
    for (const [id, cop] of game.cops) {
      if (!seen.has(id)) {
        cop.dispose(game.scene);
        game.cops.delete(id);
      }
    }
  });

  net.on('npcdead', (m) => {
    const cop = game.cops.get(m.i);
    if (cop) {
      game.effects.explosion(new THREE.Vector3(m.x, 1, m.z));
      sfx.explosion(distanceToPlayer(m.x, m.z));
      cop.dispose(game.scene);
      game.cops.delete(m.i);
    }
  });

  net.on('npcgone', (m) => {
    const cop = game.cops.get(m.i);
    if (cop) {
      cop.dispose(game.scene);
      game.cops.delete(m.i);
    }
  });

  net.on('shot', (m) => {
    if (m.i === game.myId) return;
    const from = new THREE.Vector3(m.ox, m.oy, m.oz);
    const dir = new THREE.Vector3(m.dx, m.dy, m.dz);
    const to = from.clone().addScaledVector(dir, m.len || 40);
    game.effects.tracer(from, to);
    game.effects.muzzleFlash(from, dir);
    sfx.shot(m.w, distanceToPlayer(m.ox, m.oz));
    game.peds.scare(m.ox, m.oz, 26);
  });

  net.on('dmg', (m) => {
    const before = game.player.health;
    game.player.health = m.hp;
    game.player.armor = m.ar;
    if (m.hp < before) {
      game.hud.damageFlash((before - m.hp) / 45);
      sfx.hurt();
    }
    game.hud.setHealth(game.player.health, game.player.armor);
  });

  net.on('died', (m) => {
    game.player.dead = true;
    game.deathUntil = m.until;
    game.hud.showDeath(true, Math.ceil((m.until - Date.now()) / 1000));
    if (game.player.vehicle) leaveVehicle(true);
  });

  net.on('spawn', (m) => {
    game.player.dead = false;
    game.player.x = m.x;
    game.player.y = m.y;
    game.player.z = m.z;
    game.player.yaw = m.r;
    game.player.camYaw = m.r;
    game.player.velX = 0;
    game.player.velZ = 0;
    game.player.health = m.hp;
    game.player.armor = 0;
    game.player.wanted = 0;
    game.player.weapon = 'pm';
    game.player.ammo.pm.mag = WEAPONS.pm.mag;
    game.player.ammo.pm.reserve = 40;
    game.hud.showDeath(false);
    game.hud.setHealth(m.hp, 0);
    game.hud.setWanted(0);
  });

  net.on('kill', (m) => {
    const weapon = WEAPONS[m.w]?.name
      || { car: 'наезд', police: 'табельный ПМ', explosion: 'взрыв' }[m.w]
      || 'взрыв';
    game.hud.killFeed(`<b>${escape(m.kn || 'ДПС')}</b><i>${weapon}</i><b>${escape(m.vn)}</b>`);
    if (m.k === game.myId) {
      game.hud.toast('Цель ликвидирована +250 ₽');
      game.player.kills += 1;
    }
  });

  net.on('wanted', (m) => {
    game.player.wanted = m.l;
    game.hud.setWanted(m.l);
  });

  net.on('stats', (m) => {
    game.player.health = m.hp;
    game.player.armor = m.ar;
    game.player.money = m.money;
    if (m.give === 'ak' || m.give === 'obrez') game.player.giveWeapon(m.give);
    game.hud.setHealth(m.hp, m.ar);
    game.hud.setMoney(m.money);
    sfx.pickup();
    game.hud.toast(`Подобрано: ${PICKUP_TYPES[m.give]?.name || m.give}`);
  });

  net.on('taken', (m) => {
    const p = game.pickups.get(m.i);
    if (p) {
      p.takenUntil = m.u;
      p.mesh.visible = false;
    }
  });

  net.on('veh', (m) => {
    const v = game.vehicles.get(m.i);
    if (!v) return;
    v.driver = m.dr;
    if (m.dr === game.myId) {
      game.player.vehicle = v;
      game.player.mesh.visible = false;
    } else if (game.player.vehicle && game.player.vehicle.id === m.i && m.dr === null) {
      game.player.vehicle = null;
      game.player.mesh.visible = true;
    }
  });

  net.on('vboom', (m) => {
    const v = game.vehicles.get(m.i);
    if (v) v.setDestroyed(game.effects);
    else game.effects.explosion(new THREE.Vector3(m.x, 1, m.z));
    sfx.explosion(distanceToPlayer(m.x, m.z));
    if (game.player.vehicle && game.player.vehicle.id === m.i) {
      game.player.vehicle = null;
      game.player.mesh.visible = true;
    }
  });

  net.on('vrespawn', (m) => {
    const v = game.vehicles.get(m.v.i);
    if (!v) {
      addVehicle(m.v);
      return;
    }
    v.dispose(game.scene);
    game.vehicles.delete(m.v.i);
    addVehicle(m.v);
  });

  net.on('chat', (m) => {
    game.hud.chatMessage(m.n, m.m, 'player');
  });

  net.on('disconnect', () => {
    game.hud?.toast('Соединение потеряно. Обновите страницу.', 10000);
    game.running = false;
  });
}

function applyOwnState(p) {
  // Сервер владеет здоровьем, деньгами и розыском — позицию считает клиент.
  game.player.health = p.h;
  game.player.armor = p.ar;
  game.player.money = p.m;
  game.player.kills = p.k;
  game.player.deaths = p.d;
  if (p.wl !== game.player.wanted) {
    game.player.wanted = p.wl;
    game.hud.setWanted(p.wl);
  }
}

// --- локальные события ------------------------------------------------------

function bindLocalEvents() {
  const input = game.input;
  const hud = game.hud;

  hud.onChatSend = (text) => {
    game.net.send({ t: 'chat', m: text });
    input.enabled = true;
    input.requestLock();
  };

  input.onKeyExtra = (e) => {
    if (hud.chatOpen) return;
    switch (e.code) {
      case 'KeyF': toggleVehicle(); break;
      case 'KeyR':
        if (game.player.reload()) sfx.reload();
        break;
      case 'Digit1': game.player.selectWeapon('fists'); break;
      case 'Digit2': game.player.selectWeapon('pm'); break;
      case 'Digit3': game.player.selectWeapon('ak'); break;
      case 'Digit4': game.player.selectWeapon('obrez'); break;
      case 'KeyT':
      case 'Enter':
        openChat();
        break;
      case 'KeyM':
        game.minimap.rotate = !game.minimap.rotate;
        hud.toast(game.minimap.rotate ? 'Карта: по направлению' : 'Карта: север сверху');
        break;
      case 'KeyH':
        if (game.player.vehicle) {
          sfx.tone(320, 0.35, 0.2, 'square');
          game.peds.scare(game.player.x, game.player.z, 14);
        }
        break;
      case 'KeyL':
        if (game.player.vehicle) {
          game.player.vehicle.lights = !game.player.vehicle.lights;
          hud.toast(game.player.vehicle.lights ? 'Фары включены' : 'Фары выключены');
        }
        break;
      default: break;
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') hud.showScoreboard(true);
    if (e.code === 'Escape' && hud.chatOpen) {
      hud.closeChat();
      input.enabled = true;
      input.requestLock();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') hud.showScoreboard(false);
  });

  game.renderer.domElement.addEventListener('click', () => {
    sfx.init();
    sfx.resume();
    if (!input.locked && !hud.chatOpen) input.requestLock();
  });

  input.onLockChange = (locked) => {
    document.getElementById('crosshair').classList.toggle('show', locked);
  };
}

function openChat() {
  game.input.enabled = false;
  game.input.keys.clear();
  document.exitPointerLock?.();
  game.hud.openChat();
}

// --- транспорт --------------------------------------------------------------

function nearestVehicle(maxDist = 4.5) {
  let best = null;
  let bestD = maxDist;
  for (const v of game.vehicles.values()) {
    if (v.destroyed || (v.driver && v.driver !== game.myId)) continue;
    const d = Math.hypot(v.x - game.player.x, v.z - game.player.z);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

function toggleVehicle() {
  if (game.player.dead) return;
  if (game.player.vehicle) {
    leaveVehicle();
    return;
  }
  const v = nearestVehicle();
  if (!v) return;
  game.player.vehicle = v;
  v.driver = game.myId;
  game.player.mesh.visible = false;
  game.net.send({ t: 'enter', i: v.id });
  game.hud.toast(`${v.def.name} — поехали`);
  sfx.init();
  if (!game.engineSound) game.engineSound = sfx.engine('local');
}

function leaveVehicle(silent = false) {
  const v = game.player.vehicle;
  if (!v) return;
  const side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw)).multiplyScalar(1.7);
  game.player.x = v.x + side.x;
  game.player.z = v.z + side.z;
  game.player.y = 0;
  game.player.velX = 0;
  game.player.velZ = 0;
  game.player.yaw = v.yaw;
  game.player.vehicle = null;
  game.player.mesh.visible = true;
  v.driver = null;
  v.steerInput = 0;
  game.net.send({ t: 'exit', i: v.id });
  if (game.engineSound) {
    game.engineSound.stop();
    game.engineSound = null;
  }
  if (!silent) game.hud.toast('Вы вышли из машины');
}

// --- стрельба ---------------------------------------------------------------

function raySphere(origin, dir, cx, cy, cz, radius, maxDist) {
  const ox = cx - origin.x;
  const oy = cy - origin.y;
  const oz = cz - origin.z;
  const t = ox * dir.x + oy * dir.y + oz * dir.z;
  if (t < 0 || t > maxDist) return null;
  const px = origin.x + dir.x * t;
  const py = origin.y + dir.y * t;
  const pz = origin.z + dir.z * t;
  const d = Math.hypot(px - cx, py - cy, pz - cz);
  if (d > radius) return null;
  return t;
}

function resolveHit(origin, dir, range) {
  let best = { dist: range, type: 'sky', id: null, headshot: false };

  const bd = raycastBuildings(game.world, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
  if (bd < best.dist) best = { dist: bd, type: 'building', id: null };

  if (dir.y < -0.0001) {
    const t = -origin.y / dir.y;
    if (t > 0 && t < best.dist) best = { dist: t, type: 'ground', id: null };
  }

  for (const r of game.remotes.values()) {
    if (r.dead || r.vehicle) continue;
    const head = raySphere(origin, dir, r.x, r.y + 1.62, r.z, 0.32, best.dist);
    if (head !== null && head < best.dist) {
      best = { dist: head, type: 'player', id: r.id, headshot: true };
      continue;
    }
    const body = raySphere(origin, dir, r.x, r.y + 1.0, r.z, 0.55, best.dist);
    if (body !== null && body < best.dist) best = { dist: body, type: 'player', id: r.id, headshot: false };
  }

  for (const cop of game.cops.values()) {
    const t = raySphere(origin, dir, cop.x, cop.y + 0.9, cop.z, 1.7, best.dist);
    if (t !== null && t < best.dist) best = { dist: t, type: 'npc', id: cop.id };
  }

  for (const v of game.vehicles.values()) {
    if (game.player.vehicle && v.id === game.player.vehicle.id) continue;
    const t = raySphere(origin, dir, v.x, v.y + 0.8, v.z, v.def.size[2] * 0.42, best.dist);
    if (t !== null && t < best.dist) best = { dist: t, type: 'vehicle', id: v.id };
  }

  const ped = game.peds.raycast(origin, dir, best.dist);
  if (ped && ped.t < best.dist) best = { dist: ped.t, type: 'ped', ped: ped.ped };

  best.point = new THREE.Vector3(
    origin.x + dir.x * best.dist,
    origin.y + dir.y * best.dist,
    origin.z + dir.z * best.dist,
  );
  return best;
}

function fire() {
  const player = game.player;
  const w = WEAPONS[player.weapon];
  if (!player.canShoot()) {
    if (!w.melee && player.ammo[player.weapon].mag <= 0 && player.reloading <= 0) {
      if (player.reload()) sfx.reload();
      else game.hud.toast('Нет патронов');
    }
    return;
  }
  player.consumeShot();

  const { origin, dir } = player.aimRay(game.camera);
  const muzzle = new THREE.Vector3(player.x, player.y + 1.45, player.z).addScaledVector(dir, 0.5);
  const pellets = w.pellets || 1;
  let hitsSent = 0;

  for (let i = 0; i < pellets; i++) {
    const d = dir.clone();
    if (w.spread) {
      d.x += (Math.random() - 0.5) * w.spread * 2;
      d.y += (Math.random() - 0.5) * w.spread * 2;
      d.z += (Math.random() - 0.5) * w.spread * 2;
      d.normalize();
    }
    const hit = resolveHit(origin, d, w.range);
    const from = w.melee ? new THREE.Vector3(player.x, player.y + 1.3, player.z) : muzzle;
    if (!w.melee && i < 3) game.effects.tracer(from, hit.point);

    switch (hit.type) {
      case 'player':
        game.effects.bloodSpray(hit.point, d.clone().negate());
        sfx.hit(0, 'flesh');
        if (hitsSent < 6) {
          game.net.send({ t: 'hit', i: hit.id, kind: 'player', w: player.weapon, hs: hit.headshot });
          hitsSent += 1;
        }
        break;
      case 'npc':
        game.effects.impact(hit.point, d.clone().negate(), 'metal');
        sfx.hit(0, 'metal');
        if (hitsSent < 6) {
          game.net.send({ t: 'hit', i: hit.id, kind: 'npc', w: player.weapon });
          hitsSent += 1;
        }
        break;
      case 'vehicle': {
        game.effects.impact(hit.point, d.clone().negate(), 'metal');
        sfx.hit(0, 'metal');
        const v = game.vehicles.get(hit.id);
        if (v && !v.destroyed && i === 0) {
          game.net.send({ t: 'vdamage', i: hit.id, d: w.damage * 0.7 });
        }
        break;
      }
      case 'ped':
        game.peds.hitAt(hit.point, game.effects);
        game.net.send({ t: 'crime', k: 'ped' });
        break;
      case 'building':
      case 'ground':
        game.effects.impact(hit.point, d.clone().negate(), 'concrete');
        break;
      default:
        break;
    }
  }

  if (!w.melee) {
    game.effects.muzzleFlash(muzzle, dir);
    sfx.shot(player.weapon, 0);
    game.net.send({
      t: 'shot', w: player.weapon,
      ox: muzzle.x, oy: muzzle.y, oz: muzzle.z,
      dx: dir.x, dy: dir.y, dz: dir.z, len: Math.min(w.range, 60),
    });
    game.peds.scare(player.x, player.z, 24);
  } else {
    sfx.shot('fists', 0);
  }
}

// --- игровой цикл -----------------------------------------------------------

function renderLoop() {
  if (!game.running) return;
  requestAnimationFrame(renderLoop);
  const dt = Math.min(0.05, game.clock.getDelta());
  update(dt);
  game.postfx.render();
}

function update(dt) {
  const player = game.player;
  const input = game.input;

  game.time = (game.time + dt) % DAY_LENGTH;
  updateDayNight();

  // Смена оружия колесом.
  const wheel = input.takeWheel();
  if (wheel) player.switchWeapon(wheel > 0 ? 1 : -1);

  if (input.consumeEnter()) toggleVehicle();

  // Смерть и возрождение.
  if (player.dead) {
    const left = (game.deathUntil - Date.now()) / 1000;
    game.hud.setDeathTimer(left);
    if (left <= 0) game.net.send({ t: 'respawn' });
  }

  // Управление.
  if (player.vehicle) {
    updateDriving(dt);
  } else {
    player.update(dt, { input, world: game.world, camera: game.camera, sfx });
    if (input.firing && !player.dead && !game.hud.chatOpen) fire();
  }

  // Прицел показываем только вне машины или при прицеливании.
  if (!game.crosshair) game.crosshair = document.getElementById('crosshair');
  game.crosshair.classList.toggle('show', input.locked && (player.aiming || !player.vehicle));

  // Машины.
  const vehicleList = [...game.vehicles.values()];
  const renderTime = Date.now() + game.serverOffset - NET.INTERP_DELAY;
  for (const v of vehicleList) {
    if (player.vehicle && v.id === player.vehicle.id) {
      v.update(dt, { lights: v.lights || isNight(), siren: false });
      continue;
    }
    if (v.driver) v.interpolate(renderTime);
    else v.coast(dt, game.world);
    v.update(dt, { lights: isNight(), siren: v.def.police && !!v.driver });
  }

  for (const cop of game.cops.values()) {
    cop.interpolate(renderTime);
    cop.update(dt, { siren: true, lights: isNight() });
    if (Math.abs(cop.speed) > 6) {
      game.peds.checkRunOver(cop.x, cop.z, cop.speed, game.effects);
    }
  }

  // Сирена ближайшего патруля.
  game.sirenTimer -= dt;
  if (game.sirenTimer <= 0 && game.cops.size) {
    let nearest = Infinity;
    for (const cop of game.cops.values()) {
      nearest = Math.min(nearest, distanceToPlayer(cop.x, cop.z));
    }
    if (nearest < 90) {
      sfx.siren(nearest);
      game.sirenTimer = 0.34;
    } else {
      game.sirenTimer = 1;
    }
  }

  // Игроки.
  for (const r of game.remotes.values()) {
    r.interpolate(renderTime);
    r.update(dt, game.camera);
  }

  // Трафик: сам объезжает игрока, а игрок может в него врезаться.
  game.traffic.update(dt, player.x, player.z, [
    ...(player.vehicle ? [player.vehicle] : []),
    ...game.cops.values(),
  ]);
  for (const car of game.traffic.cars) {
    if (Math.abs(car.speed) > 5) game.peds.checkRunOver(car.x, car.z, car.speed, game.effects);
  }

  // Прохожие и эффекты.
  game.city.update?.(dt, game.camera);
  game.peds.update(dt, player.x, player.z);
  game.effects.update(dt);
  updatePickups(dt);

  // Дым из повреждённых машин.
  if (player.vehicle && player.vehicle.health < 40 && Math.random() < dt * 8) {
    game.effects.smoke(new THREE.Vector3(
      player.vehicle.x + Math.sin(player.vehicle.yaw) * 1.8,
      1.0,
      player.vehicle.z + Math.cos(player.vehicle.yaw) * 1.8,
    ), 0.8);
  }

  sendState();
  updateHud(dt);
}

function updateDriving(dt) {
  const player = game.player;
  const v = player.vehicle;
  const input = game.input;

  const look = input.takeLook();
  player.camYaw -= look.dx;
  player.camPitch = THREE.MathUtils.clamp(player.camPitch - look.dy, -0.9, 0.7);

  const mv = input.moveVector();
  const controls = {
    throttle: player.dead ? 0 : mv.y,
    steer: player.dead ? 0 : mv.x,
    handbrake: input.braking,
  };

  const impact = v.drive(dt, controls, game.world, [
    ...game.vehicles.values(), ...game.cops.values(), ...game.traffic.cars,
  ]);
  if (impact > 4) {
    const dmg = Math.min(40, impact * 2.4);
    game.net.send({ t: 'vdamage', i: v.id, d: dmg });
    sfx.hit(0, 'metal');
    game.effects.impact(new THREE.Vector3(v.x, 0.8, v.z), new THREE.Vector3(0, 1, 0), 'metal');
    game.hud.damageFlash(0.3);
  }

  // Следы юза и наезды.
  if (input.braking && Math.abs(v.speed) > 6 && Math.random() < dt * 20) {
    game.effects.skid(new THREE.Vector3(v.x, 0, v.z), v.yaw);
  }
  game.peds.checkRunOver(v.x, v.z, v.speed, game.effects);

  // Игрок «внутри» машины.
  player.x = v.x;
  player.z = v.z;
  player.y = v.y;
  player.yaw = v.yaw;
  player.mesh.visible = false;

  // Камера автоматически доворачивается за машиной при движении вперёд.
  if (Math.abs(v.speed) > 3 && Math.abs(look.dx) < 0.0001) {
    let diff = v.yaw - player.camYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    player.camYaw += diff * Math.min(1, dt * (v.speed > 0 ? 1.6 : 0.6));
  }

  player.updateCamera({ camera: game.camera, world: game.world }, dt);

  // Звук мотора.
  if (!game.engineSound) game.engineSound = sfx.engine('local');
  if (game.engineSound) {
    const rpm = Math.min(1, Math.abs(v.speed) / v.maxSpeed + Math.abs(controls.throttle) * 0.25);
    game.engineSound.set(rpm, 0.1 + rpm * 0.16);
  }

  if (v.health <= 0 && !v.destroyed) {
    v.setDestroyed(game.effects);
    leaveVehicle(true);
  }

  if (input.firing && !player.dead && !game.hud.chatOpen) fire();
}

function updatePickups(dt) {
  const now = Date.now();
  for (const p of game.pickups.values()) {
    const available = p.takenUntil <= now;
    p.mesh.visible = available;
    if (!available) continue;
    p.mesh.rotation.y += dt * 1.6;
    p.mesh.position.y = 1 + Math.sin(now / 400 + p.x) * 0.12;
    if (!game.player.dead && !game.player.vehicle) {
      if (Math.hypot(p.x - game.player.x, p.z - game.player.z) < 1.6) {
        p.takenUntil = now + 3000; // ждём подтверждения сервера
        // Сначала свежая позиция, иначе сервер проверит дистанцию по старой.
        game.lastSend = 0;
        sendState();
        game.net.send({ t: 'pickup', i: p.id });
      }
    }
  }
}

function sendState() {
  const now = performance.now();
  if (now - game.lastSend < 1000 / NET.CLIENT_HZ) return;
  game.lastSend = now;
  const p = game.player;
  game.net.send({
    t: 'state',
    x: round(p.x), y: round(p.y), z: round(p.z),
    r: round(p.yaw), p: round(p.camPitch),
    a: p.dead ? 'dead' : p.vehicle ? 'drive' : p.aiming ? 'aim' : p.speed > 4 ? 'run' : p.speed > 0.4 ? 'walk' : 'idle',
  });
  if (p.vehicle) {
    game.net.send({
      t: 'vstate', i: p.vehicle.id,
      x: round(p.vehicle.x), y: round(p.vehicle.y), z: round(p.vehicle.z),
      r: round(p.vehicle.yaw), sp: round(p.vehicle.speed),
    });
  }
}

function round(v) {
  return Math.round(v * 100) / 100;
}

function updateHud(dt) {
  const p = game.player;
  const hud = game.hud;
  const w = WEAPONS[p.weapon];
  const ammo = p.ammo[p.weapon];

  hud.setHealth(p.health, p.armor);
  hud.setMoney(p.money);
  hud.setWeapon(
    p.reloading > 0 ? `${w.name} — перезарядка` : w.name,
    ammo.mag,
    ammo.reserve === Infinity ? '∞' : ammo.reserve,
  );

  if (p.vehicle) hud.setVehicle(p.vehicle.def.name, p.vehicle.kmh, p.vehicle.health);
  else hud.setVehicle(null);

  // Подсказки.
  if (!p.vehicle && !p.dead) {
    const v = nearestVehicle();
    hud.hint(v ? `<b>F</b> — сесть в «${v.def.name}»` : '');
  } else if (p.vehicle) {
    hud.hint('<b>F</b> — выйти · <b>Пробел</b> — ручник · <b>H</b> — сигнал');
  } else {
    hud.hint('');
  }

  // Название улицы под игроком.
  const streetIndexX = Math.round((p.x - CONFIG.origin - CONFIG.road / 2) / CONFIG.pitch);
  const streetIndexZ = Math.round((p.z - CONFIG.origin - CONFIG.road / 2) / CONFIG.pitch);
  const onX = Math.abs(p.x - snapToRoad(p.x)) < Math.abs(p.z - snapToRoad(p.z));
  const name = onX
    ? STREET_NAMES[Math.abs(streetIndexX) % STREET_NAMES.length]
    : STREET_NAMES[(Math.abs(streetIndexZ) + 5) % STREET_NAMES.length];
  hud.setStreet(name);

  game.fps += (1 / Math.max(dt, 0.0001) - game.fps) * 0.05;
  hud.setStats(`${Math.round(game.fps)} FPS · ${game.net.ping} мс · игроков: ${game.remotes.size + 1} · ДПС: ${game.cops.size}`);

  // Таблица игроков — пересобираем только когда она открыта.
  if (hud.scoreVisible) {
    const rows = [{
      name: p.name || 'Вы', kills: p.kills, deaths: p.deaths, wanted: p.wanted, ping: game.net.ping, me: true,
    }];
    for (const r of game.remotes.values()) {
      rows.push({ name: r.name, kills: r.kills, deaths: r.deaths, wanted: r.wanted });
    }
    hud.updateScoreboard(rows);
  }

  // Миникарта.
  game.minimap.draw({
    x: p.x, z: p.z, yaw: p.vehicle ? p.vehicle.yaw : p.yaw,
    players: [...game.remotes.values()].map((r) => ({ x: r.x, z: r.z })),
    cops: [...game.cops.values()].map((c) => ({ x: c.x, z: c.z })),
    vehicles: [...game.vehicles.values()].map((v) => ({ x: v.x, z: v.z, police: v.def.police })),
    pickups: [...game.pickups.values()],
  });
}

// --- освещение и время суток ------------------------------------------------

function isNight() {
  const t = game.time / DAY_LENGTH;
  return t < 0.22 || t > 0.78;
}

const DAY_SKY = new THREE.Color(0x8fa6bd);
const EVENING_SKY = new THREE.Color(0xd9a86a);
const NIGHT_SKY = new THREE.Color(0x141a28);
const tmpColor = new THREE.Color();

function updateDayNight() {
  const t = game.time / DAY_LENGTH;
  const angle = t * Math.PI * 2 - Math.PI / 2;
  const elevation = Math.sin(angle);
  const azimuth = Math.cos(angle);

  const p = game.player;
  game.sun.position.set(
    p.x + azimuth * 120,
    Math.max(6, elevation * 150),
    p.z + 70,
  );
  game.sun.target.position.set(p.x, 0, p.z);
  game.sun.target.updateMatrixWorld();

  const dayness = THREE.MathUtils.clamp(elevation * 1.6 + 0.35, 0, 1);
  const eveningness = THREE.MathUtils.clamp(1 - Math.abs(elevation) * 3.2, 0, 1);

  tmpColor.copy(NIGHT_SKY).lerp(DAY_SKY, dayness).lerp(EVENING_SKY, eveningness * 0.55);
  game.scene.fog.color.copy(tmpColor);

  // Небесный купол и сила свечения.
  const sunDir = new THREE.Vector3(azimuth, Math.max(-0.25, elevation), 0.45).normalize();
  game.sky?.update(dayness, sunDir, game.time, p);
  game.postfx?.setNight(dayness);
  game.scene.fog.near = 110 + dayness * 60;
  game.scene.fog.far = 380 + dayness * 320;

  game.sun.intensity = 0.12 + dayness * 2.1;
  game.sun.color.setHSL(0.09, 0.45, 0.55 + dayness * 0.35);
  game.hemi.intensity = 0.22 + dayness * 0.7;

  if (game.city) game.city.setNight(dayness < 0.35);
}

function distanceToPlayer(x, z) {
  return Math.hypot(x - game.player.x, z - game.player.z);
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Пауза рендера, когда вкладка скрыта — не копим дельту.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && game.clock) game.clock.getDelta();
});

window.game = game; // для отладки из консоли
