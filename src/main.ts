import './style.css';
import * as THREE from 'three';

import { buildTemple, type Temple, type Cushion } from './world/temple';
import { Monk, type Pose } from './world/monk';
import { Novice } from './world/novice';
import { Controls } from './game/controls';
import { AudioHost, isIOSLike } from './audio/engine';
import { Sounds, Wind, Chant } from './audio/sounds';
import { Music } from './audio/music';
import { BeadsUI } from './ui/beads';
import { WeatherVfx } from './world/weather';
import { fetchWeather, WEATHER_ZH, type WeatherKind } from './core/weather';
import { NetClient, type NetEventKind, type RemoteInfo } from './net/client';
import { RemotePlayer } from './net/remote';
import * as store from './core/save';
import {
  CHANGELOG,
  latestNoticeId,
  unseenEntries,
  type ChangelogEntry,
} from './core/changelog';
import { drawFortune, type FortuneAlmanac, type FortuneLot } from './core/fortune';
import { todayKey } from './core/device';
import { randomDharmaName } from './core/name';

// ————————————————————————————— DOM

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('scene');
const loadingEl = $('loading');
const loadBar = $('load-bar');
const loadTip = $('load-tip');
const welcomeEl = $('welcome');
const btnStart = $<HTMLButtonElement>('btn-start');

const topbar = $('topbar');
const meter = $('meter');
const actionsBar = $('actions');
const stick = $('stick');
const daynightEl = $('daynight');
const meritEl = $('merit');
const beadsCountEl = $('beads-count');
const onlineEl = $('online');
const nameInput = $<HTMLInputElement>('name-input');
const btnDice = $<HTMLButtonElement>('btn-dice');

const btnSound = $<HTMLButtonElement>('btn-sound');
const btnService = $<HTMLButtonElement>('btn-service');
const btnSettings = $<HTMLButtonElement>('btn-settings');
const settingsEl = $('settings');
const audioStateEl = $('audio-state');
const musicNowEl = $('music-now');
const musicOnEl = $<HTMLInputElement>('music-on');
const btnFortune = $<HTMLButtonElement>('btn-fortune');
const fortuneEl = $('fortune');
const fortuneAlmanacEl = $('fortune-almanac');
const fortuneLoadingEl = $('fortune-loading');
const fortuneSlipEl = $('fortune-slip');
const fortuneNoteEl = $('fortune-note');
const fortuneOk = $<HTMLButtonElement>('fortune-ok');
const fortuneNoEl = $('fortune-no');
const fortuneGradeEl = $('fortune-grade');
const fortuneTitleEl = $('fortune-lottitle');
const fortuneVerseEl = $('fortune-verse');
const fortuneReadEl = $('fortune-read');
const fortuneTodayEl = $('fortune-today');

const noticeEl = $('notice');
const noticeBody = $('notice-body');
const noticeTitle = $('notice-title');
const noticeKicker = $('notice-kicker');
const noticeOk = $<HTMLButtonElement>('notice-ok');

const btnFeedback = $<HTMLButtonElement>('btn-feedback');
const feedbackCard = $('feedback-card');
const btnCopyMail = $<HTMLButtonElement>('btn-copy-mail');

const fishPanel = $('fish-panel');
const fishIcon = fishPanel.querySelector('.fish-icon') as HTMLElement;
const fishFill = $('fish-fill');
const fishCountEl = $('fish-count');
const btnFishClose = $<HTMLButtonElement>('fish-close');

const beadPanel = $('bead-panel');
const beadCanvas = $<HTMLCanvasElement>('bead-canvas');
const btnBeadClose = $<HTMLButtonElement>('bead-close');
const btnBeadAuto = $<HTMLButtonElement>('bead-auto');

const floaters = $('floaters');
const toastEl = $('toast');

const UP = new THREE.Vector3(0, 1, 0);
/** 殿内宽度的一半（与 temple.ts 的 HALL_HW 对应），用来判断"是否在殿内" */
const HALL_HALF_W = 12;
/** 殿外的相机高度上限：取一个够大的数，好让殿内外的切换能插值过渡 */
const CAMY_FREE = 40;
let camYLimit: number | null = null;

// ————————————————————————————— 渲染器

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b11);

// ————————————————————————————— 存档

let { save, state: storageState } = store.load();

let merit = save.merit;

// ————————————————————————————— 相机 / 控制

let temple: Temple;
let weatherVfx: WeatherVfx;
let monk: Monk;
let novice: Novice;

const controls = new Controls(
  canvas,
  {
    onTap: (x, y) => onTap(x, y),
    onDrag: () => hideHint(),
    onHover: (x, y) => onHover(x, y),
  },
  stick,
);
const camera = controls.camera;

// ————————————————————————————— 音频（延迟到最后一步创建，但先留声明）

let host: AudioHost;
let sounds: Sounds;
let wind: Wind;
let chant: Chant;
let music: Music;
let audioOn = false;
let beadsUI: BeadsUI;

const log = (m: string) => console.info('[audio]', m);

// ————————————————————————————— 状态

let sitting: Cushion | null = null;
let moveTarget: THREE.Vector3 | null = null;
let pendingSeat: Cushion | null = null;
let pendingIncense = false;
let pendingFortune = false;

let bowing = false;
let tempPose: { pose: Pose; until: number } | null = null;
let movedThisFrame = false;
let lastPose: Pose | null = null;

let beadOpen = false;
let lastKnock = 0;
let malletHitAt = 0;

/** 自动木鱼：开着就按节拍自己敲 */
let fishAuto = false;
/** 下一拍的时刻 */
let fishNext = 0;
/** 本次连敲了多少下 */
let fishSession = 0;

// ————————————————————————————— 同修（联机）

let net: NetClient | null = null;
/** 别人：id -> RemotePlayer */
const remotes = new Map<string, RemotePlayer>();
/** 别人占着的蒲团：seatIndex -> id */
const remoteSeats = new Map<number, string>();
/** 本机占着的蒲团 */
let mySeat: number | null = null;
/** 服务器时间与本机的差，让昼夜在所有人眼里一致 */
let linkToastShown = false;

/** 蒲团高亮的拾取目标，build 时填好 */
let cushionGroups: THREE.Object3D[] = [];
/** 当前高亮着的那张（正在走过去 / 已坐） */
let activeCushion: Cushion | null = null;
let hoverCushion: Cushion | null = null;

// 手持木鱼
const handFish = new THREE.Group();
let handMallet!: THREE.Mesh;

// ————————————————————————————— 工具

function toast(text: string) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  window.clearTimeout((toast as any)._t);
  (toast as any)._t = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function floater(world: THREE.Vector3, text: string, quote = false) {
  const v = world.clone().project(camera);
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  if (x < -80 || x > window.innerWidth + 80) return;

  const el = document.createElement('div');
  el.className = quote ? 'floater quote' : 'floater';
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  floaters.appendChild(el);
  // 真言要看得完：逗留得比“功德 +1”久一点
  window.setTimeout(() => el.remove(), quote ? 3800 : 1300);
}

