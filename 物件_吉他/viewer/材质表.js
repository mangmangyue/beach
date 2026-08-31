/* 物件 · 吉他 —— 材质表（viewer 和 调色台 共用同一份）
 *
 * 为什么要抽出来：这两个页面**必须给出一模一样的颜色**。
 * 调色台里挑的色，到场景里要是偏了，那这个台子就白做了。
 * 所以光照、调色变换、材质参数全部走这一份，两边只是外壳不同。
 *
 * 颜色**不写死在模型里**：glb 的材质只带个名字，真正的值在 PALETTE 里，
 * 而 PALETTE 又优先读 localStorage —— 在调色台里改完，viewer 刷新就是新的。
 */
import { ENV, grade, satBoost } from '../../共用/constitution.js';
import { applyBeachLighting, registerEnvI } from '../../共用/光照.js';

export const LS_KEY = 'guitar.palette.v1';

/* 12 + 2 个材质槽。顺序 = 调色台里从上到下的顺序，按"面积从大到小、木头在前"排。
 *   map    —— 灰度木纹（只压暗，不带颜色）。three 里 map × color，所以换颜色纹理跟着走
 *   rim    —— [强度倍率, 幂次]。边缘那条亮线：深色件靠它在白沙上不读成一个洞，
 *             浅色件靠它把倒角和转折"啃"出来（设备窗口踩出来的做法）
 *   envI   —— 这块料的「反射性格」。硝基亮光漆面比木头本身更靠这个立住。
 *             ⚠️ 它**不直接生效**（2026-08-27 统一光照）：生效的是
 *             `1 + (envI-1) × ENV.envVar%`，见 共用/光照.js 的 registerEnvI。
 *             全场只有「材质反射差异」一个滑块决定这些性格被放大多少 ——
 *             0 = 所有材质一模一样，100 = 下面这些数原样，150 = 比原来更拉开。
 *   emis   —— 一点点自发光。**不是让它发光**，是让暗部不掉到 0
 *   irid   —— 彩贝的虹彩强度（只有音孔圈和琴头那只鸟有）
 */
export const SLOTS = [
  { key: 'M_Top',       name: '面板',      hint: '云杉直纹 · 全场最大的一块浅色',
    map: 'grain_fine.png', rough: 0.26, envI: 1.10, rim: [2.6, 3.0] },
  { key: 'M_Back',      name: '背侧板',    hint: '玫瑰木 · 背板 + 侧板同一个槽',
    map: 'grain_wave.png', rough: 0.30, envI: 1.00, rim: [2.2, 2.6], emis: 0.06 },
  { key: 'M_Neck',      name: '琴颈',      hint: '枫木 · 连琴头木体',
    map: 'grain_fine.png', rough: 0.38, envI: 0.85, rim: [1.8, 2.8] },
  { key: 'M_Fretboard', name: '指板',      hint: '深色 · 别调成纯黑',
    map: 'grain_wave.png', rough: 0.44, envI: 0.70, rim: [1.6, 2.4], emis: 0.07 },
  { key: 'M_Headstock', name: '琴头贴面',  hint: '琴头正面那层薄片',
    map: 'grain_wave.png', rough: 0.32, envI: 0.90, rim: [1.8, 2.6], emis: 0.06 },
  { key: 'M_Bridge',    name: '琴桥',      hint: '鸟形下码',
    map: 'grain_wave.png', rough: 0.34, envI: 0.85, rim: [2.0, 2.6], emis: 0.06 },
  { key: 'M_Rosette',   name: '音孔圈',    hint: '彩贝 · 和沙滩上的贝壳同一种材质',
    rough: 0.18, envI: 1.60, rim: [3.4, 2.2], irid: 0.22 },
  { key: 'M_Binding',   name: '镶边',      hint: '琴身边缘那条线 · 轮廓全靠它',
    rough: 0.24, envI: 1.20, rim: [3.0, 3.2] },
  { key: 'M_Pickguard', name: '护板',      hint: '参考的那把琴没有 · 默认不显示',
    rough: 0.22, envI: 1.30, rim: [2.4, 2.8], emis: 0.05 },
  { key: 'M_Gold',      name: '五金（金）', hint: '旋钮 + 弦钮 Gotoh 381',
    rough: 0.20, envI: 1.90, rim: [4.2, 2.4], emis: 0.10 },
  { key: 'M_String',    name: '弦',        hint: '六根极细的长方体，不是圆柱',
    rough: 0.22, envI: 1.50, rim: [3.6, 2.0], emis: 0.08 },
  { key: 'M_Fret',      name: '品丝',      hint: '20 根镍银',
    rough: 0.20, envI: 1.60, rim: [3.4, 2.2], emis: 0.06 },
  { key: 'M_Bone',      name: '骨点',      hint: '上弦枕 / 下弦枕 / 缚弦钉',
    rough: 0.36, envI: 1.00, rim: [2.4, 2.6] },
  { key: 'M_Cavity',    name: '音孔内壁',  hint: '音孔里那团暗 · 别真的调成黑洞',
    rough: 0.86, envI: 0.30, rim: [1.2, 2.0], emis: 0.05 },
];

