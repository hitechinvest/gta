// Миникарта: кварталы, улицы, игроки, ДПС, машины и аптечки.
// Рисуется в 2D-канвасе, центр — игрок, север сверху.
import { CONFIG, roadCenter } from '/shared/worldgen.js';

const COLORS = {
  ground: '#2b3126',
  road: '#4a4d51',
  block: '#5a5a55',
  building: '#6d6a62',
  water: '#2a4257',
  me: '#ffd24a',
  player: '#54d6ff',
  cop: '#3a7bff',
  car: '#c9c9c4',
  pickup: '#5cd66b',
};

export class Minimap {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.scale = 0.42; // пикселей на метр
    this.radius = canvas.width / 2;
    this.rotate = true;

    // Статическая подложка: рисуем город один раз в offscreen-канвас.
    this.origin = world.osm ? -world.radius : CONFIG.origin;
    const size = world.osm ? world.radius * 2 : CONFIG.total;
    const px = Math.round(size * this.scale);
    this.base = document.createElement('canvas');
    this.base.width = px;
    this.base.height = px;
    this.drawBase();
  }

  worldToBase(x, z) {
    return {
      x: (x - this.origin) * this.scale,
      y: (z - this.origin) * this.scale,
    };
  }

  drawBase() {
    const ctx = this.base.getContext('2d');
    const s = this.scale;
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, this.base.width, this.base.height);

    if (this.world.osm) {
      this.drawOsmBase(ctx, s);
      return;
    }

    // Кварталы.
    ctx.fillStyle = COLORS.block;
    for (let i = 0; i < CONFIG.gridSize; i++) {
      for (let j = 0; j < CONFIG.gridSize; j++) {
        const x = CONFIG.origin + CONFIG.road + i * CONFIG.pitch;
        const z = CONFIG.origin + CONFIG.road + j * CONFIG.pitch;
        const p = this.worldToBase(x, z);
        ctx.fillRect(p.x, p.y, CONFIG.block * s, CONFIG.block * s);
      }
    }

    // Дороги.
    ctx.fillStyle = COLORS.road;
    for (let i = 0; i <= CONFIG.gridSize; i++) {
      const c = roadCenter(i);
      const p = this.worldToBase(c - CONFIG.road / 2, CONFIG.origin);
      ctx.fillRect(p.x, 0, CONFIG.road * s, this.base.height);
      const p2 = this.worldToBase(CONFIG.origin, c - CONFIG.road / 2);
      ctx.fillRect(0, p2.y, this.base.width, CONFIG.road * s);
    }

    // Дома.
    ctx.fillStyle = COLORS.building;
    for (const b of this.world.buildings) {
      const p = this.worldToBase(b.x - b.w / 2, b.z - b.d / 2);
      ctx.fillRect(p.x, p.y, Math.max(1, b.w * s), Math.max(1, b.d * s));
    }
  }

  /** Реальный город: зелень, улицы лентами, контуры домов. */
  drawOsmBase(ctx, s) {
    for (const area of this.world.green || []) {
      if (!area.p || area.p.length < 3) continue;
      ctx.fillStyle = '#33422c';
      ctx.beginPath();
      area.p.forEach(([x, z], i) => {
        const q = this.worldToBase(x, z);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fill();
    }

    for (const area of this.world.water || []) {
      if (!area.p || area.p.length < 3) continue;
      ctx.fillStyle = COLORS.water;
      ctx.beginPath();
      area.p.forEach(([x, z], i) => {
        const q = this.worldToBase(x, z);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fill();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const road of this.world.roads || []) {
      const walk = road.k === 'footway' || road.k === 'pedestrian';
      ctx.strokeStyle = walk ? '#5a5a54' : COLORS.road;
      ctx.lineWidth = Math.max(1, road.w * s * (walk ? 0.5 : 1));
      ctx.beginPath();
      road.p.forEach(([x, z], i) => {
        const q = this.worldToBase(x, z);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
    }

    for (const b of this.world.buildings) {
      ctx.fillStyle = b.name ? '#9a8f70' : COLORS.building;
      ctx.beginPath();
      (b.poly || []).forEach(([x, z], i) => {
        const q = this.worldToBase(x, z);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fill();
    }
  }

  draw(state) {
    const ctx = this.ctx;
    const size = this.canvas.width;
    const R = size / 2;
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();

    const me = this.worldToBase(state.x, state.z);
    const angle = this.rotate ? -state.yaw : 0;

    ctx.translate(R, R);
    if (this.rotate) ctx.rotate(angle);
    ctx.drawImage(this.base, -me.x, -me.y);

    const pt = (x, z) => {
      const p = this.worldToBase(x, z);
      return { x: p.x - me.x, y: p.y - me.y };
    };

    // Аптечки и бонусы.
    for (const p of state.pickups || []) {
      if (p.takenUntil > Date.now()) continue;
      const q = pt(p.x, p.z);
      if (Math.hypot(q.x, q.y) > R) continue;
      ctx.fillStyle = COLORS.pickup;
      ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    }

    // Машины.
    ctx.fillStyle = COLORS.car;
    for (const v of state.vehicles || []) {
      const q = pt(v.x, v.z);
      if (Math.hypot(q.x, q.y) > R) continue;
      ctx.fillStyle = v.police ? COLORS.cop : COLORS.car;
      ctx.fillRect(q.x - 1.6, q.y - 1.6, 3.2, 3.2);
    }

    // Патрули ДПС.
    for (const c of state.cops || []) {
      const q = pt(c.x, c.z);
      const d = Math.hypot(q.x, q.y);
      const angleTo = Math.atan2(q.y, q.x);
      const cx = d > R - 6 ? Math.cos(angleTo) * (R - 6) : q.x;
      const cy = d > R - 6 ? Math.sin(angleTo) * (R - 6) : q.y;
      ctx.fillStyle = COLORS.cop;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Другие игроки.
    for (const p of state.players || []) {
      const q = pt(p.x, p.z);
      if (Math.hypot(q.x, q.y) > R - 4) continue;
      ctx.fillStyle = COLORS.player;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Свой маркер — всегда в центре, смотрит вверх.
    ctx.save();
    ctx.translate(R, R);
    if (!this.rotate) ctx.rotate(state.yaw);
    ctx.fillStyle = COLORS.me;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Рамка и север.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(this.rotate ? -state.yaw : 0);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('С', 0, -R + 13);
    ctx.restore();
  }
}
