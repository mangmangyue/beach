/* 统一舞台 · 白沙海底（宪法 v0.8 / 规格_沙地环境.md 的运行时实现）
 *
 * 这是所有物件共用的环境：沙地、背景水体、三类材质系统、后处理链。
 * 每个物件 viewer import 这个 stage 就自动"是同一个世界"。
 * 想改画面整体气质，改这里（或按 E 开调试面板），不要在单个物件上改。
 *
 * 结构（规格 第一节）：
 *   背景（上暗下亮的渐变 + 地平线柔光带）—— 画在 canvas 里的全屏面片，
 *     不用 CSS 渐变：bloom 的辉光要落在背景上，canvas 透明通道会把它切掉，
 *     而且 toDataURL 存渲染图时 CSS 背景带不进去。渐变公式和规格第五节逐行一致。
 *   沙地（150×150 段网格 + 顶点凹陷）—— 见 sand.js
 *   物件（陷进沙里）—— 加进 stage.world 的东西自动陷落，或用 stage.sink() 手动控制
 *   飘浮的小泡泡
 *   后处理：景深 → 光晕 → 颗粒（+雾/霾、轻微色差）
 *
 * 坐标：物件用真实米级单位；沙的世界按「相机距离 / 11.2」等比缩放来适配
 * （11.2 = 原型 发光质感实验室.html 的相机距离，所有沙地参数都是在那个尺度调的）。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { P, ENV, LOOKS, SCREEN_BGS, ICE_TIERS, grade, satBoost, shade } from './constitution.js';
import { TOP_NAMES as GT_TOPS, BACK_NAMES as GT_BACKS } from '../物件_吉他/viewer/材质表.js';
import { createSand, createShell, SHELL_SPOTS, SAND_FAR, FIELD_HALF } from './sand.js';
import { createWaves } from './waves.js';
import { beachEnvironment, envIntensity, sunDirection, kelvinColor, patchRadialFog, RadialFog, refreshEnvI } from './光照.js';

const PROTO_DIST = 11.2;   // 原型相机距离。环境缩放 = distance / PROTO_DIST，只此一处

/* ================================================================
 * 一、背景：上暗下亮的渐变（不是天空，是水体）+ 地平线柔光带
 * 逐行对应规格第五节的 CSS 公式，只是画进了 canvas。
 * 要点：bgBot 在地平线上方就已经到位，形成一条同色平台；
 * 沙的远处雾色 uFogColor 是同一个 bgBot，两边同色相接 → 看不出界限。
 * ============================================================== */
