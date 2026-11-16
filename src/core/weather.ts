/**
 * 天气（浏览器侧）：问且坐服务器"北京此刻什么天气"。
 *
 * 服务端已经把两个数据源（国内天气网 / Open-Meteo）合并、缓存、降级过，
 * 这里只做三件事：请求、校验枚举、超时。
 */

export type WeatherKind =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'overcast'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'thunder';

const KINDS = new Set<string>([
  'clear',
  'partly',
  'cloudy',
  'overcast',
  'fog',
  'rain',
  'snow',
  'thunder',
]);

export const WEATHER_ZH: Record<WeatherKind, string> = {
  clear: '晴',
  partly: '晴间多云',
  cloudy: '多云',
  overcast: '阴',
  fog: '雾',
  rain: '雨',
  snow: '雪',
  thunder: '雷雨',
};

export interface WeatherNow {
  kind: WeatherKind;
  label: string;
  temp: number | null;
  isDay: boolean;
  at: number;
  stale?: boolean;
  source?: string;
}

export async function fetchWeather(): Promise<WeatherNow | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch('/api/weather', { signal: ctrl.signal, credentials: 'omit' });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const kind = String(raw.kind || '');
    if (!KINDS.has(kind)) return null;
    const label = String(raw.label || WEATHER_ZH[kind as WeatherKind] || '').slice(0, 8);
    const temp = Number(raw.temp);
    return {
      kind: kind as WeatherKind,
      label: label || WEATHER_ZH[kind as WeatherKind],
      temp: Number.isFinite(temp) ? temp : null,
      isDay: raw.isDay === true,
      at: Number(raw.at) || Date.now(),
      stale: raw.stale === true,
      source: typeof raw.source === 'string' ? raw.source : '',
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
