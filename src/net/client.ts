/**
 * 同修连线：一条 WebSocket，连不上就退避重连。
 *
 * 只做三件事：
 *  - 把本机的位姿按 12Hz 报上去（自动节流，站着不动时降到 1Hz）
 *  - 把服务端的快照 / 事件 / 坐垫表分发给 main
 *  - 记住服务器时间偏移，让昼夜在所有人眼里一致
 */

import type { Pose } from '../world/monk';

export interface RemoteInfo {
  id: string;
  name: string;
  robe: number;
  x: number;
  z: number;
  r: number;
  pose: Pose;
  seat: number | null;
}

export interface SnapEntry {
  id: string;
  x: number;
  z: number;
  r: number;
  pose: Pose;
  seat: number | null;
}

export type NetEventKind = 'fish' | 'bead' | 'round' | 'anjali' | 'incense';
export type NetStatus = 'connecting' | 'open' | 'closed' | 'full';

export interface NetHandlers {
  onWelcome(id: string, players: RemoteInfo[], seats: Array<[number, string]>, now: number): void;
  onJoin(p: RemoteInfo): void;
  onLeave(id: string): void;
  onSnap(now: number, list: SnapEntry[]): void;
  onSeats(seats: Array<[number, string]>): void;
  onEvent(id: string, k: NetEventKind): void;
  onSeatResult(seat: number | null, ok: boolean, by: string): void;
  onOnline(n: number): void;
  onStatus(s: NetStatus): void;
}

const POSES = new Set<Pose>(['idle', 'walk', 'sit', 'bow', 'anjali', 'bead', 'incense']);
const EVENTS = new Set<NetEventKind>(['fish', 'bead', 'round', 'anjali', 'incense']);

/** 上报间隔：移动时 12Hz 左右，静止时 1Hz 心跳式保活 */
const REPORT_MS = 84;
const IDLE_REPORT_MS = 1000;
const MOVE_EPS = 0.01;

export interface NetOptions {
  name: string;
  robe: number;
  handlers: NetHandlers;
  /** 默认按当前 origin 拼 /ws */
  url?: string;
}

