/**
 * 签筒 —— 今日一签 + 山寺日课（黄历）。
 *
 *   POST /api/fortune   抽今天的签（同一天同一设备只会得到同一支）
 *
 * 为什么是"确定性"抽签：
 *  - 结果只由 (部署盐 + 日期 + 设备号) 决定，清 localStorage 也换不到别的签，
 *    "每人每天一次"因此是**抽不出第二支**，而不是靠前端按钮变灰；
 *  - 服务端同时落一条记录（data/fortune.jsonl），用来标"今日已求"、看统计，
 *    但即使记录丢了，签也不会变。
 *
 * 黄历部分按公历日期推算：干支年（近似立春 2/4）、干支月（近似节气）、
 * 干支日（1949-10-01 甲子日为锚点，精确）、建除十二神、冲煞、五行。
 * 农历用 Intl 的 chinese 日历，拿不到就省略那一行。
 * 这是给山寺用的"日课"，不作吉凶断语。
 */

import path from 'node:path';
import {
  dataDirOf,
  ensureSalt,
  hashToken,
  sanitize,
  dayKey,
  isWritable,
  readBody,
  clientIp,
  json,
  minuteLimiter,
  appendJsonl,
  readJsonl,
} from './store.mjs';

const MAX_BODY = 512;
const PER_MIN = 30;
/** 同一网络每天最多几支不同的签（防清 localStorage 刷签；一家人的量够用） */
const IP_DAILY = Number(process.env.FORTUNE_IP_DAILY || 8);

// ————————————————————————————— 干支 / 建除

const GAN = '甲乙丙丁戊己庚辛壬癸';
const ZHI = '子丑寅卯辰巳午未申酉戌亥';
const ZODIAC = '鼠牛虎兔龙蛇马羊猴鸡狗猪';
const JIANCHU = ['建', '除', '满', '平', '定', '执', '破', '危', '成', '收', '开', '闭'];
const ELEMENT = ['木', '火', '土', '金', '水'];

/** 1949-10-01 是甲子日（公历日序的锚点） */
const DAY_ANCHOR = Date.UTC(1949, 9, 1);

/** 十二"节"的近似日期：[月, 日, 月支] —— 误差一般在一天内，够做日课用 */
const TERMS = [
  [1, 6, 1],
  [2, 4, 2],
  [3, 6, 3],
  [4, 5, 4],
  [5, 6, 5],
  [6, 6, 6],
  [7, 7, 7],
  [8, 8, 8],
  [9, 8, 9],
  [10, 8, 10],
  [11, 7, 11],
  [12, 7, 0],
];

/** 建除十二神的宜 / 忌（山寺口径：宜静、宜做小事，忌争忌险） */
const JIANCHU_RULES = {
  建: { yi: ['上香', '见人', '修整', '出行'], ji: ['动土', '争讼'] },
  除: { yi: ['沐浴', '清扫', '理旧物', '求医'], ji: ['远行', '熬夜'] },
  满: { yi: ['礼佛', '供花', '修屋', '聚会'], ji: ['服药', '口角'] },
  平: { yi: ['修路', '补墙', '平常事', '写信'], ji: ['动土', '迁居'] },
  定: { yi: ['静坐', '定约', '安床', '读书'], ji: ['诉讼', '远行'] },
  执: { yi: ['守成', '修补', '收心', '缝补'], ji: ['开市', '搬迁'] },
  破: { yi: ['破旧', '求医', '解结', '断舍离'], ji: ['嫁娶', '签约'] },
  危: { yi: ['安床', '静养', '沐浴', '早睡'], ji: ['登高', '行船'] },
  成: { yi: ['上香', '礼佛', '结缘', '开工'], ji: ['争讼', '伐木'] },
  收: { yi: ['收纳', '入库', '结账', '还物'], ji: ['出行', '开仓'] },
  开: { yi: ['祈福', '开市', '出行', '见人'], ji: ['动土', '久坐'] },
  闭: { yi: ['静养', '修坟', '闭门', '补漏'], ji: ['开市', '远行'] },
};

const LUNAR_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function lunarDayName(n) {
  if (n <= 0) return '';
  if (n <= 10) return `初${LUNAR_DIGITS[n]}`;
  if (n < 20) return `十${LUNAR_DIGITS[n - 10]}`;
  if (n === 20) return '二十';
  if (n < 30) return `廿${LUNAR_DIGITS[n - 20]}`;
  return '三十';
}

