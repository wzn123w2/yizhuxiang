import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeatherKind } from '../core/weather';
import {
  stoneFloorTexture,
  woodTexture,
  plasterTexture,
  glowTexture,
  smokeTexture,
  autumnGrassTexture,
  mapleLeafTexture,
  pathTexture,
  glazedRoofTexture,
  caihuaTexture,
  latticeDoorTexture,
  roundWindowTexture,
  signTexture,
  snowTexture,
  bannerTexture,
  valanceTexture,
  cofferTexture,
  interiorWallTexture,
  drapeTexture,
  robeTexture,
  wanfoNicheTexture,
  thousandHandHaloTexture,
  coupletTexture,
  bellTexture,
  steleTexture,
} from './textures';

export interface Cushion {
  mesh: THREE.Mesh;
  seat: THREE.Vector3;
  occupied: boolean;
  /** 点击瞬间的冲击值，自动衰减 */
  flash: number;
  /** 持续高亮（正在走过去 / 已坐） */
  hold: number;
  /** 鼠标悬停 */
  hover: number;
  /** 实际渲染用的平滑值 */
  shown: number;
  ring: THREE.Mesh;
  glow: THREE.Mesh;
}

export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

/** 可行走矩形（xz 平面）。多个矩形拼出"殿内 + 台阶 + 庭院"的连通区域 */
export interface WalkRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Temple {
  group: THREE.Group;
  /** 射线拾取用来决定"走到哪"的地面 */
  groundMeshes: THREE.Mesh[];
  cushions: Cushion[];
  burner: THREE.Object3D;
  woodfishStand: THREE.Object3D;
  /** 签筒：走近点一下就求签 */
  fortuneStand: THREE.Object3D;
  /** 主尊佛像脚下（xz 用来算“离佛多远”，梵呗据此变响） */
  buddhaPos: THREE.Vector3;
  walkRects: WalkRect[];
  obstacles: Obstacle[];
  /** 会挡住镜头的建筑构件（相机碰撞用） */
  occluders: THREE.Object3D[];
  /** 殿内天花板高度，用于钳制相机 */
  ceilY: number;
  groundHeightAt(x: number, z: number): number;
  addIncense(): void;
  update(dt: number, t: number): void;
  setNight(night: boolean): void;
  /** 晴 / 多云 / 阴 / 雨 / 雪……影响天空、雾、光照与雪盖 */
  setWeather(kind: WeatherKind): void;
  dispose(): void;
}

// ————————————— 尺寸（单位≈米）

const HALL_HW = 24;
const HALL_HD = 10;
const CEIL = 6.4;

const STEP_Z0 = 10.9; // 殿内地板到此为止
const YARD_Z = 12.7; // 庭院地面开始
const YARD_Y = -0.9; // 庭院比殿内低
const YARD_HW = 31;
const YARD_END = 33.2;
const WALL_Z = 34.2;
const WALL_X = 32;

const BURNER_X = -6.5;
const BURNER_Z = 0.9;

/** 屋顶贴图的 UV 密度：3.3m 一个循环，一个循环里 10 垄瓦 → 一垄 0.33m */
const ROOF_UV = 0.3;

/**
 * 起脊屋顶：外圈矩形 → 内圈矩形（或退化成一条脊线）之间放样。
 *
 * 剖面用 t^1.5：靠檐一段平缓、近脊一段陡 —— 中式“反宇”的大致走势。
 * 檐口每边再细分 sideSegs 段，靠四个角抬起来，就是「檐角起翘 / 翼角」。
 * （如果只留四个角点，檐口是直线，起翘无从表达，所以必须细分。）
 *
 * @param ow/od 檐口半宽/半深（外圈）
 * @param iw/id 内圈半宽/半深；id=0 就是一条正脊（庑殿/歇山的脊）
 * @param y0/y1 檐口高度 / 脊顶高度
 * @param opts.cornerLift 檐角比檐边中部高多少米
 * @param opts.lip 檐口压边（沿翘起的檐口线走一圈的竖向封边）
 */
function hipRoof(
  ow: number,
  od: number,
  iw: number,
  id: number,
  y0: number,
  y1: number,
  mat: THREE.Material,
  opts: {
    segs?: number;
    sideSegs?: number;
    cornerLift?: number;
    lip?: { h: number; mat: THREE.Material };
  } = {},
): THREE.Mesh {
  const segs = opts.segs ?? 6;
  const ss = opts.sideSegs ?? 10;
  const lift = opts.cornerLift ?? 0;
  const N = ss * 4;

  /** 檐口起翘系数：角上 = 1，边中点 = 0 */
  const cornerWeight = (k: number) => Math.pow(1 - Math.min(k / ss, 1 - k / ss) * 2, 2.4);

  const ringY = (t: number) => y0 + (y1 - y0) * Math.pow(t, 1.5);

  /** 第 t 圈、第 i 个檐口采样点（i 沿周长绕一圈） */
  const point = (t: number, i: number): [number, number, number] => {
    const w = ow + (iw - ow) * t;
    const d = od + (id - od) * t;
    const side = Math.floor(i / ss) % 4;
    const k = i % ss;
    const u = k / ss;

    let x: number;
    let z: number;
    if (side === 0) {
      x = -w + 2 * w * u;
      z = d;
    } else if (side === 1) {
      x = w;
      z = d - 2 * d * u;
    } else if (side === 2) {
      x = w - 2 * w * u;
      z = -d;
    } else {
      x = -w;
      z = -d + 2 * d * u;
    }

    // 越靠角、越靠檐口，抬得越多；到脊上就完全收住
    const y = ringY(t) + lift * cornerWeight(k) * Math.pow(1 - t, 2.2);
    return [x, y, z];
  };

  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    for (let i = 0; i < N; i++) {
      const [x, y, z] = point(t, i);
      pos.push(x, y, z);
      // 平面投射：瓦垄沿着坡面一致，不会在四个面上各转一个角度
      uv.push(x * ROOF_UV, z * ROOF_UV);
    }
  }

  const V = (s: number, i: number) => s * N + (i % N);
  for (let s = 0; s < segs; s++) {
    for (let i = 0; i < N; i++) {
      idx.push(V(s, i), V(s, i + 1), V(s + 1, i + 1));
      idx.push(V(s, i), V(s + 1, i + 1), V(s + 1, i));
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  const mesh = new THREE.Mesh(g, mat);

  // 檐口压边：沿翘起来的檐口线拉一条竖带，挡住屋面的零厚度断面
  if (opts.lip) {
    const lipPos: number[] = [];
    const lipIdx: number[] = [];
    const h = opts.lip.h;
    for (let i = 0; i < N; i++) {
      const [x, y, z] = point(0, i);
      lipPos.push(x, y - 0.02, z, x, y - h, z);
    }
    for (let i = 0; i < N; i++) {
      const a = (i * 2) % (N * 2);
      const b = ((i + 1) * 2) % (N * 2);
      lipIdx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lipPos, 3));
    lg.setIndex(lipIdx);
    lg.computeVertexNormals();

    const lipMat = opts.lip.mat.clone();
    lipMat.side = THREE.DoubleSide;
    mesh.add(new THREE.Mesh(lg, lipMat));
  }

  return mesh;
}

// ————————————— 静态合批

const _bq = new THREE.Quaternion();
const _be = new THREE.Euler();
const _bv = new THREE.Vector3();
const _bs = new THREE.Vector3();
const _bm = new THREE.Matrix4();

/**
 * 静态合批：把一批“位置固定、材质相同”的小零件合成一个几何体。
 *
 * 山寺里这类零件很多（墙裙立柱、望柱、岸石、签筒里的签、松枝…），
 * 每个都是一次 draw call。合起来外观不变，draw call 从 N 降到“材质数”。
 *
 * 用法：建完一批后 `build(group)`，加进去的就是合并后的网格。
 */
