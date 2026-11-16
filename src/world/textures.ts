import * as THREE from 'three';

/** 程序生成纹理：不依赖任何外部图片资源 */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function noise(
  ctx: CanvasRenderingContext2D,
  size: number,
  amount: number,
  alpha: number,
) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
    d[i + 3] = Math.min(255, d[i + 3] * alpha);
  }
  ctx.putImageData(img, 0, 0);
}

/** 石板地面：不规则方砖 + 缝隙 + 污渍 */
export function stoneFloorTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#3b444e';
  ctx.fillRect(0, 0, S, S);

  const tiles = 3;
  const step = S / tiles;
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      const shade = 78 + Math.random() * 22;
      ctx.fillStyle = `rgb(${shade}, ${shade + 6}, ${shade + 13})`;
      const jx = (Math.random() - 0.5) * 4;
      const jy = (Math.random() - 0.5) * 4;
      ctx.fillRect(x * step + 3 + jx, y * step + 3 + jy, step - 6, step - 6);

      // 每块砖内部再压一点斑驳
      for (let i = 0; i < 34; i++) {
        const a = 0.02 + Math.random() * 0.06;
        ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.5})`;
        const r = 6 + Math.random() * 34;
        ctx.beginPath();
        ctx.arc(x * step + Math.random() * step, y * step + Math.random() * step, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  noise(ctx, S, 6, 1);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 3.3);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

/** 木纹：柱子、梁、桌子 */
export function woodTexture(base = '#3a2517'): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 90; i++) {
    const y = Math.random() * S;
    const h = 1 + Math.random() * 3;
    ctx.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.12})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= S; x += 16) {
      ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * 3);
    }
    ctx.lineTo(S, y + h);
    for (let x = S; x >= 0; x -= 16) {
      ctx.lineTo(x, y + h + Math.sin(x * 0.03 + i) * 3);
    }
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < 30; i++) {
    ctx.strokeStyle = `rgba(255,220,170,${0.02 + Math.random() * 0.04})`;
    ctx.lineWidth = 1;
    const y = Math.random() * S;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(S * 0.3, y + 8, S * 0.7, y - 8, S, y);
    ctx.stroke();
  }
  noise(ctx, S, 10, 1);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 墙面：旧石灰 */
export function plasterTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#6b727a';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = Math.random() > 0.5
      ? `rgba(255,255,255,${0.01 + Math.random() * 0.03})`
      : `rgba(0,0,0,${0.02 + Math.random() * 0.06})`;
    const r = 6 + Math.random() * 50;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  noise(ctx, S, 18, 1);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 光晕用的径向渐变贴图（香火、灯火、佛光） */
export function glowTexture(inner = 'rgba(255,214,150,1)', outer = 'rgba(255,160,70,0)'): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.45)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 香烟粒子用的柔和圆点 */
export function smokeTexture(): THREE.CanvasTexture {
  const S = 64;
  const [c, ctx] = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(210,218,230,0.55)');
  g.addColorStop(0.45, 'rgba(200,210,224,0.2)');
  g.addColorStop(1, 'rgba(200,210,224,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 草地：暗绿底 + 细碎草叶噪点 */
export function grassTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#4c5e46';
  ctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const g = 52 + Math.random() * 62;
    ctx.strokeStyle = `rgba(${28 + Math.random() * 26}, ${g}, ${34 + Math.random() * 28}, ${0.25 + Math.random() * 0.5})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 2 - Math.random() * 4);
    ctx.stroke();
  }

  // 几块苔痕
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(${60 + Math.random() * 40}, ${86 + Math.random() * 40}, 48, 0.12)`;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, 8 + Math.random() * 26, 0, Math.PI * 2);
    ctx.fill();
  }
  noise(ctx, S, 10, 1);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 庭院石板路：长条横铺 */
export function pathTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#3d454e';
  ctx.fillRect(0, 0, S, S);

  const rows = 4;
  const h = S / rows;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 === 0 ? 0 : -S / 6;
    for (let k = -1; k < 3; k++) {
      const w = S / 2;
      const x = k * w + off;
      const shade = 96 + Math.random() * 26;
      ctx.fillStyle = `rgb(${shade - 6}, ${shade}, ${shade + 10})`;
      ctx.fillRect(x + 2, r * h + 2, w - 4, h - 4);
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.06})`;
        ctx.beginPath();
        ctx.arc(x + Math.random() * w, r * h + Math.random() * h, 3 + Math.random() * 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  noise(ctx, S, 8, 1);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.6, 8);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ═══════════════════ 佛殿外观用：琉璃瓦 / 彩画 / 匾额 / 格扇 ═══════════════════

