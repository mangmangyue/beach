/* 光照 · 全场唯一的一份（2026-08-27「整体光照统一」第 1 步）
 *
 * 在这之前有**两份拷贝**：`stage.js` 里的 `underwaterEnvironment()` + 那三盏灯，
 * 和 `物件_吉他/viewer/材质表.js` 的 `beachLighting()`。后者的注释写着
 * 「stage.js 不归我改，所以这里是照抄的一份 —— 那边改了这边要跟」，
 * 而它从来没跟上过：太阳方向还停在改造前写死的 (-0.42, 0.86, 0.40)，
 * ENV.sunAz/sunEl 拖到哪儿它都不动。现在两边都 import 这一份，谁也不用跟谁。
 *
 * 导出：
 *   beachEnvironment(renderer)      环境贴图（PMREM 过的水体渐变）。**全场只有这一张**
 *   envIntensity()                  这张图的唯一倍率 = ENV.ambLight × ENV.envI
 *   sunDirection(az, el, out)       方位角 + 高度角 → 指向太阳的单位向量
 *   kelvinColor(K, out)             色温 → RGB。6500K = 纯白（改色温只改色相不改亮度）
 *   applyBeachLighting(renderer, scene)   独立 viewer / 实验室用的整套（stage.js 自己装灯）
 *
 * ⚠️ **物件材质里不要再各自设 `envMapIntensity`。**
 *    各设各的 = 每个物件反射的世界不一样，这正是「每个物件像各自打了灯」的来源。
 *    强弱差别交给 roughness —— 那才是材质属性；envMapIntensity 是个补偿系数。
 *    整场的反射强度只有一个旋钮：面板「光 → 环境反射」= ENV.envI。
 */
import * as THREE from 'three';
import { ENV, shade } from './constitution.js';

/* 环境贴图：一张程序化的水体渐变 equirect（上=天、地平线=背景底色、下=沙）。
 * 它不负责"照亮"（画面里大部分亮度来自主光和物件自己），
 * 只给实体类一点体积、给玻璃/透射材质一点可反射的东西。
 * ⚠️ 顶/地平线/底三个颜色必须和背景着色器、沙的 uFogColor 同源，否则物件反射出的
 *    世界和它站着的世界对不上 —— 这也是"焊不进场景"的一种。 */