class StaticBatch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private shadows = false;
  private receives = false;

  /** 加一件：位置 / 旋转 / 缩放直接给（几何体在 build 时烘进顶点） */
  add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = 1,
    sz = 1,
  ): this {
    _bm.compose(
      _bv.set(x, y, z),
      _bq.setFromEuler(_be.set(rx, ry, rz)),
      _bs.set(sx, sy, sz),
    );
    const g = geo.clone().applyMatrix4(_bm);
    geo.dispose();
    const list = this.parts.get(mat);
    if (list) list.push(g);
    else this.parts.set(mat, [g]);
    return this;
  }

  shadow(v = true): this {
    this.shadows = v;
    return this;
  }

  receive(v = true): this {
    this.receives = v;
    return this;
  }

  build(parent: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, geos] of this.parts) {
      // mergeGeometries 要求“都有索引”或“都没索引”，混了就统一转成非索引
      const list = geos.some((g) => !g.index)
        ? geos.map((g) => (g.index ? g.toNonIndexed() : g))
        : geos;
      const merged = mergeGeometries(list, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = this.shadows;
      mesh.receiveShadow = this.receives;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

export function buildTemple(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Temple {
  const group = new THREE.Group();
  scene.add(group);


  const floorTex = stoneFloorTexture();
  // 殿面宽 48m：石板按 6m 左右一格，别让 4 个循环拉成一张大糊图
  floorTex.repeat.set(8, 3.3);
  const woodTex = woodTexture();
  const wallTex = plasterTexture();
  const glowTex = glowTexture();
  const smokeTex = smokeTexture();
  const grassTex = autumnGrassTexture();
  const pathTex = pathTexture();
  const roofTex = glazedRoofTexture();
  const caihuaTex = caihuaTexture();
  const latticeTex = latticeDoorTexture();
  const roundWinTex = roundWindowTexture();
  const cofferTex = cofferTexture();
  cofferTex.repeat.set(16, 7);
  const interiorWallTex = interiorWallTexture();

  // ————————————— 材质

  const matStone = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: 0.9,
    metalness: 0.02,
    color: 0xa8a69c,
  });
  const matStoneSolid = new THREE.MeshStandardMaterial({
    color: 0x6d7884,
    roughness: 0.94,
    metalness: 0.02,
  });
  const matRock = new THREE.MeshStandardMaterial({
    color: 0x7c8288,
    roughness: 0.96,
    metalness: 0.02,
    flatShading: true,
  });
  const matWood = new THREE.MeshStandardMaterial({
    map: woodTex,
    roughness: 0.8,
    metalness: 0.04,
    color: 0xb08d6c,
  });
  const matDarkWood = new THREE.MeshStandardMaterial({
    map: woodTex,
    roughness: 0.7,
    color: 0x5a4230,
  });
  const matWall = new THREE.MeshStandardMaterial({
    map: interiorWallTex,
    roughness: 0.92,
    color: 0xffffff,
  });
  const matBronze = new THREE.MeshStandardMaterial({
    color: 0x3b3126,
    roughness: 0.45,
    metalness: 0.75,
  });
  const matBronzeLit = new THREE.MeshStandardMaterial({
    color: 0x54452f,
    roughness: 0.38,
    metalness: 0.8,
    emissive: 0x1a1208,
  });
  const matLeaf = new THREE.MeshStandardMaterial({
    color: 0x2f4633,
    roughness: 0.92,
    flatShading: true,
  });
  const matLeafDark = new THREE.MeshStandardMaterial({
    color: 0x233528,
    roughness: 0.94,
    flatShading: true,
  });
  const matTile = new THREE.MeshStandardMaterial({
    color: 0x39424c,
    roughness: 0.7,
    metalness: 0.15,
  });

  // ——— 参考图（江南大雄宝殿）的配色：琉璃瓦、朱红柱、土黄墙、蓝绿彩画 ———

  /** 琉璃筒瓦：暗猪肝色，双面（檐下抬头能看到瓦背，省得穿帮） */
  const matGlazed = new THREE.MeshStandardMaterial({
    map: roofTex,
    color: 0x9c8b85,
    roughness: 0.58,
    metalness: 0.26,
    side: THREE.DoubleSide,
  });
  /** 正脊 / 垂脊：绿琉璃 */
  const matRidge = new THREE.MeshStandardMaterial({
    color: 0x2c6047,
    roughness: 0.42,
    metalness: 0.38,
  });
  /** 土黄墙（外立面、院墙） */
  const matWallOuter = new THREE.MeshStandardMaterial({
    map: wallTex,
    color: 0xe4c07c,
    roughness: 0.94,
    metalness: 0.02,
  });
  /** 红墙裙：墙脚那一圈赭红 */
  const matWallBase = new THREE.MeshStandardMaterial({
    color: 0x7d2f27,
    roughness: 0.86,
  });
  /** 朱红柱 */
  const matVermilion = new THREE.MeshStandardMaterial({
    map: woodTex,
    color: 0xbb4534,
    roughness: 0.56,
    metalness: 0.05,
  });
  /** 彩画额枋（贴图在每根枋上按长度单独 repeat） */
  const caihuaMat = (len: number) => {
    const t = caihuaTex.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, len / 2.4), 1);
    return new THREE.MeshStandardMaterial({
      map: t,
      roughness: 0.78,
      metalness: 0.08,
    });
  };
  /** 白石栏杆 / 踏跺 */
  const matStoneLight = new THREE.MeshStandardMaterial({
    color: 0xc9ced3,
    roughness: 0.86,
    metalness: 0.02,
  });
  /** 斗拱的金边 */
  const matGold = new THREE.MeshStandardMaterial({
    color: 0xc9a24a,
    roughness: 0.35,
    metalness: 0.6,
  });

  const obstacles: Obstacle[] = [];
  const occluders: THREE.Object3D[] = [];
  const waterMeshes: THREE.MeshStandardMaterial[] = [];

  /** 池里的鱼：绕浅椭圆慢慢游，只露一点背 */
  interface PondFish {
    g: THREE.Group;
    tail: THREE.Object3D;
    rx: number;
    rz: number;
    w: number;
    phase: number;
    y: number;
    bob: number;
  }
  const fishes: PondFish[] = [];

  // ————————————— 地面：殿内

  const hallFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL_HW * 2 + 3, STEP_Z0 + HALL_HD),
    matStone,
  );
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.position.z = (STEP_Z0 - HALL_HD) / 2;
  hallFloor.receiveShadow = true;
  group.add(hallFloor);

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(HALL_HW * 2 + 3, 0.7, STEP_Z0 + HALL_HD),
    new THREE.MeshStandardMaterial({ color: 0xa4aab1, roughness: 0.92, metalness: 0.02 }),
  );
  plinth.position.set(0, -0.42, hallFloor.position.z);
  plinth.receiveShadow = true;
  group.add(plinth);

  // 台阶：三级下到庭院。踏面单独给一张按尺寸缩放过的纹理，否则大平面会被拉成糊
  const stepTopTex = floorTex.clone();
  stepTopTex.needsUpdate = true;
  stepTopTex.repeat.set(9, 0.35);
  const matStepTop = new THREE.MeshStandardMaterial({
    map: stepTopTex,
    roughness: 0.9,
    color: 0xc3c8cc,
  });
  const stepMats = [
    matStoneSolid,
    matStoneSolid,
    matStepTop,
    matStoneSolid,
    matStoneSolid,
    matStoneSolid,
  ];
  for (let i = 0; i < 3; i++) {
    const h = 0.3 * (3 - i);
    const s = new THREE.Mesh(new THREE.BoxGeometry(24, h, 0.62), stepMats);
    s.position.set(0, -0.3 * (i + 1) - h / 2 + 0.02, 11.35 + i * 0.6);
    s.receiveShadow = true;
    s.castShadow = true;
    group.add(s);
  }

  // 台阶两侧的垂带石，把大平面切碎
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.05, 2.1), matStoneSolid);
    cheek.position.set(sx * 12.4, -0.42, 11.6);
    cheek.rotation.z = sx * 0.02;
    cheek.castShadow = true;
    cheek.receiveShadow = true;
    group.add(cheek);
  }

  // ————————————— 地面：庭院

  const yardGround = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 90),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }),
  );
  yardGround.rotation.x = -Math.PI / 2;
  yardGround.position.set(0, YARD_Y, 40);
  yardGround.receiveShadow = true;
  group.add(yardGround);

  // 石板路
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 22),
    new THREE.MeshStandardMaterial({ map: pathTex, roughness: 0.85, color: 0x9fa8b2 }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, YARD_Y + 0.012, 22.6);
  const path2 = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 12),
    new THREE.MeshStandardMaterial({ map: pathTex, roughness: 0.85, color: 0x8e97a2 }),
  );
  path2.rotation.x = -Math.PI / 2;
  path2.position.set(0, YARD_Y + 0.01, 40);
  group.add(path2);
  path.receiveShadow = true;
  group.add(path);

  // ————————————— 墙与屋顶

  // —— 墙 ——
  // 墙高从 8 降到 7.2：下檐屋面在墙线处只有 7.38，再高就会从瓦顶穿出去
  const WALL_H = 7.2;
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(HALL_HW * 2, WALL_H, 0.7), matWall);
  backWall.position.set(0, WALL_H / 2, -HALL_HD);
  backWall.receiveShadow = true;
  group.add(backWall);
  occluders.push(backWall);

  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.7, WALL_H, HALL_HD * 2), matWall);
    side.position.set(sx * HALL_HW, WALL_H / 2, 0);
    side.receiveShadow = true;
    group.add(side);
    occluders.push(side);
  }

  // 殿身外皮：殿内保留青灰（不抢佛像），从外面看是土黄墙 + 红墙裙
  for (const sx of [-1, 1]) {
    const clad = new THREE.Mesh(new THREE.BoxGeometry(0.12, WALL_H, HALL_HD * 2), matWallOuter);
    clad.position.set(sx * (HALL_HW + 0.41), WALL_H / 2, 0);
    clad.receiveShadow = true;
    group.add(clad);

    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.6, HALL_HD * 2), matWallBase);
    skirt.position.set(sx * (HALL_HW + 0.43), 0.8, 0);
    skirt.receiveShadow = true;
    group.add(skirt);
  }
  {
    const clad = new THREE.Mesh(new THREE.BoxGeometry(HALL_HW * 2 + 0.3, WALL_H, 0.12), matWallOuter);
    clad.position.set(0, WALL_H / 2, -(HALL_HD + 0.41));
    clad.receiveShadow = true;
    group.add(clad);

    const skirt = new THREE.Mesh(new THREE.BoxGeometry(HALL_HW * 2 + 0.3, 1.6, 0.18), matWallBase);
    skirt.position.set(0, 0.8, -(HALL_HD + 0.43));
    group.add(skirt);
  }

  // 侧墙圆窗（月洞窗）：参考图侧面那几个圆窗，给大片黄墙一个呼吸点
  const roundWinMat = new THREE.MeshStandardMaterial({
    map: roundWinTex,
    transparent: true,
    alphaTest: 0.35,
    roughness: 0.7,
    metalness: 0.06,
  });
  for (const sx of [-1, 1]) {
    for (const wz of [-4.5, 0, 4.5]) {
      const win = new THREE.Mesh(new THREE.CircleGeometry(0.95, 30), roundWinMat);
      win.position.set(sx * (HALL_HW + 0.48), 4.15, wz);
      win.rotation.y = sx * (Math.PI / 2);
      group.add(win);
    }
  }

  // ————————————— 屋顶：重檐（参考图的双层屋檐 + 暗色琉璃瓦）

  /** 下檐檐口高度 */
  const EAVE_Y = 7.0;

  // 下檐（腰檐）：挑出 2.4m，坡度约 27°，比第一版陡，免得看上去像一块平板
  const roofLower = hipRoof(
    HALL_HW + 2.4,
    HALL_HD + 2.6,
    HALL_HW - 2.4,
    HALL_HD - 2.6,
    EAVE_Y,
    9.35,
    matGlazed,
    {
      cornerLift: 0.62,
      lip: { h: 0.24, mat: matDarkWood },
    },
  );
  roofLower.castShadow = true;
  roofLower.receiveShadow = true;
  group.add(roofLower);
  occluders.push(roofLower);

  // 两层屋檐之间被遮住的墙，兼作“防穿帮”的封口
  const clerestory = hipRoof(HALL_HW - 1.6, 8.3, 0.12, 0.12, 9.2, 9.8, matWallOuter, {
    segs: 3,
    sideSegs: 4,
  });
  group.add(clerestory);

  // 上檐：收进去、抬得更高，整座殿才有“重檐”的高度感
  const roofUpper = hipRoof(HALL_HW, HALL_HD, HALL_HW * 0.475, 0, 9.95, 13.0, matGlazed, {
    cornerLift: 0.5,
  });
  roofUpper.castShadow = true;
  roofUpper.receiveShadow = true;
  group.add(roofUpper);
  occluders.push(roofUpper);

  // 上檐下的第二道彩画带：参考图两层屋檐下都有蓝绿彩绘 + 斗拱
  for (const [len, x, z, rotY] of [
    [HALL_HW * 2 - 1.2, 0, HALL_HD - 0.8, 0],
    [HALL_HW * 2 - 1.2, 0, -HALL_HD + 0.8, 0],
    [HALL_HD * 2 - 2.8, HALL_HW - 0.8, 0, Math.PI / 2],
    [HALL_HD * 2 - 2.8, -HALL_HW + 0.8, 0, Math.PI / 2],
  ] as Array<[number, number, number, number]>) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(len, 0.58, 0.26), caihuaMat(len));
    band.position.set(x, 9.62, z);
    band.rotation.y = rotY;
    group.add(band);
  }

  // 正脊：绿琉璃，两端各一个上翘的鸱吻
  const ridgeLen = HALL_HW * 1.05;
  const ridgeBeam = new THREE.Mesh(new THREE.BoxGeometry(ridgeLen, 0.46, 0.62), matRidge);
  ridgeBeam.position.set(0, 13.08, 0);
  ridgeBeam.castShadow = true;
  group.add(ridgeBeam);
  occluders.push(ridgeBeam);

  const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(ridgeLen + 0.2, 0.12, 0.78), matGold);
  ridgeCap.position.set(0, 13.34, 0);
  group.add(ridgeCap);

  for (const sx of [-1, 1]) {
    // 鸱吻：一块弧形侧板（内凹曲线）+ 一根金尖，远看就是翘起来的吻兽
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(-0.32, 0.62, 0.12, 1.18);
    s.quadraticCurveTo(0.34, 0.7, 0.42, 0.1);
    s.lineTo(0.42, 0);
    s.closePath();
    const wen = new THREE.Mesh(
      new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false, curveSegments: 8 }),
      matRidge,
    );
    wen.position.set(sx * (ridgeLen / 2), 13.1, -0.1);
    wen.rotation.y = sx > 0 ? Math.PI : 0;
    wen.rotation.z = sx * 0.16;
    wen.castShadow = true;
    group.add(wen);

    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 6), matGold);
    horn.position.set(sx * (ridgeLen / 2 + 0.38), 14.05, 0);
    horn.rotation.z = sx * 0.5;
    group.add(horn);
  }

  // （檐口压边现在由 hipRoof 的 lip 选项沿翘起的檐口线生成，不再用四个直盒子）

  // 天花上方的“围脊”：两檐之间一道彩画带 + 斗拱，从底下抬头能看到
  for (const [len, x, z, rotY] of [
    [HALL_HW * 2 + 3, 0, HALL_HD - 0.6, 0],
    [HALL_HW * 2 + 3, 0, -HALL_HD + 0.6, 0],
    [HALL_HD * 2, HALL_HW - 0.6, 0, Math.PI / 2],
    [HALL_HD * 2, -HALL_HW + 0.6, 0, Math.PI / 2],
  ] as Array<[number, number, number, number]>) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(len, 0.62, 0.28), caihuaMat(len));
    band.position.set(x, EAVE_Y - 0.62, z);
    band.rotation.y = rotY;
    group.add(band);
  }

  // 天花板
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL_HW * 2, HALL_HD * 2),
    new THREE.MeshStandardMaterial({
      map: cofferTex,
      color: 0xc9b79c,
      roughness: 0.9,
      metalness: 0.02,
    }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = CEIL;
  group.add(ceiling);
  occluders.push(ceiling);

  {
    const beams = new StaticBatch();
    for (let i = 0; i < 5; i++) {
      beams.add(
        new THREE.BoxGeometry(HALL_HW * 2, 0.32, 0.36),
        matDarkWood,
        0,
        CEIL - 0.2,
        -HALL_HD + 2 + i * 4,
      );
    }
    beams.build(group);
  }

  // ————————————— 殿内墙面：红木墙裙 + 幡 + 佛前帷幔 + 壁灯
  // 参考照片里殿内是暖木、黄绸幡、红帷幔、满顶彩画；原来四面灰墙确实太素

  const matWainscot = new THREE.MeshStandardMaterial({
    map: woodTex,
    color: 0x8a4a34,
    roughness: 0.68,
    metalness: 0.05,
  });
  const WAINSCOT_H = 1.15;
  /** 墙裙的立柱：原来每根一次 draw（将近 20 次），合起来只剩 1 次 */
  const wainscotPosts = new StaticBatch();
  const wainscotSkirts = new StaticBatch();
  const wainscotRails = new StaticBatch();

  // 后墙墙裙
  {
    const w = HALL_HW * 2 - 0.2;
    wainscotSkirts.add(
      new THREE.BoxGeometry(w, WAINSCOT_H, 0.1),
      matWainscot,
      0,
      WAINSCOT_H / 2,
      -HALL_HD + 0.4,
    );
    wainscotRails.add(
      new THREE.BoxGeometry(w, 0.07, 0.16),
      matGold,
      0,
      WAINSCOT_H + 0.035,
      -HALL_HD + 0.4,
    );
    for (let x = -HALL_HW + 2.4; x <= HALL_HW - 2.4; x += 2.4) {
      wainscotPosts.add(
        new THREE.BoxGeometry(0.06, WAINSCOT_H, 0.13),
        matDarkWood,
        x,
        WAINSCOT_H / 2,
        -HALL_HD + 0.47,
      );
    }
  }

  // 两侧墙裙
  for (const sx of [-1, 1]) {
    const d = HALL_HD * 2 - 0.2;
    wainscotSkirts.add(
      new THREE.BoxGeometry(0.1, WAINSCOT_H, d),
      matWainscot,
      sx * (HALL_HW - 0.4),
      WAINSCOT_H / 2,
      0,
    );
    wainscotRails.add(
      new THREE.BoxGeometry(0.16, 0.07, d),
      matGold,
      sx * (HALL_HW - 0.4),
      WAINSCOT_H + 0.035,
      0,
    );
    for (let z = -HALL_HD + 2.4; z <= HALL_HD - 2.4; z += 2.4) {
      wainscotPosts.add(
        new THREE.BoxGeometry(0.13, WAINSCOT_H, 0.06),
        matDarkWood,
        sx * (HALL_HW - 0.47),
        WAINSCOT_H / 2,
        z,
      );
    }
  }
  wainscotSkirts.build(group);
  wainscotRails.build(group);
  wainscotPosts.build(group);

  // 幡：两侧各三条，佛前再挂两条
  const bannerTexA = bannerTexture('#d9a63f');
  const bannerTexB = bannerTexture('#c8842c');
  const bannerMat = (tex: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      roughness: 0.9,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: 0.12,
    });

  const banners: Array<{ x: number; z: number; ry: number; tex: THREE.Texture }> = [];
  let bi = 0;
  for (const sx of [-1, 1]) {
    for (const z of [-7.2, -4.2, -1.2, 1.8, 4.8]) {
      banners.push({
        x: sx * (HALL_HW - 1.98),
        z,
        ry: sx > 0 ? -Math.PI / 2 : Math.PI / 2,
        tex: bi++ % 2 ? bannerTexB : bannerTexA,
      });
    }
  }
  for (const x of [-16.0, -9.2, 9.2, 16.0]) {
    banners.push({ x, z: -HALL_HD + 0.55, ry: 0, tex: bannerTexA });
  }

  for (const b of banners) {
    const g = new THREE.Group();
    g.position.set(b.x, 1.8, b.z);
    g.rotation.y = b.ry;

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 4.3), bannerMat(b.tex));
    plane.position.y = 2.15;
    g.add(plane);

    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 8), matDarkWood);
    rod.rotation.z = Math.PI / 2;
    rod.position.y = 4.31;
    g.add(rod);

    group.add(g);
  }

  // 佛前红帷幔：贴着后墙、在佛像光背后面，下沿是扇贝形
  const valanceTex = valanceTexture();
  const valanceMat = new THREE.MeshStandardMaterial({
    map: valanceTex,
    transparent: true,
    alphaTest: 0.06,
    side: THREE.DoubleSide,
    roughness: 0.9,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: valanceTex,
    emissiveIntensity: 0.1,
  });
  const valance = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 1.55), valanceMat);
  valance.position.set(0, 5.62, -HALL_HD + 0.66);
  group.add(valance);

  // 千手观音的背屏：四幅深红垂幔从莲台上方一直挂到天花
  const drapeTex = drapeTexture();
  const drapeMat = new THREE.MeshStandardMaterial({
    map: drapeTex,
    transparent: true,
    alphaTest: 0.06,
    side: THREE.DoubleSide,
    roughness: 0.9,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: drapeTex,
    emissiveIntensity: 0.08,
  });
  {
    const tex = drapeTex.clone();
    tex.needsUpdate = true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(5, 1);
    const backMat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.06,
      side: THREE.DoubleSide,
      roughness: 0.9,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: 0.06,
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(9.0, 4.3), backMat);
    back.position.set(0, 3.89, -HALL_HD + 0.53);
    group.add(back);
  }

  // 帷幔两侧的深红垂幔，把佛龛框起来（参考照片里佛前是红绸围出的龛）
  for (const sx of [-1, 1]) {
    const drape = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.95), drapeMat);
    drape.position.set(sx * 4.55, 4.45, -HALL_HD + 0.58);
    group.add(drape);
  }

  // ————————————— 万佛龛：大乘之阁东西山墙那一面「万佛」壁
  // 平铺的一张暖光龛壁贴图：每个小龛里一尊小金佛，夜里自带一点亮
  const nicheTex = wanfoNicheTexture();
  function wanfoWall(w: number, h: number, x: number, y: number, z: number, ry = 0) {
    const tex = nicheTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(w / 1.9, h / 1.9);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: 0xffcf8a,
      emissiveMap: tex,
      emissiveIntensity: 0.22,
      roughness: 0.92,
      metalness: 0.04,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    group.add(m);
  }
  // 后墙两侧（中央留给千手背光）
  const backNicheW = HALL_HW - 5.4;
  const backNicheX = 4.95 + backNicheW / 2;
  wanfoWall(backNicheW, 4.85, -backNicheX, 3.63, -HALL_HD + 0.4);
  wanfoWall(backNicheW, 4.85, backNicheX, 3.63, -HALL_HD + 0.4);
  // 东西山墙（回廊以下那一段）
  for (const sx of [-1, 1]) {
    wanfoWall(18.8, 2.34, sx * (HALL_HW - 0.4), 2.37, 0, -sx * (Math.PI / 2));
    // 回廊以上再铺一层：大乘之阁的万佛龛本来就不止一层
    wanfoWall(18.8, 2.0, sx * (HALL_HW - 0.4), 4.92, 0, -sx * (Math.PI / 2));
  }

  // ————————————— 回廊：大乘之阁「内中空三层、四周设回廊」的简化
  const GALLERY_Y = 3.78;
  const GALLERY_W = 1.4;
  {
    const floors = new StaticBatch().shadow().receive();
    const rails = new StaticBatch();
    const cols = new StaticBatch().shadow();
    const brackets = new StaticBatch();
    const beamMat = caihuaMat(19);

    for (const sx of [-1, 1]) {
      const midX = sx * (HALL_HW - GALLERY_W / 2);
      // 楼板 + 檐口梁
      floors.add(
        new THREE.BoxGeometry(GALLERY_W, 0.16, HALL_HD * 2 - 0.3),
        matDarkWood,
        midX,
        GALLERY_Y - 0.08,
        0,
      );
      floors.add(
        new THREE.BoxGeometry(0.2, 0.24, HALL_HD * 2 - 0.3),
        matVermilion,
        sx * (HALL_HW - GALLERY_W - 0.02),
        GALLERY_Y - 0.2,
        0,
      );

      // 栏杆：望柱 + 金寻杖 + 金下枋
      const railX = sx * (HALL_HW - GALLERY_W - 0.04);
      for (let z = -9.15; z <= 9.16; z += 1.55) {
        rails.add(new THREE.BoxGeometry(0.09, 0.94, 0.09), matVermilion, railX, GALLERY_Y + 0.47, z);
      }
      rails.add(new THREE.BoxGeometry(0.13, 0.1, HALL_HD * 2 - 0.4), matGold, railX, GALLERY_Y + 0.94, 0);
      rails.add(new THREE.BoxGeometry(0.08, 0.08, HALL_HD * 2 - 0.4), matGold, railX, GALLERY_Y + 0.5, 0);

      // 楼板下的彩画檐枋 + 一排小斗拱，抬头才看得出这层是“楼”
      floors.add(
        new THREE.BoxGeometry(0.1, 0.24, HALL_HD * 2 - 0.3),
        beamMat,
        sx * (HALL_HW - GALLERY_W - 0.06),
        GALLERY_Y - 0.3,
        0,
      );
      for (let z = -8.5; z <= 8.6; z += 1.7) {
        brackets.add(new THREE.BoxGeometry(0.42, 0.12, 0.24), matVermilion, sx * (HALL_HW - GALLERY_W - 0.2), GALLERY_Y - 0.44, z);
        brackets.add(new THREE.BoxGeometry(0.22, 0.12, 0.42), matGold, sx * (HALL_HW - GALLERY_W - 0.2), GALLERY_Y - 0.55, z);
      }

      // 回廊柱 + 斗拱 + 额枋
      const colX = sx * (HALL_HW - 1.55);
      const beamY = CEIL - 0.5;
      for (const z of [-6.6, -2.2, 2.2, 6.6]) {
        const ch = beamY - 0.15 - GALLERY_Y;
        cols.add(new THREE.CylinderGeometry(0.16, 0.18, ch, 12), matVermilion, colX, GALLERY_Y + ch / 2, z);
        rails.add(new THREE.TorusGeometry(0.2, 0.03, 6, 16), matGold, colX, GALLERY_Y + 0.06, z, Math.PI / 2, 0, 0);
        brackets.add(new THREE.BoxGeometry(0.62, 0.14, 0.34), matVermilion, colX, beamY - 0.16, z);
        brackets.add(new THREE.BoxGeometry(0.34, 0.14, 0.62), matDarkWood, colX, beamY - 0.3, z);
        brackets.add(new THREE.BoxGeometry(0.2, 0.1, 0.2), matGold, colX, beamY - 0.42, z);
      }
      // 柱间的补间斗拱
      for (const z of [-8.4, -4.4, 0, 4.4, 8.4]) {
        brackets.add(new THREE.BoxGeometry(0.5, 0.12, 0.3), matVermilion, colX, beamY - 0.18, z);
        brackets.add(new THREE.BoxGeometry(0.26, 0.12, 0.5), matDarkWood, colX, beamY - 0.3, z);
      }
      floors.add(new THREE.BoxGeometry(0.26, 0.3, 19.0), beamMat, colX, beamY, 0);
    }
    floors.build(group);
    rails.build(group);
    cols.build(group);
    brackets.build(group);
  }

  // 回廊柱上的楹联
  for (const [text, sx] of [
    ['千手千眼觀自在', -1],
    ['大慈大悲度眾生', 1],
  ] as Array<[string, number]>) {
    const tex = coupletTexture(text);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.72,
      emissive: 0xffe0b0,
      emissiveMap: tex,
      emissiveIntensity: 0.14,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 1.95), mat);
    m.position.set(sx * (HALL_HW - 1.73), GALLERY_Y + 1.14, 6.6);
    m.rotation.y = -sx * (Math.PI / 2);
    group.add(m);
  }

  // 壁灯：只有自发光 + 光晕，不加真实点光源，省手机的性能
  const wallLanternMat = new THREE.MeshStandardMaterial({
    color: 0x7a4520,
    roughness: 0.6,
    emissive: 0xffa858,
    emissiveIntensity: 1.4,
  });
  for (const sx of [-1, 1]) {
    for (const z of [-6.8, -2.8, 2.8, 6.8]) {
      const g = new THREE.Group();
      g.position.set(sx * (HALL_HW - 0.78), 2.95, z);

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.26, 0.5, 10),
        wallLanternMat,
      );
      g.add(body);

      for (const sy of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.14, 10), matDarkWood);
        cap.position.y = sy * 0.3;
        cap.rotation.x = sy > 0 ? Math.PI : 0;
        g.add(cap);
      }

      // 横臂：从灯笼伸向墙面
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), matDarkWood);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(sx * 0.4, 0.34, 0);
      g.add(arm);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: 0xffb070,
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      glow.scale.set(1.9, 1.9, 1);
      g.add(glow);

      group.add(g);
    }
  }

  // ————————————— 正立面（参考图：黄墙、红墙裙、格扇门、匾额、石栏杆）

  /** 立面前檐所在平面 */
  const FACE_Z = 10.35;
  /** 檐柱所在平面 */
  const PORCH_Z = 10.75;
  /** 墙高（与 WALL_H 一致，屋顶从这里起坡） */
  const FACE_H = 7.0;

  // 中央门洞：宽 12.4，正好对齐殿前的石板路；引檐柱立在两旁
  const DOOR_HW = 6.2;
  const FACE_OUT = HALL_HW + 1.5;

  for (const sx of [-1, 1]) {
    const w = FACE_OUT - DOOR_HW;
    const cx = sx * (DOOR_HW + w / 2);

    // 土黄墙体
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, FACE_H, 0.55), matWallOuter);
    panel.position.set(cx, FACE_H / 2, FACE_Z);
    panel.castShadow = true;
    panel.receiveShadow = true;
    group.add(panel);
    occluders.push(panel);

    // 红墙裙
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(w, 1.5, 0.62), matWallBase);
    skirt.position.set(cx, 0.75, FACE_Z);
    skirt.receiveShadow = true;
    group.add(skirt);

    // 格扇门窗：四扇，贴在墙面上
    const doorMat = new THREE.MeshStandardMaterial({
      map: (() => {
        const t = latticeTex.clone();
        t.needsUpdate = true;
        t.repeat.set(Math.max(4, Math.round((w - 1.5) / 2.6)), 1);
        return t;
      })(),
      roughness: 0.72,
      metalness: 0.06,
    });
    const doors = new THREE.Mesh(new THREE.BoxGeometry(w - 1.5, 3.7, 0.16), doorMat);
    doors.position.set(cx, 3.05, FACE_Z + 0.34);
    group.add(doors);

    // 门窗上下的红框（抹头/槛框）
    for (const [yy, hh] of [
      [1.2, 0.22],
      [4.98, 0.26],
    ] as Array<[number, number]>) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w - 1.1, hh, 0.24), matVermilion);
      bar.position.set(cx, yy, FACE_Z + 0.36);
      group.add(bar);
    }
  }

  // 立面上的朱红壁柱：把一整排格扇分成几间，免得 48m 的正面像一块大窗墙
  {
    const pilasters = new StaticBatch().shadow();
    for (const sx of [-1, 1]) {
      for (const px of [13.2, 19.6]) {
        pilasters.add(
          new THREE.BoxGeometry(0.42, 4.9, 0.34),
          matVermilion,
          sx * px,
          2.45,
          FACE_Z + 0.38,
        );
        pilasters.add(
          new THREE.BoxGeometry(0.7, 0.5, 0.42),
          matGold,
          sx * px,
          0.25,
          FACE_Z + 0.38,
        );
      }
    }
    pilasters.build(group);
  }

  // 檐柱：朱红圆柱 + 石础，立在月台边沿
  {
    const porchCols = new StaticBatch();
    const porchBases = new StaticBatch();
    for (const sx of [-1, 1]) {
      for (const px of [DOOR_HW + 0.35, 13.2, 19.6, 25.0]) {
        const x = sx * px;
        porchCols.add(
          new THREE.CylinderGeometry(0.36, 0.4, FACE_H, 14),
          matVermilion,
          x,
          FACE_H / 2,
          PORCH_Z,
        );
        porchBases.add(
          new THREE.CylinderGeometry(0.52, 0.6, 0.34, 16),
          matStoneLight,
          x,
          0.17,
          PORCH_Z,
        );
        obstacles.push({ x, z: PORCH_Z, r: 0.7 });
      }
    }
    porchCols.shadow().build(group);
    porchBases.build(group);
  }

  // 额枋：横跨整个正立面，同时兼作门洞上的门楣（参考图里这一条是彩画最醒目的地方）
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(FACE_OUT * 2, 0.86, 0.62), caihuaMat(FACE_OUT * 2));
  lintel.position.set(0, 6.6, FACE_Z);
  lintel.castShadow = true;
  group.add(lintel);

  // 门洞上方不再挂匾额：只留一条彩画门楣，视线直接进殿

  // 白石栏杆：月台前沿（门洞两侧）一排望柱 + 寻杖
  {
    const railing = new StaticBatch().shadow().receive();
    for (const sx of [-1, 1]) {
      const x0 = sx * 12.4;
      const x1 = sx * (FACE_OUT - 1.2);
      const back = 0.2;
      const railZ = STEP_Z0 - 0.2;
      const len = Math.abs(x1 - x0);

      const n = 6;
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        railing.add(
          new THREE.BoxGeometry(0.26, 1.02, 0.26),
          matStoneLight,
          x,
          0.51,
          railZ,
        );
        railing.add(
          new THREE.SphereGeometry(0.15, 10, 8),
          matStoneLight,
          x,
          1.08,
          railZ,
        );
      }

      railing.add(
        new THREE.BoxGeometry(len - 0.1, 0.16, 0.2),
        matStoneLight,
        (x0 + x1) / 2,
        0.78,
        railZ,
      );
      railing.add(
        new THREE.BoxGeometry(len - 0.1, 0.14, 0.26),
        matStoneLight,
        (x0 + x1) / 2,
        0.2 + back,
        railZ,
      );
    }
    railing.build(group);
  }

  // ————————————— 柱子

  // 只留两侧的两排檐柱（x = ±21.5）。
  // 原来还有一对 [-4.2, -8] / [4.2, -8] 的内柱，正好立在佛坛前沿，
  // 从殿内正面看会直接切在千手观音身上，故去掉。
  const pillarPositions: Array<[number, number]> = [
    [-21.5, -8],
    [21.5, -8],
    [-21.5, -1],
    [21.5, -1],
    [-21.5, 5.5],
    [21.5, 5.5],
  ];
  {
    const cols = new StaticBatch().shadow().receive();
    const bases = new StaticBatch().receive();
    for (const [x, z] of pillarPositions) {
      cols.add(
        new THREE.CylinderGeometry(0.33, 0.37, CEIL, 14),
        matVermilion,
        x,
        CEIL / 2,
        z,
      );
      bases.add(
        new THREE.CylinderGeometry(0.5, 0.56, 0.3, 16),
        matStoneSolid,
        x,
        0.15,
        z,
      );
      obstacles.push({ x, z, r: 0.75 });
    }
    cols.build(group);
    bases.build(group);
  }

  // ————————————— 佛坛

  const altarZ = -8.1;
  const steps: Array<[number, number, number]> = [
    [22.0, 0.34, 4.4],
    [20.6, 0.32, 4.15],
    [19.2, 0.32, 4.0],
  ];
  let ay = 0;
  {
    const altarSteps = new StaticBatch().shadow().receive();
    const altarTops = new StaticBatch();
    steps.forEach(([w, h, d], i) => {
      altarSteps.add(
        new THREE.BoxGeometry(w, h, d),
        matStoneSolid,
        0,
        ay + h / 2,
        altarZ,
      );
      ay += h;
      if (i === steps.length - 1) {
        altarTops.add(
          new THREE.BoxGeometry(w - 0.4, 0.1, d - 0.4),
          matBronzeLit,
          0,
          ay + 0.05,
          altarZ,
        );
      }
    });
    altarSteps.build(group);
    altarTops.build(group);
  }
  const altarTop = ay + 0.1;

  /** 背光 / 头光材质：昼夜切换时统一调透明度 */
  const mandorlaMats: THREE.MeshBasicMaterial[] = [];

  // ————————————— 千手千眼观世音（仿承德普宁寺大乘之阁）
  //
  // 大乘之阁里是一尊 22m 的金漆木雕立像：须弥座 + 莲台，42 臂
  // （两臂合掌当胸，其余 40 臂各持法器、掌心各一眼），冠中坐一尊
  // 无量光佛，两侧立善财、龙女。这里把整尊像压进 6.4m 的殿高里，
  // 从莲台一直顶到天花，抬头就是满壁的手眼。

  const matGilded = new THREE.MeshStandardMaterial({
    color: 0xb07a3c,
    roughness: 0.44,
    metalness: 0.42,
    emissive: 0x1b0f05,
  });
  const matGildedBright = new THREE.MeshStandardMaterial({
    color: 0xdcb063,
    roughness: 0.26,
    metalness: 0.8,
    emissive: 0x2a1a06,
  });
  const matRobeRed = new THREE.MeshStandardMaterial({
    map: robeTexture(),
    roughness: 0.55,
    metalness: 0.14,
  });
  const matFaceDark = new THREE.MeshStandardMaterial({
    color: 0x2a1408,
    roughness: 0.5,
    metalness: 0.1,
  });
  const matPalmEye = new THREE.MeshStandardMaterial({
    color: 0x5a3413,
    emissive: 0xffd79a,
    emissiveIntensity: 1.1,
    roughness: 0.4,
  });

  /** 在两点之间放一根胶囊（手臂的上下臂） */
  const limbUp = new THREE.Vector3(0, 1, 0);
  const limbFrom = new THREE.Vector3();
  const limbTo = new THREE.Vector3();
  const limbDir = new THREE.Vector3();
  const limbQuat = new THREE.Quaternion();
  const limbEuler = new THREE.Euler();
  function limb(
    batch: StaticBatch,
    mat: THREE.Material,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
  ) {
    limbFrom.set(ax, ay, az);
    limbTo.set(bx, by, bz);
    limbDir.subVectors(limbTo, limbFrom);
    const len = limbDir.length();
    if (len < 1e-4) return;
    limbQuat.setFromUnitVectors(limbUp, limbDir.normalize());
    limbEuler.setFromQuaternion(limbQuat);
    batch.add(
      new THREE.CapsuleGeometry(r, Math.max(0.02, len - r * 1.4), 4, 8),
      mat,
      (ax + bx) / 2,
      (ay + by) / 2,
      (az + bz) / 2,
      limbEuler.x,
      limbEuler.y,
      limbEuler.z,
    );
  }

  /** 40 只手里的法器：八种轮流，垂在掌下 */
  function addImplement(
    batch: StaticBatch,
    idx: number,
    hx: number,
    hy: number,
    hz: number,
  ) {
    const px = hx;
    const py = hy - 0.2;
    const pz = hz + 0.07;
    switch (idx % 8) {
      case 0: // 金刚杵
        batch.add(new THREE.CylinderGeometry(0.026, 0.026, 0.26, 6), matGildedBright, px, py, pz);
        batch.add(new THREE.SphereGeometry(0.05, 6, 6), matGildedBright, px, py + 0.15, pz);
        batch.add(new THREE.SphereGeometry(0.05, 6, 6), matGildedBright, px, py - 0.15, pz);
        break;
      case 1: // 宝瓶
        batch.add(new THREE.SphereGeometry(0.075, 8, 6), matGildedBright, px, py, pz, 0, 0, 0, 1, 1.2, 1);
        batch.add(new THREE.CylinderGeometry(0.026, 0.045, 0.11, 8), matGildedBright, px, py + 0.13, pz);
        break;
      case 2: // 莲花
        for (let p = 0; p < 6; p++) {
          const a = (p / 6) * Math.PI * 2;
          batch.add(
            new THREE.SphereGeometry(0.045, 6, 5),
            matGildedBright,
            px + Math.cos(a) * 0.05,
            py,
            pz + Math.sin(a) * 0.05,
            0,
            0,
            0,
            1,
            1.9,
            0.5,
          );
        }
        break;
      case 3: // 法轮
        batch.add(new THREE.TorusGeometry(0.11, 0.022, 6, 16), matGildedBright, px, py, pz);
        for (let s = 0; s < 4; s++) {
          batch.add(
            new THREE.BoxGeometry(0.02, 0.2, 0.02),
            matGildedBright,
            px,
            py,
            pz,
            0,
            0,
            (s / 4) * Math.PI,
          );
        }
        break;
      case 4: // 宝珠
        batch.add(new THREE.SphereGeometry(0.08, 8, 6), matGildedBright, px, py, pz);
        break;
      case 5: // 弓
        batch.add(
          new THREE.TorusGeometry(0.15, 0.017, 5, 12, Math.PI * 1.1),
          matGildedBright,
          px,
          py,
          pz,
          0,
          0,
          Math.PI * 0.5,
        );
        break;
      case 6: // 宝镜
        batch.add(
          new THREE.CylinderGeometry(0.1, 0.1, 0.02, 16),
          matGildedBright,
          px,
          py,
          pz,
          Math.PI / 2,
          0,
          0,
        );
        break;
      default: // 数珠
        batch.add(new THREE.TorusGeometry(0.09, 0.024, 6, 16), matGildedBright, px, py, pz);
        break;
    }
  }

  /** 主尊：一尊立像观音，本地 y=0 在莲台底，总高约 4.8m */
  function makeGuanyin() {
    const g = new THREE.Group();
    g.position.set(0, altarTop, altarZ);
    g.scale.setScalar(1.04);

    const gold = new StaticBatch().shadow();
    const body = new StaticBatch().shadow();
    const robe = new StaticBatch().shadow();
    const eyes = new StaticBatch();

    // —— 须弥座 + 双层莲台
    gold.add(new THREE.CylinderGeometry(1.94, 2.02, 0.14, 30), matGildedBright, 0, 0.07, 0);
    robe.add(new THREE.CylinderGeometry(1.82, 1.9, 0.2, 30), matRobeRed, 0, 0.24, 0);
    gold.add(new THREE.CylinderGeometry(1.86, 1.92, 0.06, 30), matGildedBright, 0, 0.37, 0);
    const PETALS = 20;
    for (let ring = 0; ring < 2; ring++) {
      const rr = 1.5 - ring * 0.14;
      const yy = 0.47 + ring * 0.07;
      for (let i = 0; i < PETALS; i++) {
        const a = (i / PETALS) * Math.PI * 2 + ring * (Math.PI / PETALS);
        gold.add(
          new THREE.SphereGeometry(0.17, 8, 6),
          matGildedBright,
          Math.cos(a) * rr,
          yy,
          Math.sin(a) * rr,
          0,
          -a,
          0,
          1.2,
          1.05,
          0.42,
        );
      }
    }
    gold.add(new THREE.CylinderGeometry(1.3, 1.4, 0.08, 30), matGildedBright, 0, 0.62, 0);

    // —— 红袍：从莲台垂到腰，下摆一圈金边
    const skirt: THREE.Vector2[] = [
      new THREE.Vector2(1.2, 0.66),
      new THREE.Vector2(1.15, 0.96),
      new THREE.Vector2(1.06, 1.36),
      new THREE.Vector2(0.98, 1.8),
      new THREE.Vector2(0.9, 2.16),
      new THREE.Vector2(0.85, 2.42),
      new THREE.Vector2(0.81, 2.58),
    ];
    robe.add(new THREE.LatheGeometry(skirt, 30), matRobeRed, 0, 0, 0);
    gold.add(new THREE.TorusGeometry(1.21, 0.045, 8, 40), matGildedBright, 0, 0.68, 0, Math.PI / 2, 0, 0);
    gold.add(new THREE.TorusGeometry(0.83, 0.06, 8, 32), matGildedBright, 0, 2.53, 0, Math.PI / 2, 0, 0);
    // 腰带垂下的两条飘带
    for (const sx of [-1, 1]) {
      robe.add(
        new THREE.BoxGeometry(0.16, 1.5, 0.05),
        matRobeRed,
        sx * 0.26,
        1.78,
        0.9,
        0,
        0,
        sx * 0.03,
      );
    }

    // 裙子的垂褶：几道顺着裙摆的凸棱
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.13;
      limb(
        robe,
        matRobeRed,
        Math.cos(a) * 0.82,
        2.52,
        Math.sin(a) * 0.82,
        Math.cos(a) * 1.2,
        0.68,
        Math.sin(a) * 1.2,
        0.045,
      );
    }

    // —— 上身：金漆
    const torso: THREE.Vector2[] = [
      new THREE.Vector2(0.82, 2.5),
      new THREE.Vector2(0.88, 2.75),
      new THREE.Vector2(0.92, 3.0),
      new THREE.Vector2(0.86, 3.22),
      new THREE.Vector2(0.7, 3.4),
      new THREE.Vector2(0.46, 3.52),
    ];
    body.add(new THREE.LatheGeometry(torso, 28), matGilded, 0, 0, 0);
    body.add(new THREE.SphereGeometry(0.5, 20, 14), matGilded, 0, 3.3, 0, 0, 0, 0, 1.78, 0.46, 0.9);
    body.add(new THREE.CylinderGeometry(0.2, 0.27, 0.26, 14), matGilded, 0, 3.58, 0);

    // —— 头面
    body.add(new THREE.SphereGeometry(0.44, 24, 20), matGilded, 0, 3.96, 0, 0, 0, 0, 0.94, 1.1, 0.92);
    for (const sx of [-1, 1]) {
      body.add(new THREE.SphereGeometry(0.1, 8, 8), matGilded, sx * 0.42, 3.95, 0, 0, 0, 0, 0.55, 1.5, 0.7);
      // 眼、眉
      body.add(
        new THREE.SphereGeometry(0.09, 8, 6),
        matFaceDark,
        sx * 0.15,
        4.0,
        0.4,
        0,
        0,
        sx * 0.05,
        0.82,
        0.16,
        0.2,
      );
      body.add(
        new THREE.TorusGeometry(0.09, 0.016, 5, 10, Math.PI * 0.8),
        matFaceDark,
        sx * 0.15,
        4.055,
        0.4,
        0,
        0,
        Math.PI * 0.1,
      );
    }
    // 鼻、口、白毫（额中第三目）
    body.add(new THREE.SphereGeometry(0.06, 8, 6), matGilded, 0, 3.93, 0.43, 0, 0, 0, 0.8, 1.7, 0.9);
    body.add(new THREE.BoxGeometry(0.07, 0.012, 0.02), matFaceDark, 0, 3.885, 0.45);
    body.add(
      new THREE.TorusGeometry(0.075, 0.013, 5, 12, Math.PI * 0.55),
      matFaceDark,
      0,
      3.815,
      0.43,
      0,
      0,
      Math.PI + Math.PI * 0.25,
    );
    body.add(new THREE.SphereGeometry(0.042, 8, 6), matGildedBright, 0, 4.06, 0.41, 0, 0, 0, 0.65, 1.1, 0.5);
    body.add(new THREE.SphereGeometry(0.022, 6, 6), matFaceDark, 0, 4.06, 0.44);

    // 发髻 + 宝冠（冠圈、五峰、冠中化佛）
    body.add(
      new THREE.SphereGeometry(0.43, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.4),
      matFaceDark,
      0,
      3.99,
      0,
      0,
      0,
      0,
      1.0,
      1.02,
      0.98,
    );
    gold.add(new THREE.CylinderGeometry(0.45, 0.47, 0.2, 20), matGildedBright, 0, 4.2, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.46;
      gold.add(
        new THREE.ConeGeometry(0.1, 0.34 - Math.abs(i - 2) * 0.05, 6),
        matGildedBright,
        Math.sin(a) * 0.38,
        4.5,
        Math.cos(a) * 0.38,
        Math.cos(a) * 0.22,
        -a,
        -Math.sin(a) * 0.22,
      );
    }
    // 冠中化佛：无量光佛
    gold.add(new THREE.ConeGeometry(0.1, 0.2, 8), matGildedBright, 0, 4.6, 0.24);
    gold.add(new THREE.SphereGeometry(0.065, 8, 6), matGildedBright, 0, 4.75, 0.24);
    gold.add(new THREE.TorusGeometry(0.095, 0.014, 5, 14), matGildedBright, 0, 4.75, 0.2);

    // —— 项饰、璎珞
    gold.add(
      new THREE.TorusGeometry(0.66, 0.04, 8, 30),
      matGildedBright,
      0,
      3.4,
      0.02,
      Math.PI / 2 - 0.22,
      0,
      0,
    );
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      gold.add(
        new THREE.SphereGeometry(0.055, 6, 5),
        matGildedBright,
        Math.cos(a) * 0.68,
        3.37,
        Math.sin(a) * 0.6 + 0.02,
      );
    }
    for (let i = 0; i < 6; i++) {
      gold.add(
        new THREE.SphereGeometry(0.045, 6, 5),
        matGildedBright,
        0,
        3.16 - i * 0.12,
        0.9 - i * 0.005,
      );
    }
    gold.add(new THREE.SphereGeometry(0.085, 8, 6), matGildedBright, 0, 2.46, 0.86, 0, 0, 0, 1, 1.4, 1);
    gold.add(new THREE.ConeGeometry(0.055, 0.16, 8), matGildedBright, 0, 2.28, 0.86);

    // —— 42 臂
    const SHOULDER_Y = 3.28;
    // 主臂：合掌当胸
    for (const sx of [-1, 1]) {
      limb(body, matGilded, sx * 0.64, SHOULDER_Y, 0.02, sx * 0.48, 2.98, 0.4, 0.13);
      limb(body, matGilded, sx * 0.48, 2.98, 0.4, sx * 0.13, 3.34, 0.66, 0.105);
      body.add(
        new THREE.SphereGeometry(0.12, 10, 8),
        matGilded,
        sx * 0.12,
        3.36,
        0.68,
        0,
        0,
        0,
        0.85,
        1.4,
        0.55,
      );
      eyes.add(new THREE.SphereGeometry(0.026, 6, 6), matPalmEye, sx * 0.12, 3.36, 0.75);
      gold.add(
        new THREE.TorusGeometry(0.1, 0.028, 6, 14),
        matGildedBright,
        sx * 0.13,
        3.24,
        0.64,
        Math.PI / 2,
        0,
        0,
      );
    }

    // 侧臂：每侧 20 只，两圈错开，向上张开如扇
    const rings: Array<{ n: number; r: number; a0: number; a1: number; z: number }> = [
      { n: 10, r: 1.42, a0: -0.55, a1: 1.5, z: -0.12 },
      { n: 10, r: 1.66, a0: -0.3, a1: 1.3, z: -0.5 },
    ];
    let armIndex = 0;
    for (const sx of [-1, 1]) {
      for (const def of rings) {
        for (let i = 0; i < def.n; i++) {
          const k = def.n === 1 ? 0 : i / (def.n - 1);
          const a = def.a0 + (def.a1 - def.a0) * k;
          const R = def.r * (0.94 + 0.1 * Math.sin(k * Math.PI));
          const hx = sx * Math.cos(a) * R;
          const hy = SHOULDER_Y + Math.sin(a) * R - 0.12;
          const hz = def.z;
          const ex = sx * Math.cos(a) * R * 0.46;
          const ey = SHOULDER_Y + Math.sin(a) * R * 0.48 - 0.3;
          const ez = def.z * 0.45 + 0.1;

          limb(body, matGilded, sx * 0.6, SHOULDER_Y, -0.02, ex, ey, ez, 0.105);
          limb(body, matGilded, ex, ey, ez, hx, hy, hz, 0.085);
          body.add(
            new THREE.SphereGeometry(0.1, 8, 6),
            matGilded,
            hx,
            hy,
            hz,
            0,
            sx * (0.16 - a * 0.1),
            0,
            0.95,
            1.3,
            0.5,
          );
          eyes.add(new THREE.SphereGeometry(0.024, 6, 6), matPalmEye, hx, hy, hz + 0.06);
          addImplement(gold, armIndex, hx, hy, hz);
          armIndex++;
        }
      }
    }

    gold.build(g);
    body.build(g);
    robe.build(g);
    eyes.build(g);
    group.add(g);
    return g;
  }

  /** 善财、龙女：站在佛前莲台上的两个小侍者 */
  function makeAttendant(px: number, girl: boolean) {
    const g = new THREE.Group();
    g.position.set(px, altarTop, altarZ + 1.45);
    g.rotation.y = px < 0 ? 0.3 : -0.3;

    const gold = new StaticBatch().shadow();
    const cloth = new StaticBatch().shadow();
    const dark = new StaticBatch();

    // 小莲座
    gold.add(new THREE.CylinderGeometry(0.3, 0.36, 0.09, 16), matGildedBright, 0, 0.045, 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      gold.add(
        new THREE.SphereGeometry(0.08, 6, 5),
        matGildedBright,
        Math.cos(a) * 0.3,
        0.13,
        Math.sin(a) * 0.3,
        0,
        -a,
        0,
        1.1,
        1.0,
        0.45,
      );
    }

    // 身体：上宽下窄的小袍子
    const prof: THREE.Vector2[] = [
      new THREE.Vector2(0.32, 0.16),
      new THREE.Vector2(0.3, 0.5),
      new THREE.Vector2(0.26, 0.82),
      new THREE.Vector2(0.24, 0.98),
      new THREE.Vector2(0.19, 1.08),
    ];
    cloth.add(new THREE.LatheGeometry(prof, 18), girl ? matRobeRed : matGilded, 0, 0, 0);
    gold.add(new THREE.TorusGeometry(0.235, 0.025, 6, 18), matGildedBright, 0, 0.98, 0, Math.PI / 2, 0, 0);

    // 肩
    gold.add(new THREE.SphereGeometry(0.2, 12, 10), matGilded, 0, 1.08, 0, 0, 0, 0, 1.45, 0.6, 0.85);

    // 合掌的双臂
    for (const sx of [-1, 1]) {
      limb(gold, matGilded, sx * 0.24, 1.06, 0.02, sx * 0.1, 0.86, 0.17, 0.05);
      limb(gold, matGilded, sx * 0.1, 0.86, 0.17, sx * 0.03, 0.98, 0.24, 0.042);
    }
    gold.add(new THREE.SphereGeometry(0.055, 8, 6), matGilded, 0, 1.0, 0.25, 0, 0, 0, 0.75, 1.2, 0.6);

    // 头 + 发 + 冠
    gold.add(new THREE.SphereGeometry(0.19, 14, 12), matGilded, 0, 1.28, 0, 0, 0, 0, 0.95, 1.05, 0.95);
    dark.add(new THREE.SphereGeometry(0.185, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), matFaceDark, 0, 1.3, 0);
    for (const sx of [-1, 1]) {
      gold.add(
        new THREE.SphereGeometry(0.04, 6, 6),
        matGildedBright,
        sx * 0.06,
        1.3,
        0.16,
        0,
        0,
        0,
        0.9,
        1.2,
        0.4,
      );
    }
    gold.add(new THREE.TorusGeometry(0.195, 0.018, 5, 18), matGildedBright, 0, 1.42, 0, Math.PI / 2, 0, 0);
    if (girl) {
      // 龙女：双髻
      for (const sx of [-1, 1]) {
        gold.add(new THREE.SphereGeometry(0.055, 8, 6), matGildedBright, sx * 0.09, 1.45, 0);
      }
    } else {
      // 善财：一个发髻
      gold.add(new THREE.SphereGeometry(0.065, 8, 6), matGildedBright, 0, 1.47, 0);
    }
    // 头光
    gold.add(new THREE.TorusGeometry(0.24, 0.014, 5, 20), matGildedBright, 0, 1.3, -0.14);

    gold.build(g);
    cloth.build(g);
    dark.build(g);
    group.add(g);
    return g;
  }

  // ————————————— 千手背光 + 头光

  // 千手如轮：一张画满手臂和掌心眼的透明贴图，贴在背屏前
  const haloPlaneMat = new THREE.MeshBasicMaterial({
    map: thousandHandHaloTexture(),
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  haloPlaneMat.userData.base = 1;
  mandorlaMats.push(haloPlaneMat);
  {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 4.9), haloPlaneMat);
    plane.position.set(0, 3.85, -9.4);
    group.add(plane);
  }

  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffcf8a,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  });
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.64, 56), haloMat);
  halo.position.set(0, altarTop + 4.15, -9.3);
  group.add(halo);

  // 一枚大金环把满壁的手圈成“背光”
  const aureoleMat = new THREE.MeshBasicMaterial({
    color: 0xe8b464,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  aureoleMat.userData.base = 0.5;
  mandorlaMats.push(aureoleMat);
  const aureole = new THREE.Mesh(new THREE.TorusGeometry(2.42, 0.03, 6, 72), aureoleMat);
  aureole.position.set(0, 3.95, -9.43);
  group.add(aureole);

  const haloGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffc078,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  haloGlow.scale.set(3.4, 3.4, 1);
  haloGlow.position.set(0, altarTop + 4.15, -9.26);
  group.add(haloGlow);

  const backGlow = new THREE.SpotLight(0xffb070, 16, 20, Math.PI * 0.42, 0.85, 1.7);
  backGlow.position.set(0, altarTop + 4.6, altarZ + 1.6);
  backGlow.target.position.set(0, altarTop + 2.8, altarZ - 1.6);
  group.add(backGlow, backGlow.target);

  makeGuanyin();
  makeAttendant(-4.2, false);
  makeAttendant(4.2, true);

  // ————————————— 殿内灯笼

  const lanterns: THREE.PointLight[] = [];
  for (const sx of [-1, 1]) {
    const lg = new THREE.Group();
    lg.position.set(sx * 6.6, CEIL - 0.7, altarZ + 2.0);

    const rope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 1.5, 5),
      new THREE.MeshBasicMaterial({ color: 0x2a2018 }),
    );
    rope.position.y = -0.75;
    lg.add(rope);

    const bodyL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.34, 0.62, 12),
      new THREE.MeshStandardMaterial({
        color: 0x6b3b1c,
        roughness: 0.6,
        emissive: 0xff8a3a,
        emissiveIntensity: 1.6,
      }),
    );
    bodyL.position.y = -1.65;
    lg.add(bodyL);

    for (const sy of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.16, 12), matDarkWood);
      cap.position.y = -1.65 + sy * 0.36;
      cap.rotation.x = sy > 0 ? Math.PI : 0;
      lg.add(cap);
    }

    // 这两盏不再加真实点光源：殿里已有长明灯 + 佛前三盏，
    // 多一盏就多一份逐像素光照开销；靠灯笼自身的发光贴图已经够看
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffa858,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    spr.scale.set(2.6, 2.6, 1);
    spr.position.y = -1.65;
    lg.add(spr);

    group.add(lg);
  }

  // ————————————— 长明灯 / 烛台（夜里主要靠它们，否则整个殿是黑的）

  const flames: Array<{ spr: THREE.Sprite; core: THREE.Mesh; seed: number }> = [];
  const matWax = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.75 });

  function candleStand(x: number, z: number, height: number, withLight: boolean) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.12, 12), matBronze);
    base.position.y = 0.06;
    base.castShadow = true;
    g.add(base);

    const colH = height - 0.62;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, colH, 10), matBronze);
    col.position.y = 0.12 + colH / 2;
    col.castShadow = true;
    g.add(col);

    const panY = 0.12 + colH;
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.14, 0.06, 12), matBronzeLit);
    pan.position.y = panY + 0.03;
    g.add(pan);

    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.26, 10), matWax);
    wax.position.y = panY + 0.19;
    g.add(wax);

    const flameY = panY + 0.36;
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd79a }),
    );
    core.scale.set(1, 1.9, 1);
    core.position.y = flameY;
    g.add(core);

    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffb264,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    spr.scale.set(1.5, 1.5, 1);
    spr.position.y = flameY;
    g.add(spr);

    flames.push({ spr, core, seed: Math.random() * 10 });

    if (withLight) {
      const pl = new THREE.PointLight(0xffb877, 16, 30, 1.25);
      pl.position.y = flameY;
      pl.userData.baseFactor = 1.5;
      pl.userData.flameSeed = flames.length - 1;
      g.add(pl);
      lanterns.push(pl);
    }

    group.add(g);
    obstacles.push({ x, z, r: 0.5 });
  }

  // 坐席两侧：两盏高的长明灯，负责照亮人和蒲团
  candleStand(-12.9, 0.6, 2.5, true);
  candleStand(12.9, 0.6, 2.5, true);
  // 佛前两支烛（只有火苗，不加真实光源，省着色器开销）
  candleStand(-7.0, -5.2, 1.6, false);
  candleStand(7.0, -5.2, 1.6, false);
  // 门口两支：同样只给火苗，让前景不至于一片黑
  candleStand(-7.6, 7.4, 1.7, false);
  candleStand(7.6, 7.4, 1.7, false);

  // ————————————— 坐垫

  const cushions: Cushion[] = [];
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0x6d4a34, roughness: 0.95 });
  const cushionTopMat = new THREE.MeshStandardMaterial({ color: 0x7d5940, roughness: 0.95 });

  const rows = [
    { z: -3.2, xs: [-9.2, -4.6, 0, 4.6, 9.2] },
    { z: -0.2, xs: [-9.2, -4.6, 0, 4.6, 9.2] },
    { z: 2.8, xs: [-9.2, -4.6, 0, 4.6, 9.2] },
    { z: 5.8, xs: [-9.2, -4.6, 0, 4.6, 9.2] },
  ];
  for (const row of rows) {
    for (const x of row.xs) {
      const c = new THREE.Group();

      // 高亮：一圈亮环 + 一层柔光，点击/悬停/已坐时出现
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffd79a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.7, 40), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.25;
      ring.visible = false;
      c.add(ring);

      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xffc066,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 28), glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.246;
      glow.visible = false;
      c.add(glow);

      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.62, 0.16, 20), cushionMat);
      base.position.y = 0.08;
      base.castShadow = true;
      base.receiveShadow = true;
      c.add(base);

      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 20), cushionTopMat);
      top.position.y = 0.19;
      top.receiveShadow = true;
      c.add(top);

      // 不可见的拾取圆盘：坐垫本体直径才 1.16m，手机上只有几十像素，
      // 直接拿它做射线目标很容易打偏变成"走过去"。这里放大到 1.7m。
      const pick = new THREE.Mesh(
        new THREE.CircleGeometry(0.85, 18),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      pick.rotation.x = -Math.PI / 2;
      pick.position.y = 0.3;
      c.add(pick);

      c.position.set(x, 0, row.z);
      c.rotation.y = (Math.random() - 0.5) * 0.12;
      group.add(c);

      cushions.push({
        mesh: base,
        seat: new THREE.Vector3(x, 0.14, row.z),
        occupied: false,
        flash: 0,
        hold: 0,
        hover: 0,
        shown: 0,
        ring,
        glow,
      });
    }
  }

  // ————————————— 香炉

  const burner = new THREE.Group();
  burner.position.set(BURNER_X, 0, BURNER_Z);
  {
    const bowl = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      matBronze,
    );
    bowl.rotation.x = Math.PI;
    bowl.position.y = 0.72;
    bowl.castShadow = true;
    burner.add(bowl);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.05, 8, 22), matBronzeLit);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.72;
    burner.add(rim);

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.72, 8), matBronze);
      leg.position.set(Math.cos(a) * 0.3, 0.36, Math.sin(a) * 0.3);
      leg.castShadow = true;
      burner.add(leg);
    }

    const ash = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshStandardMaterial({ color: 0x2b2520, roughness: 1 }),
    );
    ash.rotation.x = -Math.PI / 2;
    ash.position.y = 0.73;
    burner.add(ash);
  }
  group.add(burner);
  obstacles.push({ x: BURNER_X, z: BURNER_Z, r: 0.95 });

  // ————————————— 木鱼台

  const woodfishStand = new THREE.Group();
  woodfishStand.position.set(6.5, 0, 0.9);
  {
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 1.1), matDarkWood);
    table.position.y = 0.86;
    table.castShadow = true;
    woodfishStand.add(table);

    for (const [dx, dz] of [
      [-0.6, -0.42],
      [0.6, -0.42],
      [-0.6, 0.42],
      [0.6, 0.42],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.86, 0.1), matDarkWood);
      leg.position.set(dx, 0.43, dz);
      leg.castShadow = true;
      woodfishStand.add(leg);
    }

    const fish = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0x6b3d1e, roughness: 0.55 }),
    );
    fish.scale.set(1, 0.72, 0.86);
    fish.position.y = 1.14;
    fish.castShadow = true;
    woodfishStand.add(fish);

    const slit = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.035, 6, 18, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x150a04, roughness: 0.9 }),
    );
    slit.rotation.x = -Math.PI / 2;
    slit.position.y = 1.28;
    woodfishStand.add(slit);

    const mallet = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 8), matWood);
    mallet.rotation.z = 0.9;
    mallet.position.set(0.55, 1.02, 0.2);
    woodfishStand.add(mallet);
  }
  group.add(woodfishStand);
  obstacles.push({ x: 6.5, z: 0.9, r: 0.95 });

  // ————————————— 签筒（殿门口左手边，进门就能看见）

  const fortuneStand = new THREE.Group();
  fortuneStand.position.set(-7.6, 0, 7.4);
  {
    // 案
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.8), matWood);
    table.position.y = 0.84;
    table.castShadow = true;
    fortuneStand.add(table);

    for (const [dx, dz] of [
      [-0.48, -0.3],
      [0.48, -0.3],
      [-0.48, 0.3],
      [0.48, 0.3],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.84, 0.09), matDarkWood);
      leg.position.set(dx, 0.42, dz);
      leg.castShadow = true;
      fortuneStand.add(leg);
    }

    // 签筒：竹筒 + 一把签
    const bamboo = new THREE.MeshStandardMaterial({ color: 0x9a7a3f, roughness: 0.55 });
    const bambooDark = new THREE.MeshStandardMaterial({ color: 0x6d5327, roughness: 0.7 });
    const stickMat = new THREE.MeshStandardMaterial({ color: 0xd9c493, roughness: 0.6 });

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.155, 0.62, 16, 1, true), bamboo);
    tube.position.y = 1.2;
    tube.castShadow = true;
    fortuneStand.add(tube);

    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.155, 16), bambooDark);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.895;
    fortuneStand.add(bottom);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.014, 6, 18), matGold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 1.51;
    fortuneStand.add(rim);

    // 红绳捆在筒腰
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.012, 6, 18), matVermilion);
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.22;
    fortuneStand.add(band);

    {
      // 签筒里的 15 支签：原来一支一次 draw，合成一片（石头还是同一材质）
      const sticksBatch = new StaticBatch();
      for (let i = 0; i < 15; i++) {
        const a = (i / 15) * Math.PI * 2;
        const r = 0.03 + (i % 4) * 0.03;
        sticksBatch.add(
          new THREE.CylinderGeometry(0.011, 0.013, 0.46, 5),
          stickMat,
          Math.cos(a) * r,
          1.63 + (i % 5) * 0.012,
          Math.sin(a) * r,
          (Math.random() - 0.5) * 0.12,
          0,
          (Math.random() - 0.5) * 0.12,
        );
      }
      sticksBatch.build(fortuneStand);
    }

    // 牌子：两根柱子 + 横梁 + 竖排「求签」（牌子挂在横梁下，高出签筒，不挡视线）
    const postMat = matDarkWood;
    for (const dx of [-0.62, 0.62]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 3.3, 8), postMat);
      post.position.set(dx, 1.65, -0.22);
      post.castShadow = true;
      fortuneStand.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.07, 0.07), postMat);
    beam.position.set(0, 3.28, -0.22);
    fortuneStand.add(beam);

    // 牌子用 Basic 材质：殿里再暗也看得清，像一块亮着的木牌
    const signTex = signTexture('求签');
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 1.15),
      new THREE.MeshBasicMaterial({ map: signTex }),
    );
    sign.position.set(0, 2.6, -0.1);
    fortuneStand.add(sign);
    // 背面也贴一张，转身绕过来不会看到空白
    const signBack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 1.15),
      new THREE.MeshBasicMaterial({ map: signTex }),
    );
    signBack.rotation.y = Math.PI;
    signBack.position.set(0, 2.6, -0.12);
    fortuneStand.add(signBack);

    // 这盏小灯不再用真实点光源（远处一眼能看到靠的是下面的地面柔光）

    // 地上的一圈柔光：远处也能一眼看到这边有东西
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({
        map: glowTexture('rgba(255, 206, 138, 0.55)', 'rgba(255, 170, 80, 0)'),
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.012;
    fortuneStand.add(glow);

    // 拾取用的隐形大圆柱：手机上点窄小的签筒很难点中
    const pick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.95, 2.3, 12),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    pick.position.y = 1.15;
    fortuneStand.add(pick);
  }
  group.add(fortuneStand);
  obstacles.push({ x: -7.6, z: 7.4, r: 0.8 });

  // ————————————— 钟

  {
    const bellG = new THREE.Group();
    bellG.position.set(13.2, 0, -3.2);
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 1.5), matDarkWood);
    frameTop.position.y = 3.2;
    bellG.add(frameTop);
    for (const [dx, dz] of [
      [-0.62, -0.62],
      [0.62, -0.62],
      [-0.62, 0.62],
      [0.62, 0.62],
    ]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.12), matDarkWood);
      post.position.set(dx, 1.6, dz);
      post.castShadow = true;
      bellG.add(post);
    }
    const bell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.52, 1.15, 18, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x4a3f2c,
        roughness: 0.4,
        metalness: 0.85,
        side: THREE.DoubleSide,
        emissive: 0x1a1206,
      }),
    );
    bell.position.y = 2.35;
    bell.castShadow = true;
    bellG.add(bell);
    group.add(bellG);
    obstacles.push({ x: 13.2, z: -3.2, r: 0.9 });
  }

  // ═══════════════════════════ 庭院 ═══════════════════════════

  // 围墙（土黄墙 + 琉璃瓦压顶，与佛殿同色系）
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.0, WALL_Z - YARD_Z + 1), matWallOuter);
    w.position.set(sx * WALL_X, YARD_Y + 1.5, (WALL_Z + YARD_Z) / 2);
    w.receiveShadow = true;
    w.castShadow = true;
    group.add(w);
    occluders.push(w);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.16, WALL_Z - YARD_Z + 1), matGlazed);
    cap.position.set(sx * WALL_X, YARD_Y + 3.06, (WALL_Z + YARD_Z) / 2);
    group.add(cap);
  }

  // 从殿前两侧接出来的翼墙
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_X - HALL_HW - 0.4, 2.8, 0.6),
      matWallOuter,
    );
    wing.position.set(sx * (HALL_HW + (WALL_X - HALL_HW) / 2), YARD_Y + 1.4, 10.4);
    wing.castShadow = true;
    wing.receiveShadow = true;
    group.add(wing);
  }

  // 后墙 + 月洞门
  {
    const shape = new THREE.Shape();
    shape.moveTo(-WALL_X, 0);
    shape.lineTo(WALL_X, 0);
    shape.lineTo(WALL_X, 3.4);
    shape.lineTo(-WALL_X, 3.4);
    shape.closePath();

    const hole = new THREE.Path();
    hole.absarc(0, 1.55, 1.85, 0, Math.PI * 2, true);
    shape.holes.push(hole);

    const gate = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: false, curveSegments: 24 }),
      matWallOuter,
    );
    gate.position.set(0, YARD_Y, WALL_Z);
    gate.castShadow = true;
    gate.receiveShadow = true;
    group.add(gate);
    occluders.push(gate);

    // 月洞门中间是空的，相机还是会从洞里退出去；补一块不可见的挡板
    const camBlock = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_X * 2, 4.2, 0.2),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    camBlock.position.set(0, YARD_Y + 2.1, WALL_Z + 0.3);
    group.add(camBlock);
    occluders.push(camBlock);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(WALL_X * 2, 0.18, 1.0), matGlazed);
    cap.position.set(0, YARD_Y + 3.45, WALL_Z + 0.35);
    group.add(cap);
  }

  // 假山
  function rockery(cx: number, cz: number, scale: number, rot: number) {
    const g = new THREE.Group();
    g.position.set(cx, YARD_Y, cz);
    g.rotation.y = rot;

    const specs: Array<[number, number, number, number]> = [
      [0.95, 0.9, 0.3, 1.1],
      [0.82, 0.1, 0.9, 1.7],
      [0.7, -1.0, 1.2, 0.9],
      [0.62, 1.25, 1.5, 0.75],
      [0.55, -0.5, 2.2, 1.3],
      [0.48, 0.6, 2.5, 0.8],
      [0.42, -0.15, 0.1, 2.4],
      [0.36, 1.5, 0.6, 1.5],
      [0.3, -1.3, 0.4, 0.9],
      [0.26, 0.35, 1.6, 2.9],
    ];
    // 一堆松散的石头：合成一片（原来 10 次 draw，现在 1 次）
    const rocks = new StaticBatch().shadow().receive();
    for (const [r, dx, dz, h] of specs) {
      rocks.add(
        new THREE.DodecahedronGeometry(r * scale, 0),
        matRock,
        dx * scale,
        h * scale * 0.62,
        dz * scale,
        Math.random() * 3,
        Math.random() * 3,
        Math.random() * 3,
        1,
        h,
        1,
      );
    }
    rocks.build(g);
    group.add(g);
    obstacles.push({ x: cx, z: cz, r: 2.1 * scale });
  }

  rockery(-15.5, 19.0, 1.25, 0.4);
  rockery(29.6, 31.2, 0.95, 1.1);
  rockery(-22.0, 30.0, 0.9, 2.2);
  rockery(25.5, 19.5, 0.8, 2.6);

  // 水池
  const pondX = 13.5;
  const pondZ = 17.2;
  {
    const bank = new THREE.Mesh(
      new THREE.CircleGeometry(4.1, 32),
      new THREE.MeshStandardMaterial({ color: 0x3a4038, roughness: 1 }),
    );
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(pondX, YARD_Y + 0.008, pondZ);
    bank.scale.set(1, 0.76, 1);
    bank.receiveShadow = true;
    group.add(bank);

    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x2b4652,
      roughness: 0.16,
      metalness: 0.25,
      emissive: 0x0d1a22,
      transparent: true,
      opacity: 0.9,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.5, 40), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(pondX, YARD_Y + 0.03, pondZ);
    water.scale.set(1, 0.76, 1);
    group.add(water);
    waterMeshes.push(waterMat);

    // 岸石
    {
      const shore = new StaticBatch().shadow();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + Math.random() * 0.2;
        const rr = 3.5 + Math.random() * 0.5;
        shore.add(
          new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.34, 0),
          matRock,
          pondX + Math.cos(a) * rr,
          YARD_Y + 0.1 + Math.random() * 0.14,
          pondZ + Math.sin(a) * rr * 0.76,
          Math.random() * 3,
          Math.random() * 3,
          Math.random() * 3,
        );
      }
      shore.build(group);
    }

    obstacles.push({ x: pondX, z: pondZ, r: 3.9 });

    // ——— 池鱼：贴着水面游的小影子。
    // 池底只有一张色板、水面在它上面 2cm，所以鱼做成扁的，
    // 只让背脊露出水面一点点——不盯着看就只是几道水纹。
    const waterY = YARD_Y + 0.03;
    const fishMats = [
      new THREE.MeshStandardMaterial({ color: 0x3c4032, roughness: 0.5, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0x2f3a31, roughness: 0.55, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0x8a5a2c, roughness: 0.48, side: THREE.DoubleSide }),
    ];

    const makeFish = (
      len: number,
      mat: THREE.Material,
      rx: number,
      w: number,
      phase: number,
      deep = 0,
    ): PondFish => {
      const g = new THREE.Group();

      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
      body.scale.set(len * 0.17, len * 0.13, len * 0.5);
      g.add(body);

      // 尾鳍：竖着的一片三角，游起来左右摆
      const tail = new THREE.Group();
      tail.position.z = -len * 0.44;
      const tailGeo = new THREE.BufferGeometry();
      tailGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [0, 0, 0, 0, len * 0.1, -len * 0.3, 0, -len * 0.1, -len * 0.3],
          3,
        ),
      );
      tailGeo.computeVertexNormals();
      tail.add(new THREE.Mesh(tailGeo, mat));
      g.add(tail);

      // 背鳍：从上面看不清，侧面能看出是鱼
      const finGeo = new THREE.BufferGeometry();
      finGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [0, 0, len * 0.06, 0, len * 0.09, -len * 0.1, 0, 0, -len * 0.22],
          3,
        ),
      );
      finGeo.computeVertexNormals();
      const fin = new THREE.Mesh(finGeo, mat);
      fin.position.y = len * 0.11;
      g.add(fin);

      group.add(g);
      return {
        g,
        tail,
        rx,
        rz: rx * 0.72,
        w,
        phase,
        y: waterY - 0.018 - deep,
        bob: 0.004,
      };
    };

    fishes.push(makeFish(0.3, fishMats[0], 2.15, 0.1, 0.4));
    fishes.push(makeFish(0.26, fishMats[1], 1.5, -0.13, 2.7, 0.008));
    fishes.push(makeFish(0.34, fishMats[2], 2.6, 0.075, 4.5, 0.004));
  }

  // 松树
  // 树干 / 树冠都按材质合批：7 棵树原来 42 次 draw，现在 3 次
  const pineBarkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 });
  const pineBark = new StaticBatch().shadow();
  const pineLeaves = new StaticBatch().shadow();

  function pine(cx: number, cz: number, s: number) {
    pineBark.add(
      new THREE.CylinderGeometry(0.16, 0.26, 2.4, 8),
      pineBarkMat,
      cx,
      YARD_Y + 1.2 * s,
      cz,
      0,
      0,
      0,
      s,
      s,
      s,
    );

    const layers = 5;
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const r = 1.9 * (1 - t * 0.72);
      const y = 1.7 + i * 0.78;
      pineLeaves.add(
        new THREE.ConeGeometry(r, 1.35, 7, 1, true),
        i % 2 === 0 ? matLeaf : matLeafDark,
        cx,
        YARD_Y + y * s,
        cz,
        0,
        i * 0.5,
        0,
        s,
        s,
        s,
      );
    }

    obstacles.push({ x: cx, z: cz, r: 1.0 * s });
  }

  pine(-21.5, 14.8, 1.1);
  pine(-17.5, 27.0, 1.35);
  pine(22.5, 22.0, 1.0);
  pine(29.2, 20.4, 1.1);
  pine(-4.6, 31.5, 0.9);
  pine(-6.5, 40.5, 1.15);
  pine(7.2, 41.5, 1.0);
  pineBark.build(group);
  pineLeaves.build(group);

  // ————————————— 枫树：秋天到了，院子里几株红枫
  const mapleBarkMat = new THREE.MeshStandardMaterial({ color: 0x4a3326, roughness: 0.95 });
  const mapleMats = [
    new THREE.MeshStandardMaterial({ color: 0xb52f1c, roughness: 0.92, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0xcf5122, roughness: 0.9, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0xd98a2f, roughness: 0.9, flatShading: true }),
  ];
  const mapleSpots: Array<{ x: number; z: number; s: number }> = [];
  const mapleBark = new StaticBatch().shadow();
  const mapleLeaves = mapleMats.map(() => new StaticBatch().shadow());

  function maple(cx: number, cz: number, s: number) {
    // 主干
    mapleBark.add(
      new THREE.CylinderGeometry(0.13, 0.24, 2.6, 7),
      mapleBarkMat,
      cx,
      YARD_Y + 1.3 * s,
      cz,
      0,
      Math.random() * Math.PI,
      0.035,
      s,
      s,
      s,
    );

    // 三根斜枝
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      limb(
        mapleBark,
        mapleBarkMat,
        cx,
        YARD_Y + 2.05 * s,
        cz,
        cx + Math.cos(a) * 0.85 * s,
        YARD_Y + 3.1 * s,
        cz + Math.sin(a) * 0.85 * s,
        0.07 * s,
      );
    }

    // 树冠：一簇簇的红叶，三色交错
    const clusters = 20;
    for (let i = 0; i < clusters; i++) {
      const a = (i / clusters) * Math.PI * 2 + Math.random() * 0.6;
      const rr = (0.35 + Math.random() * 1.25) * s;
      const h = 3.15 + Math.random() * 1.05 - rr * 0.25;
      const r = (0.42 + Math.random() * 0.3) * s;
      const mi = i % 3;
      mapleLeaves[mi].add(
        new THREE.IcosahedronGeometry(r, 0),
        mapleMats[mi],
        cx + Math.cos(a) * rr,
        YARD_Y + h * s,
        cz + Math.sin(a) * rr,
        Math.random() * 3,
        Math.random() * 3,
        Math.random() * 3,
        1.25,
        0.82,
        1.25,
      );
    }

    obstacles.push({ x: cx, z: cz, r: 0.8 * s });
    mapleSpots.push({ x: cx, z: cz, s });
  }

  maple(-7.8, 15.6, 0.85);
  maple(7.6, 16.2, 0.8);
  maple(-19.0, 15.2, 1.15);
  maple(19.5, 15.0, 1.05);
  maple(-26.5, 24.5, 1.3);
  maple(9.5, 31.0, 1.0);
  maple(37.0, 28.5, 1.15);   // 墙外的红枫，越过墙头露出半树
  maple(-12.0, 32.0, 0.95);
  // 围墙外再露两株，越过墙头能看到一片红
  maple(1.0, 39.0, 1.25);
  maple(-10.0, 40.5, 1.05);

  // 几丛秋色灌木（和枫叶同色系）
  for (const [bx, bz, br, mi] of [
    [5.4, 13.8, 0.58, 1],
    [-5.6, 14.2, 0.52, 2],
    [-13.5, 17.0, 0.62, 2],
    [15.8, 30.8, 0.72, 0],
    [-23.0, 16.5, 0.6, 1],
    [10.2, 21.0, 0.55, 0],
    [-9.4, 29.0, 0.6, 1],
  ] as Array<[number, number, number, number]>) {
    mapleLeaves[mi].add(
      new THREE.SphereGeometry(br, 9, 7),
      mapleMats[mi],
      bx,
      YARD_Y + br * 0.5,
      bz,
      0,
      0,
      0,
      1.25,
      0.72,
      1.15,
    );
  }

  mapleBark.build(group);
  mapleLeaves.forEach((b) => b.build(group));

  // ————————————— 落叶：枫树下一圈，路边和门口再散一些
  {
    const leafTex = mapleLeafTexture();
    const leafMats = [
      new THREE.MeshStandardMaterial({
        map: leafTex,
        transparent: true,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.92,
      }),
      new THREE.MeshStandardMaterial({
        map: leafTex,
        color: 0xe8b06a,
        transparent: true,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.92,
      }),
      new THREE.MeshStandardMaterial({
        map: leafTex,
        color: 0xa12a18,
        transparent: true,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.92,
      }),
    ];
    const litter = leafMats.map(() => new StaticBatch().receive());

    const dropLeaf = (x: number, z: number, y = YARD_Y + 0.022) => {
      const mi = Math.floor(Math.random() * 3);
      const sc = 0.7 + Math.random() * 0.6;
      litter[mi].add(
        new THREE.PlaneGeometry(0.22, 0.22),
        leafMats[mi],
        x,
        y,
        z,
        -Math.PI / 2,
        0,
        Math.random() * Math.PI * 2,
        sc,
        sc,
        sc,
      );
    };

    for (const spot of mapleSpots) {
      const n = Math.round(26 * spot.s);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = (1.2 + Math.random() * 2.9) * spot.s;
        dropLeaf(spot.x + Math.cos(a) * rr, spot.z + Math.sin(a) * rr);
      }
    }
    // 石板路两侧 + 路面上被踩散的几片
    for (let i = 0; i < 70; i++) {
      const side = Math.random() > 0.5 ? 1 : -1;
      dropLeaf(side * (2.6 + Math.random() * 1.6), 13.2 + Math.random() * 19.5);
    }
    for (let i = 0; i < 34; i++) {
      dropLeaf((Math.random() - 0.5) * 5.0, 14.0 + Math.random() * 18.0);
    }
    // 被风吹进殿门口的一层
    for (let i = 0; i < 4; i++) {
      dropLeaf(-7.6 + i * 4.2, 8.6 + Math.random() * 1.6);
    }
    for (let i = 0; i < 16; i++) {
      dropLeaf((Math.random() - 0.5) * 12, 8.2 + Math.random() * 1.8, 0.02);
    }
    litter.forEach((b) => b.build(group));
  }

  // 灌木（6 丛 → 1 次 draw）
  {
    const bushes = new StaticBatch().shadow();
    for (const [bx, bz, br] of [
      [-3.6, 13.6, 0.8],
      [3.8, 13.4, 0.72],
      [-25.0, 20.0, 1.0],
      [6.2, 29.5, 0.9],
      [-9.5, 15.2, 0.62],
      [17.5, 32.6, 0.86],
      [9.6, 13.6, 0.7],
      [-8.8, 27.5, 0.66],
    ]) {
      bushes.add(
        new THREE.SphereGeometry(br, 10, 8),
        matLeaf,
        bx,
        YARD_Y + br * 0.5,
        bz,
        0,
        0,
        0,
        1.25,
        0.72,
        1.15,
      );
    }
    bushes.build(group);
  }

  // 石灯笼
  const yardLights: THREE.PointLight[] = [];
  function stoneLantern(cx: number, cz: number, withLight: boolean) {
    const g = new THREE.Group();
    g.position.set(cx, YARD_Y, cz);

    // 石构件（座/柱/盘/顶/宝珠）合成一片：石灯笼原来 5 次 draw
    const stone = new StaticBatch().shadow();
    stone.add(new THREE.CylinderGeometry(0.34, 0.4, 0.2, 8), matStoneSolid, 0, 0.1, 0);
    stone.add(new THREE.CylinderGeometry(0.12, 0.14, 0.78, 8), matStoneSolid, 0, 0.58, 0);
    stone.add(new THREE.CylinderGeometry(0.3, 0.26, 0.12, 8), matStoneSolid, 0, 1.02, 0);
    stone.add(new THREE.ConeGeometry(0.44, 0.26, 8), matStoneSolid, 0, 1.5, 0);
    stone.add(new THREE.SphereGeometry(0.07, 8, 6), matStoneSolid, 0, 1.66, 0);
    stone.build(g);

    const boxGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0x3a2c1c,
        emissive: 0xffa860,
        emissiveIntensity: 0.85,
        roughness: 0.8,
      }),
    );
    boxGlow.position.y = 1.23;
    g.add(boxGlow);

    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffa858,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    spr.scale.set(1.3, 1.3, 1);
    spr.position.y = 1.23;
    g.add(spr);

    if (withLight) {
      const pl = new THREE.PointLight(0xffa858, 9, 11, 2);
      pl.position.y = 1.25;
      pl.userData.baseFactor = 0.6;
      g.add(pl);
      lanterns.push(pl);
      yardLights.push(pl);
    }

    group.add(g);
    obstacles.push({ x: cx, z: cz, r: 0.55 });
  }

  stoneLantern(-3.5, 14.6, true);
  stoneLantern(3.5, 14.6, false);
  stoneLantern(-3.5, 23.4, true);
  stoneLantern(3.5, 23.4, false);
  stoneLantern(-3.5, 31.0, false);
  stoneLantern(9.0, 20.0, false);
  stoneLantern(-9.0, 20.0, false);


  // ————————————— 钟楼（院落东南角）
  // 四柱方亭、绿琉璃攒尖顶、白石台基，钟挂在中间的横梁上。
  {
    const TX = 22.8;
    const TZ = 26.6;
    const g = new THREE.Group();
    g.position.set(TX, YARD_Y, TZ);
    group.add(g);

    // 台基铺地：比台基稍大一圈，免得草直接长到台阶根
    const apronTex = pathTex.clone();
    apronTex.needsUpdate = true;
    apronTex.repeat.set(2.6, 2.6);
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(7.6, 7.6),
      new THREE.MeshStandardMaterial({ map: apronTex, color: 0xa8a49a, roughness: 0.94 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = 0.012;
    apron.receiveShadow = true;
    g.add(apron);

    // 台基：下碱、台帮、白石台面；西面两级踏跺
    const base = new StaticBatch().shadow().receive();
    base.add(new THREE.BoxGeometry(6.3, 0.3, 6.3), matStoneSolid, 0, 0.15, 0);
    base.add(new THREE.BoxGeometry(5.9, 0.42, 5.9), matStoneSolid, 0, 0.51, 0);
    base.add(new THREE.BoxGeometry(6.1, 0.16, 6.1), matStoneLight, 0, 0.81, 0);
    base.add(new THREE.BoxGeometry(0.9, 0.3, 2.4), matStoneLight, -3.35, 0.15, 0);
    base.add(new THREE.BoxGeometry(0.56, 0.56, 2.4), matStoneLight, -3.17, 0.28, 0);
    // 台面一圈压边
    base.add(new THREE.BoxGeometry(6.2, 0.08, 0.16), matStoneSolid, 0, 0.93, 3.02);
    base.add(new THREE.BoxGeometry(6.2, 0.08, 0.16), matStoneSolid, 0, 0.93, -3.02);
    base.add(new THREE.BoxGeometry(0.16, 0.08, 6.2), matStoneSolid, 3.02, 0.93, 0);
    base.add(new THREE.BoxGeometry(0.16, 0.08, 6.2), matStoneSolid, -3.02, 0.93, 0);
    base.build(g);

    // 四根朱红柱 + 柱础 + 斗拱
    const red = new StaticBatch().shadow();
    const stoneTrim = new StaticBatch().shadow();
    const dark = new StaticBatch().shadow();
    const gold = new StaticBatch().shadow();
    for (const cx of [-1.85, 1.85]) {
      for (const cz of [-1.85, 1.85]) {
        stoneTrim.add(new THREE.CylinderGeometry(0.27, 0.31, 0.18, 14), matStoneLight, cx, 0.98, cz);
        red.add(new THREE.CylinderGeometry(0.16, 0.19, 3.38, 14), matVermilion, cx, 2.74, cz);
        red.add(new THREE.BoxGeometry(0.56, 0.14, 0.26), matVermilion, cx, 4.42, cz);
        red.add(new THREE.BoxGeometry(0.26, 0.14, 0.56), matVermilion, cx, 4.42, cz);
        dark.add(new THREE.BoxGeometry(0.36, 0.12, 0.36), matDarkWood, cx, 4.3, cz);
        gold.add(new THREE.BoxGeometry(0.16, 0.1, 0.16), matGold, cx, 4.2, cz);
      }
    }
    // 挂钟的横梁
    dark.add(new THREE.BoxGeometry(3.7, 0.22, 0.22), matDarkWood, 0, 4.5, 0);

    red.build(g);
    stoneTrim.build(g);
    dark.build(g);
    gold.build(g);

    // 四面彩画额枋
    {
      const beamMat = caihuaMat(4.6);
      const beams = new StaticBatch().shadow();
      for (const bz of [-1.85, 1.85]) {
        beams.add(new THREE.BoxGeometry(4.6, 0.38, 0.28), beamMat, 0, 4.62, bz);
      }
      for (const bx of [-1.85, 1.85]) {
        beams.add(new THREE.BoxGeometry(0.28, 0.38, 4.6), beamMat, bx, 4.62, 0);
      }
      beams.build(g);
    }

    // 铜钟：车削出钟形，钟身贴分块铭文
    {
      const bellPts = [
        new THREE.Vector2(0.86, 0),
        new THREE.Vector2(0.9, 0.1),
        new THREE.Vector2(0.88, 0.24),
        new THREE.Vector2(0.8, 0.5),
        new THREE.Vector2(0.72, 0.85),
        new THREE.Vector2(0.66, 1.25),
        new THREE.Vector2(0.62, 1.6),
        new THREE.Vector2(0.6, 1.85),
        new THREE.Vector2(0.52, 1.96),
        new THREE.Vector2(0.34, 2.0),
      ];
      const bellTex = bellTexture();
      const bellMat = new THREE.MeshStandardMaterial({
        map: bellTex,
        roughness: 0.42,
        metalness: 0.72,
        emissive: 0x17110a,
        side: THREE.DoubleSide,
      });
      const bell = new THREE.Mesh(new THREE.LatheGeometry(bellPts, 32), bellMat);
      bell.position.y = 1.7;
      bell.castShadow = true;
      g.add(bell);

      const bronze = new StaticBatch().shadow();
      // 钟口、腰部两道箍
      bronze.add(new THREE.TorusGeometry(0.9, 0.045, 8, 32), matBronzeLit, 0, 1.73, 0, Math.PI / 2);
      bronze.add(new THREE.TorusGeometry(0.81, 0.028, 6, 28), matBronzeLit, 0, 2.2, 0, Math.PI / 2);
      bronze.add(new THREE.TorusGeometry(0.64, 0.024, 6, 28), matBronzeLit, 0, 3.18, 0, Math.PI / 2);
      // 钟顶吊环与吊杆
      bronze.add(new THREE.TorusGeometry(0.11, 0.035, 8, 16), matBronzeLit, 0, 3.76, 0);
      bronze.add(new THREE.CylinderGeometry(0.045, 0.045, 0.68, 8), matBronzeLit, 0, 4.06, 0);
      bronze.build(g);
    }

    // 绿琉璃攒尖顶 + 四角起翘
    const roof = hipRoof(3.95, 3.95, 0.12, 0.12, 5.05, 6.95, matGlazed, {
      segs: 5,
      sideSegs: 8,
      cornerLift: 0.62,
      lip: { h: 0.2, mat: matRidge },
    });
    roof.castShadow = true;
    roof.receiveShadow = true;
    g.add(roof);
    occluders.push(roof);

    // 翼角上的小翘头 + 宝顶
    const roofTrim = new StaticBatch().shadow();
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        roofTrim.add(
          new THREE.ConeGeometry(0.085, 0.46, 6),
          matGold,
          sx * 3.8,
          5.96,
          sz * 3.8,
          sz * 0.4,
          0,
          -sx * 0.4,
        );
      }
    }
    // 宝顶：座 + 两球 + 尖
    roofTrim.add(new THREE.CylinderGeometry(0.26, 0.3, 0.18, 12), matGold, 0, 7.03, 0);
    roofTrim.add(new THREE.SphereGeometry(0.2, 14, 10), matGold, 0, 7.23, 0);
    roofTrim.add(new THREE.SphereGeometry(0.12, 12, 8), matGold, 0, 7.43, 0);
    roofTrim.add(new THREE.ConeGeometry(0.035, 0.2, 8), matGold, 0, 7.57, 0);
    roofTrim.build(g);

    // 台前小石碑
    {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.96, 0.12), matStoneLight);
      frame.position.set(-3.42, 0.52, 1.95);
      frame.rotation.y = -Math.PI / 2;
      frame.castShadow = true;
      g.add(frame);

      const steleTex = steleTexture('鐘樓');
      const steleMat = new THREE.MeshStandardMaterial({ map: steleTex, roughness: 0.9 });
      const stele = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.8), steleMat);
      stele.position.set(-3.49, 0.52, 1.95);
      stele.rotation.y = -Math.PI / 2;
      g.add(stele);
      obstacles.push({ x: TX - 3.42, z: TZ + 1.95, r: 0.8 });
    }

    obstacles.push({ x: TX, z: TZ, r: 3.3 });
  }

  // ————————————— 天空

  const skyUniforms = {
    topColor: { value: new THREE.Color(0x0a1524) },
    bottomColor: { value: new THREE.Color(0x243244) },
    exponent: { value: 1.1 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(260, 32, 20),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float exponent;
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y;
          float f = pow(clamp(h * 0.5 + 0.5, 0.0, 1.0), exponent);
          gl_FragColor = vec4(mix(bottomColor, topColor, f), 1.0);
          // 自定义 shader 不会自己做输出转换。少了这一句，写进画面的就是线性值，
          // 显示时被当成 sRGB 直接读，整片天空会暗一大截、颜色也发闷。
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  sky.frustumCulled = false;
  group.add(sky);

  // 星
  const starN = 420;
  const starPos = new Float32Array(starN * 3);
  for (let i = 0; i < starN; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.random() * 0.72 + 0.06; // 只铺在天顶附近
    const r = 240;
    starPos[i * 3] = Math.cos(u) * Math.sin(v * Math.PI * 0.5) * r;
    starPos[i * 3 + 1] = Math.cos(v * Math.PI * 0.5) * r;
    starPos[i * 3 + 2] = Math.sin(u) * Math.sin(v * Math.PI * 0.5) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xdfe8f5,
    size: 1.4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  group.add(stars);

  // 月
  const moonSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xdfe6f2,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  moonSprite.scale.set(60, 60, 1);
  moonSprite.position.set(-110, 120, -170);
  group.add(moonSprite);

  const moonDisc = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: 0xf2f4ea,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  );
  moonDisc.scale.set(16, 16, 1);
  moonDisc.position.set(-110, 120, -169);
  group.add(moonDisc);

  // ————————————— 香烟

  const SMOKE_N = 46;
  const smokeGeo = new THREE.BufferGeometry();
  const smokePos = new Float32Array(SMOKE_N * 3);
  const smokeData: Array<{ life: number; max: number; vy: number; vx: number; vz: number }> = [];
  for (let i = 0; i < SMOKE_N; i++) {
    smokePos[i * 3] = BURNER_X + (Math.random() - 0.5) * 0.24;
    smokePos[i * 3 + 1] = 1.76 + Math.random() * 2;
    smokePos[i * 3 + 2] = BURNER_Z + (Math.random() - 0.5) * 0.24;
    smokeData.push({
      life: Math.random() * 7,
      max: 6 + Math.random() * 4,
      vy: 0.32 + Math.random() * 0.4,
      vx: (Math.random() - 0.5) * 0.1,
      vz: (Math.random() - 0.5) * 0.1,
    });
  }
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
  const smokeMat = new THREE.PointsMaterial({
    map: smokeTex,
    size: 0.42,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  group.add(smoke);

  // 香
  const incenseGroup = new THREE.Group();
  burner.add(incenseGroup);
  const sticks: Array<{ tip: THREE.Mesh; spr: THREE.Sprite; stick: THREE.Mesh; born: number }> = [];
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.9 });

  function addIncense() {
    const slot = sticks.length % 3;
    const a = (slot / 3) * Math.PI * 2 + 0.6;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.95, 6), stickMat);
    stick.position.set(Math.cos(a) * 0.14, 1.15, Math.sin(a) * 0.14);
    stick.rotation.z = Math.cos(a) * 0.12;
    stick.rotation.x = Math.sin(a) * 0.12;
    incenseGroup.add(stick);

    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff8a3a }),
    );
    tip.position.set(
      stick.position.x + Math.cos(a) * 0.06,
      1.62,
      stick.position.z + Math.sin(a) * 0.06,
    );
    incenseGroup.add(tip);

    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xff9a48,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    spr.scale.set(0.32, 0.32, 1);
    spr.position.copy(tip.position);
    incenseGroup.add(spr);

    sticks.push({ tip, spr, stick, born: performance.now() });
    if (sticks.length > 5) {
      const old = sticks.shift()!;
      old.tip.parent?.remove(old.tip);
      old.spr.parent?.remove(old.spr);
      old.stick.parent?.remove(old.stick);
    }
  }

  // ————————————— 灯光

  const ambient = new THREE.AmbientLight(0x8ea6bf, 1.15);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xa8c0da, 0x3c372c, 0.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe8c8, 1.85);
  sun.position.set(18, 26, 24);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -42;
  sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -20;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  scene.add(sun);

  // 殿内的补光改成暖色：冷蓝补光会让灰墙显得阴
  const hallFill = new THREE.PointLight(0xffcf9e, 11, 42, 1.5);
  hallFill.position.set(0, CEIL - 1.1, 3.5);
  scene.add(hallFill);

  const altarLight = new THREE.PointLight(0xffb070, 11, 18, 1.8);
  altarLight.position.set(0, altarTop + 3.1, altarZ + 2.6);
  scene.add(altarLight);

  const fog = new THREE.FogExp2(0x93a6b8, 0.0085);
  scene.fog = fog;

  // ————————————— 雪盖：地面 / 台阶 / 屋顶各盖一层白，统一淡入淡出

  // 地面和屋顶用两张贴图：地面按平面 UV 多铺几遍，屋顶的 UV 已经是世界尺度的
  const snowGroundTex = snowTexture();
  snowGroundTex.repeat.set(26, 26);
  const snowRoofTex = snowTexture();
  snowRoofTex.repeat.set(1, 1);

  const snowBase = {
    roughness: 0.95,
    metalness: 0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  } as const;
  const snowGroundMat = new THREE.MeshStandardMaterial({
    ...snowBase,
    map: snowGroundTex,
    color: 0xe6edf5,
  });
  const snowRoofMat = new THREE.MeshStandardMaterial({
    ...snowBase,
    map: snowRoofTex,
    color: 0xeaf1f8,
  });
  const snowMats = [snowGroundMat, snowRoofMat];
  const snowGroup = new THREE.Group();
  snowGroup.visible = false;
  group.add(snowGroup);

  const addSnowPlane = (w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), snowGroundMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    snowGroup.add(m);
  };
  // 只盖庭院与台阶：殿里有屋顶，殿内地面不该积雪
  addSnowPlane(120, 90, 0, YARD_Y + 0.022, 40);
  for (let i = 0; i < 3; i++) {
    addSnowPlane(24, 0.62, 0, -0.3 * (i + 1) + 0.03, 11.35 + i * 0.6);
  }
  // 屋顶：克隆屋顶几何，用同一份白雪材质盖上去（polygonOffset 防闪面）
  for (const roof of [roofLower, roofUpper]) {
    const cap = new THREE.Mesh(roof.geometry, snowRoofMat);
    cap.position.copy(roof.position);
    cap.rotation.copy(roof.rotation);
    cap.scale.copy(roof.scale).multiplyScalar(1.002);
    snowGroup.add(cap);
  }
  {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(ridgeLen + 0.02, 0.48, 0.64), snowRoofMat);
    cap.position.copy(ridgeBeam.position);
    snowGroup.add(cap);
  }

  // ————————————— 昼夜与天气

  let nightTarget = 1;
  let night = 1;

  function setNight(v: boolean) {
    nightTarget = v ? 1 : 0;
  }

  /** 一帧里的全套光照参数（数值 + 颜色），天气与昼夜都折进这里 */
  interface Palette {
    ambColor: THREE.Color;
    ambI: number;
    hemiSky: THREE.Color;
    hemiGround: THREE.Color;
    hemiI: number;
    sunColor: THREE.Color;
    sunI: number;
    fog: THREE.Color;
    fogD: number;
    lantern: number;
    altar: number;
    halo: number;
    skyTop: THREE.Color;
    skyBottom: THREE.Color;
    stars: number;
    moon: number;
    snow: number;
  }

  // 白天的基础值：在这次调亮之前，天空偏暗、雾也重
  const DAY = {
    ambColor: new THREE.Color(0x9fb6cf),
    ambI: 1.5,
    hemiSky: new THREE.Color(0xbcd3ea),
    hemiGround: new THREE.Color(0x4d4638),
    hemiI: 1.2,
    sunColor: new THREE.Color(0xfff1d8),
    sunI: 2.55,
    sunPos: new THREE.Vector3(18, 26, 24),
    fog: new THREE.Color(0xbfd4e4),
    fogD: 0.005,
    lantern: 0.32,
    altar: 0.5,
    halo: 0.55,
    skyTop: new THREE.Color(0x3f8bd8),
    skyBottom: new THREE.Color(0xd3ecfb),
    stars: 0,
    moon: 0,
  };
  const NIGHT = {
    ambColor: new THREE.Color(0x263650),
    ambI: 2.25,
    hemiSky: new THREE.Color(0x30496a),
    hemiGround: new THREE.Color(0x080a0e),
    hemiI: 1.35,
    sunColor: new THREE.Color(0xa8c0e0),
    sunI: 1.15,
    sunPos: new THREE.Vector3(-22, 30, -12),
    fog: new THREE.Color(0x0a1018),
    fogD: 0.018,
    lantern: 1,
    altar: 1,
    halo: 1,
    skyTop: new THREE.Color(0x050a12),
    skyBottom: new THREE.Color(0x152234),
    stars: 1,
    moon: 1,
  };

  /**
   * 天气对白天的影响。只覆盖需要变的那几项，其余沿用 DAY。
   * 雨/雪/阴天把天空压向灰蓝，雾更浓、太阳更弱；晴天把雾压到很薄、天空更通透。
   */
  const WEATHER_DAY: Record<WeatherKind, Partial<Palette>> = {
    clear: {
      // 晴天的蓝要“透”：天顶是洗过的蔚蓝，靠近地平线也只是淡淡一层青，
      // 不能发灰。两端都往蓝里靠（地平线不用接近白的颜色），
      // 因为线性空间里混白会把整片天空洗成一层雾。
      skyTop: new THREE.Color(0x1e74d2),
      skyBottom: new THREE.Color(0x9fcfef),
      fog: new THREE.Color(0xc9deed),
      fogD: 0.0038,
      sunI: 2.75,
      ambI: 1.55,
      hemiI: 1.3,
    },
    partly: {
      skyTop: new THREE.Color(0x4c8fce),
      skyBottom: new THREE.Color(0xd0e4f2),
      fog: new THREE.Color(0xc6d9e6),
      fogD: 0.005,
      sunI: 2.3,
      ambI: 1.48,
    },
    cloudy: {
      skyTop: new THREE.Color(0x6b93b8),
      skyBottom: new THREE.Color(0xcfdce6),
      fog: new THREE.Color(0xc2cfda),
      fogD: 0.0068,
      sunI: 1.75,
      sunColor: new THREE.Color(0xf2f0e6),
      ambI: 1.44,
    },
    overcast: {
      skyTop: new THREE.Color(0x7e8d99),
      skyBottom: new THREE.Color(0xbcc7cf),
      fog: new THREE.Color(0xb4bfc8),
      fogD: 0.0088,
      sunI: 1.05,
      sunColor: new THREE.Color(0xdfe6ec),
      ambI: 1.4,
      hemiI: 1.16,
    },
    fog: {
      skyTop: new THREE.Color(0x9aa7b0),
      skyBottom: new THREE.Color(0xd0d8dd),
      fog: new THREE.Color(0xd0d8dd),
      fogD: 0.017,
      sunI: 0.8,
      sunColor: new THREE.Color(0xe4e9ec),
      ambI: 1.42,
    },
    rain: {
      skyTop: new THREE.Color(0x4f6070),
      skyBottom: new THREE.Color(0x93a1ac),
      fog: new THREE.Color(0x94a2ad),
      fogD: 0.011,
      sunI: 0.95,
      sunColor: new THREE.Color(0xd7e0e8),
      ambI: 1.38,
      hemiI: 1.14,
    },
    snow: {
      skyTop: new THREE.Color(0x7d93a8),
      skyBottom: new THREE.Color(0xd6e1ea),
      fog: new THREE.Color(0xc9d6e0),
      fogD: 0.012,
      sunI: 1.0,
      sunColor: new THREE.Color(0xeaf1f6),
      ambI: 1.5,
      hemiI: 1.28,
    },
    thunder: {
      skyTop: new THREE.Color(0x333f4b),
      skyBottom: new THREE.Color(0x6c7885),
      fog: new THREE.Color(0x6f7b87),
      fogD: 0.013,
      sunI: 0.7,
      sunColor: new THREE.Color(0xc9d4de),
      ambI: 1.28,
      hemiI: 1.06,
    },
  };

  function blankPalette(): Palette {
    return {
      ambColor: new THREE.Color(),
      ambI: 1,
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      hemiI: 1,
      sunColor: new THREE.Color(),
      sunI: 1,
      fog: new THREE.Color(),
      fogD: 0.01,
      lantern: 1,
      altar: 1,
      halo: 1,
      skyTop: new THREE.Color(),
      skyBottom: new THREE.Color(),
      stars: 0,
      moon: 0,
      snow: 0,
    };
  }

  function writePalette(out: Palette, n: number, kind: WeatherKind) {
    const w = WEATHER_DAY[kind] ?? {};
    out.ambColor.lerpColors(w.ambColor ?? DAY.ambColor, NIGHT.ambColor, n);
    out.ambI = (w.ambI ?? DAY.ambI) + (NIGHT.ambI - (w.ambI ?? DAY.ambI)) * n;
    out.hemiSky.lerpColors(w.hemiSky ?? DAY.hemiSky, NIGHT.hemiSky, n);
    out.hemiGround.lerpColors(w.hemiGround ?? DAY.hemiGround, NIGHT.hemiGround, n);
    out.hemiI = (w.hemiI ?? DAY.hemiI) + (NIGHT.hemiI - (w.hemiI ?? DAY.hemiI)) * n;
    out.sunColor.lerpColors(w.sunColor ?? DAY.sunColor, NIGHT.sunColor, n);
    out.sunI = (w.sunI ?? DAY.sunI) + (NIGHT.sunI - (w.sunI ?? DAY.sunI)) * n;
    out.fog.lerpColors(w.fog ?? DAY.fog, NIGHT.fog, n);
    out.fogD = (w.fogD ?? DAY.fogD) + (NIGHT.fogD - (w.fogD ?? DAY.fogD)) * n;
    out.lantern = DAY.lantern + (NIGHT.lantern - DAY.lantern) * n;
    out.altar = DAY.altar + (NIGHT.altar - DAY.altar) * n;
    out.halo = DAY.halo + (NIGHT.halo - DAY.halo) * n;
    out.skyTop.lerpColors(w.skyTop ?? DAY.skyTop, NIGHT.skyTop, n);
    out.skyBottom.lerpColors(w.skyBottom ?? DAY.skyBottom, NIGHT.skyBottom, n);

    const starK =
      kind === 'clear' ? 1 : kind === 'partly' ? 0.55 : kind === 'cloudy' ? 0.12 : 0;
    const moonK =
      kind === 'clear' ? 1 : kind === 'partly' ? 0.7 : kind === 'cloudy' ? 0.3 : 0;
    out.stars = NIGHT.stars * n * starK;
    out.moon = n * moonK;
    out.snow = kind === 'snow' ? 1 : 0;
  }

  function lerpPalette(cur: Palette, tgt: Palette, k: number) {
    cur.ambColor.lerp(tgt.ambColor, k);
    cur.ambI += (tgt.ambI - cur.ambI) * k;
    cur.hemiSky.lerp(tgt.hemiSky, k);
    cur.hemiGround.lerp(tgt.hemiGround, k);
    cur.hemiI += (tgt.hemiI - cur.hemiI) * k;
    cur.sunColor.lerp(tgt.sunColor, k);
    cur.sunI += (tgt.sunI - cur.sunI) * k;
    cur.fog.lerp(tgt.fog, k);
    cur.fogD += (tgt.fogD - cur.fogD) * k;
    cur.lantern += (tgt.lantern - cur.lantern) * k;
    cur.altar += (tgt.altar - cur.altar) * k;
    cur.halo += (tgt.halo - cur.halo) * k;
    cur.skyTop.lerp(tgt.skyTop, k);
    cur.skyBottom.lerp(tgt.skyBottom, k);
    cur.stars += (tgt.stars - cur.stars) * k;
    cur.moon += (tgt.moon - cur.moon) * k;
    cur.snow += (tgt.snow - cur.snow) * k;
  }

  function applyPalette(p: Palette) {
    ambient.color.copy(p.ambColor);
    ambient.intensity = p.ambI;

    hemi.color.copy(p.hemiSky);
    hemi.groundColor.copy(p.hemiGround);
    hemi.intensity = p.hemiI;

    sun.color.copy(p.sunColor);
    sun.intensity = p.sunI;
    sun.position.lerpVectors(DAY.sunPos, NIGHT.sunPos, night);

    fog.color.copy(p.fog);
    fog.density = p.fogD;

    for (const l of lanterns) {
      l.userData.base = 15 * p.lantern * ((l.userData.baseFactor as number) ?? 1);
    }
    altarLight.intensity = 10 * p.altar;
    hallFill.intensity = 15 + 6 * night;

    haloMat.opacity = 0.4 * p.halo;
    for (const m of mandorlaMats) {
      m.opacity = ((m.userData.base as number) ?? 0.14) * p.halo;
    }
    (haloGlow.material as THREE.SpriteMaterial).opacity = 0.42 * p.halo;
    backGlow.intensity = 14 + 16 * night;

    skyUniforms.topColor.value.copy(p.skyTop);
    skyUniforms.bottomColor.value.copy(p.skyBottom);
    starMat.opacity = p.stars;
    (moonSprite.material as THREE.SpriteMaterial).opacity = 0.25 + p.moon * 0.75;
    (moonDisc.material as THREE.SpriteMaterial).opacity = 0.3 + p.moon * 0.7;

    for (const m of snowMats) m.opacity = p.snow * 0.96;
    snowGroup.visible = p.snow > 0.01;
  }

  const curPal = blankPalette();
  const tgtPal = blankPalette();
  let weather: WeatherKind = 'clear';

  function setWeather(kind: WeatherKind) {
    weather = kind;
  }

  writePalette(curPal, night, weather);
  applyPalette(curPal);

  // ————————————— 更新

  function update(dt: number, t: number) {
    night += (nightTarget - night) * Math.min(1, dt * 1.2);
    writePalette(tgtPal, night, weather);
    lerpPalette(curPal, tgtPal, Math.min(1, dt * 1.6));
    applyPalette(curPal);

    lanterns.forEach((l, i) => {
      const base = (l.userData.base as number) ?? 15;
      const f =
        0.86 +
        Math.sin(t * 7.3 + i * 2.1) * 0.05 +
        Math.sin(t * 17.9 + i * 5.3) * 0.035 +
        Math.sin(t * 31.1 + i) * 0.02;
      l.intensity = base * f;
    });

    // 烛火：亮度、大小、位置都轻微抖动
    for (const f of flames) {
      const w = Math.sin(t * 9.1 + f.seed) * 0.5 + Math.sin(t * 21.7 + f.seed * 2.3) * 0.3 + Math.sin(t * 37.3 + f.seed) * 0.2;
      const mat = f.spr.material as THREE.SpriteMaterial;
      mat.opacity = 0.5 + w * 0.14;
      const sc = 1.4 + w * 0.22;
      f.spr.scale.set(sc, sc, 1);
      f.core.scale.set(1 + w * 0.1, 1.9 + w * 0.35, 1 + w * 0.1);
      f.core.position.x = w * 0.008;
    }

    // 蒲团高亮
    for (const cu of cushions) {
      cu.flash *= Math.pow(0.02, dt);
      if (cu.flash < 0.002) cu.flash = 0;
      const k = Math.max(cu.flash, cu.hold * 0.62, cu.hover * 0.7);
      cu.shown += (k - cu.shown) * Math.min(1, dt * 14);

      const on = cu.shown > 0.01;
      cu.ring.visible = on;
      cu.glow.visible = on;
      if (on) {
        (cu.ring.material as THREE.MeshBasicMaterial).opacity = cu.shown * 0.95;
        (cu.glow.material as THREE.MeshBasicMaterial).opacity = cu.shown * 0.2;
        const sc = 1 + cu.flash * 0.26;
        cu.ring.scale.setScalar(sc);
        cu.glow.scale.setScalar(1 + cu.flash * 0.12);
      }
    }

    // 水面微光
    for (const m of waterMeshes) {
      m.roughness = 0.06 + Math.sin(t * 0.7) * 0.03 + Math.sin(t * 2.3) * 0.015;
      m.opacity = 0.9 + Math.sin(t * 0.9) * 0.04;
    }

    // 池鱼：绕浅椭圆慢慢游，偶尔摆一下尾
    for (const f of fishes) {
      const a = t * f.w + f.phase;
      const wob = 1 + Math.sin(a * 0.63 + 1.7) * 0.1;
      const x = pondX + Math.cos(a) * f.rx * wob;
      const z = pondZ + Math.sin(a) * f.rz * wob;
      const a2 = a + 0.05;
      const wob2 = 1 + Math.sin(a2 * 0.63 + 1.7) * 0.1;
      const dx = pondX + Math.cos(a2) * f.rx * wob2 - x;
      const dz = pondZ + Math.sin(a2) * f.rz * wob2 - z;

      f.g.position.set(x, f.y + Math.sin(t * 0.31 + f.phase) * f.bob, z);
      f.g.rotation.y = Math.atan2(dx, dz);
      f.g.rotation.z = Math.sin(t * 0.7 + f.phase) * 0.06;
      f.tail.rotation.y = Math.sin(t * 3.6 + f.phase * 3) * 0.45;
    }

    const now = performance.now();
    for (let i = sticks.length - 1; i >= 0; i--) {
      const s = sticks[i];
      const age = (now - s.born) / 1000;
      if (age > 120) {
        s.tip.parent?.remove(s.tip);
        s.spr.parent?.remove(s.spr);
        s.stick.parent?.remove(s.stick);
        sticks.splice(i, 1);
        continue;
      }
      const fade = age > 110 ? 1 - (age - 110) / 10 : 1;
      (s.tip.material as THREE.MeshBasicMaterial).color.setRGB(
        1 * fade,
        (0.5 + Math.sin(t * 9 + i) * 0.12) * fade,
        0.18 * fade,
      );
      (s.spr.material as THREE.SpriteMaterial).opacity = 0.6 * fade;
    }

    for (let i = 0; i < SMOKE_N; i++) {
      const d = smokeData[i];
      d.life += dt;
      const px = smokePos[i * 3];
      const py = smokePos[i * 3 + 1];
      const pz = smokePos[i * 3 + 2];

      if (d.life >= d.max || py > 5.4) {
        smokePos[i * 3] = BURNER_X + (Math.random() - 0.5) * 0.24;
        smokePos[i * 3 + 1] = 1.76;
        smokePos[i * 3 + 2] = BURNER_Z + (Math.random() - 0.5) * 0.24;
        d.life = 0;
        d.max = 6 + Math.random() * 4;
        d.vy = 0.32 + Math.random() * 0.4;
        d.vx = (Math.random() - 0.5) * 0.1;
        d.vz = (Math.random() - 0.5) * 0.1;
        continue;
      }

      smokePos[i * 3] = px + (d.vx + Math.sin(t * 0.6 + py * 1.4) * 0.09) * dt;
      smokePos[i * 3 + 1] = py + d.vy * dt;
      smokePos[i * 3 + 2] = pz + d.vz * dt;
    }
    smokeGeo.attributes.position.needsUpdate = true;
  }

  // ————————————— 地面高度

  function groundHeightAt(_x: number, z: number): number {
    if (z <= STEP_Z0) return 0;
    if (z >= YARD_Z) return YARD_Y;
    const t = (z - STEP_Z0) / (YARD_Z - STEP_Z0);
    return -0.3 * Math.round(t * 3);
  }

  return {
    group,
    groundMeshes: [hallFloor, yardGround],
    cushions,
    burner,
    woodfishStand,
    fortuneStand,
    buddhaPos: new THREE.Vector3(0, 0, altarZ),
    occluders,
    ceilY: CEIL,
    walkRects: [
      // 殿内主区：正立面两侧已经被墙裙占住，走不到那么靠边
      { x0: -HALL_HW + 0.9, x1: HALL_HW - 0.9, z0: -5.6, z1: 8.5 },
      // 中央门洞：只有中间这一条能穿到殿内
      { x0: -6.0, x1: 6.0, z0: 8.5, z1: STEP_Z0 },
      { x0: -HALL_HW + 0.9, x1: HALL_HW - 0.9, z0: STEP_Z0, z1: YARD_Z + 0.2 },
      { x0: -YARD_HW, x1: YARD_HW, z0: YARD_Z + 0.2, z1: YARD_END },
    ],
    obstacles,
    groundHeightAt,
    addIncense,
    update,
    setNight,
    setWeather,
    dispose() {
      floorTex.dispose();
      woodTex.dispose();
      wallTex.dispose();
      glowTex.dispose();
      smokeTex.dispose();
      grassTex.dispose();
      roofTex.dispose();
      caihuaTex.dispose();
      latticeTex.dispose();
      roundWinTex.dispose();
      pathTex.dispose();
      renderer.shadowMap.enabled = true;
    },
  };
}

