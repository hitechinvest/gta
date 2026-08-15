// Аркадная физика автомобиля и сущность машины (своя и чужая).
import * as THREE from 'three';
import { VEHICLES } from '/shared/protocol.js';
import { resolveCircle } from '/shared/worldgen.js';
import { createVehicle } from './models.js';

const tmpRes = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

export class VehicleEntity {
  constructor(scene, data) {
    this.id = data.i || data.id;
    this.type = data.t || data.type || 'zhiguli';
    this.def = VEHICLES[this.type] || VEHICLES.zhiguli;
    this.color = data.c || data.color || this.def.colors[0];
    this.x = data.x || 0;
    this.y = data.y || 0;
    this.z = data.z || 0;
    this.yaw = data.r || 0;
    this.speed = data.sp || 0;
    this.vx = 0;
    this.vz = 0;
    this.health = data.hp != null ? data.hp : this.def.health;
    this.driver = data.dr || null;
    this.npc = !!data.npc;
    this.steerInput = 0;
    this.braking = false;
    this.lights = false;
    this.destroyed = this.health <= 0;

    this.mesh = createVehicle(this.type, this.color);
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.yaw;
    scene.add(this.mesh);

    // Буфер для интерполяции сетевых состояний.
    this.buffer = [];
    this.smokeTimer = 0;
  }

  get maxSpeed() {
    return this.def.maxSpeed;
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6;
  }

  /** Управление игроком: throttle -1..1, steer -1..1. */
  drive(dt, controls, world, others) {
    const def = this.def;
    const throttle = controls.throttle;
    const handbrake = controls.handbrake;

    // Продольная динамика.
    if (throttle > 0) {
      const limit = def.maxSpeed * (this.health <= 0 ? 0 : 1);
      this.speed += def.accel * throttle * dt * (this.speed < 0 ? 2 : 1);
      if (this.speed > limit) this.speed = limit;
    } else if (throttle < 0) {
      if (this.speed > 0.5) this.speed -= def.brake * dt;
      else this.speed = Math.max(-def.maxSpeed * 0.4, this.speed + def.accel * throttle * dt * 0.7);
    } else {
      // Наката и торможения двигателем.
      const drag = 3.2 + Math.abs(this.speed) * 0.12;
      if (this.speed > 0) this.speed = Math.max(0, this.speed - drag * dt);
      else this.speed = Math.min(0, this.speed + drag * dt);
    }
    if (handbrake) {
      this.speed *= Math.max(0, 1 - dt * 2.4);
    }
    if (this.health <= 0) this.speed *= Math.max(0, 1 - dt * 2);

    // Поворот: чем быстрее, тем меньше угол; на месте не крутимся.
    const speedFactor = Math.min(1, Math.abs(this.speed) / 7) * (1 - Math.min(0.55, Math.abs(this.speed) / (def.maxSpeed * 2)));
    this.steerInput += (controls.steer - this.steerInput) * Math.min(1, dt * 9);
    const turn = this.steerInput * def.steer * speedFactor * Math.sign(this.speed || 1);
    this.yaw += turn * dt * 2.4;

    // Скорость как вектор: сцепление тянет её к направлению корпуса.
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const targetVx = fx * this.speed;
    const targetVz = fz * this.speed;
    const grip = (handbrake ? def.grip * 0.22 : def.grip) * dt;
    this.vx += (targetVx - this.vx) * Math.min(1, grip);
    this.vz += (targetVz - this.vz) * Math.min(1, grip);

    // Занос: сохраняем часть боковой скорости.
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;

    let impact = 0;
    // Кузов как две окружности — нос и корма.
    const halfLen = this.def.size[2] * 0.28;
    const radius = this.def.size[0] * 0.52;
    let cx = nx;
    let cz = nz;
    for (const sign of [1, -1]) {
      const px = cx + fx * halfLen * sign;
      const pz = cz + fz * halfLen * sign;
      resolveCircle(world, px, pz, radius, tmpRes);
      if (tmpRes.hit) {
        const dx = tmpRes.x - px;
        const dz = tmpRes.z - pz;
        cx += dx;
        cz += dz;
        const vn = this.vx * (tmpRes.nx || 0) + this.vz * (tmpRes.nz || 0);
        if (vn < 0) {
          impact = Math.max(impact, Math.abs(vn));
          this.vx -= (tmpRes.nx || 0) * vn * 1.35;
          this.vz -= (tmpRes.nz || 0) * vn * 1.35;
          this.speed *= 0.42;
        }
      }
    }

    // Столкновения с другими машинами.
    for (const other of others) {
      if (other === this || other.destroyed) continue;
      const dx = cx - other.x;
      const dz = cz - other.z;
      const dist = Math.hypot(dx, dz);
      const minDist = (this.def.size[2] + other.def.size[2]) * 0.36;
      if (dist > 0.001 && dist < minDist) {
        const push = (minDist - dist) / dist;
        cx += dx * push * 0.6;
        cz += dz * push * 0.6;
        const rel = Math.abs(this.speed) + Math.abs(other.speed);
        impact = Math.max(impact, rel * 0.35);
        this.speed *= 0.6;
        this.vx = this.vx * 0.4 + (dx / dist) * rel * 0.25;
        this.vz = this.vz * 0.4 + (dz / dist) * rel * 0.25;
        if (!other.driver) {
          other.vx += -(dx / dist) * rel * 0.2;
          other.vz += -(dz / dist) * rel * 0.2;
          other.speed = Math.max(other.speed, rel * 0.15);
        }
      }
    }

    this.x = cx;
    this.z = cz;
    this.braking = throttle < 0 && this.speed > 0.5;
    this.syncMesh();
    return impact;
  }