/**
 * 琉璃瓦：竖向筒瓦 + 横向搭接。
 *
 * 参考图里是猪肝色的琉璃筒瓦，靠"每一列一个弧面高光 + 每排一条搭接阴影"
 * 就能在平板上读出瓦垄；真正的几何瓦垄太费面数，这里全靠贴图。
 * UV 由 makeHipRoof 按 x/z 平面投射，所以 repeat 保持 1，尺寸靠 UV 缩放。
 */
export function glazedRoofTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#1f1412';
  ctx.fillRect(0, 0, S, S);

  const cols = 10;
  const rows = 8;
  const cw = S / cols;
  const rh = S / rows;

  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = k * cw;
      const y = r * rh;
      const v = 92 + (Math.random() - 0.5) * 16;

      // 筒瓦是一个半圆柱：中间亮、两边压暗
      const g = ctx.createLinearGradient(x, 0, x + cw, 0);
      g.addColorStop(0, 'rgba(24, 15, 13, 1)');
      g.addColorStop(0.3, `rgb(${v}, ${v * 0.6}, ${v * 0.53})`);
      g.addColorStop(0.52, `rgb(${v * 1.22}, ${v * 0.78}, ${v * 0.66})`);
      g.addColorStop(0.74, `rgb(${v}, ${v * 0.6}, ${v * 0.53})`);
      g.addColorStop(1, 'rgba(24, 15, 13, 1)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cw, rh);

      // 搭接：下端一条高光（瓦头），上面一道阴影
      ctx.fillStyle = 'rgba(255, 224, 196, 0.12)';
      ctx.fillRect(x, y + rh - 5, cw, 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(x, y + rh - 12, cw, 6);
    }
  }
  noise(ctx, S, 7, 1);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * 旋子彩画：蓝绿相间的枋心 + 金线 + 金色旋花。
 * 横向可无限平铺，用在额枋、斗拱层、围脊上。
 */
export function caihuaTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const gold = 'rgba(214, 176, 106, 0.95)';

  // 底：左蓝右绿
  ctx.fillStyle = '#1b3559';
  ctx.fillRect(0, 0, W / 2, H);
  ctx.fillStyle = '#17503c';
  ctx.fillRect(W / 2, 0, W / 2, H);

  // 每条底色里再压一层更深的内框
  ctx.strokeStyle = 'rgba(8, 14, 22, 0.5)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  // 上下金边（箍头）
  ctx.fillStyle = gold;
  ctx.fillRect(0, 6, W, 5);
  ctx.fillRect(0, H - 11, W, 5);

  // 两段之间一道金线
  ctx.fillRect(W / 2 - 1.5, 0, 3, H);

  // 每段里画一个旋花：外圈金环 + 八瓣 + 花心
  const rosette = (cx: number, cy: number, r: number) => {
    ctx.strokeStyle = gold;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(
        cx + Math.cos(a) * r * 0.62,
        cy + Math.sin(a) * r * 0.62,
        r * 0.28,
        r * 0.17,
        a,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }

    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  };

  rosette(W * 0.25, H * 0.5, 30);
  rosette(W * 0.75, H * 0.5, 30);

  // 两侧的卷草（简单的四分之一圆弧对）
  ctx.lineWidth = 2;
  for (const bx of [0, W / 2]) {
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(bx + dir * 22, H * 0.28, 12, 0, Math.PI, dir < 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bx + dir * 22, H * 0.72, 12, 0, Math.PI, dir > 0);
      ctx.stroke();
    }
  }

  noise(ctx, W, 6, 1);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * 格扇门：红框 + 上部菱花格心 + 下部裙板。
 * 横向按开间数平铺，竖向整扇不重复。
 */
