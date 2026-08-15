// Локальный игрок: перемещение пешком, камера от третьего лица,
// стрельба, патроны, посадка в машину.
import * as THREE from 'three';
import { PLAYER, WEAPONS, WEAPON_ORDER } from '/shared/protocol.js';
import { resolveCircle, raycastBuildings } from '/shared/worldgen.js';
import { createCharacter } from './models.js';

const tmpRes = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
const V = new THREE.Vector3();

export const START_AMMO = {
  fists: { mag: Infinity, reserve: Infinity },
  pm: { mag: 8, reserve: 40 },
  ak: { mag: 0, reserve: 0 },
  obrez: { mag: 0, reserve: 0 },
};

export class LocalPlayer {
  constructor(scene, skin = 0) {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vy = 0;
    this.yaw = 0; // куда смотрит модель
    this.camYaw = 0;
    this.camPitch = -0.12;
    this.camDist = 5.2;
    this.speed = 0;
    this.onGround = true;
    this.health = PLAYER.maxHealth;
    this.armor = 0;
    this.money = 500;
    this.wanted = 0;
    this.kills = 0;
    this.deaths = 0;
    this.dead = false;
    this.weapon = 'pm';
    this.aiming = false;
    this.reloading = 0;
    this.fireCooldown = 0;
    this.stepTimer = 0;
    this.vehicle = null; // VehicleEntity, если за рулём
    this.skin = skin;

    this.ammo = {};
    for (const key of Object.keys(START_AMMO)) {
      this.ammo[key] = { mag: START_AMMO[key].mag, reserve: START_AMMO[key].reserve };
    }

    this.mesh = createCharacter(skin);
    scene.add(this.mesh);
  }

  get eye() {
    return V.set(this.x, this.y + 1.55, this.z);
  }

  giveWeapon(id) {
    if (!WEAPONS[id]) return;
    const w = WEAPONS[id];
    const a = this.ammo[id];
    a.mag = w.mag;
    a.reserve = Math.min(w.mag * 5, (a.reserve || 0) + w.mag * 3);
    this.weapon = id;
  }

  switchWeapon(dir) {
    const owned = WEAPON_ORDER.filter((id) => id === 'fists' || this.ammo[id].mag > 0 || this.ammo[id].reserve > 0);
    const idx = Math.max(0, owned.indexOf(this.weapon));
    const next = owned[(idx + dir + owned.length) % owned.length];
    this.weapon = next;
    this.reloading = 0;
    return next;
  }

  selectWeapon(id) {
    if (!WEAPONS[id]) return;
    if (id !== 'fists' && this.ammo[id].mag <= 0 && this.ammo[id].reserve <= 0) return;
    this.weapon = id;
  }

  reload() {
    const w = WEAPONS[this.weapon];
    if (!w || w.melee) return false;
    const a = this.ammo[this.weapon];
    if (a.mag >= w.mag || a.reserve <= 0 || this.reloading > 0) return false;
    this.reloading = w.id === 'obrez' ? 1.6 : 1.9;
    return true;
  }

  finishReload() {
    const w = WEAPONS[this.weapon];
    const a = this.ammo[this.weapon];
    const need = w.mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take;
    a.reserve -= take;
  }