/* 出厂配色。低饱和 —— 规格_物件通用 第三节：暖色焦点归花、第二焦点归酒，
 * 吉他属于"其余物件"，它的活是**让那两个显出来**。
 * Iris 会自己改，所以这里只是个起点，不是结论。 */
/* ⚠️ 这里写的颜色**不是**你最终看到的颜色。
 * 每个色都要过一遍宪法的调色变换 `grade()`（constitution.js 第三节），
 * 而那个变换会**掉 4~10 点饱和**（s_out ≈ 0.88 × s_in + 2）。
 * 2026-08-28 Iris 的反馈：「吉他是所有里面有点脏的，还有点暗」—— 就是这么来的：
 * 面板 #E3D2B0 过完变换是 #DFCFB7，一块灰米色的硬纸板，不是云杉；
 * 背侧板 #6B4636 亮度只有 31%，在 L≈85 的白沙滩上是全画面最重的一块。
 *
 * 所以下面这组值是**反解出来的**：先定"我想看到什么颜色"，再倒推该往这里写什么。
 * 每行注释里的 `→` 后面是过完变换、真正渲出来的颜色。改颜色的时候别忘了这一层，
 * 或者直接用调色台（`物件_吉他/调色台.html`）—— 它和场景走同一套光和同一个变换，
 * 那里看到的就是场景里的。
 */
export const DEFAULT_PALETTE = {
  M_Top:       { color: '#F8E3A5', rough: 0.26 },        // → #EFDCB0 云杉，暖蜜色（原来是灰米色）
  M_Back:      { color: '#92573A', rough: 0.30 },        // → #8A5A44 玫瑰木，提亮一档 + 偏红（原来 L31% 太重）
  M_Neck:      { color: '#EBD293', rough: 0.38 },        // → #E3CB9E 枫木
  M_Fretboard: { color: '#4D3328', rough: 0.44 },        // → #4B342C 指板：还是深，但不再是个洞
  M_Headstock: { color: '#92573A', rough: 0.32 },        // → #8A5A44 和背侧板同料
  M_Bridge:    { color: '#4D3328', rough: 0.34 },        // → #4B342C 和指板同料
  M_Rosette:   { color: '#E2D8C1', rough: 0.18, irid: 0.22 },  // → #DFD6C5 彩贝
  M_Binding:   { color: '#FAF0D6', rough: 0.24 },        // → #F6EDDB 镶边：轮廓全靠它，要够亮
  M_Pickguard: { color: '#DDCAA7', rough: 0.22 },        // → #D8C7AE（默认不显示）
  M_Gold:      { color: '#E4BF58', rough: 0.20 },        // → #D6B369 五金
  M_String:    { color: '#D4CFC4', rough: 0.22 },        // → #D4CFC7
  M_Fret:      { color: '#CEC8C0', rough: 0.20 },        // → #CEC9C2
  M_Bone:      { color: '#F6F0DF', rough: 0.36 },        // → #F4EEE2
  M_Cavity:    { color: '#3D2C24', rough: 0.86 },        // → #3B2D27 音孔内壁：别真的调成黑洞
  _showPickguard: false,
};

/* 几组起手式。不是"预设风格"，是**把常见的几种真实用材摆出来**，
 * 省得从零对着色轮猜。挑一个再微调最快。 */
