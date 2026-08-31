/* 物件 · 贝壳
 *
 * 和酒瓶一样：这里没有一行光照 / 后处理代码，只有一张材质表和摆位。
 * 贝壳是实体类（不透明、flat shading），颜色走 raw —— 不过调色变换、不吃全局饱和度（宪法 三 / 规格 第七节）。
 * 唯一的特殊处理：薄的地方给一点点边缘透光（花瓣那一档的强度 × 顶点"薄度"），
 * 强度从 ENV.rimS × ENV.rimPetal 读，和沙滩窗口的面板联动。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStage } from '../../共用/stage.js';
import { ENV } from '../../共用/constitution.js';

const canvas = document.getElementById('view');
const stage = createStage(canvas, {
  target: new THREE.Vector3(0, 0.005, 0),
  distance: 0.62,           // 贝壳只有几厘米，相机要凑近；真场景里它们在野餐垫外圈
  polar: Math.PI / 2 - 0.62,
});
stage.enableSandDrag();     // 推沙是窗口 A 的逻辑，这里只是开着看接触半径对不对
stage.params.grain = 0;     // Iris：这页默认颗粒 0（全局默认在 共用/constitution.js，归窗口 A）
stage.applyParams();

/* ---- 材质表（颜色和 blender/build_shells.py 里的 COLORS 一致）---- */
const MATS = {
  M_PearlWhite: { color: '#F8F2EC', rough: 0.34 },
  M_Pink:       { color: '#F3EBE0', rough: 0.36 },
  M_Cream:      { color: '#F7E9D0', rough: 0.40 },
  M_Lining:     { color: '#F8F3EC', rough: 0.26 },   // 内衬更光
  M_Blush:      { color: '#EFDCD3', rough: 0.44 },
  M_MouthPale:  { color: '#F3ECE6', rough: 0.30 },   // 尖螺的口：珍珠白偏暖
  // 海胆壳：灰绿偏米 + 贴图里的奶油点（紫色已去掉，真海胆壳退色后就是这个色）
  M_Urchin:     { color: '#DCDBCD', rough: 0.50, map: 'tex/urchin.png' },
  M_UrchinHole: { color: '#B9B5A4', rough: 0.55 },
  // 沙钱：灰白 + 贴图里的五瓣 / 五道缝 / 中心口
  M_DollarBody: { color: '#E6E1D6', rough: 0.60, map: 'tex/sand_dollar.png' },
  M_DollarBot:  { color: '#DDD7CB', rough: 0.60 },
  M_CowrieBack: { color: '#F2E9DC', rough: 0.18 },   // 宝螺背很光
  M_CowrieSpot: { color: '#E2C9B8', rough: 0.18 },
  M_Teeth:      { color: '#FBF7F1', rough: 0.30 },
  M_Whelk:      { color: '#F4E6DA', rough: 0.38 },
  M_WhelkRib:   { color: '#E8D2C6', rough: 0.38 },
  M_ClamLight:  { color: '#F8F0E4', rough: 0.42 },
  M_ClamDark:   { color: '#E8D3C2', rough: 0.42 },
  M_Star:       { color: '#E9987E', rough: 0.70, matte: true },   // 海星是哑的
  M_StarDark:   { color: '#F2CDB6', rough: 0.70, matte: true },
  M_Mussel:     { color: '#4A5166', rough: 0.30, matte: true },   // 深色：自发光会把它提灰
  M_MusselEdge: { color: '#6B5A48', rough: 0.40, matte: true },
  M_Nacre:      { color: '#ECE9EE', rough: 0.20 },
  M_Moon:       { color: '#F2E9DB', rough: 0.30 },
  M_MoonBand:   { color: '#E0C9B4', rough: 0.30 },
  M_Limpet:     { color: '#E4DED3', rough: 0.55 },
  M_LimpetRay:  { color: '#CEC4B6', rough: 0.55 },
  M_ScallopTan:  { color: '#E9D0BB', rough: 0.36 },
  M_ScallopTanLt:{ color: '#F7EEE3', rough: 0.36 },
  M_ScallopPink: { color: '#F1F2F0', rough: 0.34 },
  M_Strombus:    { color: '#F5F0EA', rough: 0.22 },   // 珍珠白、很光
  M_StrombusLip: { color: '#FBF8F3', rough: 0.20 },
  M_StrombusBand:{ color: '#EFE6DA', rough: 0.22 },
  M_StrombusIn:  { color: '#E6BBA9', rough: 0.22 },   // 口壁桃色、很光
  M_StrombusDeep: { color: '#CC9A90', rough: 0.35, matte: true },  // 口底：深一档，才读得出是个洞
  M_Cockle:      { color: '#F6EEE2', rough: 0.45 },
  M_CockleBand:  { color: '#E6CDB9', rough: 0.45 },
  M_TellinPink:  { color: '#F4E2DC', rough: 0.30 },
  M_TellinYellow:{ color: '#F3E3B4', rough: 0.30 },
  M_Oyster:      { color: '#D6D3CB', rough: 0.75, matte: true },
  M_OysterDark:  { color: '#B9B4A9', rough: 0.75, matte: true },
  M_OysterIn:    { color: '#F1F0EC', rough: 0.22 },
  M_Abalone:     { color: '#BBAE9E', rough: 0.70, matte: true },
  M_AbaloneHole: { color: '#7E7469', rough: 0.70, matte: true },
  M_Nacre2:      { color: '#D9E4E0', rough: 0.12 },   // 珍珠层：最光的材质
  M_Nacre3:      { color: '#E4E6E0', rough: 0.12 },
  M_Razor:       { color: '#EADDC9', rough: 0.40 },
  M_RazorBand:   { color: '#D2BDA8', rough: 0.40 },
  M_Turret:      { color: '#F2EADE', rough: 0.36 },
  M_TurretBand:  { color: '#E2CDBB', rough: 0.36 },
  M_Tusk:        { color: '#F3EEE3', rough: 0.30 },
  // ---- 小生物（critters.glb）：哑光；眼珠高光给强自发光，暗场里眼睛会亮 ----
  M_CrabBody:   { color: '#E6978A', rough: 0.45, matte: true },
  M_CrabDark:   { color: '#CF8275', rough: 0.45, matte: true },
  M_CrabBelly:  { color: '#F1C3B5', rough: 0.50, matte: true },
  M_Eye:        { color: '#2B2622', rough: 0.12, matte: true },
  M_EyeLight:   { color: '#FFFFFF', rough: 0.10, glow: true },
  M_Cheek:      { color: '#E9A6A8', rough: 0.60, matte: true },   // 小生物的腮红（不能叫 M_Blush，会盖掉贝壳的）
  M_TurtleShell:{ color: '#B7AA87', rough: 0.40, matte: true },
  M_TurtleScute:{ color: '#A09273', rough: 0.40, matte: true },
  M_TurtleRim:  { color: '#D9CDB0', rough: 0.40, matte: true },
  M_TurtleSkin: { color: '#A9CBA2', rough: 0.55, matte: true },
  M_TurtleBelly:{ color: '#EFE8D3', rough: 0.55, matte: true },
  M_Octo:       { color: '#E9ADA6', rough: 0.40, matte: true },
  // 鹅卵石：颜色全在贴图里（照鸟蛋图谱的斑点），不是珠光
  M_PebbleCream: { color: '#FFFFFF', rough: 0.66, map: 'tex/pebble_cream.png', stone: true },
  M_PebbleGrey:  { color: '#FFFFFF', rough: 0.66, map: 'tex/pebble_grey.png',  stone: true },
  M_PebbleTan:   { color: '#FFFFFF', rough: 0.66, map: 'tex/pebble_tan.png',   stone: true },
};