function pickCushionAt(clientX: number, clientY: number): Cushion | null {
  if (!cushionGroups.length) return null;
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(cushionGroups, true)[0];
  if (!hit) return null;

  let o: THREE.Object3D | null = hit.object;
  while (o && o.userData.cushionIndex === undefined) o = o.parent;
  if (o) return temple.cushions[o.userData.cushionIndex as number] ?? null;

  let best: Cushion | null = null;
  let bd = Infinity;
  for (const c of temple.cushions) {
    const d = c.seat.distanceToSquared(hit.point);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** 悬停：桌面端鼠标经过蒲团 / 小沙弥时给一点提示 */
function onHover(clientX: number, clientY: number) {
  const c = sitting || moveTarget ? null : pickCushionAt(clientX, clientY);
  if (c !== hoverCushion) {
    if (hoverCushion) hoverCushion.hover = 0;
    hoverCushion = c;
    if (c) c.hover = 1;
  }
  const overNovice = !!novice && raycaster.intersectObject(novice.root, true).length > 0;
  canvas.style.cursor = c || overNovice ? 'pointer' : '';
}

function setActiveCushion(c: Cushion | null) {
  if (activeCushion === c) return;
  if (activeCushion) activeCushion.hold = 0;
  activeCushion = c;
  if (c) c.hold = 1;
}

function hideHint() {
  // 拖动镜头时把 toast 收掉，避免挡视线
  toastEl.classList.remove('show');
}

function inWalk(x: number, z: number): boolean {
  for (const r of temple.walkRects) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
  }
  return false;
}

/** 把点收到最近的可行走矩形里（用于"走到某处"的目标点） */
function clampToWalk(p: THREE.Vector3): THREE.Vector3 {
  if (inWalk(p.x, p.z)) return p;
  let bx = p.x;
  let bz = p.z;
  let bd = Infinity;
  for (const r of temple.walkRects) {
    const cx = Math.min(Math.max(p.x, r.x0), r.x1);
    const cz = Math.min(Math.max(p.z, r.z0), r.z1);
    const d = (cx - p.x) ** 2 + (cz - p.z) ** 2;
    if (d < bd) {
      bd = d;
      bx = cx;
      bz = cz;
    }
  }
  p.x = bx;
  p.z = bz;
  return p;
}

/**
 * 移动解算：先按"墙"做轴分离滑动（贴墙走不会卡住），再按圆形障碍推开。
 * 返回是否真的移动了。
 */
function resolveMove(px: number, pz: number, nx: number, nz: number): [number, number] {
  let x = nx;
  let z = nz;

  if (!inWalk(x, z)) {
    if (inWalk(x, pz)) z = pz;
    else if (inWalk(px, z)) x = px;
    else {
      x = px;
      z = pz;
    }
  }

  for (const o of temple.obstacles) {
    const dx = x - o.x;
    const dz = z - o.z;
    const d = Math.hypot(dx, dz);
    if (d < o.r && d > 1e-4) {
      const tx = o.x + (dx / d) * o.r;
      const tz = o.z + (dz / d) * o.r;
      if (inWalk(tx, tz)) {
        x = tx;
        z = tz;
      } else {
        x = px;
        z = pz;
      }
    }
  }

  return [x, z];
}

// ————————————————————————————— 启动

async function boot() {
  loadBar.style.width = '18%';
  loadTip.textContent = '正在打扫庭院…';
  await tick();

  temple = buildTemple(scene, renderer);
  // 给坐垫的所有子网格打上索引，射线拾取时才能向上找到是哪一张
  temple.cushions.forEach((c, i) => {
    c.mesh.parent?.traverse((o) => {
      o.userData.cushionIndex = i;
    });
  });
  cushionGroups = temple.cushions.map((c) => c.mesh.parent!).filter(Boolean);
  weatherVfx = new WeatherVfx(scene, (x, z) => temple.groundHeightAt(x, z));
  loadBar.style.width = '52%';
  loadTip.textContent = '正在点亮佛前的灯…';
  await tick();

  monk = new Monk();
  // 初始站在庭院里、正对佛堂（佛堂在 -z 方向）
  const startZ = 20.5;
  monk.root.position.set(0, temple.groundHeightAt(0, startZ), startZ);
  monk.setFacing(Math.PI);
  scene.add(monk.root);

  // 佛前的小沙弥：坐在佛坛前的蒲团上，偶尔念一句真言
  novice = new Novice(onNoviceSpeak);
  novice.placeAt(4.8, -5.25, 0);
  scene.add(novice.root);
  // 别让玩家从他身上穿过去
  temple.obstacles.push({ x: 4.8, z: -5.25, r: 0.8 });

  // 镜头也跟着一开始就对好，避免开场时"从佛堂外面一路飘过来"
  controls.focus.copy(monk.root.position).add(new THREE.Vector3(0, 1.02, 0));

  buildHandWoodfish();

  loadBar.style.width = '76%';
  loadTip.textContent = '正在备好木鱼与念珠…';
  await tick();

  beadsUI = new BeadsUI(beadCanvas, {
    onTick: () => {
      sounds.bead();
      save.beads = beadsUI.count;
      beadsCountEl.textContent = String(save.beads);
      net?.event('bead');
    },
    onRound: () => {
      sounds.bell(196, 1);
      toast('一圈圆满 · 108');
      net?.event('round');
    },
  });
  beadsUI.setTotal(save.beads);

  host = new AudioHost(log);
  sounds = new Sounds(host);
  wind = new Wind(host);
  chant = new Chant(host);
  music = new Music({ log, onChange: () => reflectMusic() });

  loadBar.style.width = '92%';
  loadTip.textContent = '正在点一炷香…';
  await tick();

  // 先定好尺寸与相机参数，再预编译着色器，避免第一次入画卡顿
  onResize();
  renderer.compile(scene, camera);

  loadBar.style.width = '100%';
  await tick(260);

  loadingEl.classList.remove('show');
  welcomeEl.classList.add('show');

  meritEl.textContent = String(merit);
  beadsCountEl.textContent = String(save.beads);
  updateDayNight();
  void refreshWeather(true);

  // 相机碰撞要用到的遮挡物
  controls.occluders = temple.occluders;

  applySavedAudioState();
  $('build-tag').textContent = `构建 ${__BUILD__}`;
  refreshFortuneButton();
  // 称呼：首次来给一个法号（骰子可换）；以前存过的直接用自己的
  nameInput.value = save.name || (save.nameTouched ? '' : randomDharmaName());
  bindUI();
  onResize();
  window.addEventListener('resize', onResize);
  window.setInterval(() => void refreshWeather(), 10 * 60_000);

  requestAnimationFrame(frame);

  // 公告等首屏落稳再弹，别和开门动画抢
  window.setTimeout(showUpdateNotice, 420);
}

const tick = (ms = 40) => new Promise((r) => window.setTimeout(r, ms));

function buildHandWoodfish() {
  const fish = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0x6f4320, roughness: 0.62 }),
  );
  fish.scale.set(1, 0.7, 0.86);
  fish.castShadow = true;
  handFish.add(fish);

  const slit = new THREE.Mesh(
    new THREE.TorusGeometry(0.08, 0.014, 5, 12, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x120804, roughness: 0.9 }),
  );
  slit.rotation.x = -Math.PI / 2;
  slit.position.y = 0.055;
  handFish.add(slit);

  handMallet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.24, 6),
    new THREE.MeshStandardMaterial({ color: 0xa8875e, roughness: 0.7 }),
  );
  handMallet.position.set(0.11, 0.13, 0.03);
  handMallet.rotation.z = -0.75;
  handFish.add(handMallet);

  // 稍微偏右偏前，从背后也能看到一点，不至于敲了没反应
  handFish.position.set(0.2, 0.5, 0.38);
  handFish.visible = false;
  monk.root.add(handFish);
}

// ————————————————————————————— 音频状态

function applySavedAudioState() {
  host.setVolume('amb', save.vol.amb);
  host.setVolume('chant', save.vol.chant);
  host.setVolume('sfx', save.vol.sfx);
  // 让 AudioHost 也记住静音：重建上下文 / 切后台回来都不会把静音丢掉
  host.setAllMuted(save.muted);

  // 佛乐只是先把偏好灌进去：首屏还没开门，不在这里 play()
  music.configure({ on: save.music, muted: save.muted, volume: save.vol.music });

  (($('vol-amb') as HTMLInputElement).value = String(Math.round(save.vol.amb * 100)));
  (($('vol-chant') as HTMLInputElement).value = String(Math.round(save.vol.chant * 100)));
  (($('vol-music') as HTMLInputElement).value = String(Math.round(save.vol.music * 100)));
  (($('vol-sfx') as HTMLInputElement).value = String(Math.round(save.vol.sfx * 100)));

  reflectMusic();
  syncSoundButton();

  const note = $('storage-note');
  note.textContent = storageState.ok
    ? '累计数只保存在这台设备的浏览器里，换设备或清站点数据后无法恢复。'
    : `当前无法写入本地存储（${storageState.reason ?? '未知原因'}），本次进度仅暂存。`;
}

