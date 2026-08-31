/* 标杆物件 · 黑胶唱机 + 唱片
 *
 * 阶段 1 的边界（PROJECT.md）：只定视觉外形和材质，不接真实音乐。
 * 唱片作为可点击物件，暴露 onPlay / onStop —— 阶段 4 接真实音频，阶段 5 做播放器 UI。
 * 现在留了这个口，后面接的时候不用改结构。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStage } from '../../共用/stage.js';
import { grade, gradeImageData } from '../../共用/constitution.js';

const canvas = document.getElementById('view');
const stage = createStage(canvas, { target: new THREE.Vector3(-0.02, 0.13, 0), distance: 0.95 });

/* ================================================================
 * 材质表 —— 写的是物件的**真实颜色**，grade() 负责把它们拉进同一个世界。
 * 《风格宪法》零：锁定风格与质感，不锁定颜色。
 * 深色物件之间刻意拉开明度差，这是"黑色不糊"的做法：
 *   唱片 #17171C < 机身底座 #1E1D22 < 机身 #2B2932 < 转盘 #3A3841
 * ============================================================== */
/* 机身外壳的几种做法。千禧年那批透明硬件（iMac G3、透明 Game Boy）就是这个语言，
 * 而且透明一上，"大块黑色糊成一坨"这个问题直接消失。
 * transmission 走 MeshPhysicalMaterial；ior 1.46 是亚克力，不是玻璃的 1.5。 */
/* 每种外壳配一套底盘色。机身透明时，"透过去看到的"主要就是底盘 ——
 * 底盘还留着黑的话，整块面板照样是黑的，等于白透明了（第一版就是这么翻车的）。 */
const PLINTH_STYLES = {
  black: {
    plinth:  { color: '#2B2932', rough: 0.42 },
    chassis: { color: '#1E1D22', rough: 0.50 },
  },
  smoke: {
    plinth:  { color: '#9A96A0', rough: 0.14, transmission: 0.94, ior: 1.46, thickness: 0.012,
               attenuationColor: '#8C8892', attenuationDistance: 0.34 },
    chassis: { color: '#B6B2AC', rough: 0.62 },
  },
  ice: {
    plinth:  { color: '#B6D0DA', rough: 0.12, transmission: 0.95, ior: 1.46, thickness: 0.012,
               attenuationColor: '#9EC2D2', attenuationDistance: 0.36 },
    chassis: { color: '#BEC6C4', rough: 0.62 },
  },
  amber: {
    plinth:  { color: '#D3B48A', rough: 0.13, transmission: 0.94, ior: 1.46, thickness: 0.012,
               attenuationColor: '#C09354', attenuationDistance: 0.32 },
    chassis: { color: '#C4B49C', rough: 0.62 },
  },
};
let plinthStyle = 'ice';

