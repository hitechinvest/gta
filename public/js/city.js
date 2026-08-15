// Сборка 3D-города: земля, дороги, тротуары, дома, вывески, дворы.
// Геометрия домов сливается по материалам, мелочь рисуется через InstancedMesh.
import * as THREE from 'three';
import { mergeGeometries } from '/vendor/BufferGeometryUtils.js';
import { CONFIG, roadCenter, snapToRoad } from '/shared/worldgen.js';
import {
  panelFacade, stalinkaFacade, factoryFacade, privateFacade, garageFacade,
  asphalt, sidewalkTex, groundTex, signTexture, facadeLights,
} from './textures.js';
import { propPrototypes, churchDomes, columns } from './models.js';

const FACADE_TILE = { panel: [6.4, 5.8], tower: [6.4, 5.8], stalinka: [7.2, 7.2], factory: [12, 9], private: [6, 5], garage: [4, 3], church: [8, 8], admin: [7.2, 7.2], chimney: [8, 8] };

function facadeTexture(b) {
  switch (b.kind) {
    case 'panel': case 'tower': return panelFacade(b.color, b.balconies);
    case 'stalinka': case 'admin': case 'church': return stalinkaFacade(b.color);
    case 'factory': case 'chimney': return factoryFacade(b.color);
    case 'private': return privateFacade(b.color);
    case 'garage': return garageFacade(b.color);
    default: return panelFacade(b.color, false);
  }
}

