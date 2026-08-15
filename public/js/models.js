// Процедурные модели: персонажи (в российском антураже), автомобили,
// уличные объекты. Всё собирается из примитивов, без внешних файлов.
import * as THREE from 'three';
import { mergeGeometries } from '/vendor/BufferGeometryUtils.js';
import { VEHICLES } from '/shared/protocol.js';
import { signTexture, foliageTexture, faceTexture, clothTexture, skyCube, blobShadow } from './textures.js';
import { assets } from './assets.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Контактное пятно под объектом: всегда прижимает его к земле. */
function contactShadow(width, depth, opacity = 0.5) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({
      map: blobShadow(), transparent: true, opacity,
      depthWrite: false, toneMapped: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  mesh.renderOrder = -1;
  return mesh;
}
const mat = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

// --- персонажи --------------------------------------------------------------

export const SKINS = [
  { name: 'Спортивки', jacket: 0x1c1c20, pants: 0x24242a, hat: 0x1c1c20, stripes: true, skin: 0xd9a17a },
  { name: 'Кожанка', jacket: 0x2a2320, pants: 0x2f3f5a, hat: 0, stripes: false, skin: 0xe0b189 },
  { name: 'Телогрейка', jacket: 0x5c5a3a, pants: 0x3a3a34, hat: 0x4a4838, stripes: false, skin: 0xd9a17a },
  { name: 'Работяга', jacket: 0x2b4c7e, pants: 0x2b4c7e, hat: 0xe0a92b, stripes: false, skin: 0xc9926a },
  { name: 'Пуховик', jacket: 0x9c2b2b, pants: 0x24242a, hat: 0x7a2020, stripes: false, skin: 0xecc09a },
  { name: 'ДПС', jacket: 0x3a4a5a, pants: 0x2f3a46, hat: 0x2f3a46, stripes: false, skin: 0xd9a17a, vest: 0xd6d21f },
];

/**
 * Низкополигональный человечек с ручной анимацией ходьбы.
 * Возвращает группу с методом update(dt, state).
 */
export function createCharacter(skinIndex = 0) {
  const s = SKINS[skinIndex % SKINS.length];
  const root = new THREE.Group();

  const skinM = mat(s.skin);
  const jacketM = new THREE.MeshLambertMaterial({ map: clothTexture(s.jacket, 'jacket') });
  const jacketPlainM = mat(s.jacket);
  const pantsM = new THREE.MeshLambertMaterial({ map: clothTexture(s.pants, 'pants') });
  const shoeM = mat(0x17181a);

  // Таз — корень всей анимации: от него растут ноги и корпус.
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  // --- корпус ---------------------------------------------------------------
  const chest = new THREE.Group();
  hips.add(chest);

  const belly = new THREE.Mesh(box(0.42, 0.26, 0.24), jacketPlainM);
  belly.position.y = 0.13;
  belly.castShadow = true;
  chest.add(belly);

  const torso = new THREE.Mesh(box(0.5, 0.42, 0.27), jacketM);
  torso.position.y = 0.47;
  torso.castShadow = true;
  chest.add(torso);

  // Плечи чуть шире груди — силуэт перестаёт быть параллелепипедом.
  const shoulders = new THREE.Mesh(box(0.62, 0.16, 0.28), jacketPlainM);
  shoulders.position.y = 0.66;
  shoulders.castShadow = true;
  chest.add(shoulders);

  if (s.vest) {
    const vest = new THREE.Mesh(box(0.54, 0.36, 0.3), mat(s.vest));
    vest.position.y = 0.46;
    chest.add(vest);
  }

  const neck = new THREE.Mesh(box(0.14, 0.09, 0.14), skinM);
  neck.position.y = 0.77;
  chest.add(neck);

  // --- голова ---------------------------------------------------------------
  const head = new THREE.Group();
  head.position.y = 0.82;
  chest.add(head);

  const skull = new THREE.Mesh(box(0.24, 0.26, 0.24), skinM);
  skull.position.y = 0.13;
  skull.castShadow = true;
  head.add(skull);

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.26),
    new THREE.MeshLambertMaterial({
      map: faceTexture(undefined, skinIndex % 3 === 2),
      transparent: true,
      alphaTest: 0.05,
    }),
  );
  face.position.set(0, 0.13, 0.121);
  head.add(face);

  const hair = new THREE.Mesh(box(0.26, 0.08, 0.26), mat(s.hat || 0x2a2018));
  hair.position.y = 0.28;
  head.add(hair);
  if (s.hat) {
    const cap = new THREE.Mesh(box(0.27, 0.05, 0.14), mat(s.hat));
    cap.position.set(0, 0.25, 0.14);
    head.add(cap);
  }
  const ears = new THREE.Mesh(box(0.28, 0.06, 0.1), skinM);
  ears.position.y = 0.13;
  head.add(ears);

  // --- конечности с суставами ----------------------------------------------
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.33, 0.62, 0);
    chest.add(shoulder);

    const upper = new THREE.Mesh(box(0.13, 0.3, 0.15), jacketPlainM);
    upper.position.y = -0.15;
    upper.castShadow = true;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);

    const fore = new THREE.Mesh(box(0.115, 0.27, 0.13), jacketPlainM);
    fore.position.y = -0.135;
    fore.castShadow = true;
    elbow.add(fore);

    const hand = new THREE.Mesh(box(0.11, 0.12, 0.12), skinM);
    hand.position.y = -0.31;
    elbow.add(hand);

    return { shoulder, elbow, hand };
  }

  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.125, 0, 0);
    hips.add(hip);

    const thigh = new THREE.Mesh(box(0.18, 0.44, 0.19), pantsM);
    thigh.position.y = -0.22;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.44;
    hip.add(knee);

    const shin = new THREE.Mesh(box(0.155, 0.42, 0.17), pantsM);
    shin.position.y = -0.21;
    shin.castShadow = true;
    knee.add(shin);

    if (s.stripes) {
      // Лампасы идут по обеим частям ноги, иначе рвутся на колене.
      const st1 = new THREE.Mesh(box(0.025, 0.44, 0.025), mat(0xf0f0f0));
      st1.position.set(side * 0.095, -0.22, 0);
      hip.add(st1);
      const st2 = new THREE.Mesh(box(0.025, 0.42, 0.025), mat(0xf0f0f0));
      st2.position.set(side * 0.082, -0.21, 0);
      knee.add(st2);
    }

    const shoe = new THREE.Mesh(box(0.17, 0.11, 0.28), shoeM);
    shoe.position.set(0, -0.47, 0.045);
    knee.add(shoe);

    return { hip, knee };
  }

  root.add(contactShadow(1.1, 1.1, 0.45));

  const armL = makeArm(-1);
  const armR = makeArm(1);
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // Оружие в правой руке.
  const weapon = new THREE.Group();
  weapon.position.set(0, -0.3, 0.06);
  armR.elbow.add(weapon);
  const gunBody = new THREE.Mesh(box(0.06, 0.11, 0.26), mat(0x23262b));
  gunBody.position.z = 0.09;
  weapon.add(gunBody);
  const gunGrip = new THREE.Mesh(box(0.05, 0.12, 0.07), mat(0x1a1c1f));
  gunGrip.position.set(0, -0.08, -0.01);
  weapon.add(gunGrip);
  weapon.visible = false;

  root.userData = {
    hips, chest, head, armL, armR, legL, legR, weapon,
    phase: Math.random() * Math.PI * 2,
    skinIndex,
    gltf: null,
    action: null,
  };

  // Если в манифесте есть модель персонажа — подменяем ею процедурное тело.
  // Загрузка асинхронная, до её конца игрок видит обычного человечка.
  if (assets.ready && assets.has('characters', 'ped')) {
    assets.instance('characters', 'ped').then((inst) => {
      if (!inst) return;
      hips.visible = false;
      root.add(inst.root);
      root.userData.gltf = inst;
    });
  }

  root.update = (dt, state = {}) => {
    const d = root.userData;
    const speed = state.speed || 0;
    const moving = speed > 0.35;
    const run = Math.min(1, speed / 6);

    // Модель со скелетом: состояние игры переключает клипы, а не суставы.
    if (d.gltf) {
      const want = state.dead ? 'die'
        : state.sitting ? 'sit'
          : state.aiming ? 'aim'
            : speed > 4 ? 'run'
              : moving ? 'walk' : 'idle';
      const actions = d.gltf.actions;
      const next = actions[want] || actions.idle || null;
      if (next && next !== d.action) {
        next.reset().fadeIn(0.18).play();
        if (d.action) d.action.fadeOut(0.18);
        d.action = next;
      }
      d.gltf.mixer?.update(dt);
      return;
    }
    d.phase += dt * (moving ? 3.6 + speed * 1.1 : 1.6);

    const sw = Math.sin(d.phase);
    const swAbs = Math.abs(sw);
    const amp = moving ? 0.5 + run * 0.45 : 0;

    // Ноги: бедро качается, колено сгибается только на подъёме.
    legL.hip.rotation.x = sw * amp;
    legR.hip.rotation.x = -sw * amp;
    legL.knee.rotation.x = -Math.max(0, -sw) * (0.5 + run * 0.9) - (moving ? 0.06 : 0.02);
    legR.knee.rotation.x = -Math.max(0, sw) * (0.5 + run * 0.9) - (moving ? 0.06 : 0.02);

    if (state.aiming) {
      // Стойка с оружием: правая рука вперёд, левая поддерживает.
      armR.shoulder.rotation.set(-Math.PI / 2 + (state.pitch || 0) * 0.7, 0, -0.1);
      armR.elbow.rotation.x = -0.12;
      armL.shoulder.rotation.set(-Math.PI / 2.1 + (state.pitch || 0) * 0.6, 0, 0.34);
      armL.elbow.rotation.x = -0.55;
      weapon.visible = state.weapon && state.weapon !== 'fists';
    } else {
      armR.shoulder.rotation.set(-sw * amp * 0.85, 0, -0.06);
      armL.shoulder.rotation.set(sw * amp * 0.85, 0, 0.06);
      // Локоть всегда чуть согнут — прямая рука выглядит как палка.
      armR.elbow.rotation.x = -0.22 - Math.max(0, -sw) * amp * 0.7;
      armL.elbow.rotation.x = -0.22 - Math.max(0, sw) * amp * 0.7;
      weapon.visible = false;
    }

    // Корпус: наклон вперёд на бегу, покачивание таза в такт шагам.
    chest.rotation.x = (moving ? 0.06 + run * 0.22 : 0.02) + (state.aiming ? 0.05 : 0);
    chest.rotation.z = moving ? -sw * 0.05 * run : 0;
    hips.rotation.y = moving ? sw * 0.09 * run : 0;
    hips.position.y = 0.92 + (moving ? swAbs * 0.05 * (0.5 + run) : Math.sin(d.phase * 0.6) * 0.008);

    // Голова смотрит туда же, куда камера, но не выворачивается.
    head.rotation.x = THREE.MathUtils.clamp((state.pitch || 0) * 0.8, -0.5, 0.5) - chest.rotation.x;

    if (state.sitting) {
      legL.hip.rotation.x = -1.4;
      legR.hip.rotation.x = -1.4;
      legL.knee.rotation.x = -1.5;
      legR.knee.rotation.x = -1.5;
      armL.shoulder.rotation.set(-0.9, 0, 0.2);
      armR.shoulder.rotation.set(-0.9, 0, -0.2);
      armL.elbow.rotation.x = -0.6;
      armR.elbow.rotation.x = -0.6;
      chest.rotation.x = 0.08;
      hips.position.y = 0.88;
    }

    if (state.dead) {
      root.rotation.x = -Math.PI / 2.1;
      hips.position.y = 0.32;
      chest.rotation.x = 0;
      legL.knee.rotation.x = -0.3;
      legR.knee.rotation.x = -0.5;
      armL.shoulder.rotation.set(0.4, 0, 0.9);
      armR.shoulder.rotation.set(0.2, 0, -1.1);
    } else {
      root.rotation.x = 0;
    }
  };

  return root;
}

