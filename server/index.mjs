/**
 * 且坐 · 同修服务器
 *
 * 一个进程干两件事：
 *  1) WebSocket（/ws）—— 同一间法堂里的玩家：位置、姿态、坐垫占用、木鱼/念珠事件
 *  2) 静态托管 dist/ —— 生产环境直接 http://<IP>:8787/ 打开就是完整应用
 *
 * 开发时只跑这个（ws 在 8787），前端仍由 vite(5174) 代理 /ws 过来。
 *
 * 设计取向：这是一个"坐在一起"的休闲场景，不做物理权威；
 * 服务端只做轻校验（范围、枚举、速率），避免有人发疯把别人甩出地图。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createFortuneBox } from './fortune.mjs';
import { createWeatherBox } from './weather.mjs';

const PORT = Number(process.env.PORT || 8787);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');

/** 快照频率（ms）：66 ≈ 15Hz，休闲场景够了 */
const TICK_MS = 66;
/** 一间法堂最多几个人 */
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 12);
/** 场景边界，超出就夹住 */
const LIMIT = 60;
/** 每个连接每秒最多处理多少条消息 */
const MSG_PER_SEC = 40;

const POSES = new Set(['idle', 'walk', 'sit', 'bow', 'anjali', 'bead', 'incense']);
const EVENTS = new Set(['fish', 'bead', 'round', 'anjali', 'incense']);

// ————————————————————————————— 状态

/** id -> player */
const players = new Map();
/** seatIndex -> id */
const seats = new Map();
let nextId = 1;

const clamp = (v, lo = -LIMIT, hi = LIMIT) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;

const safeName = (raw) => {
  const s = String(raw ?? '')
    .replace(/[<>&\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 12);
  return s || '无名';
};

// ————————————————————————————— 静态文件

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  // 佛乐：m4a 是 afconvert 出来的 AAC，mp3 留给直接丢进来的原文件
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.mp3': 'audio/mpeg',
};

/**
 * 媒体元素会带着 `Range: bytes=0-` 来要音频。没有 206 + Content-Range，
 * 浏览器就只能整段下载、也拖不动进度，半小时的《大悲咒》尤其吃亏。
 * 语法不合法的 Range 一律当没看见（回 200 整段）。
 */
function parseRange(header, size) {
  if (typeof header !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  let start;
  let end;
  if (a === '') {
    // 后缀式 bytes=-N：最后 N 个字节
    const n = Number(b);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end };
}

function serveStatic(req, res) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      '且坐 · 同修服务器已启动（WebSocket 在 /ws）\n\n' +
        '还没有构建前端。开发用 vite 打开，或先构建：\n\n' +
        '  npm run build && npm run serve\n\n',
    );
    return;
  }

  const url = new URL(req.url || '/', 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DIST, rel);

  // 防目录穿越
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // 单页应用：未知路径回 index.html
      fs.readFile(path.join(DIST, 'index.html'), (e2, html) => {
        if (e2) res.writeHead(404).end('not found');
        else {
          res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
          res.end(html);
        }
      });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const size = st.size;
    // 佛乐是整段录音、内容不会变：和 assets 一样长缓存，别每次进站重下几十兆
    const immutable = rel.startsWith('/assets/') || rel.startsWith('/audio/');
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Accept-Ranges': 'bytes',
      'Last-Modified': st.mtime.toUTCString(),
    };

    const range = parseRange(req.headers.range, size);
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      headers['Content-Length'] = String(range.end - range.start + 1);
      res.writeHead(206, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start: range.start, end: range.end })
        .on('error', () => res.destroy())
        .pipe(res);
      return;
    }

    headers['Content-Length'] = String(size);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  });
}

/** 签筒：POST /api/fortune（同一天同一设备只出一支签） */
const fortune = createFortuneBox({
  root: ROOT,
  trustProxy: process.env.TRUST_PROXY === '1',
  log: (m) => console.info(m),
});
if (!fortune.writable) console.warn(`[fortune] ${fortune.dataDir} 不可写：抽签照常，只是不留记录`);

/** 天气：GET /api/weather（北京，缓存 10 分钟，断网时退回上一次/晴天） */
const weather = createWeatherBox({ log: (m) => console.info(m) });

const httpServer = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: players.size, seats: seats.size }));
    return;
  }
  if (weather.handle(req, res, process.env.TRUST_PROXY === '1')) return;
  if (fortune.handle(req, res)) return;
  // 未知接口不再落到静态页（SPA 兜底只服务页面）
  if (new URL(req.url || '/', 'http://x').pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('{"ok":false,"code":"not_found"}');
    return;
  }
  serveStatic(req, res);
});

// ————————————————————————————— WebSocket

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 8 * 1024 });

const send = (ws, obj) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};

function broadcast(obj, except = null) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) {
    if (p.id === except) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(s);
  }
}

