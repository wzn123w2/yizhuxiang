/**
 * 求签（浏览器侧）。
 *
 * 只做一件事：把设备号发给且坐，换回今天的签与日课。
 * 签是服务端按 (日期, 设备号) 定下来的 —— 同一天重复请求只会拿到同一支，
 * 所以"每天一次"不靠前端按钮拦，而是抽不出第二支。
 */

import { deviceId } from './device';

export interface FortuneAlmanac {
  date: string;
  weekday: string;
  lunar: string;
  ganzhi: { year: string; month: string; day: string };
  jianchu: string;
  element: string;
  yi: string[];
  ji: string[];
  chong: string;
  sha: string;
}

export interface FortuneLot {
  no: number;
  grade: string;
  title: string;
  tag: string;
  verse: string[];
  read: string;
  today: string;
}

export type FortuneResult =
  | {
      ok: true;
      first: boolean;
      drawnAt: number;
      almanac: FortuneAlmanac;
      lot: FortuneLot;
    }
  | { ok: false; code: 'network' | 'slow' | 'offline' | 'rejected' };

export async function drawFortune(): Promise<FortuneResult> {
  // 服务端算得很快，但别让手机在弱网里转圈太久
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('/api/fortune', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: deviceId() }),
      signal: ctrl.signal,
      credentials: 'omit',
    });
    if (res.ok) {
      const data = (await res.json()) as {
        first?: boolean;
        drawnAt?: number;
        almanac?: FortuneAlmanac;
        lot?: FortuneLot;
      };
      if (!data?.almanac || !data?.lot) return { ok: false, code: 'rejected' };
      return {
        ok: true,
        first: data.first === true,
        drawnAt: Number(data.drawnAt) || Date.now(),
        almanac: data.almanac,
        lot: data.lot,
      };
    }
    if (res.status === 429) {
      const data = (await res.json().catch(() => null)) as { code?: string } | null;
      return { ok: false, code: data?.code === 'slow' ? 'slow' : 'network' };
    }
    return { ok: false, code: 'rejected' };
  } catch {
    return { ok: false, code: 'offline' };
  } finally {
    window.clearTimeout(timer);
  }
}
