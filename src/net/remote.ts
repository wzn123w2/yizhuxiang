/**
 * 别的同修：一个 Monk + 头顶名牌 + 目标位姿插值。
 *
 * 网络只给"目的地"，中间的路由本地补：
 * 位置指数插值、朝向走最短弧、坐姿压到 0.22、y 跟着地形走。
 */

import * as THREE from 'three';
import { Monk, type Pose } from '../world/monk';
import type { RemoteInfo, SnapEntry } from './client';

export interface GroundFn {
  groundHeightAt(x: number, z: number): number;
}

/** 最近更新时刻，用来判断对方是不是"停在原地" */
const STALE_MS = 1200;

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 头顶名牌：一张 canvas 贴图，中文字体走系统字 */
function makeNameplate(name: string): THREE.Sprite {
  const text = name.slice(0, 12) || '同修';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fontPx = 30;
  const padX = 16;
  const padY = 10;

  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `600 ${fontPx}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
  const tw = Math.ceil(measure.measureText(text).width);

  const w = Math.ceil((tw + padX * 2) * dpr);
  const h = Math.ceil((fontPx + padY * 2) * dpr);

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const bw = w / dpr;
  const bh = h / dpr;
  const r = bh / 2;

  ctx.fillStyle = 'rgba(6, 10, 15, 0.62)';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(bw - r, 0);
  ctx.arcTo(bw, 0, bw, r, r);
  ctx.lineTo(bw, bh - r);
  ctx.arcTo(bw, bh, bw - r, bh, r);
  ctx.lineTo(r, bh);
  ctx.arcTo(0, bh, 0, bh - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.fill();

  ctx.strokeStyle = 'rgba(200, 168, 107, 0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = `600 ${fontPx}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(238, 224, 196, 0.95)';
  ctx.fillText(text, bw / 2, bh / 2 + 1);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: false, // 隔着柱子也能看见名字，方便找人
  });
  const sp = new THREE.Sprite(mat);
  const plateH = 0.24; // 屏幕上的高度（世界单位）
  sp.scale.set((bw / bh) * plateH, plateH, 1);
  sp.position.set(0, 1.62, 0);
  sp.renderOrder = 20;
  sp.userData.name = text;
  return sp;
}

export class RemotePlayer {
  readonly monk: Monk;
  private label: THREE.Sprite;

  private tx: number;
  private tz: number;
  private tr: number;
  private tSeat: number | null;
  private tPose: Pose;

  private y = Number.NaN;
  private pose: Pose = 'idle';
  private lastAt = performance.now();

  constructor(info: RemoteInfo) {
    this.monk = new Monk(info.robe || 0x6b4a35);
    this.label = makeNameplate(info.name);
    this.monk.root.add(this.label);

    this.tx = info.x;
    this.tz = info.z;
    this.tr = info.r;
    this.tSeat = info.seat;
    this.tPose = info.pose;

    this.monk.root.position.set(info.x, 0, info.z);
    this.monk.root.rotation.y = info.r;
    this.monk.setPose(info.pose);
    this.pose = info.pose;
  }

  get name() {
    return this.label.userData.name as string;
  }

  get stale() {
    return performance.now() - this.lastAt > STALE_MS;
  }

  get seat(): number | null {
    return this.tSeat;
  }

  setTarget(e: SnapEntry) {
    this.tx = e.x;
    this.tz = e.z;
    this.tr = e.r;
    this.tSeat = e.seat;
    this.tPose = e.pose;
    this.lastAt = performance.now();

    if (e.pose !== this.pose) {
      this.pose = e.pose;
      this.monk.setPose(e.pose);
    }
  }

  update(dt: number, t: number, ground: GroundFn) {
    const root = this.monk.root;
    const k = 1 - Math.exp(-dt * 9);
    root.position.x += (this.tx - root.position.x) * k;
    root.position.z += (this.tz - root.position.z) * k;

    root.rotation.y += shortestAngle(root.rotation.y, this.tr) * Math.min(1, dt * 10);

    // 坐着就压到坐垫高度，站着跟着地形（台阶/庭院有高差）
    const ty = this.tSeat !== null ? 0.22 : ground.groundHeightAt(root.position.x, root.position.z);
    this.y = Number.isNaN(this.y) ? ty : this.y + (ty - this.y) * Math.min(1, dt * 12);
    root.position.y = this.y;

    this.monk.update(dt, t);
  }

  /** 大致身高位置，用来放飘字 */
  head(): THREE.Vector3 {
    return this.monk.root.position.clone().add(new THREE.Vector3(0, 1.2, 0));
  }

  dispose() {
    this.monk.root.remove(this.label);
    this.label.material.map?.dispose();
    this.label.material.dispose();
  }
}
