/* 物件 · 酒 —— 五杯候选鸡尾酒
 *
 * 和贝壳、酒瓶一样：这里没有一行光照 / 后处理 / 相机代码，
 * 只有一张材质表、一份排序规则和两种摆法。光、雾、颗粒、景深、接触阴影
 * 全部来自 共用/stage.js，所以五杯和唱机、贝壳活在同一个世界里。
 *
 * ── 材质分配（规格_物件通用.md 第二节）────────────────────────────
 *   杯子   玻璃档，不给固有色 —— 走 ENV.bottle，五杯的杯子完全一样。
 *          杯子不是性格所在，它是让五杯可比的那个常量。
 *   酒液   玻璃档的变体：不透明度 70（vs 玻璃 58）、边缘透光压到 45%、内核压到 20%。
 *          「边缘透光一高酒的颜色就被冲淡」是规格里写死的坑，别调回去。
 *   冰块   玻璃档的变体，反过来：更透（30）、边缘更亮（120%）。
 *   装饰   实体档，过 grade() + satBoost()。它们是这个物件的性格来源，
 *          同时是对照组 —— 旁边有不透明的东西，透光的才看得出在透光。
 *
 * ── 绘制顺序（这个物件唯一一处「假的更像」）──────────────────────
 *   杯子是单层壳（没有内壁），冰壳材质是 transparent + depthWrite:false，
 *   所以顺序必须自己排。物理上正确的排法是
 *       远壁 → 冰 → 酒 → 近壁
 *   但那样近壁的 58% 会盖在酒上，实测下来**任何颜色的酒都读不出来**：
 *   58 的白纱一蒙，饱和橙红变成藕粉，蓝色夏威夷变成灰蓝。
 *   （数值上：杯壁贡献 0.58×255 的白，酒本身只剩三成话语权。）
 *
 *   所以这里改成：
 *       远壁 → 近壁 → 酒 → 杯里的装饰 → 冰 → 杯外的装饰
 *   酒画在杯壁**之上**。这不是物理正确的，但宪法 一点五 说得很清楚：
 *   「不要用真实折射…参考图里的质感是风格化的，假的更像」。
 *   代价是「隔着玻璃看酒」那一层衰减没有了，换来的是酒真的有颜色。
 *   面板上的「酒在杯前 / 酒在杯后」可以现场切回物理顺序对比。
 *
 *   杯子仍然拆成 BackSide / FrontSide 两个 mesh：同一个 DoubleSide mesh 里
 *   正反面按几何体顺序画，会有自交的接缝；拆开就没有。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStage } from '../../共用/stage.js';
import { ENV, grade, gradeImageData } from '../../共用/constitution.js';

const canvas = document.getElementById('view');
const Q = new URLSearchParams(location.search);
const LAYOUT = Q.get('layout') === 'row' ? 'row' : 'single';
const PICK = Q.get('c') || 'sunrise';
// ?only=aperol,sunrise,blue —— 并排图只放这几杯（Iris 08-22 收到中间三杯）
const ONLY = (Q.get('only') || '').split(',').map(s => s.trim()).filter(Boolean);

/* 机位：五杯单张用同一组参数（同机位同光，方便横向比），并排图退远、正一点。 */
// 并排图的距离跟着杯数走：三杯就凑近，不然中间三杯挤在画面中间一小条
const ROW_DIST = { 1: 0.34, 2: 0.44, 3: 0.54, 4: 0.66, 5: 0.76 }[ONLY.length || 5];
const CAM = LAYOUT === 'row'
  ? { target: new THREE.Vector3(0, 0.112, 0), distance: ROW_DIST, azimuth: 0.09, polar: Math.PI / 2 - 0.15 }
  : { target: new THREE.Vector3(0, 0.105, 0), distance: 0.52, azimuth: 0.30, polar: Math.PI / 2 - 0.20 };