// --- автомобили -------------------------------------------------------------

function wheelMesh(radius, width) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 14), mat(0x141416));
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 10), mat(0x9aa0a6));
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  return g;
}

// Боковые профили кузовов: пары (доля длины от -0.5 до 0.5, доля высоты).
const CAR_PROFILES = {
  sedan: [
    [-0.50, 0.10], [-0.50, 0.46], [-0.34, 0.54], [-0.22, 0.95],
    [0.04, 1.00], [0.19, 0.58], [0.44, 0.50], [0.50, 0.34], [0.50, 0.10],
  ],
  suv: [
    [-0.50, 0.12], [-0.50, 0.86], [-0.44, 0.98], [0.10, 1.00],
    [0.24, 0.60], [0.46, 0.54], [0.50, 0.36], [0.50, 0.12],
  ],
  van: [
    [-0.50, 0.10], [-0.50, 0.94], [-0.40, 1.00], [0.34, 1.00],
    [0.47, 0.66], [0.50, 0.34], [0.50, 0.10],
  ],
  truck: [
    [-0.50, 0.12], [-0.50, 1.00], [0.10, 1.00], [0.10, 0.72],
    [0.22, 0.70], [0.30, 0.30], [0.50, 0.26], [0.50, 0.12],
  ],
  // Хэтчбек: короткий зад с крутой пятой дверью — «девятка», «Запорожец».
  hatch: [
    [-0.50, 0.14], [-0.48, 0.66], [-0.40, 0.97], [0.02, 1.00],
    [0.20, 0.60], [0.44, 0.52], [0.50, 0.34], [0.50, 0.14],
  ],
  // Автобус: почти отвесные борта, скошенный нос.
  bus: [
    [-0.50, 0.10], [-0.50, 0.96], [-0.44, 1.00], [0.42, 1.00],
    [0.50, 0.86], [0.50, 0.10],
  ],
  // Бескапотный грузовик: высокая кабина впереди, борт сзади.
  heavy: [
    [-0.50, 0.22], [-0.50, 0.74], [-0.02, 0.74], [-0.02, 1.00],
    [0.36, 1.00], [0.44, 0.62], [0.50, 0.56], [0.50, 0.22],
  ],
};

