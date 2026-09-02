/* ============================================================================
 * 共用/ui.js —— 全站 UI 设计系统的行为层，配合 共用/ui.css
 *
 * owner: 窗口 D。
 *
 * 这里只有「所有弹窗都需要」的东西：窗口外框、按钮、列表行、网格卡片、
 * 标签页、滚动区、空/载入/错误态、开合动效、焦点管理。
 * **不要**往这里加任何只有播放器用得上的逻辑 —— 那些属于 音乐层/player.js。
 *
 * 用法（许愿页面、简历页、以后任何弹窗都一样）：
 *
 *     import { ui, h } from '../共用/ui.js';
 *
 *     const win = ui.window({ title: '许愿', sub: 'WISH' });
 *     win.setView(
 *       ui.scroll(
 *         ui.section(
 *           ui.field({ label: '写点什么', textarea: true, placeholder: '……' }),
 *         ),
 *       ),
 *     );
 *     win.setFooter([ui.spacer(), ui.btn({ label: '放进海里', variant: 'primary' })]);
 *
 * 约定：每个工厂函数都返回一个真实 DOM 节点，随便你再加类、再塞东西。
 * 没有虚拟 DOM，没有构建步骤 —— 这个项目是双击就能开的静态页面。
 * ========================================================================== */

/* ---------------------------------------------------------------------------
 * 0 · 自动注入样式
 * 让调用方只 import 一个 js 就够了，不用记得再写一行 <link>。
 * 用 import.meta.url 解析，所以放在任何深度的目录里都对。
 * ------------------------------------------------------------------------- */
const CSS_URL = new URL('./ui.css', import.meta.url).href;
if (!document.querySelector(`link[data-y2k-ui]`)) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_URL;
  link.dataset.y2kUi = '';
  document.head.appendChild(link);
}

/* ---------------------------------------------------------------------------
 * 1 · h() —— 极小的 DOM 构造器
 *
 *   h('div')                                  → <div>
 *   h('div.y2k-row', '文字')                   → <div class="y2k-row">文字</div>
 *   h('button.y2k-btn', { onclick }, '关闭')
 *   h('img', { src, alt })
 *
 * 属性对象里：
 *   class / className 追加类；style 接受对象；on* 挂事件；
 *   data-* 和 aria-* 用 setAttribute；其余优先走 property，不行再 setAttribute。
 * 子节点：字符串 / 节点 / 数组 / null（null 和 false 直接跳过，方便写条件）。
 * ------------------------------------------------------------------------- */
