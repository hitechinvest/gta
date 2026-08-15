// Процедурные текстуры на canvas: фасады панелек и сталинок, асфальт,
// вывески, трава. Никаких внешних ассетов — всё рисуется в браузере.
import * as THREE from 'three';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, repeatX = 1, repeatY = 1, aniso = 4) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = aniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function noise(ctx, w, h, amount, alpha = 0.06) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.globalAlpha = 1;
}

function hex(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Фасад панельного дома: швы между плитами, окна, балконы. */
export function panelFacade(baseColor = 0xc9c3b4, withBalcony = true) {
  const key = `panel-${baseColor}-${withBalcony}`;
  if (cache.has(key)) return cache.get(key);

  const W = 256, H = 256; // 2 подъезда x 2 этажа
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);

  // Швы плит.
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 2;
  for (let y = 0; y <= H; y += H / 2) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
  }
  for (let x = 0; x <= W; x += W / 2) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
  }

  // Потёки и пятна.
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(90,85,75,${0.02 + Math.random() * 0.05})`;
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.fillRect(x, y, 2 + Math.random() * 26, 3 + Math.random() * 40);
  }

  const floorH = H / 2;
  for (let f = 0; f < 2; f++) {
    const y0 = f * floorH;
    // Окна: два спаренных + балконная дверь.
    const winY = y0 + floorH * 0.22;
    const winH = floorH * 0.42;
    const layout = [
      { x: W * 0.06, w: W * 0.16 },
      { x: W * 0.26, w: W * 0.16 },
      { x: W * 0.56, w: W * 0.16 },
      { x: W * 0.76, w: W * 0.16 },
    ];
    for (const win of layout) {
      ctx.fillStyle = '#2b3742';
      ctx.fillRect(win.x, winY, win.w, winH);
      // Рама.
      ctx.strokeStyle = 'rgba(240,240,235,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeRect(win.x, winY, win.w, winH);
      ctx.beginPath();
      ctx.moveTo(win.x + win.w / 2, winY);
      ctx.lineTo(win.x + win.w / 2, winY + winH);
      ctx.stroke();
      // Блик стекла.
      ctx.fillStyle = 'rgba(150,180,200,0.25)';
      ctx.beginPath();
      ctx.moveTo(win.x, winY + winH);
      ctx.lineTo(win.x + win.w, winY);
      ctx.lineTo(win.x + win.w, winY + winH * 0.35);
      ctx.closePath();
      ctx.fill();
    }

    if (withBalcony) {
      // Застеклённый балкон посередине.
      const bx = W * 0.44;
      const bw = W * 0.1;
      ctx.fillStyle = 'rgba(120,125,120,0.9)';
      ctx.fillRect(bx - 4, winY - 4, bw + 8, winH + 12);
      ctx.fillStyle = '#4a5560';
      ctx.fillRect(bx, winY, bw, winH);
      ctx.strokeStyle = 'rgba(210,205,190,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, winY, bw, winH);
      // Ограждение.
      ctx.fillStyle = 'rgba(80,90,80,0.9)';
      ctx.fillRect(bx - 6, winY + winH + 2, bw + 12, 8);
    }
  }

  noise(ctx, W, H, 26);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/**
 * Хрущёвка: силикатный кирпич или мелкая панель, три окна на секцию,
 * открытые балконы с решёткой. Тайл = 2 этажа, 1 секция.
 */
export function khrushchevkaFacade(baseColor = 0xd8d3c0, brick = true) {
  const key = `khrush-${baseColor}-${brick}`;
  if (cache.has(key)) return cache.get(key);

  const W = 256, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const base = new THREE.Color(baseColor);
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);

  if (brick) {
    // Силикатная кладка: кирпич крупный, шов светлый.
    const bh = 8;
    const bw = 22;
    for (let row = 0, y = 0; y < H; row++, y += bh) {
      const off = (row % 2) * (bw / 2);
      for (let x = -bw; x < W + bw; x += bw) {
        const col = base.clone().multiplyScalar(0.9 + Math.random() * 0.2);
        ctx.fillStyle = col.getStyle();
        ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
  } else {
    // Панельный вариант: швы плит по два этажа.
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 2;
    for (let y = 0; y <= H; y += H / 2) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  }

  const floorH = H / 2;
  for (let f = 0; f < 2; f++) {
    const y0 = f * floorH;
    const winY = y0 + floorH * 0.26;
    const winH = floorH * 0.38;

    // Три небольших окна: два жилых и кухонное поменьше.
    const wins = [
      { x: W * 0.07, w: W * 0.2 },
      { x: W * 0.33, w: W * 0.2 },
      { x: W * 0.78, w: W * 0.15 },
    ];
    for (const win of wins) {
      ctx.fillStyle = '#2f3a44';
      ctx.fillRect(win.x, winY, win.w, winH);
      ctx.strokeStyle = 'rgba(238,236,228,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeRect(win.x, winY, win.w, winH);
      ctx.beginPath();
      ctx.moveTo(win.x + win.w * 0.62, winY);
      ctx.lineTo(win.x + win.w * 0.62, winY + winH);
      ctx.stroke();
      ctx.fillStyle = 'rgba(165,195,215,0.2)';
      ctx.fillRect(win.x + 2, winY + 2, win.w * 0.5, winH * 0.45);
      // Отлив.
      ctx.fillStyle = 'rgba(120,120,115,0.75)';
      ctx.fillRect(win.x - 2, winY + winH, win.w + 4, 4);
    }

    // Открытый балкон с решёткой — та самая примета хрущёвки.
    const bx = W * 0.56;
    const bw = W * 0.18;
    ctx.fillStyle = 'rgba(150,148,140,0.95)';
    ctx.fillRect(bx - 5, winY + winH * 0.15, bw + 10, winH * 0.85);
    ctx.fillStyle = '#3b4550';
    ctx.fillRect(bx, winY, bw * 0.55, winH); // балконная дверь
    ctx.strokeStyle = 'rgba(90,95,90,0.9)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 6; i++) {
      const gx = bx - 5 + ((bw + 10) / 6) * i;
      ctx.beginPath();
      ctx.moveTo(gx, winY + winH * 0.2);
      ctx.lineTo(gx, winY + winH);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(110,112,105,0.95)';
    ctx.fillRect(bx - 7, winY + winH, bw + 14, 6);
  }

  // Потёки под окнами и общая усталость фасада.
  for (let i = 0; i < 45; i++) {
    ctx.fillStyle = `rgba(120,115,100,${0.03 + Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 10, 6 + Math.random() * 30);
  }

  noise(ctx, W, H, 22);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/**
 * Панельная девятиэтажка серии 125: крупные панели с рустованной фактурой,
 * спаренные окна и утопленная лоджия с бетонным парапетом.
 * Тайл = 2 этажа, 1 секция.
 */
