// Процедурные модели: персонажи (в российском антураже), автомобили,
// уличные объекты. Всё собирается из примитивов, без внешних файлов.
import * as THREE from 'three';
import { VEHICLES } from '/shared/protocol.js';
import { signTexture } from './textures.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
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

  const jacketM = mat(s.jacket);
  const pantsM = mat(s.pants);
  const skinM = mat(s.skin);

  const hips = new THREE.Group();
  hips.position.y = 0.9;
  root.add(hips);

  const torso = new THREE.Mesh(box(0.5, 0.62, 0.28), jacketM);
  torso.position.y = 0.31;
  torso.castShadow = true;
  hips.add(torso);

  if (s.vest) {
    const vest = new THREE.Mesh(box(0.54, 0.34, 0.32), mat(s.vest));
    vest.position.y = 0.34;
    torso.add(vest);
  }

  const neck = new THREE.Mesh(box(0.16, 0.08, 0.16), skinM);
  neck.position.y = 0.66;
  hips.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.72;
  hips.add(head);
  const skull = new THREE.Mesh(box(0.26, 0.28, 0.26), skinM);
  skull.position.y = 0.14;
  skull.castShadow = true;
  head.add(skull);
  const hair = new THREE.Mesh(box(0.28, 0.09, 0.28), mat(s.hat || 0x2a2018));
  hair.position.y = 0.29;
  head.add(hair);
  if (s.hat) {
    const cap = new THREE.Mesh(box(0.3, 0.06, 0.16), mat(s.hat));
    cap.position.set(0, 0.26, 0.14);
    head.add(cap);
  }
  // Глаза, чтобы было видно, куда смотрит.
  const eyeM = mat(0x1a1a1a);
  for (const x of [-0.06, 0.06]) {
    const eye = new THREE.Mesh(box(0.04, 0.04, 0.02), eyeM);
    eye.position.set(x, 0.16, 0.135);
    head.add(eye);
  }

  function makeArm(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.32, 0.56, 0);
    const upper = new THREE.Mesh(box(0.14, 0.56, 0.16), jacketM);
    upper.position.y = -0.28;
    upper.castShadow = true;
    g.add(upper);
    const hand = new THREE.Mesh(box(0.12, 0.12, 0.14), skinM);
    hand.position.y = -0.6;
    g.add(hand);
    hips.add(g);
    return g;
  }

  function makeLeg(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.13, 0, 0);
    const leg = new THREE.Mesh(box(0.18, 0.86, 0.2), pantsM);
    leg.position.y = -0.43;
    leg.castShadow = true;
    g.add(leg);
    if (s.stripes) {
      const stripe = new THREE.Mesh(box(0.03, 0.8, 0.03), mat(0xf0f0f0));
      stripe.position.set(side * 0.095, -0.43, 0);
      g.add(stripe);
    }
    const shoe = new THREE.Mesh(box(0.19, 0.12, 0.3), mat(0x141416));
    shoe.position.set(0, -0.88, 0.04);
    g.add(shoe);
    hips.add(g);
    return g;
  }

  const armL = makeArm(-1);
  const armR = makeArm(1);
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // Оружие в правой руке.
  const weapon = new THREE.Group();
  weapon.position.set(0, -0.58, 0.08);
  armR.add(weapon);
  const gunBody = new THREE.Mesh(box(0.07, 0.13, 0.3), mat(0x23262b));
  gunBody.position.z = 0.1;
  weapon.add(gunBody);
  weapon.visible = false;

  root.userData = {
    hips, head, armL, armR, legL, legR, weapon, torso,
    phase: Math.random() * Math.PI * 2,
    skinIndex,
  };

  root.update = (dt, state = {}) => {
    const d = root.userData;
    const speed = state.speed || 0;
    const moving = speed > 0.35;
    d.phase += dt * (moving ? 2.2 + speed * 1.35 : 3.0);

    const swing = moving ? Math.min(1, speed / 5) : 0;
    const sw = Math.sin(d.phase) * (0.55 + swing * 0.55) * (moving ? 1 : 0);

    legL.rotation.x = sw;
    legR.rotation.x = -sw;

    if (state.aiming) {
      armR.rotation.x = -Math.PI / 2 + (state.pitch || 0) * 0.6;
      armR.rotation.z = -0.12;
      armL.rotation.x = -Math.PI / 2.4;
      armL.rotation.z = 0.3;
      weapon.visible = state.weapon && state.weapon !== 'fists';
    } else {
      armR.rotation.x = -sw * 0.75;
      armL.rotation.x = sw * 0.75;
      armR.rotation.z = 0;
      armL.rotation.z = 0;
      weapon.visible = false;
    }

    // Лёгкое покачивание корпуса.
    hips.position.y = 0.9 + (moving ? Math.abs(Math.sin(d.phase)) * 0.045 : Math.sin(d.phase * 0.5) * 0.012);
    torso.rotation.x = moving ? 0.08 + swing * 0.12 : 0.02;
    head.rotation.x = THREE.MathUtils.clamp(state.pitch || 0, -0.6, 0.6);

    if (state.sitting) {
      legL.rotation.x = -1.35;
      legR.rotation.x = -1.35;
      armL.rotation.x = -0.9;
      armR.rotation.x = -0.9;
      hips.position.y = 0.86;
    }
    if (state.dead) {
      root.rotation.x = -Math.PI / 2.1;
      hips.position.y = 0.35;
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

/**
 * Строит машину нужного типа. Возвращает группу с userData.wheels,
 * userData.siren (для ДПС) и методом update(dt, state).
 */
export function createVehicle(type = 'zhiguli', color = 0xc9d3d9) {
  const def = VEHICLES[type] || VEHICLES.zhiguli;
  const [w, h, l] = def.size;
  const root = new THREE.Group();
  const bodyM = mat(color);
  const glassM = new THREE.MeshLambertMaterial({ color: 0x2b3a44, transparent: true, opacity: 0.72 });
  const darkM = mat(0x1a1c1f);
  const chromeM = mat(0xb8bfc4);

  const wheelR = def.body === 'suv' ? 0.36 : def.body === 'truck' || def.body === 'van' ? 0.38 : 0.32;
  const bodyY = wheelR + 0.12;

  const group = new THREE.Group();
  group.position.y = bodyY;
  root.add(group);

  if (def.body === 'sedan' || def.body === 'suv') {
    const lower = new THREE.Mesh(box(w, h * 0.42, l), bodyM);
    lower.position.y = h * 0.21;
    lower.castShadow = true;
    group.add(lower);

    const cabinLen = l * 0.46;
    const cabin = new THREE.Mesh(box(w * 0.92, h * 0.42, cabinLen), bodyM);
    cabin.position.set(0, h * 0.63, def.body === 'suv' ? -l * 0.02 : -l * 0.04);
    cabin.castShadow = true;
    group.add(cabin);

    // Стёкла.
    const glassSide = new THREE.Mesh(box(w * 0.94, h * 0.26, cabinLen * 0.9), glassM);
    glassSide.position.copy(cabin.position);
    glassSide.position.y += h * 0.04;
    group.add(glassSide);

    // Крыша чуть уже.
    const roof = new THREE.Mesh(box(w * 0.86, h * 0.06, cabinLen * 0.92), bodyM);
    roof.position.set(cabin.position.x, h * 0.84, cabin.position.z);
    group.add(roof);
  } else if (def.body === 'van') {
    const bodyMesh = new THREE.Mesh(box(w, h * 0.8, l), bodyM);
    bodyMesh.position.y = h * 0.42;
    bodyMesh.castShadow = true;
    group.add(bodyMesh);
    const windshield = new THREE.Mesh(box(w * 0.9, h * 0.3, 0.1), glassM);
    windshield.position.set(0, h * 0.62, l / 2 + 0.01);
    group.add(windshield);
    const sideGlass = new THREE.Mesh(box(w + 0.02, h * 0.22, l * 0.3), glassM);
    sideGlass.position.set(0, h * 0.62, l * 0.22);
    group.add(sideGlass);
  } else {
    // Газель: кабина + будка.
    const cab = new THREE.Mesh(box(w, h * 0.55, l * 0.32), bodyM);
    cab.position.set(0, h * 0.3, l * 0.32);
    cab.castShadow = true;
    group.add(cab);
    const cargo = new THREE.Mesh(box(w * 1.02, h * 0.72, l * 0.62), mat(0xe8e6e0));
    cargo.position.set(0, h * 0.42, -l * 0.17);
    cargo.castShadow = true;
    group.add(cargo);
    const windshield = new THREE.Mesh(box(w * 0.88, h * 0.26, 0.08), glassM);
    windshield.position.set(0, h * 0.44, l * 0.48);
    group.add(windshield);
  }

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

export function propPrototypes() {
  const protos = {};

  // Тополь: ствол + вытянутая крона.
  protos.poplar = [
    { geo: new THREE.CylinderGeometry(0.2, 0.32, 7, 6), mat: mat(0x5a4a3a), offset: [0, 3.5, 0] },
    { geo: new THREE.ConeGeometry(1.25, 11, 7), mat: mat(0x53703a), offset: [0, 10, 0] },
  ];
  // Берёза: белый ствол + шарообразная крона.
  protos.birch = [
    { geo: new THREE.CylinderGeometry(0.13, 0.18, 5, 6), mat: mat(0xe4e2da), offset: [0, 2.5, 0] },
    { geo: new THREE.IcosahedronGeometry(1.9, 0), mat: mat(0x5d7a3a), offset: [0, 6, 0] },
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
