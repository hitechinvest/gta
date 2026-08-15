// Ввод: клавиатура, мышь с захватом указателя, сенсорные джойстики.
// Коды клавиш не зависят от раскладки (KeyW работает и на «Ц»).

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.buttons = { left: false, right: false };
    this.touch = { moveX: 0, moveY: 0, fire: false, jump: false, enter: false, brake: false, aim: false };
    this.enabled = true;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.onKeyExtra = null;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.repeat) {
        this.keys.add(e.code);
        return;
      }
      this.keys.add(e.code);
      if (this.onKeyExtra) this.onKeyExtra(e);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.buttons.left = true;
      if (e.button === 2) this.buttons.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.buttons.left = false;
      if (e.button === 2) this.buttons.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    document.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.buttons.left = false;
        this.buttons.right = false;
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    this.setupTouch();
  }

  requestLock() {
    if (this.isTouch()) return;
    this.canvas.requestPointerLock?.();
  }

  isTouch() {
    return window.matchMedia('(pointer: coarse)').matches;
  }

  down(code) {
    return this.keys.has(code);
  }

  /** Забрать накопленное движение мыши (или свайпа) и обнулить. */
  takeLook() {
    const dx = this.mouseDX * this.sensitivity;
    const dy = this.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Вектор движения: -1..1 по осям (вперёд = y). */
  moveVector() {
    let x = 0;
    let y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    x += this.touch.moveX;
    y += this.touch.moveY;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  get firing() {
    return this.buttons.left || this.touch.fire;
  }

  get aiming() {
    return this.buttons.right || this.touch.aim;
  }

  get sprinting() {
    return this.down('ShiftLeft') || this.down('ShiftRight');
  }

  get jumping() {
    return this.down('Space') || this.touch.jump;
  }

  get braking() {
    return this.down('Space') || this.touch.brake;
  }

  // --- мобильные органы управления -----------------------------------------

  setupTouch() {
    const stick = document.getElementById('touch-stick');
    const knob = document.getElementById('touch-knob');
    const lookZone = document.getElementById('touch-look');
    if (!stick || !lookZone) return;

    if (this.isTouch()) document.body.classList.add('is-touch');

    let stickId = null;
    const center = { x: 0, y: 0 };
    const R = 52;

    const startStick = (e) => {
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const rect = stick.getBoundingClientRect();
      center.x = rect.left + rect.width / 2;
      center.y = rect.top + rect.height / 2;
      e.preventDefault();
    };
    const moveStick = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        let dx = t.clientX - center.x;
        let dy = t.clientY - center.y;
        const len = Math.hypot(dx, dy) || 1;
        const clamped = Math.min(len, R);
        dx = (dx / len) * clamped;
        dy = (dy / len) * clamped;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.touch.moveX = dx / R;
        this.touch.moveY = -dy / R;
      }
      e.preventDefault();
    };
    const endStick = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        stickId = null;
        knob.style.transform = 'translate(0,0)';
        this.touch.moveX = 0;
        this.touch.moveY = 0;
      }
    };
    stick.addEventListener('touchstart', startStick, { passive: false });
    stick.addEventListener('touchmove', moveStick, { passive: false });
    stick.addEventListener('touchend', endStick);
    stick.addEventListener('touchcancel', endStick);

    let lookId = null;
    let lastX = 0;
    let lastY = 0;
    lookZone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      lookId = t.identifier;
      lastX = t.clientX;
      lastY = t.clientY;
      e.preventDefault();
    }, { passive: false });
    lookZone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        this.mouseDX += (t.clientX - lastX) * 1.6;
        this.mouseDY += (t.clientY - lastY) * 1.6;
        lastX = t.clientX;
        lastY = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const endLook = () => { lookId = null; };
    lookZone.addEventListener('touchend', endLook);
    lookZone.addEventListener('touchcancel', endLook);

    const bindButton = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { this.touch[key] = true; e.preventDefault(); }, { passive: false });
      el.addEventListener('touchend', () => { this.touch[key] = false; });
      el.addEventListener('touchcancel', () => { this.touch[key] = false; });
    };
    bindButton('btn-fire', 'fire');
    bindButton('btn-jump', 'jump');
    bindButton('btn-brake', 'brake');
    bindButton('btn-aim', 'aim');

    const enterBtn = document.getElementById('btn-enter');
    if (enterBtn) {
      enterBtn.addEventListener('touchstart', (e) => {
        this.touch.enter = true;
        e.preventDefault();
      }, { passive: false });
      enterBtn.addEventListener('touchend', () => { this.touch.enter = false; });
    }
  }

  /** Однократное действие «сесть/выйти». */
  consumeEnter() {
    if (this.touch.enter) {
      this.touch.enter = false;
      return true;
    }
    return false;
  }
}
