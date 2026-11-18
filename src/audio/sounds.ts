/** 所有声音都是合成的：没有外部音频资源，靠 Web Audio 现场生成 */

import { AudioHost, rand } from './engine';

const TAU = Math.PI * 2;

// ————————————————————————————— 木鱼

const WOODFISH_VARIANTS = [
  { base: 392, parts: [[1, 0.55, 0.15], [1.62, 0.3, 0.1], [2.71, 0.16, 0.07], [4.1, 0.08, 0.04]] as const, cf: 2600, cg: 0.32 },
  { base: 415, parts: [[1, 0.52, 0.14], [1.58, 0.32, 0.095], [2.78, 0.15, 0.065], [4.3, 0.07, 0.038]] as const, cf: 2900, cg: 0.3 },
  { base: 442, parts: [[1, 0.5, 0.125], [1.66, 0.3, 0.085], [2.62, 0.17, 0.06], [4.6, 0.08, 0.035]] as const, cf: 3200, cg: 0.28 },
  { base: 468, parts: [[1, 0.46, 0.105], [1.72, 0.3, 0.075], [2.9, 0.16, 0.052], [4.9, 0.09, 0.03]] as const, cf: 3500, cg: 0.26 },
  { base: 496, parts: [[1, 0.44, 0.09], [1.68, 0.28, 0.068], [2.84, 0.15, 0.048], [5.2, 0.08, 0.028]] as const, cf: 3900, cg: 0.24 },
] as const;

export class Sounds {
  constructor(private host: AudioHost) {}

  private get ctx() {
    return this.host.ctx;
  }

  private get ok() {
    return this.ctx.state === 'running';
  }

  /** 木鱼：5 组泛音随机 + 音高/音量/起振偏移扰动，避免连敲的机械感 */
  woodfish(gain = 1): void {
    if (!this.ok) return;
    const ctx = this.ctx;
    const v = WOODFISH_VARIANTS[Math.floor(Math.random() * WOODFISH_VARIANTS.length)];
    const detune = rand(0.97, 1.03);
    const t0 = ctx.currentTime + rand(0.001, 0.003);

    const out = ctx.createGain();
    out.gain.value = gain * rand(0.93, 1.05);
    out.connect(this.host.sfxBus);

    for (const [ratio, level, decay] of v.parts) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = v.base * ratio * detune;
      osc.frequency.setValueAtTime(f * 1.09, t0);
      osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.028);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(level, t0 + 0.0018);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + decay + 0.03);
    }

    const click = ctx.createBufferSource();
    click.buffer = this.host.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = v.cf;
    bp.Q.value = 1.1;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(v.cg, t0);
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.005);
    click.connect(bp).connect(cg).connect(out);
    click.start(t0, Math.random() * 1.2, 0.02);
  }

  /** 念珠划过：极短、偏高频的木珠声 */
  bead(gain = 1): void {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + rand(0.0005, 0.002);
    const out = ctx.createGain();
    out.gain.value = gain * rand(0.85, 1.1);
    out.connect(this.host.sfxBus);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const f = rand(1450, 1760);
    osc.frequency.setValueAtTime(f * 1.15, t0);
    osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.02);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.16, t0 + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.09);

    const n = ctx.createBufferSource();
    n.buffer = this.host.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.12, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.01);
    n.connect(hp).connect(ng).connect(out);
    n.start(t0, Math.random() * 1.5, 0.025);
  }

  /** 磬：非谐波泛音 + 长衰减 */
  bell(base = 220, gain = 1): void {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.004;
    const out = ctx.createGain();
    out.gain.value = gain * 0.42;
    out.connect(this.host.sfxBus);

    const parts: Array<[number, number, number]> = [
      [1, 0.5, 6.5],
      [2.76, 0.3, 4.6],
      [5.4, 0.16, 3.2],
      [8.93, 0.09, 2],
      [13.34, 0.04, 1.2],
    ];
    for (const [ratio, level, decay] of parts) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * ratio * rand(0.998, 1.002);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(level, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + decay + 0.05);
    }
  }

  /** 合掌：一声很轻的双音，像袖口摩擦后的一点回响 */
  chime(gain = 1): void {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.01;
    const out = ctx.createGain();
    out.gain.value = gain * 0.16;
    out.connect(this.host.sfxBus);

    for (const [f, d] of [[1318.5, 1.6], [1975.5, 1.1]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.5, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + d + 0.05);
    }

    // 衣物摩擦的一点噪声
    const n = ctx.createBufferSource();
    n.buffer = this.host.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    n.connect(bp).connect(ng).connect(out);
    n.start(t0, Math.random(), 0.2);
  }

  /** 上香：一次轻柔的"呼" */
  incense(): void {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.3;
    out.connect(this.host.sfxBus);

    const n = ctx.createBufferSource();
    n.buffer = this.host.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(420, t0);
    bp.frequency.exponentialRampToValueAtTime(1500, t0 + 0.5);
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.3, t0 + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);
    n.connect(bp).connect(g).connect(out);
    n.start(t0, Math.random(), 0.9);
  }
}

