// Прохожие: живут только на клиенте, ходят по тротуарам, шарахаются от
// стрельбы и попадают под колёса (за это начисляется розыск).
import * as THREE from 'three';
import { CONFIG, roadCenter, resolveCircle } from '/shared/worldgen.js';
import { createCharacter, SKINS } from './models.js';

const tmpRes = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
const MAX_PEDS = 16;
const SPAWN_RADIUS = 95;
const DESPAWN_RADIUS = 130;

function nearestSidewalkLine(v) {
  const i = Math.round((v - CONFIG.origin - CONFIG.road / 2) / CONFIG.pitch);
  const clamped = Math.max(0, Math.min(CONFIG.gridSize, i));
  return roadCenter(clamped);
}

export class Peds {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.onKilled = null;
  }

  spawnNear(cx, cz) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * (SPAWN_RADIUS - 30);
    let x = cx + Math.cos(angle) * dist;
    let z = cz + Math.sin(angle) * dist;

    // Ставим на тротуар вдоль ближайшей улицы.
    const alongX = Math.random() < 0.5;
    const off = CONFIG.road / 2 + 2.2;
    if (alongX) {
      x = nearestSidewalkLine(x) + (Math.random() < 0.5 ? off : -off);
    } else {
      z = nearestSidewalkLine(z) + (Math.random() < 0.5 ? off : -off);
    }

    const lim = CONFIG.origin + CONFIG.total - 4;
    if (x < CONFIG.origin + 4 || x > lim || z < CONFIG.origin + 4 || z > lim) return;

    const mesh = createCharacter(Math.floor(Math.random() * SKINS.length));
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);

    const dir = Math.random() < 0.5 ? 1 : -1;
    this.list.push({
      mesh,
      x, z,
      yaw: alongX ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2),
      alongX,
      speed: 1.1 + Math.random() * 0.7,
      panic: 0,
      dead: false,
      deadTimer: 0,
      wander: Math.random() * 6,
    });
  }

  scare(x, z, radius = 22) {
    for (const p of this.list) {
      if (p.dead) continue;
      if (Math.hypot(p.x - x, p.z - z) < radius) p.panic = 5 + Math.random() * 3;
    }
  }

  /**
   * Проверка наезда. blame — сбил ли именно игрок: трафик и ДПС тоже давят
   * пешеходов, но розыск за это вешать на игрока нельзя.
   */
  checkRunOver(vx, vz, speed, effects, blame = false) {
    if (Math.abs(speed) < 6) return 0;
    let hits = 0;
    for (const p of this.list) {
      if (p.dead) continue;
      if (Math.hypot(p.x - vx, p.z - vz) < 2.2) {
        p.dead = true;
        p.deadTimer = 12;
        hits += 1;
        if (effects) {
          effects.bloodSpray(new THREE.Vector3(p.x, 0.9, p.z), new THREE.Vector3(0, 1, 0));
        }
        this.scare(p.x, p.z, 26);
        if (blame && this.onKilled) this.onKilled(p);
      }
    }
    return hits;
  }

  /** Попадание пули в прохожего. */
  hitAt(point, effects) {
    for (const p of this.list) {
      if (p.dead) continue;
      const dx = p.x - point.x;
      const dz = p.z - point.z;
      if (Math.hypot(dx, dz) < 0.75 && point.y < 2) {
        p.dead = true;
        p.deadTimer = 12;
        if (effects) effects.bloodSpray(point.clone(), new THREE.Vector3(0, 1, 0));
        this.scare(p.x, p.z, 30);
        if (this.onKilled) this.onKilled(p);
        return true;
      }
    }
    return false;
  }

  /** Ближайший живой прохожий к лучу — для попаданий из оружия. */
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const p of this.list) {
      if (p.dead) continue;
      const ox = p.x - origin.x;
      const oy = 1.0 - origin.y;
      const oz = p.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > maxDist) continue;
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      const d = Math.hypot(px - p.x, py - 1.0, pz - p.z);
      if (d < 0.62 && (!best || t < best.t)) {
        best = { t, ped: p, point: new THREE.Vector3(px, py, pz) };
      }
    }
    return best;
  }

  update(dt, cx, cz) {
    // Поддерживаем популяцию рядом с игроком.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.dead) {
        p.deadTimer -= dt;
        p.mesh.update(dt, { dead: true, speed: 0 });
        p.mesh.position.set(p.x, 0, p.z);
        if (p.deadTimer <= 0) {
          this.scene.remove(p.mesh);
          this.list.splice(i, 1);
        }
        continue;
      }
      if (Math.hypot(p.x - cx, p.z - cz) > DESPAWN_RADIUS) {
        this.scene.remove(p.mesh);
        this.list.splice(i, 1);
      }
    }
    while (this.list.length < MAX_PEDS) {
      const before = this.list.length;
      this.spawnNear(cx, cz);
      if (this.list.length === before) break; // не нашли место — не зацикливаемся
    }

    for (const p of this.list) {
      if (p.dead) continue;
      const panicking = p.panic > 0;
      if (panicking) p.panic -= dt;

      p.wander -= dt;
      if (p.wander <= 0) {
        p.wander = 4 + Math.random() * 6;
        if (Math.random() < 0.4) p.yaw += (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
      }

      const speed = panicking ? p.speed * 2.6 : p.speed;
      const nx = p.x + Math.sin(p.yaw) * speed * dt;
      const nz = p.z + Math.cos(p.yaw) * speed * dt;
      resolveCircle(this.world, nx, nz, 0.4, tmpRes);
      if (tmpRes.hit) {
        p.yaw += Math.PI / 2 + Math.random();
      }
      p.x = tmpRes.x;
      p.z = tmpRes.z;

      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.yaw;
      p.mesh.update(dt, { speed, dead: false });
    }
  }

  clear() {
    for (const p of this.list) this.scene.remove(p.mesh);
    this.list.length = 0;
  }
}
