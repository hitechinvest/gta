// Визуальные эффекты: трассеры, искры, кровь, взрывы, дым, вспышки выстрела.
import * as THREE from 'three';

const TMP = new THREE.Vector3();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];

    this.tracerGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 5, 1, true);
    this.tracerGeo.translate(0, 0.5, 0);
    this.tracerGeo.rotateX(Math.PI / 2);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 });

    this.sparkGeo = new THREE.SphereGeometry(0.05, 5, 4);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc247 });
    this.bloodMat = new THREE.MeshBasicMaterial({ color: 0x8e1414 });
    this.smokeMat = new THREE.MeshBasicMaterial({ color: 0x6a6a6a, transparent: true, opacity: 0.5 });
    this.fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.95 });
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.95 });
    this.flashGeo = new THREE.SphereGeometry(0.16, 6, 5);
    this.decalGeo = new THREE.CircleGeometry(0.5, 10);
  }

  add(mesh, life, updater) {
    mesh.userData.t = 0;
    mesh.userData.life = life;
    mesh.userData.updater = updater;
    this.scene.add(mesh);
    this.items.push(mesh);
    return mesh;
  }

  tracer(from, to, color = 0xffe08a) {
    const dist = from.distanceTo(to);
    if (dist < 0.2) return;
    const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
    mesh.material.color.setHex(color);
    mesh.position.copy(from);
    mesh.lookAt(to);
    mesh.scale.set(1, 1, dist);
    this.add(mesh, 0.09, (m, k) => { m.material.opacity = 0.9 * (1 - k); });
  }

  muzzleFlash(position, dir) {
    const mesh = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    mesh.position.copy(position).addScaledVector(dir, 0.25);
    mesh.scale.setScalar(1 + Math.random() * 0.5);
    this.add(mesh, 0.06, (m, k) => {
      m.material.opacity = 0.95 * (1 - k);
      m.scale.setScalar(1 + k * 1.6);
    });
    const light = new THREE.PointLight(0xffcf7a, 6, 14);
    light.position.copy(mesh.position);
    this.add(light, 0.07, (l, k) => { l.intensity = 6 * (1 - k); });
  }

  impact(point, normal = new THREE.Vector3(0, 1, 0), kind = 'concrete') {
    const color = kind === 'blood' ? 0x8e1414 : kind === 'metal' ? 0xffd27a : 0xbdb7a8;
    for (let i = 0; i < (kind === 'blood' ? 7 : 5); i++) {
      const m = new THREE.Mesh(this.sparkGeo, (kind === 'blood' ? this.bloodMat : this.sparkMat).clone());
      m.position.copy(point);
      const v = new THREE.Vector3(
        normal.x + (Math.random() - 0.5) * 1.6,
        Math.abs(normal.y) + Math.random() * 1.4,
        normal.z + (Math.random() - 0.5) * 1.6,
      ).multiplyScalar(2 + Math.random() * 3);
      m.material.color.setHex(color);
      this.add(m, 0.45 + Math.random() * 0.3, (mesh, k, dt) => {
        v.y -= 14 * dt;
        mesh.position.addScaledVector(v, dt);
        mesh.scale.setScalar(1 - k * 0.6);
      });
    }
    // Пыль от попадания.
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), this.smokeMat.clone());
    puff.position.copy(point);
    this.add(puff, 0.5, (m, k) => {
      m.scale.setScalar(1 + k * 3);
      m.material.opacity = 0.4 * (1 - k);
    });
  }

  bloodSpray(point, dir) {
    this.impact(point, dir, 'blood');
    const decal = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({
      color: 0x6e1010, transparent: true, opacity: 0.8, depthWrite: false,
    }));
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(point.x, 0.06, point.z);
    decal.scale.setScalar(0.6 + Math.random() * 0.6);
    this.add(decal, 22, (m, k) => { m.material.opacity = 0.8 * (1 - k * k); });
  }

  explosion(position) {
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), this.fireMat.clone());
    core.position.copy(position);
    this.add(core, 0.6, (m, k) => {
      m.scale.setScalar(1 + k * 5);
      m.material.opacity = 0.95 * (1 - k);
      m.material.color.setHex(k < 0.4 ? 0xffd24a : 0xff5a1a);
    });

    const light = new THREE.PointLight(0xff9b3a, 30, 60);
    light.position.copy(position).add(new THREE.Vector3(0, 2, 0));
    this.add(light, 0.7, (l, k) => { l.intensity = 30 * (1 - k); });

    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.3 + Math.random() * 0.5, 6, 5), this.smokeMat.clone());
      m.position.copy(position);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        2 + Math.random() * 10,
        (Math.random() - 0.5) * 12,
      );
      this.add(m, 1.6 + Math.random(), (mesh, k, dt) => {
        v.y -= 5 * dt;
        mesh.position.addScaledVector(v, dt);
        mesh.scale.setScalar(1 + k * 2.5);
        mesh.material.opacity = 0.55 * (1 - k);
      });
    }
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat.clone());
      m.position.copy(position);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 22, 4 + Math.random() * 14, (Math.random() - 0.5) * 22,
      );
      this.add(m, 1.2, (mesh, k, dt) => {
        v.y -= 18 * dt;
        mesh.position.addScaledVector(v, dt);
      });
    }
  }

  smoke(position, intensity = 1) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 5), this.smokeMat.clone());
    m.position.copy(position);
    const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.5 + Math.random(), (Math.random() - 0.5) * 1.2);
    this.add(m, 1.4, (mesh, k, dt) => {
      mesh.position.addScaledVector(v, dt);
      mesh.scale.setScalar(1 + k * 2.4 * intensity);
      mesh.material.opacity = 0.45 * (1 - k);
    });
  }

  skid(position, yaw) {
    const geo = new THREE.PlaneGeometry(0.22, 1.1);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x1b1b1d, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -yaw;
    m.position.set(position.x, 0.045, position.z);
    this.add(m, 14, (mesh, k) => { mesh.material.opacity = 0.5 * (1 - k * k); });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.userData.t += dt;
      const k = it.userData.t / it.userData.life;
      if (k >= 1) {
        this.scene.remove(it);
        if (it.material && it.material.dispose && it.material !== this.tracerMat) it.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      if (it.userData.updater) it.userData.updater(it, k, dt);
    }
  }
}

export { TMP };