export function series125Facade(baseColor = 0xc6c2b2, accent = 0x8fa2a8) {
  const key = `s125-${baseColor}-${accent}`;
  if (cache.has(key)) return cache.get(key);

  const W = 256, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);

  // Рустованная фактура панели — мелкая вертикальная бороздка.
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 6) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
  }

  const floorH = H / 2;
  for (let f = 0; f < 2; f++) {
    const y0 = f * floorH;

    // Шов между панелями: горизонтальный на каждом этаже.
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, y0, W, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(0, y0 + 3, W, 2);

    const winY = y0 + floorH * 0.24;
    const winH = floorH * 0.42;

    // Спаренное окно комнаты.
    const wx = W * 0.06;
    const ww = W * 0.34;
    ctx.fillStyle = '#2c3742';
    ctx.fillRect(wx, winY, ww, winH);
    ctx.strokeStyle = 'rgba(236,234,226,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(wx, winY, ww, winH);
    ctx.beginPath();
    ctx.moveTo(wx + ww / 2, winY); ctx.lineTo(wx + ww / 2, winY + winH);
    ctx.stroke();
    ctx.fillStyle = 'rgba(160,195,215,0.2)';
    ctx.fillRect(wx + 3, winY + 3, ww * 0.44, winH * 0.42);

    // Утопленная лоджия: тёмная ниша, боковая стенка и парапет.
    const lx = W * 0.5;
    const lw = W * 0.42;
    ctx.fillStyle = 'rgba(38,44,50,0.92)';
    ctx.fillRect(lx, y0 + floorH * 0.1, lw, floorH * 0.78);
    // Тень в глубине ниши слева.
    const grad = ctx.createLinearGradient(lx, 0, lx + lw, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.35, 'rgba(0,0,0,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = grad;
    ctx.fillRect(lx, y0 + floorH * 0.1, lw, floorH * 0.78);
    // Балконная дверь и окно кухни в глубине лоджии.
    ctx.fillStyle = 'rgba(120,140,150,0.5)';
    ctx.fillRect(lx + lw * 0.1, winY, lw * 0.3, winH);
    ctx.fillRect(lx + lw * 0.55, winY + winH * 0.15, lw * 0.32, winH * 0.7);
    // Парапет лоджии — светлая бетонная плита.
    ctx.fillStyle = hex(accent);
    ctx.fillRect(lx - 2, y0 + floorH * 0.56, lw + 4, floorH * 0.24);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(lx - 2, y0 + floorH * 0.78, lw + 4, 4);
  }

  // Возрастные потёки по швам.
  for (let i = 0; i < 35; i++) {
    ctx.fillStyle = `rgba(110,108,98,${0.03 + Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 8, 10 + Math.random() * 40);
  }

  noise(ctx, W, H, 18);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/** Фасад сталинки: охра, высокие окна, карнизы. */
export function stalinkaFacade(baseColor = 0xd9b26a) {
  const key = `stalinka-${baseColor}`;
  if (cache.has(key)) return cache.get(key);

  const W = 256, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);

  for (let f = 0; f < 2; f++) {
    const y0 = f * (H / 2);
    // Межэтажная тяга.
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(0, y0 + H / 2 - 10, W, 7);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, y0 + H / 2 - 3, W, 3);

    for (let i = 0; i < 3; i++) {
      const wx = W * (0.1 + i * 0.3);
      const ww = W * 0.16;
      const wy = y0 + H * 0.09;
      const wh = H * 0.26;
      // Наличник.
      ctx.fillStyle = 'rgba(255,252,240,0.55)';
      ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
      ctx.fillStyle = '#33404b';
      ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeStyle = 'rgba(245,245,235,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeRect(wx, wy, ww, wh);
      ctx.beginPath();
      ctx.moveTo(wx, wy + wh * 0.45); ctx.lineTo(wx + ww, wy + wh * 0.45);
      ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh);
      ctx.stroke();
      ctx.fillStyle = 'rgba(160,190,210,0.22)';
      ctx.fillRect(wx + 2, wy + 2, ww * 0.45, wh * 0.4);
    }
  }

  // Осыпавшаяся штукатурка.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(150,140,120,${0.05 + Math.random() * 0.12})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * W, Math.random() * H, 3 + Math.random() * 12, 2 + Math.random() * 8, Math.random(), 0, Math.PI * 2);
    ctx.fill();
  }

  noise(ctx, W, H, 22);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/**
 * Фасад «набережной Брюгге»: краснокирпичная кладка, белые наличники,
 * высокие узкие окна с полуциркульным верхом. Тайл = 1 этаж, 2 окна.
 */
export function flemishFacade(baseColor = 0xa8443a) {
  const key = `flemish-${baseColor}`;
  if (cache.has(key)) return cache.get(key);

  const W = 256, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const base = new THREE.Color(baseColor);
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);

  // Кирпичная кладка со смещением рядов.
  const brickH = 9;
  const brickW = 26;
  for (let row = 0, y = 0; y < H; row++, y += brickH) {
    const offset = (row % 2) * (brickW / 2);
    for (let x = -brickW; x < W + brickW; x += brickW) {
      const shade = 0.82 + Math.random() * 0.36;
      const col = base.clone().multiplyScalar(shade);
      ctx.fillStyle = col.getStyle();
      ctx.fillRect(x + offset + 1, y + 1, brickW - 2, brickH - 2);
    }
  }
  // Раствор между кирпичами.
  ctx.strokeStyle = 'rgba(232,226,212,0.35)';
  ctx.lineWidth = 1;
  for (let y = 0; y <= H; y += brickH) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
  }

  // Междуэтажный белый пояс.
  ctx.fillStyle = 'rgba(245,242,232,0.92)';
  ctx.fillRect(0, H - 12, W, 8);

  // Два высоких окна с аркой и белым наличником.
  for (const wx of [W * 0.14, W * 0.58]) {
    const ww = W * 0.28;
    const wy = H * 0.16;
    const wh = H * 0.56;
    const r = ww / 2;

    ctx.fillStyle = 'rgba(246,243,234,0.95)';
    ctx.beginPath();
    ctx.moveTo(wx - 7, wy + wh + 7);
    ctx.lineTo(wx - 7, wy + r);
    ctx.arc(wx + ww / 2, wy + r, r + 7, Math.PI, 0);
    ctx.lineTo(wx + ww + 7, wy + wh + 7);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#2c3a45';
    ctx.beginPath();
    ctx.moveTo(wx, wy + wh);
    ctx.lineTo(wx, wy + r);
    ctx.arc(wx + ww / 2, wy + r, r, Math.PI, 0);
    ctx.lineTo(wx + ww, wy + wh);
    ctx.closePath();
    ctx.fill();

    // Переплёт.
    ctx.strokeStyle = 'rgba(245,242,232,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh);
    ctx.moveTo(wx, wy + wh * 0.55); ctx.lineTo(wx + ww, wy + wh * 0.55);
    ctx.stroke();

    // Блик стекла.
    ctx.fillStyle = 'rgba(170,200,220,0.22)';
    ctx.beginPath();
    ctx.moveTo(wx, wy + wh);
    ctx.lineTo(wx + ww, wy + r * 0.6);
    ctx.lineTo(wx + ww, wy + wh * 0.7);
    ctx.closePath();
    ctx.fill();
  }

  noise(ctx, W, H, 16);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/**
 * Дом-Одеколон: красный кирпич позднесоветского модернизма, узкие окна
 * в вертикальных лентах между кирпичными простенками, лоджии в нишах.
 */
export function odekolonFacade(baseColor = 0xa6503f) {
  const key = `odekolon-${baseColor}`;
  if (cache.has(key)) return cache.get(key);

  const W = 256, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const base = new THREE.Color(baseColor);
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);

  // Кладка: кирпич мельче, чем у фламандских домов, шов темнее.
  const bh = 7;
  const bw = 19;
  for (let row = 0, y = 0; y < H; row++, y += bh) {
    const off = (row % 2) * (bw / 2);
    for (let x = -bw; x < W + bw; x += bw) {
      const col = base.clone().multiplyScalar(0.86 + Math.random() * 0.28);
      ctx.fillStyle = col.getStyle();
      ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
    }
  }

  // Два этажа на тайл, окна лентами.
  const floorH = H / 2;
  for (let f = 0; f < 2; f++) {
    const y0 = f * floorH;
    const winY = y0 + floorH * 0.22;
    const winH = floorH * 0.46;

    // Лента узких окон слева.
    for (let i = 0; i < 3; i++) {
      const wx = W * (0.07 + i * 0.13);
      const ww = W * 0.09;
      ctx.fillStyle = '#28323b';
      ctx.fillRect(wx, winY, ww, winH);
      ctx.strokeStyle = 'rgba(226,222,212,0.75)';
      ctx.lineWidth = 2;
      ctx.strokeRect(wx, winY, ww, winH);
      ctx.fillStyle = 'rgba(160,190,210,0.18)';
      ctx.fillRect(wx + 2, winY + 2, ww * 0.5, winH * 0.4);
    }

    // Лоджия в нише справа — тёмный провал с парапетом.
    const lx = W * 0.56;
    const lw = W * 0.36;
    ctx.fillStyle = 'rgba(40,44,48,0.9)';
    ctx.fillRect(lx, y0 + floorH * 0.12, lw, floorH * 0.74);
    const grad = ctx.createLinearGradient(lx, 0, lx + lw, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = grad;
    ctx.fillRect(lx, y0 + floorH * 0.12, lw, floorH * 0.74);
    ctx.fillStyle = 'rgba(150,155,150,0.55)';
    ctx.fillRect(lx + lw * 0.12, winY, lw * 0.3, winH);
    // Парапет — бетон под цвет плит.
    ctx.fillStyle = '#b0aa9c';
    ctx.fillRect(lx - 3, y0 + floorH * 0.58, lw + 6, floorH * 0.2);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(lx - 3, y0 + floorH * 0.76, lw + 6, 3);
  }

  noise(ctx, W, H, 16);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/**
 * Замок театра кукол: светлый камень квадрами и высокие стрельчатые окна
 * с наличниками. Тайл = 1 этаж, 2 окна.
 */
export function castleFacade(baseColor = 0xece4d0) {
  const key = `castle-${baseColor}`;
  if (cache.has(key)) return cache.get(key);

  const W = 256, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const base = new THREE.Color(baseColor);
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);

  // Каменная кладка крупными квадрами.
  const bh = 16;
  const bw = 42;
  for (let row = 0, y = 0; y < H; row++, y += bh) {
    const off = (row % 2) * (bw / 2);
    for (let x = -bw; x < W + bw; x += bw) {
      const col = base.clone().multiplyScalar(0.94 + Math.random() * 0.12);
      ctx.fillStyle = col.getStyle();
      ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
    }
  }

  // Два стрельчатых окна.
  for (const wx of [W * 0.16, W * 0.58]) {
    const ww = W * 0.26;
    const wy = H * 0.2;
    const wh = H * 0.56;
    const r = ww / 2;

    ctx.fillStyle = 'rgba(252,248,238,0.95)';
    ctx.beginPath();
    ctx.moveTo(wx - 8, wy + wh + 8);
    ctx.lineTo(wx - 8, wy + r * 0.7);
    ctx.lineTo(wx + ww / 2, wy - r * 0.5);
    ctx.lineTo(wx + ww + 8, wy + r * 0.7);
    ctx.lineTo(wx + ww + 8, wy + wh + 8);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#26323c';
    ctx.beginPath();
    ctx.moveTo(wx, wy + wh);
    ctx.lineTo(wx, wy + r * 0.75);
    ctx.lineTo(wx + ww / 2, wy);
    ctx.lineTo(wx + ww, wy + r * 0.75);
    ctx.lineTo(wx + ww, wy + wh);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(250,246,236,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh);
    ctx.moveTo(wx, wy + wh * 0.62); ctx.lineTo(wx + ww, wy + wh * 0.62);
    ctx.stroke();
    ctx.fillStyle = 'rgba(170,200,225,0.22)';
    ctx.fillRect(wx + 3, wy + r, ww * 0.42, wh * 0.35);
  }

  noise(ctx, W, H, 12);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/** Кладка кремлёвской стены — крупный кирпич, без окон. */
export function brickWall(baseColor = 0x9c4a3c) {
  const key = `brick-${baseColor}`;
  if (cache.has(key)) return cache.get(key);
  const W = 128, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const base = new THREE.Color(baseColor);
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);
  const bh = 11;
  const bw = 30;
  for (let row = 0, y = 0; y < H; row++, y += bh) {
    const off = (row % 2) * (bw / 2);
    for (let x = -bw; x < W + bw; x += bw) {
      const shade = 0.8 + Math.random() * 0.4;
      const col = base.clone().multiplyScalar(shade);
      ctx.fillStyle = col.getStyle();
      ctx.fillRect(x + off + 1.5, y + 1.5, bw - 3, bh - 3);
    }
  }
  noise(ctx, W, H, 20);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/** Заводской корпус: ленточное остекление, ребристые стены. */
export function factoryFacade(baseColor = 0x9b8f80) {
  const key = `factory-${baseColor}`;
  if (cache.has(key)) return cache.get(key);
  const W = 256, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  for (let x = 0; x < W; x += 16) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  ctx.fillStyle = '#2f3b44';
  ctx.fillRect(0, H * 0.24, W, H * 0.3);
  ctx.strokeStyle = 'rgba(200,200,190,0.6)';
  ctx.lineWidth = 3;
  for (let x = 0; x <= W; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, H * 0.24); ctx.lineTo(x, H * 0.54); ctx.stroke();
  }
  ctx.strokeRect(0, H * 0.24, W, H * 0.3);
  // Ржавые подтёки.
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(120,70,40,${0.05 + Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * W, H * 0.54, 2 + Math.random() * 5, Math.random() * H * 0.4);
  }
  noise(ctx, W, H, 24);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/** Частный дом: сайдинг/доска. */
export function privateFacade(baseColor = 0x8fa07a) {
  const key = `private-${baseColor}`;
  if (cache.has(key)) return cache.get(key);
  const W = 128, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 2;
  for (let y = 0; y < H; y += 10) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.fillStyle = '#33404b';
  ctx.fillRect(W * 0.18, H * 0.3, W * 0.24, H * 0.3);
  ctx.fillRect(W * 0.58, H * 0.3, W * 0.24, H * 0.3);
  ctx.strokeStyle = 'rgba(250,250,245,0.9)';
  ctx.lineWidth = 3;
  ctx.strokeRect(W * 0.18, H * 0.3, W * 0.24, H * 0.3);
  ctx.strokeRect(W * 0.58, H * 0.3, W * 0.24, H * 0.3);
  noise(ctx, W, H, 20);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/** Ворота гаража-ракушки. */
export function garageFacade(baseColor = 0x7d8a6a) {
  const key = `garage-${baseColor}`;
  if (cache.has(key)) return cache.get(key);
  const W = 64, H = 64;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  for (let x = 4; x < W; x += 8) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let i = 0; i < 25; i++) {
    ctx.fillStyle = `rgba(130,70,35,${0.06 + Math.random() * 0.16})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 2 + Math.random() * 10);
  }
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/**
 * Карта свечения окон: чёрный фон, часть окон «горит».
 * Координаты совпадают с фасадными текстурами, поэтому свет попадает в окна.
 */
