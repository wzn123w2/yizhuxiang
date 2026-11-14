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

/** 匾额：深色底 + 双金框 + 金字（参考图里那块「大雄寶殿」） */
export function plaqueTexture(text = '大雄寶殿'): THREE.CanvasTexture {
  const W = 512;
  const H = 224;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  // 底：近黑的深棕，略带竖向木纹
  ctx.fillStyle = '#170f0a';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(${60 + Math.random() * 40}, ${40 + Math.random() * 26}, 20, 0.06)`;
    ctx.fillRect(Math.random() * W, 0, 1 + Math.random() * 3, H);
  }

  // 双金框
  ctx.strokeStyle = 'rgba(206, 166, 92, 0.92)';
  ctx.lineWidth = 7;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(26, 26, W - 52, H - 52);

  // 四角的小金饰
  ctx.fillStyle = 'rgba(220, 182, 108, 0.85)';
  for (const [px, py] of [
    [10, 10],
    [W - 10, 10],
    [10, H - 10],
    [W - 10, H - 10],
  ]) {
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 金字：描边一层更深的金，再加一点外发光
  const chars = [...text];
  const size = Math.min(118, Math.floor((W - 96) / chars.length) * 1.24);
  ctx.font = `700 ${size}px "Songti SC", "STSong", "SimSun", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = (W - 120) / Math.max(1, chars.length);
  const startX = W / 2 - (step * (chars.length - 1)) / 2;

  chars.forEach((ch, i) => {
    const x = startX + step * i;
    const y = H / 2 + 4;
    ctx.shadowColor = 'rgba(255, 196, 96, 0.55)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#e8bd6c';
    ctx.fillText(ch, x, y);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(120, 78, 26, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.strokeText(ch, x, y);
  });

  const t = new THREE.CanvasTexture(c);
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
