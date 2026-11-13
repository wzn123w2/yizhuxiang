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

// ————————————————————————————— 唱诵（五声音阶的单声部吟唱 + 殿内混响）

/**
 * 男声唱诵的常用音区，五声音阶 D3–D4。
 * 大悲咒那一路的念白感，靠的就三样：单声部、级进为主、句尾落回主音。
 */
const CHANT_SCALE = [146.83, 174.61, 196.0, 220.0, 261.63, 293.66];

/** 元音共振峰 F1/F2/F3 与相对权重（阿、嗡、诶、乌、姆） */
const VOWELS: Array<{ f: [number, number, number]; w: [number, number, number]; p: number }> = [
  { f: [730, 1090, 2440], w: [1, 0.5, 0.22], p: 0.34 }, // 阿
  { f: [470, 820, 2400], w: [1, 0.45, 0.2], p: 0.26 }, // 嗡
  { f: [390, 1600, 2500], w: [1, 0.4, 0.18], p: 0.14 }, // 诶
  { f: [320, 700, 2350], w: [1, 0.35, 0.15], p: 0.1 }, // 乌
  { f: [250, 1150, 2300], w: [1, 0.25, 0.12], p: 0.16 }, // 姆
];

function pickVowel() {
  let r = Math.random();
  for (const v of VOWELS) {
    r -= v.p;
    if (r <= 0) return v;
  }
  return VOWELS[0];
}

export class Chant {
  private out: GainNode | null = null;
  private conv: ConvolverNode | null = null;
  private version = -1;
  private scheduler = 0;
  private bellTimer = 0;
  private nextAt = 0;
  private phraseLeft = 0;
  private degree = 2;
  private prevFreq = CHANT_SCALE[2];
  private wanted = false;

  constructor(private host: AudioHost) {
    host.onRebuild(() => {
      this.out = null;
      this.conv = null;
      this.version = -1;
      if (this.wanted) this.start();
    });
  }