export const PRESETS = {
  '默认 · 云杉 + 玫瑰木': {},
  '全枫木（参考图的枫木版）': {
    M_Top: '#E6D5B4', M_Back: '#D9C49B', M_Neck: '#DCC79E',
    M_Fretboard: '#4A3830', M_Headstock: '#4A3830', M_Bridge: '#3D2E27',
  },
  '桃花芯 · 暖': {
    M_Top: '#DFC9A2', M_Back: '#7A4432', M_Neck: '#9A6448',
    M_Fretboard: '#3B2B23', M_Headstock: '#5E3A2B', M_Bridge: '#33251F',
  },
  '相思木 · 深': {
    M_Top: '#D9C4A0', M_Back: '#5A3A2C', M_Neck: '#8A6448',
    M_Fretboard: '#2F231E', M_Headstock: '#33261F', M_Bridge: '#2C201B',
  },
  '更退一步（怕抢戏时用）': {
    M_Top: '#DCD2BF', M_Back: '#7A6353', M_Neck: '#CFC3AC',
    M_Fretboard: '#4A3E38', M_Headstock: '#4E413A', M_Bridge: '#40352F',
    M_Binding: '#E4DCCB',
  },
  /* 下面四组是 2026-08-29 补的。Iris：「吉他颜色还是有点脏，不够符合整体的轻盈感」。
   * 共同的做法：**把背侧板提亮**（原来 L≈31%，是全画面最重的一块），
   * 并且**降背侧板和面板的明度差** —— "脏"很多时候不是颜色不对，是深浅差太大、
   * 中间那一档被挤没了。
   * ⚠️ 这里写的值都要过一遍 grade()，会掉 4~10 点饱和，所以写进来的比想看到的更饱和一点。 */
  '奶油 · 最轻': {
    M_Top: '#FBEDCB', M_Back: '#D8B892', M_Neck: '#F2DCB0', M_Headstock: '#D8B892',
    M_Fretboard: '#6B5346', M_Bridge: '#6B5346', M_Binding: '#FFF7E4', M_Cavity: '#5A483E',
  },
  '海边褪色木': {
    M_Top: '#F4E7CF', M_Back: '#B79C8C', M_Neck: '#E5D3B8', M_Headstock: '#B79C8C',
    M_Fretboard: '#5E4C46', M_Bridge: '#5E4C46', M_Binding: '#FDF4E6', M_Cavity: '#50423C',
  },
  '蜜色云杉': {
    M_Top: '#FCE3A0', M_Back: '#C98A5E', M_Neck: '#EFD096', M_Headstock: '#C98A5E',
    M_Fretboard: '#5C4034', M_Bridge: '#5C4034', M_Binding: '#FFF3D6', M_Cavity: '#4B352C',
  },
  '灰白 · 最冷': {
    M_Top: '#EFEAE0', M_Back: '#AFA79C', M_Neck: '#E2DCD0', M_Headstock: '#AFA79C',
    M_Fretboard: '#5A5550', M_Bridge: '#5A5550', M_Binding: '#FAF7F0', M_Cavity: '#4C4844',
  },
};

/* 面板上「吉他配色」用的两张表 —— **面板和背侧板分开选**（Iris 2026-08-29）。
 * 整套 PRESETS 上面那些还留着给调色台用；主面板走这两张，因为她要的是
 * 「浅面板 + 某个侧板」这种自由组合，一整套一整套地换配不出来。
 *
 * 每条只写它管的那几个槽，`withLook()` 依次盖在当前调色板上。
 * ⚠️ 这里写的是**过 grade() 之前**的值 —— 那个变换会掉 4~10 点饱和，
 *    所以想要什么颜色，得写得比它更饱和一点（见 DEFAULT_PALETTE 顶上那段）。 */