export function facadeLights(kind) {
  const key = `lights-${kind}`;
  if (cache.has(key)) return cache.get(key);

  const sizes = { panel: [256, 256], tower: [256, 256], odekolon: [256, 256], khrushchevka: [256, 256], series125: [256, 256], stalinka: [256, 256], admin: [256, 256], church: [256, 256], factory: [256, 128], private: [128, 128], garage: [64, 64] };
  const [W, H] = sizes[kind] || [256, 256];
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const warm = () => {
    const r = Math.random();
    if (r < 0.55) return '#ffd98a';
    if (r < 0.8) return '#ffefc4';
    if (r < 0.92) return '#bfe0ff';
    return '#8fd1ff';
  };
  const lit = (x, y, w, h, chance = 0.45) => {
    if (Math.random() > chance) return;
    ctx.fillStyle = warm();
    ctx.fillRect(x, y, w, h);
  };

  if (kind === 'panel' || kind === 'tower') {
    const floorH = H / 2;
    for (let f = 0; f < 2; f++) {
      const y0 = f * floorH;
      const winY = y0 + floorH * 0.22;
      const winH = floorH * 0.42;
      for (const fx of [0.06, 0.26, 0.56, 0.76]) lit(W * fx, winY, W * 0.16, winH, 0.5);
      lit(W * 0.44, winY, W * 0.1, winH, 0.3);
    }
  } else if (kind === 'stalinka' || kind === 'admin' || kind === 'church') {
    for (let f = 0; f < 2; f++) {
      const y0 = f * (H / 2);
      for (let i = 0; i < 3; i++) lit(W * (0.1 + i * 0.3), y0 + H * 0.09, W * 0.16, H * 0.26, 0.45);
    }
  } else if (kind === 'odekolon') {
    for (let f = 0; f < 2; f++) {
      const y0 = f * (H / 2);
      for (let i = 0; i < 3; i++) lit(W * (0.07 + i * 0.13), y0 + H * 0.11, W * 0.09, H * 0.23, 0.5);
      lit(W * 0.62, y0 + H * 0.11, W * 0.14, H * 0.23, 0.35);
    }
  } else if (kind === 'flemish') {
    for (const wx of [W * 0.14, W * 0.58]) lit(wx, H * 0.16, W * 0.28, H * 0.56, 0.55);
  } else if (kind === 'clockTower') {
    for (const wx of [W * 0.2, W * 0.6]) lit(wx, H * 0.2, W * 0.2, H * 0.3, 0.5);
  } else if (kind === 'factory') {
    for (let x = 0; x < W; x += 32) lit(x + 2, H * 0.24, 28, H * 0.3, 0.3);
  } else if (kind === 'private') {
    lit(W * 0.18, H * 0.3, W * 0.24, H * 0.3, 0.6);
    lit(W * 0.58, H * 0.3, W * 0.24, H * 0.3, 0.6);
  }

  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/** Асфальт с разметкой. type: 'road' | 'plain' */
export function asphalt(withDashes = true) {
  const key = `asphalt-${withDashes}`;
  if (cache.has(key)) return cache.get(key);
  const W = 256, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#54575b';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${100 + Math.random() * 60},${100 + Math.random() * 60},${100 + Math.random() * 60},${Math.random() * 0.14})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  // Заплатки и трещины — куда без них.
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = 'rgba(20,20,22,0.5)';
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    let x = Math.random() * W, y = Math.random() * H;
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (Math.random() - 0.5) * 40;
      y += (Math.random() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = 'rgba(40,41,44,0.28)';
    ctx.beginPath();
    ctx.ellipse(Math.random() * W, Math.random() * H, 4 + Math.random() * 9, 3 + Math.random() * 6, Math.random(), 0, Math.PI * 2);
    ctx.fill();
  }
  if (withDashes) {
    ctx.fillStyle = 'rgba(235,230,215,0.75)';
    for (let y = 0; y < H; y += 64) {
      ctx.fillRect(W / 2 - 3, y + 8, 6, 40);
    }
  }
  const tex = toTexture(c, 1, 1, 8);
  cache.set(key, tex);
  return tex;
}

/** Тротуарная плитка / бетон. */
export function sidewalkTex() {
  if (cache.has('sidewalk')) return cache.get('sidewalk');
  const W = 128, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#a3a099';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(W, i * 32); ctx.stroke();
  }
  noise(ctx, W, H, 26);
  const tex = toTexture(c, 1, 1, 8);
  cache.set('sidewalk', tex);
  return tex;
}