async function enableAudio() {
  const ok = await host.unlock();
  if (!ok) {
    toast('这台设备暂时无法开启声音');
    return false;
  }
  audioOn = true;
  wind.start();
  chant.start();
  music.start();
  host.setAllMuted(save.muted);
  if (audioStateEl) audioStateEl.textContent = describeAudio();
  return true;
}

/** 设置面板里的佛乐一行：勾选状态 + 当前曲目 */
function reflectMusic() {
  if (!music) return;
  if (musicOnEl) musicOnEl.checked = music.enabled;
  if (!musicNowEl) return;
  const t = music.track;
  if (!music.enabled) musicNowEl.textContent = `佛乐已关 · 上一首：${t.title}`;
  else if (music.playing) musicNowEl.textContent = `正在播放：${t.title} · ${t.who}`;
  else musicNowEl.textContent = `已暂停：${t.title} · ${t.who}`;
}

/**
 * 用户动了任何一个声音开关，就默认他/她想听：
 * 首次访问是静音存档，不顺手打开的话会以为“点了没反应”。
 */
async function wakeSound(): Promise<boolean> {
  if (!audioOn) {
    const ok = await enableAudio();
    if (!ok) return false;
  }
  if (save.muted && (await reviveAudio())) {
    save.muted = false;
    host.setAllMuted(false);
    music.setMuted(false);
    store.persist(save);
    syncSoundButton();
  }
  return true;
}

function syncSoundButton() {
  // 用动词而不是状态词：手机上最怕"看着是开着的、其实静音"
  btnSound.textContent = save.muted ? '开启声音' : '关闭声音';
  btnSound.classList.toggle('on', !save.muted);
  if (audioStateEl) audioStateEl.textContent = describeAudio();
}

const FEEDBACK_MAIL = 'wzn123w2@126.com';

/** 复制邮箱：优先用剪贴板 API，http 页面拿不到权限就退到 execCommand */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 退到下面 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * 小沙弥“开口”：字浮在他头顶，近处再补一声轻磬。
 * 音量随距离衰减，和同修的木鱼声一个口径；远了就只剩影子。
 */
function onNoviceSpeak(text: string, at: THREE.Vector3) {
  floater(at, text, true);
  if (!sounds || !audioOn || save.muted) return;
  const d = at.distanceTo(monk.root.position);
  const vol = Math.max(0, 1 - d / 18) ** 1.5;
  if (vol < 0.06) return;
  sounds.bell(392, 0.55 * vol);
}

/**
 * 梵呗随距离变化：离佛越近越响，到佛前封顶（内部 0.9，不会顶耳朵）。
 * 5m 以内算“到了佛前”，30m 以外只剩一层底。
 */
function updateChantProximity() {
  if (!chant || !temple || !monk) return;
  const b = temple.buddhaPos;
  const p = monk.root.position;
  const d = Math.hypot(p.x - b.x, p.z - b.z);
  let t = 1 - (d - 5) / (30 - 5);
  t = Math.max(0, Math.min(1, t));
  // smoothstep：远处变化慢、近处更明显，走近时不会一顿一顿地涨
  chant.setProximity(t * t * (3 - 2 * t));
  // 佛乐在放时，合成的梵呗整条让位：两套调子一起走会打架
  chant.setDuck(music && music.playing ? 0 : 1);
}

/**
 * 手机上切后台 / 锁屏 / 来电之后，AudioContext 会停在 suspended 或 interrupted，
 * 从此整页都不出声。凡是"该有声"的时刻都走这里：先叫醒上下文，再重启两条长音。
 */
async function reviveAudio(): Promise<boolean> {
  await host.ensureAlive();
  if (host.ctx.state !== 'running') return false;
  audioOn = true;
  wind.start();
  chant.start();
  music.resume();
  host.setAllMuted(save.muted);
  if (audioStateEl) audioStateEl.textContent = describeAudio();
  return true;
}

const AUDIO_STATE_ZH: Record<string, string> = {
  running: '运行中',
  suspended: '已挂起',
  interrupted: '被系统打断',
  closed: '已关闭',
};

/** 设置面板里那行"音频状态"，不用开控制台就能看出卡在哪儿 */
function describeAudio(): string {
  if (!host) return '音频状态：未初始化';
  const st = host.ctx.state as string;
  const bits = [AUDIO_STATE_ZH[st] ?? st, save.muted || host.muted ? '静音中' : '有声'];
  if (isIOSLike()) bits.push(host.sessionArmed ? '媒体通道已挂上' : '媒体通道未挂上');
  return `音频状态：${bits.join(' · ')}`;
}

/** 量一下主输出 1 秒内的峰值，用来区分"没信号"和"有信号但听不见" */
async function measureMasterPeak(ms: number): Promise<string> {
  const ctx = host.ctx;
  const a = ctx.createAnalyser();
  a.fftSize = 2048;
  host.master.connect(a);
  const buf = new Float32Array(a.fftSize);
  let peak = 0;
  const end = performance.now() + ms;
  while (performance.now() < end) {
    await new Promise((r) => window.setTimeout(r, 60));
    a.getFloatTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  }
  host.master.disconnect(a);
  return peak > 0.0001 ? `${(20 * Math.log10(peak)).toFixed(1)} dBFS` : '无信号';
}

async function audioSelfTest() {
  audioStateEl.textContent = '音频状态：正在检测…';
  const ok = await reviveAudio();
  if (!ok) {
    audioStateEl.textContent = `${describeAudio()} · 上下文起不来`;
    toast('这台设备暂时无法开启声音');
    return;
  }
  if (save.muted) {
    // 自检也顺手把声音打开：用户点这个按钮，本来就是为了听见
    save.muted = false;
    host.setAllMuted(false);
    music.setMuted(false);
    store.persist(save);
    syncSoundButton();
  }
  sounds.woodfish(1);
  window.setTimeout(() => sounds.bell(196, 1), 380);
  window.setTimeout(() => sounds.chime(1), 980);
  const peak = await measureMasterPeak(1400);
  audioStateEl.textContent = `${describeAudio()} · 主输出峰值 ${peak}`;
}

async function toggleSound() {
  if (!audioOn) {
    const ok = await enableAudio();
    if (!ok) return;
    save.muted = false;
    host.setAllMuted(false);
    music.setMuted(false);
    store.persist(save);
    syncSoundButton();
    toast('声音已开启');
    return;
  }
  if (save.muted && !(await reviveAudio())) {
    // 想开声但上下文叫不醒：别把按钮切成“静音”，免得看着像好了其实没声
    toast('这台设备暂时无法开启声音');
    return;
  }
  save.muted = !save.muted;
  host.setAllMuted(save.muted);
  music.setMuted(save.muted);
  store.persist(save);
  syncSoundButton();
  toast(save.muted ? '已静音' : '声音已开启');
}

// ————————————————————————————— 更新公告

