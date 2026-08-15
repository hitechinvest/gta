// Звук целиком синтезируется через WebAudio: выстрелы, мотор, сирена,
// удары, взрывы, шаги. Никаких файлов — стартует по первому клику.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.engines = new Map();
    this.noiseBuffer = null;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    if (this.master) this.master.gain.value = v;
  }

  gainFor(distance = 0) {
    return Math.max(0, 1 - distance / 90) ** 2;
  }

  noise(duration, gain, filterType = 'bandpass', freq = 1200, q = 1) {
    if (!this.ctx || gain <= 0.001) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  tone(freq, duration, gain, type = 'sine', slideTo = null) {
    if (!this.ctx || gain <= 0.001) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    const t = this.ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  shot(weapon = 'pm', distance = 0) {
    if (!this.enabled) return;
    this.init();
    const g = this.gainFor(distance);
    if (g < 0.01) return;
    switch (weapon) {
      case 'ak':
        this.noise(0.16, 0.5 * g, 'bandpass', 900, 0.7);
        this.tone(160, 0.12, 0.3 * g, 'square', 60);
        break;
      case 'obrez':
        this.noise(0.35, 0.6 * g, 'lowpass', 700, 0.6);
        this.tone(90, 0.25, 0.35 * g, 'sawtooth', 40);
        break;
      case 'fists':
        this.noise(0.08, 0.25 * g, 'lowpass', 400);
        break;
      default:
        this.noise(0.12, 0.42 * g, 'bandpass', 1400, 0.8);
        this.tone(220, 0.09, 0.22 * g, 'square', 80);
    }
  }

  hit(distance = 0, kind = 'flesh') {
    this.init();
    const g = this.gainFor(distance);
    if (kind === 'metal') this.noise(0.1, 0.3 * g, 'bandpass', 2600, 3);
    else this.noise(0.12, 0.35 * g, 'lowpass', 500, 1);
  }

  explosion(distance = 0) {
    this.init();
    const g = this.gainFor(distance) * 1.6;
    this.noise(1.1, 0.8 * g, 'lowpass', 420, 0.7);
    this.tone(70, 0.8, 0.5 * g, 'sawtooth', 24);
  }

  pickup() {
    this.init();
    this.tone(660, 0.09, 0.16, 'square');
    setTimeout(() => this.tone(990, 0.12, 0.14, 'square'), 70);
  }

  hurt() {
    this.init();
    this.noise(0.18, 0.2, 'lowpass', 320);
    this.tone(140, 0.2, 0.12, 'sawtooth', 90);
  }

  step(distance = 0) {
    this.init();
    this.noise(0.06, 0.09 * this.gainFor(distance), 'bandpass', 240, 1.2);
  }

  reload() {
    this.init();
    this.noise(0.06, 0.14, 'bandpass', 2200, 4);
    setTimeout(() => this.noise(0.05, 0.12, 'bandpass', 1400, 4), 140);
  }

  /** Мотор: пилообразный тон + шум, частота от оборотов. */
  engine(id) {
    this.init();
    if (!this.ctx) return null;
    if (this.engines.has(id)) return this.engines.get(id);

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const sub = this.ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 30;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain).connect(this.master);
    osc.start();
    sub.start();

    const handle = {
      set(rpm, volume) {
        const f = 42 + rpm * 130;
        osc.frequency.setTargetAtTime(f, this.ctxTime(), 0.05);
        sub.frequency.setTargetAtTime(f / 2, this.ctxTime(), 0.05);
        filter.frequency.setTargetAtTime(500 + rpm * 1800, this.ctxTime(), 0.08);
        gain.gain.setTargetAtTime(Math.max(0, Math.min(0.28, volume)), this.ctxTime(), 0.08);
      },
      ctxTime: () => this.ctx.currentTime,
      stop: () => {
        gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        setTimeout(() => {
          try { osc.stop(); sub.stop(); } catch { /* уже остановлен */ }
        }, 400);
        this.engines.delete(id);
      },
    };
    this.engines.set(id, handle);
    return handle;
  }

  /** Сирена ДПС: две чередующиеся ноты. */
  siren(distance) {
    this.init();
    const g = this.gainFor(distance) * 0.5;
    if (g < 0.02) return;
    this.tone(760, 0.32, g * 0.28, 'square', 1180);
  }
}

export const sfx = new Sfx();
