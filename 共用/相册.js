/* 相册 —— 点相机（那台千禧年银色小数码 CCD）打开的窗口。
 *
 * 归属：UI 窗口。主窗口只负责「点相机 → 调 openGallery()」，弹窗长什么样归这里。
 *
 * ===========================================================================
 * 两层：主页（一个地方 = 一本相册）→ 单张
 *
 *   ① 主页  **一个地方一件东西**，不是把所有照片摊成一面墙。
 *           一度做成「所有照片按时间排成一片相册墙」，被否了 —— 那是 Apple 相册，
 *           它把「一次拍摄 = 一个地方」这个结构碾平了。照片是按**去过哪儿**记住的。
 *
 *           三种做法，footer 上当场切（HOME 常量是出厂默认）：
 *             film   一卷 35mm 胶片，齿孔 + 橙色边字
 *             stack  一叠照片随手摞在那儿（**出厂**），排布和叠法各自还能再切
 *             cover  一个地方一张代表照，最安静
 *
 *   ② 单张  点进去一张张翻。
 *           ⚠️ **← → 只在同一本相册里循环**，翻到头接回这本的第一张，
 *           **不会自己跳到下一个地方** —— 想换地方必须退回主页挑。
 *           理由：一本相册是一次旅行，翻着翻着突然到了另一个国家是很怪的；
 *           而且「回主页选下一个」这一下正好让人再看一眼自己去过哪儿。
 *           F 全屏，Esc 回主页。翻页动画六选一，见 TURNS。
 *
 * ===========================================================================
 * Iris 定的规矩，改之前先读
 *
 * ① **照片上面什么都不许压**（08-26 / 08-27）。
 *    没有扫描线、没有栅格、没有盖片反光、没有模糊，**也没有日期戳**
 *    （那枚橙色的已经去掉了 —— 发光的字压在照片上，第一眼看到的永远是它）。
 *
 * ② **窗口尺寸固定，而且尽量大**（08-26）。
 *    让窗口跟着每张照片变形试过，翻一张跳一下，被否。现在按视口算一次，
 *    照片 contain 居中。**多出来的地方是玻璃，不是黑边** ——
 *    竖片两边露的是沙滩。那块区域**绝对不能给背景色**。
 *
 * ③ **要能全屏**。F / 点照片进全屏：近黑底、照片顶到边、chrome 2.6 秒淡掉。
 *    为此导入脚本长边是 2400，而且网页上**永远不放大**（k ≤ 1）。
 *
 * ④ **照片下面只有地点和时间**（08-27）。机身/镜头/光圈/像素那一行全删了。
 *    地点前面那个定位符号是自己画的（pin()），不用 📍。
 *
 * ===========================================================================
 * 数据：内容/相册/photos.json，由 UI实验室/导入照片.py 生成
 *
 *   { "albums": [ {
 *       "id", "city", "place", "date",          // city 给主页，place 是全名，date 形如 2025年11月
 *       "photos": [ { "src","thumb","w","h","place","t","caption",
 *                     "type":"video", "poster" } ]     // type/poster 只有视频才有
 *     } ] }
 *
 *   **地名分两层**：主页那一叠上只写 `city`（城市 / Hawaii 这一级），
 *   单张视图里写这一张自己的 `place`（`鸭川·京都` 这种，带具体地名）。
 *   小文件夹只影响 place，**不会变成另一本相册**。
 *
 *   **数组的顺序就是展示顺序**，可以直接在 json 里拖动条目改；
 *   重跑导入脚本不会打乱已排好的（除非加 --reorder）。
 *   w/h 是必须的：主页要在图下载完之前就按比例排好版。
 *
 * ===========================================================================
 * 整理模式（临时）
 *
 * 主页上每格右上角一个 ×，点一下淘汰、再点恢复；单张里按 D 也行。
 * 淘汰**不删文件**，只记 localStorage。挑完「复制保留清单」→ 盖掉 照片/清单.json
 * → 跑 `导入照片.py --prune` 清掉没用上的生成文件。定稿后把 CURATE 改成 false。
 */
import { ui, h, registerOption, DEV } from './ui.js';

const ROOT = new URL('../', import.meta.url);
const DATA = new URL('照片/清单.json', ROOT);
const LS_REJECT = 'y2k-photo-rejects';
/* 整理模式跟着 DEV 走（ui.js 第 4.8 节：localhost / ?dev=1 / localStorage y2k-dev=1）。
 * ⚠️ 原来是一个「定稿后改成 false」的常量 —— 那种常量的结局一定是忘了改，
 * 然后访客在线上看到「淘汰 / 复制保留清单」。跟着 DEV 走的话**部署出去自动就是关的**，
 * 而 Iris 在自己电脑上照旧能整理。 */
const CURATE = DEV;

/* 窗口尺寸：能多大多大，但留一点边让沙滩透出来 —— 它还是浮在那个世界上的一块玻璃。
 * 上限是给 27 寸屏定的，再大照片也不会更清楚（长边 2400）。 */
/* ⚠️ **主页和翻开之后是两个尺寸。**（Iris 09-01：「照片可以大，但摄影集那个窗口太大了」）
 *
 * 翻开之后窗口是**脱掉**的（is-bare）—— 看到的只有照片本身，所以越大越好，
 * 上限只受原图分辨率限制：照片长边 2400，而这是 CSS 像素，
 * 2 倍屏上 1600 CSS px 就要 3200 设备像素了，再大只能靠放大补，照片会发软。
 * 真要更大得先把 导入照片.py 的长边调上去重跑一遍。
 *
 * 主页那一层看到的是**一块玻璃面板**，不是照片。面板铺满整个屏幕就成了一个
 * 全屏的相册 app，而它本该是「放在那片沙滩上的一样东西」—— 得看得见它压在沙滩上。
 * 所以主页给一个明显更小的上限，七叠照片正好排三列。 */
const WIN_MAX = {
  home: { w: 1060, h: 860 },     // 主页：一块压在沙滩上的板子（三列 × 三行正好放得下）
  one:  { w: 1600, h: 1000 },    // 翻开：能多大多大，只剩照片
};

/* 主页已定稿（Iris 08-31）：**叠放 + 网格 + 裸叠**，不再是选项。
 * 「胶片 / 封面」两种主页、「一行一个」排布、「景深·向右」叠法都已删干净 ——
 * 留着没被选中的分支只会让下一个读这个文件的人以为它们还在候选里。 */
const LS_TURN = 'y2k-photo-turn';
const PILE_N = 4;                  // 一叠里露几张

/* 翻页动画。
 * ⚠️ 关键在于**两层图**：舞台里有两个 <img>，旧的那张不马上撤，新的压在上面。
 * 只有一层的时候「淡入」中间必然穿帮 —— 旧图一撤、新图还没不透明，
 * 那一瞬间露出的是玻璃和沙滩，看着是「闪一下」而不是「化过去」。
 * 直切 / 推移 / 走片已按 Iris 的意见淘汰。 */