export class NetClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer = 0;
  private reportTimer = 0;

  private ready = false;
  private everOpened = false;
  private closedByUs = false;

  private _id = '';
  private _online = 1;
  private offset = 0;

  private lastReportAt = 0;
  private lastBeadAt = 0;

  /** 本机最新位姿，report() 每帧写，定时器负责发 */
  private want = { x: 0, z: 20.5, r: Math.PI, pose: 'idle' as Pose, seat: null as number | null };
  private sent: { x: number; z: number; r: number; pose: Pose; seat: number | null } | null = null;

  constructor(private opts: NetOptions) {}

  get id() {
    return this._id;
  }

  get online() {
    return this._online;
  }

  get connected() {
    return this.ready;
  }

  /** 服务器时间（毫秒） */
  get serverNow() {
    return Date.now() + this.offset;
  }

  private get url() {
    if (this.opts.url) return this.opts.url;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  connect() {
    if (this.ws && (this.ready || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.closedByUs = false;
    this.opts.handlers.onStatus('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.closedByUs) return;
      this.ready = true;
      this.retry = 0;
      this.sent = null;
      this.opts.handlers.onStatus('open');
      this.hello();
      this.startTimers();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handle(msg);
    };

    ws.onclose = (ev) => {
      this.ready = false;
      this.stopTimers();
      this.ws = null;
      if (this.closedByUs) return;
      if (ev.code === 4001) {
        this.opts.handlers.onStatus('full');
        return; // 满房不再重连，等用户自己刷新
      }
      this.opts.handlers.onStatus('closed');
      this.scheduleRetry();
    };

    ws.onerror = () => {
      /* onclose 会跟着来，统一在那里处理 */
    };
  }

  close() {
    this.closedByUs = true;
    this.stopTimers();
    this.ready = false;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  /** 每帧调用，只写内存，不产生网络包 */
  report(x: number, z: number, r: number, pose: Pose, seat: number | null) {
    this.want.x = x;
    this.want.z = z;
    this.want.r = r;
    this.want.pose = pose;
    this.want.seat = seat;
  }

  /** 坐垫占用：seat 为 null 表示离开 */
  claimSeat(seat: number | null) {
    this.send({ t: 'seat', seat });
  }

  /** 木鱼 / 过珠 / 圆满 / 合掌 / 上香 */
  event(k: NetEventKind) {
    // 自动捻珠一秒能过一两颗，别把整间屋子刷满
    if (k === 'bead') {
      const now = performance.now();
      if (now - this.lastBeadAt < 380) return;
      this.lastBeadAt = now;
    }
    this.send({ t: 'ev', k });
  }

  // ————————————————————————————— 内部

  private hello() {
    this.send({
      t: 'hello',
      name: this.opts.name,
      robe: this.opts.robe,
      token: this._id || undefined,
    });
  }

  private send(obj: unknown) {
    if (!this.ws || !this.ready) return;
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  private scheduleRetry() {
    window.clearTimeout(this.retryTimer);
    const delay = Math.min(8000, 700 * 2 ** this.retry++);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  private startTimers() {
    this.stopTimers();
    this.reportTimer = window.setInterval(() => this.flush(), REPORT_MS);
  }

  private stopTimers() {
    window.clearInterval(this.reportTimer);
    this.reportTimer = 0;
  }

  private flush() {
    if (!this.ready) return;
    const now = performance.now();
    const w = this.want;
    const s = this.sent;
    const moved =
      !s ||
      Math.abs(w.x - s.x) > MOVE_EPS ||
      Math.abs(w.z - s.z) > MOVE_EPS ||
      Math.abs(w.r - s.r) > 0.02 ||
      w.pose !== s.pose ||
      w.seat !== s.seat;

    if (!moved && now - this.lastReportAt < IDLE_REPORT_MS) return;

    this.lastReportAt = now;
    this.sent = { ...w };
    this.send({ t: 'm', x: +w.x.toFixed(2), z: +w.z.toFixed(2), r: +w.r.toFixed(3), pose: w.pose });
  }

  private handle(msg: any) {
    const h = this.opts.handlers;
    switch (msg.t) {
      case 'welcome': {
        this._id = String(msg.id || '');
        this.offset = Number.isFinite(msg.now) ? msg.now - Date.now() : 0;
        const rawPlayers: unknown[] = Array.isArray(msg.players) ? msg.players : [];
        const list: RemoteInfo[] = rawPlayers
          .map((p) => parseInfo(p))
          .filter((p): p is RemoteInfo => !!p);
        const seats: Array<[number, string]> = Array.isArray(msg.seats)
          ? msg.seats.filter((s: any) => Array.isArray(s) && Number.isInteger(s[0]))
          : [];
        this._online = list.length + 1;
        h.onWelcome(this._id, list, seats, msg.now);
        h.onOnline(this._online);
        break;
      }
      case 'join': {
        const p = parseInfo(msg.p);
        if (p) {
          this._online++;
          h.onJoin(p);
          h.onOnline(this._online);
        }
        break;
      }
      case 'leave': {
        if (typeof msg.id === 'string') {
          this._online = Math.max(1, this._online - 1);
          h.onLeave(msg.id);
          h.onOnline(this._online);
        }
        break;
      }
      case 'online': {
        if (Number.isInteger(msg.n)) {
          this._online = Math.max(1, msg.n);
          h.onOnline(this._online);
        }
        break;
      }
      case 'seats': {
        if (Array.isArray(msg.seats)) h.onSeats(msg.seats);
        break;
      }
      case 'snap': {
        if (Number.isFinite(msg.now)) this.offset = msg.now - Date.now();
        if (!Array.isArray(msg.ps)) break;
        const list: SnapEntry[] = [];
        for (const e of msg.ps) {
          if (!Array.isArray(e) || typeof e[0] !== 'string') continue;
          list.push({
            id: e[0],
            x: Number.isFinite(e[1]) ? e[1] : 0,
            z: Number.isFinite(e[2]) ? e[2] : 0,
            r: Number.isFinite(e[3]) ? e[3] : 0,
            pose: POSES.has(e[4]) ? e[4] : 'idle',
            seat: Number.isInteger(e[5]) ? e[5] : null,
          });
        }
        h.onSnap(msg.now, list);
        break;
      }
      case 'ev': {
        if (typeof msg.id === 'string' && EVENTS.has(msg.k)) h.onEvent(msg.id, msg.k);
        break;
      }
      case 'seatres': {
        const seat = Number.isInteger(msg.seat) ? msg.seat : null;
        h.onSeatResult(seat, !!msg.ok, String(msg.by ?? ''));
        break;
      }
      case 'full': {
        h.onStatus('full');
        break;
      }
      default:
        break;
    }
  }

  /** 调试用 */
  debug() {
    return {
      id: this._id,
      online: this._online,
      connected: this.ready,
      everOpened: this.everOpened,
      url: this.url,
    };
  }
}

function parseInfo(p: any): RemoteInfo | null {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string') return null;
  return {
    id: p.id,
    name: String(p.name ?? '无名').slice(0, 12),
    robe: Number.isFinite(p.robe) ? p.robe : 0x6b4a35,
    x: Number.isFinite(p.x) ? p.x : 0,
    z: Number.isFinite(p.z) ? p.z : 20.5,
    r: Number.isFinite(p.r) ? p.r : Math.PI,
    pose: POSES.has(p.pose) ? p.pose : 'idle',
    seat: Number.isInteger(p.seat) ? p.seat : null,
  };
}