  start(): void {
    this.wanted = true;
    const ctx = this.host.ctx;
    if (ctx.state !== 'running') return;
    if (this.out && this.version === this.host.version) return;

    const out = ctx.createGain();
    out.gain.value = 0;
    // 音符叠起来时别顶到 0dB：一个温和的压缩当限幅
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 8;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.012;
    comp.release.value = 0.35;
    out.connect(comp).connect(this.host.chantBus);
    out.gain.setTargetAtTime(0.5, ctx.currentTime, 3.0);

    // 殿内混响：一段指数衰减的噪声当脉冲响应，唱诵才不会贴在耳朵上
    const conv = ctx.createConvolver();
    conv.buffer = this.makeIR(ctx, 3.6, 2.9);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    conv.connect(wet).connect(out);

    // ——— 低音持续层：只做"有人在殿里"的底，不抢唱诵
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 460;
    lp.Q.value = 0.5;
    lp.connect(out);

    [73.42, 110.0].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      g.gain.value = 0.11 / (i + 1);
      osc.connect(g).connect(lp);
      osc.start();

      // 两位"法师"的呼吸周期不同
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.045 + Math.random() * 0.05;
      const lg = ctx.createGain();
      lg.gain.value = 0.05 / (i + 1);
      lfo.connect(lg).connect(g.gain);
      lfo.start();
    });

    // 极慢的滤波扫动，让低音不死板
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.031;
    const sg = ctx.createGain();
    sg.gain.value = 180;
    sweep.connect(sg).connect(lp.frequency);
    sweep.start();

    this.out = out;
    this.conv = conv;
    this.version = this.host.version;

    // ——— 唱诵调度：先排好一小段，别等到点了才发
    this.degree = 2;
    this.prevFreq = CHANT_SCALE[this.degree];
    this.phraseLeft = 0;
    this.nextAt = ctx.currentTime + 0.6;
    window.clearInterval(this.scheduler);
    this.scheduler = window.setInterval(() => this.schedule(), 200);

    window.clearInterval(this.bellTimer);
    this.bellTimer = window.setInterval(() => this.chime(), 43_000);
  }

  /** 200ms 一跳：把未来 0.8 秒内该唱的字排进音频时间轴 */
  private schedule(): void {
    const ctx = this.host.ctx;
    if (ctx.state !== 'running' || !this.out) return;

    // 切后台回来时时间轴会跳很远，重新起句
    if (this.nextAt < ctx.currentTime - 1.5) {
      this.nextAt = ctx.currentTime + 0.4;
      this.phraseLeft = 0;
    }

    while (this.nextAt < ctx.currentTime + 0.8) {
      if (this.phraseLeft <= 0) {
        // 换气：一句唱完了，停 1.4~2.6 秒
        this.nextAt += rand(1.4, 2.6);
        this.phraseLeft = 7 + Math.floor(Math.random() * 6);
        continue;
      }
      this.syllable(this.nextAt);
      this.nextAt += this.stepDur();
      this.phraseLeft--;
    }
  }

  /** 一个字的长短：四分音附近，带点人味 */
  private stepDur(): number {
    const r = Math.random();
    if (r < 0.1) return 1.05 + rand(0, 0.35); // 偶尔拖长一拍
    if (r < 0.24) return 0.26 + rand(0, 0.06); // 偶尔连着念快
    return 0.42 + rand(0, 0.2);
  }

  /** 旋律：以级进为主，句尾落回主音附近，偶尔往上挑一句 */
  private nextDegree(): number {
    const last = this.degree;
    let step = 0;
    const r = Math.random();
    if (r < 0.34) step = 0; // 念白：常停在同一个音上
    else if (r < 0.78) step = Math.random() < 0.5 ? -1 : 1;
    else if (r < 0.94) step = Math.random() < 0.5 ? -2 : 2;
    else step = 3;

    let d = last + step;
    // 往上挑之后要落回来，不然越唱越高
    if (d > 5) d = 5 - Math.floor(Math.random() * 2);
    if (d < 0) d = Math.floor(Math.random() * 2);

    // 句尾三字更容易回到主音
    if (this.phraseLeft <= 3 && Math.random() < 0.6) {
      d = Math.random() < 0.5 ? 0 : 1;
    }
    this.degree = d;
    return d;
  }

  /** 唱一个字：锯齿波走共振峰，前面带一点气声当辅音 */
  private syllable(t0: number): void {
    const ctx = this.host.ctx;
    const out = this.out;
    if (!out) return;

    const degree = this.nextDegree();
    const target = CHANT_SCALE[degree] * rand(0.996, 1.004);
    const dur = this.stepDur() * rand(0.86, 1.0);
    const v = pickVowel();
    const from = this.prevFreq;
    this.prevFreq = target;

    const amp = ctx.createGain();
    amp.gain.value = 0;
    // 低通一下，剪掉锯齿波的高次谐波，不然像合成器
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3100;
    tone.Q.value = 0.55;
    amp.connect(tone);
    tone.connect(out);
    if (this.conv) tone.connect(this.conv);

    // 音高过渡（滑音）+ 慢颤音
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(from, t0);
    src.frequency.exponentialRampToValueAtTime(target, t0 + 0.085);

    // 第二个声部：微微失谐，出来一点"几个人一起念"的合唱感
    const src2 = ctx.createOscillator();
    src2.type = 'sawtooth';
    const f2 = target * 0.9965;
    src2.frequency.setValueAtTime(from * 0.9965, t0 + 0.012);
    src2.frequency.exponentialRampToValueAtTime(f2, t0 + 0.095);
    const g2 = ctx.createGain();
    g2.gain.value = 0.42;
    src2.connect(g2);

    const vib = ctx.createOscillator();
    vib.frequency.value = rand(4.4, 5.6);
    const vibGain = ctx.createGain();
    vibGain.gain.setValueAtTime(0, t0);
    vibGain.gain.linearRampToValueAtTime(target * rand(0.004, 0.009), t0 + 0.35);
    vib.connect(vibGain).connect(src.frequency);
    vib.start(t0);
    vib.stop(t0 + dur + 0.5);

    // 三个共振峰并联，拼出元音
    v.f.forEach((f, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 7.5 + i * 2;
      const g = ctx.createGain();
      g.gain.value = v.w[i] * 1.05;
      src.connect(bp).connect(g).connect(amp);
      g2.connect(bp);
    });

    // 一点基频本体，避免只听见"嗡嗡"的滤器声
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(from, t0);
    body.frequency.exponentialRampToValueAtTime(target, t0 + 0.085);
    const bg = ctx.createGain();
    bg.gain.value = 0.15;
    body.connect(bg).connect(amp);
    body.start(t0);
    body.stop(t0 + dur + 0.4);

    // 气声辅音
    const breath = ctx.createBufferSource();
    breath.buffer = this.host.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(1400, 2600);
    bp.Q.value = 1.4;
    const bgn = ctx.createGain();
    bgn.gain.setValueAtTime(0.0001, t0);
    bgn.gain.linearRampToValueAtTime(0.035, t0 + 0.02);
    bgn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
    breath.connect(bp).connect(bgn).connect(amp);
    breath.start(t0, Math.random() * 1.5, 0.14);

    // 包络：起音慢、尾巴留一点给混响
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(0.38, t0 + 0.075);
    amp.gain.linearRampToValueAtTime(0.26, t0 + Math.min(0.3, dur * 0.6));
    amp.gain.setValueAtTime(0.26, t0 + dur);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.26);

    src.start(t0);
    src.stop(t0 + dur + 0.3);
    src2.start(t0 + 0.012);
    src2.stop(t0 + dur + 0.3);

    // 节点用完就丢，别越堆越多
    src.onended = () => {
      amp.disconnect();
      tone.disconnect();
      body.disconnect();
      bg.disconnect();
      breath.disconnect();
    };
  }

  /** 唱诵里偶尔出现的一声小磬 */
  private chime(): void {
    const ctx = this.host.ctx;
    if (ctx.state !== 'running' || !this.out) return;
    const t0 = ctx.currentTime + 0.01;
    const out = ctx.createGain();
    out.gain.value = 0.075;
    out.connect(this.out);
    if (this.conv) out.connect(this.conv);

    for (const [ratio, level, decay] of [
      [1, 0.5, 5.2],
      [2.76, 0.22, 3.4],
      [5.4, 0.1, 2.2],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 196 * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(level, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + decay + 0.1);
    }
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
    const ctx = this.host.ctx;
    if (this.out && ctx.state !== 'closed') {
      this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
    }
    this.out = null;
    this.conv = null;
    this.version = -1;
  }
}
