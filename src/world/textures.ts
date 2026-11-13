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