export const TOP_WOODS = [
  { name: '云杉',   M_Top: '#F8E3A5', M_Neck: '#EBD293', M_Binding: '#FAF0D6' },
  { name: '奶油',   M_Top: '#FBEDCB', M_Neck: '#F2DCB0', M_Binding: '#FFF7E4' },
  { name: '褪色木', M_Top: '#F4E7CF', M_Neck: '#E5D3B8', M_Binding: '#FDF4E6' },
  { name: '蜜色',   M_Top: '#FCE3A0', M_Neck: '#EFD096', M_Binding: '#FFF3D6' },
  { name: '枫木',   M_Top: '#F2E6C6', M_Neck: '#E8D8AE', M_Binding: '#FCF5E2' },
  { name: '灰白',   M_Top: '#EFEAE0', M_Neck: '#E2DCD0', M_Binding: '#FAF7F0' },
];
/* 背侧板连带琴头贴面、指板、琴桥、音孔内壁一起换 —— 它们在真琴上本来就是配套的，
 * 分开选会配出很怪的组合。 */
export const BACK_WOODS = [
  { name: '玫瑰木', M_Back: '#92573A', M_Headstock: '#92573A', M_Fretboard: '#4D3328', M_Bridge: '#4D3328', M_Cavity: '#3D2C24' },
  { name: '浅枫木', M_Back: '#D8B892', M_Headstock: '#D8B892', M_Fretboard: '#6B5346', M_Bridge: '#6B5346', M_Cavity: '#5A483E' },
  { name: '褪色木', M_Back: '#B79C8C', M_Headstock: '#B79C8C', M_Fretboard: '#5E4C46', M_Bridge: '#5E4C46', M_Cavity: '#50423C' },
  { name: '桃花芯', M_Back: '#A9694A', M_Headstock: '#A9694A', M_Fretboard: '#553A2E', M_Bridge: '#553A2E', M_Cavity: '#463026' },
  { name: '相思木', M_Back: '#8A5A42', M_Headstock: '#8A5A42', M_Fretboard: '#48332A', M_Bridge: '#48332A', M_Cavity: '#3B2A23' },
  { name: '灰木',   M_Back: '#AFA79C', M_Headstock: '#AFA79C', M_Fretboard: '#5A5550', M_Bridge: '#5A5550', M_Cavity: '#4C4844' },
];
export const TOP_NAMES = TOP_WOODS.map(w => w.name);
export const BACK_NAMES = BACK_WOODS.map(w => w.name);

/* 调色台还在用这个（一整套一整套地试）。 */
export const PRESET_NAMES = Object.keys(PRESETS);

export function loadPalette() {
  const p = JSON.parse(JSON.stringify(DEFAULT_PALETTE));
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(saved)) {
        if (k[0] === '_') p[k] = saved[k];
        else if (p[k]) Object.assign(p[k], saved[k]);
      }
    }
  } catch (e) { /* 无所谓，退回出厂色 */ }
  return p;
}

export const savePalette = p => localStorage.setItem(LS_KEY, JSON.stringify(p));
export const clearPalette = () => localStorage.removeItem(LS_KEY);

/* ---------------------------------------------------------------- 光
 * 以前这里照抄了一份 stage.js 的光，注释写着「那边改了这边要跟」——
 * 它从来没跟上过：太阳方向一直停在改造前写死的 (-0.42, 0.86, 0.40)，
 * 面板上的 sunAz/sunEl 拖到哪儿调色台都不动，于是调色台里挑的颜色和场景里对不上。
 * 2026-08-27 起两边 import 同一份 共用/光照.js，不再有拷贝。
 * （签名保持 (THREE, renderer, scene) 不变 —— 调色台.html 在用；THREE 那个参数
 *   现在用不上了，留着是为了不改调用方。） */
export function beachLighting(_THREE, renderer, scene) {
  const { key, hemi, refresh } = applyBeachLighting(renderer, scene);
  return { key, hemi, refresh };
}

/* ---------------------------------------------------------------- 材质
 * 边缘亮线 + 彩贝虹彩两段都注在同一个 onBeforeCompile 里。
 *
 * ⚠️ customProgramCacheKey **必须逐材质唯一**（设备窗口踩过，查了很久）：
 * 所有材质返回同一个键的话，three 只为第一个编译出的程序调用 onBeforeCompile，
 * 后面的材质直接复用第一个的 uniforms —— 逐材质的边缘光强度和虹彩全部静默失效，
 * 一句报错都没有。
 */
