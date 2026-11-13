import * as THREE from 'three';

export interface ControlsOptions {
  onTap: (clientX: number, clientY: number) => void;
  /** 拖动镜头时触发，用来隐藏提示 */
  onDrag?: () => void;
  /** 鼠标悬停（只在没拖动、且是鼠标时触发） */
  onHover?: (clientX: number, clientY: number) => void;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * 相机 + 输入。
 *
 * 山寺的镜头是"第三人称环绕"：
 *  - 单指拖动 / 鼠标拖动 → 环绕
 *  - 滚轮 / 双指捏合 → 远近
 *  - 轻触（未拖动）→ 交给上层做射线拾取（走 / 坐 / 上香）
 *  - 左侧摇杆 / WASD → 持续行走
 */
export class Controls {
  readonly camera: THREE.PerspectiveCamera;

  /** 相机看向的点，通常跟着角色 */
  readonly focus = new THREE.Vector3(0, 0.9, 0);

  private azimuth = 0;
  private polar = 1.26;
  private dist = 8.8;

  /** 相机不能低于这个高度，避免钻进地面 */
  minCamY = 0.7;

  /** 会挡住镜头的构件（墙体、屋顶、天花板…），由外部传入 */
  occluders: THREE.Object3D[] = [];
  /** 相机不能高于这个高度（进殿后由外部设成天花板以下） */
  maxCamY = Infinity;
  /** 被挡住时相机最近收到多近 */
  minDistClamp = 1.5;
  /** 撞到之后退让多少，避免贴面 */
  collidePadding = 0.4;

  private ray = new THREE.Raycaster();
  private ideal = new THREE.Vector3();
  private rayDir = new THREE.Vector3();

  private aziT = 0;
  private polarT = 1.26;
  private distT = 8.8;

  private dragId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private moved = 0;
  private pinchDist = 0;
  private downAt = 0;