/* 只剩两档（Iris 08-27 三次筛完）：
 *   叠化 —— 旧的原地不动，新的在它上面透出来。最没有痕迹
 *   翻书 —— 捏住右页绕**中间的书脊**翻过去，背面就是下一跨页的左半
 * 淡入删了：它中间必然露出沙滩背景，那是它的定义不是参数没调好。
 * 直切 / 推移 / 走片 / 翻页 / 缩放 / 横扫 / 闪白都已淘汰。 */
/* ⚠️ 翻页时长写在两个地方，必须一致：
 * 这里（兜底定时器用）和 ui.css 的 `--y2k-flip-t`（动画本身用）。
 * 08-31 从 760 调到 600 —— Iris：「翻页速度再稍微调快一点点」。
 * 再快就会盖过那条 acos 时间曲线（新的一页出现得太突然），别往 500 以下调。 */
const FLIP_MS = 600;

const TURNS = {
  dissolve: { label: '叠化' },
  book:     { label: '翻书' },
};
const TURNS_L = Object.fromEntries(Object.entries(TURNS).map(([k, v]) => [k, v.label]));

/* 「单张」那一档已删（Iris 08-27）：书本身就是单张的超集 ——
 * 一张横图就是一整个跨页，只有相邻的两张竖图才会并排。 */

const abs = p => new URL(p, ROOT).href;
const isVid = p => p && p.type === 'video';

/* ⚠️ **主页只准加载 thumb。**
 * 全部缩略图加起来 5.2MB，而单张 src 一张就 0.7MB —— 主页要是碰了 src，
 * 一进相册就是几十兆。`src` 只有翻到那一页 / 进全屏时才允许出现。
 * 没有 thumb 的条目宁可不显示图，也不要偷偷退回 src 把网卡打满。 */
function thumbOf(p) {
  if (p.thumb) return abs(p.thumb);
  console.warn('[相册] 这条没有 thumb，主页不给它加载大图：', p.src);
  return '';
}

/* 从 localStorage 取一个「几选一」的值。
 * ⚠️ 一定要验一下它还在不在选项里：这些选项是会被删的（推移、走片就删掉了），
 * 而浏览器里还存着旧值 —— 存了个已经不存在的档，界面会静默地什么都不做，
 * 表现是「怎么点都没动画」，而且清缓存之前一直好不了。 */
function pick(key, options, fallback) {
  let v = null;
  try { v = localStorage.getItem(key); } catch { /* 无痕模式 */ }
  return (v && Object.prototype.hasOwnProperty.call(options, v)) ? v : fallback;
}

/* 一个小分段控件。这几组选择是**要 Iris 自己拿主意**的，所以做成看得见的按钮
 * 而不是隐藏快捷键 —— 藏起来的开关等于不存在。定下来之后连同调用一起删。 */
function seg(tag, keys, labels, get, set) {
  const btns = keys.map(k => h('button.y2k-seg__b', {
    type: 'button', onclick: () => { set(k); api.sync(); },
  }, labels[k]));
  const el = h('div.y2k-seg__wrap', h('span.y2k-seg__tag', tag), h('div.y2k-seg', btns));
  const api = { el, sync() { btns.forEach((b, i) => b.classList.toggle('is-on', keys[i] === get())); } };
  api.sync();
  return api;
}

/* 自己画的定位符号：倒水滴，中间一个实心点。
 * 不用 📍 —— emoji 走的是系统字体，颜色、粗细、基线全都不受控（macOS 上还是彩色的），
 * 压在一行等宽小字里永远差半拍。自己画的这个跟着 currentColor 和字号走。 */
function pin() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 15');
  svg.setAttribute('class', 'y2k-pin');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d',
    'M6 1.15c-2.6 0-4.72 2.11-4.72 4.72 0 3.5 4.72 8.05 4.72 8.05s4.72-4.55 4.72-8.05'
    + 'c0-2.61-2.12-4.72-4.72-4.72z');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linejoin', 'round');
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', '6'); dot.setAttribute('cy', '5.75'); dot.setAttribute('r', '1.45');
  dot.setAttribute('fill', 'currentColor');
  svg.append(path, dot);
  return svg;
}

/* --------------------------------------------------------------------------
 * 数据
 * ------------------------------------------------------------------------ */
/* 日期一律显示成 `2023年7月` —— 不显示具体哪一天。
 * 清单里三种写法都有：`2025年11月` `2024年1月11日` `2025.8.7`。 */
function normDate(s) {
  const m = String(s || '').match(/^\s*(\d{4})\s*[年.\-/]\s*(\d{1,2})/);
  return m ? `${m[1]}年${+m[2]}月` : (s || '');
}

/* 城市 = 地名里最后一个「·」后面那截（没有「·」就是整个）。主页上只写它。 */
const cityOf = place => String(place || '').split('·').pop().trim();

/* 小地名（spot）前面常带日期，去掉；它要是没带城市就补上「·城市」，
 * 这样单张视图里永远是「具体地名·城市」。 */
function spotPlace(spot, place) {
  const sp = String(spot || '').replace(/^\s*\d{4}\s*[年.\-/]\s*\d{1,2}\s*[月.\-/]?\s*\d{0,2}\s*日?\s*/, '').trim();
  if (!sp) return place;
  return sp.includes('·') ? sp : `${sp}·${cityOf(place)}`;
}

let _albums = null;

/* 数据：照片/清单.json —— **一条 = 一个小文件夹**（Hawaii 拆成了 4 条）。
 *
 * ⚠️ 但主页上**一个地方只能是一本相册**（Iris 定过：小文件夹只改地名显示，
 * 不分成两叠）。所以这里按 `place` 把它们合回去，`spot` 降级成每张照片自己的地名。
 *
 * ⚠️ **数组的顺序就是展示顺序**，一律照搬，前端不再排一遍 ——
 * 排两遍的结果是 Iris 在清单里手排过的顺序被冲掉。
 * 相册之间按日期新→旧，那是唯一允许前端定的顺序。 */
async function load() {
  if (_albums) return _albums;
  try {
    const r = await fetch(DATA, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const rows = (Array.isArray(j) ? j : (j.albums || j.rolls || []))
        .filter(a => a && a.photos && a.photos.length);

      const byPlace = new Map();
      for (const row of rows) {
        const place = row.place || row.title || '';
        if (!byPlace.has(place)) {
          byPlace.set(place, { id: place, place, city: cityOf(place),
                               date: normDate(row.date), photos: [] });
        }
        const a = byPlace.get(place);
        if (row.city) a.city = row.city;
        const where = spotPlace(row.spot, place);
        /* ⚠️ 照片自己写了 place 就用它自己的。
         * 「复制保留清单」导出的是**已经合并过**的格式（相册一层 + 每张照片自带小地名），
         * 把它贴回来的时候如果还照 row.spot 重算，Diamond Head·Hawaii 会被压成 Hawaii ——
         * 导出再导入一次地名就掉了一层。要能原样吃回自己吐出来的东西。 */
        for (const p of row.photos) a.photos.push({ ...p, place: p.place || where });
      }
      const list = [...byPlace.values()];

      /* 两本相册撞到同一个城市（苔寺·京都 / 鸭川·京都）时退回写全名，
       * 否则主页上会并排出现两个「京都」，看着像出了错。 */
      const seen = new Map();
      for (const a of list) seen.set(a.city, (seen.get(a.city) || 0) + 1);
      for (const a of list) if (seen.get(a.city) > 1) a.city = a.place;

      /* 相册之间新 → 旧。`2024年1月` 这种字符串补成 `2024-01` 再比。 */
      const key = a => {
        const m = a.date.match(/(\d{4})年(\d{1,2})月/);
        return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : '0000-00';
      };
      list.sort((x, y) => (key(x) < key(y) ? 1 : key(x) > key(y) ? -1 : 0));

      if (list.length) return (_albums = list);
    }
  } catch { /* 双击本地文件打开时 fetch 会被 CORS 拦掉，属于正常情况 */ }
  return (_albums = []);
}