// ————————————————————————————— 环境音（山风 + 偶尔的鸟）

export class Wind {
  private out: GainNode | null = null;
  private version = -1;
  private birdTimer = 0;
  private host: AudioHost;

  constructor(host: AudioHost) {
    this.host = host;
    host.onRebuild(() => {
      this.out = null;
      this.version = -1;
      if (this.wanted) this.start();
    });
  }

  private wanted = false;

  start(): void {
    this.wanted = true;
    const ctx = this.host.ctx;
    if (ctx.state !== 'running') return;
    if (this.out && this.version === this.host.version) return;

    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.host.ambBus);
    out.gain.setTargetAtTime(0.42, ctx.currentTime, 2.0);

    // 风：带通噪声 + 两个慢速 LFO 让风声有起伏
    const src = ctx.createBufferSource();
    src.buffer = this.host.noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380;
    bp.Q.value = 0.55;
    const g = ctx.createGain();
    g.gain.value = 0.75;

    for (const [freq, amt] of [[0.053, 240], [0.017, 140]] as const) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = freq;
      const lg = ctx.createGain();
      lg.gain.value = amt;
      lfo.connect(lg).connect(bp.frequency);
      lfo.start();
    }

    src.connect(bp).connect(g).connect(out);
    src.start();

    // 远处一点空气感
    const air = ctx.createBufferSource();
    air.buffer = this.host.noiseBuffer;
    air.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const ag = ctx.createGain();
    ag.gain.value = 0.026;
    air.connect(hp).connect(ag).connect(out);
    air.start();

    this.out = out;
    this.version = this.host.version;

    window.clearInterval(this.birdTimer);
    this.birdTimer = window.setInterval(() => {
      if (Math.random() < 0.45) this.bird();
    }, 9000);
  }

  /** 两声很轻的远鸟，用来打断风声的单调 */
  private bird(): void {
    const ctx = this.host.ctx;
    if (ctx.state !== 'running' || !this.out) return;
    const t0 = ctx.currentTime + rand(0, 0.6);
    const notes = 1 + Math.floor(Math.random() * 2);
    const base = rand(2100, 2900);
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * 0.13;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.045);
      osc.frequency.exponentialRampToValueAtTime(base * 0.92, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.026, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      osc.connect(g).connect(this.out);
      osc.start(t);
      osc.stop(t + 0.16);
    }
  }

  stop(): void {
    this.wanted = false;
    window.clearInterval(this.birdTimer);
    const ctx = this.host.ctx;
    if (this.out && ctx.state !== 'closed') {
      this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
    }
    this.out = null;
    this.version = -1;
  }
}

// ————————————————————————————— 梵呗（大悲咒一路的器乐梵音）

/**
 * 原来这里用锯齿波 + 三个共振峰拼“人声”，音色卡在合成器和喉音之间，
 * 听久了会累。现在换成器乐梵呗：
 *   1. 低音持续 —— 殿里那口气
 *   2. 五声音阶上的引磬旋律，走固定乐句，不再随机游走
 *   3. 一点殿内混响 + 回声 —— 有尾音，但不糊耳朵
 * 人声只留一层极轻的正弦“嗡”垫，远听像殿角有几个人在低声应和。
 */