  /** 摇杆 / WASD 的行走意图（长度 0~1） */
  readonly walk = new THREE.Vector2();
  private keys = new Set<string>();
  private stickId: number | null = null;
  private stickEl: HTMLElement | null;
  private knobEl: HTMLElement | null;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: ControlsOptions,
    stickRoot?: HTMLElement,
  ) {
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1400);
    this.stickEl = stickRoot?.querySelector('.stick-base') ?? null;
    this.knobEl = stickRoot?.querySelector('.stick-knob') ?? null;

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());

    if (this.stickEl) {
      this.stickEl.addEventListener('pointerdown', this.onStickDown);
      this.stickEl.addEventListener('pointermove', this.onStickMove);
      this.stickEl.addEventListener('pointerup', this.onStickUp);
      this.stickEl.addEventListener('pointercancel', this.onStickUp);
    }
  }

  // ————————————— 相机

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 62 : 52;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number) {
    const k = Math.min(1, dt * 7);
    // 用最短弧插值，否则角度跨过 2π 时镜头会整个转一圈
    let d = this.aziT - this.azimuth;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.azimuth += d * k;
    this.polar += (this.polarT - this.polar) * k;
    this.dist += (this.distT - this.dist) * k;

    const sp = Math.sin(this.polar);
    this.ideal.set(
      this.focus.x + Math.sin(this.azimuth) * sp * this.dist,
      this.focus.y + Math.cos(this.polar) * this.dist,
      this.focus.z + Math.cos(this.azimuth) * sp * this.dist,
    );

    // 先按高度钳制：把机位压到上限以下，并保持到注视点的距离不变，
    // 这样出来的是"更低更平"的肩后视角，而不是被顶到天花板下垂直俯视
    if (this.ideal.y > this.maxCamY) {
      const dy = Math.max(0, this.maxCamY - this.focus.y);
      const horiz = Math.sqrt(Math.max(0.04, this.dist * this.dist - dy * dy));
      const hx = this.ideal.x - this.focus.x;
      const hz = this.ideal.z - this.focus.z;
      const cur = Math.hypot(hx, hz) || 1;
      const k = horiz / cur;
      this.ideal.set(this.focus.x + hx * k, this.maxCamY, this.focus.z + hz * k);
    }

    // 相机碰撞：从注视点往理想机位打一条线，撞到屋顶/墙就收到撞点前面
    if (this.occluders.length) {
      this.rayDir.copy(this.ideal).sub(this.focus);
      const want = this.rayDir.length();
      if (want > 0.001) {
        this.rayDir.divideScalar(want);
        this.ray.set(this.focus, this.rayDir);
        this.ray.far = want;
        const hit = this.ray.intersectObjects(this.occluders, false)[0];
        if (hit && hit.distance < want) {
          const d = Math.max(this.minDistClamp, hit.distance - this.collidePadding);
          this.ideal.copy(this.focus).addScaledVector(this.rayDir, d);
        }
      }
    }

    this.camera.position.set(
      this.ideal.x,
      Math.max(this.minCamY, this.ideal.y),
      this.ideal.z,
    );
    this.camera.lookAt(this.focus);
  }

  /** 调试用：当前镜头参数 */
  debug() {
    return {
      pos: this.camera.position.toArray().map((v) => +v.toFixed(2)),
      focus: this.focus.toArray().map((v) => +v.toFixed(2)),
      azimuth: +this.azimuth.toFixed(2),
      polar: +this.polar.toFixed(2),
      dist: +this.dist.toFixed(2),
      maxCamY: this.maxCamY,
    };
  }

  /** 让镜头缓缓回到角色正后方 */
  recenterBehind(facing: number) {
    this.aziT = facing + Math.PI;
  }

  // ————————————— 触摸 / 鼠标

  private onDown = (e: PointerEvent) => {
    if (this.dragId !== null) {
      // 第二根手指 → 捏合
      this.pinchDist = this.pointerDistance(e);
      return;
    }
    this.dragId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.moved = 0;
    this.downAt = performance.now();
  };

  private pointerDistance(e: PointerEvent): number {
    return Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
  }

  private onMove = (e: PointerEvent) => {
    if (this.dragId !== e.pointerId) {
      if (e.pointerType === 'mouse') this.opts.onHover?.(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);

    if (this.moved < 4) return;
    this.opts.onDrag?.();

    this.aziT -= dx * 0.0062;
    this.polarT = clamp(this.polarT - dy * 0.0048, 0.5, 1.44);
  };

  private onUp = (e: PointerEvent) => {
    if (this.dragId !== e.pointerId) return;
    // 手指点击会有几像素抖动，阈值要比鼠标宽；长按也不算点击
    const isTouch = e.pointerType === 'touch';
    const slop = isTouch ? 14 : 8;
    const wasTap = this.moved < slop && performance.now() - this.downAt < 800;
    this.dragId = null;
    if (wasTap) this.opts.onTap(e.clientX, e.clientY);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.distT = clamp(this.distT + Math.sign(e.deltaY) * 0.7, 2.6, 16);
  };

  // ————————————— 键盘

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  /** 每帧把 WASD 折算成行走向量（摇杆优先级更高） */
  readKeyboard(): THREE.Vector2 {
    const v = new THREE.Vector2();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) v.y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) v.y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) v.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) v.x += 1;
    if (v.lengthSq() > 0) v.normalize();
    return v;
  }

  // ————————————— 摇杆

  private onStickDown = (e: PointerEvent) => {
    this.stickId = e.pointerId;
    try {
      this.stickEl?.setPointerCapture(e.pointerId);
    } catch {
      /* 某些环境的合成事件没有真实 pointer，捕获会抛错，忽略即可 */
    }
    this.applyStick(e);
  };

  private onStickMove = (e: PointerEvent) => {
    if (this.stickId !== e.pointerId) return;
    this.applyStick(e);
  };

  private onStickUp = (e: PointerEvent) => {
    if (this.stickId !== e.pointerId) return;
    this.stickId = null;
    this.walk.set(0, 0);
    if (this.knobEl) this.knobEl.style.transform = 'translate(0px, 0px)';
  };

  private applyStick(e: PointerEvent) {
    if (!this.stickEl) return;
    const r = this.stickEl.getBoundingClientRect();
    const max = r.width * 0.36;
    if (max <= 1) return; // 摇杆还没布局出来，别把 walk 算成 NaN
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.walk.set(dx / max, dy / max);
    if (this.knobEl) this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
