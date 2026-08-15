// Отрисовка чужих игроков: интерполяция сетевых состояний и таблички с ником.
import * as THREE from 'three';
import { createCharacter } from './models.js';
import { labelTexture } from './textures.js';

export class RemotePlayer {
  constructor(scene, data) {
    this.id = data.i;
    this.name = data.n || 'Игрок';
    this.skin = data.s || 0;
    this.x = data.x || 0;
    this.y = data.y || 0;
    this.z = data.z || 0;
    this.yaw = data.r || 0;
    this.pitch = data.p || 0;
    this.health = data.h != null ? data.h : 100;
    this.kills = data.k || 0;
    this.deaths = data.d || 0;
    this.wanted = data.wl || 0;
    this.vehicle = data.v || null;
    this.dead = !!data.dead;
    this.speed = 0;
    this.buffer = [];

    this.mesh = createCharacter(this.skin);
    this.mesh.position.set(this.x, this.y, this.z);
    scene.add(this.mesh);

    this.label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(this.name),
      depthTest: false,
      transparent: true,
    }));
    this.label.scale.set(2.6, 0.65, 1);
    this.label.position.y = 2.35;
    this.label.renderOrder = 10;
    this.mesh.add(this.label);
    this.labelText = this.name;
  }

  pushState(s, time) {
    this.buffer.push({
      t: time, x: s.x, y: s.y, z: s.z, yaw: s.r, pitch: s.p, anim: s.a,
    });
    if (this.buffer.length > 24) this.buffer.shift();
    this.health = s.h != null ? s.h : this.health;
    this.kills = s.k != null ? s.k : this.kills;
    this.deaths = s.d != null ? s.d : this.deaths;
    this.wanted = s.wl != null ? s.wl : this.wanted;
    this.vehicle = s.v !== undefined ? s.v : this.vehicle;
    this.dead = s.dd ? true : s.dd === 0 ? false : this.dead;
    this.weapon = s.w || this.weapon;
  }

  interpolate(renderTime) {
    const buf = this.buffer;
    if (!buf.length) return;
    let prev = buf[0];
    let next = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (renderTime >= buf[i].t && renderTime <= buf[i + 1].t) {
        prev = buf[i];
        next = buf[i + 1];
        break;
      }
    }
    const span = Math.max(1, next.t - prev.t);
    const k = THREE.MathUtils.clamp((renderTime - prev.t) / span, 0, 1);
    const px = this.x;
    const pz = this.z;
    this.x = prev.x + (next.x - prev.x) * k;
    this.y = prev.y + (next.y - prev.y) * k;
    this.z = prev.z + (next.z - prev.z) * k;
    let dy = next.yaw - prev.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw = prev.yaw + dy * k;
    this.pitch = prev.pitch;
    this.anim = next.anim;
    this.frameSpeed = Math.hypot(this.x - px, this.z - pz);
  }

  update(dt, camera) {
    const inCar = !!this.vehicle;
    this.mesh.visible = !inCar;
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.yaw;
    const speed = dt > 0 ? (this.frameSpeed || 0) / dt : 0;
    this.speed = speed;
    this.mesh.update(dt, {
      speed,
      aiming: this.anim === 'aim' || this.anim === 'shoot',
      pitch: this.pitch,
      weapon: this.weapon,
      dead: this.dead,
    });

    // Табличка всегда читается и тускнеет с расстоянием.
    if (camera) {
      const dist = camera.position.distanceTo(this.mesh.position);
      this.label.visible = dist < 70 && !inCar;
      const scale = THREE.MathUtils.clamp(dist / 22, 0.65, 2.4);
      this.label.scale.set(2.6 * scale, 0.65 * scale, 1);
      this.label.position.y = 2.3;
    }

    const wantedStars = this.wanted > 0 ? ` ${'★'.repeat(Math.min(5, this.wanted))}` : '';
    const text = `${this.name}${wantedStars}`;
    if (text !== this.labelText) {
      this.labelText = text;
      this.label.material.map.dispose();
      this.label.material.map = labelTexture(text, {
        fg: this.wanted > 0 ? '#ffd36b' : '#f2f5f7',
      });
      this.label.material.needsUpdate = true;
    }
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.mesh.traverse((o) => {
      if (o.isMesh) o.geometry?.dispose?.();
    });
  }
}