/** 取"东八区日历上的那一天"的农历；拿不到返回 null */
function lunarOf(dayStr) {
  try {
    const noon = Date.parse(`${dayStr}T12:00:00Z`);
    const fmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      month: 'long',
      day: 'numeric',
    });
    const parts = fmt.formatToParts(new Date(noon));
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const dayNum = Number(parts.find((p) => p.type === 'day')?.value);
    if (!month || !Number.isFinite(dayNum)) return null;
    return { month, day: lunarDayName(dayNum) };
  } catch {
    return null;
  }
}

/** 从若干项里按 seed 轮换挑 count 项，保证每天/每台设备看起来不完全一样 */
function rotate(list, seed, count) {
  if (list.length <= count) return [...list];
  const start = seed % list.length;
  const out = [];
  for (let i = 0; i < count; i++) out.push(list[(start + i) % list.length]);
  return out;
}

export function almanacOf(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const utc = Date.parse(`${dayStr}T00:00:00Z`);

  const dayIdx = (((Math.round((utc - DAY_ANCHOR) / 86_400_000) % 60) + 60) % 60);
  const dayGan = dayIdx % 10;
  const dayZhi = dayIdx % 12;

  // 干支年以立春为界（近似 2/4）
  const ganzhiYear = m < 2 || (m === 2 && d < 4) ? y - 1 : y;
  const yearIdx = (((ganzhiYear - 4) % 60) + 60) % 60;
  const yearStem = yearIdx % 10;
  const yearBranch = yearIdx % 12;

  // 月支：找最近一个已经过的"节"
  let monthBranch = 0;
  for (const [tm, td, branch] of TERMS) {
    if (m > tm || (m === tm && d >= td)) monthBranch = branch;
  }
  // 1 月 1–5 日还没到小寒，仍属上一年的大雪（子月），干支年也已回退，正好对上
  const step = (monthBranch - 2 + 12) % 12;
  const monthStem = ((yearStem % 5) * 2 + 2 + step) % 10;

  const jianchu = JIANCHU[(dayZhi - monthBranch + 12) % 12];
  const rules = JIANCHU_RULES[jianchu];
  const seed = Math.floor(utc / 86_400_000);

  const chongBranch = (dayZhi + 6) % 12;
  const sha = ['南', '东', '北', '西'][dayZhi % 4];
  const lunar = lunarOf(dayStr);

  return {
    date: dayStr,
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(new Date(utc + 12 * 3600_000)),
    lunar: lunar ? `${lunar.month}${lunar.day}` : '',
    ganzhi: {
      year: `${GAN[yearStem]}${ZHI[yearBranch]}`,
      month: `${GAN[monthStem]}${ZHI[monthBranch]}`,
      day: `${GAN[dayGan]}${ZHI[dayZhi]}`,
    },
    jianchu: `${jianchu}日`,
    element: ELEMENT[Math.floor(dayGan / 2)],
    yi: rotate(rules.yi, seed, 3),
    ji: rotate(rules.ji, seed + 1, 2),
    chong: ZODIAC[chongBranch],
    sha,
    // 给前端做小标题用，不落盘
    lunarYear: lunar ? `${GAN[yearStem]}${ZHI[yearBranch]}年` : '',
  };
}

// ————————————————————————————— 二十四签

/**
 * 二十四支签：上上 2、上 6、中上 5、中 7、中下 4。
 * 偈语是七言四句，解签只作自省，不写"必发财""必有灾"这类断语。
 */