/** 公告只当纯文本渲染：不拼 innerHTML，也不认任何标记 */
function renderNotice(entries: ChangelogEntry[], title: string, kicker: string) {
  noticeKicker.textContent = kicker;
  noticeTitle.textContent = title;
  noticeBody.textContent = '';
  for (const e of entries) {
    const wrap = document.createElement('div');
    wrap.className = 'notice-entry';
    const h = document.createElement('h3');
    h.textContent = `${e.date} · ${e.title}`;
    const ul = document.createElement('ul');
    for (const item of e.items) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    }
    wrap.append(h, ul);
    noticeBody.appendChild(wrap);
  }
  noticeEl.classList.add('open');
  noticeEl.setAttribute('aria-hidden', 'false');
  noticeOk.focus({ preventScroll: true });
}

function closeNotice() {
  if (!noticeEl.classList.contains('open')) return;
  noticeEl.classList.remove('open');
  noticeEl.setAttribute('aria-hidden', 'true');
  noticeOk.blur();
  // 关掉就算看过：下次只在有新 id 时才弹
  save.noticeSeen = latestNoticeId();
  store.persist(save);
}

/** 进页面时：只弹没看过的；没看过（新访客）就只看最新一条 */
function showUpdateNotice() {
  const entries = unseenEntries(save.noticeSeen);
  if (!entries.length) return;
  renderNotice(
    entries,
    entries.length > 1 ? '这几版都更新了什么' : '这次更新了什么',
    '且坐 · 更新',
  );
}

/** 设置里的「更新公告」：回顾最近几次 */
function openChangelog() {
  renderNotice(CHANGELOG.slice(0, 5), '更新公告', '且坐 · 最近几次更新');
}

// ————————————————————————————— 求签

let fortuneAsking = false;

/** 今天还没求过就在右上角点个小金点 */
function refreshFortuneButton() {
  btnFortune.classList.toggle('todo', save.lastFortuneDay !== todayKey());
}

function almanacRow(k: string, v: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'almanac-row';
  const key = document.createElement('span');
  key.className = 'k';
  key.textContent = k;
  const val = document.createElement('span');
  val.textContent = v;
  row.append(key, val);
  return row;
}

function renderAlmanac(a: FortuneAlmanac) {
  fortuneAlmanacEl.textContent = '';
  const day = [a.lunar ? `农历${a.lunar}` : '', a.weekday].filter(Boolean).join(' · ');
  fortuneAlmanacEl.append(
    almanacRow('日子', day),
    almanacRow('干支', `${a.ganzhi.year}年 ${a.ganzhi.month}月 ${a.ganzhi.day}日`),
    almanacRow('值日', `${a.jianchu} · 日主${a.element}`),
    almanacRow('宜', a.yi.join(' · ')),
    almanacRow('忌', a.ji.join(' · ')),
    almanacRow('冲煞', `冲${a.chong} · 煞${a.sha}`),
  );
}

/** 签文只当纯文本渲染，不拼 innerHTML */
function renderSlip(lot: FortuneLot) {
  fortuneNoEl.textContent = `第 ${lot.no} 签`;
  fortuneGradeEl.textContent = lot.grade;
  fortuneTitleEl.textContent = lot.title;

  fortuneVerseEl.textContent = '';
  for (const line of lot.verse) {
    const p = document.createElement('div');
    p.textContent = line;
    fortuneVerseEl.appendChild(p);
  }

  fortuneReadEl.textContent = lot.read;

  fortuneTodayEl.textContent = '';
  const label = document.createElement('b');
  label.textContent = '今日行止 · ';
  fortuneTodayEl.append(label, document.createTextNode(lot.today));

  fortuneSlipEl.hidden = false;
}