/** Земля/газон двора. */
export function groundTex() {
  if (cache.has('ground')) return cache.get('ground');
  const W = 256, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5c6b45';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) {
    const g = Math.random();
    ctx.fillStyle = g < 0.5
      ? `rgba(${70 + Math.random() * 40},${90 + Math.random() * 50},${45 + Math.random() * 30},0.6)`
      : `rgba(${110 + Math.random() * 40},${100 + Math.random() * 30},${70 + Math.random() * 30},0.35)`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 3, 3);
  }
  // Протоптанные дорожки.
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = 'rgba(120,105,80,0.3)';
    ctx.lineWidth = 6 + Math.random() * 8;
    ctx.beginPath();
    ctx.moveTo(Math.random() * W, 0);
    ctx.bezierCurveTo(Math.random() * W, H / 3, Math.random() * W, (H * 2) / 3, Math.random() * W, H);
    ctx.stroke();
  }
  const tex = toTexture(c, 1, 1, 8);
  cache.set('ground', tex);
  return tex;
}

/** Вывеска магазина. Кэшируется по тексту. */
export function signTexture(text, accent = '#d92b2b') {
  const key = `sign-${text}-${accent}`;
  if (cache.has(key)) return cache.get(key);
  const W = 512, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, H - 10, W, 10);
  ctx.font = 'bold 62px "Arial Narrow", Arial, sans-serif';
  ctx.fillStyle = '#fff8e8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Номерной знак / общий текстовый спрайт. */
