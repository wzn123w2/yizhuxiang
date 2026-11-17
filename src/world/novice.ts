import * as THREE from 'three';
import { Monk } from './monk';

/**
 * 佛前的小沙弥：坐在佛坛侧边的蒲团上捻珠。
 *
 * 不做人声 TTS —— 合成人声在手机上音色不稳，也容易和殿里的梵呗打架。
 * 他“开口”的方式是：头顶浮出一句真言，配一声很轻的引磬；
 * 只有走近了才看得见、听得清，远了就只是个安静坐着的小身影。
 */

/** 以真言为主，夹两句家常的佛法；「且坐」留给这个场景 */
const LINES = [
  '唵嘛呢叭咪吽',
  '唵阿吽',
  '揭谛揭谛 · 波罗揭谛',
  '南无阿弥陀佛',
  '诸恶莫作 · 众善奉行',
  '一切有为法 · 如梦幻泡影',
  '心无挂碍 · 无有恐怖',
  '应作如是观',
  '且坐 · 且坐',
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Novice {
  readonly root = new THREE.Group();
  private monk: Monk;
  private nextAt = 0;
  private lastSpoke = -1e9;
  private lastLine = -1;
  private wasNear = false;

  /**
   * @param onSpeak 念一句时回调：main 负责把字浮到头顶、按距离补一声磬
   */
  constructor(private onSpeak: (text: string, at: THREE.Vector3) => void) {
    this.monk = new Monk(0x7a5636);
    this.monk.root.scale.setScalar(0.84);
    // 捻珠的姿态：低头、手在身前，比直挺挺坐着更像在念
    this.monk.setPose('bead');
    this.monk.setFacing(-0.4);
    this.monk.root.position.y = 0.22;
    this.root.add(this.monk.root);

    // 屁股底下的蒲团（比大殿里的坐垫小一号）
    const mat = new THREE.MeshStandardMaterial({ color: 0x6d4a34, roughness: 0.95 });
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.14, 20), mat);
    seat.position.y = 0.07;
    seat.castShadow = true;
    seat.receiveShadow = true;
    this.root.add(seat);

    // 膝前一只小木鱼
    const fish = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x6f4320, roughness: 0.62 }),
    );
    fish.scale.set(1, 0.72, 0.86);
    fish.position.set(0.32, 0.07, 0.26);
    fish.castShadow = true;
    this.root.add(fish);
  }

  placeAt(x: number, z: number, y = 0): void {
    this.root.position.set(x, y, z);
  }

  /** 头顶偏上一点，气泡从这里冒出 */
  private head(): THREE.Vector3 {
    return this.root.position.clone().add(new THREE.Vector3(0, 1.02, 0));
  }

  /** 每帧：维持呼吸动画；到点了、人又在近处，就念一句 */
  update(dt: number, t: number, playerPos: THREE.Vector3): void {
    this.monk.update(dt, t);

    const now = performance.now();
    const near = this.root.position.distanceTo(playerPos) < 16;
    if (near && !this.wasNear) {
      // 刚走近：别让人干等一整轮，几秒内先念一句
      this.wasNear = true;
      this.nextAt = now + rand(5000, 12_000);
    } else if (!near) {
      this.wasNear = false;
    }

    if (now < this.nextAt) return;
    this.nextAt = now + rand(22_000, 40_000);
    if (!near) return;
    this.speak();
  }

  /** 点他一下 / 礼佛之后回一句（有冷却，免得连点连说） */
  react(line?: string, cooldown = 2500): void {
    if (performance.now() - this.lastSpoke < cooldown) return;
    this.speak(line);
  }

  private speak(line?: string): void {
    const now = performance.now();
    if (now - this.lastSpoke < 5000) return;
    this.lastSpoke = now;
    this.onSpeak(line ?? this.pickLine(), this.head());
  }

  private pickLine(): string {
    let i = Math.floor(Math.random() * LINES.length);
    if (i === this.lastLine) i = (i + 1) % LINES.length;
    this.lastLine = i;
    return LINES[i];
  }
}