export function beachEnvironment(renderer) {
  const W = 128, H = 64;
  const data = new Float32Array(W * H * 4);
  const top = new THREE.Color(ENV.bgTop);
  const hor = new THREE.Color(ENV.bgBot);
  const bot = new THREE.Color(shade(ENV.sandC, -0.25));
  const c = new THREE.Color();
  let i = 0;
  for (let y = 0; y < H; y++) {
    const t = 1 - (y + 0.5) / H * 2;                  // 1 顶 … -1 底
    for (let x = 0; x < W; x++) {
      if (t >= 0) c.copy(hor).lerp(top, Math.pow(t, 0.8));
      else c.copy(hor).lerp(bot, Math.pow(-t, 0.7));
      data[i++] = c.r; data[i++] = c.g; data[i++] = c.b; data[i++] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose(); tex.dispose();
  return env;
}

/* --------------------------------------------------------------- 反射性格
 * 「统一」不等于「全都一样」。
 * 08-27 第一版把所有材质的 envMapIntensity 一刀切成 1.0，结果**清透感掉了**：
 * 亮光漆的吉他面板、银色 MacBook、防尘罩靠的就是比周围更强的反射，一刀切之后全糊在一起。
 *
 * 现在的做法：每个材质还是有自己的「反射性格」base（漆面 1.9、哑光木 0.3……），
 * 但**它不再直接生效** —— 生效的是
 *     envMapIntensity = 1 + (base - 1) × envVar%
 * 一个全局滑块（面板「光 → 材质反射差异」）决定这些性格被放大多少：
 *     0   = 全场一模一样（第一版那个"统一但发闷"的样子）
 *     100 = 各材质原本的性格（08-27 之前的清透感）
 *     150 = 比原来更拉开
 * 这样"唯一真相"还是唯一真相（就一个滑块），但差异是可调的，不是散在十几个文件里的硬编码。 */
const envIMats = new Map();          // 材质 → 它的反射性格 base
// 夹到 0：envVar 拉过 100 之后，性格最哑的那档（吉他音孔内壁 0.30）会算成负数，
// 负的 envMapIntensity 等于从画面里"减光"，会出黑斑
const applyEnvI = (m, base) => {
  m.envMapIntensity = Math.max(0, 1 + (base - 1) * (ENV.envVar ?? 100) / 100);
};
/** 登记一个材质的反射性格。base = 1 就是"没性格"，不用登记。 */
export function registerEnvI(m, base = 1) { envIMats.set(m, base); applyEnvI(m, base); return m; }
/** 滑块动了之后统一刷（stage.applyParams 里调）。 */
export function refreshEnvI() { for (const [m, b] of envIMats) applyEnvI(m, b); }

/* 环境贴图的唯一倍率。跟着「环境光」一起缩放（宪法：环境光 = 半球光 + 环境贴图）。
 * 出厂 ambLight=100 / envI=40 → 0.4，正好是收进面板之前硬编码的那个值。 */
export const envIntensity = () => (ENV.ambLight ?? 100) / 100 * (ENV.envI ?? 40) / 100;

/* 太阳方向：全场只有这一个。沙的着色器、垫子的烘焙、三盏 three 灯全读它。 */
export function sunDirection(az = ENV.sunAz, el = ENV.sunEl, out = new THREE.Vector3()) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
}

/* 色温 → RGB。以 6500K 为基准归一化，所以 6500 正好是纯白（出厂值不改变画面）；
 * 再按最大通道归一，改色温只改色相不改亮度。 */
function kelvinRaw(K) {
  const t = Math.max(1000, Math.min(20000, K)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661
                    : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map(v => Math.max(1e-3, Math.min(255, v)));
}
const REF_K = kelvinRaw(6500);
export function kelvinColor(K, out = new THREE.Color()) {
  const c = kelvinRaw(K).map((v, i) => v / REF_K[i]);
  const mx = Math.max(...c);
  return out.setRGB(c[0] / mx, c[1] / mx, c[2] / mx);
}

/* 独立页面（物件 viewer / 调色台 / 实验室）用的整套光。
 * stage.js **不**走这个 —— 它要把同一组值同时下发给沙的着色器和垫子的烘焙，
 * 自己装灯；但环境贴图、太阳方向、色温三个函数是同一份，所以两边一致。
 * 返回的 refresh() 在改了 ENV 之后调一下就能跟上。 */
export function applyBeachLighting(renderer, scene) {
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = ENV.exposure ?? 1.0;
  scene.environment = beachEnvironment(renderer);

  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  const fill = new THREE.DirectionalLight(0xffffff, 0.0);
  const hemi = new THREE.HemisphereLight(new THREE.Color(ENV.bgBot), new THREE.Color(ENV.sandC), 0.5);
  scene.add(key, key.target, fill, fill.target, hemi);

  const dir = new THREE.Vector3();
  function refresh() {
    const kf = (ENV.keyLight ?? 70) / 100, af = (ENV.ambLight ?? 100) / 100;
    sunDirection(ENV.sunAz, ENV.sunEl, dir);
    key.position.copy(dir).multiplyScalar(3);
    key.intensity = kf;
    kelvinColor(ENV.keyK ?? 6500, key.color);
    fill.position.set(-dir.x, Math.max(0.25, dir.y * 0.35), -dir.z).multiplyScalar(3);
    fill.intensity = (ENV.fill ?? 0) / 100 * 0.9;
    kelvinColor(ENV.ambK ?? 6500, fill.color);
    hemi.color.set(ENV.bgBot); hemi.groundColor.set(ENV.sandC);
    hemi.intensity = af * 0.5;
    scene.environmentIntensity = envIntensity();
  }
  refresh();
  return { key, fill, hemi, refresh };
}

/* ================================================================
 * 空气透视（2026-08-27 统一光照 第 3 步）
 *
 * 沙的着色器里有一条地平线消隐：`mix(col, uFogColor, pow(dd, 0.85))`，
 * `dd = 到原点的水平距离 / (uFar * 0.62)`。物件以前**完全不吃这条** ——
 * 于是三米外的沙已经化进背景了，那儿的贝壳还是一颗颗浮在上面，读起来像贴纸。
 * 这是把物件"焊进"场景的最后一道。
 *
 * three 自带的 fog 是按**相机深度**算的，和沙那条不是一回事，两条曲线并存等于没统一。
 * 所以这里把 fog 的两个 chunk 整个换掉，换成和沙一模一样的公式：
 *   距离 = 到原点的水平距离（不是相机深度）
 *   曲线 = pow(dd, 0.85)
 * 换完之后 `scene.fog = new RadialFog(...)` 就够了 —— fogColor / fogFar 由 three 自动上传，
 * 每个材质不用各自改一行。
 *
 * ⚠️ 只影响内置材质（Standard / Basic…）。ShaderMaterial 的 `fog` 默认是 false，
 *    所以沙、浪、冰壳、背景都还是各自那份，不会被这里改到 —— 沙那条本来就是这个公式，
 *    浪是故意用更陡的 1.6（水面），冰壳和背景不该吃雾。
 * ⚠️ 是全局改 THREE.ShaderChunk，要在任何材质编译之前调一次。
 */
export function patchRadialFog() {
  if (THREE.ShaderChunk.__radialFog) return;      // 只打一次
  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  // 借 vFogDepth 这个位置装"到原点的水平距离"（世界米），和沙的 dd 是同一个量。
  // ⚠️ 用 position 而不是 transformed：three 自己的 fog_vertex 在 <project_vertex> 之后，
  //    那里 transformed 是有的，但 **SpriteMaterial / PointsMaterial 的顶点着色器里没有** ——
  //    第一版写 transformed，屏幕光晕那个 Sprite 直接编译失败（'transformed': undeclared identifier）。
  //    代价：骨骼/形变/实例化的网格算出来会是形变前的位置。这个场景里没有这类网格，
  //    以后有了也只是雾距离差一点，不会再炸编译。
  vFogDepth = length((modelMatrix * vec4(position, 1.0)).xz);
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  // fogFar = 沙的 uFar*0.62 换算成世界米；fogNear 在这条曲线里被借去当"吃多少"（见 RadialFog）
  float fogFactor = pow(clamp(vFogDepth / fogFar, 0.0, 1.0), 0.85) * fogNear;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(fogFactor, 0.0, 1.0));
#endif`;
  THREE.ShaderChunk.__radialFog = true;
}

/* 和沙同一条曲线的雾。
 * ⚠️ `near` 在这条曲线里**不是**「雾从多远开始」——它被借去当「物件吃多少雾」（0~1）。
 *    这么干是为了省一整套 uniform 管线：fogColor/fogNear/fogFar 是 three 自己上传的，
 *    多加一个 uniform 就得逐材质去塞。用 .amount 读写，别直接碰 .near。 */
export class RadialFog extends THREE.Fog {
  get amount() { return this.near; }
  set amount(v) { this.near = v; }
}
