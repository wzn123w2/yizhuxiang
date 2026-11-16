/**
 * 天气 —— 把"北京此刻的天气"翻译成前端能用的几个枚举。
 *
 *   GET /api/weather
 *     → { ok, city, kind, label, temp, isDay, at, observedAt, source, stale }
 *
 * 两个数据源并行问，谁先回用谁（都不需要 key）：
 *   1) 中国天气网数据（t.weather.itboy.net）—— 国内可直连，给"阴/多云/小雨/雪"这种中文描述；
 *   2) Open-Meteo —— 境外可达，给 WMO 天气码和 is_day。
 * 结果缓存 10 分钟：一台服务器一天最多 144 次上游请求。
 * 两个都失败时：优先给上一次的缓存（stale: true），连缓存都没有就给"晴"，
 * 前端不会因为没网就没有天空。
 *
 * 前端只认 kind：
 *   clear  partly  cloudy  overcast  fog  rain  snow  thunder
 */

import { clientIp, minuteLimiter } from './store.mjs';

const CITY = process.env.WEATHER_CITY || '北京';
const LAT = Number(process.env.WEATHER_LAT || 39.9042);
const LON = Number(process.env.WEATHER_LON || 116.4074);
const TTL = 10 * 60_000;
const PER_MIN = 60;

/** 中文天气描述 → kind。雪/雨夹雪要先于"雨"判断，雷阵雨要先于"阵雨"。 */
function classifyZh(raw) {
  const s = String(raw || '');
  if (/雪/.test(s)) return 'snow';
  if (/雷/.test(s)) return 'thunder';
  if (/雨/.test(s)) return 'rain';
  if (/雾|霾|沙|尘/.test(s)) return 'fog';
  if (/阴/.test(s)) return 'overcast';
  if (/多云/.test(s)) return /晴/.test(s) ? 'partly' : 'cloudy';
  if (/晴/.test(s)) return s === '晴' ? 'clear' : 'partly';
  if (/风/.test(s)) return 'cloudy';
  return 'cloudy';
}

/** WMO weather code → kind / 中文 */
function classifyWmo(code) {
  if (code === 0) return ['clear', '晴'];
  if (code === 1) return ['partly', '晴间多云'];
  if (code === 2) return ['cloudy', '多云'];
  if (code === 3) return ['overcast', '阴'];
  if (code === 45 || code === 48) return ['fog', '雾'];
  if (code >= 51 && code <= 57) return ['rain', '小雨'];
  if (code >= 61 && code <= 67) return ['rain', code === 65 ? '大雨' : '小雨'];
  if (code >= 71 && code <= 77) return ['snow', code === 75 ? '大雪' : '小雪'];
  if (code >= 80 && code <= 82) return ['rain', code === 82 ? '阵雨' : '小雨'];
  if (code === 85 || code === 86) return ['snow', code === 86 ? '阵雪' : '小雪'];
  if (code >= 95) return ['thunder', '雷雨'];
  return ['cloudy', '多云'];
}

/** 北京此刻几点（分钟数） */
function beijingMinutes() {
  try {
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  } catch {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
}

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

async function fetchJson(url, ms = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 国内源：中文描述 + 温度 + 日出日落 */
async function loadDomestic() {
  const j = await fetchJson('http://t.weather.itboy.net/api/weather/city/101010100');
  const f = j?.data?.forecast?.[0];
  const type = String(f?.type || '').trim();
  if (!type) throw new Error('domestic: no type');
  const temp = Number(j?.data?.wendu);
  const now = beijingMinutes();
  const rise = toMinutes(f?.sunrise);
  const set = toMinutes(f?.sunset);
  const isDay = rise !== null && set !== null ? now >= rise && now < set : now >= 360 && now < 1080;
  return {
    ok: true,
    city: CITY,
    kind: classifyZh(type),
    label: type,
    temp: Number.isFinite(temp) ? Math.round(temp * 10) / 10 : null,
    isDay,
    observedAt: typeof j?.time === 'string' ? j.time : null,
    source: 'weather.com.cn',
  };
}

/** 境外源：WMO 天气码 + is_day */
async function loadOpenMeteo() {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    '&current=temperature_2m,weather_code,is_day&timezone=Asia%2FShanghai';
  const data = await fetchJson(url);
  const cur = data?.current;
  if (!cur || !Number.isFinite(Number(cur.weather_code))) throw new Error('wmo: bad payload');
  const code = Math.trunc(Number(cur.weather_code));
  const [kind, label] = classifyWmo(code);
  const temp = Number(cur.temperature_2m);
  return {
    ok: true,
    city: CITY,
    kind,
    label,
    temp: Number.isFinite(temp) ? Math.round(temp * 10) / 10 : null,
    isDay: cur.is_day === 1 || cur.is_day === '1',
    observedAt: typeof cur.time === 'string' ? cur.time : null,
    source: 'open-meteo',
  };
}

function fallback(stale) {
  const m = beijingMinutes();
  return {
    ok: true,
    city: CITY,
    kind: 'clear',
    label: '晴',
    temp: null,
    isDay: m >= 360 && m < 1080,
    at: Date.now(),
    observedAt: null,
    source: 'fallback',
    stale,
    fallback: true,
  };
}

export function createWeatherBox(opts = {}) {
  const { log = () => {} } = opts;
  let cacheAt = 0;
  let cache = null;
  let inflight = null;

  async function load() {
    const data = await Promise.any([loadDomestic(), loadOpenMeteo()]);
    cache = { ...data, at: Date.now() };
    cacheAt = cache.at;
    log(`[weather] ${CITY} ${cache.label} ${cache.temp ?? '?'}°C · ${cache.source}`);
    return cache;
  }

  function send(res, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      // 客户端自己也会轮询，这里让中间层最多存 5 分钟
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }

  async function get(res) {
    if (cache && Date.now() - cacheAt < TTL) return send(res, { ...cache, stale: false });
    if (!inflight) {
      inflight = load().finally(() => {
        inflight = null;
      });
    }
    try {
      return send(res, { ...(await inflight), stale: false });
    } catch (e) {
      const msg = e?.errors?.[0]?.message || e?.message || 'unknown';
      log(`[weather] 拉取失败：${msg}`);
      if (cache) return send(res, { ...cache, stale: true });
      return send(res, fallback(true));
    }
  }

  const limited = minuteLimiter(PER_MIN);

  function handle(req, res, trustProxy = false) {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname !== '/api/weather') return false;
    if (req.method !== 'GET') {
      const body = JSON.stringify({ ok: false, code: 'method' });
      res.writeHead(405, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        Allow: 'GET',
      });
      res.end(body);
      return true;
    }
    if (limited(clientIp(req, trustProxy))) {
      res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('slow down\n');
      return true;
    }
    void get(res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return true;
  }

  return { handle, city: CITY };
}
