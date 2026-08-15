// HTTP + WebSocket сервер мини-GTA.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { NET } from '../shared/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Клиент грузит three.js со своего же origin. Если файлов нет
// (ставили с --ignore-scripts), копируем их прямо сейчас.
ensureVendorFiles();

function ensureVendorFiles() {
  const pp = ['EffectComposer', 'RenderPass', 'ShaderPass', 'MaskPass', 'UnrealBloomPass', 'OutputPass', 'Pass'];
  const shaders = ['CopyShader', 'LuminosityHighPassShader', 'OutputShader', 'FXAAShader'];
  const pairs = [
    ['node_modules/three/build/three.module.js', 'public/vendor/three.module.js'],
    ['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'public/vendor/BufferGeometryUtils.js'],
    ...pp.map((n) => [`node_modules/three/examples/jsm/postprocessing/${n}.js`, `public/vendor/postprocessing/${n}.js`]),
    ...shaders.map((n) => [`node_modules/three/examples/jsm/shaders/${n}.js`, `public/vendor/shaders/${n}.js`]),
  ];
  for (const dir of ['public/vendor', 'public/vendor/postprocessing', 'public/vendor/shaders']) {
    fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
  }
  for (const [from, to] of pairs) {
    const dest = path.join(ROOT, to);
    if (fs.existsSync(dest)) continue;
    const src = path.join(ROOT, from);
    if (!fs.existsSync(src)) {
      console.error(`[vendor] нет ${from} — выполните "npm install"`);
      continue;
    }
    fs.copyFileSync(src, dest);
    console.log(`[vendor] ${to} подготовлен`);
  }
}
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SEED = process.env.SEED ? Number(process.env.SEED) : 20250815;

const app = express();
app.disable('x-powered-by');

app.use(express.static(path.join(ROOT, 'public'), {
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
// Общий код правил мира доступен клиенту как обычные ES-модули.
app.use('/shared', express.static(path.join(ROOT, 'shared'), { maxAge: '1h' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const room = new Room(SEED);

app.get('/api/status', (req, res) => {
  res.json({ ok: true, ...room.stats() });
});

wss.on('connection', (ws, req) => {
  const client = room.addClient(ws);
  client.ip = req.socket.remoteAddress;
  let alive = true;

  ws.on('message', (data) => {
    if (data.length > 16 * 1024) return;
    room.onMessage(client, data.toString());
  });

  ws.on('pong', () => { alive = true; });
  ws.on('close', () => {
    clearInterval(heartbeat);
    room.removeClient(client);
  });
  ws.on('error', () => {
    clearInterval(heartbeat);
    room.removeClient(client);
  });

  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    try { ws.ping(); } catch { /* сокет закрыт */ }
  }, 15000);
});

const tickMs = Math.round(1000 / NET.TICK_HZ);
const loop = setInterval(() => {
  try {
    room.tick();
  } catch (err) {
    console.error('[tick]', err);
  }
}, tickMs);

server.listen(PORT, HOST, () => {
  console.log(`ГТА-мини запущена: http://localhost:${PORT}  (seed=${room.seed}, tick=${NET.TICK_HZ}Гц)`);
});

function shutdown() {
  clearInterval(loop);
  wss.clients.forEach((c) => c.close(1001, 'server shutdown'));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
