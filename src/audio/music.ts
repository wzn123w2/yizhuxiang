/**
 * 佛乐：五首实录梵呗，顺序循环。
 *
 * 为什么不用 Web Audio 播这些曲子：
 *   1) 它们是几分钟到半小时的整段录音，交给浏览器的媒体栈自己分片缓冲最省内存，
 *      也能边下边听（服务器已支持 Range）；
 *   2) iOS 上 <audio> 走媒体通道，侧边静音键挡不住，和 engine.ts 里那条静音轨同理；
 *   3) AudioContext 被系统销毁重建时，重建的只是合成音，音乐不该跟着断。
 * 代价是音量、静音得自己算一遍——设置面板里的「佛乐」滑块走这里。
 */

import type { LogFn } from './engine';

export interface MusicTrack {
  file: string;
  title: string;
  who: string;
}

/**
 * 顺序是按“一炷香”的节奏排的：先两声佛号安住，再心经、心咒，
 * 最后把最长的《大悲咒》放末尾，愿意坐久的人自然会听到。
 */
export const MUSIC_TRACKS: MusicTrack[] = [
  { file: '01-namo-amitabha.m4a', title: '南无阿弥陀佛', who: '李娜' },
  { file: '02-heart-sutra.m4a', title: '般若波罗蜜多心经', who: '慧普法师' },
  { file: '03-shakyamuni.m4a', title: '释迦牟尼佛圣号', who: '则旭法师' },
  { file: '04-padmasambhava.m4a', title: '莲花生大士心咒', who: '菩提道一' },
  { file: '05-great-compassion.m4a', title: '大悲咒', who: '般禅梵唱妙音组' },
];

const FADE_IN_MS = 1400;
const FADE_OUT_MS = 600;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

interface MusicOptions {
  log: LogFn;
  /** 换曲 / 暂停 / 起播时通知界面（锁定屏的 MediaSession 也在这里挂） */
  onChange?: (track: MusicTrack | null) => void;
}

export class Music {
  private el: HTMLAudioElement;
  private trackIndex = 0;
  private on = false;
  /** 用户按了静音：连缓冲都停掉，别在后台偷偷跑流量 */
  private muted = true;
  /** 设置面板给的目标音量 0~1 */
  private level = 0.55;
  /** 淡入淡出系数，和 level 相乘才是最终 volume */
  private fade = 0;
  private fadeTimer = 0;
  private retryTimer = 0;
  private fails = 0;
  /** play() 被系统拒过：等下一次手势再试 */
  private needsGesture = false;

  constructor(private opts: MusicOptions) {
    const el = document.createElement('audio');
    el.preload = 'none';
    el.loop = false;
    el.controls = false;
    el.volume = 0;
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    el.setAttribute('x5-playsinline', '');
    el.setAttribute('x-webkit-airplay', 'deny');
    (el as any).disableRemotePlayback = true;
    // 挂进 DOM：微信的 WKWebView 里游离的媒体元素有时播不动
    el.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(el);

    el.addEventListener('ended', () => this.next());
    el.addEventListener('error', () => this.onError());
    el.addEventListener('playing', () => {
      this.fails = 0;
      this.needsGesture = false;
      this.fadeTo(1, FADE_IN_MS);
      this.emit();
    });
    el.addEventListener('pause', () => this.emit());

    this.el = el;
    this.bindMediaSession();
  }

  get track(): MusicTrack {
    return MUSIC_TRACKS[this.trackIndex];
  }

  /** 真的在响（而不是“想放”） */
  get playing(): boolean {
    return this.on && !this.muted && !this.el.paused && !this.el.ended;
  }

  get enabled(): boolean {
    return this.on;
  }

  /** 必须在用户手势里调用：iOS / 微信只认手势里的 play() */
  start(): void {
    if (!this.on || this.muted) return;
    const el = this.el;
    if (!el.getAttribute('src')) {
      this.load(this.trackIndex, false);
    }
    const p = el.play();
    if (p && typeof p.then === 'function') {
      p.catch(() => {
        // 多半不在手势里（或还没有媒体会话权限）：记一笔，等下一次点击
        this.needsGesture = true;
        this.opts.log('佛乐需等待一次手势才能起播', 'warn');
      });
    }
  }

  /** 任何一次手势都顺手补一刀：上次被拒的 play() 在这里补上 */
  kick(): void {
    if (!this.on || this.muted) return;
    if (!this.needsGesture) return;
    if (!this.el.paused) return;
    this.start();
  }