  /** Обновление персонажа на своих двоих. */
  update(dt, ctx) {
    const { input, world } = ctx;

    // Камера от мыши.
    const look = input.takeLook();
    this.camYaw -= look.dx;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - look.dy, -1.1, 0.85);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this.finishReload();
    }
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    if (this.dead) {
      this.speed = 0;
      this.mesh.update(dt, { dead: true });
      this.updateCamera(ctx, dt);
      return;
    }

    this.aiming = input.aiming && !this.vehicle;

    const mv = input.moveVector();
    const sprint = input.sprinting && !this.aiming;
    const maxSpeed = this.aiming ? PLAYER.walkSpeed * 0.8 : sprint ? PLAYER.runSpeed : PLAYER.walkSpeed * 1.35;

    // Направление относительно камеры.
    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    // Камера смотрит вдоль (sin, cos), вправо от неё — (-cos, sin).
    // Раньше обе оси были взяты с обратным знаком, и на «вперёд»
    // персонаж уходил ровно назад, к камере.
    const wishX = mv.y * sin - mv.x * cos;
    const wishZ = mv.y * cos + mv.x * sin;
    const wishLen = Math.hypot(wishX, wishZ);

    const accel = this.onGround ? 26 : 8;
    this.velX = this.velX || 0;
    this.velZ = this.velZ || 0;
    if (wishLen > 0.01) {
      const dirX = wishX / wishLen;
      const dirZ = wishZ / wishLen;
      this.velX += (dirX * maxSpeed - this.velX) * Math.min(1, accel * dt / maxSpeed * 2.2);
      this.velZ += (dirZ * maxSpeed - this.velZ) * Math.min(1, accel * dt / maxSpeed * 2.2);
      const targetYaw = this.aiming ? this.camYaw : Math.atan2(dirX, dirZ);
      this.turnTowards(targetYaw, dt * (this.aiming ? 18 : 11));
    } else {
      const damp = Math.max(0, 1 - dt * 12);
      this.velX *= damp;
      this.velZ *= damp;
      if (this.aiming) this.turnTowards(this.camYaw, dt * 18);
    }

    // Прыжок и гравитация.
    if (input.jumping && this.onGround) {
      this.vy = PLAYER.jump;
      this.onGround = false;
    }
    this.vy -= PLAYER.gravity * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) {
      this.y = 0;
      this.vy = 0;
      this.onGround = true;
    }

    const nx = this.x + this.velX * dt;
    const nz = this.z + this.velZ * dt;
    resolveCircle(world, nx, nz, PLAYER.radius, tmpRes);
    if (tmpRes.hit) {
      if (tmpRes.nx) this.velX = 0;
      if (tmpRes.nz) this.velZ = 0;
    }
    this.x = tmpRes.x;
    this.z = tmpRes.z;

    this.speed = Math.hypot(this.velX, this.velZ);

    // Шаги.
    if (this.onGround && this.speed > 1) {
      this.stepTimer -= dt * this.speed;
      if (this.stepTimer <= 0) {
        this.stepTimer = 2.4;
        ctx.sfx?.step(0);
      }
    }

    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.yaw;
    this.mesh.update(dt, {
      speed: this.speed,
      aiming: this.aiming,
      pitch: this.camPitch,
      weapon: this.weapon,
    });
    this.mesh.visible = true;

    this.updateCamera(ctx, dt);
  }

  turnTowards(target, rate) {
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, rate);
  }

  /** Камера: за спиной, с проверкой стен. */
  updateCamera(ctx, dt) {
    const { camera, world } = ctx;
    const targetDist = this.vehicle
      ? 7.2 + Math.min(3.4, this.vehicle.kmh / 30)
      : this.aiming ? 2.3 : 5.2;
    this.camDist += (targetDist - this.camDist) * Math.min(1, dt * 6);

    const focus = this.vehicle
      ? V.set(this.vehicle.x, this.vehicle.y + 1.5, this.vehicle.z).clone()
      : new THREE.Vector3(this.x, this.y + 1.5, this.z);

    if (this.aiming && !this.vehicle) {
      // Через плечо.
      focus.x += Math.cos(this.camYaw) * 0.65;
      focus.z -= Math.sin(this.camYaw) * 0.65;
      focus.y += 0.1;
    }

    const dirX = Math.sin(this.camYaw) * Math.cos(this.camPitch);
    const dirZ = Math.cos(this.camYaw) * Math.cos(this.camPitch);
    const dirY = Math.sin(this.camPitch);

    // Не пускаем камеру в стену.
    let dist = this.camDist;
    const hit = raycastBuildings(world, focus.x, focus.y, focus.z, -dirX, -dirY, -dirZ, dist + 0.6);
    if (hit < dist + 0.6) dist = Math.max(1.1, hit - 0.4);

    camera.position.set(
      focus.x - dirX * dist,
      Math.max(0.6, focus.y - dirY * dist + 0.35),
      focus.z - dirZ * dist,
    );
    camera.lookAt(focus.x, focus.y + (this.aiming ? 0.05 : 0.2), focus.z);
  }

  /** Луч прицеливания из камеры. */
  aimRay(camera) {
    const origin = camera.position.clone();
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    return { origin, dir };
  }

  canShoot() {
    if (this.dead || this.reloading > 0 || this.fireCooldown > 0) return false;
    const w = WEAPONS[this.weapon];
    if (w.melee) return true;
    return this.ammo[this.weapon].mag > 0;
  }

  consumeShot() {
    const w = WEAPONS[this.weapon];
    this.fireCooldown = 60 / w.rpm;
    if (!w.melee) this.ammo[this.weapon].mag -= 1;
  }

  hp() {
    return Math.max(0, Math.round(this.health));
  }
}
