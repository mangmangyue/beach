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
const PRESET_ORDER = ['thin', 'base', 'thick', 'bubble'];
const DEFAULT_PRESET = 'base';
const LS_PRESET = 'y2k-glass-preset';

/* 出厂参数。Iris 在 UI实验室/玻璃.html 上拖滑块调，调好点「导出」贴回这里。 */
export const GLASS = {
  radius:     22,     /* 圆角半径 px。跟 --y2k-r 对齐，不然折射的形状和窗口对不上 */
  thickness:  30,     /* 厚边宽度 px：穹顶从边缘弯到平坦中心用掉这么宽的一条带子 */
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

/* 穹顶断面：x = 从边缘往里的深度（0 边缘 / 1 中心），返回表面倾角 θi。
 * 单独抽出来是为了能在实验室里把这条曲线画出来看。 */
export function domeSlope(x) {
  const u = 1 - Math.min(1, Math.max(0, x));
  const den = 1 - u * u * u * u;
  if (den <= 1e-9) return Math.PI / 2;              /* 边缘：竖直下折 */
  return Math.atan((u * u * u) / Math.pow(den, 0.75));
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
  const sig = [w, h, o.radius, o.thickness, o.ior, o.spec, o.specPower, o.fresnel,
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
  const band = Math.max(1, o.thickness);
  const cx = w / 2, cy = h / 2;
  const ix = cx - radius, iy = cy - radius;      /* 直边段的半长 */

  /* 断面只跟「离边界多远」有关，跟在哪条边上无关 —— 所以整条曲线预先算成一张表，
   * 每像素只做一次查表 + 一次插值。十五万次 atan/asin 会明显卡开窗那一帧。 */
  const LUT = 256, bendT = new Float32Array(LUT), sinT = new Float32Array(LUT), cosT = new Float32Array(LUT);
  for (let i = 0; i < LUT; i++) {
    const th = domeSlope(i / (LUT - 1));
    bendT[i] = snellBend(th, o.ior) / bendMax;   /* 归一到 0~1，幅度全交给 scale */
    sinT[i] = Math.sin(th); cosT[i] = Math.cos(th);
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
      if (dist >= 0) {
        const t = Math.min(1, dist / band);      /* 0 = 边缘，1 = 平坦中心 */
        const j = t * (LUT - 1), j0 = j | 0, f = j - j0, j1 = j0 + 1 < LUT ? j0 + 1 : j0;
        const bend = bendT[j0] + (bendT[j1] - bendT[j0]) * f;
        const st   = sinT[j0]  + (sinT[j1]  - sinT[j0])  * f;
        const ct   = cosT[j0]  + (cosT[j1]  - cosT[j0])  * f;

        const k = bend * 127;
        r = 128 + nx * k; g = 128 + ny * k;
        if (r < 0) r = 0; else if (r > 255) r = 255;
        if (g < 0) g = 0; else if (g > 255) g = 255;

        /* 同一个表面的法线，拿去算反射。V = (0,0,1)。 */
        const Nx = nx * st, Ny = ny * st, Nz = ct;
        const ndv = Nz;                                                   /* N·V */
        const Rx = 2 * ndv * Nx, Ry = 2 * ndv * Ny, Rz = 2 * ndv * Nz - 1;  /* 反射向量 */

        /* 菲涅尔：正对着看只反 4%，掠射角几乎全反 —— 所以最亮的永远是最外面那一线。 */
        const F = 0.04 + 0.96 * Math.pow(1 - Math.max(0, ndv), 5);

        /* 环境：反射朝上 = 天（1.0），朝下 = 沙（0.65），贴着地平线 = 0.30。
         * 这一项才是「一圈边绕过去亮度不均」的来源。 */
        const up = Ry < 0 ? -Ry : 0, dn = Ry > 0 ? Ry : 0;
        const env = 0.45 + 0.55 * Math.pow(up, 0.7) + 0.30 * Math.pow(dn, 1.6);

        /* 太阳：一颗有方向的小亮点，落在斜面上朝着光的那一段。
         * spec 是**太阳相对天空的亮度倍数**，所以它是个大数（十几）而不是 0~1 ——
         * 斜面在那个角度只反射 4%（F 很小），但太阳本身比天空亮几个量级，
         * 乘完才是我们眼睛看到的那道最亮的弧。两项都乘 F 才是同一套光学。 */
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

  if (GLASS_TIER === 'refract') {
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
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (!w || !h) return;
    const sig = `${w}x${h}|${JSON.stringify(o)}`;
    if (!force && sig === last) return;
    last = sig;

    /* 位移图缩着算：图很平滑，拉开看不出来，但省一大截时间 */
    const k = Math.min(1, MAP_MAX / Math.max(w, h));
    const mw = Math.max(8, Math.round(w * k)), mh = Math.max(8, Math.round(h * k));
    const maps = buildMaps(mw, mh, { ...o, radius: o.radius * k, thickness: o.thickness * k });

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
     * CSS 里的 backdrop-filter，「模糊 / 饱和」两个令牌彻底失效。 */
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

export function setPreset(name) {
  const p = PRESETS[name];
  if (!p) return _preset;
  _preset = name;
  try { localStorage.setItem(LS_PRESET, name); } catch { /* 无痕模式，不存就不存 */ }
  _material = p.material;
  for (const w of _wins) w.setMaterial(p.material);
  const base = MATERIALS[p.material].glass;
  setGlass({ ...base, ...(p.glass || {}) });
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
    glass: { radius: 22, thickness: 30, gain: 22, ior: 1.5, dispersion: 0,
             spec: 22, specPower: 12, fresnel: 1.00 },
  },
  bubble: {
    cls: 'y2k-mat-bubble',
    /* 皂膜不是镜片：折射率低、膜薄（thickness 大而 gain 小 = 弯得宽而软），
     * 薄膜干涉让色散拉满。 */
    glass: { radius: 30, thickness: 64, gain: 10, ior: 1.34, dispersion: 34,
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
 *   ?glass=thick   地址栏里指定（截图对比的时候好用）
 *
 * 选中的那个存在 localStorage 里，刷新还在。定下来之后把 DEFAULT_PRESET 改掉，
 * 这一整节就可以删了。
 * ------------------------------------------------------------------------- */
export const PRESETS = {
  thin:  { label: '① 薄片',   material: 'glass',  glass: { thickness: 16, gain: 10 } },
  base:  { label: '② 出厂',   material: 'glass',  glass: { thickness: 30, gain: 22 } },
  thick: { label: '③ 厚玻璃', material: 'glass',  glass: { thickness: 48, gain: 42 } },
  bubble:{ label: '④ 泡泡',   material: 'bubble', glass: null },
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
    keepAlive = false,          // true = 关闭只是「收起」，DOM 留着，再开是 reopen()
    material = _material,       // 'glass' | 'bubble'，见 MATERIALS
    ink = _ink,                 // 'light' | 'dark' —— 面板比背景亮就用 dark
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
  if (ink === 'dark') win.classList.add('y2k-ink-dark');
  const lens = glass(win, MATERIALS[mat].glass);

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
    setView(...nodes) { fill(body, nodes); return api; },

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
    setInk(name) { win.classList.toggle('y2k-ink-dark', name === 'dark'); return api; },

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
      lens.set(MATERIALS[mat].glass);
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
 * 4.85 · 设置面板 —— 所有「几选一」的唯一入口
 *
 * 上线之后 Iris 还要在**真场景里**慢慢调这些（玻璃厚度、相册主页长什么样、
 * 翻页怎么翻）。分散在各处的快捷键和页脚按钮她记不住，也不该记 ——
 * 所以做一个面板，谁有选项谁自己注册进来：
 *
 *     ui.registerOption({ id, tag, keys, labels, get, set })
 *
 * 打开：**Shift + U**（或 ui.settings()）。选择一律存 localStorage，刷新还在。
 * 全部定稿之后，这一节连同各处的 registerOption 一起删掉。
 * ------------------------------------------------------------------------- */
const OPTIONS = [];
export function registerOption(o) {
  const i = OPTIONS.findIndex(x => x.id === o.id);
  if (i >= 0) OPTIONS[i] = o; else OPTIONS.push(o);
}

let _settingsWin = null;
export function settings() {
  if (_settingsWin && !_settingsWin.closed) { _settingsWin.reopen(); return _settingsWin; }
  const win = createWindow({ title: '外观', sub: 'SETTINGS', width: '440px', keepAlive: true });
  _settingsWin = win;

  function sync() {
    OPTIONS.forEach((o, i) => {
      const seg = win.body.querySelectorAll('.y2k-seg')[i];
      if (!seg) return;
      [...seg.children].forEach((b, k) => b.classList.toggle('is-on', o.keys[k] === o.get()));
    });
  }
  function build() {
    win.setView(h('div.y2k-set',
      ...OPTIONS.map(o => h('div.y2k-set__row',
        h('div.y2k-set__tag', o.tag),
        h('div.y2k-seg', o.keys.map(k => h('button.y2k-seg__b', {
          type: 'button',
          /* 有的选项会改别的选项要不要出现（比如主页选了「叠放」才有排布和叠法），
           * 所以整块重建一次，而不是只同步选中态。 */
          onclick: () => { o.set(k); build(); },
        }, o.labels[k]))))),
      h('p.y2k-note', '选的东西存在这台浏览器里，刷新还在。Shift + U 随时开关。')));
    sync();
  }
  build();
  win.setFooter(spacer(), btn({ label: '知道了', variant: 'primary', onClick: () => win.close() }));
  return win;
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
  if (PRESETS[boot] && boot !== DEFAULT_PRESET) setPreset(boot);

  /* Shift+G 循环。用 code 而不是 key —— key 在 Shift 下是大写 'G'，
   * 而且换成别的键盘布局就对不上了。 */
  window.addEventListener('keydown', e => {
    if (!e.shiftKey || e.metaKey || e.ctrlKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.code === 'KeyG') {
      e.preventDefault();
      const next = e.altKey ? DEFAULT_PRESET
        : PRESET_ORDER[(PRESET_ORDER.indexOf(_preset) + 1) % PRESET_ORDER.length];
      setPreset(next);
      toast(`玻璃 ${PRESETS[next].label}   ·   Shift+G 换下一个`);
    } else if (e.code === 'KeyU') {          // 设置面板
      e.preventDefault();
      if (_settingsWin && !_settingsWin.closed && !_settingsWin.parked) _settingsWin.close();
      else settings();
    }
  });

  /* 玻璃自己也是一组「几选一」，注册进设置面板 */
  registerOption({
    id: 'glass', tag: '玻璃',
    keys: PRESET_ORDER,
    labels: Object.fromEntries(PRESET_ORDER.map(k => [k, PRESETS[k].label])),
    get: () => _preset,
    set: v => setPreset(v),
  });
}

/* ---------------------------------------------------------------------------
 * 5 · 导出
 * ------------------------------------------------------------------------- */
export const ui = {
  window: createWindow,
  /* 把任意元素变成玻璃。三档都能调，返回的对象永远不是 null。
   * ui.tier: 'refract' 真折射 | 'blur' 只有模糊 | 'flat' 连模糊都没有。 */
  glass, setGlass, tier: GLASS_TIER, GLASS,
  /* 设置面板（Shift+U）。谁有「几选一」就自己 registerOption 进来。 */
  settings, registerOption,
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