function clockOf(t: number): string {
  try {
    return new Date(t).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

async function openFortune() {
  if (fortuneAsking || fortuneEl.classList.contains('open')) return;
  fortuneAsking = true;

  fortuneEl.classList.add('open');
  fortuneEl.setAttribute('aria-hidden', 'false');
  fortuneAlmanacEl.textContent = '';
  fortuneSlipEl.hidden = true;
  fortuneOk.hidden = true;
  fortuneNoteEl.textContent = '签文只作自省，不作吉凶断语。';
  fortuneLoadingEl.hidden = false;

  // 至少摇一会儿，别让签"秒出"
  const started = performance.now();
  const res = await drawFortune();
  const wait = Math.max(0, 900 - (performance.now() - started));
  if (wait) await new Promise((r) => window.setTimeout(r, wait));

  fortuneLoadingEl.hidden = true;
  fortuneAsking = false;

  if (res.ok) {
    renderAlmanac(res.almanac);
    renderSlip(res.lot);
    // 服务端给的日期就是"今天"：记下来，明天才有小金点
    save.lastFortuneDay = res.almanac.date;
    store.persist(save);
    refreshFortuneButton();

    fortuneNoteEl.textContent = res.first
      ? '第一次求 · 明日可再求一签'
      : `今日已求 · ${clockOf(res.drawnAt)} · 明日再来`;

    if (res.first) {
      // 竹签的哗啦声 → 一声磬
      sounds.bead(0.45);
      window.setTimeout(() => sounds.bead(0.55), 140);
      window.setTimeout(() => sounds.bead(0.65), 290);
      window.setTimeout(() => sounds.bell(196, 1), 760);
    }
  } else if (res.code === 'network') {
    save.lastFortuneDay = todayKey();
    store.persist(save);
    refreshFortuneButton();
    fortuneNoteEl.textContent = '这台网络今天已经求过了，明天再来。';
  } else if (res.code === 'offline') {
    fortuneNoteEl.textContent = '签筒还没备好 · 稍后再试。';
  } else if (res.code === 'slow') {
    fortuneNoteEl.textContent = '签筒有点忙 · 过一会儿再试。';
  } else {
    fortuneNoteEl.textContent = '这一签没出来 · 稍后再试。';
  }

  fortuneOk.hidden = false;
  fortuneOk.focus({ preventScroll: true });
}

function closeFortune() {
  if (!fortuneEl.classList.contains('open')) return;
  fortuneEl.classList.remove('open');
  fortuneEl.setAttribute('aria-hidden', 'true');
}

/** 点殿里的签筒：先走过去，到了再摇 */
function goFortune() {
  standUp();
  pendingSeat = null;
  pendingIncense = false;
  setBeadPanel(false);
  pendingFortune = true;
  moveTarget = new THREE.Vector3(
    temple.fortuneStand.position.x + 1.05,
    0,
    temple.fortuneStand.position.z + 0.65,
  );
  toast('走向签筒…');
}

// ————————————————————————————— UI 绑定

function bindUI() {
  btnStart.addEventListener('click', onStart);
  btnSound.addEventListener('click', toggleSound);

  // 骰子：换一个法号（不动存档，按“开门”时才落盘）
  btnDice.addEventListener('click', () => {
    nameInput.value = randomDharmaName(nameInput.value.trim());
    btnDice.classList.remove('roll');
    void btnDice.offsetWidth; // 重排一下，让动画能连点重播
    btnDice.classList.add('roll');
    window.setTimeout(() => btnDice.classList.remove('roll'), 460);
  });

  for (const b of Array.from(actionsBar.querySelectorAll('button'))) {
    b.addEventListener('click', () => {
      if (!requireSeated()) return;
      const act = (b as HTMLElement).dataset.act;
      if (act === 'anjali') doAnjali();
      if (act === 'bow') toggleBow(b as HTMLButtonElement);
      if (act === 'woodfish') setFishAuto(!fishAuto);
      if (act === 'beads') setBeadPanel(!beadOpen);
    });
  }

  btnBeadClose.addEventListener('click', () => setBeadPanel(false));
  btnBeadAuto.addEventListener('click', () => setBeadAuto(!beadsUI.isAuto));
  btnFishClose.addEventListener('click', () => setFishAuto(false));

  btnSettings.addEventListener('click', () => {
    audioStateEl.textContent = describeAudio();
    // 每次打开都收起反馈卡片，保持面板干净
    feedbackCard.hidden = true;
    btnFeedback.textContent = '问题反馈';
    btnFeedback.setAttribute('aria-expanded', 'false');
    settingsEl.classList.add('open');
  });
  $('btn-audio-test').addEventListener('click', () => void audioSelfTest());
  btnFeedback.addEventListener('click', () => {
    const open = feedbackCard.hidden;
    feedbackCard.hidden = !open;
    btnFeedback.textContent = open ? '收起' : '问题反馈';
    btnFeedback.setAttribute('aria-expanded', String(open));
  });
  btnCopyMail.addEventListener('click', () => {
    void copyText(FEEDBACK_MAIL).then((ok) => toast(ok ? '邮箱已复制' : FEEDBACK_MAIL));
  });
  btnFortune.addEventListener('click', () => void openFortune());
  $('fortune-close').addEventListener('click', closeFortune);
  fortuneOk.addEventListener('click', closeFortune);
  fortuneEl.addEventListener('click', (e) => {
    if (e.target === fortuneEl) closeFortune();
  });

  noticeOk.addEventListener('click', closeNotice);
  noticeEl.addEventListener('click', (e) => {
    if (e.target === noticeEl) closeNotice();
  });
  $('btn-changelog').addEventListener('click', openChangelog);
  $('btn-settings-close').addEventListener('click', () =>
    settingsEl.classList.remove('open'),
  );

  const bindVol = (id: string, key: 'amb' | 'chant' | 'sfx') => {
    const input = $(id) as HTMLInputElement;
    input.addEventListener('input', () => {
      const v = Number(input.value) / 100;
      save.vol[key] = v;
      host.setVolume(key, v);
      if (save.muted && v > 0) {
        // 拖了滑块说明想听
        save.muted = false;
        host.setAllMuted(false);
        music.setMuted(false);
        syncSoundButton();
        void reviveAudio();
      }
      store.persist(save);
    });
  };
  bindVol('vol-amb', 'amb');
  bindVol('vol-chant', 'chant');
  bindVol('vol-sfx', 'sfx');

  // ——— 佛乐：音量、开关、下一首
  const musicVol = $<HTMLInputElement>('vol-music');
  musicVol.addEventListener('input', () => {
    save.vol.music = Number(musicVol.value) / 100;
    music.setVolume(save.vol.music);
    if (save.muted && save.vol.music > 0) {
      save.muted = false;
      host.setAllMuted(false);
      music.setMuted(false);
      syncSoundButton();
      void reviveAudio();
    }
    store.persist(save);
  });

  musicOnEl.addEventListener('change', () => {
    save.music = musicOnEl.checked;
    music.setOn(save.music);
    store.persist(save);
    // 开了却听不见没道理：首次进站是静音存档，顺手把声音也打开
    if (save.music) void wakeSound();
    reflectMusic();
  });

  $('btn-music-next').addEventListener('click', () => {
    if (!music.enabled) {
      // 没开佛乐时点「下一首」，意思就是“我要听”
      save.music = true;
      music.setOn(true);
      store.persist(save);
      void wakeSound();
      return;
    }
    void wakeSound();
    music.next();
  });

  $('btn-reset').addEventListener('click', () => {
    merit = 0;
    save.merit = 0;
    save.beads = 0;
    meritEl.textContent = '0';
    beadsCountEl.textContent = '0';
    beadsUI.setTotal(0);
    store.persist(save);
    toast('累计数已清空');
  });

  btnService.addEventListener('click', () => goIncense());

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'KeyE') {
      e.preventDefault();
      if (beadOpen) beadsUI.step(1);
      else setFishAuto(!fishAuto);
    }
    if (e.code === 'Escape') {
      if (fortuneEl.classList.contains('open')) {
        closeFortune();
        return;
      }
      if (noticeEl.classList.contains('open')) {
        closeNotice();
        return;
      }
      setBeadPanel(false);
      settingsEl.classList.remove('open');
    }
  });

  document.addEventListener('visibilitychange', async () => {
    // 切后台就把佛乐停住：音乐不该跟着跑到口袋里，也省流量
    if (document.hidden) {
      music?.suspend();
      return;
    }
    updateDayNight();
    // 跨过零点再切回来时，求签的小金点要重新出现
    refreshFortuneButton();
    void refreshWeather();
    music?.resume();
    if (audioOn) await reviveAudio();
  });

  // 任何一次手势都顺手把上下文叫醒。iOS 只认手势里的 resume，
  // 没有这一手的话，切后台回来后整页就永久没声了。
  const kick = () => {
    music?.kick();
    if (!audioOn || (host.ctx.state as string) === 'running') return;
    void reviveAudio();
  };
  document.addEventListener('pointerdown', kick, true);
  document.addEventListener('touchend', kick, true);
  document.addEventListener('keydown', kick, true);
  window.addEventListener('focus', kick);
  // 微信内置浏览器要等 JSBridge 就绪才能真正出声
  document.addEventListener('WeixinJSBridgeReady', kick, false);
}

async function onStart() {
  welcomeEl.classList.add('leave');
  welcomeEl.classList.remove('show');
  // 触摸设备靠这个类把摇杆放出来（见 style.css 的 @media (pointer: coarse)）
  document.body.classList.add('playing');
  topbar.classList.add('show');
  meter.classList.add('show');
  actionsBar.classList.add('show');

  // 这个点击是唯一可靠的手势来源：先解锁上下文
  // 佛乐必须在 await 之前同步 play()：iOS / 微信只认同一个任务里的手势
  music.start();
  const ok = await host.unlock();
  if (ok) {
    audioOn = true;
    wind.start();
    chant.start();
    host.setAllMuted(save.muted);
    if (save.muted) {
      toast('默认静音 · 右上「声音」可开启');
    }
  }

  controls.recenterBehind(monk.root.rotation.y);

  // 同修连线：名字取自首屏输入，留空就叫“无名”
  const rawName = nameInput.value.replace(/[<>&]/g, '').trim().slice(0, 12);
  if (rawName !== save.name || !save.nameTouched) {
    save.name = rawName;
    save.nameTouched = true;
    store.persist(save);
  }
  if (!net) initNet();
}

// ————————————————————————————— 昼夜

// ————————————————————————————— 天气（北京）

let weatherKind: WeatherKind = 'clear';
let weatherLabel = WEATHER_ZH.clear;
let weatherFetchedAt = 0;

/** 山寺按北京时间过日子：昼夜、天气都以东八区为准 */
function beijingHour(): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        hour12: false,
      }).format(new Date(serverNow())),
    );
  } catch {
    return new Date(serverNow()).getHours();
  }
}

/**
 * 每 10 分钟问一次北京天气；断网就沿用上一次的结果。
 * 天气只影响观感，不阻塞任何交互，所以这里全部静默失败。
 */
async function refreshWeather(force = false) {
  if (!force && Date.now() - weatherFetchedAt < 4 * 60_000) return;
  const w = await fetchWeather();
  weatherFetchedAt = Date.now();
  if (!w) return;
  weatherKind = w.kind;
  weatherLabel = w.label || WEATHER_ZH[w.kind];
  temple.setWeather(w.kind);
  weatherVfx?.set(w.kind);
  updateDayNight();
}

function updateDayNight() {
  // 用服务器时间，否则两个人可能一个看到白天一个看到夜里
  const h = beijingHour();
  const night = h < 6 || h >= 18;
  temple.setNight(night);
  daynightEl.textContent = `${night ? '夜' : '昼'} · ${weatherLabel}`;
}

// ————————————————————————————— 交互动作

const raycaster = new THREE.Raycaster();