/** Кузов: боковой профиль, вытянутый по ширине, с фаской по краям. */
function carBodyGeometry(bodyType, width, height, length) {
  const profile = CAR_PROFILES[bodyType] || CAR_PROFILES.sedan;
  const shape = new THREE.Shape();
  profile.forEach(([pz, py], i) => {
    const z = pz * length;
    const y = py * height;
    if (i === 0) shape.moveTo(z, y);
    else shape.lineTo(z, y);
  });
  shape.closePath();

  const bevel = Math.min(0.12, width * 0.09);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 2,
  });
  // Профиль строился в плоскости ZY, вытягивание идёт по ширине;
  // после поворота нос смотрит в +Z, кузов центрируется по X.
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2 - bevel, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Строит машину нужного типа. Возвращает группу с userData.wheels,
 * userData.siren (для ДПС) и методом update(dt, state).
 */
export function createVehicle(type = 'zhiguli', color = 0xc9d3d9) {
  const def = VEHICLES[type] || VEHICLES.zhiguli;
  const [w, h, l] = def.size;
  const root = new THREE.Group();
  const env = skyCube();
  const bodyM = new THREE.MeshStandardMaterial({
    color, metalness: 0.45, roughness: 0.32, envMap: env, envMapIntensity: 0.85,
  });
  const glassM = new THREE.MeshStandardMaterial({
    color: 0x1e2a33, transparent: true, opacity: 0.66,
    metalness: 0.9, roughness: 0.08, envMap: env, envMapIntensity: 1.3,
  });
  const darkM = mat(0x1a1c1f);
  const chromeM = new THREE.MeshStandardMaterial({
    color: 0xc8ced3, metalness: 0.95, roughness: 0.18, envMap: env, envMapIntensity: 1.2,
  });

  const wheelR = def.body === 'suv' ? 0.36 : def.body === 'truck' || def.body === 'van' ? 0.38 : 0.32;
  const bodyY = wheelR + 0.12;

  const group = new THREE.Group();
  group.position.y = bodyY;
  root.add(group);

  // Кузов — вытянутый боковой профиль с фаской: силуэт читается куда лучше
  // коробок, а полигонов почти столько же.
  const bodyH = Math.max(0.7, h - bodyY);
  const bodyMesh = new THREE.Mesh(carBodyGeometry(def.body, w, bodyH, l), bodyM);
  bodyMesh.castShadow = true;
  group.add(bodyMesh);

  // Остекление: тёмный пояс по линии окон, чуть шире кузова.
  const GLASS_BAND = {
    sedan: { y: [0.56, 0.96], z: [-0.24, 0.2] },
    suv: { y: [0.6, 0.96], z: [-0.46, 0.24] },
    van: { y: [0.58, 0.94], z: [-0.3, 0.48] },
    truck: { y: [0.72, 0.98], z: [0.08, 0.3] },
    hatch: { y: [0.58, 0.96], z: [-0.32, 0.16] },
    bus: { y: [0.6, 0.94], z: [-0.42, 0.44] },
    heavy: { y: [0.78, 0.98], z: [0.02, 0.32] },
  }[def.body] || { y: [0.56, 0.96], z: [-0.24, 0.2] };

  const bandH = (GLASS_BAND.y[1] - GLASS_BAND.y[0]) * bodyH;
  const bandL = (GLASS_BAND.z[1] - GLASS_BAND.z[0]) * l;
  const glass = new THREE.Mesh(box(w * 1.005, bandH, bandL), glassM);
  glass.position.set(
    0,
    ((GLASS_BAND.y[0] + GLASS_BAND.y[1]) / 2) * bodyH,
    ((GLASS_BAND.z[0] + GLASS_BAND.z[1]) / 2) * l,
  );
  group.add(glass);

  // У Газели будка светлее кабины.
  if (def.body === 'truck') {
    const cargo = new THREE.Mesh(box(w * 1.01, bodyH * 0.86, l * 0.56), mat(0xe8e6e0));
    cargo.position.set(0, bodyH * 0.55, -l * 0.2);
    cargo.castShadow = true;
    group.add(cargo);
  }

  // Салон: сиденья, торпедо и руль — видны сквозь стёкла.
  const seatM = mat(0x2a2b2f);
  const cabinZ = def.body === 'truck' ? l * 0.2 : def.body === 'van' ? l * 0.1 : -l * 0.02;
  for (const sx of [-w * 0.24, w * 0.24]) {
    const seat = new THREE.Mesh(box(w * 0.34, bodyH * 0.3, 0.42), seatM);
    seat.position.set(sx, bodyH * 0.5, cabinZ - 0.15);
    group.add(seat);
    const back = new THREE.Mesh(box(w * 0.34, bodyH * 0.42, 0.14), seatM);
    back.position.set(sx, bodyH * 0.68, cabinZ - 0.36);
    group.add(back);
  }
  const dash = new THREE.Mesh(box(w * 0.9, bodyH * 0.16, 0.3), seatM);
  dash.position.set(0, bodyH * 0.62, cabinZ + 0.62);
  group.add(dash);
  const wheelSteer = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 14), mat(0x17181a));
  wheelSteer.position.set(-w * 0.24, bodyH * 0.72, cabinZ + 0.44);
  wheelSteer.rotation.x = -1.1;
  group.add(wheelSteer);

  // Колёсные арки: тёмная ниша и крыло над колесом.
  const archM = mat(0x121315);
  const wxArch = w / 2;
  const wzArch = l / 2 - (def.body === 'truck' ? 0.95 : 0.75);
  const wheelRadius = def.body === 'suv' ? 0.36 : def.body === 'truck' || def.body === 'van' ? 0.38 : 0.32;
  for (const sz of [1, -1]) {
    for (const sx of [-1, 1]) {
      const arch = new THREE.Mesh(box(0.1, wheelRadius * 1.15, wheelRadius * 2.1), archM);
      arch.position.set(sx * (wxArch - 0.3), wheelRadius * 0.62, sz * wzArch);
      group.add(arch);
      // Крыло — тонкая скоба над колесом, ловит блик.
      const fender = new THREE.Mesh(box(0.14, 0.1, wheelRadius * 2.6), bodyM);
      fender.position.set(sx * (wxArch - 0.02), wheelRadius * 1.45, sz * wzArch);
      group.add(fender);
    }
  }

  // Зеркала на стойках.
  for (const sx of [-1, 1]) {
    const stalk = new THREE.Mesh(box(0.12, 0.04, 0.04), darkM);
    stalk.position.set(sx * (w / 2 + 0.06), bodyH * 0.72, cabinZ + 0.78);
    group.add(stalk);
    const mirror = new THREE.Mesh(box(0.05, 0.11, 0.15), chromeM);
    mirror.position.set(sx * (w / 2 + 0.13), bodyH * 0.72, cabinZ + 0.78);
    group.add(mirror);
  }

  // Дверные швы и ручки — без них борт выглядит цельным слитком.
  const seamM = mat(0x2a2c2e);
  for (const sx of [-1, 1]) {
    for (const dz of [cabinZ + 0.75, cabinZ - 0.75]) {
      const seam = new THREE.Mesh(box(0.02, bodyH * 0.5, 0.03), seamM);
      seam.position.set(sx * (w / 2 + 0.005), bodyH * 0.45, dz);
      group.add(seam);
    }
    const handle = new THREE.Mesh(box(0.03, 0.05, 0.16), chromeM);
    handle.position.set(sx * (w / 2 + 0.02), bodyH * 0.52, cabinZ + 0.2);
    group.add(handle);
  }

  // Решётка радиатора и выхлоп.
  const grille = new THREE.Mesh(box(w * 0.52, 0.16, 0.06), darkM);
  grille.position.set(0, 0.42, l / 2 + 0.01);
  group.add(grille);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), darkM);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(w * 0.28, 0.14, -l / 2 - 0.06);
  group.add(exhaust);

  // Бамперы и решётка.
  const bumperF = new THREE.Mesh(box(w * 0.98, 0.14, 0.18), chromeM);
  bumperF.position.set(0, 0.16, l / 2 - 0.02);
  group.add(bumperF);
  const bumperR = bumperF.clone();
  bumperR.position.z = -l / 2 + 0.02;
  group.add(bumperR);

  // Фары и стопы.
  const headM = new THREE.MeshBasicMaterial({ color: 0xfff3d0 });
  const tailM = new THREE.MeshBasicMaterial({ color: 0x8c1f1f });
  const heads = [];
  const tails = [];
  for (const x of [-w * 0.33, w * 0.33]) {
    const hl = new THREE.Mesh(box(0.22, 0.12, 0.06), headM);
    hl.position.set(x, 0.32, l / 2 + 0.01);
    group.add(hl);
    heads.push(hl);
    const tl = new THREE.Mesh(box(0.2, 0.12, 0.06), tailM);
    tl.position.set(x, 0.34, -l / 2 - 0.01);
    group.add(tl);
    tails.push(tl);
  }

  // Световые конусы фар — включаются ночью.
  const beams = new THREE.Group();
  beams.visible = false;
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffe9b8, transparent: true, opacity: 0.11,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const x of [-w * 0.33, w * 0.33]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, 11, 10, 1, true), beamMat);
    cone.rotation.x = -Math.PI / 2;
    cone.position.set(x, 0.34, l / 2 + 5.4);
    beams.add(cone);
  }
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffe9b8, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, -bodyY + 0.06, l / 2 + 5);
  beams.add(pool);
  group.add(beams);

  // Номерной знак.
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 0.13),
    new THREE.MeshBasicMaterial({ map: signTexture('А 777 МР', '#f2f2ee'), toneMapped: false }),
  );
  plate.position.set(0, 0.2, -l / 2 - 0.03);
  plate.rotation.y = Math.PI;
  group.add(plate);

  // Колёса.
  const wheels = [];
  const wx = w / 2 - 0.06;
  const wz = l / 2 - (def.body === 'truck' ? 0.95 : 0.75);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const wheel = wheelMesh(wheelR, 0.22);
    wheel.position.set(sx * wx, wheelR, sz * wz);
    root.add(wheel);
    wheels.push({ mesh: wheel, front: sz > 0 });
  }

  // Мигалки ДПС.
  let siren = null;
  if (def.police) {
    const stripe = new THREE.Mesh(box(w + 0.02, 0.26, l * 0.5), mat(0x1e4fa0));
    stripe.position.set(0, bodyY + h * 0.2, 0);
    root.add(stripe);

    const bar = new THREE.Group();
    bar.position.set(0, bodyY + h * 0.9, -l * 0.04);
    root.add(bar);
    const barBase = new THREE.Mesh(box(w * 0.8, 0.06, 0.24), darkM);
    bar.add(barBase);
    const blue = new THREE.Mesh(box(w * 0.34, 0.14, 0.2), new THREE.MeshBasicMaterial({ color: 0x2a6cff }));
    blue.position.set(-w * 0.2, 0.08, 0);
    bar.add(blue);
    const red = new THREE.Mesh(box(w * 0.34, 0.14, 0.2), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    red.position.set(w * 0.2, 0.08, 0);
    bar.add(red);
    const lightB = new THREE.PointLight(0x3a7bff, 0, 22);
    lightB.position.set(0, 0.3, 0);
    bar.add(lightB);
    siren = { blue, red, lightB, t: 0 };

    const dpsSign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.28),
      new THREE.MeshBasicMaterial({ map: signTexture('ДПС', '#1e4fa0'), toneMapped: false, transparent: true }),
    );
    dpsSign.position.set(w / 2 + 0.01, bodyY + h * 0.2, 0);
    dpsSign.rotation.y = Math.PI / 2;
    root.add(dpsSign);
    const dpsSign2 = dpsSign.clone();
    dpsSign2.position.x = -w / 2 - 0.01;
    dpsSign2.rotation.y = -Math.PI / 2;
    root.add(dpsSign2);
  }

  root.add(contactShadow(w * 2.1, l * 1.35, 0.55));

  root.userData = { type, def, wheels, siren, heads, tails, headM, tailM, beams, spin: 0, steer: 0 };

  root.update = (dt, state = {}) => {
    const d = root.userData;
    const speed = state.speed || 0;
    d.spin += (speed / (wheelR || 0.3)) * dt;
    d.steer += ((state.steer || 0) * 0.5 - d.steer) * Math.min(1, dt * 8);
    for (const wheel of d.wheels) {
      wheel.mesh.rotation.x = -d.spin;
      wheel.mesh.rotation.y = wheel.front ? d.steer : 0;
    }
    if (d.siren && state.siren) {
      d.siren.t += dt;
      const on = Math.floor(d.siren.t * 6) % 2 === 0;
      d.siren.blue.material.color.setHex(on ? 0x6ea8ff : 0x14203a);
      d.siren.red.material.color.setHex(on ? 0x14203a : 0xff5a5a);
      d.siren.lightB.color.setHex(on ? 0x3a7bff : 0xff3030);
      d.siren.lightB.intensity = 2.2;
    } else if (d.siren) {
      d.siren.lightB.intensity = 0;
    }
    // Стопы, фары и световые конусы.
    const braking = state.braking;
    d.tailM.color.setHex(braking ? 0xff2b2b : 0x8c1f1f);
    d.headM.color.setHex(state.lights ? 0xfff8e0 : 0xd8cfae);
    d.beams.visible = !!state.lights;
  };

  return root;
}

