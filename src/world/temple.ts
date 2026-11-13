import * as THREE from 'three';
import {
  stoneFloorTexture,
  woodTexture,
  plasterTexture,
  glowTexture,
  smokeTexture,
  grassTexture,
  pathTexture,
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
  dispose(): void;
}

// ————————————— 尺寸（单位≈米）

const HALL_HW = 12;
const HALL_HD = 10;
const CEIL = 6.4;

const STEP_Z0 = 10.9; // 殿内地板到此为止
const YARD_Z = 12.7; // 庭院地面开始
const YARD_Y = -0.9; // 庭院比殿内低
const YARD_HW = 17.2;
const YARD_END = 33.2;
const WALL_Z = 34.2;
const WALL_X = 18;

const BURNER_X = -6.5;
const BURNER_Z = 0.9;

export function buildTemple(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Temple {
  const group = new THREE.Group();
  scene.add(group);

  const floorTex = stoneFloorTexture();
  const woodTex = woodTexture();
  const wallTex = plasterTexture();
  const glowTex = glowTexture();
  const smokeTex = smokeTexture();
  const grassTex = grassTexture();
  const pathTex = pathTexture();

  // ————————————— 材质

  const matStone = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: 0.9,
    metalness: 0.02,
    color: 0x97a3b0,
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
    map: wallTex,
    roughness: 0.95,
    color: 0xccd6e0,
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

  const obstacles: Obstacle[] = [];
  const occluders: THREE.Object3D[] = [];
  const waterMeshes: THREE.MeshStandardMaterial[] = [];

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
    matStoneSolid,
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
    color: 0x9aa6b3,
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
    const s = new THREE.Mesh(new THREE.BoxGeometry(20, h, 0.62), stepMats);
    s.position.set(0, -0.3 * (i + 1) - h / 2 + 0.02, 11.35 + i * 0.6);
    s.receiveShadow = true;
    s.castShadow = true;
    group.add(s);
  }

  // 台阶两侧的垂带石，把大平面切碎
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.05, 2.1), matStoneSolid);
    cheek.position.set(sx * 11.4, -0.42, 11.6);
    cheek.rotation.z = sx * 0.02;
    cheek.castShadow = true;
    cheek.receiveShadow = true;
    group.add(cheek);
  }

  // ————————————— 地面：庭院

  const yardGround = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 90),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, color: 0xd2dcc4 }),
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

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(HALL_HW * 2, 8, 0.7), matWall);
  backWall.position.set(0, 4, -HALL_HD);
  backWall.receiveShadow = true;
  group.add(backWall);
  occluders.push(backWall);

  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, HALL_HD * 2), matWall);
    side.position.set(sx * HALL_HW, 4, 0);
    side.receiveShadow = true;
    group.add(side);
    occluders.push(side);
  }

  // 屋顶（两坡）
  const roofDepth = HALL_HD + 2.4;
  for (const dir of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(HALL_HW * 2 + 4, 0.36, roofDepth), matTile);
    slab.position.set(0, 7.55, dir * roofDepth * 0.48);
    slab.rotation.x = dir * 0.19;
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    occluders.push(slab);
  }
  const ridgeBeam = new THREE.Mesh(new THREE.BoxGeometry(HALL_HW * 2 + 4.6, 0.34, 0.5), matTile);
  ridgeBeam.position.set(0, 8.72, 0);
  group.add(ridgeBeam);
  occluders.push(ridgeBeam);

  // 檐口
  for (const dir of [-1, 1]) {
    const eave = new THREE.Mesh(new THREE.BoxGeometry(HALL_HW * 2 + 4.6, 0.22, 1.1), matDarkWood);
    eave.position.set(0, 6.5, dir * (roofDepth * 0.82));
    group.add(eave);
    occluders.push(eave);
  }

  // 天花板
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL_HW * 2, HALL_HD * 2),
    new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.9 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = CEIL;
  group.add(ceiling);
  occluders.push(ceiling);

  for (let i = 0; i < 5; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(HALL_HW * 2, 0.32, 0.36), matDarkWood);
    beam.position.set(0, CEIL - 0.2, -HALL_HD + 2 + i * 4);
    group.add(beam);
  }

  // ————————————— 柱子

  const pillarPositions: Array<[number, number]> = [
    [-9.5, -8],
    [9.5, -8],
    [-9.5, -1],
    [9.5, -1],
    [-9.5, 5.5],
    [9.5, 5.5],
    [-4.2, -8],
    [4.2, -8],
  ];
  for (const [x, z] of pillarPositions) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.37, CEIL, 14), matWood);
    col.position.set(x, CEIL / 2, z);
    col.castShadow = true;
    col.receiveShadow = true;
    group.add(col);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.3, 16), matStoneSolid);
    base.position.set(x, 0.15, z);
    base.receiveShadow = true;
    group.add(base);

    obstacles.push({ x, z, r: 0.75 });
  }

  // ————————————— 佛坛

  const altarZ = -8.1;
  const steps: Array<[number, number, number]> = [
    [9.4, 0.34, 4.2],
    [8.0, 0.32, 3.4],
    [6.6, 0.32, 2.8],
  ];
  let ay = 0;
  steps.forEach(([w, h, d], i) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matStoneSolid);
    s.position.set(0, ay + h / 2, altarZ);
    s.castShadow = true;
    s.receiveShadow = true;
    group.add(s);
    ay += h;
    if (i === steps.length - 1) {
      const top = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 0.1, d - 0.4), matBronzeLit);
      top.position.set(0, ay + 0.05, altarZ);
      group.add(top);
    }
  });
  const altarTop = ay + 0.1;

  const lotus = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.35, 0.42, 24), matBronzeLit);
  lotus.position.set(0, altarTop + 0.21, altarZ);
  lotus.castShadow = true;
  group.add(lotus);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), matBronzeLit);
    petal.scale.set(1, 0.42, 1.5);
    petal.position.set(Math.cos(a) * 2.0, altarTop + 0.34, altarZ + Math.sin(a) * 2.0);
    petal.rotation.y = -a;
    group.add(petal);
  }

  const bronzeDark = new THREE.MeshStandardMaterial({
    color: 0x6b5942,
    roughness: 0.52,
    metalness: 0.62,
  });

  const legs = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), bronzeDark);
  legs.scale.set(1.92, 0.62, 1.35);
  legs.position.set(0, altarTop + 0.62, altarZ);
  legs.castShadow = true;
  group.add(legs);

  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.72, 0.42, 26), bronzeDark);
  skirt.position.set(0, altarTop + 0.9, altarZ);
  skirt.castShadow = true;
  group.add(skirt);

  const torsoProfile: THREE.Vector2[] = [
    new THREE.Vector2(1.16, 0),
    new THREE.Vector2(1.1, 0.25),
    new THREE.Vector2(0.96, 0.55),
    new THREE.Vector2(0.82, 0.85),
    new THREE.Vector2(0.76, 1.12),
    new THREE.Vector2(0.78, 1.35),
    new THREE.Vector2(0.7, 1.5),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 26), bronzeDark);
  body.position.set(0, altarTop + 1.0, altarZ);
  body.castShadow = true;
  group.add(body);

  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.82, 20, 14), bronzeDark);
  shoulders.scale.set(1.5, 0.5, 0.86);
  shoulders.position.set(0, altarTop + 2.38, altarZ);
  shoulders.castShadow = true;
  group.add(shoulders);

  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 1.0, 4, 10), bronzeDark);
    arm.position.set(sx * 1.0, altarTop + 1.72, altarZ + 0.08);
    arm.rotation.z = sx * 0.1;
    arm.rotation.x = 0.16;
    arm.castShadow = true;
    group.add(arm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 10), bronzeDark);
    hand.scale.set(1.35, 0.6, 1);
    hand.position.set(sx * 0.42, altarTop + 0.98, altarZ + 0.66);
    hand.castShadow = true;
    group.add(hand);
  }

  const drape = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.26, 10, 24, Math.PI), bronzeDark);
  drape.rotation.set(-Math.PI / 2, 0, 0);
  drape.position.set(0, altarTop + 0.96, altarZ + 0.3);
  drape.castShadow = true;
  group.add(drape);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.26, 14), bronzeDark);
  neck.position.set(0, altarTop + 2.6, altarZ);
  group.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 22, 18), bronzeDark);
  head.scale.set(0.92, 1.06, 0.94);
  head.position.set(0, altarTop + 3.0, altarZ);
  head.castShadow = true;
  group.add(head);

  const ushnisha = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), bronzeDark);
  ushnisha.scale.set(1, 0.85, 1);
  ushnisha.position.set(0, altarTop + 3.38, altarZ);
  group.add(ushnisha);

  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), bronzeDark);
    ear.scale.set(0.55, 1.5, 0.7);
    ear.position.set(sx * 0.38, altarTop + 2.98, altarZ);
    group.add(ear);
  }

  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffcf8a,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  });
  const halo = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.1, 56), haloMat);
  halo.position.set(0, altarTop + 2.5, altarZ - 1.0);
  group.add(halo);

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
  haloGlow.scale.set(7.2, 7.2, 1);
  haloGlow.position.set(0, altarTop + 2.4, altarZ - 1.3);
  group.add(haloGlow);

  const backGlow = new THREE.SpotLight(0xffb070, 26, 16, Math.PI * 0.34, 0.7, 1.6);
  backGlow.position.set(0, altarTop + 3.4, altarZ + 0.4);
  backGlow.target.position.set(0, altarTop + 2.0, altarZ - 2.2);
  group.add(backGlow, backGlow.target);

  // ————————————— 殿内灯笼

  const lanterns: THREE.PointLight[] = [];
  for (const sx of [-1, 1]) {
    const lg = new THREE.Group();
    lg.position.set(sx * 4.6, CEIL - 0.7, altarZ + 1.4);

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

    const pl = new THREE.PointLight(0xffa858, 14, 20, 1.8);
    pl.position.y = -1.65;
    pl.userData.baseFactor = 1.15;
    lg.add(pl);
    lanterns.push(pl);

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
  candleStand(-8.3, 0.6, 2.5, true);
  candleStand(8.3, 0.6, 2.5, true);
  // 佛前两支烛（只有火苗，不加真实光源，省着色器开销）
  candleStand(-3.9, -5.4, 1.6, false);
  candleStand(3.9, -5.4, 1.6, false);
  // 门口两支：同样只给火苗，让前景不至于一片黑
  candleStand(-7.6, 7.4, 1.7, false);
  candleStand(7.6, 7.4, 1.7, false);

  // ————————————— 坐垫

  const cushions: Cushion[] = [];
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0x6d4a34, roughness: 0.95 });
  const cushionTopMat = new THREE.MeshStandardMaterial({ color: 0x7d5940, roughness: 0.95 });

  const rows = [
    { z: -3.2, xs: [-4.6, 0, 4.6] },
    { z: -0.2, xs: [-4.6, 0, 4.6] },
    { z: 2.8, xs: [-4.6, 0, 4.6] },
    { z: 5.8, xs: [-4.6, 0, 4.6] },
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

  // ————————————— 钟

  {
    const bellG = new THREE.Group();
    bellG.position.set(9.4, 0, -3.2);
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
    obstacles.push({ x: 9.4, z: -3.2, r: 0.9 });
  }

  // ═══════════════════════════ 庭院 ═══════════════════════════

  // 围墙
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.0, WALL_Z - YARD_Z + 1), matWall);
    w.position.set(sx * WALL_X, YARD_Y + 1.5, (WALL_Z + YARD_Z) / 2);
    w.receiveShadow = true;
    w.castShadow = true;
    group.add(w);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.16, WALL_Z - YARD_Z + 1), matTile);
    cap.position.set(sx * WALL_X, YARD_Y + 3.06, (WALL_Z + YARD_Z) / 2);
    group.add(cap);
  }

  // 从殿前两侧接出来的翼墙
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_X - HALL_HW - 0.4, 2.8, 0.6),
      matWall,
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
      matWall,
    );
    gate.position.set(0, YARD_Y, WALL_Z);
    gate.castShadow = true;
    gate.receiveShadow = true;
    group.add(gate);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(WALL_X * 2, 0.18, 1.0), matTile);
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
    for (const [r, dx, dz, h] of specs) {
      const geo = new THREE.DodecahedronGeometry(r * scale, 0);
      const m = new THREE.Mesh(geo, matRock);
      m.position.set(dx * scale, h * scale * 0.62, dz * scale);
      m.scale.set(1, h, 1);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    group.add(g);
    obstacles.push({ x: cx, z: cz, r: 2.1 * scale });
  }

  rockery(-8.6, 19.5, 1.25, 0.4);
  rockery(11.2, 26.5, 1.5, 1.1);
  rockery(-12.5, 30.5, 0.9, 2.2);

  // 水池
  const pondX = 8.8;
  const pondZ = 16.4;
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
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.2;
      const rr = 3.5 + Math.random() * 0.5;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.34, 0),
        matRock,
      );
      rock.position.set(
        pondX + Math.cos(a) * rr,
        YARD_Y + 0.1 + Math.random() * 0.14,
        pondZ + Math.sin(a) * rr * 0.76,
      );
      rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      rock.castShadow = true;
      group.add(rock);
    }

    obstacles.push({ x: pondX, z: pondZ, r: 3.9 });
  }

  // 松树
  function pine(cx: number, cz: number, s: number) {
    const g = new THREE.Group();
    g.position.set(cx, YARD_Y, cz);
    g.scale.setScalar(s);

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.26, 2.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 }),
    );
    trunk.position.y = 1.2;
    trunk.castShadow = true;
    g.add(trunk);

    const layers = 5;
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const r = 1.9 * (1 - t * 0.72);
      const y = 1.7 + i * 0.78;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(r, 1.35, 7, 1, true),
        i % 2 === 0 ? matLeaf : matLeafDark,
      );
      cone.position.y = y;
      cone.rotation.y = i * 0.5;
      cone.castShadow = true;
      g.add(cone);
    }

    group.add(g);
    obstacles.push({ x: cx, z: cz, r: 1.0 * s });
  }

  pine(-14.2, 14.8, 1.1);
  pine(-11.6, 25.5, 1.35);
  pine(13.8, 21.5, 1.0);
  pine(15.0, 30.0, 1.25);
  pine(-4.6, 31.5, 0.9);
  pine(-6.5, 40.5, 1.15);
  pine(7.2, 41.5, 1.0);

  // 灌木
  for (const [bx, bz, br] of [
    [-3.6, 13.6, 0.8],
    [3.8, 13.4, 0.72],
    [-15.2, 20.0, 1.0],
    [6.2, 29.5, 0.9],
    [-8.0, 15.2, 0.62],
    [12.4, 33.0, 0.86],
  ]) {
    const bush = new THREE.Mesh(new THREE.SphereGeometry(br, 10, 8), matLeaf);
    bush.scale.set(1.25, 0.72, 1.15);
    bush.position.set(bx, YARD_Y + br * 0.5, bz);
    bush.castShadow = true;
    group.add(bush);
  }

  // 石灯笼
  const yardLights: THREE.PointLight[] = [];
  function stoneLantern(cx: number, cz: number, withLight: boolean) {
    const g = new THREE.Group();
    g.position.set(cx, YARD_Y, cz);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.2, 8), matStoneSolid);
    base.position.y = 0.1;
    base.castShadow = true;
    g.add(base);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.78, 8), matStoneSolid);
    shaft.position.y = 0.58;
    shaft.castShadow = true;
    g.add(shaft);

    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.12, 8), matStoneSolid);
    plate.position.y = 1.02;
    g.add(plate);

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

    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.26, 8), matStoneSolid);
    roof.position.y = 1.5;
    roof.castShadow = true;
    g.add(roof);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), matStoneSolid);
    tip.position.y = 1.66;
    g.add(tip);

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
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 32;
  sun.shadow.camera.bottom = -16;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  const hallFill = new THREE.PointLight(0xa8c4e0, 8, 40, 1.4);
  hallFill.position.set(0, CEIL - 1.1, 3.5);
  scene.add(hallFill);

  const altarLight = new THREE.PointLight(0xffb070, 9, 16, 2);
  altarLight.position.set(0, altarTop + 2.4, altarZ + 2.2);
  scene.add(altarLight);

  const fog = new THREE.FogExp2(0x93a6b8, 0.0085);
  scene.fog = fog;

  // ————————————— 昼夜

  let nightTarget = 1;
  let night = 1;

  function setNight(v: boolean) {
    nightTarget = v ? 1 : 0;
  }

  const DAY = {
    ambColor: new THREE.Color(0x93aac4),
    ambI: 1.35,
    hemiSky: new THREE.Color(0xb8cde4),
    hemiGround: new THREE.Color(0x4a4438),
    hemiI: 1.15,
    sunColor: new THREE.Color(0xffe8c8),
    sunI: 2.25,
    sunPos: new THREE.Vector3(18, 26, 24),
    fog: new THREE.Color(0x93a6b8),
    fogD: 0.0085,
    lantern: 0.32,
    altar: 0.5,
    halo: 0.55,
    skyTop: new THREE.Color(0x5f88bd),
    skyBottom: new THREE.Color(0xd6e2ea),
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

  const tmp = new THREE.Color();

  function applyLighting(n: number) {
    ambient.color.lerpColors(DAY.ambColor, NIGHT.ambColor, n);
    ambient.intensity = DAY.ambI + (NIGHT.ambI - DAY.ambI) * n;

    hemi.color.lerpColors(DAY.hemiSky, NIGHT.hemiSky, n);
    hemi.groundColor.lerpColors(DAY.hemiGround, NIGHT.hemiGround, n);
    hemi.intensity = DAY.hemiI + (NIGHT.hemiI - DAY.hemiI) * n;

    sun.color.lerpColors(DAY.sunColor, NIGHT.sunColor, n);
    sun.intensity = DAY.sunI + (NIGHT.sunI - DAY.sunI) * n;
    sun.position.lerpVectors(DAY.sunPos, NIGHT.sunPos, n);

    tmp.lerpColors(DAY.fog, NIGHT.fog, n);
    fog.color.copy(tmp);
    fog.density = DAY.fogD + (NIGHT.fogD - DAY.fogD) * n;

    const lan = DAY.lantern + (NIGHT.lantern - DAY.lantern) * n;
    for (const l of lanterns) {
      l.userData.base = 15 * lan * ((l.userData.baseFactor as number) ?? 1);
    }
    altarLight.intensity = 10 * (DAY.altar + (NIGHT.altar - DAY.altar) * n);
    hallFill.intensity = 9 + 5 * n;

    const haloK = DAY.halo + (NIGHT.halo - DAY.halo) * n;
    haloMat.opacity = 0.4 * haloK;
    (haloGlow.material as THREE.SpriteMaterial).opacity = 0.42 * haloK;
    backGlow.intensity = 14 + 16 * n;

    skyUniforms.topColor.value.lerpColors(DAY.skyTop, NIGHT.skyTop, n);
    skyUniforms.bottomColor.value.lerpColors(DAY.skyBottom, NIGHT.skyBottom, n);
    starMat.opacity = DAY.stars + (NIGHT.stars - DAY.stars) * n;
    (moonSprite.material as THREE.SpriteMaterial).opacity = 0.25 + n * 0.75;
    (moonDisc.material as THREE.SpriteMaterial).opacity = 0.3 + n * 0.7;
  }

  applyLighting(night);

  // ————————————— 更新

  function update(dt: number, t: number) {
    if (Math.abs(night - nightTarget) > 0.001) {
      night += (nightTarget - night) * Math.min(1, dt * 1.2);
      applyLighting(night);
    }

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
    occluders,
    ceilY: CEIL,
    walkRects: [
      { x0: -HALL_HW + 0.9, x1: HALL_HW - 0.9, z0: -5.6, z1: STEP_Z0 },
      { x0: -HALL_HW + 0.9, x1: HALL_HW - 0.9, z0: STEP_Z0, z1: YARD_Z + 0.2 },
      { x0: -YARD_HW, x1: YARD_HW, z0: YARD_Z + 0.2, z1: YARD_END },
    ],
    obstacles,
    groundHeightAt,
    addIncense,
    update,
    setNight,
    dispose() {
      floorTex.dispose();
      woodTex.dispose();
      wallTex.dispose();
      glowTex.dispose();
      smokeTex.dispose();
      grassTex.dispose();
      pathTex.dispose();
      renderer.shadowMap.enabled = true;
    },
  };
}

