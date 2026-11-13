/**
 * AudioHost —— 唯一的 AudioContext 持有者。
 *
 * 三条独立总线，对应山寺的三档设置：
 *   ambBus   环境音（山风、鸟、水）
 *   chantBus 唱诵（五声音阶吟唱 + 低音持续层 + 殿内混响）
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

export class AudioHost {
  ctx!: AudioContext;
  master!: GainNode;
  ambBus!: GainNode;
  chantBus!: GainNode;
  sfxBus!: GainNode;
  noiseBuffer!: AudioBuffer;

  version = 0;
  unlocked = false;

  private vols: Record<BusName, number> = { amb: 0.32, chant: 0.62, sfx: 0.7 };
  private rebuilders: Array<() => void> = [];

  constructor(private log: LogFn) {
    this.create();
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
    g.gain.setTargetAtTime(this.vols[name], this.ctx.currentTime, 0.06);
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
    const names: BusName[] = ['amb', 'chant', 'sfx'];
    for (const n of names) {
      this.bus(n).gain.setTargetAtTime(
        muted ? 0 : this.vols[n],
        this.ctx.currentTime,
        0.15,
      );
    }
  }

  onRebuild(fn: () => void) {
    this.rebuilders.push(fn);
  }

  async unlock(): Promise<boolean> {
    try {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      if (this.ctx.state === 'running') {
        // 部分 iOS 版本要有一次真实的音源播放才真正启动
        const g = this.ctx.createGain();
        g.gain.value = 0;
        g.connect(this.ctx.destination);
        const o = this.ctx.createOscillator();
        o.connect(g);
        o.start();
        o.stop(this.ctx.currentTime + 0.01);
      }
      this.unlocked = this.ctx.state === 'running';
      return this.unlocked;
    } catch (e) {
      this.log(`解锁音频失败：${(e as Error).message}`, 'error');
      return false;
    }
  }

  async rebuild(reason: string): Promise<void> {
    this.log(`重建音频上下文（${reason}）`, 'warn');
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

  async ensureAlive(): Promise<void> {
    if (this.ctx.state === 'closed') return this.rebuild('上下文被系统销毁');
    if (this.ctx.state === 'suspended') {
      if (!(await this.unlock())) await this.rebuild('resume 失败');
    }
  }
}