// --- уличные объекты (прототипы для InstancedMesh) --------------------------

/** Крона-билборд: две скрещённые плоскости с альфа-текстурой листвы. */
function crossPlanes(width, height) {
  const a = new THREE.PlaneGeometry(width, height);
  const b = new THREE.PlaneGeometry(width, height);
  b.rotateY(Math.PI / 2);
  const c = new THREE.PlaneGeometry(width, height);
  c.rotateY(Math.PI / 4);
  return mergeGeometries([a, b, c], false);
}

function foliageMaterial(tint) {
  return new THREE.MeshLambertMaterial({
    map: foliageTexture(tint),
    transparent: true,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
}

export function propPrototypes() {
  const protos = {};

  // Тополь: ствол + вытянутая крона из билбордов.
  protos.poplar = [
    { geo: new THREE.CylinderGeometry(0.2, 0.32, 7, 6), mat: mat(0x5a4a3a), offset: [0, 3.5, 0] },
    { geo: crossPlanes(5.2, 11), mat: foliageMaterial('#48632f'), offset: [0, 9.5, 0] },
  ];
  // Берёза: белый ствол + округлая крона.
  protos.birch = [
    { geo: new THREE.CylinderGeometry(0.13, 0.18, 5, 6), mat: mat(0xe4e2da), offset: [0, 2.5, 0] },
    { geo: crossPlanes(6.4, 6.4), mat: foliageMaterial('#688f3c'), offset: [0, 6.2, 0] },
  ];
  // Фонарь.
  protos.lamp = [
    { geo: new THREE.CylinderGeometry(0.1, 0.14, 7, 6), mat: mat(0x6a6f72), offset: [0, 3.5, 0] },
    { geo: box(0.1, 0.1, 1.4), mat: mat(0x6a6f72), offset: [0, 7, 0.6] },
    { geo: box(0.42, 0.16, 0.7), mat: new THREE.MeshBasicMaterial({ color: 0xffe9b0 }), offset: [0, 6.9, 1.2] },
  ];
  // Столб с проводами.
  protos.pole = [
    { geo: new THREE.CylinderGeometry(0.14, 0.2, 8, 6), mat: mat(0x8a8577), offset: [0, 4, 0] },
    { geo: box(1.6, 0.12, 0.12), mat: mat(0x6b6559), offset: [0, 7.4, 0] },
  ];
  // Лавочка.
  protos.bench = [
    { geo: box(1.7, 0.09, 0.42), mat: mat(0x7a5a34), offset: [0, 0.45, 0] },
    { geo: box(1.7, 0.42, 0.08), mat: mat(0x7a5a34), offset: [0, 0.68, -0.2] },
    { geo: box(0.1, 0.45, 0.4), mat: mat(0x3a3f42), offset: [-0.75, 0.22, 0] },
    { geo: box(0.1, 0.45, 0.4), mat: mat(0x3a3f42), offset: [0.75, 0.22, 0] },
  ];
  // Мусорные баки.
  protos.trash = [
    { geo: box(1.2, 1.0, 0.9), mat: mat(0x2f6b45), offset: [0, 0.5, 0] },
    { geo: box(1.24, 0.1, 0.94), mat: mat(0x245034), offset: [0, 1.02, 0] },
  ];
  // Ковровыбивалка.
  protos.carpetBeater = [
    { geo: box(0.12, 2, 0.12), mat: mat(0x8a5a3a), offset: [-1.4, 1, 0] },
    { geo: box(0.12, 2, 0.12), mat: mat(0x8a5a3a), offset: [1.4, 1, 0] },
    { geo: box(3, 0.12, 0.12), mat: mat(0x8a5a3a), offset: [0, 1.95, 0] },
  ];
  // Детская площадка: качели + песочница.
  protos.playground = [
    { geo: box(0.12, 2.2, 0.12), mat: mat(0xc23b2b), offset: [-1.5, 1.1, 0] },
    { geo: box(0.12, 2.2, 0.12), mat: mat(0xc23b2b), offset: [1.5, 1.1, 0] },
    { geo: box(3.2, 0.14, 0.14), mat: mat(0x2b6cc2), offset: [0, 2.15, 0] },
    { geo: box(0.7, 0.08, 0.3), mat: mat(0xe0b02b), offset: [0, 0.75, 0] },
    { geo: box(3, 0.3, 3), mat: mat(0xd8c48a), offset: [0, 0.15, 3.4] },
  ];
  // Остановка.
  protos.busStop = [
    { geo: box(4.2, 0.14, 1.8), mat: mat(0x8a9aa5), offset: [0, 2.6, 0] },
    { geo: box(0.12, 2.6, 0.12), mat: mat(0x6a7580), offset: [-2, 1.3, -0.8] },
    { geo: box(0.12, 2.6, 0.12), mat: mat(0x6a7580), offset: [2, 1.3, -0.8] },
    { geo: box(4.2, 2, 0.1), mat: new THREE.MeshLambertMaterial({ color: 0x9fc4d6, transparent: true, opacity: 0.55 }), offset: [0, 1.4, -0.85] },
    { geo: box(1.8, 0.09, 0.4), mat: mat(0x7a5a34), offset: [0, 0.5, -0.4] },
  ];
  // Киоск.
  protos.kiosk = [
    { geo: box(2.6, 2.6, 2.2), mat: mat(0xdad2b8), offset: [0, 1.3, 0] },
    { geo: box(2.9, 0.16, 2.5), mat: mat(0x2b6cc2), offset: [0, 2.66, 0] },
    { geo: box(1.4, 0.9, 0.1), mat: new THREE.MeshLambertMaterial({ color: 0x24303a }), offset: [0, 1.5, 1.11] },
  ];
  // Светофор.
  protos.trafficLight = [
    { geo: new THREE.CylinderGeometry(0.1, 0.12, 4.2, 6), mat: mat(0x4a4f52), offset: [0, 2.1, 0] },
    { geo: box(0.3, 0.9, 0.28), mat: mat(0x22262a), offset: [0, 4.2, 0] },
    { geo: new THREE.SphereGeometry(0.1, 8, 6), mat: new THREE.MeshBasicMaterial({ color: 0x33ff55 }), offset: [0, 3.92, 0.15] },
    { geo: new THREE.SphereGeometry(0.1, 8, 6), mat: new THREE.MeshBasicMaterial({ color: 0x552211 }), offset: [0, 4.22, 0.15] },
    { geo: new THREE.SphereGeometry(0.1, 8, 6), mat: new THREE.MeshBasicMaterial({ color: 0xff3322 }), offset: [0, 4.52, 0.15] },
  ];
  // Забор (масштабируется по X).
  protos.fence = [
    { geo: box(10, 2, 0.16), mat: mat(0x9a9384), offset: [0, 1, 0] },
    { geo: box(10, 0.14, 0.24), mat: mat(0x7f7a6d), offset: [0, 2.05, 0] },
  ];
  // --- памятники ------------------------------------------------------------
  // Инстансер применяет только смещение, поэтому наклон запекаем в геометрию.
  const rot = (geo, x = 0, z = 0) => {
    if (x) geo.rotateX(x);
    if (z) geo.rotateZ(z);
    return geo;
  };
  const flat = (geo, sy) => { geo.scale(1, sy, 1); return geo; };
  const granite = mat(0x8d8b84);
  const graniteDark = mat(0x5f5e59);
  const bronze = mat(0x6e6a52);
  const steel = mat(0x6b7278);
  const khaki = mat(0x4f5a3e);

  // Общий постамент, чтобы памятники стояли одинаково уверенно.
  const pedestal = (w, h, d, y = 0) => [
    { geo: box(w, h, d), mat: granite, offset: [0, y + h / 2, 0] },
    { geo: box(w + 0.5, 0.3, d + 0.5), mat: graniteDark, offset: [0, y + 0.15, 0] },
  ];

  protos.monLenin = [
    ...pedestal(3.2, 3.4, 3.2),
    { geo: box(1.0, 2.0, 0.6), mat: bronze, offset: [0, 4.4, 0] }, // пальто
    { geo: new THREE.SphereGeometry(0.3, 10, 8), mat: bronze, offset: [0, 5.6, 0] },
    { geo: box(0.24, 1.1, 0.24), mat: bronze, offset: [0.62, 4.9, 0.45] }, // рука вперёд
    { geo: box(0.22, 0.9, 0.22), mat: bronze, offset: [-0.6, 4.4, -0.1] },
  ];

  protos.monObelisk = [
    ...pedestal(4, 1.6, 4),
    { geo: new THREE.CylinderGeometry(0.45, 1.0, 14, 4), mat: granite, offset: [0, 8.6, 0] },
    { geo: new THREE.OctahedronGeometry(0.85, 0), mat: mat(0xd8b24a), offset: [0, 16.2, 0] },
  ];

  protos.monTank = [
    ...pedestal(6.4, 1.8, 3.6),
    { geo: box(4.6, 0.9, 2.4), mat: khaki, offset: [0, 2.6, 0] }, // корпус
    { geo: box(4.8, 0.5, 0.5), mat: graniteDark, offset: [0, 2.2, 1.1] }, // гусеницы
    { geo: box(4.8, 0.5, 0.5), mat: graniteDark, offset: [0, 2.2, -1.1] },
    { geo: new THREE.CylinderGeometry(1.0, 1.15, 0.8, 8), mat: khaki, offset: [-0.4, 3.4, 0] },
    { geo: rot(new THREE.CylinderGeometry(0.13, 0.13, 3.6, 6), 0, Math.PI / 2), mat: khaki, offset: [1.6, 3.5, 0] },
  ];

  protos.monPlane = [
    ...pedestal(2.4, 3.2, 2.4),
    { geo: rot(new THREE.CylinderGeometry(0.5, 0.28, 7.5, 8), 0, Math.PI / 2), mat: steel, offset: [0, 6.4, 0] },
    { geo: box(1.6, 0.16, 7.2), mat: steel, offset: [0.4, 6.2, 0] }, // крылья
    { geo: box(1.2, 1.6, 0.14), mat: steel, offset: [-3.0, 7.1, 0] }, // киль
    { geo: box(0.8, 0.12, 2.4), mat: steel, offset: [-2.9, 6.3, 0] },
  ];

  protos.monRocket = [
    ...pedestal(3, 1.2, 3),
    { geo: new THREE.CylinderGeometry(0.9, 1.1, 11, 10), mat: mat(0xe6e6e2), offset: [0, 7.7, 0] },
    { geo: new THREE.ConeGeometry(0.9, 3.2, 10), mat: mat(0xc23b2b), offset: [0, 14.8, 0] },
    { geo: box(0.16, 2.6, 1.7), mat: mat(0xc23b2b), offset: [0, 3.5, 1.2] },
    { geo: box(1.7, 2.6, 0.16), mat: mat(0xc23b2b), offset: [1.2, 3.5, 0] },
  ];

  protos.monLoco = [
    ...pedestal(8, 1.2, 3.4),
    { geo: rot(new THREE.CylinderGeometry(1.2, 1.2, 5.4, 10), 0, Math.PI / 2), mat: mat(0x2b2b2e), offset: [-0.6, 3.2, 0] },
    { geo: box(2.2, 2.4, 2.6), mat: mat(0x2b2b2e), offset: [2.6, 3.6, 0] }, // будка
    { geo: new THREE.CylinderGeometry(0.45, 0.6, 1.6, 8), mat: mat(0x1f1f22), offset: [-2.4, 4.9, 0] }, // труба
    { geo: rot(new THREE.CylinderGeometry(0.9, 0.9, 0.3, 10), Math.PI / 2), mat: mat(0xa03030), offset: [-1.6, 1.9, 1.4] },
    { geo: rot(new THREE.CylinderGeometry(0.9, 0.9, 0.3, 10), Math.PI / 2), mat: mat(0xa03030), offset: [1.2, 1.9, 1.4] },
  ];

  protos.monFlame = [
    { geo: box(5, 0.35, 5), mat: graniteDark, offset: [0, 0.18, 0] },
    { geo: flat(new THREE.OctahedronGeometry(1.5, 0), 0.25), mat: mat(0x4a4a48), offset: [0, 0.5, 0] },
    { geo: new THREE.ConeGeometry(0.5, 1.6, 8), mat: new THREE.MeshBasicMaterial({ color: 0xff9424 }), offset: [0, 1.3, 0] },
    { geo: new THREE.ConeGeometry(0.26, 0.9, 8), mat: new THREE.MeshBasicMaterial({ color: 0xffe08a }), offset: [0, 1.6, 0] },
  ];

  protos.monHorseman = [
    ...pedestal(4.4, 3.0, 2.6),
    { geo: box(3.0, 1.3, 1.0), mat: bronze, offset: [0, 4.6, 0] }, // круп
    { geo: box(0.9, 1.4, 0.8), mat: bronze, offset: [1.5, 5.3, 0] }, // шея
    { geo: box(0.35, 1.9, 0.35), mat: bronze, offset: [1.1, 3.5, 0.4] },
    { geo: box(0.35, 1.9, 0.35), mat: bronze, offset: [-1.1, 3.5, -0.4] },
    { geo: box(0.7, 1.3, 0.5), mat: bronze, offset: [0, 5.9, 0] }, // всадник
    { geo: new THREE.SphereGeometry(0.26, 10, 8), mat: bronze, offset: [0, 6.7, 0] },
  ];

  protos.monBust = [
    ...pedestal(1.8, 2.6, 1.8),
    { geo: box(1.1, 0.7, 0.7), mat: bronze, offset: [0, 3.3, 0] },
    { geo: new THREE.SphereGeometry(0.34, 12, 10), mat: bronze, offset: [0, 4.0, 0] },
  ];

  protos.monGlobe = [
    ...pedestal(3, 1, 3),
    { geo: new THREE.CylinderGeometry(0.4, 0.7, 9, 8), mat: mat(0xe0dcd2), offset: [0, 5.5, 0] },
    { geo: new THREE.SphereGeometry(1.5, 14, 10), mat: mat(0x3a6b9a), offset: [0, 11.2, 0] },
    { geo: rot(new THREE.TorusGeometry(1.75, 0.09, 6, 20), Math.PI / 2), mat: mat(0xd8b24a), offset: [0, 11.2, 0] },
  ];

  // Памятник.
  protos.statue = [
    { geo: box(3.4, 1.1, 3.4), mat: mat(0x8f8f8a), offset: [0, 0.55, 0] },
    { geo: box(2.2, 0.5, 2.2), mat: mat(0x9a9a94), offset: [0, 1.35, 0] },
    { geo: box(0.8, 2.2, 0.6), mat: mat(0x5f6a63), offset: [0, 2.7, 0] },
    { geo: new THREE.SphereGeometry(0.28, 10, 8), mat: mat(0x5f6a63), offset: [0, 4, 0] },
    { geo: box(0.24, 1.2, 0.24), mat: mat(0x5f6a63), offset: [0.55, 3.2, 0.25] },
  ];

  return protos;
}

/** Купола храма — отдельная деталь, ставится поверх здания. */
export function churchDomes(width, depth, height) {
  const g = new THREE.Group();
  const goldM = new THREE.MeshLambertMaterial({ color: 0xe8c04a, emissive: 0x3a2c08 });
  const drumM = mat(0xf0eadc);
  const positions = [
    [0, 0, 0.9],
    [-width * 0.28, 0, 0.55],
    [width * 0.28, 0, 0.55],
    [0, -depth * 0.28, 0.55],
    [0, depth * 0.28, 0.55],
  ];
  for (const [dx, dz, s] of positions) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.1 * s, 1.2 * s, 2.4 * s, 10), drumM);
    drum.position.set(dx, height + 1.2 * s, dz);
    g.add(drum);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.25 * s, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), goldM);
    dome.position.set(dx, height + 2.4 * s, dz);
    dome.scale.y = 1.25;
    g.add(dome);
    const cross = new THREE.Mesh(box(0.08 * s, 1.1 * s, 0.08 * s), goldM);
    cross.position.set(dx, height + 3.5 * s, dz);
    g.add(cross);
    const crossBar = new THREE.Mesh(box(0.5 * s, 0.08 * s, 0.08 * s), goldM);
    crossBar.position.set(dx, height + 3.7 * s, dz);
    g.add(crossBar);
  }
  return g;
}

/** Колонны для здания администрации. */
export function columns(width, depth, height) {
  const g = new THREE.Group();
  const m = mat(0xe6dcc2);
  const count = Math.max(4, Math.floor(width / 3));
  for (let i = 0; i < count; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, height * 0.8, 8), m);
    c.position.set(-width / 2 + 1 + (i * (width - 2)) / (count - 1), height * 0.4, depth / 2 + 0.5);
    g.add(c);
  }
  const portico = new THREE.Mesh(box(width, height * 0.12, 1.6), m);
  portico.position.set(0, height * 0.86, depth / 2 + 0.5);
  g.add(portico);
  return g;
}
