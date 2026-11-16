/**
 * 本机身份 + "一天"的口径。
 *
 * 签筒要用：设备号做"每天一签"的配额，日期按东八区算（服务器也是这个口径）。
 * 这里不拼 HTML、不拼 URL —— 设备号只是请求里的一个字符串字段。
 */

const DEVICE_KEY = 'shanshi.device';
/** 服务器按东八区算"一天"，本地判断也统一用这个口径 */
const DAY_OFFSET_MS = 8 * 60 * 60 * 1000;

export function todayKey(now = Date.now()): string {
  return new Date(now + DAY_OFFSET_MS).toISOString().slice(0, 10);
}

/** http 页面（非安全上下文）里拿不到 randomUUID，退到 getRandomValues */
function randomToken(): string {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 设备号：服务端用它做"每天一签"的配额。
 * 清掉本地存储会换一个新号，但服务端还有按 IP 的每日上限兜着。
 */
export function deviceId(): string {
  let v = '';
  try {
    v = localStorage.getItem(DEVICE_KEY) || '';
  } catch {
    /* 无痕模式 / 存储被禁 */
  }
  if (/^[A-Za-z0-9_-]{8,64}$/.test(v)) return v;

  v = String(globalThis.crypto?.randomUUID?.() ?? `d${randomToken()}`)
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 40);
  try {
    localStorage.setItem(DEVICE_KEY, v);
  } catch {
    /* 存不下就这一次用一个临时号 */
  }
  return v;
}