const MATS = {
  M_Plinth:    { ...PLINTH_STYLES[plinthStyle].plinth },
  M_Chassis:   { ...PLINTH_STYLES[plinthStyle].chassis },
  M_Accent:    { color: '#1E1D22', rough: 0.50 },
  // 防尘罩：**不用 transmission**，用简单半透明。
  // three 的透射材质互相看不见对方 —— 透射的罩子盖在透射的机身上会穿帮。
  // 3mm 的薄亚克力板本来也不需要折射，边缘那圈高光就够卖质感了。
  //
  // 单面 + 低透明度是有原因的：罩子是四片板围成的盒子，双面的话
  // 一条视线要穿过 8 个面，0.2 的不透明度叠 8 次 ≈ 83% 白纱，唱片直接洗没。
  // 单面剔掉背面，只剩 ~2 层，唱片才还是黑的。
  M_DustCover: { color: '#DCE8EC', rough: 0.06, opacity: 0.15, envInt: 2.2 },
  // Y2K 贴纸。双面 —— 从机身另一侧透过去也该看得到它的背面。
  // raw: 不过调色变换。贴纸就是要艳，不受整体配色约束（Iris 定，2026-08-17，
  // 已写进《风格宪法》v0.6.2）。颗粒和柔光照样盖在它上面，统一感由那两层负责。
  M_Sticker:   { color: '#FFFFFF', rough: 0.55, map: 'tex/stickers.png',
                 alpha: true, doubleSide: true, raw: true },
  M_Platter:   { color: '#3A3841', rough: 0.35 },
  // 有贴图的材质：颜色交给贴图，base color 必须留白，否则会把贴图乘没
  // 0.26 时侧掠角度下整张唱片会反成浅灰，"黑胶是黑的"就没了。0.32 保住黑，也还留着那圈光泽
  M_Record:    { color: '#FFFFFF', rough: 0.32, map: null },
  // 金属一律用"软塑料 + 更亮的高光"假装，不单开金属工作流（统一器 3）
  M_Arm:       { color: '#9A968C', rough: 0.22 },
  M_Led:       { color: '#FFE7B4', rough: 0.30, emissive: '#FFD98F', emissiveIntensity: 2.6 },
  // 封套三面：正面封面 / 背面曲目表 / 侧脊。纸的粗糙度高，不反光
  M_SleeveArt:   { color: '#FFFFFF', rough: 0.74, map: null },
  M_SleeveBack:  { color: '#FFFFFF', rough: 0.82, map: null },
  M_SleeveSpine: { color: '#FFFFFF', rough: 0.82, map: null },
};

/* 现在挂在盘上的是哪张。阶段 1 只挂一张；
 * 选唱片的 UI 属于阶段 5（内容层），这里只留换贴图的能力。 */
const MOUNTED = 'kei nishikori meet nujabes';

/* 贴纸先关掉。第一版 Iris 的评价是「太幼稚且太有序」——
 * 几何体和贴图都留着，面板上「贴纸：开/关」随时能开，重做时不用从零来。
 * 重做前要解决的两件事记在 验收.md 的「贴纸（搁置）」一节。 */
const SHOW_STICKERS = false;

/* 贴图加载：解码 → 逐像素过 grade() → 上传。
 * 阶段 3 所有用真实照片的物件都走这条路。 */
function loadTex(path, mat, raw = false) {
  const img = new Image();
  img.onerror = () => console.warn('贴图加载失败:', path);
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    ctx.putImageData(raw ? data : gradeImageData(data), 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;                    // glTF 的 UV 已经是翻过 V 的
    t.magFilter = THREE.LinearFilter;   // 128px 贴图，放大时糊 —— 糊是风格
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    mat.map = t;
    mat.needsUpdate = true;
  };
  img.src = path;
}

function buildMaterial(name) {
  const s = MATS[name];
  if (!s) return new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true });
  const kind = s.emissive ? 'emissive' : 'normal';
  const opts = {
    // 贴图物件的 base color 不过变换（变换已经逐像素做在贴图上了）
    color: new THREE.Color(s.map ? s.color : grade(s.color, kind)),
    roughness: s.rough,
    metalness: 0.0,                 // 全场不开金属
    flatShading: true,              // 硬边低多边形，不做平滑着色（统一器 1）
  };
  // 透明外壳走 MeshPhysicalMaterial。透射色（attenuation）也要过调色变换，
  // 否则透明件会是全场唯一没被统一器处理过的颜色。
  const m = s.transmission
    ? new THREE.MeshPhysicalMaterial({
        ...opts,
        transmission: s.transmission,
        ior: s.ior,
        thickness: s.thickness,
        attenuationColor: new THREE.Color(grade(s.attenuationColor, 'normal')),
        attenuationDistance: s.attenuationDistance,
        transparent: true,
      })
    : new THREE.MeshStandardMaterial(opts);
  if (s.alpha) {
    // alphaTest 而不是 transparent：贴纸是不透明的模切 vinyl，只是形状之外没有东西。
    // 走 transparent 会掉进排序问题，尤其它还贴在一个透射材质上。
    m.transparent = false;
    m.alphaTest = 0.45;
  }
  // 半透明材质里，高光也会被 alpha 乘掉。把环境反射调高一点，
  // 亚克力才有"反着光但看得穿"的样子，而不是一层雾。
  if (s.envInt !== undefined) m.envMapIntensity = s.envInt;
  if (s.opacity !== undefined) {
    m.transparent = true;
    m.opacity = s.opacity;
    m.depthWrite = false;          // 免得罩子把底下的唱片挡掉
  }
  if (s.doubleSide) m.side = THREE.DoubleSide;
  if (s.map) loadTex(s.map, m, s.raw);
  if (s.emissive) {
    m.emissive = new THREE.Color(grade(s.emissive, 'emissive'));
    m.emissiveIntensity = s.emissiveIntensity;
  }
  return m;
}