function loadRejects() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_REJECT) || '[]')); }
  catch { return new Set(); }
}
function saveRejects(set) {
  try { localStorage.setItem(LS_REJECT, JSON.stringify([...set])); } catch { /* 无痕模式 */ }
}

/* --------------------------------------------------------------------------
 * 把相册的「几选一」注册进 ui 的设置面板（Shift+U）。
 *
 * 这些是**上线之后 Iris 还要在真场景里慢慢调**的东西，所以不能只藏在
 * 相册页脚那排按钮里 —— 页脚在书视图里是自动隐身的，主页上又不显示翻页那一组。
 * 面板是唯一入口；页脚那排是顺手改的快捷方式，两边读写同一个 localStorage。
 * 定稿之后把这一段和面板一起删。
 * ------------------------------------------------------------------------ */
let _sync = null;                 // 相册开着的时候，改完选项立刻重画

function opt(id, tag, key, options, fallback) {
  registerOption({
    id, tag,
    keys: Object.keys(options),
    labels: options,
    get: () => pick(key, options, fallback),
    set: v => {
      try { localStorage.setItem(key, v); } catch { /* 无痕模式 */ }
      if (_sync) _sync();
    },
  });
}
opt('photo-turn',   '翻页',     LS_TURN,   TURNS_L, 'book');

/* --------------------------------------------------------------------------
 * 窗口
 * ------------------------------------------------------------------------ */
let _win = null;

