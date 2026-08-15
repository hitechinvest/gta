// Тонкая обёртка над WebSocket: очередь до подключения, подписки на типы,
// автопереподключение и замер пинга.

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.queue = [];
    this.id = null;
    this.ping = 0;
    this.connected = false;
    this.pingSeq = 0;
    this.pingTimer = null;
    this.reconnectAttempt = 0;
    this.intentional = false;
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url());
      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempt = 0;
        for (const msg of this.queue) ws.send(msg);
        this.queue.length = 0;
        this.pingTimer = setInterval(() => {
          this.pingSeq += 1;
          this.sentAt = performance.now();
          this.send({ t: 'ping', c: this.pingSeq });
        }, 2000);
        settled = true;
        resolve();
      };

      ws.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.t === 'pong') {
          this.ping = Math.round(performance.now() - this.sentAt);
          return;
        }
        if (m.t === 'init') this.id = m.id;
        this.emit(m.t, m);
      };

      ws.onclose = () => {
        this.connected = false;
        clearInterval(this.pingTimer);
        this.emit('disconnect', {});
        if (!settled) reject(new Error('Не удалось подключиться к серверу'));
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Ошибка соединения'));
        }
      };
    });
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  emit(type, payload) {
    const list = this.handlers.get(type);
    if (!list) return;
    for (const fn of list) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[net:${type}]`, err);
      }
    }
  }

  send(obj) {
    const raw = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === 1) this.ws.send(raw);
    else if (this.queue.length < 60) this.queue.push(raw);
  }

  close() {
    this.intentional = true;
    clearInterval(this.pingTimer);
    if (this.ws) this.ws.close();
  }
}
