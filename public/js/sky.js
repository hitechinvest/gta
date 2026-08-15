// Небесный купол: градиент по высоте, солнце с ореолом, звёзды ночью
// и лёгкие облака. Один меш с шейдером — дешевле кубической карты.
import * as THREE from 'three';

const VERT = `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAG = `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 groundColor;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float night;
uniform float time;
varying vec3 vWorld;

// Дешёвый шум для облаков.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 dir = normalize(vWorld);
  float h = dir.y;

  vec3 sky = mix(horizonColor, topColor, clamp(pow(max(h, 0.0), 0.55), 0.0, 1.0));
  sky = mix(groundColor, sky, smoothstep(-0.12, 0.06, h));

  // Солнце и его ореол у горизонта. Ниже горизонта диск гаснет,
  // иначе ночью в небе висит второе светило.
  float sun = max(dot(dir, normalize(sunDir)), 0.0);
  float sunUp = smoothstep(-0.06, 0.10, sunDir.y);
  sky += sunColor * pow(sun, 900.0) * 12.0 * sunUp;
  sky += sunColor * pow(sun, 12.0) * 0.32 * sunUp;
  sky += sunColor * pow(sun, 3.0) * 0.09 * sunUp;

  // Ночью вместо солнца — луна с мягким ореолом.
  float moon = max(dot(dir, normalize(vec3(-sunDir.x, abs(sunDir.y) * 0.8 + 0.25, -sunDir.z))), 0.0);
  sky += vec3(0.85, 0.88, 1.0) * pow(moon, 1400.0) * 9.0 * night;
  sky += vec3(0.45, 0.5, 0.7) * pow(moon, 40.0) * 0.16 * night;

  // Облака — только выше горизонта, слабее ночью.
  if (h > 0.02) {
    vec2 uv = dir.xz / max(h + 0.16, 0.001) * 0.5;
    float clouds = fbm(uv * 0.9 + vec2(time * 0.006, time * 0.002));
    clouds = smoothstep(0.52, 0.9, clouds) * smoothstep(0.02, 0.35, h);
    vec3 cloudColor = mix(vec3(1.0, 0.98, 0.94), vec3(0.42, 0.45, 0.52), night);
    sky = mix(sky, cloudColor, clouds * 0.75);
  }

  // Звёзды проступают к ночи.
  if (night > 0.01 && h > 0.0) {
    vec2 grid = floor(dir.xz / max(h + 0.1, 0.001) * 90.0);
    float star = step(0.9975, hash(grid));
    float twinkle = 0.6 + 0.4 * sin(time * 2.0 + hash(grid) * 30.0);
    sky += vec3(star * twinkle * night * 0.9);
  }

  gl_FragColor = vec4(sky, 1.0);
}`;

export class Sky {
  constructor(scene, radius = 700) {
    this.uniforms = {
      topColor: { value: new THREE.Color(0x2f5f9e) },
      horizonColor: { value: new THREE.Color(0xbcc9d4) },
      groundColor: { value: new THREE.Color(0x6a6152) },
      sunDir: { value: new THREE.Vector3(0.4, 0.6, 0.4) },
      sunColor: { value: new THREE.Color(0xffe6bd) },
      night: { value: 0 },
      time: { value: 0 },
    };

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 20),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: true,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  /**
   * @param {number} dayness 0 — ночь, 1 — ясный день
   * @param {THREE.Vector3} sunDir направление на солнце
   * @param {number} t время в секундах для облаков и мерцания
   * @param {THREE.Vector3} center позиция игрока (купол следует за ним)
   */
  update(dayness, sunDir, t, center) {
    const u = this.uniforms;
    const eveningness = Math.max(0, 1 - Math.abs(sunDir.y) * 3.2);

    u.topColor.value.setHex(0x1a2340).lerp(new THREE.Color(0x3f78c0), dayness);
    u.horizonColor.value.setHex(0x232c40)
      .lerp(new THREE.Color(0xc6d2dc), dayness)
      .lerp(new THREE.Color(0xe0975a), eveningness * 0.7);
    u.groundColor.value.setHex(0x11151c).lerp(new THREE.Color(0x6f6656), dayness);
    u.sunColor.value.setHex(0xffd9a0).lerp(new THREE.Color(0xfff2d8), dayness);
    u.sunDir.value.copy(sunDir).normalize();
    u.night.value = 1 - Math.min(1, dayness * 1.6);
    u.time.value = t;

    if (center) this.mesh.position.set(center.x, 0, center.z);
  }
}