const publicInfo = (p) => ({
  id: p.id,
  name: p.name,
  robe: p.robe,
  x: +p.x.toFixed(2),
  z: +p.z.toFixed(2),
  r: +p.r.toFixed(3),
  pose: p.pose,
  seat: p.seat,
});

const seatPairs = () => [...seats.entries()].map(([seat, id]) => [seat, id]);

function releaseSeat(p) {
  if (p.seat === null) return false;
  if (seats.get(p.seat) === p.id) seats.delete(p.seat);
  p.seat = null;
  return true;
}

wss.on('connection', (ws) => {
  /** 这条连接自己的玩家对象，hello 之后才有 id */
  const p = {
    id: '',
    name: '',
    robe: 0x6b4a35,
    x: 0,
    z: 20.5,
    r: Math.PI,
    pose: 'idle',
    seat: null,
    ws,
    alive: true,
    bucket: 0,
    bucketAt: 0,
  };

  ws.on('pong', () => {
    p.alive = true;
  });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;

    // 简单的令牌桶，挡住刷屏
    const now = Date.now();
    if (now - p.bucketAt > 1000) {
      p.bucketAt = now;
      p.bucket = 0;
    }
    if (++p.bucket > MSG_PER_SEC) return;

    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.t) {
      case 'hello': {
        if (players.size >= MAX_PLAYERS) {
          send(ws, { t: 'full' });
          ws.close(4001, 'full');
          return;
        }
        // token 就是上次的 id：重连沿用，别人看到的是同一个人回来了
        const wantId = typeof msg.token === 'string' ? msg.token : '';
        p.id = wantId && !players.has(wantId) ? wantId : `p${nextId++}`;
        p.name = safeName(msg.name);
        p.robe = Number.isFinite(msg.robe) ? Math.floor(msg.robe) : 0x6b4a35;
        players.set(p.id, p);

        send(ws, {
          t: 'welcome',
          id: p.id,
          now: now,
          seats: seatPairs(),
          players: [...players.values()].filter((o) => o.id !== p.id).map(publicInfo),
        });
        broadcast({ t: 'join', p: publicInfo(p) }, p.id);
        broadcast({ t: 'online', n: players.size });
        console.info(`[net] ${p.name} 连线 (${players.size} 人在场)`);
        break;
      }

      case 'm': {
        if (!players.has(p.id)) return;
        p.x = clamp(msg.x);
        p.z = clamp(msg.z);
        p.r = Number.isFinite(msg.r) ? msg.r : p.r;
        p.pose = POSES.has(msg.pose) ? msg.pose : 'idle';
        break;
      }

      case 'seat': {
        if (!players.has(p.id)) return;
        const seat = Number.isInteger(msg.seat) ? msg.seat : null;
        if (seat === null) {
          if (releaseSeat(p)) broadcast({ t: 'seats', seats: seatPairs() });
          send(ws, { t: 'seatres', seat: null, ok: true });
          return;
        }
        if (seat < 0 || seat > 63) return;
        const owner = seats.get(seat);
        if (owner && owner !== p.id) {
          const other = players.get(owner);
          send(ws, { t: 'seatres', seat, ok: false, by: other?.name ?? '' });
          return;
        }
        releaseSeat(p);
        seats.set(seat, p.id);
        p.seat = seat;
        send(ws, { t: 'seatres', seat, ok: true });
        broadcast({ t: 'seats', seats: seatPairs() });
        break;
      }

      case 'ev': {
        if (!players.has(p.id)) return;
        const k = String(msg.k || '');
        if (!EVENTS.has(k)) return;
        broadcast({ t: 'ev', id: p.id, k }, p.id);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (!players.has(p.id)) return;
    players.delete(p.id);
    releaseSeat(p);
    broadcast({ t: 'leave', id: p.id });
    broadcast({ t: 'seats', seats: seatPairs() });
    broadcast({ t: 'online', n: players.size });
    console.info(`[net] ${p.name} 离开 (${players.size} 人在场)`);
  });
});

// 快照：统一节奏发，收到什么都先不转发，避免一条消息广播 N 次
setInterval(() => {
  if (!players.size) return;
  const ps = [];
  for (const p of players.values()) {
    ps.push([p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.r.toFixed(2), p.pose, p.seat]);
  }
  broadcast({ t: 'snap', now: Date.now(), ps });
}, TICK_MS);

// 心跳：20 秒，两次没回就断
setInterval(() => {
  for (const p of players.values()) {
    if (!p.alive) {
      p.ws.terminate();
      continue;
    }
    p.alive = false;
    try {
      p.ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 20_000);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.info(`且坐 · 同修服务器 http://0.0.0.0:${PORT}  (ws: /ws)`);
  if (fs.existsSync(path.join(DIST, 'index.html'))) {
    console.info(`静态站点: ${DIST}`);
  } else {
    console.info('未发现 dist/ — 开发模式请用 vite，构建后此端口可直接访问');
  }
});