/** BoxGeometry с UV, растянутыми под реальный размер стены. */
function facadeBox(w, h, d, tileW, tileH) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const ru = [d / tileW, d / tileW, w / tileW, w / tileW, w / tileW, w / tileW];
  const rv = [h / tileH, h / tileH, d / tileH, d / tileH, h / tileH, h / tileH];
  for (let face = 0; face < 6; face++) {
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      uv.setXY(i, uv.getX(i) * ru[face], uv.getY(i) * rv[face]);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export function buildCity(scene, world) {
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  const { total, origin, road, block, gridSize, pitch } = CONFIG;

  // --- земля ---------------------------------------------------------------
  const gTex = groundTex();
  gTex.repeat.set(total / 12, total / 12);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(total + 400, total + 400),
    new THREE.MeshLambertMaterial({ map: gTex }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // --- дороги --------------------------------------------------------------
  const roadMatX = new THREE.MeshLambertMaterial({ map: asphalt(true).clone() });
  roadMatX.map.repeat.set(road / 8, total / 8);
  roadMatX.map.needsUpdate = true;
  const roadMatZ = new THREE.MeshLambertMaterial({ map: asphalt(true).clone() });
  roadMatZ.map.repeat.set(total / 8, road / 8);
  roadMatZ.map.needsUpdate = true;
  roadMatZ.map.rotation = 0;

  for (let i = 0; i <= gridSize; i++) {
    const x = roadCenter(i);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(road, total), roadMatX);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.02, origin + total / 2);
    strip.receiveShadow = true;
    group.add(strip);

    const z = roadCenter(i);
    const strip2 = new THREE.Mesh(new THREE.PlaneGeometry(total, road), roadMatZ);
    strip2.rotation.x = -Math.PI / 2;
    strip2.position.set(origin + total / 2, 0.025, z);
    strip2.receiveShadow = true;
    group.add(strip2);
  }

  // --- тротуары и дворы ----------------------------------------------------
  const swTex = sidewalkTex();
  swTex.repeat.set(block / 4, block / 4);
  const swMat = new THREE.MeshLambertMaterial({ map: swTex });
  const yardTex = groundTex().clone();
  yardTex.repeat.set(block / 6, block / 6);
  yardTex.needsUpdate = true;
  const yardMat = new THREE.MeshLambertMaterial({ map: yardTex });

  const sidewalkGeos = [];
  const yardGeos = [];
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const x = origin + road + i * pitch + block / 2;
      const z = origin + road + j * pitch + block / 2;
      const slab = new THREE.BoxGeometry(block + road * 0.5, 0.18, block + road * 0.5);
      slab.translate(x, 0.09, z);
      sidewalkGeos.push(slab);

      const yard = new THREE.BoxGeometry(block - 6, 0.06, block - 6);
      yard.translate(x, 0.2, z);
      yardGeos.push(yard);
    }
  }
  const sidewalkMesh = new THREE.Mesh(mergeGeometries(sidewalkGeos, false), swMat);
  sidewalkMesh.receiveShadow = true;
  group.add(sidewalkMesh);
  const yardMesh = new THREE.Mesh(mergeGeometries(yardGeos, false), yardMat);
  yardMesh.receiveShadow = true;
  group.add(yardMesh);

  // --- дома ----------------------------------------------------------------
  const byMaterial = new Map(); // ключ -> {material, geos[]}
  const roofGeos = [];
  const signMeshes = [];

  for (const b of world.buildings) {
    const key = `${b.kind}-${b.color}`;
    if (!byMaterial.has(key)) {
      const tex = facadeTexture(b).clone();
      tex.needsUpdate = true;
      const lights = facadeLights(b.kind).clone();
      lights.needsUpdate = true;
      byMaterial.set(key, {
        material: new THREE.MeshLambertMaterial({
          map: tex,
          emissiveMap: lights,
          emissive: new THREE.Color(0x000000),
          emissiveIntensity: 1,
        }),
        geos: [],
      });
    }
    const tile = FACADE_TILE[b.kind] || [6.4, 5.8];
    const geo = facadeBox(b.w, b.h, b.d, tile[0], tile[1]);
    geo.translate(b.x, b.h / 2, b.z);
    byMaterial.get(key).geos.push(geo);

    // Крыша-плита, чтобы фасадная текстура не смотрела в небо.
    const roof = new THREE.BoxGeometry(b.w + 0.4, 0.4, b.d + 0.4);
    roof.translate(b.x, b.h + 0.2, b.z);
    roofGeos.push(roof);

    // Скатная крыша частного дома.
    if (b.kind === 'private') {
      const gable = new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.78, 2.6, 4);
      gable.rotateY(Math.PI / 4);
      gable.translate(b.x, b.h + 1.5, b.z);
      roofGeos.push(gable);
    }

    if (b.kind === 'church') group.add(churchDomes(b.w, b.d, b.h));
    if (b.kind === 'admin') {
      const col = columns(b.w, b.d, b.h);
      col.position.set(b.x, 0, b.z);
      group.add(col);
    }

    // Вывеска на фасаде, обращённом к ближайшей дороге.
    if (b.sign) {
      const dx = Math.abs(b.x - snapToRoad(b.x));
      const dz = Math.abs(b.z - snapToRoad(b.z));
      const faceZ = dz <= dx;
      const wSign = Math.min((faceZ ? b.w : b.d) * 0.8, 7);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(wSign, wSign * 0.22),
        new THREE.MeshBasicMaterial({
          map: signTexture(b.sign, b.kind === 'factory' ? '#3a4a5a' : '#c1272d'),
          toneMapped: false,
        }),
      );
      const y = Math.min(b.h - 1, b.kind === 'stalinka' ? 4.4 : 3.4);
      if (faceZ) {
        const side = Math.sign(snapToRoad(b.z) - b.z) || 1;
        plane.position.set(b.x, y, b.z + side * (b.d / 2 + 0.08));
        plane.rotation.y = side > 0 ? 0 : Math.PI;
      } else {
        const side = Math.sign(snapToRoad(b.x) - b.x) || 1;
        plane.position.set(b.x + side * (b.w / 2 + 0.08), y, b.z);
        plane.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      signMeshes.push(plane);
      group.add(plane);
    }
  }

  for (const { material, geos } of byMaterial.values()) {
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  const roofMesh = new THREE.Mesh(
    mergeGeometries(roofGeos, false),
    new THREE.MeshLambertMaterial({ color: 0x4a4a48 }),
  );
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  group.add(roofMesh);

  // --- уличная мелочь через инстансы --------------------------------------
  const protos = propPrototypes();
  const byType = new Map();
  for (const p of world.props) {
    if (!byType.has(p.type)) byType.set(p.type, []);
    byType.get(p.type).push(p);
  }

  const dummy = new THREE.Object3D();
  const lampMeshes = [];
  for (const [type, list] of byType) {
    const proto = protos[type];
    if (!proto) continue;
    for (let partIndex = 0; partIndex < proto.length; partIndex++) {
      const part = proto[partIndex];
      const inst = new THREE.InstancedMesh(part.geo, part.mat, list.length);
      inst.castShadow = type !== 'fence';
      inst.receiveShadow = false;
      inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      for (let k = 0; k < list.length; k++) {
        const p = list[k];
        dummy.position.set(p.x, 0.18, p.z);
        dummy.rotation.set(0, p.rot || 0, 0);
        const s = p.scale || 1;
        dummy.scale.set(type === 'fence' ? s : s, s, type === 'fence' ? 1 : s);
        dummy.updateMatrix();
        // Смещение части внутри прототипа с учётом поворота.
        const off = new THREE.Vector3(...part.offset);
        off.applyEuler(dummy.rotation);
        off.multiplyScalar(1);
        dummy.position.add(new THREE.Vector3(off.x * (type === 'fence' ? 1 : s), off.y * s, off.z * s));
        dummy.updateMatrix();
        inst.setMatrixAt(k, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = true;
      group.add(inst);
      if (type === 'lamp' && partIndex === 2) lampMeshes.push(inst);
    }
  }

  // Бордюры вдоль дорог для читаемости геометрии улиц.
  const curbGeos = [];
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const x = origin + road + i * pitch + block / 2;
      const z = origin + road + j * pitch + block / 2;
      const half = (block + road * 0.5) / 2;
      for (const [ox, oz, w, d] of [
        [0, -half, block + road * 0.5, 0.35],
        [0, half, block + road * 0.5, 0.35],
        [-half, 0, 0.35, block + road * 0.5],
        [half, 0, 0.35, block + road * 0.5],
      ]) {
        const g = new THREE.BoxGeometry(w, 0.26, d);
        g.translate(x + ox, 0.2, z + oz);
        curbGeos.push(g);
      }
    }
  }
  const curbs = new THREE.Mesh(
    mergeGeometries(curbGeos, false),
    new THREE.MeshLambertMaterial({ color: 0xb9b6ad }),
  );
  group.add(curbs);

  // Световые пятна под фонарями — включаются ночью.
  const lampList = byType.get('lamp') || [];
  const poolGeo = new THREE.CircleGeometry(4.6, 14);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xffdc9a, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, Math.max(1, lampList.length));
  pools.visible = false;
  for (let k = 0; k < lampList.length; k++) {
    const p = lampList[k];
    dummy.position.set(p.x + Math.sin(p.rot || 0) * 1.2, 0.24, p.z + Math.cos(p.rot || 0) * 1.2);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    pools.setMatrixAt(k, dummy.matrix);
  }
  pools.instanceMatrix.needsUpdate = true;
  group.add(pools);

  const buildingMaterials = [...byMaterial.values()].map((v) => v.material);
  let nightState = null;

  return {
    group,
    lampMeshes,
    signMeshes,
    /** Ночью зажигаем окна, фонари и световые пятна. */
    setNight(isNight) {
      if (nightState === isNight) return;
      nightState = isNight;
      for (const m of lampMeshes) m.material.color.setHex(isNight ? 0xffe9b0 : 0x9a978a);
      for (const m of buildingMaterials) {
        m.emissive.setHex(isNight ? 0xffffff : 0x000000);
        m.emissiveIntensity = isNight ? 0.85 : 0;
        m.needsUpdate = true;
      }
      pools.visible = isNight;
    },
  };
}
