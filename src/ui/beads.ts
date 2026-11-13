/**
 * 念珠面板：一条横向珠串。
 * 顺着拖动 / 滚轮 / 空格 / E，每跨过一颗珠子记一次，每轮 108 颗。
 * 也可以开「自动」，珠子会按一个不太规整的节奏自己往下走。
 *
 * 手感要点：
 *  - 珠子要"跟着手指走"（位移同步），而不是点一下跳一格
 *  - 每颗过中心线时给一次极短的木珠声
 *  - pos 用浮点 + 缓动，避免数字跳变导致的僵硬
 */

const BEAD_STEP = 26;
const ROUND = 108;

export interface BeadsOptions {
  onTick: () => void;
  onRound: () => void;
}

export class BeadsUI {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;

  private pos = 0; // 已跨过的珠数（浮点）
  private posShown = 0;
  private acc = 0;
  private total = 0;

  private dragging = false;
  private lastX = 0;
  private open = false;

  /** 自动捻珠：开着就按节拍自己拨 */
  private auto = false;
  /** 下一颗的时刻 */
  private autoNext = 0;
  /** 自动拨过的颗数（本次） */
  private autoSession = 0;
  /** 最近一次过珠的时刻，用来做中心的一点余辉 */
  private lastTickAt = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: BeadsOptions,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('resize', this.resize);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  get isOpen() {
    return this.open;
  }

  get isAuto() {
    return this.auto;
  }

  get session() {
    return this.autoSession;
  }

  get count(): number {
    return this.total;
  }

  setOpen(v: boolean) {
    this.open = v;
  }

  /** 存档里的累计数 */
  setTotal(n: number) {
    this.total = n;
    this.pos = 0;
    this.posShown = 0;
    this.emit();
  }

  /** 空格 / E / 自动 */
  step(dir = 1) {
    this.pos += dir;
    this.total += 1;
    this.lastTickAt = performance.now();
    this.opts.onTick();
    this.checkRound();
    this.emit();
  }

  /**
   * 自动捻珠。开的时候先拨一颗，立刻有反馈；
   * 之后每颗之间的间隔带一点随机，别像节拍器。
   */
  setAuto(on: boolean) {
    if (this.auto === on) return;
    this.auto = on;
    this.autoSession = 0;
    if (on) {
      this.step(1);
      this.autoSession = 1;
      this.autoNext = performance.now() + this.nextAutoInterval();
    }
    this.emit();
  }

  private nextAutoInterval() {
    // 比木鱼密一点：大约 0.62 ~ 0.92 秒一颗
    return 620 + Math.random() * 300;
  }

  private checkRound() {
    if (this.pos > 0 && Math.floor(this.pos) % ROUND === 0) {
      this.opts.onRound();
    }
  }

  private emit() {
    const num = document.getElementById('bead-num');
    const round = document.getElementById('bead-round');
    if (num) num.textContent = String(Math.floor(this.pos) % ROUND);
    if (round) round.textContent = `第 ${Math.floor(this.pos / ROUND) + 1} 圈`;
  }

  private resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width || 320;
    this.h = rect.height || 84;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    this.lastX = e.clientX;
    this.acc += dx;
    // 向左拖 = 往前拨珠
    while (this.acc <= -BEAD_STEP) {
      this.acc += BEAD_STEP;
      this.pos += 1;
      this.total += 1;
      this.opts.onTick();
      this.checkRound();
    }
    while (this.acc >= BEAD_STEP) {
      this.acc -= BEAD_STEP;
      this.pos -= 1;
      if (this.pos < 0) this.pos = 0;
    }
    this.emit();
  };

  private onUp = (e: PointerEvent) => {
    this.dragging = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.acc += e.deltaY * 0.6;
    while (this.acc >= BEAD_STEP) {
      this.acc -= BEAD_STEP;
      this.pos += 1;
      this.total += 1;
      this.opts.onTick();
      this.checkRound();
    }
    while (this.acc <= -BEAD_STEP) {
      this.acc += BEAD_STEP;
      this.pos -= 1;
      if (this.pos < 0) this.pos = 0;
    }
    this.emit();
  };

  private loop = (now: number) => {
    // 自动：到点就拨一颗；手指按着的时候先让位给人
    if (this.auto && !this.dragging && now >= this.autoNext) {
      this.autoNext = now + this.nextAutoInterval();
      this.step(1);
      this.autoSession++;
    }

    // 自动时走得更“顺”，像珠子在慢慢流过去
    this.posShown += (this.pos - this.posShown) * (this.auto ? 0.055 : 0.22);
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(now: number) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const cy = h * 0.52;
    const cx = w / 2;

    // 中心刻痕（过珠线）；过珠后的一小段时间里留一点余辉
    const glow = Math.max(0, 1 - (now - this.lastTickAt) / 620);
    ctx.strokeStyle = `rgba(232, 180, 106, ${0.35 + glow * 0.4})`;
    ctx.lineWidth = 1 + glow * 0.8;
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.1);
    ctx.lineTo(cx, h * 0.94);
    ctx.stroke();

    const span = Math.ceil(w / BEAD_STEP / 2) + 2;
    const base = Math.floor(this.posShown);

    for (let i = -span; i <= span; i++) {
      const idx = base + i;
      const x = cx + (idx - this.posShown) * BEAD_STEP + BEAD_STEP / 2;
      if (x < -BEAD_STEP || x > w + BEAD_STEP) continue;

      // 越靠中心越大越亮
      const d = Math.abs(x - cx) / (w / 2);
      const near = Math.max(0, 1 - d * 1.15);
      const r = 7 * (0.72 + near * 0.5);

      // 珠子按弧线排列，中间略高
      const y = cy - Math.cos((x - cx) / (w / 2) * 0.9) * 4 + 4;

      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x, y, r * 1.5);
      const l = 0.3 + near * 0.55;
      g.addColorStop(0, `rgba(${200 + near * 40}, ${150 + near * 36}, ${86 + near * 26}, ${l})`);
      g.addColorStop(1, 'rgba(46, 32, 19, 0.9)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      if (near > 0.55) {
        ctx.fillStyle = `rgba(255, 220, 160, ${(near - 0.55) * 0.34})`;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.85, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 两端渐隐，避免珠子在边界被切断
    const leftFade = ctx.createLinearGradient(0, 0, 34, 0);
    leftFade.addColorStop(0, 'rgba(6,10,15,1)');
    leftFade.addColorStop(1, 'rgba(6,10,15,0)');
    ctx.fillStyle = leftFade;
    ctx.fillRect(0, 0, 34, h);

    const rightFade = ctx.createLinearGradient(w - 34, 0, w, 0);
    rightFade.addColorStop(0, 'rgba(6,10,15,0)');
    rightFade.addColorStop(1, 'rgba(6,10,15,1)');
    ctx.fillStyle = rightFade;
    ctx.fillRect(w - 34, 0, 34, h);
  }

  dispose() {
    this.auto = false;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('resize', this.resize);
  }
}