function inject(THREE, m, slot, uni) {
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGN; varying vec3 vGP;')
      .replace('#include <fog_vertex>',
        '#include <fog_vertex>\nvGN = normalize(mat3(modelMatrix) * normal);\nvGP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform float uRimS, uRimP, uIrid;\nvarying vec3 vGN; varying vec3 vGP;')
      .replace('#include <dithering_fragment>', `{
          vec3 n = normalize(vGN);
          vec3 v = normalize(cameraPosition - vGP);
          float f = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), uRimP);
          if (uIrid > 0.0) {
            /* 彩贝：掠射角上转出一点点虹彩。
             * ⚠️ 原来跨度给的是 g*1.9，让彩虹在音孔圈那一圈**转满一整个色相环**，
             *    （注：这段注释在**模板字符串里**，别写反引号 —— 会把字符串提前闭掉，
             *     报的是 "missing ) after argument list"，看不出跟注释有关。踩过一次。）
             *    渲出来是绕着音孔的一道彩带，读起来像 bug 不像贝壳
             *    （Iris 2026-08-29：「音孔外圈有一圈很奇怪的会变色的颜色」）。
             *    真的彩贝在这个尺寸下只是**微微偏冷偏暖**，不该走完整个虹。
             *    所以把跨度压到 0.42（半个色相都不到），幅度也收窄。 */
            float g = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 1.4);
            vec3 ir = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.20, 0.40) + g * 0.42 + 0.10));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * (0.86 + ir * 0.34), uIrid);
          }
          gl_FragColor.rgb = min(gl_FragColor.rgb + vec3(1.0) * f * uRimS * 0.55, vec3(1.0));
        }
        #include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => 'guitarMat_' + slot.key;
}

/* 造一套材质。返回 { mats, apply, setRaw }：
 *   mats  —— { 材质名: THREE.Material }
 *   apply —— 改完 palette 调一下，颜色/粗糙度/虹彩立刻生效（不重建材质，滑块才跟手）
 *   setRaw—— 切「调色后 ⇄ 原始色」
 */
export function createMaterials(THREE, { texBase = 'tex/', palette }) {
  const loader = new THREE.TextureLoader();
  const texCache = {};
  const tex = name => {
    if (!texCache[name]) {
      const t = loader.load(texBase + name);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      texCache[name] = t;
    }
    return texCache[name];
  };

  const mats = {}, unis = {};
  let raw = false;
  for (const slot of SLOTS) {
    const m = new THREE.MeshStandardMaterial({ metalness: 0, flatShading: false });
    // 木纹是**灰度**的，只压暗不带颜色，所以它**不过 gradeImageData**：
    // 它乘的那个 color 已经过了变换，再把纹理也变换一遍等于叠两次。
    if (slot.map) m.map = tex(slot.map);
    registerEnvI(m, slot.envI ?? 1.0);
    const u = { uRimS: { value: 0.1 }, uRimP: { value: 2.6 }, uIrid: { value: 0 } };
    unis[slot.key] = u;
    inject(THREE, m, slot, u);
    mats[slot.key] = m;
  }

  function apply(p = palette) {
    palette = p;
    for (const slot of SLOTS) {
      const m = mats[slot.key], v = p[slot.key] || {};
      const hex = v.color || DEFAULT_PALETTE[slot.key].color;
      m.color.set(raw ? hex : grade(satBoost(hex)));
      m.roughness = v.rough ?? slot.rough;
      if (slot.emis) {
        // 深色件的暗部不掉到 0 —— 唱机的教训：黑东西在白沙上会读成一个洞
        m.emissive.set(raw ? hex : grade(satBoost(hex)));
        m.emissiveIntensity = slot.emis;
      }
      const u = unis[slot.key];
      u.uRimS.value = ENV.rimS / 100 * ENV.rimPetal / 100 * 1.6 * (slot.rim ? slot.rim[0] : 1);
      u.uRimP.value = slot.rim ? slot.rim[1] : 2.6;
      u.uIrid.value = slot.irid !== undefined ? (v.irid ?? slot.irid) * (ENV.gtIrid ?? 100) / 100 : 0;
      m.needsUpdate = true;
    }
  }
  apply(palette);
  return { mats, apply, setRaw: v => { raw = v; apply(palette); }, isRaw: () => raw };
}