export function openGallery() {
  if (_win && !_win.closed) { _win.reopen(); return _win; }

  /* ⚠️ 不接 width / height。相册的尺寸按视口算（见 sizeWindow），
   * constitution.js 的 galW / galH 对它不起作用。 */
  const win = ui.window({
    title: '摄影集', sub: '',
    fixedHeight: true, keepAlive: true,
    closeOnEsc: false,        // Esc 整个由下面那个 keydown 接管，见那里的说明
  });
  _win = win;
  /* 遮罩默认留 4vmin 的边，对别的弹窗合适，但相册每一像素都想给照片。 */
  win.el.style.padding = '16px';

  /* ai = 第几本相册。**没有跨相册的流** —— ← → 只在这一本里循环，
   * 换地方必须退回主页。这一本里翻到第几页记在下面的 si 上。 */
  let albums = [], ai = 0;
  let view = 'home';                 // 'home' | 'one'
  let turn   = pick(LS_TURN,   TURNS,   'book');
  let curating = false;
  const rejects = loadRejects();

  /* ---- 单张 / 书 的舞台 ----
   *
   * 舞台里是**两张「纸」**轮流用（不是两张图）：旧的那张不马上撤、新的压在上面。
   * 一张纸上可以放一张照片（单张模式，或书里的横图），也可以并排放两张竖图
   * （书模式的一个跨页）。所以两种模式共用同一套翻页动画和同一条渲染路径。
   *
   * 只有一层的时候「淡入 / 叠化」中间必然穿帮 —— 旧的一撤、新的还没不透明，
   * 那一瞬间露出的是玻璃和沙滩，看着是「闪一下」而不是「化过去」。 */
  const sheets = [h('div.y2k-sheet'), h('div.y2k-sheet')];
  let live = 0;
  const video = h('video.y2k-cam__video', {
    controls: true, playsInline: true, preload: 'metadata',
    /* 点视频是要按播放键的，别把点击也当成「进全屏」 */
    onclick: e => e.stopPropagation(),
  });
  const flash = h('div.y2k-cam__flash');
  const stage = h('div.y2k-cam__stage', sheets[0], sheets[1], video, flash);

  const caption = h('p.y2k-cam__caption');
  const where   = h('p.y2k-cam__where');
  const feed    = h('div.y2k-cam__feed');
  /* 页码跟地名日期一样居中排在照片下面，不再蹲在页脚左边 */
  const count   = h('p.y2k-cam__count');
  const tally   = ui.note('');

  const turnSel = seg('翻页', Object.keys(TURNS),
    Object.fromEntries(Object.entries(TURNS).map(([k, v]) => [k, v.label])),
    () => turn, v => { turn = v; save(LS_TURN, v); turnSel.sync(); });
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 无痕模式 */ } };

  const prevBtn = ui.btn({ label: '‹', size: 'icon', title: '上一页 (←)', onClick: () => go(si - 1) });
  const nextBtn = ui.btn({ label: '›', size: 'icon', title: '下一页 (→)', onClick: () => go(si + 1) });
  const backBtn = ui.btn({ label: '← 回主页', title: '回主页 (Esc)', onClick: () => showHome(true) });
  const fullBtn = ui.btn({ label: '全屏', title: '全屏看 (F)', onClick: () => openFull() });
  const killBtn = ui.btn({ label: '淘汰', title: '淘汰这张 (D)', onClick: () => toggleReject() });
  const curBtn  = ui.btn({ label: '整理', title: '挑要留哪些', onClick: () => setCurating(!curating) });
  const copyBtn = ui.btn({ label: '复制保留清单', variant: 'primary', onClick: () => copyKeep() });

  const album = () => albums[ai];
  /* 不在整理模式时，被淘汰的直接不出现 —— 那就是访客看到的样子。 */
  const shots = a => a.photos.filter(p => curating || !rejects.has(p.src));
  const list  = () => (album() ? shots(album()) : []);

  /* ------------------------------------------------------------------
   * 尺寸：**固定**。开多大就是多大，翻页不动。
   * 只有视口变了才重算 —— 那时候跳是应该的，不跳才怪。
   * ------------------------------------------------------------------ */
  function sizeWindow() {
    const scrim = win.el;
    const cs = getComputedStyle(scrim);
    const w = scrim.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const hh = scrim.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const cap = WIN_MAX[view] || WIN_MAX.one;
    win.win.style.setProperty('--y2k-w', Math.min(cap.w, w) + 'px');
    win.win.style.setProperty('--y2k-h', Math.min(cap.h, hh) + 'px');
  }
  /* ⚠️ 用 ResizeObserver 盯遮罩，不要只在 open 的那一刻算一次。
   * 开窗那一帧视口不一定已经是最终尺寸（页面还在加载 / 窗口正在被拖动），
   * 算早了会得到一个几十像素高的窗口，而且之后再也不会自己纠正。 */
  new ResizeObserver(() => { sizeWindow(); if (view === 'home') buildHome(); }).observe(win.el);

  /* ------------------------------------------------------------------
   * 主页：一个地方 = 一本相册
   *
   * ⚠️ 不要再把所有照片摊平。照片是按**去过哪儿**记住的，摊平之后
   * 「一次拍摄 = 一个地方」这个结构就没了，剩下的是一个通用相册 app。
   *
   * 主页上只写**城市**（a.city）；具体地名（鸭川·京都）留到单张视图里写。
   * ------------------------------------------------------------------ */
  function killX(p) {
    if (!curating) return null;
    const dead = rejects.has(p.src);
    return h('button.y2k-cam__x', {
      type: 'button', title: dead ? '恢复' : '淘汰', 'aria-label': dead ? '恢复' : '淘汰',
      onclick: e => { e.stopPropagation(); toggleReject(p); },
    }, dead ? '↺' : '×');
  }

  /* 视频在缩略图上要有个标记，否则跟照片长得一模一样，点开才发现是视频 */
  const vidBadge = p => (isVid(p) ? h('span.y2k-cam__playmark', '▶') : null);

  function open(a, k) {
    ai = albums.indexOf(a);
    /* ⚠️ 换一本相册 = **重新打开**，不是「从上一本翻过来」。
     * 不清掉 shown 的话，翻书会拿上一本的最后一页当正面翻过去 ——
     * 看上去像两个地方被装订在同一本书里，很怪（Iris 08-31 报的）。
     * fresh 让这一次落页不放任何动画，直接就在那儿。 */
    shown = [];
    fresh = true;
    /* 从缩略图点进来时给的是「第几张照片」，要换算成「第几页」——
     * 书模式下两张竖图共一页，两个数不是一回事。 */
    si = 0;
    const P = pages();
    const target = list()[k || 0];
    const at = P.findIndex(pg => pg.includes(target));
    si = at < 0 ? 0 : at;
    showOne(); paint();
  }

  /* ---- 主页：一叠照片摞在那儿（定稿：网格 + 裸叠） ---- */
  const TILT = [-4.2, 3.4, -2.4, 4.6, -3.1, 2.2];
  function stackPile(a) {
    const n = PILE_N;
    const ps = shots(a).slice(0, n);
    const k = albums.indexOf(a);
    return h('button.y2k-pile.y2k-pile--bare', { type: 'button', onclick: () => open(a, 0) },
      /* 最上面那张要最后画（DOM 里在后面 = 压在上面），所以倒着铺。
       * --i 是「从上往下第几张」，位移旋转全交给 CSS 算；
       * --nmax 是常量不是实际张数，这样一行一个时几行地名能对齐。 */
      h('div.y2k-pile__deck', { style: { '--nmax': String(n) } },
        ps.slice().reverse().map((p, i) => {
          const depth = ps.length - 1 - i;
          return h('span.y2k-pile__card' + (rejects.has(p.src) ? '.is-dead' : ''), {
            style: {
              '--i': String(depth),
              '--tilt': TILT[(k + depth) % TILT.length] + 'deg',
              zIndex: String(10 - depth),
            },
          }, h('img', { src: thumbOf(p), alt: '', loading: 'lazy', decoding: 'async' }),
             depth === 0 ? vidBadge(p) : null);
        })),
      /* 主页上**只写城市和年月**，不写张数、不写具体地名。 */
      h('div.y2k-pile__label', h('b', a.city || a.id), h('span', a.date || '')),
    );
  }

  function buildHome() {
    const alive = albums.filter(a => shots(a).length);
    ui.fill(feed, h('div.y2k-cam__piles.is-grid', alive.map(stackPile)));
  }

  function showHome(keepPos) {
    view = 'home';
    sizeWindow();          // 两个视图两个上限，切过去要重新量
    win.win.classList.remove('is-bare', 'is-idle');
    clearTimeout(idleOne);
    video.pause();
    win.setTitle('摄影集', '');
    buildHome();
    win.setView(feed);
    win.setFooter(
      ui.spacer(),
      ...(curating ? [tally, copyBtn] : []),
      ...(CURATE ? [curBtn] : []),
    );
    updateTally();
    if (keepPos && album()) {
      /* 从单张退回来，滚到刚才那一本 —— 退出去发现自己在页顶是最烦人的 */
      const i = albums.filter(a => shots(a).length).indexOf(album());
      const el = feed.children[0] && feed.children[0].children[i];
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }

  /* ------------------------------------------------------------------
   * 单张 / 书
   *
   * **书模式**：一张纸 = 一个跨页。竖图两张并排（它们本来就各自浪费掉半个窗口），
   * 横图自己占满一整张纸 —— 所以**横图一点没变小**，竖图反而变大了一倍的利用率。
   * 这是「做成一本书」唯一不用拿清晰度去换的做法：不画装订线、不把横图切两半。
   *
   * 单张模式就是「每张纸只放一张」，所以两种模式共用同一条渲染路径。
   * ------------------------------------------------------------------ */
  const isPortrait = p => !isVid(p) && (p.h || 0) > (p.w || 0);

  /* 把这一本相册切成一张张「跨页」。
   * 书模式下相邻的两张竖图配成一对 —— 它们**正好是左右两面**。
   * 横图自己占满一整个跨页（横跨装订线），这是真相册里常见的通版，
   * 而且**横图一点没变小** —— 它本来就占满整个窗口。
   * 让横图只占半页的话，你大部分照片会缩水一半，那不是这个版式该付的代价。 */
  /* ⚠️ 竖图配对会**往后找**，不只看紧挨着的下一张。
   *
   * 原来只配「相邻」的两张竖图。可实际拍的时候横竖是穿插着的
   * （苔寺 19 张里 10 竖 9 横，几乎每张竖图旁边都是横图），
   * 结果一半竖图落单、各自占一个跨页 —— 一张竖图摊在整个跨页上，
   * 中间那条装订线正好从它身上穿过去，Iris 08-31：「竖着的照片没有合在一起」。
   *
   * 现在遇到一张落单的竖图就**往后把下一张竖图提上来**跟它配成一对。
   * 代价是照片的先后顺序会变（被提上来的那张早出现了几页），
   * 换来的是**所有竖图都是两两并排**，也就是这个版式本来的样子。
   * 横图之间的先后顺序一点没变，竖图之间的先后顺序也没变，
   * 变的只是「某张竖图从横图后面挪到了横图前面」。 */
  function pages() {
    const L = list(), used = new Array(L.length).fill(false), out = [];
    for (let i = 0; i < L.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      if (!isPortrait(L[i])) { out.push([L[i]]); continue; }
      let j = -1;
      for (let k = i + 1; k < L.length; k++) {
        if (!used[k] && isPortrait(L[k])) { j = k; break; }
      }
      if (j < 0) { out.push([L[i]]); continue; }   // 竖图是奇数张，最后那张只能单开
      used[j] = true;
      out.push([L[i], L[j]]);
    }
    return out;
  }
  let si = 0;                               // 第几个跨页
  const pageAt = n => pages()[(n + pages().length) % pages().length] || [];
  const page = () => pages()[si] || [];
  const cur = () => page()[0];              // 这一页上的头一张，给标题栏和说明用

  /* ⚠️ 竖图跨页**不留缝**（Iris 08-27）：横图那种通版本来就是从中间无缝穿过去的，
   * 竖图这边要是留一条缝，两种跨页就长得不像同一本书了。
   * 两张竖图直接对齐中轴贴在一起，那条接缝自己就是装订线。 */
  const GUT = 0;

  /* ⚠️ **一本书只有一个页高。**（Iris 2026-08-31 报的「翻书时有高度差」）
   *
   * 原来是每一页各自去撑满舞台：`k = min(每页宽/pw, H/ph, 1)`。
   * 只要照片的比例不完全一致，撑满的那一边就不一样 ——
   *   · 3:2 的横图（2400×1600）在高上顶到 H
   *   · 16:9 的那张雪山（2400×1350）先顶到宽，于是**矮了一截**
   *   · 5:3 的西湖（2400×1440）同理
   * 翻页时上下边缘忽高忽低，看着像页面在跳。真书不会这样：**纸是一样大的。**
   *
   * 所以先把整本书扫一遍，找出「最宽的那个跨页」（每页所有照片的宽高比之和），
   * 用它定出一个能让最宽那页也塞进 W 的页高，然后**所有照片都用这个高**。
   * 宽度跟着各自的比例走 —— 于是高度永远齐平，窄的照片左右留白多一点，
   * 这正是照片书里「按高对齐」的排法。
   *
   * 页高是**每本相册**算一次的，不是每页 —— 每页算的话就等于没改。 */
  /* ⚠️ **算页高的时候要把视频排除在外。**（09-01，Iris：「相册比刚刚小了很多」）
   * 第一版是拿全册最宽的那个跨页去定页高。Hawaii 里混着一条 16:9 的视频，
   * 于是**一条视频把整本 36 张照片全压矮了 16%**。
   * 一条视频不该定义一本照片集的开本。现在页高只看照片；
   * 视频（或者哪张异常宽的照片）在 boxes() 里单独缩到能塞进去为止，
   * 只有它自己那一页会矮一点，别的页照旧。 */
  function pageH(W, H) {
    let widest = 1, minNat = Infinity;
    for (const pg of pages()) {
      if (pg.some(isVid)) continue;
      let a = 0;
      for (const p of pg) { a += (p.w || 3) / (p.h || 2); minNat = Math.min(minNat, p.h || 2); }
      if (a > widest) widest = a;
    }
    if (!Number.isFinite(minNat)) minNat = Infinity;   // 整本都是视频
    /* 第三项 = **永远不放大**：页高不能超过这本相册里最矮那张的原始高度。 */
    return Math.min(H, (W - GUT) / widest, minNat);
  }

  /* 一张照片摆多大，**在 JS 里算**。
   * 不用 CSS 百分比：图的 max-height 要拿容器高度算，而容器高度又要等图量出来，
   * 循环依赖，Chrome 会直接放弃、让竖图把舞台顶穿。w/h 是现成的，算一下就完了。 */
  function boxes(items, W, H) {
    const sum = items.reduce((a, p) => a + (p.w || 3) / (p.h || 2), 0);
    /* 通常这一页就是全册那个页高；只有比「最宽的照片跨页」还宽的那种页
     * （视频、或者哪张特别宽的照片）才会被这里压到刚好塞得下。 */
    const ph = Math.min(pageH(W, H), (W - GUT) / sum);
    return items.map(p => ({ w: Math.round(ph * (p.w || 3) / (p.h || 2)), h: Math.round(ph) }));
  }

  /* 一张照片 = 一个 figure：图 + （整理模式下）右上角的 ×  + 淘汰的红斜纹。
   * 这些都装在 figure 里、尺寸也写死在 figure 上，所以永远严丝合缝地贴着照片。 */
  function figure(p, box, x, y) {
    return h('figure.y2k-figure' + (rejects.has(p.src) ? '.is-dead' : ''), {
      style: { width: box.w + 'px', height: box.h + 'px', left: x + 'px', top: y + 'px' },
      onclick: e => { e.stopPropagation(); openFull(list().indexOf(p)); },
      title: '点开全屏 (F)',
    },
      h('img', { alt: p.caption || p.place || '照片', decoding: 'async', src: abs(p.src) }),
      killX(p),
      h('div.y2k-cam__cross', h('span', '淘汰')),
    );
  }

  /* 把一个跨页画成一块**和舞台一样大**的画布：图都是绝对定位的。
   * 画成整块的好处是可以按中轴一刀切成左右两页 —— 翻书就靠这个。 */
  function spreadNode(items) {
    const W = stage.clientWidth, H = stage.clientHeight;
    const node = h('div.y2k-spread', { style: { width: W + 'px', height: H + 'px' } });
    if (!W || !H || !items.length) return node;
    const bx = boxes(items, W, H);
    if (items.length > 1) {
      /* 两张竖图：一张贴装订线左边，一张贴右边 —— 正好是左右两面 */
      node.append(
        figure(items[0], bx[0], (W - GUT) / 2 - bx[0].w, (H - bx[0].h) / 2),
        figure(items[1], bx[1], (W + GUT) / 2,           (H - bx[1].h) / 2),
      );
    } else {
      node.append(figure(items[0], bx[0], (W - bx[0].w) / 2, (H - bx[0].h) / 2));
    }
    return node;
  }

  /* 把一整块跨页裁成左半或右半。裁出来的东西自己是一页的大小，
   * 里面装着完整的跨页、往左推半个身位 —— 所以一张横跨装订线的通版
   * 会被切成对得上的两半，真书里也是这么切的。 */
  function half(spread, side) {
    const W = stage.clientWidth, H = stage.clientHeight;
    return h('div.y2k-half', { style: { width: (W / 2) + 'px', height: H + 'px' } },
      h('div.y2k-half__in', {
        style: { width: W + 'px', height: H + 'px',
                 transform: side === 'r' ? `translateX(${-W / 2}px)` : 'none' },
      }, spread));
  }

  function preload(n) {
    for (const k of [n + 1, n - 1]) {
      for (const p of pageAt(k)) if (!isVid(p)) new Image().src = abs(p.src);
    }
  }

  let dir = 'f';
  function go(n) {
    const P = pages();
    if (!P.length) return;
    /* ⚠️ **不循环**（Iris 08-27）。一本书翻到最后一页再翻就回到封面，
     * 这件事在实体书里不存在，在这儿也不合理 —— 到头就停住。
     * 换地方本来就要退回主页，所以「到头」这个信号是有用的，不是死路。 */
    const at = Math.max(0, Math.min(P.length - 1, n));
    if (at === si) { bump(n > si ? 'f' : 'b'); return; }
    dir = at > si ? 'f' : 'b';
    si = at;
    if (view === 'one') paint();
  }

  /* 到头了还在按：给一下很轻的回弹，告诉人「没有下一页了」，
   * 而不是毫无反应（毫无反应会让人以为是卡住了）。 */
  function bump(d) {
    stage.classList.remove('is-bump-f', 'is-bump-b');
    void stage.offsetWidth;
    stage.classList.add(d === 'f' ? 'is-bump-f' : 'is-bump-b');
  }

  /* ------------------------------------------------------------------
   * 进了相册就**把窗口脱掉**（Iris 08-27 的想法，试出来是对的）
   *
   * 玻璃窗口在主页上是对的 —— 那是「一块放在沙滩上的东西」。
   * 但翻开之后再套一个框，就变成「在一个软件里看照片」了；
   * 把标题栏、页脚底色、玻璃、落影全去掉，剩下的就只是**照片书浮在沙滩上**。
   *
   * 唯一的代价是没了框就没了「这里可以操作」的提示，所以：
   *   · 底下那排按钮还在，但**默认是隐身的**，鼠标一动才浮出来（跟全屏一个逻辑）
   *   · 键盘全程可用（← → 翻页 / F 全屏 / Esc 回主页），本来就是主要操作方式
   * 想彻底不要按钮，把 showOne 里 setFooter 那一段删掉就行，键盘照常。
   * ------------------------------------------------------------------ */
  let idleOne = 0;
  function wakeOne() {
    if (view !== 'one') return;
    win.win.classList.remove('is-idle');
    clearTimeout(idleOne);
    idleOne = setTimeout(() => { if (view === 'one') win.win.classList.add('is-idle'); }, 2800);
  }
  win.el.addEventListener('pointermove', wakeOne);

  function showOne() {
    view = 'one';
    sizeWindow();          // 同上：翻开之后要用大的那个上限
    win.win.classList.add('is-bare');
    wakeOne();
    win.setView(h('div.y2k-cam', stage, h('div.y2k-cam__meta', caption, where, count)));
    win.setFooter(
      backBtn, prevBtn, nextBtn,
      ui.spacer(),
      turnSel.el,
      ...(curating ? [killBtn] : []),
      fullBtn,
    );
  }

  /* 一个自增的号：翻得快的时候，先发出去的那张图可能后回来，
   * 回来时发现号过期了就丢掉，否则会把已经翻过去的画面又盖回来。 */
  let seq = 0;
  let flipping = null;
  /* 这一次落页不放动画（刚打开一本相册 / 刚换了一本）。 */
  let fresh = false;
  /* 现在**已经落在纸上**的那一页。
   * ⚠️ 不能用 page() 去拿「翻之前那一页」—— go() 是先改 si 再调 paint()，
   * 进到 paint() 的时候 page() 已经是新的那一页了。用它做翻书的正面，
   * 结果就是正反面同一张图，翻过去像什么都没发生。 */
  let shown = [];

  /* ------------------------------------------------------------------
   * 翻书
   *
   * ⚠️ **装订线是中轴，不是窗口的左边缘。**（之前做错过一次）
   * 真书翻页是这样的：你捏住右边那一页，绕着中间的书脊往左翻 ——
   *   · 这一页的**正面**是当前跨页的右半
   *   · 翻过去之后朝上的**背面**，就是下一个跨页的左半
   *   · 它掀起来之后，底下露出的是下一个跨页的右半
   *   · 左半在整个过程中一直不动，最后被翻过来的背面盖住
   * 所以底板是一块「拼接页」：左 = 当前的左半，右 = 下一页的右半。
   *
   * 往回翻就是同一段动画倒着放：底板左 = 上一页的左半、右 = 当前的右半，
   * 翻页的正面 = 上一页的右半、背面 = 当前的左半，角度从 -180° 转回 0°。
   * ------------------------------------------------------------------ */
  function flipTo(items, my) {
    const W = stage.clientWidth, H = stage.clientHeight;
    const prev = shown, next = items;
    /* 往前翻：捏住**当前**跨页的右页往左翻，背面是**下一**跨页的左页。
     * 往回翻是同一段动画倒着放，两页的角色正好对调。
     * 归纳成两句：
     *   P1 = 转到 0° 时露在**右边**的那一页（也提供一直不动的左半）
     *   P2 = 转到 -180° 时落在**左边**的那一页（也提供被慢慢露出来的右半） */
    const P1 = dir === 'f' ? prev : next;
    const P2 = dir === 'f' ? next : prev;

    const baseNode = h('div.y2k-flipbase', { style: { width: W + 'px', height: H + 'px' } },
      half(spreadNode(P1), 'l'),
      half(spreadNode(P2), 'r'));
    /* ⚠️ 这里原来还挂着两块 .y2k-flipshade（整页大小的渐变，模拟纸落在纸上的影）。
     * 删了 —— 这本相册是裸叠，页面上除了照片什么都没有，那块渐变就成了
     * 一个横跨半屏的深色矩形在跟着翻页明灭（Iris 08-31 报的「外面还有一个框」）。
     * 层次现在由转起来那一面的 brightness 打光 + 照片自己的 box-shadow 给。 */

    const sheet = h('div.y2k-flip', { style: { width: (W / 2) + 'px', height: H + 'px' } },
      h('div.y2k-flip__face.is-front', half(spreadNode(P1), 'r')),
      h('div.y2k-flip__face.is-back',  half(spreadNode(P2), 'l')));

    const layer = h('div.y2k-fliplayer', baseNode, sheet);
    stage.appendChild(layer);
    stage.classList.add('is-flipping');
    flipping = layer;

    sheet.style.animation = 'none'; void sheet.offsetWidth;
    sheet.style.animation = '';
    sheet.dataset.dir = dir;

    /* 被下一次翻页打断时要知道「这一次本来是要翻到哪一页」，见 paint() 里那段。 */
    layer._to = items;

    const done = () => {
      if (my !== seq) return;
      commit(items);
      layer.remove();
      stage.classList.remove('is-flipping');
      flipping = null;
    };
    sheet.addEventListener('animationend', done, { once: true });
    /* 页面在后台时浏览器既不推进动画也不派发它的事件 —— 补一个定时器兜底，
     * 否则那一层会一直盖在上面。比动画本身多留一点余量就够。 */
    setTimeout(done, FLIP_MS + 220);
  }

  /* 把这一页真正落到 sheets 上（翻书结束、或者叠化的时候用） */
  function commit(items) {
    const nx = sheets[1 - live], pv = sheets[live];
    ui.fill(nx, spreadNode(items));
    shown = items;
    live = 1 - live;
    nx.classList.add('is-in');  nx.classList.remove('is-out');
    pv.classList.add('is-out'); pv.classList.remove('is-in');
    return { nx, pv };
  }

  function paint() {
    const items = page(), a = album();
    if (!items.length) return;
    const p = items[0];
    const my = ++seq;

    /* ⚠️ 打断上一次翻页时，必须**先把它要翻到的那一页落下来**。
     * 原来只是 `flipping.remove()`，`shown` 还停在更早的那一页 ——
     * 于是连按右键时每一次都是「从第一页翻起」，看上去像同一个动画在重播，
     * 而 si 其实一路往后跑了（Iris 08-31：「以为还没翻过去，发现已经到最后一张」）。
     * 落下来之后，这一次的正面就是上一次的背面，连着按就是一页接一页地翻。 */
    if (flipping) {
      if (flipping._to) commit(flipping._to);
      flipping.remove(); flipping = null;
      stage.classList.remove('is-flipping');
    }

    const vid = isVid(p);
    stage.classList.toggle('is-video', vid);

    if (vid) {
      /* 视频不做翻页动画：一段动画播完的同时视频也在动，两个动作叠在一起很乱。 */
      for (const el of sheets) { el.classList.remove('is-in', 'is-out'); ui.fill(el); }
      video.poster = p.poster ? abs(p.poster) : '';
      if (video.src !== abs(p.src)) { video.src = abs(p.src); video.load(); }
    } else {
      video.pause();
      /* 图没解出来就先别动：在一张空白上播动画，看到的是「闪一下」不是「翻过去」。
       * 左右两页一直在预加载，所以这一步通常是立刻返回的。 */
      const probes = items.map(it => { const im = new Image(); im.src = abs(it.src); return im; });
      let left = probes.filter(im => !(im.complete && im.naturalWidth)).length;
      const run = () => {
        if (my !== seq) return;                 // 已经翻到别的页了，这一帧作废
        /* data-turn 决定 CSS 里挂哪条动画；给一个没人匹配的值 = 这一次不放动画。 */
        stage.dataset.turn = fresh ? 'none' : turn;
        stage.dataset.dir = dir;
        const wasFresh = fresh;
        fresh = false;
        /* ⚠️ `shown[0] !== items[0]` 这个判断不能省。
         * paint() 不只在翻页时被调用 —— 窗口尺寸一变 ResizeObserver 也会重画，
         * 而 page() 每次都返回一个**新数组**，所以不能用 shown !== items 去比。
         * 不比内容的话，一次纯粹的重排会「从这一页翻到这一页」，凭空多一次翻书动画。 */
        if (!wasFresh && turn === 'book' && shown.length && shown[0] !== items[0]) {
          flipTo(items, my);                    // 第一次进来没有旧页可翻，直接落
        } else {
          const { nx, pv } = commit(items);
          /* 强制重放动画：光换类名不会重新触发 animation，
           * 要先摘掉、读一次 offsetWidth 逼浏览器结算一次样式，再挂回去。 */
          for (const el of [nx, pv]) {
            el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
          }
          /* 动画播完把它摘掉，落回 .is-in 那句静态的 opacity:1。
           * 定时器是给「页面在后台」兜底的：那时候 animationend 永远不来。 */
          const done = () => { if (my === seq) nx.style.animation = 'none'; };
          nx.addEventListener('animationend', done, { once: true });
          setTimeout(done, 900);
        }
      };
      if (!left) run();
      else probes.forEach(im => im.addEventListener('load', () => { if (!--left) run(); }, { once: true }));
    }

    ui.fill(caption, items.map(x => x.caption).filter(Boolean).join('   /   '));
    caption.hidden = !caption.textContent;

    /* 单张里写**这一张自己的**地名（`鸭川·京都` 这种），不是主页那个城市。
     * 一个跨页上两张来自不同小地方时，两个地名都写出来。 */
    const places = [...new Set(items.map(x => x.place).filter(Boolean))];
    const place = places.join('  /  ') || a.place || a.city;
    /* 地名和日期之间**不插「·」**：地名本身就带一个（`鸭川·京都`），
     * 再插一个就成了三段一样的分隔符，读不出层次。改成靠间距分开。 */
    ui.fill(where, [
      place ? [pin(), place] : null,
      a.date ? h('span.y2k-cam__when', a.date) : null,
    ].flat().filter(Boolean));
    where.hidden = !(place || a.date);

    win.setTitle('摄影集', a.city || '');
    /* ⚠️ 数的是**跨页**，不是照片。
     * 原来写的是「第几张 / 共几张」，并排两张就写成 `from–from+1` ——
     * 那是「配对的两张一定挨着」时才成立的。竖图配对改成往后找之后
     * （见 pages() 那段），一对里的两张可能隔着好几张横图，
     * 于是页码会跳号、并排那页还会写出一个根本不存在的区间。
     * 一本书本来也是数页的：这一页是第几页、总共几页。 */
    const P = pages();
    count.textContent = String(si + 1).padStart(2, '0') + ' / ' + P.length;
    killBtn.textContent = rejects.has(p.src) ? '恢复' : '淘汰';
    /* 不循环了，所以到头的那一侧要看得出来是到头了 */
    prevBtn.disabled = si === 0;
    nextBtn.disabled = si === pages().length - 1;
    preload(si);
  }

  /* 窗口尺寸变了要重排这一页（图的像素尺寸是算出来写死的）。
   *
   * ⚠️ 它还兼着另一件事：刚 setView 完那一帧，舞台的宽度已经有了、**高度还是 0**，
   * 这时候 boxes() 会把每张图都算成 0×0。ResizeObserver 的回调在布局之后、
   * 绘制之前跑，所以它会在同一帧里把尺寸纠正回来，用户看不到那一下。
   * **不要改成 requestAnimationFrame 去等下一帧** —— 页面在后台时 rAF 根本不跑，
   * 那一页就永远画不出来了。 */
  new ResizeObserver(() => { if (view === 'one') paint(); }).observe(stage);


  /* ------------------------------------------------------------------
   * 全屏。这一层没有玻璃、没有窗口、没有 Y2K —— 只有照片。
   * ------------------------------------------------------------------ */
  let full = null, idleT = 0;

  /* 全屏是「细看」，所以它按**照片**走，不按页走 —— 一个跨页上两张竖图，
   * 全屏里当然应该一张一张看。fi 是这一本相册里的第几张照片。 */
  let fi = 0;

  function paintFull() {
    if (!full) return;
    const a = album(), p = list()[fi];
    if (!p) return;
    const vid = isVid(p);
    full.img.hidden = vid;
    full.vid.hidden = !vid;
    if (vid) {
      full.vid.poster = p.poster ? abs(p.poster) : '';
      if (full.vid.src !== abs(p.src)) full.vid.src = abs(p.src);
    } else {
      full.img.src = abs(p.src);
      full.img.alt = p.caption || p.place || '照片';
    }
    ui.fill(full.info, [(fi + 1) + ' / ' + list().length, p.place || a.place, a.date]
      .filter(Boolean).join('   ·   '));
  }

  function wake() {
    if (!full) return;
    full.el.classList.remove('is-idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => full && full.el.classList.add('is-idle'), 2600);
  }

  function goFull(n) {
    const L = list();
    if (!L.length) return;
    fi = (n + L.length) % L.length;          // 只在这一本里循环，跟单张一样
    paintFull();
  }

  function openFull(at) {
    const L = list();
    if (full || !L.length) return;
    /* 没指定就从当前这一页的头一张开始（按 F 的时候） */
    fi = at != null ? at : Math.max(0, L.indexOf(page()[0]));
    const img  = h('img');
    const vid  = h('video', { controls: true, playsInline: true, preload: 'metadata',
                              onclick: e => e.stopPropagation() });
    const info = h('b');
    const bar  = h('div.y2k-full__bar', info, h('span', '← →  翻页    F / Esc  退出'));
    const prev = h('button.y2k-full__nav.prev', { type: 'button', 'aria-label': '上一张',
                   onclick: e => { e.stopPropagation(); goFull(fi - 1); wake(); } }, '‹');
    const next = h('button.y2k-full__nav.next', { type: 'button', 'aria-label': '下一张',
                   onclick: e => { e.stopPropagation(); goFull(fi + 1); wake(); } }, '›');
    const el = h('div.y2k-full', { onclick: () => closeFull(), onmousemove: wake },
                 h('div.y2k-full__box', img, vid), prev, next, bar);
    document.body.appendChild(el);
    full = { el, img, vid, info };
    video.pause();
    paintFull();
    wake();
    /* 真全屏能拿到就拿 —— 拿不到（不是用户手势 / iframe 里）这一层照样铺满视口。 */
    el.requestFullscreen?.().catch(() => {});
    document.addEventListener('keydown', fullKeys, true);
    document.addEventListener('fullscreenchange', onFsChange);
  }

  function closeFull() {
    if (!full) return;
    document.removeEventListener('keydown', fullKeys, true);
    document.removeEventListener('fullscreenchange', onFsChange);
    clearTimeout(idleT);
    full.el.remove();
    full = null;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    /* 全屏里翻过好几张，退出来要停在**刚才看的那一张**所在的页上，
     * 而不是弹回进全屏之前那一页。 */
    if (view === 'one') {
      const target = list()[fi];
      const at = pages().findIndex(pg => pg.includes(target));
      if (at >= 0) si = at;
      paint();
    }
    win.focus();
  }

  /* 浏览器自己退出全屏（F11 / 系统手势）时这一层也要收掉，
   * 否则会留下一块盖住整个页面的黑板。 */
  function onFsChange() { if (!document.fullscreenElement && full) closeFull(); }

  /* 捕获阶段 + stopPropagation：全屏开着时 Esc 只关全屏，不能把相册窗口也关了。 */
  function fullKeys(e) {
    if (e.metaKey || e.ctrlKey) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Escape' || e.code === 'KeyF')      { stop(); closeFull(); }
    else if (e.key === 'ArrowLeft')  { stop(); goFull(fi - 1); wake(); }
    else if (e.key === 'ArrowRight') { stop(); goFull(fi + 1); wake(); }
    else if (curating && (e.code === 'KeyD' || e.key === 'Backspace')) {
      stop(); toggleReject(list()[fi]); paintFull();
    }
  }

  /* ------------------------------------------------------------------
   * 整理
   * ------------------------------------------------------------------ */
  function toggleReject(at) {
    const p = at || cur();
    if (!p) return;
    const dead = rejects.has(p.src);
    if (dead) rejects.delete(p.src); else rejects.add(p.src);
    saveRejects(rejects);
    updateTally();

    if (view === 'home') {
      /* 主页整块重画很便宜，但**滚动位置必须留住** ——
       * 挑到第 60 张被弹回页顶是最劝退的一件事。 */
      const top = feed.scrollTop;
      buildHome();
      feed.scrollTop = top;
      return;
    }
    paint();
    /* 淘汰完自动跳下一张 —— 挑几十张的时候少按一次键就是少按几十次。
     * 恢复不跳：恢复通常是「刚才手滑了」，要留在原地看一眼。 */
    if (!dead) go(si + 1);
  }

  function updateTally() {
    const all = albums.flatMap(a => a.photos);
    const keep = all.length - all.filter(p => rejects.has(p.src)).length;
    ui.fill(tally, curating ? '保留 ' + keep + ' / ' + all.length : '');
  }

  function setCurating(on) {
    curating = on;
    curBtn.classList.toggle('is-active', on);
    if (view === 'home') showHome(false); else { si = 0; showOne(); paint(); }
  }

  async function copyKeep() {
    const out = {
      albums: albums
        .map(a => ({ ...a, photos: a.photos.filter(p => !rejects.has(p.src)) }))
        .filter(a => a.photos.length),
    };
    const text = JSON.stringify(out, null, 1);
    try {
      await navigator.clipboard.writeText(text);
      ui.fill(tally, '已复制 —— 整个盖掉 照片/清单.json');
      setTimeout(updateTally, 3600);
    } catch {
      /* 剪贴板要安全上下文，file:// 下会被拒。退回「自己选自己复制」。 */
      const ta = h('textarea.y2k-cam__dump', { readonly: true });
      ta.value = text;
      win.setView(h('div.y2k-cam__dumpwrap',
        ui.note('浏览器不让自动复制（要 https 或 localhost）。全选下面这段，盖掉 内容/相册/photos.json：'),
        ta));
      ta.select();
      win.setFooter(ui.btn({ label: '← 回相册', onClick: () => showHome(false) }), ui.spacer());
    }
  }

  /* ------------------------------------------------------------------
   * 键盘
   *
   * ⚠️ 必须挂 **document + 捕获**，不能挂 win.win。
   * 挂窗口上要求焦点还留在窗口里，而点一张照片进单张视图时，setView() 会把
   * 刚被点的那颗按钮整个换掉 —— 焦点掉回 <body>，之后左右键就再也进不来了。
   * **这就是「左右键翻不动图」的原因**，不是键位问题。
   *
   * 挂 document 之后要自己解决两件事：
   *   · 上面压着别的弹窗时不能抢键 → 用 ui.top === win 守门；
   *     窗口被收起（keepAlive）时也不在栈里，自然就哑了。
   *   · 全屏开着时交给 fullKeys → 直接 return。
   *
   * Esc 也归这里管：窗口建的时候给了 closeOnEsc:false，
   * 因为 ui.js 的 Esc 也是 document 捕获、注册得更早，抢不过它。
   * ------------------------------------------------------------------ */
  document.addEventListener('keydown', e => {
    if (full) return;                       // 全屏那一层自己管
    if (ui.top !== win) return;             // 上面压着别的弹窗
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;

    if (view === 'one') {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); go(si - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(si + 1); }
      if (e.code === 'KeyF')      { e.preventDefault(); openFull(); }
      /* 一层一层退出去：直接关窗会让人得重新滚回刚才那个位置。 */
      if (e.key === 'Escape')     { e.preventDefault(); showHome(true); }
      if (curating && (e.code === 'KeyD' || e.key === 'Backspace')) {
        e.preventDefault(); toggleReject();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault(); win.close();
    }
  }, true);

  /* 设置面板改了选项 → 这儿重新读一遍再重画。
   * 读的是同一批 localStorage 键，所以页脚那排和面板永远是一致的。 */
  _sync = () => {
    if (win.closed) { _sync = null; return; }
    turn = pick(LS_TURN, TURNS, 'book');
    turnSel.sync();
    if (view === 'home') showHome(false); else paint();
  };

  sizeWindow();
  win.setView(ui.state({ kind: 'loading', title: '正在翻相册' }));
  load().then(l => {
    albums = l;
    if (!albums.length) {
      win.setView(ui.state({
        kind: 'empty', icon: '📷', title: '还没有照片',
        text: '把照片按「一个地方一个文件夹」放进 相机显示照片/，'
            + '然后跑一次 UI实验室/导入照片.py。',
      }));
      win.setFooter();
      return;
    }
    showHome(false);
  });
  return win;
}

/* 主窗口用的是 openGallery(...)（共用/环境预览.html:927），别改这个名字。
 * 它传进来的 {width,height} 会被忽略 —— 相册按视口自己算，见 sizeWindow。
 * open 只是给「相册.open()」这种写法留的别名。 */
export const open = openGallery;
export default openGallery;