const stage = createStage(canvas, CAM);
/* 浪关掉。这是选型用的对比图：潮水一涨，杯子背后的沙从灰变成一片白泡沫，
 * 五张图的底就不一样了，横向比就没意义。真场景里当然有浪（窗口 A 的事）。 */
stage.params.waveOn = 0;

/* ---- 三个「玻璃档的变体」（杯子 / 酒液 / 冰块）----
 * 玻璃档原样（不透明度 58 · 边缘 ×0.52 · 内核 ×0.35）是给**酒瓶**调的：
 * 瓶子要有一团奶白的存在感。杯子不是 —— 一只空杯子在画面上应该几乎不存在，
 * 只剩一条边和几处高光。照玻璃档做出来的杯子在发光，而且是整片发光（Iris，08-22）。
 *
 * 三个数一起改才有用：
 *   内核 → 0    「内核发光」是从物件身体里透出来的一团光，那是灵魂体档的事。
 *               玻璃档带 ×0.35 是杯子整片发白的主因，不是边缘的锅。
 *   锐度 → 340  ENV.rimP 是 160（f = (1-n·v)^1.6），这么低的指数下 f 在整个曲面上都不小，
 *               「边缘透光」其实是**整片加白**。指数提到 3.4，光才真的收到轮廓上，
 *               变成宪法 二·1 要的那条「细亮线」，而不是一层雾。
 *   不透明度 → 20  杯子是单层壳但正反两面都画，58 叠起来是 0.82，那是牛奶不是玻璃；
 *               20 叠起来是 0.36，空的那段杯身才像空的。
 *
 * 酒液和冰块反过来：酒要实，冰要透、边要亮。
 *
 * 酒液的不透明度 62：闭合回转体走 DoubleSide，一条视线穿近壁 + 远壁两层，
 * 杯身里实际是 1-(1-0.62)² ≈ 0.86 —— 规格写的「70 左右、比杯子更实一点」落在这个区间。
 * 留下的两成不是浪费：**泡在酒里的吸管和樱桃靠它才看得见**，
 * 一杯完全不透的酒，插在里面的吸管会读成「贴在杯子前面」（Iris 08-22）。
 * 内核 16 是「一点点发光」：内核加在 (1-f) 上，也就是加在**正对相机的中间**，
 * 不是边上 —— 这正是宪法一点五说的「身体里有一团光」。再高颜色就开始泛白。
 */
const GLASS = { alpha: 20, rim: 100, rimP: 340, core: 0 };
const LIQ   = { alpha: 62, rim: 12, rimP: 200, core: 16 };
const ICE   = { alpha: 26, rim: 130, rimP: 260, core: 0 };

// 两份杯子材质（同一档，只是 side 不同）。走 stage.materials.ice 是为了让它们进 stage 的注册表；
// 档位本身由 refreshTiers 每帧覆盖。
const glassBackMat = stage.materials.ice('glass');  glassBackMat.side = THREE.BackSide;
const glassFrontMat = stage.materials.ice('glass'); glassFrontMat.side = THREE.FrontSide;

/* ---- 材质表 ---- */
// 透光件：颜色不过 grade()（stage 的 iceMaterial 本来就是 raw），
// 所以这里写的就是画面上看到的颜色。太艳就在这张表上收，别去动 共用/。
const ICE_MATS = {
  M_Glass:      { tier: 'glass' },                                  // 无色银白，走 ENV.bottle
  M_LiqGimlet:  { tier: 'liquid', color: '#D3E58A' },               // 清透淡黄绿
  M_LiqAperol:  { tier: 'liquid', color: '#EE6608' },               // 饱和橙红
  M_LiqSunrise: { tier: 'liquid', color: '#F0731E', map: 'tex/sunrise.png' },  // 颜色在贴图里
  M_LiqBlue:    { tier: 'liquid', color: '#00A2D8' },               // 饱和青蓝
  M_IceCube:    { tier: 'ice',    color: '#EAF6FA' },
};
// 实体件：过 grade() + satBoost()。emissive 是珠光那一招（同贝壳）——
// 背光面一灰，小装饰就成了黑点。
/* 实体件：过 grade() + satBoost()。
 * emissive 是贝壳那一招，这里比贝壳还重要：装饰全是**立着正对相机的片**，
 * 而主光从左上后方来（stage 的 keyDir），片的法线和光几乎垂直 ——
 * 不给自发光，橙片就是一块深灰的椭圆。有贴图的用 emissiveMap，
 * 不然自发光是一层平白，会把贴图冲掉。 */