/* 换机身材质：透明和不透明是两种 material 类，不能就地改属性，得整个换掉。
 * 外壳和底盘要一起换 —— 见 PLINTH_STYLES 上面那段注释。 */
function setPlinthStyle(st) {
  plinthStyle = st;
  for (const [key, node] of [['M_Plinth', 'Plinth'], ['M_Chassis', 'PlinthBase']]) {
    MATS[key] = { ...PLINTH_STYLES[st][key === 'M_Plinth' ? 'plinth' : 'chassis'] };
    const old = materialCache.get(key);
    materialCache.delete(key);
    const next = getMaterial(key);
    parts[node]?.traverse(o => { if (o.isMesh) o.material = next; });
    old?.dispose();
  }
}
window.setPlinthStyle = setPlinthStyle;

const materialCache = new Map();
const getMaterial = n => {
  if (!materialCache.has(n)) materialCache.set(n, buildMaterial(n));
  return materialCache.get(n);
};

/* ================================================================ 装载 */
const parts = {};
let rig = { tonearm_play_deg: -30.79 };
let library = [];

fetch('../blender/rig.json').then(r => r.json()).then(r => { rig = r; }).catch(() => {});

/* 换唱片：只换两张贴图（唱片正面 + 封套正面）。
 * 阶段 5 做播放器 UI 时，选唱片就是调这个函数。 */
let labelStyle = 'art';        // 中心标签用封面圆裁（Iris 定，2026-08-17）
let mounted = null;

function setLabelStyle(st) {
  labelStyle = st;
  if (mounted?.recordStyles?.[st]) loadTex(mounted.recordStyles[st], getMaterial('M_Record'));
}
window.setLabelStyle = setLabelStyle;

function mount(name) {
  const rec = library.find(r => r.name === name) || library[0];
  if (!rec) return null;
  mounted = rec;
  loadTex(rec.recordStyles?.[labelStyle] || rec.record, getMaterial('M_Record'));
  loadTex(rec.sleeve, getMaterial('M_SleeveArt'));
  if (rec.back)  loadTex(rec.back,  getMaterial('M_SleeveBack'));
  if (rec.spine) loadTex(rec.spine, getMaterial('M_SleeveSpine'));
  const el = document.getElementById('nowplaying');
  if (el) el.textContent = rec.name;
  return rec;
}
window.mountRecord = mount;

fetch('tex/manifest.json')
  .then(r => r.json())
  .then(m => { library = m.records; mount(MOUNTED); })
  .catch(() => console.warn('没读到 tex/manifest.json —— 先跑 blender/make_textures.py'));

new GLTFLoader().load('turntable.glb', gltf => {
  gltf.scene.traverse(o => {
    // 多材质的物件（唱臂）会被 GLTFLoader 拆成 Group + 若干 Mesh，
    // 名字挂在 Group 上。所以按名字索引所有对象，不能只收 Mesh，
    // 否则 parts.Tonearm 是 undefined，唱臂就静静地不动，也不报错。
    if (o.name && !parts[o.name]) parts[o.name] = o;
    if (!o.isMesh) return;
    o.material = getMaterial(o.material?.name || '');
  });
  Object.keys(parts).filter(k => k.startsWith('Sticker_'))
        .forEach(k => { parts[k].visible = SHOW_STICKERS; });
  // 透明件不吃颗粒 —— 颗粒糊在亚克力上会变磨砂，要的是干净的透明
  ['Plinth', 'DustCover'].forEach(n => parts[n] && stage.markGlass(parts[n]));
  stage.world.add(gltf.scene);
  document.getElementById('loading')?.remove();
  window.__dbg = { parts, materialCache, stage, THREE, state, turntable, tick, rig: () => rig };
});