  /** 想不想听（设置里的开关）；关掉会淡出并暂停，位置留着 */
  setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on) this.start();
    else this.pause();
    this.emit();
  }

  /**
   * 起播前先把偏好灌进来。刻意不在这里 play()：首屏「开门」之前没有手势，
   * 调了也只会被拒、白记一笔失败日志。
   */
  configure(opts: { on: boolean; muted: boolean; volume: number }): void {
    this.on = opts.on;
    this.muted = opts.muted;
    this.level = clamp01(opts.volume);
    this.applyVolume();
    this.emit();
  }

  /** 和顶部「声音」按钮同一口径：静音时彻底停，不占流量 */
  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    if (muted) this.pause();
    else this.start();
    this.emit();
  }

  setVolume(v: number): void {
    this.level = clamp01(v);
    this.applyVolume();
  }

  /** 切到下一首：淡出，换片源，再淡入 */
  next(): void {
    window.clearTimeout(this.retryTimer);
    const play = this.on && !this.muted;
    if (!play) {
      this.load(this.trackIndex + 1, false);
      return;
    }
    this.fadeTo(0, 420, () => this.load(this.trackIndex + 1, true));
  }

  prev(): void {
    const play = this.on && !this.muted;
    if (!play) {
      this.load(this.trackIndex - 1, false);
      return;
    }
    this.fadeTo(0, 420, () => this.load(this.trackIndex - 1, true));
  }

  /** 锁屏 / 切后台：先淡出再暂停，回来时回到原位置 */
  suspend(): void {
    if (this.el.paused) return;
    this.fadeTo(0, 320, () => this.el.pause());
  }

  resume(): void {
    if (!this.on || this.muted) return;
    if (!this.el.paused) return;
    this.start();
  }

  /** 换片源。autoplay 时接着放，位置从头开始 */
  private load(i: number, autoplay: boolean): void {
    const n = MUSIC_TRACKS.length;
    this.trackIndex = ((i % n) + n) % n;
    const el = this.el;
    const t = this.track;
    this.fade = 0;
    this.applyVolume();
    el.src = `${import.meta.env.BASE_URL}audio/${t.file}`;
    // 不放的时候只拿元数据：静音/关掉时不该在后台偷偷下几十兆
    el.preload = autoplay ? 'auto' : 'metadata';
    el.load();
    this.emit();
    if (autoplay) this.start();
  }

  private pause(): void {
    if (this.el.paused) {
      this.fadeTo(0, 0);
      return;
    }
    this.fadeTo(0, FADE_OUT_MS, () => this.el.pause());
  }

  private onError(): void {
    this.fails++;
    this.opts.log(`佛乐播放失败：${this.track.title}（第 ${this.fails} 次）`, 'warn');
    if (this.fails >= MUSIC_TRACKS.length) {
      // 全军覆没：多半是没网或浏览器不支持 AAC，别再空转
      this.on = false;
      this.emit();
      return;
    }
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => {
      if (this.on) this.next();
    }, 900);
  }

  private fadeTo(target: number, ms: number, done?: () => void): void {
    window.clearInterval(this.fadeTimer);
    this.fadeTimer = 0;
    const from = this.fade;
    const to = clamp01(target);
    if (ms <= 0 || Math.abs(to - from) < 0.01) {
      this.fade = to;
      this.applyVolume();
      done?.();
      return;
    }
    const t0 = performance.now();
    this.fadeTimer = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      this.fade = from + (to - from) * k;
      this.applyVolume();
      if (k >= 1) {
        window.clearInterval(this.fadeTimer);
        this.fadeTimer = 0;
        done?.();
      }
    }, 40);
  }

  private applyVolume(): void {
    // level 0.55 对应“人声清楚但不压过木鱼”，全开也留一点余量
    this.el.volume = clamp01(this.level * this.fade * 0.92);
  }

  private emit(): void {
    this.updateMediaSession();
    this.opts.onChange?.(MUSIC_TRACKS[this.trackIndex]);
  }

  private bindMediaSession(): void {
    const ms = (navigator as any).mediaSession;
    if (!ms || typeof MediaMetadata === 'undefined') return;
    try {
      ms.setActionHandler?.('nexttrack', () => this.next());
      ms.setActionHandler?.('previoustrack', () => this.prev());
      ms.setActionHandler?.('play', () => this.start());
      ms.setActionHandler?.('pause', () => this.pause());
    } catch {
      /* 旧 WebView 不认识这些动作，忽略 */
    }
  }

  /** 锁屏上显示曲名，比空白好看 */
  private updateMediaSession(): void {
    const ms = (navigator as any).mediaSession;
    if (!ms || typeof MediaMetadata === 'undefined') return;
    try {
      ms.metadata = new MediaMetadata({
        title: this.track.title,
        artist: this.track.who,
        album: '且坐 · 佛乐',
      });
      ms.playbackState = this.playing ? 'playing' : 'paused';
    } catch {
      /* 同上 */
    }
  }
}