export function labelTexture(text, opts = {}) {
  const { bg = 'rgba(12,14,18,0.72)', fg = '#f2f5f7', size = 44, pad = 14 } = opts;
  const c = canvas(512, 128);
  const ctx = c.getContext('2d');
  ctx.font = `600 ${size}px "Segoe UI", Roboto, Arial, sans-serif`;
  const w = Math.min(512, ctx.measureText(text).width + pad * 2);
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = bg;
  const x0 = (512 - w) / 2;
  ctx.beginPath();
  const r = 16;
  ctx.moveTo(x0 + r, 30);
  ctx.arcTo(x0 + w, 30, x0 + w, 98, r);
  ctx.arcTo(x0 + w, 98, x0, 98, r);
  ctx.arcTo(x0, 98, x0, 30, r);
  ctx.arcTo(x0, 30, x0 + w, 30, r);
  ctx.closePath();
  ctx.fill();
  ctx.font = `600 ${size}px "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Карта нормалей из готовой canvas-текстуры (оператор Собеля по яркости).
 * Даёт объём оконным рамам, швам панелей и зерну асфальта без ручных карт.
 */
export function normalFromTexture(tex, strength = 1.6) {
  const src = tex.image;
  if (!src) return null;
  const key = `normal-${src.width}x${src.height}-${strength}-${tex.uuid}`;
  if (cache.has(key)) return cache.get(key);

  const W = src.width;
  const H = src.height;
  const read = canvas(W, H).getContext('2d', { willReadFrequently: true });
  read.drawImage(src, 0, 0);
  const px = read.getImageData(0, 0, W, H).data;

  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    lum[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
  }
  const at = (x, y) => lum[((y + H) % H) * W + ((x + W) % W)];

  const out = canvas(W, H);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
        - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
        - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      const nx = dx * strength;
      const ny = dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * W + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const normal = new THREE.CanvasTexture(out);
  normal.wrapS = THREE.RepeatWrapping;
  normal.wrapT = THREE.RepeatWrapping;
  normal.repeat.copy(tex.repeat);
  cache.set(key, normal);
  return normal;
}

/** Крона для билбордов: полупрозрачные листья кистью. */
export function foliageTexture(tint = '#4f6b35') {
  const key = `foliage-${tint}`;
  if (cache.has(key)) return cache.get(key);
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  const base = new THREE.Color(tint);
  for (let i = 0; i < 420; i++) {
    // Плотнее к центру — получается силуэт кроны, а не квадрат.
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.6) * S * 0.46;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r * 0.92;
    const shade = 0.55 + Math.random() * 0.6;
    const col = base.clone().multiplyScalar(shade);
    ctx.globalAlpha = 0.55 + Math.random() * 0.45;
    ctx.fillStyle = col.getStyle();
    ctx.beginPath();
    const rad = 6 + Math.random() * 16;
    ctx.ellipse(x, y, rad, rad * (0.5 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Веточки внутри кроны.
  ctx.strokeStyle = 'rgba(60,45,30,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(S / 2, S * 0.9);
    ctx.quadraticCurveTo(S / 2 + (Math.random() - 0.5) * 60, S * 0.6, S / 2 + (Math.random() - 0.5) * 150, S * (0.25 + Math.random() * 0.4));
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/**
 * Лицо персонажа: глаза, брови, нос и рот на прозрачном фоне.
 * Клеится плоскостью на переднюю грань головы.
 */
export function faceTexture(skinColor = '#d9a17a', beard = false) {
  const key = `face-${skinColor}-${beard}`;
  if (cache.has(key)) return cache.get(key);
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  // Лёгкая тень по краям — лицо перестаёт быть плоской наклейкой.
  const g = ctx.createRadialGradient(S / 2, S * 0.5, S * 0.15, S / 2, S * 0.5, S * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(60,40,30,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // Брови.
  ctx.fillStyle = 'rgba(45,32,24,0.9)';
  ctx.fillRect(S * 0.2, S * 0.34, S * 0.22, S * 0.05);
  ctx.fillRect(S * 0.58, S * 0.34, S * 0.22, S * 0.05);

  // Глаза: белок, радужка, зрачок.
  for (const ex of [S * 0.24, S * 0.62]) {
    ctx.fillStyle = '#f2efe8';
    ctx.fillRect(ex, S * 0.43, S * 0.14, S * 0.09);
    ctx.fillStyle = '#3a5a72';
    ctx.fillRect(ex + S * 0.04, S * 0.44, S * 0.06, S * 0.07);
    ctx.fillStyle = '#15181c';
    ctx.fillRect(ex + S * 0.055, S * 0.45, S * 0.03, S * 0.05);
  }

  // Нос — только тень сбоку, без геометрии.
  ctx.fillStyle = 'rgba(90,60,45,0.28)';
  ctx.fillRect(S * 0.47, S * 0.5, S * 0.06, S * 0.14);

  // Рот.
  ctx.fillStyle = 'rgba(120,70,60,0.85)';
  ctx.fillRect(S * 0.38, S * 0.72, S * 0.24, S * 0.035);

  if (beard) {
    ctx.fillStyle = 'rgba(50,38,28,0.5)';
    ctx.fillRect(S * 0.24, S * 0.62, S * 0.52, S * 0.3);
    ctx.clearRect(S * 0.38, S * 0.7, S * 0.24, S * 0.06);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/**
 * Куртка: молния, воротник, карманы и складки. Клеится на торс,
 * поэтому рисуется бесшовной по горизонтали.
 */
export function clothTexture(baseColor = 0x2a2320, kind = 'jacket') {
  const key = `cloth-${baseColor}-${kind}`;
  if (cache.has(key)) return cache.get(key);
  const W = 128, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const base = new THREE.Color(baseColor);
  ctx.fillStyle = hex(baseColor);
  ctx.fillRect(0, 0, W, H);

  // Ткань: мелкие пятна освещённости.
  for (let i = 0; i < 300; i++) {
    const col = base.clone().multiplyScalar(0.85 + Math.random() * 0.3);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = col.getStyle();
    ctx.fillRect(Math.random() * W, Math.random() * H, 3, 3);
  }
  ctx.globalAlpha = 1;

  if (kind === 'jacket') {
    // Молния по центру и воротник.
    ctx.fillStyle = 'rgba(20,20,22,0.85)';
    ctx.fillRect(W / 2 - 2, 0, 4, H);
    ctx.fillStyle = 'rgba(200,200,205,0.5)';
    for (let y = 4; y < H; y += 6) ctx.fillRect(W / 2 - 1, y, 2, 3);
    ctx.fillStyle = base.clone().multiplyScalar(0.75).getStyle();
    ctx.fillRect(0, 0, W, H * 0.12);
    // Карманы.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(W * 0.16, H * 0.62, W * 0.2, 3);
    ctx.fillRect(W * 0.64, H * 0.62, W * 0.2, 3);
  } else if (kind === 'pants') {
    // Боковой шов и складки у колена.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(W * 0.12, 0, 2, H);
    ctx.fillRect(W * 0.88, 0, 2, H);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`;
      ctx.fillRect(0, H * (0.5 + i * 0.07), W, 2);
    }
  }

  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/**
 * Кубическая карта окружения для отражений в кузове: небо сверху,
 * асфальт снизу, полоса горизонта по бокам. Шести canvas-граней хватает —
 * в кузове читается небо и линия горизонта, а это и создаёт «мокрый» лак.
 */
