/** 本地存档：木鱼/念珠累计数 + 声音偏好。且坐的做法就是"只存本机"。 */

export interface Save {
  v: 1;
  merit: number;
  beads: number;
  muted: boolean;
  vol: { amb: number; chant: number; sfx: number };
  /** 同修里显示的名字，留空则服务端叫“无名” */
  name: string;
  /** 是否亲手定过称呼：定过就尊重“无名”，没定过则首次自动给个法号 */
  nameTouched: boolean;
  /** 三档音量的平衡方案版本：2 才代表“环境音压下去、诵经提上来”那一版 */
  volV?: number;
  /** 已经看过哪一条更新公告（changelog 的 id），用来决定下次还弹不弹 */
  noticeSeen?: string;
  /** 最近一次求签的日期（东八区 YYYY-MM-DD），只用来决定右上角的小金点 */
  lastFortuneDay?: string;
  createdAt: number;
}

const KEY = 'shanshi.save.v1';

/** 当前三档音量的默认平衡。改这个数字，老用户下次进来一次性重算 */
export const VOL_BALANCE = 2;

export const DEFAULT_VOL = { amb: 0.32, chant: 0.62, sfx: 0.7 };

function empty(): Save {
  return {
    v: 1,
    merit: 0,
    beads: 0,
    muted: true, // 首次访问默认静音
    vol: { ...DEFAULT_VOL },
    name: '',
    nameTouched: false,
    volV: VOL_BALANCE,
    noticeSeen: '',
    lastFortuneDay: '',
    createdAt: Date.now(),
  };
}

export interface StorageState {
  ok: boolean;
  reason?: string;
}

export function load(): { save: Save; state: StorageState } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { save: empty(), state: { ok: true } };
    const s = JSON.parse(raw) as Save;
    if (s.v !== 1) return { save: empty(), state: { ok: true } };
    const base = empty();
    const merged: Save = { ...base, ...s, vol: { ...base.vol, ...(s.vol ?? {}) } };
    // 老存档（或上一版平衡）→ 一次性改用新的默认平衡，用户调过之后就不再动
    if (s.volV !== VOL_BALANCE) {
      merged.vol = { ...DEFAULT_VOL };
      merged.volV = VOL_BALANCE;
    }
    return { save: merged, state: { ok: true } };
  } catch (e) {
    return { save: empty(), state: { ok: false, reason: (e as Error).message } };
  }
}

export function persist(s: Save): StorageState {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export function clear(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
