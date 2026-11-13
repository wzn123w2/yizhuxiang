import * as THREE from 'three';

export type Pose = 'idle' | 'walk' | 'sit' | 'bow' | 'anjali' | 'bead' | 'incense';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * 小沙弥：全部由基本几何体拼出来，不依赖模型文件。
 * 动画是"目标值 + 插值"：每个姿态给一组目标角度，每帧向目标靠拢，
 * 这样切换姿态天然带过渡，不需要动画剪辑。
 */
export class Monk {
  readonly root = new THREE.Group();

  private body = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private robeMesh!: THREE.Mesh;

  private pose: Pose = 'idle';
  private time = 0;

  // 当前值（插值用）
  private cur = { bodyY: 0, tiltX: 0, headX: 0, armLX: 0, armLZ: 0, armRX: 0, armRZ: 0, squash: 1 };
  // 目标值
  private tgt = { bodyY: 0, tiltX: 0, headX: 0, armLX: 0, armLZ: 0, armRX: 0, armRZ: 0, squash: 1 };

  constructor(robeColor = 0x6b4a35) {
    const skin = new THREE.MeshStandardMaterial({ color: 0xe4c5a2, roughness: 0.72 });
    const robe = new THREE.MeshStandardMaterial({ color: robeColor, roughness: 0.88 });
    const robeDark = new THREE.MeshStandardMaterial({ color: 0x4a3325, roughness: 0.9 });
    const bead = new THREE.MeshStandardMaterial({ color: 0x2e2419, roughness: 0.55 });

    this.root.add(this.body);

    // 身子（偏圆的 Q 版比例）
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 16), robe);
    torso.scale.set(1, 1.06, 0.92);
    torso.position.y = 0.42;
    torso.castShadow = true;
    this.body.add(torso);
    this.robeMesh = torso;

    // 下摆
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.22, 18), robeDark);
    skirt.position.y = 0.12;
    skirt.castShadow = true;
    this.body.add(skirt);

    // 领口
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 16), robeDark);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.72;
    this.body.add(collar);

    // 挂在脖子上的念珠
    const mala = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.026, 6, 20), bead);
    mala.rotation.x = Math.PI / 2.35;
    mala.position.set(0, 0.63, 0.04);
    this.body.add(mala);

    // 头
    this.head.position.y = 0.86;
    this.body.add(this.head);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.28, 22, 18), skin);
    skull.castShadow = true;
    this.head.add(skull);

    // 耳朵（贴紧头侧，避免从背后看像"长了眼睛"）
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), skin);
      ear.scale.set(0.55, 1, 0.75);
      ear.position.set(sx * 0.248, -0.02, 0);
      this.head.add(ear);
    }

    // 眼睛（两点，很淡，避免太"卡通"）
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x241a12 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), eyeMat);
      eye.scale.set(1, 1.3, 0.5);
      eye.position.set(sx * 0.1, 0.01, 0.265);
      this.head.add(eye);
    }

    // 手臂
    for (const [arm, sx] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as Array<[THREE.Group, number]>) {
      arm.position.set(sx * 0.4, 0.56, 0.06);
      const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.26, 4, 10), robe);
      cap.position.y = -0.18;
      cap.castShadow = true;
      arm.add(cap);

      // 手掌只露出一小截，比之前的白球自然很多
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 9, 7), skin);
      hand.position.y = -0.33;
      arm.add(hand);

      this.body.add(arm);
    }

    this.applyPose('idle');
  }

  setPose(p: Pose) {
    this.pose = p;
    this.applyPose(p);
  }

  get currentPose(): Pose {
    return this.pose;
  }

  private applyPose(p: Pose) {
    switch (p) {
      case 'idle':
        this.tgt = { bodyY: 0, tiltX: 0, headX: 0, armLX: 0, armLZ: -0.14, armRX: 0, armRZ: 0.14, squash: 1 };
        break;
      case 'walk':
        this.tgt = { bodyY: 0, tiltX: 0.06, headX: 0, armLX: 0, armLZ: -0.2, armRX: 0, armRZ: 0.2, squash: 1 };
        break;
      case 'sit':
        this.tgt = { bodyY: -0.08, tiltX: 0, headX: -0.04, armLX: -0.62, armLZ: -0.34, armRX: -0.62, armRZ: 0.34, squash: 0.9 };
        break;
      case 'bow':
        this.tgt = { bodyY: -0.1, tiltX: 0.72, headX: 0.34, armLX: -0.4, armLZ: -0.36, armRX: -0.4, armRZ: 0.36, squash: 0.96 };
        break;
      case 'anjali':
        this.tgt = { bodyY: -0.01, tiltX: 0.1, headX: 0.14, armLX: -1.45, armLZ: -0.52, armRX: -1.45, armRZ: 0.52, squash: 1 };
        break;
      case 'bead':
        this.tgt = { bodyY: -0.02, tiltX: 0.14, headX: 0.26, armLX: -1.0, armLZ: -0.42, armRX: -1.0, armRZ: 0.42, squash: 1 };
        break;
      case 'incense':
        this.tgt = { bodyY: 0, tiltX: 0.08, headX: 0.1, armLX: -1.3, armLZ: -0.34, armRX: -1.3, armRZ: 0.34, squash: 1 };
        break;
    }
  }

  update(dt: number, t: number) {
    this.time = t;
    const k = Math.min(1, dt * 9);

    this.cur.bodyY = lerp(this.cur.bodyY, this.tgt.bodyY, k);
    this.cur.tiltX = lerp(this.cur.tiltX, this.tgt.tiltX, k);
    this.cur.headX = lerp(this.cur.headX, this.tgt.headX, k);
    this.cur.armLX = lerp(this.cur.armLX, this.tgt.armLX, k);
    this.cur.armLZ = lerp(this.cur.armLZ, this.tgt.armLZ, k);
    this.cur.armRX = lerp(this.cur.armRX, this.tgt.armRX, k);
    this.cur.armRZ = lerp(this.cur.armRZ, this.tgt.armRZ, k);
    this.cur.squash = lerp(this.cur.squash, this.tgt.squash, k);

    let bob = 0;
    let sway = 0;
    let armSwing = 0;

    if (this.pose === 'walk') {
      bob = Math.abs(Math.sin(t * 7.4)) * 0.045;
      sway = Math.sin(t * 7.4) * 0.035;
      armSwing = Math.sin(t * 7.4) * 0.55;
    } else if (this.pose === 'idle' || this.pose === 'sit') {
      // 极轻微的呼吸
      bob = Math.sin(t * 1.15) * 0.008;
      sway = Math.sin(t * 0.62) * 0.012;
    } else if (this.pose === 'bow') {
      // 跪拜是持续的：反复下伏
      const cycle = (t * 0.55) % 1;
      const dip = cycle < 0.55 ? Math.sin((cycle / 0.55) * Math.PI * 0.5) : Math.cos(((cycle - 0.55) / 0.45) * Math.PI * 0.5);
      this.body.rotation.x = this.cur.tiltX * dip;
      this.head.rotation.x = this.cur.headX * dip;
      this.body.position.y = this.cur.bodyY * dip;
      this.body.scale.y = this.cur.squash;
      this.armL.rotation.set(this.cur.armLX, 0, this.cur.armLZ);
      this.armR.rotation.set(this.cur.armRX, 0, this.cur.armRZ);
      return;
    } else if (this.pose === 'bead') {
      // 捻珠时手有极小的往复
      const m = Math.sin(t * 2.4) * 0.06;
      this.armL.rotation.set(this.cur.armLX + m, 0, this.cur.armLZ);
      this.armR.rotation.set(this.cur.armRX - m, 0, this.cur.armRZ);
      this.head.rotation.x = this.cur.headX;
      this.body.rotation.x = this.cur.tiltX;
      this.body.position.y = this.cur.bodyY;
      this.body.scale.y = this.cur.squash;
      return;
    } else if (this.pose === 'anjali') {
      const m = Math.sin(t * 1.6) * 0.03;
      this.armL.rotation.set(this.cur.armLX - m, 0, this.cur.armLZ);
      this.armR.rotation.set(this.cur.armRX - m, 0, this.cur.armRZ);
      this.head.rotation.x = this.cur.headX;
      this.body.rotation.x = this.cur.tiltX;
      this.body.position.y = this.cur.bodyY;
      this.body.scale.y = this.cur.squash;
      return;
    }

    this.body.rotation.x = this.cur.tiltX;
    this.body.rotation.z = sway;
    this.body.position.y = this.cur.bodyY + bob;
    this.body.scale.y = this.cur.squash;
    this.head.rotation.x = this.cur.headX;
    this.head.rotation.z = -sway * 0.6;
    this.armL.rotation.set(this.cur.armLX + armSwing, 0, this.cur.armLZ);
    this.armR.rotation.set(this.cur.armRX - armSwing, 0, this.cur.armRZ);

    // 呼吸时轻微改变圆润度，让静止也有生命感
    this.robeMesh.scale.set(1, 1.06 + Math.sin(t * 1.15) * 0.012, 0.92);
  }

  /** 面向某个世界坐标方向（弧度，绕 Y 轴） */
  faceTo(angle: number, dt: number) {
    const d = ((angle - this.root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.root.rotation.y += d * Math.min(1, dt * 8);
  }

  setFacing(angle: number) {
    this.root.rotation.y = angle;
  }
}