export const LOTS = [
  {
    no: 1, grade: '上上', title: '云开见月', tag: '澄明',
    verse: ['云散长空月自明', '不劳心力问前程', '山门夜半无人锁', '一阵松风自送行'],
    read: '云本来就散着，是你一直低头看水。心里那点明白不用向外求，事情到该清楚的时候自然清楚。今天不必追问结果，把手边的事做干净就好。',
    today: '先做完一件小事，再决定下一步。',
  },
  {
    no: 2, grade: '上上', title: '古井无波', tag: '静照',
    verse: ['古井无波照碧天', '石床苔冷不知年', '有人来问西来意', '只指庭前柏树边'],
    read: '井水不动，才照得见天。念头少一点，答案自己会浮上来。若有人来问东问西，不必急着答，指给他看眼前那棵树。',
    today: '少说一句，多看一会儿。',
  },
  {
    no: 3, grade: '上', title: '松风入袖', tag: '轻装',
    verse: ['松风入袖不知寒', '一路青山送到门', '行李本来无别物', '半肩明月半肩云'],
    read: '你以为带了很多东西，其实肩上只有月和云。该放下的放下，路自然轻。今天换换环境、走走远路都相宜。',
    today: '出门时少带一件东西试试。',
  },
  {
    no: 4, grade: '上', title: '钟声出谷', tag: '回声',
    verse: ['钟声一扣出深谷', '惊起寒鸦两三只', '声落空山人不见', '溪云自去自来时'],
    read: '一句话、一个动作，回声比你想象得传得远。今天做的事会在别处有回响，宁可慢半拍，也要说清楚。',
    today: '开口之前，先在心里念一遍。',
  },
  {
    no: 5, grade: '上', title: '灯下添香', tag: '守心',
    verse: ['一盏残灯夜未央', '添香不为何人忙', '炉中灰冷心还热', '明日开门又是光'],
    read: '你做的事未必有人看见，但香是自己点的。守着这点热气，比等一句夸奖要紧。',
    today: '给一件没人看见的小事收个好尾。',
  },
  {
    no: 6, grade: '上', title: '石上清泉', tag: '活水',
    verse: ['石上清泉流不住', '一勺入口冷如冰', '问渠那得清如许', '为有源头活水声'],
    read: '清不是没有波澜，是底下一直有活水。今天容易想通一件事，趁这股清劲儿把它记下来。',
    today: '想到什么就写下来，别等。',
  },
  {
    no: 7, grade: '上', title: '竹影扫阶', tag: '无事',
    verse: ['竹影扫阶尘不动', '月光穿户夜无声', '多年旧事忽然到', '只是风来不是人'],
    read: '忽然想起的旧事，多半只是风。不必追、不必怕，让它扫过台阶就好。',
    today: '旧事翻上来时，先不接话。',
  },
  {
    no: 8, grade: '上', title: '一苇渡江', tag: '渡',
    verse: ['一苇横江不是船', '西风送我过前滩', '回头只说寻常事', '水面无痕月在天'],
    read: '别人看你过得轻巧，只有你知道那根苇子有多细。过去了就别反复讲，讲多了倒像没过去。',
    today: '帮别人一把，不用说出口。',
  },
  {
    no: 9, grade: '中上', title: '门前扫叶', tag: '停手',
    verse: ['门前落叶扫还满', '扫到无叶已深秋', '且把竹帚靠墙立', '一庭明月替你收'],
    read: '有些事扫不干净，也不是你不够勤快。做到这儿就可以停手，剩下的交给月亮。',
    today: '有一件事，今天可以到此为止。',
  },
  {
    no: 10, grade: '中上', title: '雨过苔生', tag: '慢行',
    verse: ['雨过苔生石径滑', '小心脚下莫贪快', '山花不为人开落', '开也由它落也由它'],
    read: '湿滑的时候慢一步就是修行。别人开得好不好，与你无关，你看路。',
    today: '走稳，不抢一步。',
  },
  {
    no: 11, grade: '中上', title: '半山望云', tag: '中途',
    verse: ['半山亭子无人到', '独自看云到日斜', '下山时节云还在', '回头一笑便归家'],
    read: '站在半山最好，看得远，也还没累。今天适合停一停，别把行程排满。',
    today: '留半小时什么都不做。',
  },
  {
    no: 12, grade: '中上', title: '檐铃自语', tag: '随响',
    verse: ['檐铃自语风来答', '一响一停皆偶然', '若问此中何所似', '道人打坐不参禅'],
    read: '事情有点响动，多半是风，不必解释成吉凶。你坐着别动，它自己会停。',
    today: '不急着回应突然的消息。',
  },
  {
    no: 13, grade: '中上', title: '移舟就岸', tag: '靠岸',
    verse: ['移舟就岸不须篙', '水浅沙平路不遥', '岸上有人招手久', '只缘你未肯抬篙'],
    read: '门其实就在旁边，是你一直在划。今天容易遇上愿意搭把手的人，别客气。',
    today: '有人递手就接着。',
  },
  {
    no: 14, grade: '中', title: '且坐吃茶', tag: '喝茶',
    verse: ['且坐吃茶莫问禅', '茶凉茶热总由天', '一口吞时千般了', '半杯剩处也安然'],
    read: '不必把每件事都想明白。喝一口，放半杯，都是过日子。',
    today: '好好吃一顿饭。',
  },
  {
    no: 15, grade: '中', title: '旧路重行', tag: '重逢',
    verse: ['旧路重行草已深', '去年脚印半成尘', '忽逢故人桥头立', '一句寒暄抵万金'],
    read: '回到老地方，人不一定还在，路也变了。遇见故人，说句话就好，不必把往事翻一遍。',
    today: '给久没联系的人发一句话。',
  },
  {
    no: 16, grade: '中', title: '灯影摇曳', tag: '影',
    verse: ['灯影摇曳墙上舞', '细看原来是风过', '心随影动多少年', '今夜才知影是客'],
    read: '你追的东西一直在动，追它自然累。知道它是客，就不必留。',
    today: '想买的东西，先放一天。',
  },
  {
    no: 17, grade: '中', title: '渡口待舟', tag: '等',
    verse: ['渡口待舟舟未至', '江风渐冷雨还来', '旁人劝我归家去', '我说水声最好听'],
    read: '等待本身也是风景。事情没成之前，别急着找替代品。',
    today: '该等的，再等一会儿。',
  },
  {
    no: 18, grade: '中', title: '风来幡动', tag: '不争',
    verse: ['风来幡动满庭喧', '一个低头一个言', '试问风幡谁在动', '低头才见是心先'],
    read: '争论起来的时候两边都对，只是都在讲自己。今天少站一边，先听完。',
    today: '听人把话说完。',
  },
  {
    no: 19, grade: '中', title: '潭底看星', tag: '照见',
    verse: ['潭底看星星更明', '仰头才见月轮生', '低处不妨多停久', '照见从前未照心'],
    read: '低头的时候看得更细。今天遇上的小麻烦，正好照见平时没注意的地方。',
    today: '把一件小麻烦弄清楚。',
  },
  {
    no: 20, grade: '中', title: '山高月小', tag: '云起',
    verse: ['山高月小夜初凉', '行到水穷莫商量', '坐看云起云还散', '回身即是旧禅房'],
    read: '走到没路的地方，就坐下。路不会凭空出来，但坐着坐着就看清了。',
    today: '卡住时先离开桌子一会儿。',
  },
  {
    no: 21, grade: '中下', title: '雾锁山门', tag: '雾中',
    verse: ['雾锁山门看不见', '一声钟响知寺在', '不必怨雾不散', '雾里听声也是路'],
    read: '看不清的时候，靠声音走。别急着否定自己，也别硬闯。',
    today: '不确定的事，先问一句。',
  },
  {
    no: 22, grade: '中下', title: '石滑苔深', tag: '稳',
    verse: ['石滑苔深行步难', '一手扶壁一沉吟', '前头未必无好景', '此刻先要站稳身'],
    read: '今天不宜冒险。稳住脚下比看见风景要紧，退一步不算输。',
    today: '谨慎一点，别抄近路。',
  },
  {
    no: 23, grade: '中下', title: '逆水撑篙', tag: '松手',
    verse: ['逆水撑篙篙更沉', '汗滴江水不见功', '若肯落帆随水去', '明朝顺路又相逢'],
    read: '硬顶会越来越沉。今天可以试着松一点，换一个做法，不是放弃。',
    today: '换一种方式做同一件事。',
  },
  {
    no: 24, grade: '中下', title: '灯尽更寒', tag: '早眠',
    verse: ['灯尽更寒夜正长', '衾薄才知谁在旁', '莫恨此宵无月色', '晨钟一响又天光'],
    read: '难的时候才看清身边的人。今晚早点睡，明早的钟会照常响。',
    today: '早点休息，别在深夜做决定。',
  },
];

