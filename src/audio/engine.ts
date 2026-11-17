/**
 * AudioHost —— 唯一的 AudioContext 持有者。
 *
 * 三条独立总线，对应山寺的三档设置：
 *   ambBus   环境音（山风、鸟、水）
 *   chantBus 梵呗（引磬旋律 + 低音持续 + 长混响）
 *   sfxBus   交互音效（木鱼、念珠、合掌）
 *
 * 为什么音源模块不能自己 new AudioContext：
 * iOS / 微信内置浏览器切后台会销毁上下文，回来后必须重建。
 * 模块若缓存了旧 ctx 的节点就全废，所以只能通过 host 取。
 */

export type LogLevel = 'info' | 'ok' | 'warn' | 'error';
export type LogFn = (msg: string, level?: LogLevel) => void;

export const rand = (a: number, b: number) => a + Math.random() * (b - a);

export type BusName = 'amb' | 'chant' | 'sfx';

/**
 * iOS 的 Web Audio 走的是"铃声"通道：侧边静音键一拨，整页没声；
 * 而 <audio>/<video> 走媒体通道，静音键管不着。
 * 所以页面上只要一直有一个"正在播放"的 <audio>，会话就会被顶到媒体通道，
 * Web Audio 才能跟着出声。微信内置浏览器（WKWebView）里没有
 * navigator.audioSession 这条新 API，只能靠这个老办法。
 *
 * 片源是现场生成的 0.25 秒静音 WAV（44.1kHz / 16bit / 立体声）。
 * 刻意不用低采样率单声道：媒体通道会按片源的规格配置，
 * 片源太差会把并行的 Web Audio 一起拖成窄带、发闷。
 */
let silenceUrl: string | null = null;
let silenceEl: HTMLAudioElement | null = null;

function silentWavUrl(): string {
  if (silenceUrl) return silenceUrl;
  const rate = 44100;
  const channels = 2;
  const bits = 16;
  const frames = Math.floor(rate / 4); // 0.25s
  const blockAlign = (channels * bits) / 8;
  const dataLen = frames * blockAlign;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const tag = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bits, true);
  tag(36, 'data');
  dv.setUint32(40, dataLen, true);
  // 全 0 就是 16bit PCM 的静音
  silenceUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silenceUrl;
}

/** iPadOS 也自称 Mac，只能靠触摸点数量分辨 */
export const isIOSLike = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 只在 iOS 上有意义：往媒体通道上挂一个一直播放的静音 <audio> */
function playSilence(): void {
  if (document.hidden) return;
  let a = silenceEl;
  if (!a) {
    a = document.createElement('audio');
    a.loop = true;
    a.preload = 'auto';
    a.controls = false;
    a.muted = false;
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    a.setAttribute('x5-playsinline', '');
    a.setAttribute('x-webkit-airplay', 'deny');
    (a as any).disableRemotePlayback = true;
    a.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    a.src = silentWavUrl();
    a.load();
    // 必须挂进 DOM：微信的 WKWebView 里游离的元素有时播不动
    document.body.appendChild(a);
    silenceEl = a;
  }
  if (!a.paused) return;
  const p = a.play();
  if (p && typeof p.catch === 'function') {
    // 被拒（多半是没在用户手势里 / JSBridge 还没就绪）：作废，下次手势重建
    p.catch(() => dropSilence());
  }
}

function dropSilence(): void {
  const a = silenceEl;
  if (!a) return;
  silenceEl = null;
  try {
    a.pause();
    a.removeAttribute('src');
    a.load();
    a.remove();
  } catch {
    /* 已经没了就算了 */
  }
}

/** 微信 iOS 的 WKWebView 里，媒体通道要先"碰"一下 JSBridge 才算就绪 */
function nudgeWeixinBridge(): void {
  const bridge = (window as any).WeixinJSBridge;
  if (!bridge || typeof bridge.invoke !== 'function') return;
  try {
    bridge.invoke('getNetworkType', {}, () => {});
  } catch {
    /* 不在微信里、或不是 iOS 版桥，忽略 */
  }
}

/** 必须在用户手势里调用：把音频会话顶到媒体通道并保持一个静音轨 */
function armSession(): void {
  if (!isIOSLike()) return;
  nudgeWeixinBridge();
  try {
    const s = (navigator as any).audioSession;
    if (s && s.type !== 'playback') s.type = 'playback';
  } catch {
    /* 旧系统没有这个 API */
  }
  playSilence();
}

export class AudioHost {
  ctx!: AudioContext;
  master!: GainNode;
  ambBus!: GainNode;
  chantBus!: GainNode;
  sfxBus!: GainNode;
  noiseBuffer!: AudioBuffer;

  version = 0;
  unlocked = false;
  muted = false;

  private vols: Record<BusName, number> = { amb: 0.32, chant: 0.62, sfx: 0.7 };
  private rebuilders: Array<() => void> = [];
  private lastRebuild = 0;