const MANTRA_SCALE = [146.83, 174.61, 196.0, 220.0, 261.63, 293.66]; // D3 小调五声

/** 乐句写成音级（-1 = 空一拍）：句尾都落回主音，听起来才像一支曲子 */
const MANTRA_PHRASES: number[][] = [
  [4, 3, 2, -1, 3, 2, 1, 0],
  [0, 2, 3, 4, -1, 3, 1, 0],
  [2, 3, 4, 5, 4, 3, 2, -1, 0],
  [4, 5, 4, 3, 2, -1, 1, 0],
];

export class Chant {
  private out: GainNode | null = null;
  private prox: GainNode | null = null;
  private conv: ConvolverNode | null = null;
  private echoIn: AudioNode | null = null;
  private version = -1;
  private scheduler = 0;
  private bellTimer = 0;
  private nextAt = 0;
  private phrase = 0;
  private cursor = 0;
  private wanted = false;
  /** 0 = 远处，1 = 佛前 */
  private proxTarget = 0.3;
  private proxSent = -1;
  /** 佛乐在放时把整条梵呗让出去：两套调子一起走会打架，1 = 正常，0 = 全让 */
  private duck = 1;

  constructor(private host: AudioHost) {
    host.onRebuild(() => {
      this.out = null;
      this.prox = null;
      this.conv = null;
      this.echoIn = null;
      this.version = -1;
      if (this.wanted) this.start();
    });
  }

  private get ctx() {
    return this.host.ctx;
  }