const SOLID_MATS = {
    // 奶白不透明：第五杯的全部性格。自发光给得比别的高很多（0.40）——
  // 酒液是一圈**竖直的**壁，而主光从左上后方来，不给自发光它是块深卡其色。
  // 这不是「让它发光」，是把这个世界里唯一一块没有光照到的大面积拉回它本来的明度。
  M_LiqColada:  { color: '#F2E3C4', rough: 0.52, emissive: 0.40 },
  M_LimeRind:   { color: '#7BA63A', rough: 0.52, emissive: 0.16 },
  M_LimeFlesh:  { color: '#DCE9AE', rough: 0.44, emissive: 0.20, fruit: 0.45 },
  M_LimeFleshD: { color: '#C6DA8E', rough: 0.44, emissive: 0.20, fruit: 0.45 },
  // 橙片：真橙子对着光是透的，边缘尤其。不透明度 0.88 + 一圈菲涅尔边光 +
  // 自发光调高 —— 三件事一起才像「一片会透光的果肉」，而不是一张贴纸（Iris 08-22）
  M_Orange:     { color: '#FFFFFF', rough: 0.50, map: 'tex/orange.png', emissive: 0.32, fruit: 0.45 },
  M_OrangeRind: { color: '#E8912A', rough: 0.50, emissive: 0.26, fruit: 0.35 },
  M_Cherry:     { color: '#B4232E', rough: 0.28, emissive: 0.20 },
  M_CherryStem: { color: '#6E7A46', rough: 0.62, emissive: 0.12 },
  M_MintLeaf:   { color: '#5D8C46', rough: 0.56, emissive: 0.18, doubleSide: true },
  M_MintStem:   { color: '#84A55E', rough: 0.60, emissive: 0.12 },
  M_PineFlesh:  { color: '#F2C64A', rough: 0.58, emissive: 0.22, fruit: 0.35 },
  M_PineRind:   { color: '#B98A3C', rough: 0.66, emissive: 0.14 },
  M_UmbA:       { color: '#F0A8B8', rough: 0.62, emissive: 0.20, doubleSide: true },
  M_UmbB:       { color: '#F7F0E4', rough: 0.62, emissive: 0.18, doubleSide: true },
  M_UmbStick:   { color: '#D9C79E', rough: 0.70, emissive: 0.12 },
  M_StrawA:     { color: '#F5F2EC', rough: 0.36, emissive: 0.14 },
  M_StrawB:     { color: '#E8635C', rough: 0.36, emissive: 0.18 },
};

/* 贴图：实体件的贴图逐像素过 grade()（统一器 5，同唱机 / 酒瓶）；
 * 透光件的贴图不过 —— 冰壳材质的 uColor 本来就是 raw，两边得一致，
 * 否则同一杯酒的「有贴图版」和「纯色版」不在一个色域里。 */