const BackgroundShader = {
  uniforms: {
    uBgTop:   { value: new THREE.Color(ENV.bgTop) },
    uBgMid:   { value: new THREE.Color(ENV.bgMid) },
    uBgBot:   { value: new THREE.Color(ENV.bgBot) },
    uBgStop:  { value: ENV.bgStop / 100 },
    uBgMidStop: { value: ENV.bgMidStop / 100 },
    uHorizF:  { value: 0.5 },                        // 地平线在屏幕上的位置（0=顶）
    uHorizC:  { value: new THREE.Color(ENV.horizC) },
    uHoriz:   { value: ENV.horiz / 100 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.99999, 1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform vec3 uBgTop, uBgMid, uBgBot, uHorizC;
    uniform float uBgStop, uBgMidStop, uHorizF, uHoriz;
    varying vec2 vUv;
    void main(){
      float y = 1.0 - vUv.y;                          // 0 = 屏幕顶
      float f = uHorizF;
      float top = max(0.02, min(f - 0.26, uBgStop));
      float b1  = max(top + 0.06, f - 0.06);
      // 三段：顶色 → 中段色 → 地平线色（地平线色 = 沙和海远处的雾色，两边同色才没有缝）
      float mid = top + (b1 - top) * uBgMidStop;
      vec3 col = y < mid ? mix(uBgTop, uBgMid, clamp((y - top) / max(mid - top, 1e-4), 0.0, 1.0))
                         : mix(uBgMid, uBgBot, clamp((y - mid) / max(b1 - mid, 1e-4), 0.0, 1.0));
      // 地平线柔光带（screen 混合），中心跟着地平线走
      float band = y < f ? 1.0 - clamp((f - y) / 0.30, 0.0, 1.0)
                         : 1.0 - clamp((y - f) / 0.26, 0.0, 1.0);
      vec3 glow = uHorizC * (uHoriz * 0.40) * band;
      col = 1.0 - (1.0 - col) * (1.0 - glow);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/* ================================================================
 * 二、贴图小工具
 * ============================================================== */
/* 一块**软边的矩形**：中间满，四边化到 0。屏幕面上那层柔光用它。
 * 横竖两条渐变**相乘**（可分离），两端必须正好是 0 ——
 * 用顶点色做边缘的话，边界是一条直的硬线，Iris 的原话：「光的范围没有那么整齐」。
 * soft = 羽化占半边的比例（0 = 硬边，1 = 从中心就开始化）。 */
function makeSoftRectTexture(aspect, soft) {
  const PX = 256;
  const c = document.createElement('canvas');
  c.width = PX;
  c.height = Math.max(8, Math.round(PX / Math.max(0.05, aspect)));
  const x = c.getContext('2d');
  const p = Math.max(0.02, Math.min(0.5, soft * 0.5));
  const ramp = (g) => {
    // 多给几个停点近似 smoothstep：线性衰减在加色混合下会看出一条折线
    for (const [t, v] of [[0, 0], [p * 0.3, 0.05], [p * 0.6, 0.28], [p * 0.85, 0.7], [p, 1]]) {
      g.addColorStop(t, 'rgba(255,255,255,' + v + ')');
      g.addColorStop(1 - t, 'rgba(255,255,255,' + v + ')');
    }
    return g;
  };
  x.fillStyle = ramp(x.createLinearGradient(0, 0, c.width, 0));
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';       // 竖向那条乘进 alpha
  x.fillStyle = ramp(x.createLinearGradient(0, 0, 0, c.height));
  x.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* 屏幕的光**落在平面上**的那一片（键盘面 / 垫子）。
 * 归一化贴图：v=0 是**贴着屏幕**的近端，v=1 是最远端。
 *   near  近端宽度占贴图宽的多少（1 = 直上直下的矩形，小于 1 = 往前张开）
 *   fall  往前衰减的快慢（大 = 掉得快 = 短促）
 * ⚠️ 长度别给大：一块亮度不高的屏幕，光只够洒到身前一小片。
 *    写死成屏幕宽的 1.5 倍的那一版渲出来像手电筒光柱。 */
function makeSpillTexture(near, fall, soft = 0.55) {
  const PX = 256;
  const c = document.createElement('canvas');
  c.width = c.height = PX;
  const x = c.getContext('2d');
  for (let i = 0; i < PX; i++) {
    const v = i / (PX - 1);
    const hw = 0.5 * (near + (1 - near) * v);          // 这一行的半宽（往前张开）
    const a = Math.pow(Math.max(0, 1 - v), fall) * (1 - Math.pow(v, 6));
    if (a <= 0.002) continue;
    const g = x.createLinearGradient((0.5 - hw) * PX, 0, (0.5 + hw) * PX, 0);
    // 横向：中间满、两边化到 0（羽化宽度跟着这一行的宽度走，远端更软）
    const fe = Math.max(0.03, Math.min(0.48, soft * 0.48));   // 横向羽化占半边多少
    for (const [t, k] of [[0, 0], [fe * 0.5, 0.5], [fe, 1], [1 - fe, 1], [1 - fe * 0.5, 0.5], [1, 0]])
      g.addColorStop(t, 'rgba(255,255,255,' + (k * a).toFixed(4) + ')');
    x.fillStyle = g;
    x.fillRect((0.5 - hw) * PX, i, hw * 2 * PX, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* 屏幕往**前**照出去的那束光（一个矩形的锥台）。
 * ⚠️ 这是第四版了，前三版都跑偏，记一下错在哪：
 *   ① 一张径向渐变贴图 → 读成"后面藏了个灯泡"
 *   ② 贴图换成面光形状，但外扩给到屏幕高的 55% → 整个背板一圈都在发光
 *   ③ 地上那块洒光给到屏幕宽的 1.5 倍 → 一道手电筒光柱
 * Iris 说清楚了：「光应该是往屏幕**前**照射，不是在背板的中间扩大；
 * 屏幕指的是电脑背板前面的那一个面，厚度应该是几乎很小很小的。」
 * 也就是说：发光的是**屏幕那一层薄面**，光沿着它的法线**往前**走。
 * 所以这里做的是一个真的往前的体积 —— 近端 = 屏幕本身那个矩形，
 * 远端按张角张开，沿途 alpha 衰减到 0。从侧前方看得见光往前走，
 * 正对着看是一层盖在屏幕上的柔光。alpha 用顶点色，不用贴图。 */
function makeBeamGeometry(w, h, len, angDeg) {
  const t = Math.tan(angDeg * Math.PI / 180);
  const W2 = w + 2 * len * t, H2 = h + 2 * len * t;
  const n = [[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]];
  const f = [[-W2 / 2, -H2 / 2, len], [W2 / 2, -H2 / 2, len], [W2 / 2, H2 / 2, len], [-W2 / 2, H2 / 2, len]];
  const pos = [], col = [];
  const push = (p, a) => { pos.push(p[0], p[1], p[2]); col.push(1, 1, 1, a); };
  // ⚠️ 近端那一片**不在这儿画** —— 顶点色做出来的边是一条直的硬线，
  //    正对着屏幕看就是一个规规矩矩的亮矩形（Iris：「光的范围没有那么整齐」）。
  //    那一片交给带软边贴图的 cap 面片（makeSoftRectTexture），这里只留往前的四个侧面。
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    push(n[i], 1); push(n[j], 1); push(f[j], 0);
    push(n[i], 1); push(f[j], 0); push(f[i], 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));   // 4 分量 = 带 alpha
  return g;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 63);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(.35, 'rgba(255,255,255,.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 3, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/* 环境贴图搬去了 共用/光照.js —— 那份是全场唯一的一张，
 * 调色台 / 物件 viewer 也 import 同一个函数（以前是各自照抄一份，从来没同步过）。 */

/* ================================================================
 * 三、透光材质（冰晶）。菲涅尔边缘光 + 半透明，规格 3.1 原样。
 * 三档参数（soul / glass / petal / bubble）是防止画面变脏的关键，别用同一组。
 * ============================================================== */
const ICE_VS = /* glsl */`
  varying vec3 vN; varying vec3 vV; varying vec2 vUv;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const ICE_FS = /* glsl */`
  precision highp float;
  uniform vec3 uColor, uRim, uCore;
  uniform float uRimS, uRimP, uCoreS, uAlpha, uUseMap, uClampL;
  uniform sampler2D uMap;
  varying vec3 vN; varying vec3 vV; varying vec2 vUv;
  void main(){
    vec3 base = uColor;
    if(uUseMap > 0.5){
      vec4 t = texture2D(uMap, vUv);
      if(t.a < 0.45) discard;        // 花头是模切的形状，不是半透明图层
      base = t.rgb;
    }
    float d = abs(dot(normalize(vN), normalize(vV)));
    float f = pow(1.0 - clamp(d, 0.0, 1.0), uRimP);
    vec3 col = base + uRim * f * uRimS + uCore * (1.0 - f) * uCoreS;
    // 原型是 LDR，亮度天然截断在 1；这里有 bloom，得手动封顶，
    // 否则内核把整个身体推过 bloom 阈值，物件糊成一团白光
    col = min(col, vec3(uClampL));
    float a = clamp(uAlpha + f * uRimS * 0.55, 0.0, 1.0);
    gl_FragColor = vec4(col, a);
  }`;

/* ================================================================
 * 四、颗粒 + 雾/霾 + 轻微色差（最后一个 pass）
 * 颗粒是必需项不是滤镜 —— 再杂的颜色，盖上同一层噪点就是一家人。
 * 透明件上几乎不加（uMask）：颗粒糊在玻璃上会变磨砂，要的是干净的透明。
 * ============================================================== */
const GrainShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uAmount:    { value: 0.35 },
    uScale:     { value: 1.35 },
    uSeed:      { value: 0 },
    uHazeColor: { value: new THREE.Color(ENV.hazeC) },
    uHazeV:     { value: 0.22 },    // 竖向的雾（梦核的"空"来自这里）
    uHazeR:     { value: 0.28 },    // 左上角的一大团光晕
    uMask:      { value: null },
    uMaskCut:   { value: 0.92 },
    uAberr:     { value: 0.0006 },
    uContrast:  { value: 1.0 },     // 后处理最后一步。清透感的直接开关
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse, uMask;
    uniform float uAmount, uScale, uSeed, uHazeV, uHazeR, uAberr, uMaskCut, uContrast;
    uniform vec3 uHazeColor;
    varying vec2 vUv;
    float hash(vec2 p){
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p + 19.19);
      return fract((p.x + p.y) * p.x);
    }
    void main(){
      vec2 off = (vUv - 0.5) * uAberr;
      vec3 base = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b
      );
      // 雾/霾（screen 混合）：一团在左上，一层从上到下渐浓
      float hd = length((vUv - vec2(0.24, 0.90)) * vec2(1.0, 0.78));
      float hz = pow(clamp(1.0 - hd, 0.0, 1.0), 1.6) * uHazeR
               + mix(0.30, 0.52, 1.0 - vUv.y) * uHazeV;
      base = 1.0 - (1.0 - base) * (1.0 - uHazeColor * hz);
      // 颗粒（overlay），玻璃遮罩内几乎不加
      float glass = texture2D(uMask, vUv).r;
      float amt = uAmount * (1.0 - glass * uMaskCut);
      float n = hash(floor(gl_FragCoord.xy / uScale) + vec2(uSeed));
      vec3 bl = mix(vec3(0.5), vec3(n), amt);
      vec3 res = mix(2.0 * base * bl, 1.0 - 2.0 * (1.0 - base) * (1.0 - bl), step(vec3(0.5), base));
      // 对比度：绕 0.5 中灰拉开。放在最后，雾和颗粒都已经盖上去了才拉
      res = clamp((res - 0.5) * uContrast + 0.5, 0.0, 1.0);
      gl_FragColor = vec4(res, 1.0);
    }
  `,
};

/* ================================================================
 * 五、Stage
 * ============================================================== */
export function createStage(canvas, {
  target       = new THREE.Vector3(0, 0.1, 0),
  distance     = 1.2,
  // 相机（宪法 五点五 + 规格 第六节）：自由 orbit，水平 ±90°，
  // 俯仰角下限锁在沙面之上 —— 相机怎么拖都看不到沙的背面
  azimuth      = 0.30,
  polar        = Math.PI / 2 - 0.34,
  azimuthLimit = Math.PI / 2,
  pitchMin     = 0.13,
  pitchMax     = 1.52,         // 到 87°，基本纯俯视（Iris 08-29 想俯视看浪推贝壳；1.25 时到不了）
  shadowSize   = 1.2,          // 旧接口，留着不报错；用途由 sink() 接管
  shells       = true,         // 要不要撒 stage 自带的程序化贝壳（有真贝壳模型的页面传 false）
} = {}) {

  const S = distance / PROTO_DIST;   // 环境（沙/贝壳/泡泡）的缩放

  patchRadialFog();   // 改全局 ShaderChunk，必须在任何材质编译之前（见 光照.js 第三节）

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  // 阴影：一盏太阳同时投接触阴影和自阴影（2026-08-27 统一光照 第 2 步）。
  // 以前这里是 false，理由是「沙是自定义 ShaderMaterial，收不到 shadowMap，
  // 开了会变成垫子上有影子、沙上没有」。现在沙的 fragment shader 直接采样同一张图
  // （sand.js 的 sunShadow()），两边是同一个影子，可以开了。
  renderer.shadowMap.enabled = true;
  // 用 PCF 而不是 PCFSoft：PCFSoft 的柔化程度写死在 shader 里，给不了滑块；
  // PCF 认 shadow.radius，「太阳阴影柔化」才拖得动
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.environment = beachEnvironment(renderer);   // 全场唯一的一张，见 共用/光照.js
  scene.environmentIntensity = envIntensity();      // 唯一的倍率：ambLight × envI
  // 物件吃和沙一模一样的那条空气透视（颜色、曲线、距离都同源）。数值在 applyParams 里刷
  scene.fog = new RadialFog(ENV.bgBot, 1, 1);

  /* --- 背景 --- */
  const bgQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ ...BackgroundShader, depthTest: false, depthWrite: false })
  );
  // uniforms 要自己的实例，别和别的 stage 共享
  bgQuad.material.uniforms = THREE.UniformsUtils.clone(BackgroundShader.uniforms);
  bgQuad.frustumCulled = false;
  bgQuad.renderOrder = -1;
  scene.add(bgQuad);
  const bgU = bgQuad.material.uniforms;

  /* --- 相机 --- */
  const camera = new THREE.PerspectiveCamera(38, 1, distance * 0.03, distance * 40);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  // 平移保持关闭（Iris 08-29 定稿：轨道中心不变；去海边看浪走「看海」定点机位，点海触发）
  controls.enablePan = false;
  controls.minDistance = distance * (5 / PROTO_DIST);
  controls.maxDistance = distance * (20 / PROTO_DIST);
  controls.minAzimuthAngle = -azimuthLimit;
  controls.maxAzimuthAngle = azimuthLimit;
  controls.minPolarAngle = Math.PI / 2 - pitchMax;
  controls.maxPolarAngle = Math.PI / 2 - pitchMin;
  controls.autoRotate = false;          // 自动旋转关闭（Iris 明确要求）
  polar = THREE.MathUtils.clamp(polar, controls.minPolarAngle, controls.maxPolarAngle);
  camera.position.set(
    target.x + distance * Math.sin(polar) * Math.sin(azimuth),
    target.y + distance * Math.cos(polar),
    target.z + distance * Math.sin(polar) * Math.cos(azimuth),
  );
  controls.update();
  /* 出厂机位快照 + 回正（0 键 / Home 键 / 面板「回正视角」）。
   * 平移开了之后人会把中心拖丢（Iris 08-29 就丢了一次），必须有一条回家的路。 */
  const HOME_VIEW = { pos: camera.position.clone(), target: controls.target.clone() };
  function resetView() {
    if (focus.on || focus.t < 1) { unfocus(); return; }   // 凑近看模式走它自己的恢复流程
    camera.position.copy(HOME_VIEW.pos);
    controls.target.copy(HOME_VIEW.target);
    controls.update();
  }

  /* --- 光 ---------------------------------------------------------------
   * 全场只有一个太阳。方向、强度、色温都在面板「光」区，
   * 沙的着色器（uSunDir/uSunC）、野餐垫的烘焙、这里的三盏 three 灯全读同一组值 ——
   * 明暗面才会是统一的。
   *   key  主光（方向光）    唯一给体积的
   *   fill 补光（反方向、弱） 专治深色物件读成一个洞
   *   hemi 半球光 + 环境贴图  没有遮蔽，越强画面越平
   * ⚠️ 阴影贴图仍然是关的：沙是自定义着色器，收不到 shadowMap，
   *    开了会变成「垫子上有影子、沙上没有」。接触阴影走 blobTex 面片。 */
  const keyDir = new THREE.Vector3(-0.42, 0.86, 0.40).normalize();   // applyParams 会按 sunAz/sunEl 重算
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.copy(keyDir).multiplyScalar(3);
  /* 投影的只有主光这一盏 —— 补光和半球光都不投，两个光源两套影子立刻就假了。
   * 正交视锥只框住野餐垫那一圈（±1.4m）：贝壳带在 3.2m 外，那里的沙已经化进雾里，
   * 给它分辨率是浪费，框小一点垫子上的影子才够锐。 */
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -1.4; sc.right = 1.4; sc.top = 1.4; sc.bottom = -1.4;
  sc.near = 0.05; sc.far = 8;
  sc.updateProjectionMatrix();
  // normalBias 治斜面上的自遮蔽（沙丘是大斜面，靠 bias 治会让影子整个飘走）
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.012;
  const fill = new THREE.DirectionalLight(0xffffff, 0.0);
  const hemi = new THREE.HemisphereLight(new THREE.Color(ENV.bgBot), new THREE.Color(ENV.sandC), 0.5);
  scene.add(key, key.target, fill, fill.target, hemi);

  /* 色温 → RGB 和太阳方向都在 共用/光照.js（kelvinColor / sunDirection）。 */
  const sunColor = new THREE.Color(1, 1, 1), ambColor = new THREE.Color(1, 1, 1);

  /* --- 环境组：沙、贝壳、泡泡（原型单位 × S） --- */
  const envGroup = new THREE.Group();
  envGroup.scale.setScalar(S);
  scene.add(envGroup);

  const sand = createSand();
  envGroup.add(sand.mesh);
  const waves = createWaves(sand);
  envGroup.add(waves.mesh);

  const glowTex = makeGlowTexture();
  const blobTex = makeBlobTexture();

  /* --- 材质注册表：调试面板改参数时统一刷新 --- */
  const iceMats = new Set();
  const solidMats = new Set();

  /* 透光材质。tier: 'soul' | 'glass' | 'petal' | 'bubble'
   * color 不给就用该档的默认色（宪法：物件本体无色银白，颜色只来自光；
   * 玻璃和花瓣保留自己的固有色）。map 给花头/贴图物件用。 */
  function iceMaterial(tier = 'soul', { color = null, map = null } = {}) {
    const m = new THREE.ShaderMaterial({
      vertexShader: ICE_VS,
      fragmentShader: ICE_FS,
      uniforms: {
        uColor: { value: new THREE.Color('#ffffff') },
        uRim:   { value: new THREE.Color(ENV.rim) },
        uCore:  { value: new THREE.Color(ENV.coreC) },
        uRimS:  { value: 1 }, uRimP: { value: 1.6 },
        uCoreS: { value: 0 }, uAlpha: { value: 0.5 },
        uMap:   { value: map }, uUseMap: { value: map ? 1 : 0 },
        uClampL: { value: 1.0 },
      },
      transparent: true,
      depthWrite: false,
      // ⚠️ 泡泡只渲正面：双面渲的球壳在掠射角上正反两面的菲涅尔会叠一次，
      //    边上就成了一条又亮又实的白圈（"泡泡外面套了个环"）。
      //    别的透光件（酒杯、罩子）还是双面 —— 它们要看得见里面那层。
      side: tier === 'bubble' ? THREE.FrontSide : THREE.DoubleSide,
    });
    m.userData = { tier, customColor: color };
    iceMats.add(m);
    refreshIce(m);
    return m;
  }
  function refreshIce(m) {
    const tier = ICE_TIERS[m.userData.tier] || ICE_TIERS.soul;
    const fallback = m.userData.tier === 'glass' ? ENV.bottle
                   : m.userData.tier === 'petal' ? ENV.flower
                   : m.userData.tier === 'bubble' ? ENV.bubbleC : ENV.body;
    m.uniforms.uColor.value.set(m.userData.customColor || fallback);
    m.uniforms.uRim.value.set(ENV.rim);
    m.uniforms.uCore.value.set(ENV.coreC);
    m.uniforms.uRimS.value = ENV.rimS / 100 * tier.rim();
    m.uniforms.uRimP.value = ENV.rimP / 100;
    m.uniforms.uCoreS.value = ENV.core / 100 * tier.core;
    m.uniforms.uAlpha.value = tier.alpha() / 100;
    // 泡泡的亮度压在 bloom 阈值（0.9）之下：不然飘到深蓝天上会晕出一圈光环
    m.uniforms.uClampL.value = m.userData.tier === 'bubble' ? 0.86 : 1.0;
  }

  /* 实体材质：不透明、flat shading、无金属。饱和的固有色 —— 可爱从这来。
   * raw: 不过调色变换也不吃全局饱和度（贝壳、特批的贴纸）。 */
  function solidMaterial(hex, { rough = 0.5, raw = false, emissive = null, emissiveIntensity = 1 } = {}) {
    const m = new THREE.MeshStandardMaterial({
      color: raw ? hex : grade(satBoost(hex)),
      roughness: rough, metalness: 0, flatShading: true,
    });
    if (emissive) { m.emissive = new THREE.Color(grade(emissive, 'emissive')); m.emissiveIntensity = emissiveIntensity; }
    m.userData = { baseHex: hex, raw };
    solidMats.add(m);
    return m;
  }
  const refreshSolid = m => {
    if (!m.userData.raw) m.color.set(grade(satBoost(m.userData.baseHex)));
  };

  /* 光源类：屏幕本体（自发光贴图）+ 它洒出去的光。
   * **发光的是屏幕那一层薄面，光沿着它的法线往前走** ——
   * 不是一颗灯泡（一版），不是整个背板一圈发光（二版），也不是地上一道光柱（三版）。
   * 三片，全部在面板「屏幕光」区可调：
   *   beam   从屏幕那层薄面**往前**照出去的一束（近端 = 屏幕矩形，按张角张开）
   *   spill  落在垫子/沙上的那片光，从电脑前沿往前张开
   *   bounce 打回键盘面上的那片（屏幕照亮键盘 —— 真实笔电最明显的一处）
   * ⚠️ 真正的面光源要 three 的 RectAreaLight，但它得配 RectAreaLightUniformsLib，
   *    我们 vendor 的这份 three 没带那个 addon。现在这版是"形状对了"的假面光。 */
  const screenMaterial = map => new THREE.MeshBasicMaterial({ map, toneMapped: true });
  const screenGlowList = [];
  const spillTexCache = new Map();
  const spillTex = (near, fall, soft) => {
    const k = near.toFixed(2) + '/' + fall.toFixed(2) + '/' + soft.toFixed(2);
    if (!spillTexCache.has(k)) spillTexCache.set(k, makeSpillTexture(near, fall, soft));
    return spillTexCache.get(k);
  };
  function createScreenGlow({ width = 1, height = 0.7 } = {}) {
    const group = new THREE.Group();
    // fog: false —— 加色的光不该"混向雾色"（那是往里加亮，混完只会更亮更脏）
    const lit = () => new THREE.MeshBasicMaterial({
      color: new THREE.Color(ENV.screenC),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    });
    // 单位面片，实际大小全靠 scale —— 拖滑块只改 scale/opacity，不重建几何
    const unit = () => new THREE.PlaneGeometry(1, 1);
    // 往前那截（四个侧面，顶点色带 alpha，所以材质要开 vertexColors）
    const beam = new THREE.Mesh(makeBeamGeometry(width, height, height, 14), new THREE.MeshBasicMaterial({
      color: new THREE.Color(ENV.screenC), vertexColors: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    }));
    // 贴在屏幕面上那层柔光 —— 单独一片，因为它的边要靠贴图化开（顶点色只能给硬边）
    const cap = new THREE.Mesh(unit(), lit());
    const spill = new THREE.Mesh(unit(), lit());
    const bounce = new THREE.Mesh(unit(), lit());
    for (const m of [beam, cap, spill, bounce]) m.userData.noBounds = true;
    const entry = { beam, cap, spill, bounce, width, height, beamKey: '', capKey: '' };
    screenGlowList.push(entry);
    refreshGlow(entry);
    return { group, beam, cap, spill, bounce, entry };
  }

  /* 屏幕光的全部参数都在这儿落地。emit 是总闸，其余四组各管一块。 */
  function refreshGlow(g) {
    const E = ENV;
    /* 总闸 = 屏幕发光 × 壁纸亮度的联动。
     * 壁纸调亮，屏幕本来就该往外照得更多 —— 这两件事在真机上是同一回事。
     * scrLink 决定绑多紧：0 = 完全不联动（回到只看 emit），100 = 亮度 99% 就出 99% 的光。 */
    const linkK = (E.scrLink ?? 100) / 100;
    const litK = 1 + ((E.screenLit ?? 100) / 100 - 1) * linkK;
    const master = (E.emit ?? 70) / 100 * Math.max(0, litK);
    const soft = (E.scrSoft ?? 60) / 100;
    const w = g.width, h = g.height;
    for (const m of [g.beam, g.cap, g.spill, g.bounce]) m.material.color.set(E.screenC);

    // 贴在屏幕面上那层柔光：和屏幕一样大，边靠贴图化开
    const capKey = soft.toFixed(2) + '/' + (w / h).toFixed(3);
    if (g.capKey !== capKey) {
      g.capKey = capKey;
      g.cap.material.map?.dispose();
      g.cap.material.map = makeSoftRectTexture(w / h, soft);
      g.cap.material.needsUpdate = true;
    }
    g.cap.scale.set(w, h, 1);
    g.cap.material.opacity = master * (E.scrBeam ?? 45) / 100 * 0.30;

    // 往前照的那束：近端就是屏幕那个矩形（不往两边扩），沿法线往前 scrBeamLen%（屏幕高的百分比），
    // 按 scrBeamAng 张开。**发光的是屏幕那一层薄面**，不是整个背板
    const len = h * (E.scrBeamLen ?? 90) / 100;
    const ang = E.scrBeamAng ?? 14;
    const key = len.toFixed(4) + '/' + ang;
    if (g.beamKey !== key) {                       // 形状变了才重建（拖滑块不会每帧建）
      g.beamKey = key;
      g.beam.geometry.dispose();
      g.beam.geometry = makeBeamGeometry(w, h, len, ang);
    }
    g.beam.material.opacity = master * (E.scrBeam ?? 45) / 100 * 0.16;

    // 洒光：从电脑前沿往前。长度按屏幕宽的百分比 —— 这一项就是"手电筒"的开关
    const sLen = w * (E.scrSpillLen ?? 45) / 100;
    const nearW = w * (E.scrSpillWide ?? 100) / 100;
    const sAng = (E.scrSpillAng ?? 22) * Math.PI / 180;
    const farW = nearW + 2 * sLen * Math.tan(sAng);
    g.spill.material.map = spillTex(Math.max(0.05, nearW / farW), 1.6, soft);
    g.spill.material.needsUpdate = true;
    g.spill.scale.set(farW, sLen, 1);
    g.spill.userData.spillLen = sLen;              // 摆位要知道它多长
    g.spill.material.opacity = master * (E.scrSpill ?? 45) / 100 * 0.30;

    // 反射光：屏幕打在键盘面上那一片。真笔电上这是最明显的一处
    const bl = w * (E.scrBounceLen ?? 55) / 100;
    g.bounce.material.map = spillTex(0.86, 2.2, soft);
    g.bounce.material.needsUpdate = true;
    g.bounce.scale.set(w * 1.02, bl, 1);
    g.bounce.userData.bounceLen = bl;
    g.bounce.material.opacity = master * (E.scrBounce ?? 40) / 100 * 0.34;
    g.onPlace?.();
  }
  const screenGlows = screenGlowList;             // applyParams 里遍历刷新

  /* --- 物件世界 --- */
  const world = new THREE.Group();
  scene.add(world);


  /* --- 谁投影、谁收影 ---
   * 规则一处写死，别在各物件里各标各的（那就又回到「每个物件各自打灯」了）：
   *   投影 = 不透明的实体件。玻璃/冰壳/光晕/接触阴影片一律不投 ——
   *          它们 depthWrite 是 false，投出来是一块实心黑，比没有还糟。
   *   收影 = 所有 Mesh（沙不用标：它的 shader 直接采样 shadow map，见 sand.js）。
   * 玻璃真正的影子交给 blobTex 那片接触阴影，那是假的但读得对。 */
  const shadowFlagged = new WeakSet();
  function flagShadows(root) {
    root.traverse(o => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      const solid = ms.every(m => m && m.depthWrite !== false && m.blending !== THREE.AdditiveBlending);
      o.castShadow = solid && !o.userData.noBounds && !o.userData.noShadow;
    });
  }

  /* --- 陷进沙里 ---
   * 每个物件在沙面上压一个坑 + 外圈堆一圈沙（沙的 shader 负责），
   * 物件本身往下沉一点，坑里再放一片接触阴影。
   * 加进 world 的直接子物件会在下一帧自动走这里；要自己控制就先 sink() 再 add。 */
  const sunk = new WeakSet();
  const entries = new Map();      // 物件 → { dent 句柄, 接触阴影, 尺寸, 落位基准 }，推沙靠它
  const blobShadows = new Set();
  const bbox = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  function measure(obj) {
    bbox.makeEmpty();
    obj.updateWorldMatrix(true, true);
    obj.traverse(o => {
      if (!o.isMesh || o.userData.noBounds || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmpBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      bbox.union(tmpBox);
    });
    return bbox;
  }
  function sink(obj, { radius = null, depth = null, lift = 0, bake = false } = {}) {
    if (sunk.has(obj)) return;
    sunk.add(obj);
    if (obj.userData.noSink) return;
    const b = measure(obj);
    if (b.isEmpty()) { sunk.delete(obj); return; }     // 模型还没加载完，下一帧再试
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const rW = radius ?? Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 * 1.15;
    const rL = rW / S;
    const dL = depth ?? THREE.MathUtils.clamp(rL * 0.22, 0.05, 0.40);
    // 陷落是「浅坐在坑里」：底面只低于原沙面一点点，外圈的堆沙咬住轮廓。
    // 埋太深就成了"沙里挖出来的东西"——只要一圈浅浅的沙咬住底边就够了
    let dent = null;
    if (bake) {
      // 小东西（贝壳、野花）的坑直接烤进高度场：不占着色器的坑位，撒多少颗都行。
      // 形状同 dent()：中间一个坑，外圈一圈堆沙
      const f = sand.fields.height;
      f.stamp(cx / S, cz / S, rL * 0.9, -dL * 0.9);
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * Math.PI * 2;
        f.stamp(cx / S + Math.cos(a) * rL * 1.15, cz / S + Math.sin(a) * rL * 1.15, rL * 0.45, dL * 0.22);
      }
    } else {
      dent = sand.addDent(cx / S, cz / S, rL, dL);
    }
    // 坐进自己的坑里：底面离坑底 35%——薄物件（贝壳）也能被坑沿咬住，
    // 不会出现"坑在下面凹、物件浮在原沙面高度"的悬空缝
    const inPitY = S * (sand.heightAt(cx / S, cz / S) + dL * 0.35);
    obj.position.y += inPitY + lift - b.min.y;
    // 接触阴影：软、浅，只在物件正下方
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: blobTex, color: '#6E7A86', transparent: true, depthWrite: false })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(cx / S, sand.heightAt(cx / S, cz / S) + 0.02, cz / S);
    blob.scale.setScalar(rL * 2.2);
    blob.userData.baseScale = rL * 2.2;
    envGroup.add(blob);
    blobShadows.add(blob);
    {
      entries.set(obj, {
        obj, dent, blob, rL, dL,
        cx: cx / S, cz: cz / S,                                  // 包围盒中心（沙的局部坐标）
        homeLX: cx / S, homeLZ: cz / S,                          // 「家」：推动范围以它为圆心
        offX: obj.position.x - cx, offZ: obj.position.z - cz,    // 物件原点相对包围盒中心
        yC: obj.position.y - inPitY,                             // y 的落位基准（沙变了按它重摆）
        rx0: obj.rotation.x, rz0: obj.rotation.z,
        rangeMul: obj.userData.rangeMul || 1,   // 贝壳这类小东西允许推得相对远些
        carry: 0,
      });
    }
    refreshBlobs();
  }
  /* 从沙里拿走（被浪卷走的贝壳 / 小生物）：清掉坑位、阴影、登记 */
  function unsink(obj) {
    const en = entries.get(obj);
    if (en) {
      if (en.dent) en.dent.set(0, 0, 0, 0);
      if (en.blob) { envGroup.remove(en.blob); blobShadows.delete(en.blob); }
      entries.delete(obj);
    }
    sunk.delete(obj);
    if (obj.parent) obj.parent.remove(obj);
  }
  const refreshBlobs = () => blobShadows.forEach(b => {
    b.material.opacity = params.shadow;
    b.scale.setScalar(b.userData.baseScale * (params.softness / 2.6));
  });

  /* --- 泡泡：几乎全透明，只剩一圈亮边 ---
   * 两类：环境泡泡（一直有，戳破了过几秒再冒）、许愿泡泡（访客在猫那里放飞的，带文字和形状）。
   * 形状：circle / heart / cat / dog。都能点一下戳破。 --- */
  const bubbleMat = iceMaterial('bubble');
  const bubbles = new THREE.Group();
  envGroup.add(bubbles);
  /* 泡泡的形状不走 low-poly，也绝不能是几块拼起来的（半透明材质会把拼接处的内部面透出来）。
   * 每种形状都是一张连续的单层曲面：定义一个隐式函数 f(p)（内负外正），
   * 从球心沿每个方向找 f=0 的那一点，得到一张光滑封闭的网格。 */
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const sdSphere = (x, y, z, cx, cy, cz, r) => Math.hypot(x - cx, y - cy, z - cz) - r;
  const sdEllip = (x, y, z, cx, cy, cz, rx, ry, rz) => {
    const k0 = Math.hypot((x - cx) / rx, (y - cy) / ry, (z - cz) / rz);
    return (k0 - 1) * Math.min(rx, ry, rz);
  };
  const SHAPE_SDF = {
    circle: (x, y, z) => Math.hypot(x, y, z) - 1,
    // 经典三维心形（Taubin）：(x² + 9/4 z² + y² − 1)³ − x² y³ − 9/80 z² y³ = 0，y 朝上
    heart: (x, y, z) => {
      const X = x * 1.15, Y = y * 1.15 + 0.12, Z = z * 1.4;
      const q = X * X + 2.25 * Z * Z + Y * Y - 1;
      return q * q * q - X * X * Y * Y * Y - 0.1125 * Z * Z * Y * Y * Y;
    },
    cat: (x, y, z) => {
      let d = sdEllip(x, y, z, 0, 0, 0, 1, 0.92, 0.95);
      d = smin(d, sdEllip(x, y, z, -0.58, 0.72, 0, 0.30, 0.55, 0.26), 0.28);
      d = smin(d, sdEllip(x, y, z,  0.58, 0.72, 0, 0.30, 0.55, 0.26), 0.28);
      return d;
    },
    dog: (x, y, z) => {
      let d = sdEllip(x, y, z, 0, 0, 0, 1, 0.92, 0.95);
      d = smin(d, sdEllip(x, y, z, -0.92, -0.15, 0.05, 0.30, 0.62, 0.26), 0.22);
      d = smin(d, sdEllip(x, y, z,  0.92, -0.15, 0.05, 0.30, 0.62, 0.26), 0.22);
      d = smin(d, sdSphere(x, y, z, 0, -0.30, 0.78, 0.42), 0.25);
      return d;
    },
  };
  const shapeGeoCache = new Map();
  function implicitGeometry(kind) {
    if (shapeGeoCache.has(kind)) return shapeGeoCache.get(kind);
    const f = SHAPE_SDF[kind] || SHAPE_SDF.circle;
    const geo = new THREE.SphereGeometry(1, 48, 36);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i), dy = pos.getY(i), dz = pos.getZ(i);
      // 先粗走找到符号翻转，再二分精修
      let t0 = 0.05, t1 = 2.6, s0 = f(dx * t0, dy * t0, dz * t0);
      let found = false;
      for (let k = 1; k <= 40; k++) {
        const t = 0.05 + (2.6 - 0.05) * k / 40;
        const sv = f(dx * t, dy * t, dz * t);
        if ((sv > 0) !== (s0 > 0)) { t1 = t; found = true; break; }
        t0 = t; s0 = sv;
      }
      if (!found) t1 = 1;
      for (let k = 0; k < 14; k++) {
        const tm = (t0 + t1) / 2;
        const sm = f(dx * tm, dy * tm, dz * tm);
        if ((sm > 0) !== (s0 > 0)) t1 = tm; else { t0 = tm; s0 = sm; }
      }
      const t = (t0 + t1) / 2;
      pos.setXYZ(i, dx * t, dy * t, dz * t);
    }
    // 形状归一：最大半径缩到 1，重心放回原点附近
    let mx = 0, cy = 0;
    for (let i = 0; i < pos.count; i++) { mx = Math.max(mx, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i))); cy += pos.getY(i); }
    cy /= pos.count;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) / mx, (pos.getY(i) - cy * 0.5) / mx, pos.getZ(i) / mx);
    geo.computeVertexNormals();     // 平滑法线 —— 泡泡是圆润的，不要 flat
    shapeGeoCache.set(kind, geo);
    return geo;
  }
  function bubbleShape(kind) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(implicitGeometry(kind), bubbleMat);
    m.userData.noBounds = true;
    g.add(m);
    g.userData.kind = kind;
    return g;
  }
  const bubbleList = [];    // { obj, kind, text, ambient, i, r, t0, pop, spawnX, spawnZ }
  function addBubble({ kind = 'circle', text = null, ambient = false, i = 0, at = null } = {}) {
    const obj = bubbleShape(kind);
    obj.userData.bubble = true;
    obj.userData.text = text;
    obj.visible = true;
    bubbles.add(obj);
    const r = ambient ? 0.16 + (i % 4) * 0.07 : 0.34;
    const e = { obj, kind, text, ambient, i, r, t0: 0, pop: -1, spawnX: at ? at[0] : 0, spawnZ: at ? at[1] : 0, phase: Math.random() * 6.28 };
    bubbleList.push(e);
    return e;
  }
  for (let i = 0; i < 9; i++) addBubble({ ambient: true, i });

  /* 放飞一个许愿泡泡。at = 世界坐标 [x, z]（猫的位置） */
  function spawnBubble({ text = '', kind = 'circle', at = [0, 0], ttl = 0, size = 0.34 } = {}) {
    const e = addBubble({ kind, text, at: [at[0] / S, at[1] / S] });
    e.t0 = bubbleClock; e.ttl = ttl; e.r = size;
    return e.obj;
  }
  /* 戳破：胀一下然后消失。环境泡泡几秒后再冒出来，许愿泡泡就没了。 */
  function popBubble(obj) {
    let node = obj; while (node && !node.userData.bubble) node = node.parent;
    const e = bubbleList.find(x => x.obj === node);
    if (!e || e.pop >= 0) return null;
    e.pop = bubbleClock;
    return e;
  }
  let bubbleClock = 0;
  /* 泡泡样式（点猫切换，旧接口留着）：0 常态 · 1 大而慢 · 2 小而密 */
  const BUBBLE_STYLES = [
    { scale: 1.0, speed: 1.0, color: null },
    { scale: 1.9, speed: 0.55, color: '#FFF1F6' },
    { scale: 0.55, speed: 1.6, color: '#E6FAFF' },
  ];
  let bubbleStyle = 0;
  function setBubbleStyle(i) {
    bubbleStyle = ((i % BUBBLE_STYLES.length) + BUBBLE_STYLES.length) % BUBBLE_STYLES.length;
    bubbleMat.userData.customColor = BUBBLE_STYLES[bubbleStyle].color;
    refreshIce(bubbleMat);
    return bubbleStyle;
  }
  function moveBubbles(t) {
    bubbleClock = t;
    const st = BUBBLE_STYLES[bubbleStyle];
    for (let k = bubbleList.length - 1; k >= 0; k--) {
      const e = bubbleList[k];
      const obj = e.obj;
      // 戳破动画：0.22 秒胀到 1.35 倍并隐去
      if (e.pop >= 0) {
        const p = (t - e.pop) / 0.22;
        if (p < 1) { obj.scale.setScalar(e.r * st.scale * (1 + 0.35 * p)); obj.visible = true; continue; }
        bubbles.remove(obj); bubbleList.splice(k, 1); continue;   // 戳破的泡泡不会再出现（Iris）
      }
      obj.visible = true;
      if (e.ambient) {
        const tt = t * st.speed, i = e.i;
        const a = i * 0.7 + tt * (0.12 + i % 3 * 0.04);
        // 从物件顶上方开始飘（1.3 局部单位 ≈ 22cm），不从沙和垫子里钻出来
        obj.position.set(Math.sin(a) * (3.4 + i % 3) * 1.05, 1.3 + ((tt * 0.35 + i * 1.3) % 5.2), Math.cos(a * 1.3) * (2.2 + i % 2));
        obj.scale.setScalar(e.r * st.scale);
      } else {
        // 许愿泡泡：从猫那儿升起，慢慢摇着往上飘，飘到顶再从下面回来
        const age = t - e.t0;
        if (e.ttl && age > e.ttl) { e.pop = t; continue; }            // 到期自己破
        const y = 1.3 + ((age * 0.28) % 6.0);
        obj.position.set(e.spawnX + Math.sin(age * 0.5 + e.phase) * 0.9, y, e.spawnZ + Math.cos(age * 0.37 + e.phase) * 0.7);
        obj.scale.setScalar(e.r * Math.min(1, age * 2.5));   // 刚放飞时从小胀大
        obj.rotation.y = Math.sin(age * 0.3) * 0.4;
      }
    }
  }

  /* --- 贝壳：散在物件圈外的小可爱。每颗都是独立的小物件 ——
   * 自动陷沙（很浅）、可以被小小地推着玩（rangeMul 放宽推动范围）。 --- */
  const shellList = [];
  for (const [x, z, r, rot, c, ty] of (shells ? SHELL_SPOTS : [])) {
    let px = x, pz = z;
    const d0 = Math.hypot(x, z), minR = 5.4;   // 中央留给物件/野餐垫，贝壳站外圈
    if (d0 < minR) { px = x / d0 * minR; pz = z / d0 * minR; }
    const shell = createShell(r, rot, c, ty);
    shell.scale.setScalar(S);
    shell.position.set(px * S, 0, pz * S);
    shell.userData.rangeMul = 5;
    world.add(shell);
    shellList.push(shell);
  }

  /* ================================================================
   * 推沙：拖动物件，沙被推开 —— 车辙留在身后，挖走的沙堆到前缘和两侧，
   * 沙痕会按安息角塌落、按 heal 速率慢慢抹平（都在 sand.field 里）。
   * ============================================================== */
  let settleTimer = 0;   // 沙动过之后的几秒里持续重摆物件（沙塌、抹平时物件跟着沉降）

  /* 把一个已陷沙的物件移到世界坐标 (wx, wz)：坑跟着走 + 沿路打沙痕。
   * 拖拽调它，以后阶段 4 的程序化推挤（碰撞、回弹）也调它。
   * 默认只能推离「家」pushRange% 半径 ——「小小的推沙感」，构图不会被玩坏；
   * 程序化需要大动作时传 { free: true }。 */
  /* quiet: 只挪位置不戳沙痕。给**每帧微量移动**用（浪搡贝壳、贝壳回家）——
   * 那类移动在几乎同一个点反复戳沙，几分钟就堆出一座白色尖锥
   * （Iris 08-29 报的「多了三个沙丘」就是这么来的）。手拖的照旧戳。 */
  function moveObject(obj, wx, wz, { free = false, quiet = false } = {}) {
    const en = entries.get(obj);
    if (!en) return;
    // 手拖的东西夹在沙痕场的记录范围里（出了范围就画不出车辙了）。
    // **程序化的推（free:true）不夹** —— 浪把贝壳卷向外海时，夹一下会把场外的贝壳
    // 一把拽回边界，看着像瞬移；而且会让场外的贝壳变成"推不动"，永远钉在原地。
    if (!free) {
      const lim = FIELD_HALF * 0.85 * S;
      wx = THREE.MathUtils.clamp(wx, -lim, lim);
      wz = THREE.MathUtils.clamp(wz, -lim, lim);
    }
    let lx = wx / S, lz = wz / S;
    if (!free) {
      const maxR = en.rL * (params.pushRange / 100) * en.rangeMul;
      const hx = lx - en.homeLX, hz = lz - en.homeLZ;
      const hd = Math.hypot(hx, hz);
      if (hd > maxR && hd > 0) {
        lx = en.homeLX + hx / hd * maxR;
        lz = en.homeLZ + hz / hd * maxR;
      }
      wx = lx * S; wz = lz * S;
    }
    let dx = lx - en.cx, dz = lz - en.cz;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return;
    dx /= dist; dz /= dist;
    // 沿路径按固定间隔打戳，快拖不断线、慢拖不堆死
    const push = quiet ? 0 : params.push / 100;
    if (quiet) en.carry = 0;   // 静默移动不欠账，不然下次真拖会把攒的戳一口气打出来
    const dS = Math.max(en.dL, 0.12);   // 沙痕的力度下限：贝壳再小，推过也要看得见一道
    const spacing = en.rL * 0.30;
    en.carry += dist;
    let walked = 0;
    // 场外没有沙痕可画，别空转（stamp 每次都会把整张贴图标脏，白白每帧上传一次）
    const inField = Math.max(Math.abs(lx), Math.abs(lz)) < FIELD_HALF;
    if (!inField) en.carry = 0;
    while (en.carry >= spacing && push > 0) {
      en.carry -= spacing;
      walked = Math.min(dist, walked + spacing);
      const sx = en.cx + dx * walked, sz = en.cz + dz * walked;
      const f = sand.field;
      // 车辙：身后挖走一点
      f.stamp(sx - dx * en.rL * 0.30, sz - dz * en.rL * 0.30, en.rL * 0.80, -dS * 0.24 * push);
      // 前缘：推起来的沙堆（bow pile）
      f.stamp(sx + dx * en.rL * 1.05, sz + dz * en.rL * 1.05, en.rL * 0.55, dS * 0.30 * push);
      // 两侧翻出来的小埂
      f.stamp(sx - dz * en.rL * 0.95 + dx * en.rL * 0.3, sz + dx * en.rL * 0.95 + dz * en.rL * 0.3,
              en.rL * 0.45, dS * 0.10 * push);
      f.stamp(sx + dz * en.rL * 0.95 + dx * en.rL * 0.3, sz - dx * en.rL * 0.95 + dz * en.rL * 0.3,
              en.rL * 0.45, dS * 0.10 * push);
    }
    en.cx = lx; en.cz = lz;
    en.obj.position.x = wx + en.offX;
    en.obj.position.z = wz + en.offZ;
    if (en.dent) en.dent.set(lx, lz, en.rL, en.dL);   // 坑实时跟着物件（风纹和细闪的 advect 也跟着）
    settleTimer = 2.0;
  }

  /* 沙动了之后，把每个物件重新坐进沙里：高度贴着当下的沙面（不含自己的坑）、
   * 顺着坡微微倾斜。沙慢慢抹平时，物件会跟着轻轻沉回去 —— 物理感主要来自这里。 */
  function settleObjects() {
    entries.forEach(en => {
      en.obj.position.y = S * (sand.heightAt(en.cx, en.cz) + en.dL * 0.35) + en.yC;
      const d = en.rL * 0.6;
      const gx = (sand.heightAt(en.cx + d, en.cz, en.dent) - sand.heightAt(en.cx - d, en.cz, en.dent)) / (2 * d);
      const gz = (sand.heightAt(en.cx, en.cz + d, en.dent) - sand.heightAt(en.cx, en.cz - d, en.dent)) / (2 * d);
      const tx = en.rx0 - THREE.MathUtils.clamp(Math.atan(gz) * 0.5, -0.12, 0.12);
      const tz = en.rz0 + THREE.MathUtils.clamp(Math.atan(gx) * 0.5, -0.12, 0.12);
      en.obj.rotation.x += (tx - en.obj.rotation.x) * 0.12;
      en.obj.rotation.z += (tz - en.obj.rotation.z) * 0.12;
      en.blob.position.set(en.cx, sand.heightAt(en.cx, en.cz) + 0.02, en.cz);
    });
  }

  /* 开启「拖物件推沙」。opt-in：环境预览页开，物件 viewer 不受影响。 */
  let dragging = null;
  /* 光标钩子：设了之后 stage 不再直接摸 canvas.style.cursor，
   * 把意图（'' | 'grab' | 'grabbing'）交给外面的光标模块（兔子光标）。
   * 不设照旧 —— 物件 viewer 那些页没有兔子。 */
  let cursorHook = null;
  const setCursorHook = fn => { cursorHook = fn; };
  const cursorIntent = (kind, fallback) => {
    if (cursorHook) cursorHook(kind);
    else canvas.style.cursor = fallback;
  };
  const dragRay = new THREE.Raycaster();
  const dragNdc = new THREE.Vector2();
  function pickEntry(e) {
    const r = canvas.getBoundingClientRect();
    dragNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    dragRay.setFromCamera(dragNdc, camera);
    const hit = dragRay.intersectObjects(world.children, true)[0];
    if (!hit) return null;
    let node = hit.object;
    while (node.parent && node.parent !== world) node = node.parent;
    const en = entries.get(node);
    return en ? { en, hit } : null;
  }
  function enableSandDrag() {
    if (enableSandDrag.on) return;
    enableSandDrag.on = true;
    // capture 阶段先于 OrbitControls 拿到事件：点中物件就拖物件，点空处才转相机
    canvas.addEventListener('pointerdown', e => {
      const p = pickEntry(e);
      if (!p) return;
      e.stopImmediatePropagation();
      try { canvas.setPointerCapture(e.pointerId); } catch { /* 合成指针没有捕获权，无妨 */ }
      dragging = {
        en: p.en, grabY: p.hit.point.y,
        offX: p.en.cx * S - p.hit.point.x,
        offZ: p.en.cz * S - p.hit.point.z,
      };
      cursorIntent('grabbing', 'grabbing');
    }, true);
    canvas.addEventListener('pointermove', e => {
      if (dragging) {
        const r = canvas.getBoundingClientRect();
        dragNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        dragRay.setFromCamera(dragNdc, camera);
        // 拖动发生在抓取点高度的水平面上。只记目标，不直接跟手 ——
        // 每帧向目标挪一小步（见 render），推起来才有"沙里推重物"的阻力感
        const t = (dragging.grabY - dragRay.ray.origin.y) / dragRay.ray.direction.y;
        if (t > 0) {
          dragging.tx = dragRay.ray.origin.x + dragRay.ray.direction.x * t + dragging.offX;
          dragging.tz = dragRay.ray.origin.z + dragRay.ray.direction.z * t + dragging.offZ;
        }
      } else {
        const k = pickEntry(e) ? 'grab' : '';
        cursorIntent(k, k);
      }
    });
    canvas.addEventListener('pointerup', () => { dragging = null; cursorIntent('', ''); });
  }

  /* --- 后处理链：render → 景深 → 光晕 → 色调映射 → 颗粒 --- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: distance, aperture: 0.0022, maxblur: 0.008 });
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.6, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* 玻璃遮罩：标了 markGlass() 的物件单独渲一张纯白图，
   * 颗粒 shader 用它把透明件上的颗粒抹掉。
   * 「透明就不需要做颗粒了，就纯透明就好」—— Iris，2026-08-17 */
  const GLASS_LAYER = 1;
  const maskRT = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: true });
  // fog: false —— 遮罩要的是纯白的"这里是玻璃"，被雾染灰了颗粒就抹不干净
  const maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  function renderGlassMask() {
    const oldOv = scene.overrideMaterial;
    scene.overrideMaterial = maskMat;
    // 这一趟不要重渲 shadow map：遮罩用的是 MeshBasicMaterial，根本不吃影子，
    // 而且这里 camera.layers 只剩玻璃层，渲出来的会是一张只有玻璃的图（下一趟又被覆盖）
    // —— 白烧一整个 shadow pass。
    renderer.shadowMap.autoUpdate = false;
    camera.layers.set(GLASS_LAYER);
    const oldClear = renderer.getClearColor(new THREE.Color());
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(maskRT);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(oldClear, 1);
    camera.layers.set(0);
    renderer.shadowMap.autoUpdate = true;
    scene.overrideMaterial = oldOv;
  }
  function markGlass(obj) {
    obj.traverse(o => { if (o.isMesh) o.layers.enable(GLASS_LAYER); });
  }

  const grain = new ShaderPass(GrainShader);
  grain.uniforms.uMask.value = maskRT.texture;
  grain.renderToScreen = true;
  composer.addPass(grain);

  /* --- 参数 ---
   * ENV 就是参数本体（共用/constitution.js），面板上调完复制 JSON 贴回那里，只贴一处。
   * 额外几个键是旧 viewer 面板在用的后处理项，保持键名不变。 */
  // params 就是 ENV 本体（同一个对象），面板拖滑块 = 直接改 ENV。
  // 后处理那几个键从 2026-08-25 起也住在 constitution.js 里，这里只对老版本的
  // constitution 兜个底，不再覆盖出厂值 —— 否则「恢复默认」会回到硬编码值而不是宪法值。
  const FALLBACK = { glow: ENV.bloom, exposure: 1.0, shadow: 0.30, softness: 2.6,
                     dof: 0.008, aberration: 0.0006, glassClean: 0.92, envI: 46,
                     sunShadow: 50, sunSoft: 2.5, objFog: 45,
                     envVar: 120, fogFar: 165, contrast: 110, sandLit: 130, screenBg: 0, screenLit: 100, siteW: 900, siteH: 620,
                     ckFruitA: 72, ckFruitGlow: 58, ckFruitRim: 100, gtTop: 2, gtBack: 5, gtIrid: 0,
                     ckFruitY: -9, ckFruitTilt: 8, ckFruitScale: 100, ckFruitSlit: 2.2, ckFruitOn: 1, ckRefract: 130,
                     scrBeam: 45, scrBeamLen: 90, scrBeamAng: 14, scrSoft: 72, scrLink: 100,
                     scrSpill: 45, scrSpillLen: 45,
                     scrSpillWide: 100, scrSpillAng: 22, scrBounce: 40, scrBounceLen: 55 };
  for (const k in FALLBACK) if (ENV[k] === undefined) ENV[k] = FALLBACK[k];
  const params = ENV;

  const paramListeners = new Set();
  function applyParams() {
    ENV.bloom = params.glow;
    // 沙
    sand.uniforms.uAmp.value = params.wave / 100 * 0.42;
    sand.uniforms.uSparkS.value = params.sparkS / 100 * 1.5;
    sand.uniforms.uSandDark.value.set(params.sandC);
    sand.uniforms.uSandLight.value.set(shade(params.sandC, 0.06));
    sand.uniforms.uFogColor.value.set(params.bgBot);   // 必须严格等于背景在地平线处的颜色
    // 雾的距离：沙 / 浪 / 物件三条一起缩放，整个世界的"清透 ↔ 朦胧"归这一个滑块
    sand.uniforms.uFar.value = SAND_FAR * (params.fogFar ?? 100) / 100;
    waves.uniforms.uFar.value = SAND_FAR * (params.fogFar ?? 100) / 100;
    // 物件的雾 = 沙那条的世界坐标版：同一个颜色、同一条曲线、同一个距离（统一光照 第 3 步）
    scene.fog.color.set(params.bgBot);
    scene.fog.far = sand.uniforms.uFar.value * 0.62 * S;
    scene.fog.amount = (params.objFog ?? 100) / 100;
    // 湿沙与浪
    sand.uniforms.uWetDark.value = params.wetDark / 100;
    sand.uniforms.uWetGloss.value = params.wetGloss / 100;
    sand.uniforms.uWetSink.value = params.wetSink / 100 * 0.1;
    sand.uniforms.uWetTint.value.set(params.wetC);
    waves.setParams(params);
    sand.uniforms.uWaveDir.value.copy(waves.uniforms.uDir.value);
    sand.uniforms.uWaveReach.value = params.waveReach;
    // 背景
    bgU.uBgTop.value.set(params.bgTop);
    bgU.uBgMid.value.set(params.bgMid);
    bgU.uBgBot.value.set(params.bgBot);
    bgU.uBgStop.value = params.bgStop / 100;
    bgU.uBgMidStop.value = params.bgMidStop / 100;
    bgU.uHorizC.value.set(params.horizC);
    bgU.uHoriz.value = params.horiz / 100;
    // 材质
    iceMats.forEach(refreshIce);
    solidMats.forEach(refreshSolid);
    refreshEnvI();          // 各材质的「反射性格」按 envVar 重新放大（共用/光照.js）
    screenGlows.forEach(refreshGlow);
    bubbles.visible = !!params.bubbles;
    shellList.forEach(s => { s.visible = !!params.shells; });
    // 光 / 后处理
    hemi.color.set(params.bgBot); hemi.groundColor.set(params.sandC);
    // 主光 vs 环境光的比值 = 整个画面的"阴影感"。环境光没有遮蔽，越强越平
    const kf = (params.keyLight ?? 70) / 100, af = (params.ambLight ?? 100) / 100;
    // 太阳方向：方位角 + 高度角 → 单位向量（指向光源）
    sunDirection(params.sunAz ?? -46, params.sunEl ?? 56, keyDir);
    kelvinColor(params.keyK ?? 6500, sunColor);
    kelvinColor(params.ambK ?? 6500, ambColor);
    key.position.copy(keyDir).multiplyScalar(3);
    key.intensity = kf;
    key.color.copy(sunColor);
    // 阴影浓度 0 = 和开 shadowMap 之前一模一样（图还是照渲，只是不乘进去）
    key.shadow.intensity = (params.sunShadow ?? 55) / 100;
    key.shadow.radius = params.sunSoft ?? 3;
    // 补光：从主光背面来、压得很低、稍微抬高一点，专门把深色物件的背光面从"洞"里捞出来
    fill.position.set(-keyDir.x, Math.max(0.25, keyDir.y * 0.35), -keyDir.z).multiplyScalar(3);
    fill.intensity = (params.fill ?? 0) / 100 * 0.9;
    fill.color.copy(ambColor);
    hemi.intensity = af * 0.5;
    // 环境贴图的强度也只有这一处。物件材质里不再各自设 envMapIntensity（统一光照 第 1 步）
    scene.environmentIntensity = envIntensity();
    // 沙是自己的着色器，不吃 three 的灯 —— 把同一组值换算进它的 uniform，
    // 出厂值（kf=0.7, af=1, 6500K）正好还原成改造前写死的 0.80 / 0.22 / 白
    sand.uniforms.uLightMix.value.set(0.80 * af, 0.22 * kf / 0.7 * (params.sandLit ?? 100) / 100);
    sand.uniforms.uSunDir.value.copy(keyDir);
    sand.uniforms.uSunC.value.copy(sunColor);
    sand.uniforms.uAmbC.value.copy(ambColor);
    bloom.strength = params.glow / 100 * 0.9;
    grain.uniforms.uAmount.value = params.grain / 100 * 0.55;
    grain.uniforms.uHazeV.value = params.haze / 100;
    grain.uniforms.uHazeR.value = params.glow / 100 * 0.45;
    grain.uniforms.uHazeColor.value.set(params.hazeC);
    grain.uniforms.uAberr.value = params.aberration;
    grain.uniforms.uMaskCut.value = params.glassClean;
    grain.uniforms.uContrast.value = (params.contrast ?? 100) / 100;
    renderer.toneMappingExposure = params.exposure;
    bokeh.materialBokeh.uniforms.maxblur.value = params.dof;
    refreshBlobs();
    paramListeners.forEach(fn => { try { fn(params); } catch (e) { console.warn(e); } });
  }
  applyParams();

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    maskRT.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  }
  addEventListener('resize', resize);
  resize();

  /* 鼠标视差：只摆视线方向 2–3°，不动轨道（宪法 五点五） */
  const parallax = { x: 0, y: 0, tx: 0, ty: 0, amount: 2.5 * Math.PI / 180 };
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    parallax.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    parallax.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  });

  /* --- 凑近看某个物件 --------------------------------------------------
   * 点电脑 → 镜头飞到屏幕正前方。**不是弹窗**：还是同一个 3D 场景、同一片海在后面，
   * 所以浪、泡泡、光照全都继续跑（Iris 明确要的就是这个）。
   *
   * 三个坑：
   * 1. OrbitControls 的 minDistance 出厂是 0.85m —— 比屏幕前 0.3m 远得多，
   *    不放开的话 update() 每帧把镜头顶回去，看着像"飞不过去"。所以进出焦要存/还原限位。
   * 2. controls.update() 是从 camera.position **反推**球坐标的，
   *    所以补间期间直接写 position 是安全的（写完它再夹一次限位就行）。
   * 3. 视差（parallax）那两下 rotate 会叠在补间上，导致镜头到位后还在轻微飘。
   *    对焦期间把视差按到 0 —— 凑近看东西的时候手不该抖。 */
  const focus = { on: false, t: 1, dur: 0.85, from: null, to: null, saved: null, onDone: null };
  const _fp = new THREE.Vector3(), _ft = new THREE.Vector3();
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  /* 飞到 pos 看 target。limits 传 false 就不放开限位（用于飞回去） */
  function flyTo(pos, target, { dur = 0.85, relax = true, onDone = null } = {}) {
    if (relax && !focus.saved) {
      focus.saved = {
        minDistance: controls.minDistance, maxDistance: controls.maxDistance,
        minPolarAngle: controls.minPolarAngle, maxPolarAngle: controls.maxPolarAngle,
        minAzimuthAngle: controls.minAzimuthAngle, maxAzimuthAngle: controls.maxAzimuthAngle,
        pos: camera.position.clone(), target: controls.target.clone(),
      };
      controls.minDistance = distance * 0.02;
      controls.maxDistance = distance * 40;
      controls.minPolarAngle = 0.02;
      controls.maxPolarAngle = Math.PI - 0.02;
      controls.minAzimuthAngle = -Infinity;
      controls.maxAzimuthAngle = Infinity;
    }
    focus.from = { pos: camera.position.clone(), target: controls.target.clone() };
    focus.to = { pos: pos.clone(), target: target.clone() };
    focus.t = 0; focus.dur = dur; focus.onDone = onDone;
    controls.enabled = false;
    return focus;
  }

  /* 对着某个 Mesh 的正面站住。看的是它的**世界法线**，所以物件转了、被推走了都不用改这儿。 */
  function focusOnFace(mesh, { fill = 0.62, lift = 0.10, dur = 0.85 } = {}) {
    mesh.updateWorldMatrix(true, false);
    // ⚠️ 用**几何体自己的**包围盒，别用 setFromObject —— 后者会把子物件算进来。
    //    屏幕的光晕面片就是挂在屏幕网格底下的，算进去盒子会大一圈，镜头停得太远。
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // 面的法线：取几何法线的平均再转到世界（屏幕是块平板，平均就是它的朝向）
    const n = new THREE.Vector3(0, 0, 1);
    const attr = mesh.geometry?.attributes?.normal;
    if (attr) {
      n.set(0, 0, 0);
      for (let i = 0; i < attr.count; i++) n.x += attr.getX(i), n.y += attr.getY(i), n.z += attr.getZ(i);
      if (n.lengthSq() < 1e-9) n.set(0, 0, 1);
      n.normalize().transformDirection(mesh.matrixWorld).normalize();
    }
    // 法线可能朝里 —— 取和当前镜头同侧的那一面
    if (n.dot(_fp.copy(camera.position).sub(c)) < 0) n.negate();
    // 画面里让这块面占 fill 那么高 → 需要多远
    const h = Math.max(size.y, size.x / (camera.aspect || 1.6), 1e-4);
    const d = (h / fill) / (2 * Math.tan(camera.fov * Math.PI / 360));
    _fp.copy(c).addScaledVector(n, d).addScaledVector(_ft.set(0, 1, 0), h * lift);
    focus.on = true;
    return flyTo(_fp, c, { dur });
  }

  function unfocus({ dur = 0.8 } = {}) {
    if (!focus.saved) { focus.on = false; return; }
    const back = focus.saved;
    flyTo(back.pos, back.target, {
      dur, relax: false,
      onDone: () => {
        // 先把机位钉回出发点，再还原限位。顺序反了、或者补间中途页面被切到后台
        // （rAF 停了、下一帧 dt 巨大）的话，收尾这一帧可能落在限位外，
        // 被 controls 夹到 maxDistance 上 —— 表现就是"退出后镜头莫名飞很远"。
        camera.position.copy(back.pos);
        controls.target.copy(back.target);
        controls.minDistance = back.minDistance; controls.maxDistance = back.maxDistance;
        controls.minPolarAngle = back.minPolarAngle; controls.maxPolarAngle = back.maxPolarAngle;
        controls.minAzimuthAngle = back.minAzimuthAngle; controls.maxAzimuthAngle = back.maxAzimuthAngle;
        focus.saved = null;
      },
    });
    focus.on = false;
  }

  let seed = 0, acc = 0, time = 0;
  function render(dt) {
    time += dt;
    // 新加进 world 的物件自动陷进沙里 + 打投影标记（同一趟）
    for (const child of world.children) {
      if (!sunk.has(child)) sink(child);
      if (!shadowFlagged.has(child)) { shadowFlagged.add(child); flagShadows(child); }
    }

    // 镜头补间（点物件凑近看）：写完 position 再让 controls 夹一次限位
    if (focus.t < 1) {
      focus.t = Math.min(1, focus.t + dt / focus.dur);
      const k = easeInOut(focus.t);
      camera.position.lerpVectors(focus.from.pos, focus.to.pos, k);
      controls.target.lerpVectors(focus.from.target, focus.to.target, k);
      if (focus.t >= 1) {
        controls.enabled = true;
        const done = focus.onDone; focus.onDone = null;
        if (done) done();
      }
    }
    controls.update();
    // 对焦期间不要视差 —— 凑近看东西的时候手不该抖
    const px = focus.on || focus.t < 1 ? 0 : parallax.tx;
    const py = focus.on || focus.t < 1 ? 0 : parallax.ty;
    parallax.x += (px - parallax.x) * 0.06;
    parallax.y += (py - parallax.y) * 0.06;
    camera.rotateY(-parallax.x * parallax.amount);
    camera.rotateX(-parallax.y * parallax.amount * 0.45);

    // 地平线位置跟着相机俯仰角走（规格 第五节）
    const pitch = Math.PI / 2 - controls.getPolarAngle();
    const halfFov = camera.fov / 2 * Math.PI / 180;
    bgU.uHorizF.value = THREE.MathUtils.clamp(
      0.5 - 0.5 * (Math.tan(pitch) / Math.tan(halfFov)), 0.02, 0.98);

    sand.uniforms.uTime.value = time;   // 只驱动细闪的忽闪，沙丘本身是静止的
    // 拖拽：物件是被"推"过去的，不是被拎过去的 ——
    //   死区：指针拉开一小段距离之前，物件被沙咬住不动（静摩擦）
    //   慢跟 + 限速：追不上指针，最快也就犁沙的速度
    if (dragging && dragging.tx !== undefined) {
      const en = dragging.en;
      const cx = en.cx * S, cz = en.cz * S;
      const vx = dragging.tx - cx, vz = dragging.tz - cz;
      const d = Math.hypot(vx, vz);
      /* 「拖动摩擦」sandGrip：死区、跟手、限速三个都吃它（100 = 08-29 之前的手感）。
       * ⚠️ 限速原来只有 rL×1.5 —— 跟接触半径挂钩，贝壳半径小，限速小到只能爬，
       * 「太难拖」主要是这一条。现在加了 0.30 m/s 的世界单位下限。 */
      const grip = Math.max(0.2, (params.sandGrip ?? 100) / 100);
      const dead = en.rL * S * 0.35 * grip;
      if (d > dead) {
        const want = (d - dead) * (1 - Math.exp(-dt * 3.2 / grip));
        const step = Math.min(want, Math.max(en.rL * S * 1.5, 0.30) * dt / grip);
        moveObject(en.obj, cx + vx / d * step, cz + vz / d * step);
      }
    }
    // 两张场（顺序见 场接口.md 第四节）：浪写场 → 场物理 → 上传贴图
    waves.update(dt);
    const { height, wet, marks } = sand.fields;
    height.step(dt, params.repose / 100, params.heal / 100);
    wet.step(dt, params.dryTime);
    marks.step(dt, params.markFade);
    const fieldChanged = height.commit() | wet.commit() | marks.commit();
    // 沙在动的时候，物件跟着沙面沉降、微倾
    if (fieldChanged || dragging || settleTimer > 0) {
      settleTimer = Math.max(0, settleTimer - dt);
      settleObjects();
    }
    moveBubbles(time);
    bokeh.materialBokeh.uniforms.focus.value = camera.position.distanceTo(controls.target);

    renderGlassMask();

    // 颗粒每秒跳 12 次，不是每帧 —— 每帧闪会"脏"
    acc += dt;
    if (acc > 1 / 12) { acc = 0; seed = (seed + 17.13) % 1000; grain.uniforms.uSeed.value = seed; }

    composer.render();
  }

  /* --- 调试面板（按 E 开关）---
   * 规格第七节：这组参数是在占位几何体上调的，换真模型一定要重调，
   * 所以全部可调、可复制。 */
  const DEFAULTS = JSON.stringify(params);   // 出厂值快照，「恢复默认」用

  let panel = null;
  const PANEL_SECTIONS = [
    ['沙 · 推沙', [
      ['沙丘起伏', 'wave', 0, 100, 1], ['细闪', 'sparkS', 0, 100, 1],
      ['推沙强度', 'push', 0, 100, 1], ['落沙速度', 'heal', 0, 100, 1],
      ['安息角(堆多陡)', 'repose', 0, 100, 1], ['推动范围%', 'pushRange', 0, 200, 1],
      ['拖动摩擦', 'sandGrip', 20, 200, 5],
    ]],
    ['排版（cm / °）', [
      ['唱机 X', 'ttX', -95, 95, 1], ['唱机 Z', 'ttZ', -70, 70, 1], ['唱机 转', 'ttR', -180, 180, 1],
      ['MacBook X', 'mbX', -95, 95, 1], ['MacBook Z', 'mbZ', -70, 70, 1], ['MacBook 转', 'mbR', -180, 180, 1],
      ['吉他 X', 'gtX', -95, 95, 1], ['吉他 Z', 'gtZ', -70, 70, 1], ['吉他 转', 'gtR', -180, 180, 1], ['吉他 缩放%', 'gtScale', 50, 110, 1],
      ['酒 X', 'ckX', -95, 95, 1], ['酒 Z', 'ckZ', -70, 70, 1], ['酒 转', 'ckR', -180, 180, 1],
      ['猫猫 X', 'catX', -95, 95, 1], ['猫猫 Z', 'catZ', -70, 70, 1], ['猫猫 转', 'catR', -180, 180, 1],
      ['相机 X', 'camX', -95, 95, 1], ['相机 Z', 'camZ', -70, 70, 1], ['相机 转', 'camR', -180, 180, 1],
      ['向日葵 X', 'sunX', -95, 95, 1], ['向日葵 Z', 'sunZ', -70, 70, 1], ['向日葵 转', 'sunR', -180, 180, 1],
    ]],
    ['黑胶 · 贝壳', [
      ['黑胶厚度%', 'recordThick', 5, 100, 1],
      ['彩胶通透', 'vinylA', 10, 95, 1], ['沟槽深浅', 'vinylGroove', 0, 150, 1],
      ['边缘透光', 'vinylRim', 0, 250, 1],
      ['贝壳数量', 'shellCount', 0, 220, 1], ['贝壳大小%', 'shellScale', 100, 500, 5],
      ['贝壳带·近端cm', 'shellNear', 40, 160, 1], ['贝壳带·远端cm', 'shellFar', 100, 320, 1],
      ['贝壳漂走%', 'shellDrift', 0, 60, 1], ['浪推贝壳%', 'shellSwash', 0, 250, 5],
    ]],
    ['鸡尾酒 · 果肉', [
      ['果肉通透', 'ckFruitA', 10, 100, 1], ['果肉透光', 'ckFruitGlow', 0, 200, 1],
      ['果肉边缘光', 'ckFruitRim', 0, 250, 1],
      ['橙片高低mm', 'ckFruitY', -25, 15, 0.5], ['橙片前倾°', 'ckFruitTilt', -25, 35, 1],
      ['橙片大小%', 'ckFruitScale', 60, 140, 1], ['橙片缺口°(需刷新)', 'ckFruitSlit', 0.5, 20, 0.1],
      ['挂橙片 1有0无', 'ckFruitOn', 0, 1, 1], ['水下折射%', 'ckRefract', 100, 145, 1],
    ]],
    ['野餐垫', [
      ['格纹深浅', 'blanketLineA', 0, 100, 1], ['布面提亮', 'blanketGlow', 0, 30, 1],
      ['褶皱明暗', 'blanketShade', 0, 250, 1],
    ]],
    ['浪 · 湿沙', [
      ['浪 开关', 'waveOn', 0, 1, 1], ['涨退周期(秒)', 'wavePeriod', 3, 30, 0.5],
      ['冲多近', 'waveReach', 4.5, 14, 0.1], ['来向(度)', 'waveDir', -180, 180, 5],
      ['冲平沙痕', 'waveErase', 0, 100, 1], ['泡沫', 'waveFoam', 0, 100, 1],
      ['浪声音量', 'waveVol', 0, 100, 1],
      ['浪声 1合成/0真实', 'waveSynth', 0, 1, 1],
      ['海·横向宽度', 'seaWidth', 60, 400, 10], ['海·纵向长度', 'seaLength', 40, 300, 10],
      ['变干(秒)', 'dryTime', 3, 180, 1], ['湿沙变深', 'wetDark', 0, 100, 1],
      ['湿沙水光', 'wetGloss', 0, 100, 1], ['湿沙下沉', 'wetSink', 0, 100, 1],
    ]],
    ['发光 · 材质', [
      ['屏幕发光(总闸)', 'emit', 0, 100, 1], ['壁纸亮度', 'screenLit', 30, 180, 1],
      ['屏幕风格', 'screenBg', 0, SCREEN_BGS.length - 1, 1, SCREEN_BGS],
      ['吉他·面板', 'gtTop', 0, GT_TOPS.length - 1, 1, GT_TOPS],
      ['吉他·背侧板', 'gtBack', 0, GT_BACKS.length - 1, 1, GT_BACKS],
      ['吉他·音孔虹彩', 'gtIrid', 0, 200, 1],
      ['固有色饱和', 'sat', 0, 220, 1],
      ['边缘光', 'rimS', 0, 200, 1], ['边缘锐度', 'rimP', 50, 600, 1], ['内核', 'core', 0, 150, 1],
      ['灵魂·边缘', 'rimSoul', 0, 200, 1], ['灵魂·不透明', 'alphaSoul', 0, 100, 1],
      ['玻璃·边缘', 'rimGlass', 0, 200, 1], ['玻璃·不透明', 'alphaGlass', 0, 100, 1],
      ['花瓣·边缘', 'rimPetal', 0, 200, 1], ['花瓣·不透明', 'alphaPetal', 0, 100, 1],
    ]],
    ['弹窗', [
      ['许愿窗 宽', 'wishW', 280, 900, 10], ['许愿窗 高(0=自动)', 'wishH', 0, 800, 10],
      ['迷你播放器 宽', 'miniW', 150, 420, 5], ['迷你播放器 高(0=自动)', 'miniH', 0, 320, 5],
      ['相册 宽', 'galW', 360, 1100, 10], ['相册 高', 'galH', 320, 900, 10],
      ['酒·网站窗 宽', 'siteW', 420, 1280, 10], ['酒·网站窗 高', 'siteH', 320, 900, 10],
    ]],
    ['光', [
      ['主光', 'keyLight', 0, 250, 1], ['环境光', 'ambLight', 0, 200, 1],
      ['补光(治暗物件)', 'fill', 0, 150, 1], ['环境反射', 'envI', 0, 200, 1],
      ['材质反射差异', 'envVar', 0, 200, 1],
      ['太阳阴影', 'sunShadow', 0, 100, 1], ['太阳阴影柔化', 'sunSoft', 0, 12, 0.5],
      ['沙·受光', 'sandLit', 0, 250, 1],
      ['太阳方位角°', 'sunAz', -180, 180, 1], ['太阳高度角°', 'sunEl', 3, 89, 1],
      ['主光色温K', 'keyK', 2000, 12000, 100], ['环境色温K', 'ambK', 2000, 12000, 100],
    ]],
    ['屏幕光', [
      ['前射强度', 'scrBeam', 0, 150, 1], ['前射距离%', 'scrBeamLen', 0, 260, 1],
      ['前射张角°', 'scrBeamAng', 0, 45, 1],
      ['边界柔化', 'scrSoft', 0, 100, 1], ['亮度联动', 'scrLink', 0, 200, 1],
      ['洒光强度', 'scrSpill', 0, 150, 1], ['洒光长度%', 'scrSpillLen', 0, 160, 1],
      ['洒光宽度%', 'scrSpillWide', 20, 200, 1], ['洒光张角°', 'scrSpillAng', 0, 60, 1],
      ['反射光强度', 'scrBounce', 0, 150, 1], ['反射光长度%', 'scrBounceLen', 0, 120, 1],
    ]],
    ['空气 · 后处理', [
      ['雾的距离(清透)', 'fogFar', 40, 250, 1], ['物件吃雾%', 'objFog', 0, 100, 1],
      ['对比度', 'contrast', 60, 160, 1],
      ['雾', 'haze', 0, 100, 1], ['光晕', 'glow', 0, 100, 1], ['颗粒', 'grain', 0, 100, 1],
      ['地平线柔光', 'horiz', 0, 100, 1], ['背景断点', 'bgStop', 0, 60, 1], ['天空中段位置', 'bgMidStop', 10, 90, 1],
      ['曝光', 'exposure', 0.6, 1.6, 0.01], ['景深', 'dof', 0, 0.03, 0.001],
      ['色差', 'aberration', 0, 0.004, 0.0002],
      ['接触阴影', 'shadow', 0, 1, 0.02], ['阴影铺开', 'softness', 0.5, 6, 0.1],
      ['透明净度', 'glassClean', 0, 1, 0.02],
    ]],
  ];
  const PANEL_COLORS = [
    ['沙 sandC', 'sandC'], ['天顶 bgTop', 'bgTop'], ['天空 bgMid', 'bgMid'], ['地平线 bgBot', 'bgBot'],
    ['地平线 horizC', 'horizC'], ['雾 hazeC', 'hazeC'], ['屏幕 screenC', 'screenC'],
    ['本体 body', 'body'], ['边缘 rim', 'rim'], ['内核 coreC', 'coreC'],
    ['瓶 bottle', 'bottle'], ['花 flower', 'flower'], ['泡泡 bubbleC', 'bubbleC'],
    ['浅水 waterC', 'waterC'], ['深水 waterDeepC', 'waterDeepC'], ['湿沙 wetC', 'wetC'],
    ['垫子底色 blanketBase', 'blanketBase'], ['格纹色 blanketLine', 'blanketLine'],
    ['彩胶 vinylC', 'vinylC'], ['彩胶·nujabes vinylNujabesC', 'vinylNujabesC'],
  ];
  /* 分区的折叠状态存 localStorage —— 关掉浏览器再开还是你上次那几栏开着。
   * 出厂只展开「光」和「空气 · 后处理」两栏（调风格最常翻的两栏），
   * 排版、贝壳、弹窗那些一进来是收起的，不用再翻半天。 */
  const FOLD_KEY = 'stage.panel.open.v1';
  const OPEN_BY_DEFAULT = ['光', '空气 · 后处理'];
  let openSet;
  try { openSet = new Set(JSON.parse(localStorage.getItem(FOLD_KEY))); } catch { openSet = null; }
  if (!openSet || !openSet.size) openSet = new Set(OPEN_BY_DEFAULT);
  const saveFold = () => { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...openSet])); } catch {} };

  function buildPanel() {
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;top:12px;left:12px;width:262px;max-height:92vh;overflow-y:auto;' +
      'background:rgba(18,21,28,.93);color:#aab2c0;font:11px/1.5 ui-monospace,monospace;' +
      'padding:10px 12px;border-radius:8px;border:1px solid #2a2e38;z-index:9999';
    panel.innerHTML = '<b style="letter-spacing:.12em">视觉参数</b> <small>（E 也能开关）</small><br>' +
      '<small>调完点「复制」，JSON 贴回 共用/constitution.js 的 ENV（唯一真相）</small>';

    /* --- 快捷风格：点一下盖一组值，别的键不动（模板在 constitution.js 的 LOOKS） --- */
    const lookHead = document.createElement('div');
    lookHead.textContent = '快捷风格';
    lookHead.style.cssText = 'margin:10px 0 4px;padding-top:8px;border-top:1px solid #2a2e38;' +
      'letter-spacing:.16em;font-size:10px;color:#7f8ba0';
    panel.appendChild(lookHead);
    const looks = document.createElement('div');
    looks.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:2px';
    for (const name of Object.keys(LOOKS)) {
      const b = document.createElement('button');
      b.textContent = name;
      b.style.cssText = 'padding:3px 7px;cursor:pointer;font:10px ui-monospace,monospace;' +
        'background:#20242e;color:#9fb4cf;border:1px solid #333947;border-radius:11px';
      b.onclick = () => {
        Object.assign(params, LOOKS[name]);
        applyParams();
        rebuild();                       // 滑块要跟着跳到新值
      };
      looks.appendChild(b);
    }
    panel.appendChild(looks);
    const lookNote = document.createElement('small');
    lookNote.style.cssText = 'display:block;color:#6b7488;margin:2px 0 0';
    lookNote.textContent = '点一个最近的，再拖滑块微调';
    panel.appendChild(lookNote);

    /* --- 可折叠的分区 --- */
    const foldAll = document.createElement('div');
    foldAll.style.cssText = 'display:flex;gap:6px;margin:8px 0 0';
    for (const [txt, fn] of [['全部展开', () => { PANEL_SECTIONS.forEach(([t]) => openSet.add(t)); openSet.add('颜色'); }],
                             ['全部收起', () => openSet.clear()],
                             ['回正视角(0)', resetView]]) {
      const b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText = 'flex:1;padding:2px 6px;cursor:pointer;font:10px ui-monospace,monospace;' +
        'background:#1b1f27;color:#7f8ba0;border:1px solid #2f3542;border-radius:4px';
      b.onclick = () => { fn(); saveFold(); rebuild(); };
      foldAll.appendChild(b);
    }
    panel.appendChild(foldAll);

    /* 一个分区 = 标题（可点）+ 内容容器。收起的分区不建滑块，省得几十个 DOM 白挂着。 */
    function section(title, fill) {
      const head = document.createElement('div');
      const open = openSet.has(title);
      head.style.cssText = 'margin:10px 0 4px;padding-top:8px;border-top:1px solid #2a2e38;' +
        'letter-spacing:.16em;font-size:10px;color:#7f8ba0;cursor:pointer;user-select:none;' +
        'display:flex;justify-content:space-between;align-items:center';
      head.innerHTML = `<span>${title}</span><span style="color:#5c6579">${open ? '▾' : '▸'}</span>`;
      head.onclick = () => {
        if (openSet.has(title)) openSet.delete(title); else openSet.add(title);
        saveFold(); rebuild();
      };
      panel.appendChild(head);
      if (open) fill();
    }

    for (const [title, items] of PANEL_SECTIONS) {
      section(title, () => {
        for (const [label, k, min, max, step, names] of items) {
          const row = document.createElement('label');
          // 给了名字表（比如屏幕风格）就把数字换成名字 —— 十几档的时候记序号是折磨
          row.style.cssText = 'display:grid;grid-template-columns:' + (names ? '84px 1fr 62px' : '104px 1fr 42px') +
            ';gap:5px;align-items:center;margin:3px 0';
          const fmt = v => names ? (names[Math.round(v)] ?? v)
            : (step < 1 ? (+v).toFixed(Math.max(0, -Math.floor(Math.log10(step)))) : v);
          row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${params[k]}"><b style="text-align:right">${fmt(params[k])}</b>`;
          const inp = row.querySelector('input'), out = row.querySelector('b');
          inp.oninput = () => { params[k] = +inp.value; out.textContent = fmt(inp.value); applyParams(); };
          panel.appendChild(row);
        }
      });
    }
    section('颜色', () => {
      for (const [label, k] of PANEL_COLORS) {
        const row = document.createElement('label');
        row.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin:2px 6px 2px 0';
        row.innerHTML = `<input type="color" value="${params[k]}"><span>${label}</span>`;
        row.querySelector('input').oninput = e => { params[k] = e.target.value; applyParams(); };
        panel.appendChild(row);
      }
    });

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px;margin-top:10px';
    const copy = document.createElement('button');
    copy.textContent = '复制参数 JSON';
    copy.style.cssText = 'flex:1;padding:4px 8px;cursor:pointer';
    copy.onclick = () => {
      const out = {};
      Object.keys(ENV).forEach(k => { out[k] = params[k]; });
      navigator.clipboard.writeText(JSON.stringify(out, null, 2));
      copy.textContent = '已复制'; setTimeout(() => copy.textContent = '复制参数 JSON', 1200);
    };
    const reset = document.createElement('button');
    reset.textContent = '恢复默认';
    reset.style.cssText = 'padding:4px 8px;cursor:pointer';
    reset.onclick = () => { Object.assign(params, JSON.parse(DEFAULTS)); applyParams(); rebuild(); };
    btns.append(copy, reset);
    panel.appendChild(btns);
    document.body.appendChild(panel);
  }
  /* 重建面板（滑块归位 / 折叠状态变了）。滚动位置要留住 ——
   * 不然点一下折叠就跳回顶部，翻起来比不折叠还烦。 */
  function rebuild() {
    const top = panel ? panel.scrollTop : 0;
    if (panel) panel.remove();
    panel = null;
    buildPanel();
    panel.scrollTop = top;
  }
  function togglePanel() {
    if (!panel) buildPanel();
    else panel.style.display = panel.style.display === 'none' ? '' : 'none';
  }
  // 面板入口：右下角一个常驻小按钮（不用记快捷键），E 键照旧
  const fab = document.createElement('button');
  fab.textContent = '✦ 视觉参数';
  fab.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9998;padding:6px 12px;' +
    'background:rgba(18,21,28,.85);color:#9fb4cf;border:1px solid #2f3542;border-radius:16px;' +
    'font:11px -apple-system,"PingFang SC",sans-serif;letter-spacing:.1em;cursor:pointer';
  fab.onclick = togglePanel;
  document.body.appendChild(fab);
  addEventListener('keydown', e => {
    if (e.key === 'e' || e.key === 'E') togglePanel();
    if (e.key === '0' || e.key === 'Home') resetView();   // 拖丢了按这个回家
  });

  return {
    renderer, scene, camera, controls, composer, world, key, fill, params, applyParams,
    sunDir: () => keyDir,                    // 全场唯一的太阳方向（垫子烘焙明暗也读它）
    sunColor: () => sunColor,
    render, markGlass, grade, P, ENV,
    // 白沙海底新增的接口
    sink,                                    // 手动控制陷沙（radius/depth/lift/bake）
    unsink,                                  // 拿走（被浪卷走）
    sandY: (x, z) => S * sand.heightAt(x / S, z / S),   // 世界坐标下的沙面高度
    flagShadows,                             // 手动给某棵子树打投影/收影标记（world 里的自动打）
    // 凑近看：点物件 → 镜头飞到它正前方（还是同一个场景，海和浪继续跑）
    focusOnFace, unfocus, flyTo, resetView, setCursorHook,
    isFocused: () => focus.on || focus.t < 1,
    materials: { ice: iceMaterial, solid: solidMaterial, screen: screenMaterial },
    createScreenGlow,
    glowTex,
    blobTex,                                 // 深色柔影贴图，垫子上的接触阴影也用它
    envScale: S,
    sand,
    // 两张场与浪（见 共用/场接口.md）
    fields: sand.fields,                     // { height, wet }，局部坐标
    waves,
    toLocal: (x, z) => [x / S, z / S],       // 世界米 → 沙的局部坐标
    onParams: fn => paramListeners.add(fn),    // 参数面板改了任何值之后回调（页面里的东西也能跟着调）
    // 泡泡
    bubbles, setBubbleStyle, bubbleStyle: () => bubbleStyle,
    spawnBubble, popBubble, bubbleList,
    // 推沙
    enableSandDrag,                          // 开启「拖物件推沙」（环境预览页在用）
    moveObject,                              // 程序化推物件（阶段 4 的碰撞/回弹会用）
  };
}