/* ================================================================
 * 交互接口 —— 阶段 4 / 5 接真实音频时用的就是这个，不要改签名
 * ============================================================== */
const REST_DEG = 0;
const SPIN_RPM = 33 + 1 / 3;

const state = { playing: false, armT: 0, spin: 0, angle: 0, dropped: false,
                flipped: false, flipT: 0, lidOpen: true, lidT: 1 };
const LID_OPEN_DEG = -46;      // 绕后沿铰链掀起来。负号是因为盖子朝 -Y 伸。
// 真罩子能掀到 60°+，但盖板有 372mm 深，掀太高会立成一面墙占掉半个画面

export const turntable = {
  onPlay: null,           // 阶段 4：在这里挂真实音频的 play()
  onStop: null,           // 阶段 4：在这里挂 stop()
  get isPlaying() { return state.playing; },
  play() {
    if (state.playing) return;
    state.playing = true; state.dropped = false;
    state.lidOpen = true;          // 放唱片一定是掀着盖的，不然针根本落不下去
    this.onPlay?.();
    syncHint();
  },
  stop() {
    if (!state.playing) return;
    state.playing = false;
    this.onStop?.();
    syncHint();
  },
  toggle() { state.playing ? this.stop() : this.play(); },
};
window.turntable = turntable;

/* 占位音效：唱针落下的咔哒。阶段 1 不接真实音频文件，用 WebAudio 合成。 */
let actx = null;
function clickSound() {
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  const t = actx.currentTime;
  const n = actx.sampleRate * 0.06 | 0;
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 5);
  const src = actx.createBufferSource(); src.buffer = buf;
  const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 1.1;
  const g = actx.createGain(); g.gain.value = 0.32;
  src.connect(bp).connect(g).connect(actx.destination);
  src.start(t);
  // 一点低频的"落"
  const o = actx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(52, t + 0.09);
  const og = actx.createGain();
  og.gain.setValueAtTime(0.16, t); og.gain.exponentialRampToValueAtTime(0.0008, t + 0.14);
  o.connect(og).connect(actx.destination); o.start(t); o.stop(t + 0.16);
}

/* ================================================================ 点击拾取 */
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const HIT = () => [parts.Record, parts.PowerKnob, parts.Sleeve, parts.DustCover].filter(Boolean);

/* 相机被限制在正面 180°，所以封套背面永远转不到。
 * 点一下让它翻过去 —— 否则背面那张贴图等于白做，也没法验收。 */
function isSleeve(o) { for (let n = o; n; n = n.parent) if (n === parts.Sleeve) return true; return false; }

function pick(e) {
  const r = canvas.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, stage.camera);
  return ray.intersectObjects(HIT(), true)[0];
}

let downAt = null;
canvas.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 5) return;              // 拖动 orbit 不算点击
  const hit = pick(e);
  if (!hit) return;
  // 盖着的时候罩子在最前面，所以点下去先开盖 —— 跟真的放唱片一个顺序
  if (hit.object === parts.DustCover) { state.lidOpen = !state.lidOpen; syncHint(); }
  else if (isSleeve(hit.object)) { state.flipped = !state.flipped; syncHint(); }
  else turntable.toggle();
});
canvas.addEventListener('pointermove', e => { canvas.style.cursor = pick(e) ? 'pointer' : 'grab'; });