export function latticeDoorTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const frame = '#8d2b22';
  const deep = '#5d1a15';

  // 格心：深红底 + 金线菱花
  ctx.fillStyle = '#2a1310';
  ctx.fillRect(0, 0, W, H);

  const cell = 32;
  ctx.strokeStyle = 'rgba(202, 160, 92, 0.72)';
  ctx.lineWidth = 2;
  for (let y = -H; y < H * 2; y += cell) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y + W);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y - W);
    ctx.stroke();
  }

  // 下部裙板：实心红，带两排金门钉
  const panelTop = H * 0.66;
  ctx.fillStyle = deep;
  ctx.fillRect(0, panelTop, W, H - panelTop);
  ctx.strokeStyle = 'rgba(202, 160, 92, 0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(14, panelTop + 14, W - 28, H - panelTop - 28);
  ctx.fillStyle = 'rgba(212, 172, 102, 0.85)';
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.arc(34 + k * 47, panelTop + 60 + r * 46, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 抹头：把格心与裙板分开的一道横框
  ctx.fillStyle = frame;
  ctx.fillRect(0, panelTop - 10, W, 20);
  ctx.fillRect(0, 0, W, 16);
  ctx.fillRect(0, H - 16, W, 16);
  ctx.fillRect(0, 0, 14, H);
  ctx.fillRect(W - 14, 0, 14, H);

  noise(ctx, W, 6, 1);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * 圆形窗（月洞窗）：深色窗心 + 金线冰裂纹 + 红框。
 * 整块贴图自带边框，挂在墙上就是一扇圆窗，不用再拼环形几何。
 */
export function roundWindowTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S);
  const r = S / 2;

  ctx.clearRect(0, 0, S, S);

  // 窗心
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 18, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = '#241110';
  ctx.fillRect(0, 0, S, S);

  // 冰裂纹：两组斜线交叉
  const step = 26;
  ctx.strokeStyle = 'rgba(198, 158, 92, 0.75)';
  ctx.lineWidth = 2.2;
  for (let i = -S; i < S * 2; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + S, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - S, S);
    ctx.stroke();
  }

  // 中心一个小团花
  ctx.strokeStyle = 'rgba(212, 172, 102, 0.85)';
  ctx.lineWidth = 2.6;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(r + Math.cos(a) * 15, r + Math.sin(a) * 15, 13, 7, a, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  // 红框（贴图里直接画，挂在墙上就是一个完整的圆窗）
  ctx.beginPath();
  ctx.arc(r, r, r - 9, 0, Math.PI * 2);
  ctx.strokeStyle = '#8d2b22';
  ctx.lineWidth = 18;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(r, r, r - 9, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(212, 172, 102, 0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 竖排木牌：暗漆底 + 金字，用来做「求签」这类小牌子 */
export function signTexture(text: string): THREE.CanvasTexture {
  const W = 128;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#2b1b12');
  g.addColorStop(0.5, '#3b2518');
  g.addColorStop(1, '#1f130c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(200, 168, 107, 0.55)';
  ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  ctx.fillStyle = '#e3c489';
  ctx.font = '600 62px ui-serif, "Songti SC", "STSong", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...text];
  const gap = 76;
  const top = H / 2 - ((chars.length - 1) * gap) / 2;
  chars.forEach((ch, i) => ctx.fillText(ch, W / 2, top + i * gap));

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 积雪：近乎白的一层薄纹理，带一点冷色阴影和细碎亮点，避免雪面像一块塑料 */
export function snowTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#eef3f8';
  ctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 220; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 6 + Math.random() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = Math.random() > 0.45;
    g.addColorStop(0, light ? 'rgba(255,255,255,0.5)' : 'rgba(196,212,228,0.26)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 殿内墙面：暖米色灰泥 + 淡板缝（比外墙的青灰暖一档，也不抢佛像） */
export function interiorWallTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#cdb28b';
  ctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 130; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 18 + Math.random() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() > 0.5;
    g.addColorStop(0, dark ? 'rgba(158, 126, 86, 0.11)' : 'rgba(255, 247, 228, 0.13)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 竖向板缝
  ctx.strokeStyle = 'rgba(96, 68, 44, 0.13)';
  ctx.lineWidth = 2;
  for (const x of [S * 0.25, S * 0.5, S * 0.75]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, S);
    ctx.stroke();
  }

  noise(ctx, S, 7, 1);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 佛前大红帐：整面深红绸底 + 金色团花 / 云纹 / 边线，衬在三世佛后面 */
export function altarClothTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#9a241b');
  g.addColorStop(0.5, '#821a14');
  g.addColorStop(1, '#6b1410');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 垂褶：竖向明暗条
  for (let x = 0; x < W; x += 44) {
    const f = ctx.createLinearGradient(x, 0, x + 44, 0);
    f.addColorStop(0, 'rgba(0,0,0,0.16)');
    f.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    f.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = f;
    ctx.fillRect(x, 0, 44, H);
  }

  // 金色菱形底纹
  ctx.strokeStyle = 'rgba(226, 187, 102, 0.16)';
  ctx.lineWidth = 1.5;
  for (let y = 30; y < H; y += 46) {
    for (let x = 26; x < W; x += 46) {
      ctx.beginPath();
      ctx.moveTo(x, y - 10);
      ctx.lineTo(x + 10, y);
      ctx.lineTo(x, y + 10);
      ctx.lineTo(x - 10, y);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // 云纹带
  ctx.strokeStyle = 'rgba(240, 205, 130, 0.45)';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 12; i++) {
    const x = 30 + i * 42;
    ctx.beginPath();
    ctx.arc(x, 128, 10, Math.PI * 0.15, Math.PI * 0.9);
    ctx.arc(x + 10, 128, 10, Math.PI * 1.15, Math.PI * 1.9);
    ctx.stroke();
  }

  // 上下金边
  ctx.fillStyle = 'rgba(226, 187, 102, 0.55)';
  ctx.fillRect(0, 0, W, 5);
  ctx.fillRect(0, H - 5, W, 5);

  noise(ctx, 512, 4, 1);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 佛前垂幔：深红绸 + 金边 + 底部流苏，挂在帷幔两侧 */
export function drapeTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#9c241b');
  g.addColorStop(0.5, '#851d16');
  g.addColorStop(1, '#6b1410');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  for (let x = 0; x < W; x += 4) {
    ctx.fillStyle = x % 8 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.03)';
    ctx.fillRect(x, 0, 2, H);
  }

  // 金色侧边
  for (const x of [7, W - 14]) {
    ctx.fillStyle = 'rgba(226, 187, 102, 0.75)';
    ctx.fillRect(x, 0, 7, H);
    ctx.fillStyle = 'rgba(120, 34, 26, 0.45)';
    ctx.fillRect(x + 2, 0, 3, H);
  }

  // 云头
  ctx.strokeStyle = 'rgba(240, 205, 130, 0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const y = 70 + i * 92;
    ctx.beginPath();
    ctx.arc(W / 2 - 12, y, 12, Math.PI * 0.2, Math.PI * 0.9);
    ctx.arc(W / 2 + 12, y, 12, Math.PI * 1.2, Math.PI * 1.9);
    ctx.stroke();
  }

  // 底部流苏
  ctx.fillStyle = '#7d1a15';
  ctx.fillRect(0, H - 30, W, 30);
  ctx.fillStyle = 'rgba(226, 187, 102, 0.8)';
  for (let x = 14; x < W - 14; x += 12) ctx.fillRect(x, H - 26, 2, 18);
  ctx.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < W; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + 6, H - 9);
    ctx.lineTo(x + 12, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 幡：一条竖着的绸幡，琥珀底 + 藏蓝边 + 金线 + 团花 + 底部流苏 */
export function bannerTexture(tint = '#d9a63f'): THREE.CanvasTexture {
  const W = 128;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, tint);
  g.addColorStop(0.5, '#c9922f');
  g.addColorStop(1, '#a9761f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 织物竖纹
  for (let x = 0; x < W; x += 4) {
    ctx.fillStyle = x % 8 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.035)';
    ctx.fillRect(x, 0, 2, H);
  }

  // 两侧藏蓝边 + 金线
  ctx.fillStyle = '#1d2742';
  ctx.fillRect(0, 0, 11, H);
  ctx.fillRect(W - 11, 0, 11, H);
  ctx.strokeStyle = 'rgba(226, 187, 102, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(13.5, 0);
  ctx.lineTo(13.5, H);
  ctx.moveTo(W - 13.5, 0);
  ctx.lineTo(W - 13.5, H);
  ctx.stroke();

  // 顶部横头
  ctx.fillStyle = '#7c1f1a';
  ctx.fillRect(0, 0, W, 34);
  ctx.fillStyle = 'rgba(226, 187, 102, 0.9)';
  ctx.fillRect(0, 34, W, 2);

  // 团花 + 卷草
  const flower = (cx: number, cy: number, r: number, color: string) => {
    ctx.fillStyle = color;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(
        cx + Math.cos(a) * r * 0.55,
        cy + Math.sin(a) * r * 0.55,
        r * 0.36,
        r * 0.18,
        a,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 226, 160, 0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
  };

  for (let i = 0; i < 4; i++) {
    const y = 112 + i * 92;
    flower(W / 2, y, 21, 'rgba(148, 30, 26, 0.5)');
    ctx.strokeStyle = 'rgba(120, 34, 26, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, y + 21);
    ctx.bezierCurveTo(W / 2 + 26, y + 44, W / 2 - 26, y + 58, W / 2, y + 80);
    ctx.stroke();
  }

  // 底部流苏：红底 + 金线 + 挖出小三角
  ctx.fillStyle = '#8a2620';
  ctx.fillRect(0, H - 34, W, 34);
  ctx.fillStyle = 'rgba(226, 187, 102, 0.85)';
  for (let x = 12; x < W - 12; x += 12) ctx.fillRect(x, H - 30, 2, 22);

  ctx.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < W; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + 6, H - 10);
    ctx.lineTo(x + 12, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 佛前红帷幔：红底金边，下沿是扇贝形，贴图自带透明 */
export function valanceTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const bottom = 188;
  const n = 8;
  const w = W / n;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, bottom);
  for (let i = 0; i < n; i++) {
    ctx.quadraticCurveTo(w * i + w / 2, bottom + 48, w * (i + 1), bottom);
  }
  ctx.lineTo(W, 0);
  ctx.closePath();

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#a1261d');
  g.addColorStop(0.7, '#821914');
  g.addColorStop(1, '#64110e');
  ctx.fillStyle = g;
  ctx.fill();

  ctx.strokeStyle = 'rgba(233, 196, 118, 0.95)';
  ctx.lineWidth = 6;
  ctx.stroke();

  // 金线内框（沿同一个形状缩一点）
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(0.94, 0.94);
  ctx.translate(-W / 2, -H / 2);
  ctx.strokeStyle = 'rgba(233, 196, 118, 0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 云纹：横向一排小卷云
  ctx.strokeStyle = 'rgba(240, 205, 130, 0.65)';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 14; i++) {
    const cx = 26 + i * 34;
    ctx.beginPath();
    ctx.arc(cx, 52, 9, Math.PI * 0.2, Math.PI * 0.95);
    ctx.arc(cx + 9, 52, 9, Math.PI * 1.2, Math.PI * 1.9);
    ctx.stroke();
  }

  // 一排小花
  const flower = (cx: number, cy: number, r: number) => {
    ctx.fillStyle = 'rgba(240, 205, 130, 0.5)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(
        cx + Math.cos(a) * r * 0.55,
        cy + Math.sin(a) * r * 0.55,
        r * 0.38,
        r * 0.2,
        a,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(88, 138, 124, 0.75)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let i = 0; i < 9; i++) flower(48 + i * 52, 104, 9);

  // 中央团花
  const cx = W / 2;
  const cy = 118;
  ctx.fillStyle = 'rgba(240, 205, 130, 0.85)';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20, 11, 5, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(64, 122, 112, 0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();

  // 扇贝下的流苏点
  ctx.fillStyle = 'rgba(233, 196, 118, 0.9)';
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(w * i + w / 2, bottom + 52, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 天花：暖色井口 + 金色界线 + 中央团花，平铺使用 */
export function cofferTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#2b2320';
  ctx.fillRect(0, 0, S, S);

  const grad = ctx.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(96, 68, 46, 0.55)');
  grad.addColorStop(1, 'rgba(28, 22, 19, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);

  ctx.strokeStyle = 'rgba(176, 132, 70, 0.7)';
  ctx.lineWidth = 6;
  ctx.strokeRect(9, 9, S - 18, S - 18);
  ctx.strokeStyle = 'rgba(108, 156, 140, 0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(22, 22, S - 44, S - 44);

  // 中央团花
  ctx.fillStyle = 'rgba(198, 154, 84, 0.75)';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(
      S / 2 + Math.cos(a) * 26,
      S / 2 + Math.sin(a) * 26,
      15,
      7,
      a,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(88, 138, 124, 0.85)';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 10, 0, Math.PI * 2);
  ctx.fill();

  // 四角云头
  ctx.strokeStyle = 'rgba(198, 154, 84, 0.5)';
  ctx.lineWidth = 2.5;
  for (const [x, y] of [
    [40, 40],
    [S - 40, 40],
    [40, S - 40],
    [S - 40, S - 40],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.stroke();
  }

  noise(ctx, S, 6, 1);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 7);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