/* 珠光：背光面一灰就成了小石头。给一点自发光，让贝壳在任何角度都是浅色的（同 sand.js 的做法）。 */
const EMISSIVE = 0.16;

/* 边缘透光（统一器 3 · 透光材质的花瓣档）：
 *   f = (1 - n·v)^p，乘上顶点色 alpha 里的"薄度"，只有花边 / 外沿 / 口沿会透。
 *   上限封到 1.0，和冰壳 shader 一样，不然 bloom 会把边糊成白光。 */
const rimUniforms = { uRimS: { value: 0.1 }, uRimP: { value: 1.6 }, uRimC: { value: new THREE.Color('#FFFFFF') } };
function refreshRim() {
  rimUniforms.uRimS.value = ENV.rimS / 100 * ENV.rimPetal / 100;
  rimUniforms.uRimP.value = ENV.rimP / 100;
}
function addRim(m) {
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, rimUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying float vThin; varying vec3 vWN; varying vec3 vWP;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvThin = color.a; vWN = normalize(mat3(modelMatrix) * normal); vWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRimS, uRimP; uniform vec3 uRimC; varying float vThin; varying vec3 vWN; varying vec3 vWP;')
      .replace('#include <dithering_fragment>',
        `{ vec3 n = normalize(vWN); vec3 v = normalize(cameraPosition - vWP);
           float f = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), uRimP);
           gl_FragColor.rgb = min(gl_FragColor.rgb + uRimC * diffuseColor.rgb * f * vThin * uRimS, vec3(1.0)); }
         #include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => 'shellRim';
  return m;
}

function loadTex(path, mat) {
  const t = new THREE.TextureLoader().load(path, () => { mat.needsUpdate = true; });
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.magFilter = THREE.LinearFilter;      // 斑点贴图放大用线性：硬像素在 2cm 的石头上会像马赛克
  t.minFilter = THREE.LinearMipmapLinearFilter;
  mat.map = t;
}

const cache = new Map();
function getMaterial(name) {
  if (cache.has(name)) return cache.get(name);
  const s = MATS[name] || { color: '#CCCCCC', rough: 0.5 };
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(s.color),           // raw：不过 grade()
    roughness: s.rough, metalness: 0, flatShading: true,
    // 石头和哑的东西不是珠光，几乎不给自发光
    emissive: new THREE.Color(s.map ? '#FFFFFF' : s.color),
    emissiveIntensity: s.glow ? 0.9 : s.stone ? 0.03 : s.matte ? 0.05 : s.map ? EMISSIVE * 0.6 : EMISSIVE,
    side: THREE.DoubleSide,                     // 开放的壳从边上能看到里面
  });
  if (s.map) loadTex(s.map, m);
  addRim(m);
  cache.set(name, m);
  return m;
}

/* ---- 摆位 ----
 * 「散落」：像真的被浪推上来的那样，大的少、小的多，朝向各异。
 * 「排队」：按种类一行一个，给验收看每个变体长什么样。 */
/* 散落位置：确定性的伪随机 + 最小间距，大的靠里、小的往外撒。改 SEED 换一种散法。 */
const SEED = 7;
function scatterPositions(list) {
  let x = SEED * 9301 + 49297;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const placed = [];
  for (const { obj, extras } of list.slice().sort((p, q) => q.extras.contactRadius - p.extras.contactRadius)) {
    const r = extras.contactRadius;
    let best = null;
    for (let k = 0; k < 60; k++) {
      const a = rnd() * Math.PI * 2, d = 0.03 + rnd() * 0.26;
      const px = Math.cos(a) * d, pz = Math.sin(a) * d * 0.75;
      const gap = Math.min(...placed.map(p => Math.hypot(p.x - px, p.z - pz) - p.r - r), 1);
      if (!best || gap > best.gap) best = { x: px, z: pz, gap };
      if (gap > 0.012) break;
    }
    placed.push({ x: best.x, z: best.z, r, obj, rot: rnd() * Math.PI * 2 });
  }
  return placed;
}
const GLB = new URLSearchParams(location.search).get('glb') === 'critters' ? 'critters' : 'shells';
const ORDER = ['crab', 'turtle', 'octopus', 'scallop', 'scallop_tan', 'scallop_pink', 'cockle', 'clam', 'tellin_pink', 'tellin_yellow', 'mussel', 'razor', 'oyster', 'abalone', 'conch', 'strombus', 'conch_round', 'whelk', 'moon_snail', 'turret', 'tusk', 'cowrie', 'sand_dollar', 'urchin', 'starfish', 'starfish_thin', 'limpet', 'pebble_round', 'pebble_flat', 'pebble_long'];

const shells = [];       // { obj, extras }
// 摆法从 URL 读：stage.sink 对同一物件只生效一次，换摆法直接带参数重载最干净
const layout = new URLSearchParams(location.search).get('layout') === 'grid' ? 'grid' : 'scatter';

function place(mode) {
  const rows = {};
  const scatter = mode === 'scatter' ? scatterPositions(shells) : [];
  for (const { obj, extras } of shells) {
    let x, z, rot;
    if (mode === 'scatter') {
      ({ x, z, rot } = scatter.find(p => p.obj === obj));
    } else {
      const r = ORDER.indexOf(extras.species);
      const k = (rows[r] = (rows[r] || 0) + 1) - 1;
      x = -0.12 + k * 0.08; z = (GLB === 'critters' ? -0.10 : -0.48) + r * (GLB === 'critters' ? 0.08 : 0.04); rot = 0;
    }
    obj.rotation.set(0, rot, 0);
    obj.position.set(x, 0, z);
  }
  for (const { obj, extras } of shells) {
    // 接触半径 = glb extras 里的 contactRadius；半埋的再往下沉 buryDepth。先 sink 再 add，stage 就不会用默认半径
    stage.sink(obj, { radius: extras.contactRadius, lift: -(extras.buryDepth || 0) });
    stage.world.add(obj);
  }
}

const label = document.getElementById('label');
new GLTFLoader().load(GLB + '.glb', gltf => {
  gltf.scene.traverse(o => { if (o.isMesh) o.material = getMaterial(o.material?.name || ''); });
  // 每个变体是 scene 的一个直接子物件，extras 已经在 userData 里
  for (const node of [...gltf.scene.children]) {
    const extras = node.userData;
    const obj = new THREE.Group();
    obj.name = node.name;
    obj.add(node);
    node.position.set(0, 0, 0);
    obj.userData.rangeMul = 5;           // 贝壳允许被推得相对远（stage 的约定）
    shells.push({ obj, extras });
  }
  place(layout);
  const tris = shells.reduce((n, s) => n + (s.extras.tris || 0), 0);
  label.textContent = GLB === 'critters' ? `${shells.length} 个姿态 · 共 ${tris} 面 · 🦀 🐢 🐙` : `${shells.length} 个变体 · 共 ${tris} 面 · 20 种贝壳 + 3 种鹅卵石`;
  document.getElementById('loading')?.remove();
  window.__dbg = { shells, cache, stage, THREE, ENV };
});

let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  refreshRim();
  stage.render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---- 面板（同酒瓶）---- */
const ui = document.getElementById('panel');
const SLIDERS = [
  ['grain', '颗粒', 0, 60, 1], ['glow', '柔光', 0, 40, 1],
  ['exposure', '曝光', 0.6, 1.8, 0.01], ['shadow', '接触阴影', 0, 1, 0.02],
  ['softness', '影子软度', 0.5, 9, 0.25], ['dof', '景深', 0, 0.03, 0.001],
  ['rimPetal', '边缘透光', 0, 40, 1],
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
  [['正面', 0, 58], ['3/4', 32, 55], ['侧面', 82, 74], ['俯视', 10, 18]].forEach(([n, az, po]) => {
    const b = document.createElement('button');
    b.textContent = n;
    b.onclick = () => setView(az * Math.PI / 180, po * Math.PI / 180);
    views.appendChild(b);
  });
  ui.appendChild(views);
  const row2 = document.createElement('div'); row2.className = 'views';
  const mk = (txt, fn) => { const b = document.createElement('button'); b.textContent = txt; b.onclick = fn; row2.appendChild(b); return b; };
  const go = l => { const q = new URLSearchParams(location.search); l === 'grid' ? q.set('layout', 'grid') : q.delete('layout'); location.search = q.toString(); };
  mk(GLB === 'critters' ? '看贝壳' : '看小生物', () => { const q = new URLSearchParams(location.search); GLB === 'critters' ? q.delete('glb') : q.set('glb', 'critters'); location.search = q.toString(); });
  const bS = mk('散落', () => go('scatter'));
  const bQ = mk('排队', () => go('grid'));
  (layout === 'grid' ? bQ : bS).classList.add('on');
  mk('存图', () => window.captureAs(null));
  ui.appendChild(row2);
}

function setView(az, po) {
  const c = stage.controls, t2 = c.target;
  const d = stage.camera.position.distanceTo(t2);
  stage.camera.position.set(t2.x + d * Math.sin(po) * Math.sin(az),
                            t2.y + d * Math.cos(po),
                            t2.z + d * Math.sin(po) * Math.cos(az));
  c.update();
}
window.setView = setView;

window.captureAs = n => {
  stage.render(1 / 60);
  const name = n || `贝壳_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  const data = canvas.toDataURL('image/png');
  fetch(`/save?dir=${encodeURIComponent('物件_贝壳')}&name=${encodeURIComponent(name)}.png`, { method: 'POST', body: data })
    .then(r => { if (!r.ok) throw 0; })
    .catch(() => { const a = document.createElement('a'); a.download = name + '.png'; a.href = data; a.click(); });
};

addEventListener('keydown', e => {
  if (e.key === 'h' || e.key === 'H') ui?.classList.toggle('hidden');
});