/* ================================================================ 动画 */
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function tick(dt) {
  // 唱臂：1.1 秒摆到落针位。到 88% 时咔哒一声。
  const dir = state.playing ? 1 : -1;
  state.armT = THREE.MathUtils.clamp(state.armT + dir * dt / 1.1, 0, 1);
  if (parts.Tonearm) {
    const a = THREE.MathUtils.lerp(REST_DEG, rig.tonearm_play_deg, easeInOut(state.armT));
    parts.Tonearm.rotation.y = a * Math.PI / 180;
  }
  if (state.playing && !state.dropped && state.armT > 0.88) { state.dropped = true; clickSound(); }

  // 唱片：跟着唱臂起转/停转，转速慢而稳
  const targetSpin = state.playing && state.armT > 0.6 ? 1 : 0;
  state.spin += (targetSpin - state.spin) * Math.min(1, dt * 1.6);
  state.angle -= state.spin * (SPIN_RPM / 60) * Math.PI * 2 * dt;   // 从上往下看是顺时针
  if (parts.Record) parts.Record.rotation.y = state.angle;

  // 防尘罩：绕后沿铰链掀起，1.3 秒（比唱臂慢一点，重的东西该慢）
  state.lidT = THREE.MathUtils.clamp(state.lidT + (state.lidOpen ? 1 : -1) * dt / 1.3, 0, 1);
  if (parts.DustCover) parts.DustCover.rotation.x = easeInOut(state.lidT) * LID_OPEN_DEG * Math.PI / 180;

  // 封套翻面：绕自身竖轴转 180°，1 秒
  state.flipT = THREE.MathUtils.clamp(state.flipT + (state.flipped ? 1 : -1) * dt / 1.0, 0, 1);
  if (parts.Sleeve) parts.Sleeve.rotation.y = easeInOut(state.flipT) * Math.PI;

  // 指示灯：待机暗，播放时亮（自发光小物在柔光里的表现）
  const led = materialCache.get('M_Led');
  if (led) led.emissiveIntensity = THREE.MathUtils.lerp(led.emissiveIntensity, state.playing ? 3.4 : 0.9, dt * 4);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  tick(dt);
  stage.render(dt);
  if (pendingShot) { doShot(); pendingShot = false; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ================================================================
 * 验收工具面板（按 H 开关）
 * 验收标准里"任何角度轮廓成立""盖上颗粒和柔光后仍然清晰"都得能现场调、现场看。
 * ============================================================== */
const ui = document.getElementById('panel');
const HINT = document.getElementById('hint');
const syncHint = () => {
  if (!HINT) return;
  HINT.textContent = (state.playing ? '播放中 · 点唱片停止' : '点唱片播放') +
                     ' ｜ ' + (state.lidOpen ? '点罩子盖上' : '点罩子掀开') +
                     ' ｜ ' + (state.flipped ? '点封套翻回正面' : '点封套看背面');
};
syncHint();

const SLIDERS = [
  ['grain', '颗粒', 0, 60, 1],
  ['glow', '柔光', 0, 40, 1],
  ['exposure', '曝光', 0.6, 1.8, 0.01],
  ['shadow', '接触阴影', 0, 1, 0.02],
  ['softness', '影子软度', 0.5, 9, 0.25],
  ['dof', '景深', 0, 0.03, 0.001],
  ['aberration', '色差', 0, 0.004, 0.0002],
  ['glassClean', '透明净度', 0, 1, 0.02],
];

if (ui) {
  SLIDERS.forEach(([k, label, min, max, step]) => {
    const row = document.createElement('label');
    row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${stage.params[k]}"><b>${stage.params[k]}</b>`;
    const [inp, out] = [row.querySelector('input'), row.querySelector('b')];
    inp.oninput = () => { stage.params[k] = +inp.value; out.textContent = inp.value; stage.applyParams(); };
    ui.appendChild(row);
  });

  const views = document.createElement('div');
  views.className = 'views';
  [['正面', 0, 72], ['3/4', 32, 64], ['侧面', 86, 80], ['俯视', 24, 26], ['低角', 20, 94]]
    .forEach(([n, az, po]) => {
      const b = document.createElement('button');
      b.textContent = n;
      b.onclick = () => setView(az * Math.PI / 180, po * Math.PI / 180);
      views.appendChild(b);
    });
  ui.appendChild(views);

  // 贴纸开关
  const strow = document.createElement('div');
  strow.className = 'views';
  const stickerNodes = () => Object.keys(parts).filter(k => k.startsWith('Sticker_')).map(k => parts[k]);
  const stb = document.createElement('button');
  stb.textContent = '贴纸：' + (SHOW_STICKERS ? '开' : '关');
  stb.onclick = () => {
    const on = !(stickerNodes()[0]?.visible ?? true);
    stickerNodes().forEach(o => { o.visible = on; });
    stb.textContent = '贴纸：' + (on ? '开' : '关');
  };
  strow.appendChild(stb);
  ui.appendChild(strow);

  // 机身：黑 / 三种透明
  const prow = document.createElement('div');
  prow.className = 'views';
  [['黑', 'black'], ['烟灰', 'smoke'], ['冰蓝', 'ice'], ['茶', 'amber']].forEach(([n, st]) => {
    const b = document.createElement('button');
    b.textContent = n;
    b.onclick = () => {
      setPlinthStyle(st);
      [...prow.children].forEach(c => c.style.fontWeight = '400');
      b.style.fontWeight = '700';
    };
    if (st === plinthStyle) b.style.fontWeight = '700';
    prow.appendChild(b);
  });
  ui.appendChild(prow);

  // 中心标签三选一，现场切着看
  const lrow = document.createElement('div');
  lrow.className = 'views';
  [['经典', 'classic'], ['封面', 'art'], ['纯色', 'plain']].forEach(([n, st]) => {
    const b = document.createElement('button');
    b.textContent = n;
    b.onclick = () => {
      setLabelStyle(st);
      [...lrow.children].forEach(c => c.style.fontWeight = '400');
      b.style.fontWeight = '700';
    };
    if (st === labelStyle) b.style.fontWeight = '700';
    lrow.appendChild(b);
  });
  ui.appendChild(lrow);

  const row2 = document.createElement('div');
  row2.className = 'views';
  // 封面现在还是占位图。判断唱机本身时可以关掉，免得一块大浅色挡视线。
  const sv = document.createElement('button');
  sv.textContent = '封面：开';
  sv.onclick = () => {
    if (!parts.Sleeve) return;
    parts.Sleeve.visible = !parts.Sleeve.visible;
    sv.textContent = '封面：' + (parts.Sleeve.visible ? '开' : '关');
  };
  row2.appendChild(sv);
  const shot = document.createElement('button');
  shot.textContent = '存图';
  shot.onclick = () => { pendingShot = true; };
  const cp = document.createElement('button');
  cp.textContent = '复制参数';
  cp.onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(stage.params, null, 2));
    cp.textContent = '已复制'; setTimeout(() => cp.textContent = '复制参数', 1200);
  };
  row2.append(shot, cp);
  ui.appendChild(row2);
}