/** 各等级的出现比例（合计 100）；同一等级内再按种子挑一支 */
const GRADES = [
  { key: '上上', weight: 8 },
  { key: '上', weight: 22 },
  { key: '中上', weight: 30 },
  { key: '中', weight: 30 },
  { key: '中下', weight: 10 },
];

export function drawLot(seedBuf) {
  const pct = (((seedBuf[0] << 8) | seedBuf[1]) / 0x10000) * 100;
  let acc = 0;
  let grade = GRADES[GRADES.length - 1].key;
  for (const g of GRADES) {
    acc += g.weight;
    if (pct < acc) {
      grade = g.key;
      break;
    }
  }
  const pool = LOTS.filter((l) => l.grade === grade);
  const i = ((seedBuf[2] << 8) | seedBuf[3]) % pool.length;
  return pool[i];
}

// ————————————————————————————— 主体

export function createFortuneBox(opts) {
  const { root, trustProxy = false, log = () => {} } = opts || {};
  const dataDir = dataDirOf(root);
  const file = path.join(dataDir, 'fortune.jsonl');
  const salt = ensureSalt(dataDir, log);
  const writable = isWritable(dataDir);

  let today = dayKey();
  /** 今天已经求过签的设备（device hash） → 记录 */
  const drawn = new Map();
  /** 今天这个网络抽走几支不同的签（ip hash → 次数） */
  const ipDraws = new Map();

  const limit = minuteLimiter(PER_MIN);

  function rollDay() {
    const d = dayKey();
    if (d === today) return;
    today = d;
    drawn.clear();
    ipDraws.clear();
    // 顺手把当天的记录补进来（跨零点后的第一条请求）
    hydrate();
  }

  function hydrate() {
    for (const r of readJsonl(file)) {
      if (r.day !== today) continue;
      if (typeof r.id === 'string') {
        drawn.set(r.id, r);
        if (typeof r.ip === 'string') ipDraws.set(r.ip, (ipDraws.get(r.ip) || 0) + 1);
      }
    }
  }

  try {
    hydrate();
  } catch {
    /* 读不出来就当今天没人求过 */
  }

  async function postFortune(req, res) {
    const ip = clientIp(req, trustProxy);
    if (limit(ip)) return json(res, 429, { ok: false, code: 'slow' });

    const ctype = String(req.headers['content-type'] || '');
    if (!/^application\/json\b/i.test(ctype)) {
      return json(res, 415, { ok: false, code: 'ctype' });
    }
    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
      return json(res, 403, { ok: false, code: 'origin' });
    }

    let body;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY));
    } catch (e) {
      if (e.status === 413) {
        json(res, 413, { ok: false, code: 'too_long' }, { Connection: 'close' });
        res.on('finish', () => req.destroy());
        return;
      }
      return json(res, 400, { ok: false, code: 'bad' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(res, 400, { ok: false, code: 'bad' });
    }

    const device = sanitize(body.device, 64);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(device)) {
      return json(res, 400, { ok: false, code: 'device' });
    }

    rollDay();

    const day = today;
    const seed = hashToken(salt, 'fortune', `${day}|${device}`);
    const seedBuf = Buffer.from(seed.slice(0, 16), 'hex');
    const lot = drawLot(seedBuf);
    const devHash = hashToken(salt, 'device', device);

    const ipHash = hashToken(salt, 'ip', ip);

    let first = false;
    let drawnAt = 0;
    const prev = drawn.get(devHash);
    if (prev) {
      drawnAt = Number(prev.t) || 0;
    } else {
      if ((ipDraws.get(ipHash) || 0) >= IP_DAILY) {
        // 同一个网络今天已经出了足够多支签：不再给新签，避免靠换设备号重抽
        return json(res, 429, { ok: false, code: 'network' });
      }
      first = true;
      drawnAt = Date.now();
      // 落一条记录：只为"今日已求"和统计，签本身由种子决定，不依赖这条
      if (writable) {
        try {
          appendJsonl(file, {
            t: drawnAt,
            day,
            id: devHash,
            ip: ipHash,
            no: lot.no,
            grade: lot.grade,
          });
        } catch (e) {
          log(`[fortune] 写入失败：${e.message}`);
        }
      }
      drawn.set(devHash, { t: drawnAt, day, no: lot.no, grade: lot.grade });
      ipDraws.set(ipHash, (ipDraws.get(ipHash) || 0) + 1);
      log(`[fortune] +1（今日 ${drawn.size} 人求签）`);
    }

    return json(res, 200, {
      ok: true,
      first,
      drawnAt,
      almanac: almanacOf(day),
      lot: {
        no: lot.no,
        grade: lot.grade,
        title: lot.title,
        tag: lot.tag,
        verse: lot.verse,
        read: lot.read,
        today: lot.today,
      },
    });
  }

  function handle(req, res) {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname !== '/api/fortune') return false;
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, code: 'method' }, { Allow: 'POST' });
      return true;
    }
    void postFortune(req, res).catch((e) => {
      log(`[fortune] 处理失败：${e.message}`);
      if (!res.headersSent) json(res, 500, { ok: false, code: 'bad' });
    });
    return true;
  }

  return {
    handle,
    file,
    writable,
    dataDir,
    stats: () => ({ day: today, drawn: drawn.size, ips: ipDraws.size }),
  };
}