export function skyCube() {
  if (cache.has('skycube')) return cache.get('skycube');
  const S = 64;

  const face = (draw) => {
    const c = canvas(S, S);
    draw(c.getContext('2d'), S);
    return c;
  };

  const side = face((ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#8fb4d8');
    g.addColorStop(0.48, '#cfdae4');
    g.addColorStop(0.52, '#8e8b82');
    g.addColorStop(1, '#5d5c57');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const top = face((ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 1.4);
    g.addColorStop(0, '#a9c9e8');
    g.addColorStop(1, '#6f9ccb');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const bottom = face((ctx, s) => {
    ctx.fillStyle = '#4a4945';
    ctx.fillRect(0, 0, s, s);
  });

  // Порядок граней: +X, -X, +Y, -Y, +Z, -Z.
  const tex = new THREE.CubeTexture([side, side, top, bottom, side, side]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set('skycube', tex);
  return tex;
}

/**
 * Мягкое пятно под объектом. Настоящая тень от солнца уходит вбок и
 * при низком солнце пропадает совсем, из-за чего машины и люди начинают
 * «висеть» над асфальтом — это пятно держит их на земле всегда.
 */
export function blobShadow() {
  if (cache.has('blob')) return cache.get('blob');
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  cache.set('blob', tex);
  return tex;
}

/** Циферблат башни: римские деления и стрелки. */
export function clockFace() {
  if (cache.has('clock')) return cache.get('clock');
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const R = S / 2;

  ctx.fillStyle = '#f4efe2';
  ctx.beginPath();
  ctx.arc(R, R, R - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2f3a44';
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.strokeStyle = '#2f3a44';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const long = i % 3 === 0;
    ctx.lineWidth = long ? 8 : 4;
    ctx.beginPath();
    ctx.moveTo(R + Math.cos(a) * (R - 18), R + Math.sin(a) * (R - 18));
    ctx.lineTo(R + Math.cos(a) * (R - (long ? 42 : 30)), R + Math.sin(a) * (R - (long ? 42 : 30)));
    ctx.stroke();
  }

  // Стрелки на «десять часов десять минут» — так циферблат читается лучше.
  ctx.lineCap = 'round';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(R, R);
  ctx.lineTo(R + Math.cos(-Math.PI * 0.83) * R * 0.5, R + Math.sin(-Math.PI * 0.83) * R * 0.5);
  ctx.stroke();
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(R, R);
  ctx.lineTo(R + Math.cos(-Math.PI * 0.17) * R * 0.7, R + Math.sin(-Math.PI * 0.17) * R * 0.7);
  ctx.stroke();
  ctx.fillStyle = '#2f3a44';
  ctx.beginPath();
  ctx.arc(R, R, 9, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('clock', tex);
  return tex;
}

/** Небо: вертикальный градиент средней полосы. */
export function skyTexture(night = false) {
  const c = canvas(2, 256);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  if (night) {
    g.addColorStop(0, '#0b1020');
    g.addColorStop(0.55, '#1b2740');
    g.addColorStop(1, '#3a4256');
  } else {
    g.addColorStop(0, '#7fa3c8');
    g.addColorStop(0.5, '#b9c9d6');
    g.addColorStop(1, '#d8d5c8');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
