/**
 * 签筒用的底层小工具：落盘、加盐哈希、日期口径、HTTP 小工具。
 *
 * 取向和 server/index.mjs 一致：单进程、低频、只追加，不引数据库。
 * 所有写操作都是同步的 —— Node 单线程 + 同步写，检查配额和写入之间插不进别的请求。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 数据目录：DATA_DIR > FEEDBACK_DIR（历史名，兼容旧部署）> <仓库>/data */
export function dataDirOf(root) {
  return path.resolve(
    process.env.DATA_DIR || process.env.FEEDBACK_DIR || path.join(root, 'data'),
  );
}

export function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 每个部署一份盐：落盘的哈希只在本机有意义，换机器不泄露原始 IP */
export function ensureSalt(dataDir, log = () => {}) {
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const file = path.join(dataDir, '.salt');
    try {
      const s = fs.readFileSync(file, 'utf8').trim();
      if (/^[a-f0-9]{32,}$/i.test(s)) return s;
    } catch {
      /* 第一次运行 */
    }
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, s + '\n', { mode: 0o600 });
    return s;
  } catch (e) {
    log(`[store] 数据目录不可写（${e.message}），本次进程用临时盐`);
    return crypto.randomBytes(32).toString('hex');
  }
}

export function hashToken(salt, kind, value) {
  return crypto.createHash('sha256').update(`${salt}|${kind}|${value}`).digest('hex');
}

/** 只追加一行 JSON。JSON.stringify 会把换行转义掉，伪造不出第二条记录。 */
export function appendJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', { mode: 0o600 });
}

/** 读回所有能解析的行；坏行跳过（文件本身也当不可信输入） */
export function readJsonl(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === 'object' && !Array.isArray(r)) out.push(r);
    } catch {
      /* 坏行跳过 */
    }
  }
  return out;
}

// ————————————————————————————— 文本与日期

/** "一天"的分界按东八区算，服务器跑在 UTC 也不会错位 */
export const DAY_OFFSET_MS = Number(process.env.DAY_OFFSET_MIN ?? 480) * 60_000;

/**
 * 控制字符（保留 \t \n \r，交给后面的空白折叠）、零宽字符、双向覆盖字符。
 * 这些不是 XSS，但能把终端、日志、文件名搞乱。
 */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

export function sanitize(raw, max) {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function dayKey(t = Date.now()) {
  return new Date(t + DAY_OFFSET_MS).toISOString().slice(0, 10);
}

export function formatTime(t) {
  return new Date(t + DAY_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/** 毫秒到下一个"日界" */
export function msToNextDay(t = Date.now()) {
  const day = dayKey(t);
  const start = Date.parse(`${day}T00:00:00Z`) - DAY_OFFSET_MS;
  return Math.max(1000, start + 86_400_000 - t);
}

/** UA 只留几个能帮忙定位问题的关键词，别把整串指纹摆出来 */
export function uaHint(ua) {
  const s = String(ua || '');
  if (!s) return '';
  const bits = [];
  if (/MicroMessenger/i.test(s)) bits.push('微信');
  if (/iPhone/i.test(s)) bits.push('iPhone');
  else if (/iPad/i.test(s)) bits.push('iPad');
  else if (/Android/i.test(s)) bits.push('Android');
  else if (/Macintosh/i.test(s)) bits.push('Mac');
  else if (/Windows/i.test(s)) bits.push('Windows');
  else bits.push('未知设备');
  return bits.join(' ');
}

// ————————————————————————————— HTTP

export function json(res, code, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(body);
}

export function text(res, code, body, extra = {}) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...extra,
  });
  res.end(body);
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        req.pause();
        reject(Object.assign(new Error('too large'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 只有"直接连进来的是本机反代"时才信 X-Forwarded-For。
 * 这样即使 8787 端口不小心暴露，外面的人伪造这个头也换不到新配额。
 */
export function clientIp(req, trustProxy) {
  const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const fromProxy = peer === '127.0.0.1' || peer === '::1';
  if (trustProxy && fromProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
      const first = xff.split(',')[0].trim().replace(/^::ffff:/, '');
      if (first) return first.slice(0, 64);
    }
  }
  return peer;
}

/** 每分钟次数限制：返回 true 表示超了 */
export function minuteLimiter(limit) {
  let at = -1;
  const hits = new Map();
  return (ip) => {
    const m = Math.floor(Date.now() / 60_000);
    if (m !== at) {
      at = m;
      hits.clear();
    }
    const n = (hits.get(ip) || 0) + 1;
    hits.set(ip, n);
    return n > limit;
  };
}