  /** Свободный откат для брошенных машин (после толчка). */
  coast(dt, world) {
    if (Math.abs(this.vx) + Math.abs(this.vz) < 0.02) return;
    const damp = Math.max(0, 1 - dt * 1.8);
    this.vx *= damp;
    this.vz *= damp;
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    resolveCircle(world, nx, nz, this.def.size[0] * 0.55, tmpRes);
    this.x = tmpRes.x;
    this.z = tmpRes.z;
    this.speed = Math.hypot(this.vx, this.vz);
    this.syncMesh();
  }

  /** Приём сетевого состояния (чужая машина). */
  pushNetState(state, time) {
    this.buffer.push({
      t: time, x: state.x, y: state.y || 0, z: state.z, yaw: state.r, speed: state.sp || 0,
    });
    if (this.buffer.length > 24) this.buffer.shift();
    this.health = state.hp != null ? state.hp : this.health;
    this.driver = state.dr !== undefined ? state.dr : this.driver;
    if (state.hp <= 0) this.destroyed = true;
  }

  /** Интерполяция позиции чужой машины. */
  interpolate(renderTime) {
    const buf = this.buffer;
    if (buf.length === 0) return;
    if (buf.length === 1 || renderTime <= buf[0].t) {
      const s = buf[0];
      this.x = s.x; this.z = s.z; this.y = s.y; this.yaw = s.yaw; this.speed = s.speed;
      this.syncMesh();
      return;
    }
    for (let i = 0; i < buf.length - 1; i++) {
      const a = buf[i];
      const b = buf[i + 1];
      if (renderTime >= a.t && renderTime <= b.t) {
        const k = (renderTime - a.t) / Math.max(1, b.t - a.t);
        this.x = a.x + (b.x - a.x) * k;
        this.y = a.y + (b.y - a.y) * k;
        this.z = a.z + (b.z - a.z) * k;
        let dy = b.yaw - a.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.yaw = a.yaw + dy * k;
        this.speed = a.speed + (b.speed - a.speed) * k;
        this.syncMesh();
        return;
      }
    }
    const last = buf[buf.length - 1];
    this.x = last.x; this.y = last.y; this.z = last.z; this.yaw = last.yaw; this.speed = last.speed;
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.yaw;
  }

  update(dt, opts = {}) {
    this.mesh.update(dt, {
      speed: this.speed,
      steer: this.steerInput,
      siren: opts.siren ?? (this.def.police && (this.npc || this.driver)),
      braking: this.braking,
      lights: opts.lights ?? this.lights,
    });
  }

  setDestroyed(effects) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.health = 0;
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material && o.material.color) {
        o.material = o.material.clone();
        o.material.color.multiplyScalar(0.35);
      }
    });
    if (effects) effects.explosion(this.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0)));
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose?.();
      }
    });
  }
}