function onTap(clientX: number, clientY: number) {
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);

  // 1) 坐垫：点中就闪一下，走过去的过程中一直亮着
  const picked = pickCushionAt(clientX, clientY);
  if (picked) {
    picked.flash = 1;
    sitOn(picked);
    return;
  }

  // 2) 香炉
  if (raycaster.intersectObject(temple.burner, true).length) {
    goIncense();
    return;
  }

  // 3) 木鱼台
  if (raycaster.intersectObject(temple.woodfishStand, true).length) {
    knock();
    toast('功德 +1');
    return;
  }

  // 4) 签筒
  if (raycaster.intersectObject(temple.fortuneStand, true).length) {
    goFortune();
    return;
  }

  // 5) 小沙弥：点他一下，他就念一句
  if (raycaster.intersectObject(novice.root, true).length) {
    novice.react();
    return;
  }

  // 6) 地面（殿内石板 / 庭院草地）
  const hit = raycaster.intersectObjects(temple.groundMeshes, false)[0];
  if (hit) walkTo(hit.point.clone());
}

function standUp() {
  if (!sitting) return;
  sitting.occupied = false;
  sitting = null;
  if (mySeat !== null) {
    mySeat = null;
    net?.claimSeat(null);
  }
  monk.root.position.y = 0;
  bowing = false;
  tempPose = null;
  setBeadPanel(false);
  setFishAuto(false);
  setActiveCushion(null);
  actionsBar.classList.remove('seated');
  const bowBtn = actionsBar.querySelector('[data-act="bow"]');
  bowBtn?.classList.remove('on');
}

function walkTo(p: THREE.Vector3) {
  standUp();
  setActiveCushion(null);
  canvas.style.cursor = '';
  pendingSeat = null;
  pendingIncense = false;
  pendingFortune = false;
  setBeadPanel(false);
  moveTarget = clampToWalk(p.clone());
}

function sitOn(c: Cushion) {
  if (seatTaken(c)) {
    toast('这张蒲团有人了 · 换一张吧');
    return;
  }
  standUp();
  setActiveCushion(c);
  pendingSeat = c;
  pendingIncense = false;
  pendingFortune = false;
  setBeadPanel(false);
  moveTarget = c.seat.clone();
}

function goIncense() {
  standUp();
  pendingSeat = null;
  setBeadPanel(false);
  pendingFortune = false;
  pendingIncense = true;
  moveTarget = new THREE.Vector3(temple.burner.position.x + 1.15, 0, temple.burner.position.z + 0.2);
  toast('走向香炉…');
}

function arrive() {
  if (pendingSeat) {
    sitting = pendingSeat;
    sitting.occupied = true;
    monk.root.position.copy(sitting.seat);
    // 坐垫顶面在 0.23，角色下摆底部在局部 0.01，抬到 0.22 刚好坐上去
    monk.root.position.y = 0.22;
    // 坐下就面朝佛坛，跟山寺一致
    monk.setFacing(Math.PI);
    pendingSeat = null;
    actionsBar.classList.add('seated');
    toast('已坐 · 可合掌、礼佛、敲木鱼、捻念珠');
    // 坐下时，佛前的小沙弥招呼一声
    novice?.react('且坐 · 且坐', 30_000);
    // 跟服务端报备这张蒲团，被占了会被请起来
    mySeat = seatIndexOf(sitting);
    net?.claimSeat(mySeat);
    return;
  }
  if (pendingFortune) {
    setActiveCushion(null);
    pendingFortune = false;
    tempPose = { pose: 'anjali', until: performance.now() + 2000 };
    const t = temple.fortuneStand.position;
    monk.setFacing(Math.atan2(t.x - monk.root.position.x, t.z - monk.root.position.z));
    void openFortune();
    return;
  }
  if (pendingIncense) {
    setActiveCushion(null);
    pendingIncense = false;
    tempPose = { pose: 'incense', until: performance.now() + 2400 };
    window.setTimeout(() => {
      temple.addIncense();
      sounds.incense();
      net?.event('incense');
    }, 900);
    window.setTimeout(() => toast('香已插上 · 可燃两分钟'), 1500);
  }
}

let lastStepAt = 0;

function stepTo(dir: THREE.Vector3, dt: number, speed = 2.7) {
  const t = performance.now();
  if (t - lastStepAt > 380) {
    lastStepAt = t;
    // 极轻的脚步声：踩在石板上的一点摩擦
    sounds.bead(0.12);
  }

  const p = monk.root.position;
  const [nx, nz] = resolveMove(p.x, p.z, p.x + dir.x * speed * dt, p.z + dir.z * speed * dt);
  p.x = nx;
  p.z = nz;

  // 台阶与庭院有高差，平滑过渡
  const gy = temple.groundHeightAt(p.x, p.z);
  p.y += (gy - p.y) * Math.min(1, dt * 12);

  monk.faceTo(Math.atan2(dir.x, dir.z), dt);
  movedThisFrame = true;
}

function doAnjali() {
  tempPose = { pose: 'anjali', until: performance.now() + 2600 };
  sounds.chime();
  net?.event('anjali');
  if (save.muted) toast('声音是关的 · 点右上「声音」开启');
  floater(monkHead(), '合十');
}

function toggleBow(btn?: HTMLButtonElement) {
  bowing = !bowing;
  const b = btn ?? (actionsBar.querySelector('[data-act="bow"]') as HTMLButtonElement);
  b?.classList.toggle('on', bowing);
  if (bowing) {
    sounds.chime(0.7);
    // 小沙弥跟着回一句，但有冷却，免得反复礼佛变成复读
    novice?.react('阿弥陀佛', 20_000);
  }
}

function knock(auto = false) {
  if (!requireSeated()) return;
  if (!audioOn && !auto) {
    void toggleSound();
    return;
  }
  if (save.muted) {
    toast('声音是关的 · 点右上「声音」开启');
  }
  sounds.woodfish(1);
  merit++;
  save.merit = merit;
  meritEl.textContent = String(merit);
  net?.event('fish');

  lastKnock = performance.now();
  malletHitAt = lastKnock;
  handFish.visible = true;
  if (auto) fishSession++;
  // 敲的时候摆出"手在身前"的姿态，从背后也能看出在动
  if (!bowing && !fishAuto) tempPose = { pose: 'bead', until: lastKnock + 1500 };

  floater(monkHead().add(new THREE.Vector3(0, 0.42, 0)), '功德 +1');

  if (navigator.userActivation?.isActive && 'vibrate' in navigator) {
    navigator.vibrate?.(8);
  }

  // 一段很短的时间后把持珠/木鱼收起来
  window.setTimeout(() => {
    if (performance.now() - lastKnock > 3800) handFish.visible = false;
  }, 4000);
}

/** 两拍之间的间隔，稍微抖一点，别像节拍器 */
function nextFishInterval() {
  return 1500 + Math.random() * 340;
}

/** 每敲一下刷新面板：涟漪重放 + 进度条从头走到下一拍 */
function fishBeatUI(interval: number) {
  fishIcon.classList.remove('hit');
  void fishIcon.offsetWidth;
  fishIcon.classList.add('hit');

  fishFill.style.transition = 'none';
  fishFill.style.transform = 'scaleX(0)';
  void fishFill.offsetWidth;
  fishFill.style.transition = `transform ${interval}ms linear`;
  fishFill.style.transform = 'scaleX(1)';

  fishCountEl.textContent = String(fishSession);
}

function setFishAuto(on: boolean) {
  if (on) {
    if (fishAuto) return;
    if (!requireSeated()) return;
    if (beadOpen) setBeadPanel(false);
    if (!audioOn) void toggleSound();
    fishAuto = true;
    fishSession = 0;
    fishPanel.classList.add('open');
    actionsBar.querySelector('[data-act="woodfish"]')?.classList.add('on');
    // 点下去先敲一记，之后按节拍自己走
    const iv = nextFishInterval();
    knock(true);
    fishNext = performance.now() + iv;
    fishBeatUI(iv);
  } else {
    if (!fishAuto) return;
    fishAuto = false;
    fishPanel.classList.remove('open');
    actionsBar.querySelector('[data-act="woodfish"]')?.classList.remove('on');
    fishIcon.classList.remove('hit');
    fishFill.style.transition = 'none';
    fishFill.style.transform = 'scaleX(0)';
    if (fishSession > 0) toast(`连敲 ${fishSession} 下 · 功德 +${fishSession}`);
  }
}