  start(): void {
    this.wanted = true;
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    if (this.out && this.version === this.host.version) return;

    const out = ctx.createGain();
    out.gain.value = 0.0001;

    // 输出前先过一道轻限幅：音符再密也不会突然顶响（最大值有天花板）
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 5;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.28;

    // 离佛越近越响；近处封顶，不把耳朵顶住
    const prox = ctx.createGain();
    prox.gain.value = this.proxGain(this.proxTarget) * this.duck;

    out.connect(limiter).connect(prox).connect(this.host.chantBus);
    out.gain.setTargetAtTime(0.46, ctx.currentTime, 2.8);

    // 殿内混响 + 一路轻回声。
    // 上一次的湿声还是偏多：尾音一长，几个音叠在一起就成了“嗡嗡”的一团，
    // 旋律反而听不清。这次把混响收成“只在身后托一下”的量——
    // 时长更短、湿声更小、低频切得更狠，回声也不再多绕一圈回混响里。
    const conv = ctx.createConvolver();
    conv.buffer = this.makeIR(ctx, 2.0, 3.8);
    const wetHp = ctx.createBiquadFilter();
    wetHp.type = 'highpass';
    wetHp.frequency.value = 320;
    wetHp.Q.value = 0.6;
    const wetLp = ctx.createBiquadFilter();
    wetLp.type = 'lowpass';
    wetLp.frequency.value = 2400;
    const wet = ctx.createGain();
    wet.gain.value = 0.10;
    conv.connect(wetHp).connect(wetLp).connect(wet).connect(out);

    const echo = ctx.createDelay(1.5);
    echo.delayTime.value = 0.34;
    const fb = ctx.createGain();
    fb.gain.value = 0.10;
    const echoLp = ctx.createBiquadFilter();
    echoLp.type = 'lowpass';
    echoLp.frequency.value = 1800;
    echo.connect(echoLp).connect(fb).connect(echo);
    const echoWet = ctx.createGain();
    echoWet.gain.value = 0.06;
    echo.connect(echoWet).connect(out);
    // 回声不再送回混响：两路尾巴相加，就是之前那股散不掉的糊音
    // echo.connect(conv);

    // ——— 低音持续：只做“殿里有人”的底，不抢旋律
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.55;
    lp.connect(out);
    lp.connect(conv);

    [73.42, 110.0].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * (1 + (Math.random() - 0.5) * 0.003);
      const g = ctx.createGain();
      g.gain.value = 0.055 / (i + 1);
      osc.connect(g).connect(lp);
      osc.start();

      // 两位“法师”的呼吸周期不同
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.04 + Math.random() * 0.04;
      const lg = ctx.createGain();
      lg.gain.value = 0.03 / (i + 1);
      lfo.connect(lg).connect(g.gain);
      lfo.start();
    });

    // 极慢的滤波扫动，让低音不死板
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.028;
    const sg = ctx.createGain();
    sg.gain.value = 150;
    sweep.connect(sg).connect(lp.frequency);
    sweep.start();

    // ——— 和声垫：D3 / A3 / D4 上几把极轻的正弦，出来像远远的一层“嗡”
    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 1100;
    padLp.Q.value = 0.4;
    const pad = ctx.createGain();
    pad.gain.setValueAtTime(0.0001, ctx.currentTime);
    pad.gain.linearRampToValueAtTime(0.038, ctx.currentTime + 8);
    padLp.connect(pad);
    pad.connect(out);
    // 和声垫本身已经够“远”，不再往混响里加料
    // pad.connect(conv);

    for (const [f, lvl] of [
      [146.83, 1],
      [220, 0.6],
      [293.66, 0.36],
    ] as const) {
      for (const det of [-0.0042, 0.0038]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f * (1 + det);
        const g = ctx.createGain();
        g.gain.value = 0.26 * lvl;
        osc.connect(g).connect(padLp);
        osc.start();

        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.08 + Math.random() * 0.09;
        const lg = ctx.createGain();
        lg.gain.value = f * 0.004;
        lfo.connect(lg).connect(osc.frequency);
        lfo.start();
      }
    }

    this.out = out;
    this.prox = prox;
    this.conv = conv;
    this.echoIn = echo;
    this.version = this.host.version;
    this.proxSent = this.proxTarget;

    // ——— 旋律调度：先排好一小段，别等到点了才发
    this.phrase = Math.floor(Math.random() * MANTRA_PHRASES.length);
    this.cursor = 0;
    this.nextAt = ctx.currentTime + 1.2;
    window.clearInterval(this.scheduler);
    this.scheduler = window.setInterval(() => this.schedule(), 250);

    window.clearInterval(this.bellTimer);
    this.bellTimer = window.setInterval(() => this.bowl(), 47_000);
  }

  /** t: 0 = 远，1 = 佛前。变化大于 0.6% 才排参数，免得每帧堆事件 */
  setProximity(t: number): void {
    const v = Math.max(0, Math.min(1, t));
    this.proxTarget = v;
    if (!this.prox || this.proxSent < 0) {
      this.proxSent = v;
      return;
    }
    if (Math.abs(v - this.proxSent) < 0.006) return;
    this.proxSent = v;
    this.applyProx();
  }

  /** 佛乐接管时整条让位（0），关掉佛乐再回来（1）。淡得慢一点，别听出开关 */
  setDuck(v: number): void {
    const d = Math.max(0, Math.min(1, v));
    if (Math.abs(d - this.duck) < 0.01) return;
    this.duck = d;
    this.applyProx();
  }

  private applyProx(): void {
    if (!this.prox) return;
    const ctx = this.ctx;
    if (ctx.state === 'closed') return;
    const g = this.proxGain(this.proxSent) * this.duck;
    this.prox.gain.setTargetAtTime(g, ctx.currentTime, this.duck > 0 ? 1.1 : 0.5);
  }

  private proxGain(t: number): number {
    // 远处只剩一层底（0.3），佛前到 0.9 封顶：够近、但不会顶耳朵
    return 0.3 + 0.6 * t;
  }

  /** 250ms 一跳：把未来 1.2 秒内该响的音排进音频时间轴 */
  private schedule(): void {
    const ctx = this.ctx;
    if (ctx.state !== 'running' || !this.out) return;

    // 切后台回来时时间轴会跳很远，重新起句
    if (this.nextAt < ctx.currentTime - 1.5) {
      this.nextAt = ctx.currentTime + 0.6;
      this.cursor = 0;
    }

    while (this.nextAt < ctx.currentTime + 1.2) {
      const phrase = MANTRA_PHRASES[this.phrase];
      if (this.cursor >= phrase.length) {
        // 句末：留一段呼吸，下一句换个乐句
        if (Math.random() < 0.7) this.bowlAt(this.nextAt + 0.1);
        this.nextAt += rand(2.2, 4.4);
        this.phrase = (this.phrase + 1) % MANTRA_PHRASES.length;
        this.cursor = 0;
        continue;
      }
      const deg = phrase[this.cursor++];
      if (deg >= 0) this.pluck(this.nextAt, deg);
      this.nextAt += this.stepDur(deg < 0);
    }
  }

  /** 一个音的长短：慢，偶尔拖长、偶尔连着走两个音 */
  private stepDur(rest: boolean): number {
    if (rest) return rand(0.9, 1.4);
    const r = Math.random();
    if (r < 0.18) return 1.5 + rand(0, 0.7);
    if (r < 0.32) return 0.62 + rand(0, 0.12);
    return 1.0 + rand(0, 0.35);
  }

  /** 引磬：基音 + 几个泛音，衰减短、尾巴交给混响接住 */
  private pluck(t0: number, deg: number): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!out) return;

    const f = MANTRA_SCALE[Math.max(0, Math.min(deg, MANTRA_SCALE.length - 1))] * 2;
    const level = 0.19 * rand(0.86, 1.04);

    const g = ctx.createGain();
    g.gain.value = level;
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.45, 0.45);
    g.connect(pan);
    pan.connect(out);
    if (this.conv) pan.connect(this.conv);
    if (this.echoIn) pan.connect(this.echoIn);

    const parts: Array<[number, number, number]> = [
      [1, 0.5, 2.8], // 基音
      [2.004, 0.16, 1.7], // 八度泛音
      [3.01, 0.06, 1.0],
      [4.98, 0.025, 0.6],
      [0.5, 0.08, 2.6], // 低八度的影子，像殿角有人应和
    ];
    for (const [ratio, amp, decay] of parts) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * ratio, t0);
      osc.frequency.exponentialRampToValueAtTime(f * ratio * 0.9985, t0 + decay);
      const eg = ctx.createGain();
      eg.gain.setValueAtTime(0.0001, t0);
      eg.gain.linearRampToValueAtTime(amp, t0 + 0.012);
      eg.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(eg).connect(g);
      osc.start(t0);
      osc.stop(t0 + decay + 0.05);
    }

    // 一点“气口”，别让钟琴听起来太电子
    const n = ctx.createBufferSource();
    n.buffer = this.host.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.018, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    n.connect(bp).connect(ng).connect(g);
    n.start(t0, Math.random() * 1.5, 0.08);
  }

  /** 句末的一声小磬（D4） */
  private bowlAt(t0: number): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!out) return;

    const g = ctx.createGain();
    g.gain.value = 0.055;
    g.connect(out);
    if (this.conv) g.connect(this.conv);

    for (const [ratio, amp, decay] of [
      [1, 0.5, 6.5],
      [2.76, 0.2, 4.2],
      [5.4, 0.075, 2.4],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 293.66 * ratio;
      const eg = ctx.createGain();
      eg.gain.setValueAtTime(0.0001, t0);
      eg.gain.linearRampToValueAtTime(amp, t0 + 0.01);
      eg.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(eg).connect(g);
      osc.start(t0);
      osc.stop(t0 + decay + 0.1);
    }
  }

  /** 定时的一声磬，打断长时间的重复 */
  private bowl(): void {
    const ctx = this.ctx;
    if (ctx.state !== 'running' || !this.out) return;
    this.bowlAt(ctx.currentTime + 0.05);
  }

  /** 生成一段衰减噪声当混响脉冲响应 */
  private makeIR(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        // 前 30ms 淡入，模拟直达声之后的扩散
        const env = Math.pow(1 - i / len, decay) * Math.min(1, i / (rate * 0.03));
        d[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buf;
  }

  stop(): void {
    this.wanted = false;
    window.clearInterval(this.scheduler);
    window.clearInterval(this.bellTimer);
    const ctx = this.ctx;
    if (this.out && ctx.state !== 'closed') {
      this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
    }
    this.out = null;
    this.prox = null;
    this.conv = null;
    this.echoIn = null;
    this.version = -1;
  }
}