function loadTexGraded(path, mat) {
  const img = new Image();
  img.onerror = () => console.warn('贴图加载失败:', path);
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    ctx.putImageData(gradeImageData(ctx.getImageData(0, 0, c.width, c.height)), 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    mat.map = t;
    if (mat.emissiveIntensity) mat.emissiveMap = t;   // 自发光跟着贴图走，不是一层平白
    mat.needsUpdate = true;
  };
  img.src = path;
}
function loadTexRaw(path) {
  const t = new THREE.TextureLoader().load(path);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/* 果肉的边缘透光。和贝壳 main.js 里那份是同一招：MeshStandardMaterial +
 * onBeforeCompile 加一项菲涅尔，输出封顶 1.0（不封顶 bloom 会把边糊成白光）。
 * 差别是这里不乘顶点色的「薄度」—— 一片橙子整片都是薄的。 */
function addFruitRim(m, s) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uFruitS = { value: s };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFN; varying vec3 vFP;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvFN = normalize(mat3(modelMatrix) * normal); vFP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFruitS; varying vec3 vFN; varying vec3 vFP;')
      .replace('#include <dithering_fragment>',
        `{ vec3 n = normalize(vFN); vec3 v = normalize(cameraPosition - vFP);
           float f = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 1.9);
           gl_FragColor.rgb = min(gl_FragColor.rgb + diffuseColor.rgb * f * uFruitS, vec3(1.0)); }
         #include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => 'fruitRim' + s;
  return m;
}

const liquidMats = [], iceCubeMats = [];
const cache = new Map();
function getMaterial(name) {
  if (cache.has(name)) return cache.get(name);
  let m;
  const s = ICE_MATS[name];
  if (s) {
    m = stage.materials.ice('glass', { color: s.color || null, map: s.map ? loadTexRaw(s.map) : null });
    // 酒液是闭合回转体，走 DoubleSide：一条视线穿过近壁和远壁两层。
    // 材质的不透明度就是规格写的 70，但杯身里实际叠成 1-(1-0.7)² ≈ 0.91 ——
    // 一碗酒本来就比一张 70% 的膜更实，这正是规格说的「比杯子更实一点」。
    // 只画一层的话三成亮沙透上来，饱和橙红会变成藕粉（试过了）。
    if (s.tier === 'liquid') { m.side = THREE.DoubleSide; liquidMats.push(m); }
    else if (s.tier === 'ice') { iceCubeMats.push(m); }
  } else {
    const d = SOLID_MATS[name] || { color: '#B9BFC6', rough: 0.5 };
    m = stage.materials.solid(d.map ? '#FFFFFF' : d.color, { rough: d.rough });
    if (d.emissive) {
      m.emissive = new THREE.Color(d.map ? '#FFFFFF' : grade(d.color, 'emissive'));
      m.emissiveIntensity = d.emissive;
    }
    if (d.doubleSide) m.side = THREE.DoubleSide;
    if (d.fruit) { m.transparent = true; m.opacity = 0.88; addFruitRim(m, d.fruit); }
    if (d.map) loadTexGraded(d.map, m);
  }
  cache.set(name, m);
  return m;
}

/* 每帧把三个变体档写回 uniform：stage.applyParams() 会按 ICE_TIERS 把它们刷回玻璃档，
 * 所以覆盖必须放在 render 之前，不能只在创建时写一次。（同贝壳的 refreshRim）
 * rim 是乘在 ENV.rimS 上的倍率（跟着宪法的全局边缘强度走），rimP 是绝对指数（不跟 ENV）。
 *
 * **不能只挂在 requestAnimationFrame 里**：标签页不在前台时浏览器不跑 rAF，
 * 而「存图」是直接调 stage.render() 的 —— 于是后台存出来的图会是没覆盖过的玻璃档。
 * 所以凡是会重置 uniform 的地方（applyParams / 载入完 / 存图前）都显式再调一次。 */
function refreshTiers() {
  const put = (m, t) => {
    m.uniforms.uAlpha.value = t.alpha / 100;
    m.uniforms.uRimS.value = ENV.rimS / 100 * t.rim / 100;
    m.uniforms.uRimP.value = t.rimP / 100;
    m.uniforms.uCoreS.value = ENV.core / 100 * t.core / 100;
  };
  put(glassBackMat, GLASS); put(glassFrontMat, GLASS);
  liquidMats.forEach(m => put(m, LIQ));
  iceCubeMats.forEach(m => put(m, ICE));
}
/* stage 的参数一改就会把三个变体档刷回玻璃档，所以这两件事必须成对出现 */
function applyStage() { stage.applyParams(); refreshTiers(); }

/* ---- 装配 ---- */
/* 两套顺序，面板上可以切。front = 酒画在杯壁之上（默认，见文件头）；
 * back = 物理正确的排法，用来对比「杯壁 58% 到底吃掉多少颜色」。 */
const ORDERS = {
  front: { glassBack: 0, glassFront: 1, garnishin: 2, liquid: 3, ice: 4, garnish: 5 },
  back:  { glassBack: 0, garnishin: 1, ice: 1, liquid: 2, glassFront: 3, garnish: 4 },
};
let orderMode = Q.get('order') === 'back' ? 'back' : 'front';

/* 「一点点液体晃动」（Iris 08-22 / 宪法 六：场景永远在轻微地动）。
 * 做法是给酒液套一个支点在**它自己几何中心**的 Group，然后拿两个不同频率的正弦
 * 慢慢地倾 ±0.6°。支点必须在酒液中心，不能用杯子的原点 ——
 * 原点在杯底，绕它转 0.6° 到液面就是 1.4mm 的横移，酒会从杯壁里钻出去
 * （酒液和杯壁之间只留了 WALL = 2.6mm 的缝）。支点在中心时位移只有 0.2mm。
 * 幅度到此为止：再大就不是「一杯放在那儿的酒」，是有人在晃杯子。 */
const sloshers = [];
const SLOSH = 0.011;

/* 折射（Iris 08-22：「吸管可以加一点折射的感觉，水面接触面和上面露出的地方」）。
 * 一杯液体装在圆柱形的杯子里就是一个**柱面透镜**：水面以下的东西，
 * 在画面上会被**沿着水平方向、绕杯子的轴放大**。所以水下那截吸管
 *   —— 位置往外挪，同时自己也变粗，
 * 而水面以上那截不动 —— 交界处于是断开一截，这就是「折射」看起来的样子。
 *
 * 实现不是给它加个偏移量（那样只在一个机位对），是真的做一次**沿相机右方向的缩放**：
 *   A( rotY = θ, scaleX = M ) → B( rotY = -θ ) → 水下的装饰
 * 合起来是 R(θ)·S·R(-θ)，也就是「在相机右方向上放大 M 倍，绕杯轴」。
 * 相机转到哪，效果都对；转到吸管正对镜头时错位自然消失 —— 物理上本来就该消失。
 *
 * M 的上限是算出来的：吸管在液面处离轴 2.19cm、自身半径 0.36cm，
 * 放大之后的外缘 (2.19+0.36)·M 不能超过杯子外壁 3.52cm，所以 M ≤ 1.38。
 * 取 1.30 —— 水下那截会贴到内壁上，这正是真的透过一杯饮料看到的样子。 */
const REFRACT = 1.30;
const refractors = [];

const cocktails = new Map();      // key -> { group, info }
let manifest = null;

function buildCocktail(nodes, info) {
  const group = new THREE.Group();
  group.name = info.key;
  for (const node of nodes) {
    const part = node.userData.part;
    node.position.set(0, 0, 0);
    if (part === 'glass') {
      const front = node.clone();
      node.traverse(o => { if (o.isMesh) { o.material = glassBackMat; o.userData.slot = 'glassBack'; } });
      front.traverse(o => { if (o.isMesh) { o.material = glassFrontMat; o.userData.slot = 'glassFront'; } });
      group.add(node, front);
      stage.markGlass(node); stage.markGlass(front);
      continue;
    }
    if (part === 'liquid') {
      const b = new THREE.Box3().setFromObject(node);
      const c = b.getCenter(new THREE.Vector3());
      const sp = info.sloshPivot || [0, 0];
      c.set(sp[0], c.y, sp[1]);          // 水平位置 = 吸管穿过液面那一点，高度取酒液中心
      const pivot = new THREE.Group();
      pivot.position.copy(c);
      node.position.sub(c);
      pivot.add(node);
      group.add(pivot);
      sloshers.push({ pivot, phase: sloshers.length * 1.9 });
    }
    if (part === 'garnishin' && !info.opaqueLiquid) {
      const outer = new THREE.Group(), inner = new THREE.Group();
      outer.add(inner); inner.add(node); group.add(outer);
      outer.scale.x = REFRACT;
      refractors.push({ outer, inner });
    }
    node.traverse(o => {
      if (!o.isMesh) return;
      o.material = getMaterial(o.material?.name || '');
      o.userData.slot = part;
      // 装饰本来是不透明的，这里让它进透明队列（opacity 仍是 1，照常写深度，
      // 所以互相遮挡还是对的）。进了透明队列才能自己排位置：
      // 杯里的（garnishin）排在酒液**之前** —— 泡着的那截被酒盖住、染上酒色，
      // 露出液面的那截不染，「插在酒里」这件事就是这么免费得来的；
      // 酒身里实际不透明度约 0.91，排在前面的话吸管和杯底的樱桃会整个消失。
      // 陷沙的坑要对准杯脚。装饰挂在口沿外，算进包围盒的话坑会偏到杯子旁边去，
      // noBounds 让 stage.measure() 跳过它们（沙滩窗口给屏幕光晕用的同一个开关）。
      // 装饰和「不透明的酒液」都要进透明队列（opacity 仍是 1，照常写深度）：
      // 不透明队列在所有透明件之前，排在那里就会被杯壁的白纱盖住 ——
      // 椰林飘香第一版整杯是纯白的，原因就是这个，不是奶白色本身太淡。
      if (part === 'garnish' || part === 'garnishin' || (part === 'liquid' && info.opaqueLiquid)) {
        o.material.transparent = true; o.material.opacity = 1;
      }
      if (part !== 'liquid') o.userData.noBounds = true;
    });
    if ((part === 'liquid' && !info.opaqueLiquid) || part === 'ice') stage.markGlass(node);
    // 酒液挂在晃动支点上、水下的装饰挂在折射支点上，都已经进 group 了
    if (part !== 'liquid' && !(part === 'garnishin' && !info.opaqueLiquid)) group.add(node);
  }
  return group;
}

function applyOrder() {
  const O = ORDERS[orderMode];
  for (const { group } of cocktails.values()) {
    group.traverse(o => { if (o.isMesh && o.userData.slot) o.renderOrder = O[o.userData.slot] ?? 0; });
  }
}

/* 杯子的回转轴在原点，接触半径 = 底座半径（不能用包围盒——装饰挂在口沿外，
 * 用包围盒算出来的坑会比杯脚大一倍）。 */
function place(group, info, x) {
  group.position.set(x, 0, 0);
  stage.sink(group, { radius: info.contactRadius });
  stage.world.add(group);
}

const label = document.getElementById('label');
const ROW_GAP = 0.128;

Promise.all([
  fetch('cocktails.json').then(r => r.json()),
  new Promise(res => new GLTFLoader().load('cocktails.glb', res)),
]).then(([man, gltf]) => {
  manifest = man;
  const byKey = {};
  for (const node of [...gltf.scene.children]) {
    (byKey[node.userData.cocktail] ||= []).push(node);
  }
  const list = LAYOUT === 'row' ? (ONLY.length ? ONLY.map(k => man.cocktails.find(c => c.key === k)).filter(Boolean)
                                              : man.cocktails)
             : (man.cocktails.filter(c => c.key === PICK).length ? man.cocktails.filter(c => c.key === PICK)
                                                                 : [man.cocktails[0]]);
  list.forEach((info, i) => {
    const g = buildCocktail(byKey[info.key], info);
    place(g, info, LAYOUT === 'row' ? (i - (list.length - 1) / 2) * ROW_GAP : 0);
    cocktails.set(info.key, { group: g, info });
  });
  applyOrder();
  applyStage();
  const t = man.cocktails.reduce((n, c) => n + c.tris, 0);
  label.innerHTML = LAYOUT === 'row'
    ? list.map(c => `${c.name} <i>· ${c.type}</i>`).join('\n') + `\n<i>五杯共 ${t} 面</i>`
    : (() => { const c = list[0]; return `${c.cn}\n<i>${c.type}</i>\n<i>${c.glass} · 高 ${(c.glassHeight * 100).toFixed(1)}cm · ${c.tris} 面</i>`; })();
  document.getElementById('loading')?.remove();
  window.__dbg = { cocktails, cache, stage, THREE, ENV, LIQ, ICE, manifest };
});

let last = performance.now(), clock = 0;
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  clock += dt;
  // 折射的缩放轴要跟着机位转：θ 是「相机右方向」的方位角
  if (refractors.length) {
    const m = stage.camera.matrixWorld.elements;
    const th = Math.atan2(-m[2], m[0]);
    for (const { outer, inner } of refractors) { outer.rotation.y = th; inner.rotation.y = -th; }
  }
  for (const { pivot, phase } of sloshers) {
    pivot.rotation.x = Math.sin(clock * 0.62 + phase) * SLOSH;
    pivot.rotation.z = Math.sin(clock * 0.41 + phase * 1.7) * SLOSH * 0.8;
  }
  refreshTiers();
  stage.render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---- 面板 ---- */
const ui = document.getElementById('panel');
const STAGE_SLIDERS = [
  ['grain', '颗粒', 0, 60, 1], ['glow', '柔光', 0, 40, 1],
  ['exposure', '曝光', 0.6, 1.8, 0.01], ['shadow', '接触阴影', 0, 1, 0.02],
  ['softness', '影子软度', 0.5, 9, 0.25], ['dof', '景深', 0, 0.03, 0.001],
];
const TIER_SLIDERS = [
  [GLASS, 'alpha', '杯·不透明', 0, 90, 1], [GLASS, 'rim', '杯·边缘透光', 0, 150, 1],
  [GLASS, 'rimP', '杯·边缘锐度', 100, 800, 10], [GLASS, 'core', '杯·内核', 0, 100, 1],
  [LIQ, 'alpha', '酒·不透明', 30, 100, 1], [LIQ, 'rim', '酒·边缘透光', 0, 100, 1],
  [LIQ, 'core', '酒·内核', 0, 100, 1],
];
function slider(host, label, min, max, step, get, set) {
  const row = document.createElement('label');
  row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${get()}"><b>${get()}</b>`;
  const [inp, out] = [row.querySelector('input'), row.querySelector('b')];
  inp.oninput = () => { set(+inp.value); out.textContent = inp.value; };
  host.appendChild(row);
}
if (ui) {
  STAGE_SLIDERS.forEach(([k, l, mi, ma, st]) =>
    slider(ui, l, mi, ma, st, () => stage.params[k], v => { stage.params[k] = v; applyStage(); }));
  ui.appendChild(document.createElement('hr'));
  TIER_SLIDERS.forEach(([o, k, l, mi, ma, st]) => slider(ui, l, mi, ma, st, () => o[k], v => { o[k] = v; }));

  const views = document.createElement('div');
  views.className = 'views';
  [['正面', 0, 60], ['3/4', 30, 60], ['侧面', 80, 66], ['俯视', 12, 26]].forEach(([n, az, po]) => {
    const b = document.createElement('button');
    b.textContent = n;
    b.onclick = () => setView(az * Math.PI / 180, po * Math.PI / 180);
    views.appendChild(b);
  });
  ui.appendChild(views);

  let row2 = document.createElement('div'); row2.className = 'views';
  const mk = (txt, fn, on) => {
    const b = document.createElement('button'); b.textContent = txt; b.onclick = fn;
    if (on) b.classList.add('on'); row2.appendChild(b); return b;
  };
  ['gimlet', 'aperol', 'sunrise', 'blue', 'colada'].forEach((k, i) =>
    mk(['金汤力', '橙红', '日出', '蓝', '奶白'][i], () => { location.search = `?c=${k}`; }, LAYOUT === 'single' && PICK === k));
  mk('并排', () => { location.search = LAYOUT === 'row' ? `?c=${PICK}` : '?layout=row'; }, LAYOUT === 'row');
  ui.appendChild(row2);
  const row3 = document.createElement('div'); row3.className = 'views';
  const mk3 = (txt, fn, on) => { const b = document.createElement('button'); b.textContent = txt; b.onclick = fn;
    if (on) b.classList.add('on'); row3.appendChild(b); return b; };
  let bFront, bBack;
  const setOrder = m => { orderMode = m; applyOrder();
    bFront.classList.toggle('on', m === 'front'); bBack.classList.toggle('on', m === 'back'); };
  bFront = mk3('酒在杯前', () => setOrder('front'), orderMode === 'front');
  bBack = mk3('酒在杯后', () => setOrder('back'), orderMode === 'back');
  mk3('浪', () => { stage.params.waveOn = stage.params.waveOn ? 0 : 1; applyStage(); });
  ui.appendChild(row3);
  const row4 = document.createElement('div'); row4.className = 'views';
  row2 = row4;
  const b4 = document.createElement('button');
  b4.textContent = '存图';
  b4.onclick = () => (LAYOUT === 'row' ? captureRow() : captureAs(null));
  row4.appendChild(b4);
  ui.appendChild(row4);
}

function setView(az, po) {
  const c = stage.controls, t = c.target;
  const d = stage.camera.position.distanceTo(t);
  stage.camera.position.set(t.x + d * Math.sin(po) * Math.sin(az),
                            t.y + d * Math.cos(po),
                            t.z + d * Math.sin(po) * Math.cos(az));
  c.update();
}
window.setView = setView;

/* ---- 存图 ----
 * 单杯：直接存 canvas。
 * 并排：底下拼一条字幕带，把杯名写在各自的正下方 —— 横向比的时候
 *       没有名字就得数第几个，所以这条带子是必需的，不是装饰。 */
function post(name, dataUrl) {
  return fetch(`/save?dir=${encodeURIComponent('物件_酒')}&name=${encodeURIComponent(name)}.png`,
               { method: 'POST', body: dataUrl })
    .then(r => { if (!r.ok) throw 0; return name; })
    .catch(() => {
      const a = document.createElement('a'); a.download = name + '.png'; a.href = dataUrl; a.click();
      return name;
    });
}
function captureAs(n) {
  refreshTiers();                  // 后台标签页里 rAF 不跑，存图前必须自己刷一次
  stage.render(1 / 60);
  const name = n || `酒_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  return post(name, canvas.toDataURL('image/png'));
}
function captureRow(n) {
  refreshTiers();
  stage.render(1 / 60);
  const W = canvas.width, H = canvas.height, dpr = W / canvas.clientWidth;
  const strip = Math.round(52 * dpr);
  const c = document.createElement('canvas');
  c.width = W; c.height = H + strip;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  ctx.fillStyle = '#0B0E14'; ctx.fillRect(0, H, W, strip);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const v = new THREE.Vector3();
  [...cocktails.values()].forEach(({ group, info }) => {
    v.set(group.position.x, 0.05, 0).project(stage.camera);
    const x = (v.x * 0.5 + 0.5) * W;
    ctx.fillStyle = '#D6DCE4';
    ctx.font = `${Math.round(15 * dpr)}px -apple-system,"PingFang SC",sans-serif`;
    ctx.fillText(info.name, x, H + strip * 0.36);
    ctx.fillStyle = '#7C8798';
    ctx.font = `${Math.round(12 * dpr)}px -apple-system,"PingFang SC",sans-serif`;
    ctx.fillText(info.type.split(' · ')[0], x, H + strip * 0.72);
  });
  return post(n || '06_五杯并排', c.toDataURL('image/png'));
}
window.captureAs = captureAs;
window.captureRow = captureRow;

addEventListener('keydown', e => { if (e.key === 'h' || e.key === 'H') ui?.classList.toggle('hidden'); });