export function h(spec, ...rest) {
  const [tag, ...classes] = String(spec).split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.classList.add(...classes);

  let children = rest;
  const first = rest[0];
  const isProps = first && typeof first === 'object'
    && !(first instanceof Node) && !Array.isArray(first);
  if (isProps) {
    children = rest.slice(1);
    for (const [k, v] of Object.entries(first)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
      else if (k === 'style' && typeof v === 'object') {
        // 不能直接 Object.assign(el.style, v)：CSS 自定义属性（--y2k-w 这种）
        // 赋值是不生效的，必须走 setProperty。窗口的 width/height 就是靠 --y2k-w/--y2k-h
        // 传下去的，所以以前每一个 ui.window({width, height}) 都被悄悄忽略了，
        // 全站窗口一律是 CSS 里的默认 720×640。
        for (const [ck, cv] of Object.entries(v)) {
          if (cv == null) continue;
          if (ck.startsWith('--')) el.style.setProperty(ck, String(cv));
          else el.style[ck] = cv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role') el.setAttribute(k, v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/* 把 children 塞进已有节点，清空原内容。到处都要用，导出一个。 */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/* ---------------------------------------------------------------------------
 * 2 · 玻璃 —— 位移是**算**出来的，不是画上去的
 *
 * 绝大多数网页的「玻璃」= backdrop-filter: blur() + 一圈径向渐变高光。
 * 那是涂上去的，能涂得挺光滑，但没有真镜头才会产生的畸变，所以一眼就假。
 *
 * 这里换一个思路：**把这块玻璃当成一个物理对象**。
 *
 *   造型   一个凸起的圆角穹顶：中心是平的，边缘向下弯折成一圈很薄的环。
 *          断面用的就是苹果做圆角那条超椭圆（squircle）：
 *              slope(x) = (1-x)^3 / (1 - (1-x)^4)^0.75
 *          x = 从边缘往里的深度（0 = 边缘，1 = 平坦的中心）。
 *          x=1 时 slope=0（中心完全是平的），x→0 时 slope→∞（边缘竖直下折）。
 *
 *   光学   对每个像素，取穹顶在那一点的斜率，按**斯涅尔定律**、以**折射率 1.5**
 *          （真实玻璃的值）折射一束垂直向下的光线：
 *              θi = atan(slope)          入射角 = 表面倾角
 *              θt = asin(sin θi / 1.5)   斯涅尔
 *              bend = sin(θi - θt)       横向偏移量，中心 0、边缘最大
 *          bend 的上限是有限的：θi→90° 时 θt→41.81°，bend→sin(48.19°)=0.7454。
 *
 *   方向   沿圆角矩形**有符号距离场（SDF）**读出来的表面法线 (nx, ny)。
 *
 *              map.r = 128 + nx * bend * gain
 *              map.g = 128 + ny * bend * gain      (128 = 原地不动)
 *
 * **所有的弯曲都集中在边缘，中心保持清晰** —— 这跟一块厚玻璃的真实表现完全一致，
 * 也是它和「糊一层 blur」最大的区别。
 *
 * 位移往**里**还是往**外**？往里。推一遍就知道：
 *   入射光沿 (0,-1) 垂直向下，法线往外倾斜 θi，折射后的光线方向是
 *   -n 绕 θt 转回入射方向那一侧 = (-sin(θi-θt), -cos(θi-θt))：
 *   **在玻璃里侧向偏移的方向是朝内的**。所以边上那圈像素读到的是更靠里的背景，
 *   于是中间的内容被往外拉开 —— 一块平凸透镜本来就是放大的。
 *   落到 feDisplacementMap 上就是 scale 取负（位移 = scale × (C/255 − 0.5)）。
 *   顺带一个好处：往里采样永远落在滤镜区域内，不会在边上啃到透明。
 *
 * **蓝色通道存镜面反射的强度**，那圈明亮的边缘光直接由它生成 ——
 * 边缘光和折射来自**同一个表面**，所以永远对得上。
 * 不要另外手画一条描边高光：手画的对不上，而且那正是「假」的来源。
 *
 *   反射   R = 2(N·V)N - V                          N = (nx·sinθi, ny·sinθi, cosθi)
 *   强度   F = F0 + (1-F0)(1-N·V)^5，玻璃 F0 = 0.04   （Schlick 菲涅尔）
 *   颜色   env(R)：斜面反的是**整片环境**，不是一个点光源。
 *
 * 最后这条很关键。用一个点光源 + Phong 只能得到一条又细又硬的白杠 ——
 * 那正是「一眼假」的另一半来源。真玻璃的斜面把整片天和整片沙都反进来了，
 * 所以那圈边**亮度不均、有宽度、有方向**。这里用最省的解析环境：
 * 屏幕上方是天（最亮）、下方是沙（次亮）、地平线一带暗一档，
 * 外加一颗方向固定的太阳（specPower 控制它有多小）。
 *
 * **没有人为构造的曲线，只有光学。** 如果哪天发现自己在调一条「看起来比较像」的
 * 贝塞尔曲线，就是走错路了 —— 回来改折射率、改厚边宽度、改穹顶断面。
 *
 * ---------------------------------------------------------------------------
 * 浏览器兼容：这是这个方案唯一的坑
 *
 * backdrop-filter 里引用 url() 的 SVG 滤镜，**目前只有 Chromium 支持**。
 * Safari / Firefox 支持 backdrop-filter 本身，但不支持在里面引用 SVG 滤镜
 * （Firefox 有公开的 feature request，W3C 也还在讨论怎么标准化）。所以分三档：
 *
 *   refract  完整版：真折射 + 边缘光
 *   blur     只有 backdrop-filter：轻模糊 + 提饱和 + **边缘光照样画**
 *   flat     都没有：半透明底色 + 边缘光
 *
 * 关键：**边缘光是我们自己用 canvas 画的一张图**，不经过任何滤镜，
 * 所以三档都有。降级版不是「坏掉的完整版」，是一块少了折射的好玻璃。
 *
 * ⚠️ 关于 CSS.supports：本来应该只信它、不看 UA。但 Safari 和 Firefox 的
 *    **解析器认得 `backdrop-filter: url(#a)` 这个语法**（因为 filter 属性接受
 *    url()），supports() 返回 true，渲染时却整个忽略 —— 玻璃会变成一块什么都
 *    不做的透明板。所以这里是 supports() 打头、外加两条针对「已知会说谎的引擎」
 *    的修正。等它们真的实现了，把 KNOWN_LIARS 删掉即可，别的都不用动。
 * ------------------------------------------------------------------------- */

/* 折射开关。改成 false = 只剩模糊 + 染色 + 边缘光那一版（也是完整的一套材质）。
 *
 * ⚠️⚠️ **在动这里的任何参数之前，先确认 backdrop-filter 真的生效了。**
 * 2026-08-31 为了「折射看不见」前后查了七轮，改过方向、断面、范围、强度、
 * 内容内缩、还把模糊拆成了单独一层 —— **全都是白改**。
 * 真因是 `.y2k-scrim` 上一条 `animation: y2k-fade ... both`（动 opacity）：
 * 它让遮罩成了 **backdrop root**，里面的窗口拿到的"背景"是空的，
 * 于是位移和模糊全都作用在空气上。而且 getComputedStyle 查出来一字不差，
 * 不报错、不警告，看上去就像"参数没调对"。
 *
 * 判定方法（三十秒）：往 body 上塞一个同样 backdrop-filter 的裸 div 做对照。
 * 裸的生效、窗口的不生效 → 就是 backdrop root，往上找祖先的
 * filter / opacity≠1 / transform / will-change / backdrop-filter。
 * UI 参数面板的自检行现在会直接写「⚠️ 被 xxx 挡住了」。 */
const REFRACT = true;

/* 三档能力。UI 上想显示当前在哪一档，读 ui.tier。 */
export const GLASS_TIER = (() => {
  if (typeof window === 'undefined' || !window.CSS?.supports) return 'flat';
  const bf = CSS.supports('backdrop-filter', 'blur(2px)')
          || CSS.supports('-webkit-backdrop-filter', 'blur(2px)');
  if (!bf) return 'flat';
  const svg = CSS.supports('backdrop-filter', 'url(#a)')
           || CSS.supports('-webkit-backdrop-filter', 'url(#a)');
  if (!svg) return 'blur';
  const ua = navigator.userAgent;
  const KNOWN_LIARS = /firefox|fxios/i.test(ua)
    || /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(ua);
  return KNOWN_LIARS ? 'blur' : 'refract';
})();

/* 把当前能力档写到 <html> 上，CSS 里靠它分级（见 ui.css 第 2.9 节）。
 * 三档：refract 真折射 / blur 只有模糊 / flat 什么都没有。 */
if (document.documentElement) document.documentElement.dataset.y2kTier = GLASS_TIER;

/* 预设切换器的几个常量。声明在这里而不是跟 PRESETS 放一起 ——
 * 下面 setPreset / _preset 的初始化比 PRESETS 那一节先执行，const 有暂时性死区。 */
const PRESET_ORDER = ['thin', 'base', 'bubble'];   // 厚玻璃已删（Iris 08-31：太厚了）
const DEFAULT_PRESET = 'base';
const LS_PRESET = 'y2k-glass-preset';

/* 出厂参数。Iris 在 UI实验室/玻璃.html 上拖滑块调，调好点「导出」贴回这里。 */
export const GLASS = {
  radius:     22,     /* 圆角半径 px。跟 --y2k-r 对齐，不然折射的形状和窗口对不上 */
  /* 穹顶从边缘弯到平坦中心，用掉**半个面板的百分之多少**。
   * ⚠️ 这个数以前是像素（最大 90），那是个错误的参数化：
   * 在一块 740px 宽的面板上，90px 永远只是边上一条窄带，中间一大片是平的 ——
   * 看上去就「只有边边在弯」（Iris 2026-08-31 的原话）。改成按面板尺寸取百分比：
   *   15  ≈ 一圈厚边（原来那个样子）
   *   100 = 整块都是弧面，**整个背景都在折射**，只有正中心一点是平的
   * 后者才是一块真正的平凸透镜。 */
  spread:     100,
  /* 断面形状：0 = 超椭圆（只有边在弯）、100 = 球冠（整块都是透镜）。见 domeSlope。 */
  curve:      100,
  gain:       22,     /* 最边上把背景往里拉多少 px。这是「玻璃有多厚」的直观旋钮 */
  ior:        1.5,    /* 折射率。真实玻璃 1.5，水 1.33，蓝宝石 1.77 */
  dispersion: 0,      /* 色散：红蓝折射率之差 ×1000。0 = 关（省两次位移，backdrop 每帧都跑） */
  spec:       22,     /* 太阳比天空亮多少倍（迎光那一头最亮的一小段） */
  specPower:  12,     /* 太阳有多小。大 = 一条细杠，小 = 一大片软光 */
  fresnel:    1.00,   /* 环境反射的强度。1 = 按菲涅尔的真值给，不额外压 */
  light:      [-0.42, -0.62, 0.66],   /* 固定光向：左上方。宪法 1.5「手绘高光条」不跟光源走 */
};

/* 位移图最长边。位移那半张图很平滑，缩着算再拉开看不出来；
 * 但**边缘光只有一两个像素宽**，缩太狠会被平均掉，所以不能压得太小。 */
const MAP_MAX = 560;
const CACHE_MAX = 24;
const _mapCache = new Map();
let _defs = null;

function glassDefs() {
  if (_defs) return _defs;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, {
    position: 'fixed', width: '0', height: '0', pointerEvents: 'none', opacity: '0',
  });
  document.body.appendChild(svg);
  return (_defs = svg);
}

/* 球冠断面里，边缘最陡到多少度。82° 已经很接近掠射，再大数值就不稳了。 */
const SPH_MAX = 82 * Math.PI / 180;

/* 穹顶断面：x = 从边缘往里的深度（0 边缘 / 1 中心），返回表面倾角 θi。
 * curve = 0..1，在两种断面之间插值：
 *
 *   0  **超椭圆**（苹果圆角那条）：中心极平，斜率几乎全挤在最外圈。
 *      算出来是这样的：把弯折范围拉满到整块面板，中段的位移仍然接近 0 ——
 *      因为 u³/(1−u⁴)^0.75 在 u<0.8 的时候本来就趋近于零。
 *      所以它天生只能做出「一圈厚边在弯」，做不出「整块都在折射」。
 *   1  **球冠**：θ = asin(u·sin82°)，从中心到边缘平滑地越来越陡 ——
 *      这才是一块真正的透镜，**整个背景都被弯**，中心也只是弯得最少而已。
 *
 * ⚠️ 这两条都是解析式，没有一条是「看着像」调出来的贝塞尔。
 * Iris 要的是后者（2026-08-31：「我要的是整个 ui 背景的折射，不是只有那几个边边」）。 */
export function domeSlope(x, curve = 1) {
  const u = 1 - Math.min(1, Math.max(0, x));
  const den = 1 - u * u * u * u;
  const sq = den <= 1e-9 ? Math.PI / 2 : Math.atan((u * u * u) / Math.pow(den, 0.75));
  const sp = Math.asin(Math.min(1, u * Math.sin(SPH_MAX)));
  return sq * (1 - curve) + sp * curve;
}

/* 斯涅尔。返回横向偏移量 bend，中心为 0、边缘最大（1.5 时上限 0.7454）。 */
function snellBend(thetaI, ior) {
  const s = Math.sin(thetaI) / ior;
  return Math.sin(thetaI - Math.asin(Math.min(1, s)));
}

/* 画两张图，一趟循环出来 —— 它们描述的是**同一个表面**：
 *   disp  R/G = 位移（128 = 不动），B = 镜面反射强度
 *   rim   白色 + alpha = 镜面反射强度（就是 disp 的 B 通道），给 CSS 当边缘光贴图
 *
 * 圆角矩形的「到边界的距离」和「朝外的法线」都在循环里就地算，不抽成函数返回对象 ——
 * 一张 420×360 的图是十五万个像素，每像素分配一个临时对象会让开窗卡一百毫秒。
 * 法线是解析解，不用差分，每像素还能少算四次距离。 */
function buildMaps(w, h, o) {
  const sig = [w, h, o.radius, o.spread, o.curve, o.ior, o.spec, o.specPower, o.fresnel,
               o.light.join(',')].join('|');
  const hit = _mapCache.get(sig);
  if (hit) return hit;

  const dispC = document.createElement('canvas');
  const rimC  = document.createElement('canvas');
  dispC.width = rimC.width = w; dispC.height = rimC.height = h;
  const dImg = dispC.getContext('2d').createImageData(w, h);
  const rImg = rimC.getContext('2d').createImageData(w, h);
  const D = dImg.data, R = rImg.data;

  const [lx, ly, lz] = (() => {
    const [a, b, c] = o.light, n = Math.hypot(a, b, c) || 1;
    return [a / n, b / n, c / n];
  })();

  const bendMax = snellBend(Math.PI / 2, o.ior) || 1;
  const radius = Math.max(0, Math.min(o.radius, w / 2, h / 2));
  /* 弯折带的宽度 = 半个短边 × spread%。100% 时整块面板都是弧面。 */
  const band = Math.max(1, (o.spread / 100) * Math.min(w, h) / 2);
  /* ⚠️ **边缘光要用它自己的窄带，不能跟着 band 走。**
   * 「离最近那条边多远」这个量在角平分线上是不连续的 —— 从某一点起最近的边
   * 从上边换成了左边，法线方位角一跳，高光的亮度跟着一跳。
   * band 铺满整块面板时（spread 100），这条不连续就从四个角一路划到中心，
   * 看上去就是**两条斜着的怪线**（Iris 2026-08-31 报的）。
   * 边缘光本来就只该待在最外面那一圈（它是斜面反的光），
   * 把它限死在 6% 的窄带里，斜线就落在几乎没有亮度的地方，看不见了。 */
  const rimBand = Math.max(2, Math.min(band, Math.min(w, h) * 0.06));
  const cx = w / 2, cy = h / 2;
  const ix = cx - radius, iy = cy - radius;      /* 直边段的半长 */

  /* 断面只跟「离边界多远」有关，跟在哪条边上无关 —— 所以整条曲线预先算成一张表，
   * 每像素只做一次查表 + 一次插值。十五万次 atan/asin 会明显卡开窗那一帧。 */
  const LUT = 256;
  /* bendT / sinT / cosT 按「离最近那条边有多远」建（边缘型 + 边缘光都用它，
   * 所以一律用超椭圆断面 curve=0，这样高光永远贴着边）。 */
  const bendT = new Float32Array(LUT), sinT = new Float32Array(LUT), cosT = new Float32Array(LUT);
  /* bendT2 按「离中心有多远」建，走球冠断面 —— 透镜型用它。 */
  const bendT2 = new Float32Array(LUT);
  for (let i = 0; i < LUT; i++) {
    const th = domeSlope(i / (LUT - 1), 0);
    bendT[i] = snellBend(th, o.ior) / bendMax;   /* 归一到 0~1，幅度全交给 scale */
    sinT[i] = Math.sin(th); cosT[i] = Math.cos(th);
    /* i/(LUT-1) 这里是「离中心的归一距离」，1 = 边上，所以断面参数要反过来喂 */
    bendT2[i] = snellBend(domeSlope(1 - i / (LUT - 1), 1), o.ior) / bendMax;
  }

  let i = 0;
  for (let y = 0; y < h; y++) {
    const py = y + .5, sy = py < cy ? -1 : 1, qy = Math.abs(py - cy) - iy;
    for (let x = 0; x < w; x++, i += 4) {
      const px = x + .5, sx = px < cx ? -1 : 1, qx = Math.abs(px - cx) - ix;

      let dist, nx, ny;
      if (qx > 0 && qy > 0) {                    /* 圆角上 */
        const len = Math.hypot(qx, qy) || 1;
        dist = radius - len; nx = (qx / len) * sx; ny = (qy / len) * sy;
      } else if (qx > qy) {                      /* 左右两条边 */
        dist = radius - qx; nx = sx; ny = 0;
      } else {                                   /* 上下两条边 */
        dist = radius - qy; nx = 0; ny = sy;
      }
      /* ⚠️ 上面两支必须是 radius - q，不是 -q。
       * qx / qy 是「离**直边段**有多远」，而直边段本身已经往里缩了一个圆角半径
       * （ix = cx - radius），所以 -q 会把整条带子往里推 radius 个像素 ——
       * 结果是四条直边的最外面那一圈完全不弯、亮边也浮在里面，只有四个角是对的。
       * 圆角那一支 radius - len 一直是对的，所以这个错很难一眼看出来。 */

      let r = 128, g = 128, lit = 0;

      /* ------------------------------------------------------------------
       * 两套位移，按 curve 混合。它们的**方向**不一样，这才是关键：
       *
       *  A 边缘型（curve 0）：方向 = 圆角矩形 SDF 的法线，也就是「垂直于最近的那条边」。
       *    一块中心是平的穹顶就该这样。但它在一条边的中段是**整片同向平移**，
       *    看上去是一道抹痕、不是放大 —— 铺满整块面板时就成了两条诡异的直条
       *    （Iris 2026-08-31 看到的就是这个）。
       *
       *  B 透镜型（curve 1）：方向 = **从面板中心往外**，大小随离中心的距离增长。
       *    这就是一块平凸透镜在做的事：背后的东西被整体放大、越靠边推得越多。
       *    「整个窗口是一块玻璃、背景被它顶起来」要的是这个，不是 A。
       * ------------------------------------------------------------------ */
      const ex = (px - cx) / (w / 2), ey = (py - cy) / (h / 2);   // 椭圆归一化坐标
      const er = Math.hypot(ex, ey);

      /* B：离中心多远就是断面上的哪一点（er=1 在边上） */
      let bx = 0, by = 0;
      if (er > 1e-4) {
        const jb = Math.min(1, er) * (LUT - 1), j0 = jb | 0, f = jb - j0;
        const j1 = j0 + 1 < LUT ? j0 + 1 : j0;
        const kb = (bendT2[j0] + (bendT2[j1] - bendT2[j0]) * f) * 127;
        bx = (ex / er) * kb; by = (ey / er) * kb;
      }

      /* A：离最近那条边多远 */
      let ax = 0, ay = 0;
      if (dist >= 0) {
        const t = Math.min(1, dist / band);
        const j = t * (LUT - 1), j0 = j | 0, f = j - j0, j1 = j0 + 1 < LUT ? j0 + 1 : j0;
        const ka = (bendT[j0] + (bendT[j1] - bendT[j0]) * f) * 127;
        ax = nx * ka; ay = ny * ka;
      }

      const cu = (o.curve ?? 100) / 100;
      r = 128 + ax * (1 - cu) + bx * cu;
      g = 128 + ay * (1 - cu) + by * cu;
      if (r < 0) r = 0; else if (r > 255) r = 255;
      if (g < 0) g = 0; else if (g > 255) g = 255;

      /* 边缘光只跟**边**走（它是那一圈迎光的窄面），所以永远用 A 的法线和倾角、
       * 而且用自己的窄带 rimBand —— 理由见上面那段。 */
      if (dist >= 0 && dist < rimBand) {
        const t = Math.min(1, dist / rimBand);
        const j = t * (LUT - 1), j0 = j | 0, f = j - j0, j1 = j0 + 1 < LUT ? j0 + 1 : j0;
        const st = sinT[j0] + (sinT[j1] - sinT[j0]) * f;
        const ct = cosT[j0] + (cosT[j1] - cosT[j0]) * f;
        const Nx = nx * st, Ny = ny * st, Nz = ct;
        const ndv = Nz;
        const Rx = 2 * ndv * Nx, Ry = 2 * ndv * Ny, Rz = 2 * ndv * Nz - 1;
        const F = 0.04 + 0.96 * Math.pow(1 - Math.max(0, ndv), 5);
        const up = Ry < 0 ? -Ry : 0, dn = Ry > 0 ? Ry : 0;
        const env = 0.45 + 0.55 * Math.pow(up, 0.7) + 0.30 * Math.pow(dn, 1.6);
        let sun = Rx * lx + Ry * ly + Rz * lz;
        sun = sun > 0 ? Math.pow(sun, o.specPower) : 0;
        lit = F * (o.fresnel * env + o.spec * sun);
        if (lit > 1) lit = 1; else if (lit < 0) lit = 0;
      }

      const B = (lit * 255) | 0;
      D[i] = r; D[i + 1] = g; D[i + 2] = B; D[i + 3] = 255;
      R[i] = 255; R[i + 1] = 255; R[i + 2] = 255; R[i + 3] = B;
    }
  }
  dispC.getContext('2d').putImageData(dImg, 0, 0);
  rimC.getContext('2d').putImageData(rImg, 0, 0);

  const out = { disp: dispC.toDataURL(), rim: rimC.toDataURL() };
  if (_mapCache.size >= CACHE_MAX) _mapCache.delete(_mapCache.keys().next().value);
  _mapCache.set(sig, out);
  return out;
}

let _fid = 0;
const _live = new Set();          /* 活着的玻璃，改全站参数时要挨个 refresh */

/* 把一个元素变成玻璃。**三档都能调**，返回的对象永远不是 null。
 *
 *   glass(el)                     用出厂参数
 *   glass(el, { gain: 40 })       只改一个
 *   inst.set({ ... })             当场改（实验室的滑块走这条）
 */
export function glass(el, opts = {}) {
  let o = { ...GLASS, ...opts };
  const id = `y2k-glass-${++_fid}`;
  let filter = null, feImage = null, disp = [], chromaOn = null;

  if (REFRACT && GLASS_TIER === 'refract') {
    const NS = 'http://www.w3.org/2000/svg';
    filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    /* ⚠️ 少了这一行，SVG 默认走 linearRGB，会把「128 = 不动」这个中性灰算歪，
     * 整块面板都跟着漂。 */
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    feImage = document.createElementNS(NS, 'feImage');
    feImage.setAttribute('result', 'map');
    feImage.setAttribute('preserveAspectRatio', 'none');
    filter.appendChild(feImage);
    glassDefs().appendChild(filter);
  }

  /* 色散 = 三次位移，scale 各差一点，分别只留 R / G / B 再 screen 混回去。
   * 差多少不是拍脑袋：折射率随波长变，红端低、蓝端高（正常色散），
   * 一阶近似下 bend 的变化和 Δn 成正比，所以直接按 Δn 缩放 scale。
   *
   * dispersion = 0 时这三次**一模一样**，混完还是原图 —— 纯浪费，而 backdrop-filter
   * 每帧都要跑。所以分两条链，0 的时候只做一次位移。 */
  const CH = [
    { key: 'R', mat: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0' },
    { key: 'G', mat: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0' },
    { key: 'B', mat: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0' },
  ];

  function newDisp(result) {
    const NS = 'http://www.w3.org/2000/svg';
    const dm = document.createElementNS(NS, 'feDisplacementMap');
    dm.setAttribute('in', 'SourceGraphic');
    dm.setAttribute('in2', 'map');
    dm.setAttribute('xChannelSelector', 'R');
    dm.setAttribute('yChannelSelector', 'G');
    if (result) dm.setAttribute('result', result);
    filter.appendChild(dm);
    return dm;
  }

  function buildChain(withChroma) {
    if (chromaOn === withChroma) return;
    chromaOn = withChroma;
    while (filter.lastChild !== feImage) filter.removeChild(filter.lastChild);
    disp = [];
    if (!withChroma) { disp.push(newDisp()); return; }

    const NS = 'http://www.w3.org/2000/svg';
    for (const ch of CH) {
      disp.push(newDisp('d' + ch.key));
      const cm = document.createElementNS(NS, 'feColorMatrix');
      cm.setAttribute('in', 'd' + ch.key);
      cm.setAttribute('type', 'matrix');
      cm.setAttribute('values', ch.mat);
      cm.setAttribute('result', ch.key);
      filter.appendChild(cm);
    }
    const mk = (a, b, res) => {
      const bl = document.createElementNS(NS, 'feBlend');
      bl.setAttribute('in', a); bl.setAttribute('in2', b);
      bl.setAttribute('mode', 'screen');
      if (res) bl.setAttribute('result', res);
      filter.appendChild(bl);
    };
    mk('R', 'G', 'RG'); mk('RG', 'B');
  }

  let last = '';
  function refresh(force) {
    /* ⚠️ **用 offsetWidth/offsetHeight，不要用 getBoundingClientRect()。**
     * （Iris 2026-09-01：相册里靠右和靠下各有一条很明显的直线）
     *
     * getBoundingClientRect 给的是**变换之后**的框。窗口开场有一段 y2k-pop 的缩放动画，
     * 而第一次画图正好推到了动画进行中的那一拍 —— 量到的是 95.5% 的尺寸，
     * 于是位移图只铺满窗口的 95.5%，剩下那一圈没有图。
     * feDisplacementMap 在有图和没图的交界处位移量从 gain 直接跳到 0，
     * 那道跳变就是她看到的两条线（右边一条竖的、下面一条横的，正好在 95.5% 处）。
     *
     * 而且 ResizeObserver **不会**因为 transform 变化再触发一次 —— 它盯的是布局框，
     * 动画结束、缩放回到 1 的时候没有任何人来纠正，那两条线就一直留在那儿。
     * offsetWidth/offsetHeight 是布局尺寸，transform 影响不到它，从头到尾都是对的
     * （filterUnits=userSpaceOnUse 要的也正是这个未变换的坐标系）。 */
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const sig = `${w}x${h}|${JSON.stringify(o)}`;
    if (!force && sig === last) return;
    last = sig;

    /* 位移图缩着算：图很平滑，拉开看不出来，但省一大截时间 */
    const k = Math.min(1, MAP_MAX / Math.max(w, h));
    const mw = Math.max(8, Math.round(w * k)), mh = Math.max(8, Math.round(h * k));
    /* radius 是像素、要跟着缩；spread 是百分比、不用缩 */
    const maps = buildMaps(mw, mh, { ...o, radius: o.radius * k });

    /* 边缘光贴图：三档都用，它不经过任何滤镜。 */
    el.style.setProperty('--y2k-rim-map', `url("${maps.rim}")`);
    el.dataset.y2kLit = '';

    if (!filter) return;

    feImage.setAttribute('href', maps.disp);
    feImage.setAttribute('x', '0'); feImage.setAttribute('y', '0');
    feImage.setAttribute('width', String(w)); feImage.setAttribute('height', String(h));
    filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
    filter.setAttribute('width', String(w)); filter.setAttribute('height', String(h));

    /* 位移 = scale × (C/255 − 0.5)，通道满幅是 ±127 ≈ ±0.5，
     * 所以 scale = −2 × gain 时，最边上正好把背景往**里**拉 gain 个像素。 */
    const base = -2 * o.gain;
    const dn = o.dispersion / 1000;
    buildChain(dn > 0);
    for (let i = 0; i < disp.length; i++) {
      const f = dn > 0 ? 1 + (i === 0 ? -dn : i === 2 ? dn : 0) / (o.ior - 1) : 1;
      disp[i].setAttribute('scale', (base * f).toFixed(2));
    }
    /* ⚠️ 必须引用 var(--y2k-blur)，不能把数值写死 —— 写死的话这条内联样式会盖掉
     * CSS 里的 backdrop-filter，「模糊 / 饱和」两个令牌就彻底失效。
     *
     * 曾经以为「Chromium 会把 url() 后面的函数全丢掉」，所以拆出过一层单独做模糊。
     * **那是误判**：真正的原因是遮罩上的 opacity 动画让窗口落进了 backdrop root，
     * 于是 url 和 blur 一起失效，看上去像「只有 url 生效」。遮罩修好之后
     * `url(#f) blur(14px) saturate(1.6)` 三件事同时成立，验证过。 */
    const fx = `url(#${id}) var(--y2k-blur)`;
    el.style.backdropFilter = fx;
    el.style.webkitBackdropFilter = fx;
    el.dataset.y2kRefract = '';
  }

  const ro = new ResizeObserver(() => refresh());
  ro.observe(el);
  /* 第一张图不在开窗那一帧算：画图是同步的，会把弹出动画的第一帧顶掉。
   * 推到下一个宏任务，开场动画正好盖住这一拍。 */
  const boot = setTimeout(refresh, 0);

  const inst = {
    get options() { return { ...o }; },
    refresh,
    set(next = {}) { o = { ...o, ...next }; refresh(true); return inst; },
    destroy() {
      clearTimeout(boot); ro.disconnect(); _live.delete(inst);
      filter?.remove();
      el.style.backdropFilter = ''; el.style.webkitBackdropFilter = '';
      el.style.removeProperty('--y2k-rim-map');
      delete el.dataset.y2kRefract; delete el.dataset.y2kLit;
    },
  };
  _live.add(inst);
  return inst;
}

/* 改全站的玻璃参数，活着的窗口当场跟着变（实验室的滑块走这条）。 */
export function setGlass(next = {}) {
  Object.assign(GLASS, next);
  for (const g of _live) g.set(next);
}

/* 活着的窗口。切预设要连**材质的 CSS 类**一起换，光改光学参数不够 ——
 * 泡泡和玻璃的染色、模糊、圆角全在 CSS 令牌里。 */
const _wins = new Set();
let _preset = DEFAULT_PRESET;

/* @param optics  true = 顺便把这一档的光学参数推到滑块上（用户主动切档时）
 *                 false = 只换材质，滑块**一根都不动**（刷新时恢复上次那一档用）
 * ⚠️ 刷新时必须传 false。传 true 的话，预设会把它自己的出厂光学值写回滑块，
 * 把 Iris 在这一档上调过的值当场冲掉 —— 表现是「圆角调好了，一刷新又回去了」，
 * 而且她根本不会想到是切档的代码干的（09-01 报的：radius 存了 9，刷新后是 30）。 */
export function setPreset(name, { optics = true } = {}) {
  const p = PRESETS[name];
  if (!p) return _preset;
  _preset = name;
  try { localStorage.setItem(LS_PRESET, name); } catch { /* 无痕模式，不存就不存 */ }
  _material = p.material;
  for (const w of _wins) w.setMaterial(p.material);
  if (!optics) { applyVis(); dockVis(true); return name; }
  const base = MATERIALS[p.material].glass;
  const g = { ...base, ...(p.glass || {}) };
  /* ⚠️ 预设和「折射强度 / 厚边宽度 / 圆角」那三根滑块**改的是同一组数**。
   * 不把预设的值写回滑块的话，两边各说各的：面板上显示 gain 46，
   * 实际跑的是预设的 42，而且随便动一下别的滑块就把预设覆盖掉了。
   * 一个真相：预设 = 一次性把那三根滑块推到某个位置。 */
  visVals.gain = g.gain; visVals.spread = g.spread;
  visVals.curve = g.curve; visVals.radius = g.radius;
  applyVis();
  dockVis(true);                       // 面板上的滑块跟着跳
  return name;
}
export function getPreset() { return _preset; }

/* ---------------------------------------------------------------------------
 * 2.5 · 材质预设
 *
 * 两套，随时能换，组件代码一行都不用动 —— 差别全在令牌和光学参数上。
 *
 *   glass  玻璃：有厚度、有重量、边缘硬朗，像一块真镜片压在沙滩上。
 *   bubble 泡泡：沿用场景里许愿泡泡的语言 —— 几乎全透，一圈软的虹彩菲涅尔边
 *          + 中间一团内核光。没有重量。折射率按肥皂水给 1.34，色散给足。
 *
 * 换：ui.setMaterial('bubble')，或单个窗口 ui.window({ material: 'bubble' })
 * ------------------------------------------------------------------------- */
export const MATERIALS = {
  glass: {
    cls: 'y2k-mat-glass',
    /* ⚠️ **字色是材质的一部分，不是全局偏好。**
     * 判据（ui.css 1.4 节）：面板比背景亮 → 深字，比背景暗 → 浅字。
     * 玻璃不压暗，是一片被照亮的雾 → 深字；泡泡有熏色、字底往暗里垫 → 浅字。
     * 08-31 走过一个来回：当时想让泡泡也配深字，于是把泡膜洗白去迁就字，
     * 结果泡泡比薄片和出厂还亮，「膜」没了。**先选对极性，再谈垫多少。** */
    ink: 'dark',
    /* ★ 出厂值：Iris 2026-08-31 在真场景里拖出来的。别凭感觉改回去。
     * 方向是「只有最外面一圈在弯，中间完全干净」—— curve 9 几乎是纯 squircle
     * （中心是平的），spread 39 把弯折带收在边上，gain 21 很克制。 */
    glass: { radius: 22, spread: 39, curve: 9, gain: 21, ior: 1.5, dispersion: 0,
             spec: 22, specPower: 12, fresnel: 1.00 },
  },
  bubble: {
    cls: 'y2k-mat-bubble',
    ink: 'light',
    /* 皂膜不是镜片：折射率低、弯得宽而软，薄膜干涉让色散拉满。 */
    glass: { radius: 30, spread: 100, curve: 100, gain: 20, ior: 1.34, dispersion: 34,
             spec: 10, specPower: 6, fresnel: 1.00 },
  },
};

/* ---------------------------------------------------------------------------
 * 2.6 · 四个预设，能在**真场景里**当场切
 *
 * 并排比不出来是正常的：四块玻璃并排时你比的是「它们互相之间的差别」，
 * 而真正要判断的是「这一块压在那片沙滩上、盖住那台笔电时好不好看」。
 * 所以切换器做进 ui.js 而不是做成一个对比页 —— 在 环境预览.html 里直接按键就换，
 * 主窗口那边**一行都不用改**（它已经间接 import 了 ui.js）。
 *
 *   Shift + G      循环切下一个，右下角冒一个小标签告诉你现在是哪个
 *   Shift + Alt+G  切回出厂
 *   ?glass=bubble  地址栏里指定（截图对比的时候好用）
 *
 * 选中的那个存在 localStorage 里，刷新还在。定下来之后把 DEFAULT_PRESET 改掉，
 * 这一整节就可以删了。
 * ------------------------------------------------------------------------- */
export const PRESETS = {
  /* 四档拉开的是**弧面铺多远 + 弯多狠**，不再是「边有多宽」。 */
  /* ② 出厂 = Iris 08-31 拖出来的那组，和 MATERIALS.glass 里的出厂值是同一份。
   * ① 薄片 = 同一个方向再收一半，给「就要一点点」的场合。
   * ③ 泡泡 = 另一种材质，不是同一块玻璃的另一个厚度。
   * 「④ 厚玻璃」08-31 删了 —— Iris：太厚了。 */
  thin:  { label: '① 薄片', material: 'glass',  glass: { spread: 26, curve: 0, gain: 11 } },
  base:  { label: '② 出厂', material: 'glass',  glass: { spread: 39, curve: 9, gain: 21 } },
  bubble:{ label: '③ 泡泡', material: 'bubble', glass: null },
};

let _material = 'glass';
/* 默认深字。场景是**明亮**的白沙滩（宪法 v1.0），玻璃面板整体比背景亮，
 * 浅字压上去会直接消失。想换回浅字：ui.setInk('light')。 */
let _ink = 'dark';

/* ---------------------------------------------------------------------------
 * 3 · 窗口栈
 * 支持一个弹窗上再开一个（比如播放器上弹「关于版权」）。
 * ESC 只关最上面那个；焦点在关闭时还给打开它的那个元素。
 * ------------------------------------------------------------------------- */
const stack = [];

function onKeydown(e) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape' && top.closeOnEsc) {
    e.stopPropagation();
    top.close();
    return;
  }
  if (e.key === 'Tab') trapFocus(e, top.el);
}
document.addEventListener('keydown', onKeydown, true);

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), ' +
                  'select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/* 焦点关在窗口里 —— 弹窗打开时 Tab 不应该跑到背后的页面上去。 */
function trapFocus(e, root) {
  const items = [...root.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ---------------------------------------------------------------------------
 * 3 · 窗口
 *
 * ui.window({
 *   title, sub,            标题栏文字（title 会被大写化 —— 那是 Y2K 的味道）
 *   width, height,         CSS 长度，默认 720 / 640
 *   fixedHeight: false,    true = 高度固定，换内容时窗口不跳（多层导航的窗口用）
 *   keepAlive: false,      true = close() 只是收起（DOM 留着，iframe 不重载），
 *                          再打开用 reopen()，真要拆掉用 destroy()
 *   modal: true,           false = 不铺遮罩，直接挂进 mount 里
 *   mount: document.body,
 *   draggable: true,       标题栏可拖
 *   closeOnScrim: true,    点遮罩关闭
 *   closeOnEsc: true,
 *   onClose,               关闭动画播完之后回调
 * })
 *
 * 返回 { el, win, body, titlebar, footer, setTitle, setView, setFooter,
 *        focus, close, reopen, destroy, parked, closed }
 * ------------------------------------------------------------------------- */
function createWindow(opts = {}) {
  const {
    title = '', sub = '', width = '720px', height = '640px',
    modal = true, mount = document.body,
    draggable = true, closeOnScrim = true, closeOnEsc = true, onClose,
    fixedHeight = false,        // true = 窗口尺寸固定，换内容时不跳（多层导航用）
    compact = false,            // true = 薄标题栏 / 薄页脚，把高度让给内容（迷你播放器那种小窗）
    keepAlive = false,          // true = 关闭只是「收起」，DOM 留着，再开是 reopen()
    material = _material,       // 'glass' | 'bubble'，见 MATERIALS
    /* 不传就跟着材质走（MATERIALS[].ink）。显式传了才按传的来 —— 留给
     * 「我就是要泡泡配深字」那种特例，正常情况下别传。 */
    ink = MATERIALS[material]?.ink ?? _ink,
  } = opts;

  let restoreFocus = document.activeElement;
  let parked = false;

  const titleEl = h('div.y2k-titlebar__title', { id: uid('y2k-title') }, title);
  const subEl   = h('div.y2k-titlebar__sub', sub);
  const btns    = h('div.y2k-titlebar__btns');

  const closeBtn = h('button.y2k-winbtn.y2k-winbtn--close', {
    type: 'button', 'aria-label': '关闭', title: '关闭 (Esc)',
    onclick: () => api.close(),
  }, '×');
  btns.appendChild(closeBtn);

  const titlebar = h('div.y2k-titlebar', h('span.y2k-titlebar__grip'), titleEl, subEl, btns);
  const body     = h('div.y2k-window__body');
  const footer   = h('div.y2k-window__footer', { hidden: true });

  const win = h('div.y2k-window.y2k-glass.y2k-grain' + (fixedHeight ? '.y2k-window--fixed' : ''), {
    role: 'dialog', 'aria-modal': String(modal), 'aria-labelledby': titleEl.id,
    tabindex: '-1',
    style: { '--y2k-w': width, '--y2k-h': height },
  }, titlebar, body, footer);

  const root = modal
    ? h('div.y2k.y2k-scrim', { onpointerdown: e => {
        if (closeOnScrim && e.target === root) api.close();
      } }, win)
    : h('div.y2k', win);

  root.style.zIndex = String(900 + stack.length * 10);
  mount.appendChild(root);

  if (draggable) makeDraggable(win, titlebar); else titlebar.classList.add('is-static');

  /* 材质 + 玻璃光学。三档能力都会挂上（边缘光贴图三档都有），
   * 只有 refract 档才会真的去弯背景。 */
  let mat = MATERIALS[material] ? material : 'glass';
  win.classList.add(MATERIALS[mat].cls);
  /* ⚠️ 两个类都要真的挂上，不能只挂「非默认」的那一个。
   * :root 的出厂值是深字，但深字窗口**也**要挂 y2k-ink-dark ——
   * 一个深字窗口可能开在浅字窗口上面（弹窗套弹窗），靠继承就会读到外面那层的浅字。 */
  win.classList.add(ink === 'light' ? 'y2k-ink-light' : 'y2k-ink-dark');
  if (compact) win.classList.add('y2k-window--compact');
  /* ⚠️ **不要在这里传 MATERIALS[mat].glass。**
   * 那是「材质的出厂值」，传进去会把预设和面板滑块调好的值**当场盖掉** ——
   * 而窗口是每次点开才新建的，所以表现是：面板上怎么调都对，一关一开
   * 又变回 gain 22 / 厚边 30，永远看不到「厚玻璃」那一档在弯什么。
   * （2026-08-31 Iris 报「折射感完全没有」的真因就是这个 —— 她一直在看出厂值，
   *   而 setGlass 只改「已经开着的」窗口，新开的一个都管不到。）
   * 当前该用哪组值住在全局 GLASS 里，setPreset 和面板滑块都往那儿写。
   * 换材质是另一回事，走 api.setMaterial()。 */
  const lens = glass(win);

  /* 镜面高光跟着指针走 —— liquid glass 里「活」的那一下。
   * 只改两个自定义属性，画的事全交给 CSS。
   * 不套 requestAnimationFrame：pointermove 在现代浏览器里本来就是按帧合并的，
   * 而且 rAF 在页面不可见时会被冻住，反而多一个不工作的分支。 */
  function onMove(e) {
    const r = win.getBoundingClientRect();
    if (!r.width || !r.height) return;
    win.style.setProperty('--y2k-mx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
    win.style.setProperty('--y2k-my', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
  }
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerleave', () => {
    win.style.removeProperty('--y2k-mx');
    win.style.removeProperty('--y2k-my');
  });

  let closed = false;
  const api = {
    el: root, win, body, titlebar, footer,
    closeOnEsc,                        // 窗口栈的 Esc 处理要读它

    setTitle(t, s) {
      titleEl.textContent = t ?? '';
      if (s !== undefined) subEl.textContent = s ?? '';
      return api;
    },

    /* 换掉整块内容。两层结构（唱片架 ⇄ 专辑内页）就靠这个切。 */
    setView(...nodes) {
      fill(body, nodes);
      /* ⚠️ 里面装了别人网站的 iframe 时，**整套玻璃都要关掉**。
       * 两个原因，第二个是真 bug：
       *   1. 那是别人的页面，我们没有权利往它上面糊一层白 —— 中间那块
       *      「垫底」的半透明白正好压在人家的排版上。
       *   2. Safari / Firefox 上 -webkit-backdrop-filter 会把**自己的子元素**
       *      一起糊掉（Chromium 不会）。所以 Iris 在外面的浏览器里打开，
       *      整个 a-cocktail 都是模糊的，在 localhost（Chrome）里却是清楚的。
       *      不是那个站的问题，是我们这层玻璃的问题。 */
      win.classList.toggle('has-frame', !!body.querySelector('iframe'));
      if (body.querySelector('iframe')) {
        win.style.backdropFilter = 'none';
        win.style.webkitBackdropFilter = 'none';
      }
      return api;
    },

    setFooter(...nodes) {
      const flat = nodes.flat(Infinity).filter(Boolean);
      fill(footer, flat);
      footer.hidden = flat.length === 0;
      return api;
    },

    focus() {
      const target = win.querySelector(FOCUSABLE) || win;
      target.focus({ preventScroll: true });
      return api;
    },

    /* 关闭。
     * keepAlive: true 的窗口不会被销毁，只是收起来 —— DOM 原样留着，
     * 里面的 iframe 不会重新加载（播放器就靠这个让音乐在关窗后继续放）。
     * 想真的拆掉，调 destroy()。 */
    close() {
      if (closed || parked) return;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      root.classList.add('is-closing');
      win.classList.add('is-closing');

      const done = () => {
        if (keepAlive) {
          parked = true;
          root.classList.remove('is-closing');
          win.classList.remove('is-closing');
          root.classList.add('is-parked');
          root.setAttribute('inert', '');        // 收起来的窗口不该出现在 Tab 序列里
        } else {
          closed = true;
          _wins.delete(api);
          root.remove();
        }
        try { restoreFocus?.focus?.({ preventScroll: true }); } catch { /* 元素可能已经没了 */ }
        onClose?.();
      };
      /* 等关闭动画播完；prefers-reduced-motion 下动画≈0ms，也会正常触发。 */
      let fired = false;
      const once = () => { if (!fired) { fired = true; done(); } };
      win.addEventListener('animationend', once, { once: true });
      setTimeout(once, 400);
    },

    /* 把收起来的窗口重新打开。没被收起来的话就只是把焦点抢回来。 */
    reopen() {
      if (closed) return api;
      if (parked) {
        parked = false;
        root.classList.remove('is-parked');
        root.removeAttribute('inert');
        root.style.zIndex = String(900 + stack.length * 10);
        stack.push(api);
        restoreFocus = document.activeElement;
        /* 重放一次开场动画，否则会「啪」地出现 */
        win.style.animation = 'none';
        void win.offsetWidth;
        win.style.animation = '';
      }
      api.focus();
      return api;
    },

    get parked() { return parked; },
    get closed() { return closed; },
    get material() { return mat; },

    /* 浅字 / 深字。面板整体比背景亮就该用 'dark'。 */
    setInk(name) {
      const dark = name !== 'light';
      win.classList.toggle('y2k-ink-dark', dark);
      win.classList.toggle('y2k-ink-light', !dark);
      return api;
    },

    /* 让窗口被某个颜色轻轻染一下（播放器拿它染成当前唱片的颜色）。
     * 传 null 取消。 */
    setAccent(color) {
      win.style.setProperty('--y2k-album', color || 'transparent');
      return api;
    },

    /* 当场改折射参数（调参页在用）。不支持折射的浏览器上是个空操作。 */
    setLens(opts) { lens.set(opts); return api; },

    /* 当场换材质，不用重开窗口 —— 拿来做 A/B 对比正合适 */
    setMaterial(name) {
      if (!MATERIALS[name] || name === mat) return api;
      win.classList.remove(MATERIALS[mat].cls);
      mat = name;
      win.classList.add(MATERIALS[mat].cls);
      /* 字色跟着材质换。不换的话切到泡泡就是深蓝字压深蓝垫子（见 MATERIALS.glass.ink）。
       * 光学参数**不跟着换** —— 那是滑块和预设说了算的，见上面 createWindow 里那段警告。 */
      const dark = MATERIALS[mat].ink !== 'light';
      win.classList.toggle('y2k-ink-dark', dark);
      win.classList.toggle('y2k-ink-light', !dark);
      return api;
    },

    /* 真的拆掉。keepAlive 的窗口不用了要调这个，否则它会一直留在 DOM 里。 */
    destroy() {
      if (closed) return;
      closed = true;
      _wins.delete(api);
      lens.destroy();
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      root.remove();
    },
  };

  stack.push(api);
  _wins.add(api);
  /* 立刻聚焦，不要等 requestAnimationFrame —— 页面在后台标签页里 rAF 会被节流到几秒一帧，
   * 焦点就一直留在背后的页面上（键盘用户会以为弹窗没打开）。
   * preventScroll 保证不会因为聚焦把开场动画顶歪。 */
  api.focus();
  return api;
}

let _uid = 0;
const uid = p => `${p}-${++_uid}`;

/* 标题栏拖动。用 Pointer Events，一套代码管鼠标和触摸。
 * 拖出去会被夹回视口里 —— 千禧年窗口可以拖，但不能拖丢。 */
function makeDraggable(win, handle) {
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.y2k-winbtn')) return;
    if (window.matchMedia('(max-width: 560px)').matches) return;   // 手机上窗口是全屏的，不拖
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    try { handle.setPointerCapture(e.pointerId); } catch { /* 捕获失败也能拖，只是拖出元素会断 */ }
    win.style.transition = 'none';
    win.style.animation = 'none';
  });

  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const r = win.getBoundingClientRect();
    let nx = ox + (e.clientX - sx);
    let ny = oy + (e.clientY - sy);
    /* 夹回视口：至少留 60px 的标题栏在里面 */
    const minX = -(r.left - ox) - r.width + 80, maxX = window.innerWidth - (r.left - ox) - 80;
    const minY = -(r.top - oy), maxY = window.innerHeight - (r.top - oy) - 40;
    nx = Math.max(minX, Math.min(maxX, nx));
    ny = Math.max(minY, Math.min(maxY, ny));
    win.style.transform = `translate(${nx}px, ${ny}px)`;
    win.dataset.dx = nx; win.dataset.dy = ny;
  });

  const end = e => {
    if (!dragging) return;
    dragging = false;
    ox = Number(win.dataset.dx || 0); oy = Number(win.dataset.dy || 0);
    try { handle.releasePointerCapture(e.pointerId); } catch { /* 已经释放过 */ }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/* ---------------------------------------------------------------------------
 * 4 · 组件工厂
 * 全是纯函数：给数据，返回节点。谁都能用，不认识播放器。
 * ------------------------------------------------------------------------- */

/* 按钮 / 外链按钮。给了 href 就渲染成 <a>，自动 target=_blank + rel。 */
function btn({ label, icon, variant, size, href, onClick, disabled, block, ext, title, ...rest } = {}) {
  const cls = ['y2k-btn'];
  if (variant) cls.push(`y2k-btn--${variant}`);
  if (size)    cls.push(`y2k-btn--${size}`);
  if (block)   cls.push('y2k-btn--block');
  if (ext)     cls.push('y2k-ext');

  const kids = [icon && h('span', { 'aria-hidden': 'true' }, icon), label];
  if (href) {
    return h('a.' + cls.join('.'), {
      href, target: '_blank', rel: 'noopener noreferrer', title: title || label, ...rest,
    }, kids);
  }
  return h('button.' + cls.join('.'), {
    type: 'button', disabled: !!disabled, title: title || label,
    onclick: onClick, ...rest,
  }, kids);
}

/* 列表行。
 *   index    左侧序号（播放中会被跳动柱子替掉）
 *   thumb    小缩略图 url
 *   title / sub / meta
 *   active   选中态（左边一条竖线）
 *   playing  正在播放（序号变成柱子）
 *   static   不可点 */
function row({ index, thumb, title, sub, meta, active, playing, static: isStatic, onClick, ...rest } = {}) {
  const cls = ['y2k-row'];
  if (isStatic) cls.push('y2k-row--static');
  if (active)   cls.push('is-active');
  if (playing)  cls.push('is-playing');

  const tag = isStatic ? 'div' : 'button';
  return h(tag + '.' + cls.join('.'), {
    ...(isStatic ? {} : { type: 'button', onclick: onClick }),
    ...rest,
  },
    index != null && h('span.y2k-row__index', String(index)),
    index != null && h('span.y2k-row__bars', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    thumb && h('img.y2k-row__thumb', { src: thumb, alt: '', loading: 'lazy' }),
    h('span.y2k-row__main',
      h('span.y2k-row__title', title),
      sub && h('span.y2k-row__sub', sub),
    ),
    meta && h('span.y2k-row__meta', meta),
  );
}

/* 网格卡片。cover 可以是 url，也可以直接给一个节点（比如占位图形）。 */
function card({ cover, alt = '', label, sub, flag, active, onClick, ...rest } = {}) {
  const cls = ['y2k-card'];
  if (active) cls.push('is-active');
  const art = h('span.y2k-card__art',
    flag && h('span.y2k-card__flag', flag),
    typeof cover === 'string'
      ? h('img', { src: cover, alt, loading: 'lazy', decoding: 'async' })
      : (cover || null),
  );
  return h('button.' + cls.join('.'), { type: 'button', onclick: onClick, ...rest },
    art,
    label && h('span.y2k-card__label', label),
    sub   && h('span.y2k-card__sub', sub),
  );
}

/* 网格容器。列宽默认走 ui.css 的 --y2k-card-w（窄屏会自动放大）；
 * 只有确实要跟全站不一样的网格才传 cardWidth 覆盖它。 */
function grid(children, { cardWidth } = {}) {
  return h('div.y2k-grid', {
    style: cardWidth ? { '--y2k-card-w': cardWidth } : undefined,
  }, children);
}

function list(children) { return h('div.y2k-list', children); }

/* 标签页。items: [{ id, label }]，返回的节点上挂了 .select(id)。 */
function tabs({ items = [], active, onChange } = {}) {
  const el = h('div.y2k-tabs', { role: 'tablist' });
  const nodes = new Map();
  for (const it of items) {
    const t = h('button.y2k-tab', {
      type: 'button', role: 'tab',
      'aria-selected': String(it.id === active),
      onclick: () => { el.select(it.id); onChange?.(it.id); },
    }, it.label);
    if (it.id === active) t.classList.add('is-active');
    nodes.set(it.id, t);
    el.appendChild(t);
  }
  el.select = id => {
    for (const [k, n] of nodes) {
      n.classList.toggle('is-active', k === id);
      n.setAttribute('aria-selected', String(k === id));
    }
  };
  return el;
}

/* 状态页：空 / 载入 / 错误。三种都走这一个组件，视觉才统一。
 *   kind: 'empty' | 'loading' | 'error'
 *   actions: 节点数组（一般是按钮） */
function state({ kind = 'empty', icon, title, text, actions = [], extra } = {}) {
  const ICONS   = { empty: '◌', loading: null, error: '✖' };
  const DEFAULTS = { empty: '空空的', loading: 'LOADING', error: '出了点问题' };
  return h('div.y2k-state', { 'data-kind': kind },
    kind === 'loading' ? h('div.y2k-spinner', { role: 'status', 'aria-label': '载入中' })
                       : h('div.y2k-state__icon', { 'aria-hidden': 'true' }, icon ?? ICONS[kind]),
    h('div.y2k-state__title', title ?? DEFAULTS[kind]),
    text && h('div.y2k-state__text', text),
    extra || null,
    actions.length ? h('div.y2k-state__actions', actions) : null,
  );
}

function scroll(...children)  { return h('div.y2k-scroll', children); }
function section(...children) { return h('div.y2k-section', children); }
function legend(text)         { return h('div.y2k-legend', h('span', text)); }
function divider()            { return h('hr.y2k-divider'); }
function spacer()             { return h('div.y2k-spacer'); }
function note(...children)    { return h('div.y2k-note', children); }
function tag({ label, variant, dot } = {}) {
  return h('span.y2k-tag' + (variant ? `.y2k-tag--${variant}` : ''),
    dot && h('span.y2k-dot'), label);
}

/* 输入框 / 文本域。给许愿页面准备的 —— 组件现在就做，别等到那时候再补。 */
function field({ label, textarea, value = '', placeholder, hint, onInput, ...rest } = {}) {
  const id = uid('y2k-field');
  const input = h((textarea ? 'textarea' : 'input') + (textarea ? '.y2k-textarea' : '.y2k-input'), {
    id, value, placeholder, oninput: onInput, ...rest,
  });
  const wrap = h('label.y2k-field', { for: id },
    label && h('span.y2k-field__label', label),
    input,
    hint && h('span.y2k-note', hint),
  );
  wrap.input = input;
  return wrap;
}

/* 滑块。返回的节点上挂了 .input，方便读值。 */
function slider({ label, value = 100, min = 0, max = 100, step = 1, onInput, ...rest } = {}) {
  const id = uid('y2k-slider');
  const input = h('input.y2k-slider', {
    id, type: 'range', min, max, step, value,
    oninput: e => onInput?.(Number(e.target.value), e), ...rest,
  });
  const wrap = h('label.y2k-field', { for: id },
    label && h('span.y2k-field__label', label),
    input,
  );
  wrap.input = input;
  return wrap;
}

/* 平台 iframe 的凹槽。传 height 撑住高度，避免加载时布局跳。 */
function embed({ height = 152 } = {}) {
  return h('div.y2k-embed', { style: { minHeight: height + 'px' } });
}

/* ---------------------------------------------------------------------------
 * 4.8 · UI 视觉参数 —— 挂进场景那块「✦ 视觉参数」面板里
 *
 * Iris 调 3D 的地方就是那块面板，UI 的参数没道理另开一个地方 ——
 * 所以这里生成一段和它同一套样式的 DOM，**塞进它里面**。
 *
 * ⚠️ 那块面板在 `共用/stage.js`（主窗口的文件），我不改它，只往里 append。
 * 它折叠 / 恢复默认时会整块重建，所以要用 MutationObserver 盯着重新塞。
 * 找不到它（比如在 UI实验室 的单页里）就自己长一个一样的小面板出来。
 *
 * 这些值一律存 localStorage，刷新还在。定稿之后：把选中的值写死进
 * ui.css 的令牌，然后把这一整节删掉。
 * ------------------------------------------------------------------------- */
const LS_VIS = 'y2k-ui-vis';

/* 每一项：改的是哪个 CSS 变量、范围、怎么拼成 CSS 值。
 * 这几个就是「感觉对不对」的全部旋钮 —— 早期截图那种更「厚」的观感，
 * 主要来自更高的白染色 + 有颗粒 + 更实的边。 */
/* def 那一列 = 出厂值，和 ui.css 的令牌、MATERIALS.glass 必须是同一组数
 * （Iris 2026-08-31 拖的）。三处对不上的话，「恢复默认」会跳到一个谁都没见过的样子。 */
const VIS = [
  { k: 'blur',     tag: '模糊',     min: 0, max: 30, step: .5, def: 1 },
  { k: 'sat',      tag: '提饱和',   min: 1, max: 3,  step: .05, def: 1 },
  { k: 'tint',     tag: '白染色',   min: 0, max: 45, step: 1,  def: 10, unit: '%' },
  { k: 'plate',    tag: '内容垫底', min: 0, max: 70, step: 1,  def: 18, unit: '%' },
  { k: 'gain',     tag: '折射强度', min: 0, max: 120, step: 1, def: 21, unit: 'px' },
  { k: 'spread',   tag: '弯折范围', min: 5, max: 100, step: 1, def: 39, unit: '%' },
  { k: 'curve',    tag: '弧面形状', min: 0, max: 100, step: 1, def: 9, unit: '%' },
  { k: 'rim',      tag: '边缘光',   min: 0, max: 2,  step: .05, def: 1 },
  /* 跟着鼠标走的那一点高光 */
  { k: 'specR',    tag: '光斑大小', min: 0, max: 200, step: 2, def: 40, unit: 'px' },
  { k: 'specA',    tag: '光斑强度', min: 0, max: 1,  step: .02, def: .4 },
  { k: 'grain',    tag: '颗粒',     min: 0, max: 20, step: 1,  def: 0, unit: '%' },
  { k: 'radius',   tag: '圆角',     min: 0, max: 40, step: 1,  def: 22, unit: 'px' },
  /* 迷你播放器那一小块的三段留白。差两三个像素就觉得挤，只能当场拖。 */
  { k: 'miniLead', tag: '小窗·线上', min: 0, max: 24, step: 1,  def: 6,  unit: 'px' },
  { k: 'miniGap',  tag: '小窗·线下', min: 0, max: 30, step: 1,  def: 10, unit: 'px' },
  { k: 'miniBtns', tag: '小窗·键距', min: 0, max: 24, step: 1,  def: 6,  unit: 'px' },
];
const visVals = (() => {
  const d = Object.fromEntries(VIS.map(v => [v.k, v.def]));
  try { Object.assign(d, JSON.parse(localStorage.getItem(LS_VIS) || '{}')); } catch { /* 无痕 */ }
  /* ⚠️ 存过的值要**夹回当前的范围**里。范围是会改的 ——
   * 模糊的上限从 20 收到了 8，而浏览器里还存着 14：滑块看上去在最右边，
   * 实际跑的却是一个已经不在选项里的数，而且不去动它就一直好不了。
   * 这和 pick() 要验「这个档还在不在」是同一类问题。 */
  for (const v of VIS) {
    const x = +d[v.k];
    d[v.k] = Number.isFinite(x) ? Math.min(v.max, Math.max(v.min, x)) : v.def;
  }
  return d;
})();

export function applyVis() {
  const r = document.documentElement.style, v = visVals;
  /* --y2k-blur 三档都在用：refract 档是 `url(#滤镜) var(--y2k-blur)` 拼在一起的
   * （曾经以为 Chromium 会把 url() 后面的函数丢掉 —— **那是误判**，见第 2 节 REFRACT）。 */
  r.setProperty('--y2k-blur', `blur(${v.blur}px) saturate(${v.sat}) brightness(1.02)`);
  /* 同 plate：写原始量，各档（玻璃 / 泡泡）自己 calc 出那层白的浓度。
   * 直接写 --y2k-tint 的话，泡泡因为自己声明过一遍，这根滑块在它身上是哑的。 */
  r.setProperty('--y2k-tint-a', (v.tint / 100).toFixed(3));
  /* ⚠️ 主力是 -a（一个纯数字）。深字档 / 泡泡档各自拿它去拼自己那层白，
   * 而不是各写各的 --y2k-plate —— 谁重新声明了 --y2k-plate，
   * 谁的子树就读不到这根滑块了。理由写在 ui.css 第 1 节 --y2k-plate-a 那段。 */
  r.setProperty('--y2k-plate-a', (v.plate / 100).toFixed(3));
  r.setProperty('--y2k-plate', `rgba(255,255,255,${(v.plate / 100).toFixed(3)})`);
  r.setProperty('--y2k-rim-a', String(v.rim));
  r.setProperty('--y2k-spec-r', v.specR + 'px');
  r.setProperty('--y2k-spec-a', String(v.specA));
  r.setProperty('--y2k-grain-a', String(v.grain / 100));
  /* ⚠️ 写 --y2k-r-base，不是 --y2k-r。泡泡档自己声明了 --y2k-r
   * （在 base 上加 8px），直接写 --y2k-r 的话它那一档读不到这根滑块。 */
  r.setProperty('--y2k-r-base', v.radius + 'px');
  r.setProperty('--y2k-mini-lead', v.miniLead + 'px');
  r.setProperty('--y2k-mini-gap', v.miniGap + 'px');
  r.setProperty('--y2k-mini-btns', v.miniBtns + 'px');
  setGlass({ radius: v.radius, gain: v.gain, spread: v.spread, curve: v.curve });
  try { localStorage.setItem(LS_VIS, JSON.stringify(v)); } catch { /* 无痕 */ }
}

/* 生成一段和场景面板同一套样式的 DOM */
function visSection() {
  const wrap = document.createElement('div');
  wrap.dataset.y2kVis = '';
  const head = document.createElement('div');
  head.textContent = 'UI · 弹窗玻璃';
  head.style.cssText = 'margin:10px 0 4px;padding-top:8px;border-top:1px solid #2a2e38;'
    + 'letter-spacing:.16em;font-size:10px;color:#7f8ba0';
  wrap.appendChild(head);
  const warn = document.createElement('div');
  warn.textContent = '折射强度 0 = 只剩模糊那一版。弯折范围/弧面形状拉满 = 整块都在折射。';
  warn.style.cssText = 'font-size:9.5px;line-height:1.5;color:#6f7b8c;margin:0 0 4px';
  wrap.appendChild(warn);

  /* ⚠️ 一条实时的自检。
   * 「折射是不是真的在跑」这件事查了三轮，前两轮都栽在「看着像没有 = 其实没有」上。
   * 把真相直接打在面板上：能力档、当前 gain、**活着的滤镜上真实的 scale**、
   * 挂上折射的窗口数。scale 应该正好是 −2×gain；对不上就是参数没送到。 */
  const stat = document.createElement('div');
  stat.style.cssText = 'font:9.5px/1.5 ui-monospace,monospace;color:#7f9ab5;margin:0 0 6px';
  /* ⚠️ 只报「算出来是什么」是不够的 —— 遮罩那个 backdrop root 的坑就是
   * 计算值全对但根本不生效。所以再报一条：窗口有没有落在某个 backdrop root 里面。 */
  const readStat = () => {
    const w = document.querySelector('.y2k-window');
    if (!w) { stat.textContent = `${GLASS_TIER} · 还没有窗口`; return; }
    let bad = '';
    for (let e = w.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const c = getComputedStyle(e);
      const anim = c.animationName !== 'none';
      if (c.filter !== 'none' || c.opacity !== '1' || (anim && /opacity/i.test(c.willChange))
          || c.backdropFilter !== 'none' || c.willChange !== 'auto') {
        bad = (e.className || e.tagName).split(' ')[0]; break;
      }
    }
    stat.textContent = `${GLASS_TIER} · 生效中：${getComputedStyle(w).backdropFilter}`
      + (bad ? ` · ⚠️ 被 ${bad} 挡住了` : '');
  };
  readStat();
  setInterval(readStat, 700);
  wrap.appendChild(stat);

  /* 「只看玻璃」：把弹窗里所有不透明的内容临时藏掉，只剩那块玻璃压在沙滩上。
   * 真实窗口里内容几乎占满，能看见玻璃的只有边上一圈，弯了也容易被当成没弯 ——
   * 这个开关是用来确认「到底有没有」的，不是一个功能。 */
  const peekRow = document.createElement('label');
  peekRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:0 0 8px;cursor:pointer';
  peekRow.innerHTML = '<input type="checkbox"><span>只看玻璃（把弹窗内容临时藏起来）</span>';
  peekRow.querySelector('input').onchange = e => {
    document.documentElement.classList.toggle('y2k-peek', e.target.checked);
  };
  wrap.appendChild(peekRow);

  for (const it of VIS) {
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:104px 1fr 42px;gap:5px;'
      + 'align-items:center;margin:3px 0';
    const fmt = x => (it.step < 1 ? (+x).toFixed(2) : x) + (it.unit || '');
    row.innerHTML = `<span>${it.tag}</span><input type="range" min="${it.min}" max="${it.max}" `
      + `step="${it.step}" value="${visVals[it.k]}"><b style="text-align:right">${fmt(visVals[it.k])}</b>`;
    const inp = row.querySelector('input'), out = row.querySelector('b');
    inp.oninput = () => { visVals[it.k] = +inp.value; out.textContent = fmt(inp.value); applyVis(); };
    wrap.appendChild(row);
  }

  /* 几选一（玻璃预设、字色、翻页……）：谁注册进来就画谁 */
  for (const o of OPTIONS) {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:104px 1fr;gap:5px;align-items:center;margin:4px 0';
    const tag = document.createElement('span'); tag.textContent = o.tag;
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px';
    o.keys.forEach(k => {
      const b = document.createElement('button');
      b.textContent = o.labels[k];
      const paint = () => {
        b.style.cssText = 'padding:2px 7px;border-radius:10px;cursor:pointer;font:10px ui-monospace,monospace;'
          + (o.get() === k ? 'background:#3d4f66;color:#dbe7f5;border:1px solid #5a7a9c'
                           : 'background:transparent;color:#8b97a8;border:1px solid #2f3542');
      };
      b.onclick = () => { o.set(k); [...box.children].forEach(c => c._paint && c._paint()); };
      b._paint = paint; paint();
      box.appendChild(b);
    });
    row.append(tag, box);
    wrap.appendChild(row);
  }

  /* 和场景面板一个流程：调好 → 复制 → 贴回代码。
   * ⚠️ UI 的值**不在** ENV 里，所以场景那颗「复制参数 JSON」导不出它们，
   * 得有自己这一颗，否则调完的东西只活在这台浏览器的 localStorage 里。 */
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;margin-top:8px';
  const copy = document.createElement('button');
  copy.textContent = '复制 UI 参数';
  copy.style.cssText = 'flex:1;padding:4px 8px;cursor:pointer';
  copy.onclick = () => {
    const out = { ...visVals };
    for (const o of OPTIONS) out[o.id] = o.get();
    navigator.clipboard.writeText(JSON.stringify(out, null, 2));
    copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制 UI 参数'; }, 1200);
  };
  const reset = document.createElement('button');
  reset.textContent = '恢复默认';
  reset.style.cssText = 'padding:4px 8px;cursor:pointer';
  reset.onclick = () => {
    VIS.forEach(v => { visVals[v.k] = v.def; });
    applyVis(); dockVis(true);
  };
  row.append(copy, reset);
  wrap.appendChild(row);
  return wrap;
}

/* 找场景那块面板：它没有 id / class，只能靠开头那句「视觉参数」认。
 * 认不出来就返回 null，调用方自己长一个。 */
function findScenePanel() {
  for (const d of document.querySelectorAll('body > div')) {
    if (d.style.position === 'fixed' && /^视觉参数/.test(d.textContent || '')) return d;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * 调参面板 = **调试期的脚手架**，上线的站上不该有。
 *
 * Iris 09-01：「视觉参数效果我后台还是要自己调，不过上线的网站里能不能不要有
 * 这个视觉参数的小方框？」—— 所以不是删掉，是**只在开发环境露出来**。
 *
 * 判据（满足任意一条就算开发中）：
 *   · 跑在 localhost / 127.0.0.1 / ::1 上（自己电脑上调参，永远算）
 *   · 地址里带 ?dev=1（线上临时开一下，改完关掉标签页就没了）
 *   · localStorage 里存了 y2k-dev=1（线上长期开着，只在自己这台机器上）
 *
 * ⚠️ 用主机名判断，不要用 UA、也不要留一个「上线前记得改成 false」的常量 ——
 * 那种常量的结局一定是忘了改。这样写的话，**部署出去自动就是关的**。
 *
 * 关掉之后连带没有的：UI 参数那一段、Shift+U、Shift+G 切玻璃、
 * 场景自己那颗「✦ 视觉参数」按钮和它的面板（见 hideDevChrome）。 */
export const DEV = (() => {
  try {
    /* 地址栏说了算，两个方向都算：
     *   ?dev=1  线上临时打开
     *   ?dev=0  **在自己电脑上看访客看到的样子** —— 上线前用它验一遍，
     *           不然「面板藏没藏干净」这件事在 localhost 上永远验不了。 */
    const q = new URLSearchParams(location.search).get('dev');
    if (q === '1') return true;
    if (q === '0') {
      /* ⚠️ 这个参数会**粘在地址栏里**。09-01 Iris 用它验完访客视角、
       * 之后一直找不到调参面板，就是因为标签页里还留着 ?dev=0。
       * 所以关掉的时候在控制台喊一声，别让人对着一个空屏幕猜。 */
      console.info('[y2k] 地址里有 ?dev=0，调试面板（✦ 视觉参数 / Shift+U / 整理模式）已隐藏。去掉这个参数刷新就回来。');
      return false;
    }
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return true;
    return localStorage.getItem('y2k-dev') === '1';
  } catch { return false; }
})();

/* 场景那颗「✦ 视觉参数」和它展开的面板是 stage.js 建的（不归 UI 窗口）。
 * 不去改它的代码 —— 只在非开发环境把它藏起来。藏的是**显示**，不是功能：
 * 加 ?dev=1 刷新一下它就回来了，逻辑一行没动。 */
function hideDevChrome() {
  if (DEV) return;
  for (const b of document.querySelectorAll('body > button')) {
    if (/视觉参数/.test(b.textContent || '')) b.style.display = 'none';
  }
  const panel = findScenePanel();
  if (panel) panel.style.display = 'none';
}

let _visOwn = null;
function dockVis(force) {
  if (!DEV) { hideDevChrome(); return false; }
  const host = findScenePanel();
  if (host) {
    const old = host.querySelector('[data-y2k-vis]');
    if (old && !force) return true;
    old?.remove();
    /* 插在「复制参数 JSON / 恢复默认」那排按钮**前面** ——
     * 追加到最后的话那两颗按钮会被顶到看不见的地方，而它们是每次调完都要点的。 */
    const btns = [...host.children].find(
      c => c.tagName === 'DIV' && /复制参数/.test(c.textContent || ''));
    host.insertBefore(visSection(), btns || null);
    _visOwn?.remove(); _visOwn = null;
    return true;
  }
  /* 场景面板不在（UI实验室的单页）→ 自己长一个一样的 */
  if (_visOwn && !force) return false;
  _visOwn?.remove();
  _visOwn = document.createElement('div');
  _visOwn.style.cssText = 'position:fixed;top:12px;left:12px;width:262px;max-height:92vh;overflow-y:auto;'
    + 'background:rgba(18,21,28,.93);color:#aab2c0;font:11px/1.5 ui-monospace,monospace;'
    + 'padding:10px 12px;border-radius:8px;border:1px solid #2a2e38;z-index:9999';
  _visOwn.innerHTML = '<b style="letter-spacing:.12em">UI 参数</b> <small>（Shift+U 开关）</small>';
  _visOwn.appendChild(visSection());
  document.body.appendChild(_visOwn);
  return false;
}

if (typeof window !== 'undefined') {
  applyVis();
  /* 场景面板是点开才建、折叠/恢复默认时整块重建的，所以要一直盯着 */
  const mo = new MutationObserver(() => {
    if (!DEV) { hideDevChrome(); return; }
    if (findScenePanel()) dockVis();
  });
  hideDevChrome();
  addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true }));
  if (document.readyState !== 'loading') mo.observe(document.body, { childList: true });
}

/* ---------------------------------------------------------------------------
 * 4.85 · 「几选一」的注册表
 *
 * 谁有选项谁注册进来，上面 4.8 的 UI 参数里会自动多一行：
 *
 *     ui.registerOption({ id, tag, keys, labels, get, set })
 *
 * 只有一个面板 —— 场景那块「✦ 视觉参数」。分散在各处的快捷键和页脚按钮
 * Iris 记不住，也不该记。全部定稿之后这一节和 4.8 一起删。
 * ------------------------------------------------------------------------- */
const OPTIONS = [];
export function registerOption(o) {
  const i = OPTIONS.findIndex(x => x.id === o.id);
  if (i >= 0) OPTIONS[i] = o; else OPTIONS.push(o);
  dockVis(true);                       // 面板已经在了就补一行进去
}

/* ---------------------------------------------------------------------------
 * 4.9 · 预设切换器（临时的，选定之后整节删掉）
 * ------------------------------------------------------------------------- */
let _toast = null, _toastT = 0;
function toast(text) {
  if (!_toast) {
    _toast = h('div.y2k-toast', { 'aria-live': 'polite' });
    document.body.appendChild(_toast);
  }
  _toast.textContent = text;
  _toast.classList.add('is-on');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => _toast.classList.remove('is-on'), 1600);
}

if (typeof window !== 'undefined') {
  /* 地址栏优先于 localStorage —— 想截一组对比图的时候不用先去清缓存 */
  let boot = new URLSearchParams(location.search).get('glass');
  if (!PRESETS[boot]) { try { boot = localStorage.getItem(LS_PRESET); } catch { boot = null; } }
  /* 恢复上次选的那一档：只换材质，**不要动滑块** —— 理由见 setPreset 的注释。 */
  if (PRESETS[boot] && boot !== DEFAULT_PRESET) setPreset(boot, { optics: false });

  /* Shift+G 循环。用 code 而不是 key —— key 在 Shift 下是大写 'G'，
   * 而且换成别的键盘布局就对不上了。 */
  window.addEventListener('keydown', e => {
    if (!DEV) return;                        // 调试快捷键不带上线
    if (!e.shiftKey || e.metaKey || e.ctrlKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.code === 'KeyG') {
      e.preventDefault();
      const next = e.altKey ? DEFAULT_PRESET
        : PRESET_ORDER[(PRESET_ORDER.indexOf(_preset) + 1) % PRESET_ORDER.length];
      setPreset(next);
      toast(`玻璃 ${PRESETS[next].label}   ·   Shift+G 换下一个`);
    } else if (e.code === 'KeyU') {          // UI 参数
      e.preventDefault();
      if (findScenePanel()) toast('UI 参数在「✦ 视觉参数」面板里（E 开关）');
      else if (_visOwn) { _visOwn.remove(); _visOwn = null; }
      else dockVis(true);
    }
  });

  /* 玻璃那四档拉开的全是折射参数，折射停用之后它们没有任何区别 ——
   * 所以不再摆到面板上。REFRACT 打开时把这段放回来即可。 */
  if (REFRACT) {
    registerOption({
      id: 'glass', tag: '玻璃',
      keys: PRESET_ORDER,
      labels: Object.fromEntries(PRESET_ORDER.map(k => [k, PRESETS[k].label])),
      get: () => _preset,
      set: v => setPreset(v),
    });
  }
}

/* ---------------------------------------------------------------------------
 * 5 · 导出
 * ------------------------------------------------------------------------- */
export const ui = {
  window: createWindow,
  /* 把任意元素变成玻璃。三档都能调，返回的对象永远不是 null。
   * ui.tier: 'refract' 真折射 | 'blur' 只有模糊 | 'flat' 连模糊都没有。 */
  glass, setGlass, tier: GLASS_TIER, GLASS,
  /* UI 参数：挂在场景那块「✦ 视觉参数」面板里（第 4.8 节）。
   * 谁有「几选一」就自己 registerOption 进来。 */
  registerOption, applyVis,
  /* 四个预设，Shift+G 在真场景里当场切（见第 2.6 节）。选定之后这三行连同那一节一起删。 */
  PRESETS, setPreset, get preset() { return _preset; },
  MATERIALS,
  /* 改全站默认材质（之后新开的窗口都用它） */
  setMaterial(name) { if (MATERIALS[name]) _material = name; return ui; },
  get material() { return _material; },
  /* 全站默认字色。'dark' 配亮面板，'light' 配暗面板。 */
  setInk(name) { _ink = name === 'dark' ? 'dark' : 'light'; return ui; },
  get ink() { return _ink; },
  btn, row, card, grid, list, tabs, state,
  scroll, section, legend, divider, spacer, note, tag,
  field, slider, embed,
  h, fill,
  /* 当前最上面那个窗口，调试和「关掉所有弹窗」时有用 */
  get top() { return stack[stack.length - 1] || null; },
  closeAll() { [...stack].reverse().forEach(w => w.close()); },
};

export default ui;
