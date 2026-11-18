import * as THREE from 'three';
import { Monk } from './monk';

/**
 * 佛前的小沙弥：坐在佛坛侧边的蒲团上捻珠。
 *
 * 不做人声 TTS —— 合成人声在手机上音色不稳，也容易和殿里的梵呗打架。
 * 他“开口”的方式是：头顶浮出一句真言，配一声很轻的引磬；
 * 只有走近了才看得见、听得清，远了就只是个安静坐着的小身影。
 */

/**
 * 他念的东西分四类，混在一起才像一个人在念，而不是一台播放器：
 *   1. 真言咒语 —— 短、反复，念的时候不看意思
 *   2. 经文偈子 —— 成句，落下来有分量
 *   3. 祖师禅语、公案 —— 短促、带一点机锋
 *   4. 家常佛法 —— 谁都听得懂的那一句
 * 一共 100 条，一条一行；「且坐」留给这个场景。
 */
const LINES = [
  // —— 真言咒语
  '唵嘛呢叭咪吽',
  '唵阿吽',
  '唵嘛呢叭咪吽 · 舍',
  '揭谛揭谛 · 波罗揭谛',
  '揭谛揭谛 · 波罗僧揭谛',
  '菩提萨婆诃',
  '摩诃般若波罗蜜多',
  '唵钵啰末邻陀宁 · 娑婆诃',
  '唵三昧耶 · 萨埵鑁',
  '南无阿弥陀佛',
  '南无观世音菩萨',
  '南无本师释迦牟尼佛',
  '南无大势至菩萨',
  '南无地藏王菩萨',
  '南无清净大海众菩萨',
  '南无当来下生弥勒尊佛',
  // —— 经文偈子
  '诸恶莫作 · 众善奉行',
  '自净其意 · 是诸佛教',
  '一切有为法 · 如梦幻泡影',
  '如露亦如电 · 应作如是观',
  '凡所有相 · 皆是虚妄',
  '若见诸相非相 · 即见如来',
  '应无所住 · 而生其心',
  '不住色生心 · 不住声香味触法生心',
  '过去心不可得',
  '现在心不可得',
  '未来心不可得',
  '照见五蕴皆空 · 度一切苦厄',
  '色不异空 · 空不异色',
  '不生不灭 · 不垢不净 · 不增不减',
  '无苦集灭道 · 无智亦无得',
  '心无挂碍 · 无有恐怖',
  '远离颠倒梦想 · 究竟涅槃',
  '三世诸佛 · 依般若波罗蜜多故',
  '诸法因缘生 · 诸法因缘灭',
  '此生故彼生 · 此灭故彼灭',
  '缘起性空 · 因果不虚',
  '法尚应舍 · 何况非法',
  '一切众生 · 皆具如来智慧德相',
  '一切众生 · 皆堪作佛',
  '天上天下 · 唯我独尊',
  '假使百千劫 · 所作业不亡',
  '因缘会遇时 · 果报还自受',
  '若人欲了知 · 三世一切佛',
  '应观法界性 · 一切唯心造',
  '是日已过 · 命亦随减',
  '如少水鱼 · 斯有何乐',
  '当勤精进 · 如救头燃',
  // —— 祖师禅语、公案
  '菩提本无树 · 明镜亦非台',
  '本来无一物 · 何处惹尘埃',
  '身是菩提树 · 心如明镜台',
  '时时勤拂拭 · 勿使惹尘埃',
  '不是风动 · 不是幡动',
  '仁者心动',
  '吃茶去',
  '洗钵去',
  '平常心是道',
  '日日是好日',
  '饥来吃饭 · 困来即眠',
  '行亦禅 · 坐亦禅',
  '语默动静体安然',
  '一花一世界 · 一叶一如来',
  '青青翠竹 · 尽是法身',
  '郁郁黄花 · 无非般若',
  '溪声尽是广长舌',
  '山色无非清净身',
  '云在青天水在瓶',
  '掬水月在手 · 弄花香满衣',
  '竹密不妨流水过',
  '山高岂碍白云飞',
  '春有百花秋有月',
  '夏有凉风冬有雪',
  '若无闲事挂心头',
  '便是人间好时节',
  '万法唯心',
  '若能转物 · 即同如来',
  '不怕念起 · 只怕觉迟',
  '念起即觉 · 觉之即无',
  '境缘无好丑 · 好丑起于心',
  '且坐 · 且坐',
  // —— 家常佛法
  '放下屠刀 · 立地成佛',
  '苦海无边 · 回头是岸',
  '一念放下 · 万般自在',
  '诸恶莫作 · 众善奉行 · 自净其意',
  '莫以恶小而为之',
  '莫以善小而不为',
  '一念嗔心起 · 火烧功德林',
  '嗔心一起 · 百万障门开',
  '慈悲喜舍 · 四无量心',
  '随缘不变 · 不变随缘',
  '知足者常乐',
  '心安即是归处',
  '静坐常思己过',
  '闲谈莫论人非',
  '与人方便 · 自己方便',
  '吃亏是福 · 量大福大',
  '众生无边誓愿度',
  '烦恼无尽誓愿断',
  '法门无量誓愿学',
  '佛道无上誓愿成',
  '上报四重恩 · 下济三途苦',
  '愿以此功德 · 普及于一切',
  '若有见闻者 · 悉发菩提心',
  '尽此一报身 · 同生极乐国',
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Novice {
  readonly root = new THREE.Group();
  private monk: Monk;
  private nextAt = 0;
  private lastSpoke = -1e9;
  private wasNear = false;
  /** 洗好的牌堆：一轮之内不重复，全部念完再洗 */
  private deck: number[] = [];

  /**
   * @param onSpeak 念一句时回调：main 负责把字浮到头顶、按距离补一声磬
   */
  constructor(private onSpeak: (text: string, at: THREE.Vector3) => void) {
    // 里衣用浅褐，外面披一件深红袈裟：小小一个人也能一眼看出是沙弥
    this.monk = new Monk(0xb98a55, { kasaya: true });
    this.monk.root.scale.setScalar(0.84);
    // 捻珠的姿态：低头、手在身前，比直挺挺坐着更像在念
    this.monk.setPose('bead');
    this.monk.setFacing(-0.5);
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
    if (!this.deck.length) {
      this.deck = LINES.map((_, i) => i);
      // Fisher-Yates
      for (let i = this.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
      }
    }
    return LINES[this.deck.pop() as number];
  }
}