  constructor(private log: LogFn) {
    this.create();

    if (isIOSLike()) {
      // 每次手势都重挂一遍静音轨：微信里第一次可能被拒（JSBridge 还没就绪），
      // 被拒后元素会作废，下一次手势自然会重建。
      const rearm = () => armSession();
      for (const ev of ['touchstart', 'touchend', 'click', 'keydown', 'pointerdown']) {
        window.addEventListener(ev, rearm, true);
      }
      window.addEventListener('focus', rearm);
      document.addEventListener('WeixinJSBridgeReady', rearm);
    }

    // 锁屏/切后台时把静音轨撤掉：否则页面会一直在后台"播放"，
    // 既费电，也可能让山寺的声音跟着跑到口袋里。回来时（或下一次手势）再挂上。
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) dropSilence();
      else if (isIOSLike()) armSession();
    });
  }

  /** 诊断用：静音轨是否真的在播（在 iOS 上决定 Web Audio 走哪条通道） */
  get sessionArmed(): boolean {
    return !!silenceEl && !silenceEl.paused;
  }

  get iosLike(): boolean {
    return isIOSLike();
  }

  private create() {
    const Ctor: typeof AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio unsupported');

    this.ctx = new Ctor({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    const mk = () => {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      return g;
    };
    this.ambBus = mk();
    this.chantBus = mk();
    this.sfxBus = mk();

    // 白噪声缓冲：风声、敲击瞬态都用它
    const len = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    this.version++;

    const ctx = this.ctx;
    ctx.onstatechange = () => {
      if (ctx.state === 'running') this.unlocked = true;
      this.log(`AudioContext → ${ctx.state}`, ctx.state === 'running' ? 'ok' : 'warn');
    };

    // 重建后把三档音量恢复回去
    (Object.keys(this.vols) as BusName[]).forEach((k) => this.applyVolume(k));

    this.log(`AudioContext 就绪 · ${Math.round(ctx.sampleRate)}Hz`, 'info');
  }

  private bus(name: BusName): GainNode {
    return name === 'amb' ? this.ambBus : name === 'chant' ? this.chantBus : this.sfxBus;
  }

  private applyVolume(name: BusName) {
    const g = this.bus(name);
    // 静音时归零，但 vol 本身留着；重建上下文后也要按 muted 恢复
    g.gain.setTargetAtTime(this.muted ? 0 : this.vols[name], this.ctx.currentTime, 0.06);
  }

  /** 0~1。静音时全部归零，但 bus 仍保留，避免重建后丢失 */
  setVolume(name: BusName, v: number) {
    this.vols[name] = Math.max(0, Math.min(1, v));
    this.applyVolume(name);
  }

  getVolume(name: BusName): number {
    return this.vols[name];
  }

  /** 一键静音（顶部「声音」按钮） */
  setAllMuted(muted: boolean) {
    this.muted = muted;
    const names: BusName[] = ['amb', 'chant', 'sfx'];
    for (const n of names) this.applyVolume(n);
  }

  onRebuild(fn: () => void) {
    this.rebuilders.push(fn);
  }

  /**
   * iOS 解锁的两个必要条件，而且都要发生在同一次手势里：
   *   1. 一个 HTMLMediaElement 真的开始播（armSession → 静音循环）
   *   2. 一个 Web Audio 音源真的 start（ping）
   * 微信的 WKWebView 里这一点要求得更死，所以 ping 必须同步执行，不能放在 await 之后。
   */
  private ping() {
    if (this.ctx.state === 'closed') return;
    try {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.connect(this.ctx.destination);
      const o = this.ctx.createOscillator();
      o.connect(g);
      o.start();
      o.stop(this.ctx.currentTime + 0.03);
    } catch (e) {
      this.log(`试音失败：${(e as Error).message}`, 'warn');
    }
  }

  async unlock(): Promise<boolean> {
    try {
      armSession();
      this.ping();
      if (this.ctx.state !== 'running') {
        const p = this.ctx.resume();
        // WebKit 上 resume() 偶尔永不 resolve（autoplay 被拦时），
        // 不能让它把"开门"流程和联网一起卡死
        await Promise.race([
          p ?? Promise.resolve(),
          new Promise<void>((r) => window.setTimeout(r, 800)),
        ]);
      }
      this.unlocked = this.ctx.state === 'running';
      if (!this.unlocked) this.log(`解锁未成功（${this.ctx.state}）`, 'warn');
      return this.unlocked;
    } catch (e) {
      this.log(`解锁音频失败：${(e as Error).message}`, 'error');
      return false;
    }
  }

  async rebuild(reason: string): Promise<void> {
    this.log(`重建音频上下文（${reason}）`, 'warn');
    this.lastRebuild = performance.now();
    const old = this.ctx;
    try {
      old.onstatechange = null;
      await old.close();
    } catch {
      /* 已关闭 */
    }
    this.create();
    await this.unlock();
    // 回调必须在 unlock 之后：新上下文此时才是 running
    this.rebuilders.forEach((f) => f());
  }

  /**
   * 手机切后台、锁屏、来电之后上下文会停在 suspended，
   * iOS Safari 还会给一个 'interrupted'（TS 的 AudioContextState 里没有这个值）。
   * 这里统一处理：能 resume 就 resume，实在不行重建，等下一次手势再解锁。
   */
  async ensureAlive(): Promise<void> {
    const state = this.ctx.state as string;
    if (state === 'running') return;
    if (state === 'closed') {
      await this.rebuild('上下文被系统销毁');
      return;
    }
    if (await this.unlock()) return;
    // 手势之外 resume 常常失败；别每次事件都重建，避免堆一串废上下文
    if (performance.now() - this.lastRebuild < 2500) return;
    await this.rebuild('resume 失败');
  }
}