/** 合掌 / 礼佛 / 木鱼 / 念珠 都必须在蒲团上做 */
function requireSeated(): boolean {
  if (sitting) return true;
  toast('先找个蒲团坐下，再合掌、礼佛、敲木鱼、捻念珠');
  actionsBar.classList.remove('nudge');
  void actionsBar.offsetWidth; // 强制重排，让抖动动画能重放
  actionsBar.classList.add('nudge');
  window.setTimeout(() => actionsBar.classList.remove('nudge'), 420);
  return false;
}

function monkHead(): THREE.Vector3 {
  return monk.root.position.clone().add(new THREE.Vector3(0, 1.15, 0));
}

function setBeadPanel(open: boolean) {
  beadOpen = open;
  beadPanel.classList.toggle('open', open);
  beadsUI.setOpen(open);
  const b = actionsBar.querySelector('[data-act="beads"]');
  b?.classList.toggle('on', open);
  if (open) {
    setFishAuto(false);
    sounds.bead(0.5);
  } else {
    // 收起面板就停自动，不要在看不见的时候还一直拨
    setBeadAuto(false);
  }
}

/** 自动捻珠：跟木鱼的自动同一套手感 */
function setBeadAuto(on: boolean) {
  if (on) {
    if (beadsUI.isAuto) return;
    if (!requireSeated()) return;
    if (!beadOpen) setBeadPanel(true);
    if (!audioOn) void toggleSound();
    beadsUI.setAuto(true);
  } else {
    if (!beadsUI.isAuto) return;
    beadsUI.setAuto(false);
    const n = beadsUI.session;
    if (n > 1) toast(`自动捻过 ${n} 颗 · 念珠 ${beadsUI.count}`);
  }
  beadPanel.classList.toggle('auto', beadsUI.isAuto);
  btnBeadAuto.classList.toggle('on', beadsUI.isAuto);
  btnBeadAuto.textContent = beadsUI.isAuto ? '停' : '自动';
}

// ————————————————————————————— 同修（联机）

/** 服务器时间，没连上就用本机 */
function serverNow(): number {
  return net?.serverNow ?? Date.now();
}

function updateOnline(n: number) {
  onlineEl.textContent = String(Math.max(1, n));
}

function seatIndexOf(c: Cushion | null): number {
  return c ? temple.cushions.indexOf(c) : -1;
}

/** 这张蒲团是不是被别的同修坐着 */
function seatTaken(c: Cushion): boolean {
  const who = remoteSeats.get(seatIndexOf(c));
  return !!who && who !== net?.id;
}

function addRemote(info: RemoteInfo) {
  if (!info?.id || info.id === net?.id) return;
  removeRemote(info.id);
  const r = new RemotePlayer(info);
  remotes.set(info.id, r);
  scene.add(r.monk.root);
  if (info.seat !== null) remoteSeats.set(info.seat, info.id);
}

function removeRemote(id: string) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.monk.root);
  r.dispose();
  remotes.delete(id);
  for (const [seat, who] of [...remoteSeats]) if (who === id) remoteSeats.delete(seat);
}

/** 别人的木鱼 / 过珠：只在听得见的距离内出声，音量随距离衰减 */
function playRemoteEvent(id: string, k: NetEventKind) {
  const r = remotes.get(id);
  if (!r) return;
  const d = r.monk.root.position.distanceTo(monk.root.position);
  if (d > 18) return;
  const vol = (1 - d / 18) ** 1.5;
  if (vol < 0.03) return;
  if (k === 'fish') sounds.woodfish(vol);
  else if (k === 'bead') sounds.bead(vol * 0.85);
  else if (k === 'round') sounds.bell(196, vol);
  else if (k === 'anjali') sounds.chime(vol * 0.85);
  else if (k === 'incense') sounds.incense();
}

function initNet() {
  net = new NetClient({
    name: save.name,
    robe: 0x6b4a35,
    handlers: {
      onWelcome(_id, players, seats) {
        mySeat = null;
        for (const key of [...remotes.keys()]) removeRemote(key);
        remoteSeats.clear();
        for (const [seat, who] of seats) remoteSeats.set(seat, who);
        for (const p of players) addRemote(p);
        updateOnline(players.length + 1);
        if (!linkToastShown) {
          linkToastShown = true;
          if (players.length) toast(`法堂里已有 ${players.length} 位同修`);
          else toast('已与且坐连线 · 可邀人同来');
        }
      },
      onJoin(p) {
        addRemote(p);
        toast(`${p.name} 进来了`);
      },
      onLeave(id) {
        removeRemote(id);
      },
      onSnap(_now, list) {
        remoteSeats.clear();
        for (const e of list) {
          const r = remotes.get(e.id);
          if (r) r.setTarget(e);
          if (e.seat !== null) remoteSeats.set(e.seat, e.id);
        }
      },
      onSeats(seats) {
        remoteSeats.clear();
        for (const [seat, who] of seats) {
          if (who !== net?.id) remoteSeats.set(seat, who);
        }
      },
      onEvent(id, k) {
        playRemoteEvent(id, k);
      },
      onSeatResult(seat, ok, by) {
        if (ok) {
          mySeat = seat;
          return;
        }
        if (seat === null) return;
        // 服务端说这位置被人占了：站起来让他
        mySeat = null;
        if (sitting) {
          toast(by ? `${by} 已经坐在这里了` : '这张蒲团有人了');
          standUp();
        }
      },
      onOnline(n) {
        updateOnline(n);
      },
      onStatus(s) {
        if (s === 'full') toast('这间法堂坐满了 · 稍后再来');
        else if (s === 'open' && linkToastShown) toast('已重新连线');
        else if (s === 'closed' && linkToastShown) toast('连线断了 · 正在重连…');
      },
    },
  });
  net.connect();
}

// ————————————————————————————— 姿态决定

function decidePose(): Pose {
  const now = performance.now();
  if (tempPose && tempPose.until > now) return tempPose.pose;
  if (tempPose && tempPose.until <= now) tempPose = null;

  if (beadOpen || fishAuto) return 'bead';
  if (bowing) return 'bow';
  if (sitting) return 'sit';
  if (movedThisFrame) return 'walk';
  return 'idle';
}

// ————————————————————————————— 主循环

let prevNow = performance.now();
let dnTimer = 0;