function setView(az, po) {
  const c = stage.controls, t = c.target;
  const d = stage.camera.position.distanceTo(t);
  stage.camera.position.set(
    t.x + d * Math.sin(po) * Math.sin(az),
    t.y + d * Math.cos(po),
    t.z + d * Math.sin(po) * Math.cos(az));
  c.update();
}
window.setView = setView;

/* 存图。serve.py 提供 POST /save，图直接落进 标杆物件_唱机/渲染/，
 * Cowork 那边打开文件夹就能对着验收清单看。服务器不在就退回浏览器下载。 */
let pendingShot = false;
let shotName = null;
function doShot() {
  const name = shotName || `唱机_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  shotName = null;
  const data = canvas.toDataURL('image/png');
  fetch(`/save?name=${encodeURIComponent(name)}.png`, { method: 'POST', body: data })
    .then(r => { if (!r.ok) throw 0; })
    .catch(() => { const a = document.createElement('a'); a.download = name + '.png'; a.href = data; a.click(); });
}
/* 立刻渲染一帧并存图（不经过 rAF）。没有 preserveDrawingBuffer，
 * 所以 render 和 toDataURL 必须在同一个 task 里连着做，中间不能让浏览器合成。 */
window.captureAs = n => { shotName = n; stage.render(1 / 60); doShot(); };

addEventListener('keydown', e => {
  if (e.key === 'h' || e.key === 'H') ui?.classList.toggle('hidden');
  if (e.key === ' ') { e.preventDefault(); turntable.toggle(); }
});
