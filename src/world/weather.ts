/**
 * 天气特效：云、雨、雪、地面的雨滴涟漪。
 *
 * 只负责"飘着的东西"；天空颜色、雾、光照、雪盖由 temple.setWeather() 管。
 * 所有贴图都是现场画的（不引外部资源），粒子在相机周围回收复用。
 *
 * 一条规则：雨和雪不落进殿里 —— 殿有屋顶，粒子的重生点会避开殿的平面范围，
 * 涟漪也只出现在庭院（groundHeightAt < -0.5 的地方）。
 */

import * as THREE from 'three';
import type { WeatherKind } from '../core/weather';

const RAIN_N = 1400;
const SNOW_N = 1200;
const RIPPLE_N = 26;
const CLOUD_N = 16;

/** 天气 → 云量 / 云色 */
const CLOUD_TARGET: Record<WeatherKind, { amt: number; tint: number }> = {
  clear: { amt: 0.12, tint: 0xffffff },
  partly: { amt: 0.5, tint: 0xf2f6fa },
  cloudy: { amt: 0.8, tint: 0xc9d3dc },
  overcast: { amt: 1, tint: 0xaab5bf },
  fog: { amt: 0.85, tint: 0xd4dbe1 },
  rain: { amt: 0.95, tint: 0x94a1ad },
  snow: { amt: 0.9, tint: 0xdbe2e8 },
  thunder: { amt: 1, tint: 0x7d8894 },
};

function makeCloudTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 24; i++) {
    const x = 26 + Math.random() * (W - 52);
    const y = 42 + Math.random() * (H - 62);
    const r = 16 + Math.random() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeFlakeTexture(): THREE.CanvasTexture {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeRippleTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.translate(S / 2, S / 2);
  for (const [r, w, a] of [
    [46, 5, 0.55],
    [30, 3, 0.28],
  ] as const) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
  g.addColorStop(0, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class WeatherVfx {
  private kind: WeatherKind = 'clear';

  private clouds: THREE.Sprite[] = [];
  private cloudMat: THREE.SpriteMaterial;
  private cloudTint = new THREE.Color(0xffffff);
  private cloudAmt = 0.12;

  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainState: Float32Array; // x, y, z, speed

  private snow: THREE.Points;
  private snowPos: Float32Array;
  private snowState: Float32Array; // x, y, z, speed, phase

  private ripples: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; life: number }> = [];
  private rippleTimer = 0;

  private rainAmt = 0;
  private snowAmt = 0;

  constructor(
    private scene: THREE.Scene,
    private groundHeightAt: (x: number, z: number) => number,
  ) {
    // ——— 云
    const cloudTex = makeCloudTexture();
    this.cloudMat = new THREE.SpriteMaterial({
      map: cloudTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.3,
      color: new THREE.Color(0xffffff),
    });
    for (let i = 0; i < CLOUD_N; i++) {
      const s = new THREE.Sprite(this.cloudMat);
      s.userData.angle = (i / CLOUD_N) * Math.PI * 2 + Math.random() * 0.4;
      s.userData.radius = 135 + Math.random() * 80;
      // 相机默认俯角约 18°，视野上沿只到地平线上 9° 左右：
      // 云要贴着地平线放（10~24m 高、150m 外 ≈ 3~8°），不然根本看不到
      s.userData.alt = 10 + Math.random() * 30;
      s.userData.speed = 0.5 + Math.random() * 0.9;
      const w = 80 + Math.random() * 90;
      s.scale.set(w, w * 0.4, 1);
      this.clouds.push(s);
      this.scene.add(s);
    }

    // ——— 雨（每条雨丝两个顶点）
    this.rainPos = new Float32Array(RAIN_N * 6);
    this.rainState = new Float32Array(RAIN_N * 4);
    for (let i = 0; i < RAIN_N; i++) {
      this.resetRain(i, 0, 30, true);
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(
      rainGeo,
      new THREE.LineBasicMaterial({
        color: 0xaec4d6,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      }),
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);

    // ——— 雪
    this.snowPos = new Float32Array(SNOW_N * 3);
    this.snowState = new Float32Array(SNOW_N * 5);
    for (let i = 0; i < SNOW_N; i++) this.resetSnow(i, 0, 30, true);
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(
      snowGeo,
      new THREE.PointsMaterial({
        map: makeFlakeTexture(),
        color: 0xffffff,
        size: 0.16,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.scene.add(this.snow);

    // ——— 涟漪：一张带两圈水纹的贴图，压扁放在地面上
    const rippleTex = makeRippleTexture();
    const rippleGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < RIPPLE_N; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: rippleTex,
        color: 0xdfeefb,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(rippleGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.ripples.push({ mesh, mat, t: 0, life: 1 });
    }
  }

  set(kind: WeatherKind) {
    this.kind = kind;
  }

  /** 找一个不在殿内的重生点（殿内有屋顶，不该下雨下雪） */
  private spawnXZ(cx: number, cz: number): [number, number] {
    for (let i = 0; i < 8; i++) {
      const x = cx + (Math.random() - 0.5) * 64;
      const z = cz + (Math.random() - 0.5) * 64;
      if (Math.abs(x) < 14 && z > -11 && z < 11.5) continue;
      return [x, z];
    }
    return [cx + (Math.random() - 0.5) * 40, cz + 14 + Math.random() * 20];
  }

  private resetRain(i: number, cx: number, cz: number, anywhere = false) {
    const [x, z] = this.spawnXZ(cx, cz);
    const y = anywhere ? Math.random() * 26 : 20 + Math.random() * 8;
    const speed = 13 + Math.random() * 7;
    const o = i * 4;
    this.rainState[o] = x;
    this.rainState[o + 1] = y;
    this.rainState[o + 2] = z;
    this.rainState[o + 3] = speed;
  }

  private resetSnow(i: number, cx: number, cz: number, anywhere = false) {
    const [x, z] = this.spawnXZ(cx, cz);
    const y = anywhere ? Math.random() * 26 : 18 + Math.random() * 10;
    const o = i * 5;
    this.snowState[o] = x;
    this.snowState[o + 1] = y;
    this.snowState[o + 2] = z;
    this.snowState[o + 3] = 0.7 + Math.random() * 0.9;
    this.snowState[o + 4] = Math.random() * Math.PI * 2;
  }

  private spawnRipple(cx: number, cz: number) {
    const slot = this.ripples.find((r) => !r.mesh.visible);
    if (!slot) return;
    let x = 0;
    let z = 0;
    let y = 0;
    for (let i = 0; i < 10; i++) {
      x = cx + (Math.random() - 0.5) * 30;
      z = cz + (Math.random() - 0.5) * 30;
      y = this.groundHeightAt(x, z);
      // 庭院比殿内低 0.9m：只在室外起涟漪
      if (y < -0.5) break;
    }
    if (y >= -0.5) return;
    slot.mesh.position.set(x, y + 0.02, z);
    slot.mesh.scale.setScalar(0.55);
    slot.mesh.visible = true;
    slot.mat.opacity = 0;
    slot.t = 0;
    slot.life = 0.8 + Math.random() * 0.5;
  }

  update(dt: number, t: number, cx: number, cz: number) {
    const raining = this.kind === 'rain' || this.kind === 'thunder';
    const snowing = this.kind === 'snow';
    const k = Math.min(1, dt * 0.9);
    this.rainAmt += ((raining ? 1 : 0) - this.rainAmt) * k;
    this.snowAmt += ((snowing ? 1 : 0) - this.snowAmt) * k;

    // ——— 云
    const target = CLOUD_TARGET[this.kind];
    this.cloudAmt += (target.amt - this.cloudAmt) * Math.min(1, dt * 0.5);
    this.cloudTint.lerp(new THREE.Color(target.tint), Math.min(1, dt * 0.5));
    this.cloudMat.color.copy(this.cloudTint);
    this.cloudMat.opacity = 0.2 + 0.62 * this.cloudAmt;
    for (const s of this.clouds) {
      const radius = s.userData.radius as number;
      s.userData.angle = (s.userData.angle as number) + ((s.userData.speed as number) / radius) * dt;
      const a = s.userData.angle as number;
      s.position.set(
        cx + Math.cos(a) * radius,
        s.userData.alt as number,
        cz + Math.sin(a) * radius,
      );
    }

    // ——— 雨
    this.rain.visible = this.rainAmt > 0.02;
    if (this.rain.visible) {
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.26 * this.rainAmt;
      const pos = this.rainPos;
      const st = this.rainState;
      for (let i = 0; i < RAIN_N; i++) {
        const o = i * 4;
        const p = i * 6;
        st[o + 1] -= st[o + 3] * dt;
        const gy = this.groundHeightAt(st[o], st[o + 2]);
        if (st[o + 1] < gy + 0.1) this.resetRain(i, cx, cz);
        const len = 0.45 + st[o + 3] * 0.016;
        pos[p] = st[o];
        pos[p + 1] = st[o + 1];
        pos[p + 2] = st[o + 2];
        pos[p + 3] = st[o];
        pos[p + 4] = st[o + 1] - len;
        pos[p + 5] = st[o + 2];
      }
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    // ——— 雪
    this.snow.visible = this.snowAmt > 0.02;
    if (this.snow.visible) {
      (this.snow.material as THREE.PointsMaterial).opacity = 0.85 * this.snowAmt;
      const pos = this.snowPos;
      const st = this.snowState;
      for (let i = 0; i < SNOW_N; i++) {
        const o = i * 5;
        const p = i * 3;
        st[o + 1] -= st[o + 3] * dt;
        const gy = this.groundHeightAt(st[o], st[o + 2]);
        if (st[o + 1] < gy + 0.05) this.resetSnow(i, cx, cz);
        pos[p] = st[o] + Math.sin(t * 1.1 + st[o + 4]) * 0.45;
        pos[p + 1] = st[o + 1];
        pos[p + 2] = st[o + 2] + Math.cos(t * 0.8 + st[o + 4]) * 0.25;
      }
      (this.snow.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    // ——— 涟漪
    if (this.rainAmt > 0.35) {
      this.rippleTimer += dt;
      while (this.rippleTimer > 0.06) {
        this.rippleTimer -= 0.06;
        this.spawnRipple(cx, cz);
      }
    } else {
      this.rippleTimer = 0;
    }
    for (const r of this.ripples) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const u = r.t / r.life;
      if (u >= 1) {
        r.mesh.visible = false;
        r.mat.opacity = 0;
        continue;
      }
      r.mesh.scale.setScalar(0.55 + u * 1.9);
      r.mat.opacity = 0.75 * (1 - u) * clamp01(this.rainAmt);
    }
  }

  /** 调试用：当前粒子/涟漪的活跃数量 */
  stats() {
    return {
      rainAmt: +this.rainAmt.toFixed(2),
      snowAmt: +this.snowAmt.toFixed(2),
      cloudAmt: +this.cloudAmt.toFixed(2),
      ripples: this.ripples.filter((r) => r.mesh.visible).length,
      rainVisible: this.rain.visible,
      snowVisible: this.snow.visible,
    };
  }

  dispose() {
    for (const s of this.clouds) this.scene.remove(s);
    this.scene.remove(this.rain);
    this.scene.remove(this.snow);
    for (const r of this.ripples) {
      this.scene.remove(r.mesh);
      r.mat.dispose();
    }
    this.rain.geometry.dispose();
    (this.rain.material as THREE.Material).dispose();
    this.snow.geometry.dispose();
    (this.snow.material as THREE.Material).dispose();
    this.cloudMat.dispose();
  }
}