function frame(now: number) {
  const dt = Math.min(0.05, (now - prevNow) / 1000);
  prevNow = now;
  const t = now / 1000;
  movedThisFrame = false;

  updateMovement(dt);

  const pose = decidePose();
  if (pose !== lastPose) {
    monk.setPose(pose);
    lastPose = pose;
  }
  monk.update(dt, t);
  updateChantProximity();
  novice.update(dt, t, monk.root.position);

  // 同修：本机上报名自的位姿，别人的位姿插值到目标
  net?.report(
    monk.root.position.x,
    monk.root.position.z,
    monk.root.rotation.y,
    pose,
    sitting ? seatIndexOf(sitting) : null,
  );
  for (const r of remotes.values()) r.update(dt, t, temple);

  // 手持木鱼：敲击后短暂出现
  if (handFish.visible) {
    if (now - lastKnock > 4200) handFish.visible = false;
    const e = Math.min(1, (now - malletHitAt) / 130);
    handMallet.rotation.x = -0.9 * (1 - e) * (e > 0 ? 1 : 0);
    handFish.position.y = 0.46 + Math.sin(Math.min(1, (now - malletHitAt) / 90) * Math.PI) * 0.01;
  }

  // 自动木鱼：到点就敲
  if (fishAuto) {
    if (!sitting) {
      setFishAuto(false);
    } else if (now >= fishNext) {
      const iv = nextFishInterval();
      knock(true);
      fishNext = now + iv;
      fishBeatUI(iv);
    }
  }

  temple.update(dt, t);
  weatherVfx?.update(dt, t, camera.position.x, camera.position.z);

  // 镜头跟随
  const focusY = sitting ? 0.72 : 1.02;
  const want = monk.root.position.clone().add(new THREE.Vector3(0, focusY, 0));
  controls.focus.lerp(want, Math.min(1, dt * 5.5));
  controls.minCamY = monk.root.position.y + 0.55;
  // 在殿内时把相机压在天花板以下，否则拉远会翻到屋顶外面去。
  // 用插值过渡，避免跨过门槛那一刻镜头突然跳一下。
  const p = monk.root.position;
  const insideHall = p.z < 10.6 && Math.abs(p.x) < HALL_HALF_W;
  const camYTarget = insideHall ? temple.ceilY - 0.45 : CAMY_FREE;
  if (camYLimit === null) camYLimit = camYTarget;
  camYLimit += (camYTarget - camYLimit) * Math.min(1, dt * 9);
  controls.maxCamY = camYLimit;
  controls.update(dt);

  renderer.render(scene, camera);

  if (now - dnTimer > 30_000) {
    dnTimer = now;
    updateDayNight();
    store.persist(save);
  }

  requestAnimationFrame(frame);

  // 公告等首屏落稳再弹，别和开门动画抢
  window.setTimeout(showUpdateNotice, 420);
}

function updateMovement(dt: number) {
  const kb = controls.readKeyboard();
  const stickV = controls.walk;
  let ix = 0;
  let iz = 0;

  if (stickV.lengthSq() > 0.02) {
    ix = stickV.x;
    iz = stickV.y;
  } else if (kb.lengthSq() > 0.2) {
    ix = kb.x;
    iz = kb.y;
  }

  const wantsMove = Math.abs(ix) > 0.02 || Math.abs(iz) > 0.02;
  // 坐着时一动摇杆/方向键就起身，省得还要先点地面
  if (sitting) {
    if (!wantsMove) return;
    standUp();
  }

  if (Math.abs(ix) > 0.02 || Math.abs(iz) > 0.02) {
    moveTarget = null;
    pendingSeat = null;
    pendingIncense = false;
    pendingFortune = false;

    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();

    const move = new THREE.Vector3()
      .addScaledVector(right, ix)
      .addScaledVector(fwd, -iz);
    if (move.lengthSq() > 0.0001) {
      move.normalize();
      stepTo(move, dt, 2.4 + Math.min(1.4, Math.hypot(ix, iz) * 1.4));
    }
    return;
  }

  if (moveTarget) {
    const to = moveTarget.clone().sub(monk.root.position);
    to.y = 0;
    const d = to.length();
    if (d < 0.16) {
      moveTarget = null;
      arrive();
    } else {
      to.normalize();
      // 靠近目标时减速，避免"撞上去"
      stepTo(to, dt, d < 0.8 ? 1.3 : 2.7);
    }
  }
}

// ————————————————————————————— 尺寸

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  controls.resize(w, h);
}

// ————————————————————————————— 调试钩子（本地重建版方便排查，正式版删掉）
;(window as any).__ss = () => ({
  pos: monk.root.position.toArray().map((v) => +v.toFixed(2)),
  rotY: +monk.root.rotation.y.toFixed(3),
  pose: monk.currentPose,
  sitting: !!sitting,
  moveTarget: moveTarget ? moveTarget.toArray().map((v) => +v.toFixed(2)) : null,
  camAz: +controls.camera.position.toArray()[0].toFixed(2),
});

// 调试：木鱼状态
;(window as any).__fish = () => ({ auto: fishAuto, session: fishSession, next: Math.round(fishNext) });

// 调试：联机状态
;(window as any).__net = () => ({
  ...(net?.debug() ?? { connected: false }),
  remotes: remotes.size,
  remoteNames: [...remotes.values()].map((r) => r.name),
  remoteSeats: [...remoteSeats.entries()],
  mySeat,
});

// 调试：念珠状态
;(window as any).__beads = () => ({
  auto: beadsUI.isAuto,
  session: beadsUI.session,
  total: beadsUI.count,
});

// 调试：相机参数
;(window as any).__cam = () => controls.debug();

// 调试：强制昼夜 / 瞬移，仅用于自动化测试
;(window as any).__night = (v: boolean) => temple.setNight(v);
;(window as any).__tp = (x: number, z: number) => {
  const y = temple.groundHeightAt(x, z);
  monk.root.position.set(x, y, z);
  controls.focus.set(x, y + 1.02, z);
  return [x, y, z];
};

// 调试：把坐垫投影到屏幕坐标，方便自动化测试点中
;(window as any).__cs = () =>
  temple.cushions.map((c) => {
    const v = c.seat.clone().project(camera);
    return [
      Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
      Math.round((-v.y * 0.5 + 0.5) * window.innerHeight),
    ];
  });

// 调试：看天气粒子的当前状态
;(window as any).__vfx = () => weatherVfx?.stats() ?? null;

// 调试：强制切天气（自动化测试 / 看效果用）
;(window as any).__weather = (kind: WeatherKind) => {
  weatherKind = kind;
  weatherLabel = WEATHER_ZH[kind] ?? kind;
  temple.setWeather(kind);
  weatherVfx?.set(kind);
  updateDayNight();
  return weatherLabel;
};

// 调试：让镜头和角色一起转向某个点（自动化测试用）
;(window as any).__face = (x: number, z: number) => {
  const a = Math.atan2(x - monk.root.position.x, z - monk.root.position.z);
  controls.recenterBehind(a);
  monk.setFacing(a);
  return a;
};

// 调试：把殿门口的签筒投影到屏幕坐标，方便自动化测试点中
;(window as any).__fs = () => {
  const p = temple.fortuneStand.position.clone();
  p.y += 1.2;
  const v = p.project(camera);
  return [
    Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
    Math.round((-v.y * 0.5 + 0.5) * window.innerHeight),
  ];
};

// 调试：量三档总线当前电平（dBFS），用来校平衡
;(window as any).__audio = async (ms = 1500) => {
  const ctx = host.ctx;
  const buses = { amb: host.ambBus, chant: host.chantBus, sfx: host.sfxBus };
  const taps = (Object.keys(buses) as Array<keyof typeof buses>).map((n) => {
    const a = ctx.createAnalyser();
    a.fftSize = 2048;
    buses[n].connect(a);
    return { n, a, buf: new Float32Array(a.fftSize), peak: 0, sum: 0, k: 0 };
  });
  const end = performance.now() + ms;
  while (performance.now() < end) {
    await new Promise((r) => setTimeout(r, 60));
    for (const t of taps) {
      t.a.getFloatTimeDomainData(t.buf);
      let s = 0;
      for (let i = 0; i < t.buf.length; i++) s += t.buf[i] * t.buf[i];
      const rms = Math.sqrt(s / t.buf.length);
      if (rms > t.peak) t.peak = rms;
      t.sum += rms;
      t.k++;
    }
  }
  const db = (v: number) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -99);
  const out: Record<string, unknown> = {
    state: ctx.state,
    audioOn,
    unlocked: host.unlocked,
    vols: { ...save.vol },
    muted: save.muted,
  };
  for (const t of taps) {
    out[t.n] = { peakDb: db(t.peak), avgDb: db(t.sum / Math.max(1, t.k)) };
    buses[t.n].disconnect(t.a);
  }
  return out;
};

// ————————————————————————————— go

void boot();
