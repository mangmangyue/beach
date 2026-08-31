/* 白沙 —— 《规格_沙地环境.md》第二节的实现 + 推沙（阶段 4 提前落地的部分）。
 *
 * 坐标约定：沙以「原型单位」建模（起伏幅度 ~0.26、雾距 uFar=34），
 * stage 把整个环境组按相机距离等比缩放去适配真模型（米级）。
 * 这个文件里的一切坐标都是**沙的局部坐标**，换算发生在 stage 里，只此一处。
 *
 * 沙面高度 = 大沙丘（程序化，静止） + 凹陷 dent（物件坐出来的坑，实时跟随物件）
 *          + 沙痕场 field（被推过的痕迹：车辙、堆沙，会塌落、会慢慢抹平）
 *
 * 两张场（高度 / 湿度）的数据结构在 fields.js，接口见 共用/场接口.md。
 */
import * as THREE from 'three';
import { HeightField, WetField, MarksField, FIELD_HALF, FIELD_N } from './fields.js';
export { FIELD_HALF };

export const MAX_DENTS = 24;   // 只有会动的大物件占坑位；贝壳野花的坑烤进高度场（sink 的 bake）
export const SAND_FAR = 34.0;     // 地平线消隐距离（局部单位）

/* ---- JS 侧的高度镜像 ----
 * 沙丘是静止的（没有时间项），CPU 和 GPU 算出来一定一致。 */
const D1 = norm2(1.00, 0.35), D2 = norm2(-0.40, 1.00), D3 = norm2(0.80, -0.70);
function norm2(x, y) { const l = Math.hypot(x, y); return [x / l, y / l]; }

export function duneHeight(x, z, amp) {
  const s1 = (x * D1[0] + z * D1[1]) * 0.155;
  const s2 = (x * D2[0] + z * D2[1]) * 0.105 + 1.7;
  const s3 = (x * D3[0] + z * D3[1]) * 0.255 + 0.4;
  return (Math.sin(s1) * 0.62 + Math.sin(s2) * 0.52 + Math.sin(s3) * 0.24) * amp * 1.9;
}

/* 坑 + 外圈堆沙。堆沙是关键 —— 没有它就只是个洞，不像沙。 */
export function dentHeight(x, z, v) {
  if (v.w <= 0) return 0;
  const r = Math.max(v.z, 0.001);
  const t = Math.hypot(x - v.x, z - v.y) / r;
  return -v.w * Math.exp(-t * t * 1.6)
       + v.w * 0.30 * Math.exp(-(t - 1.15) * (t - 1.15) * 7.0);
}

/* ================================================================
 * 着色器
 * FIELD_GLSL / HEIGHT_GLSL 也给浪的面片 include —— 水面永远贴着当下的沙面
 * ============================================================== */
export const FIELD_GLSL = /* glsl */`
uniform sampler2D uHeightTex;   // 高度场
uniform sampler2D uWetTex;      // 湿度场
uniform sampler2D uMarksTex;    // 痕迹场（小生物的细脚印，会淡掉）
uniform vec2 uFieldInfo;        // x = half（±范围）, y = 格子数 n
// 场的读取：手写双线性（和 fields.js 的 sample() 同一套公式，物件落位才不会和画面打架）
float fieldAt(sampler2D tex, vec2 q){
  float half_ = uFieldInfo.x, n = uFieldInfo.y;
  vec2 g = (q + half_) / (half_ * 2.0) * n - 0.5;
  if(g.x < 0.0 || g.y < 0.0 || g.x > n - 1.0 || g.y > n - 1.0) return 0.0;
  vec2 g0 = floor(g), f = g - g0;
  float a = texture2D(tex, (g0 + vec2(0.,0.) + 0.5) / n).r;
  float b = texture2D(tex, (g0 + vec2(1.,0.) + 0.5) / n).r;
  float c = texture2D(tex, (g0 + vec2(0.,1.) + 0.5) / n).r;
  float d = texture2D(tex, (g0 + vec2(1.,1.) + 0.5) / n).r;
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}`;

export const HEIGHT_GLSL = /* glsl */`
${FIELD_GLSL}
uniform float uAmp;
uniform float uWetSink;             // 湿沙压实、矮一点（局部单位）
uniform vec4 uDent[${MAX_DENTS}];   // xy=位置 z=半径 w=深度

float dent(vec2 q, vec4 d){
  if(d.w <= 0.0) return 0.0;
  float r = max(d.z, 0.001);
  float t = length(q - d.xy) / r;
  return -d.w * exp(-t*t*1.6)
       +  d.w * 0.30 * exp(-(t-1.15)*(t-1.15)*7.0);
}
// 静止的大沙丘：没有时间项 —— 这是和水面最重要的区别
float duneAt(vec2 q){
  vec2 d1 = normalize(vec2( 1.00, 0.35));
  vec2 d2 = normalize(vec2(-0.40, 1.00));
  vec2 d3 = normalize(vec2( 0.80,-0.70));
  float s1 = dot(q,d1)*0.155;
  float s2 = dot(q,d2)*0.105 + 1.7;
  float s3 = dot(q,d3)*0.255 + 0.4;
  return (sin(s1)*0.62 + sin(s2)*0.52 + sin(s3)*0.24) * uAmp * 1.9;
}
// 沙面最终高度 = 沙丘 + 凹陷 + 高度场 − 湿沙下沉
float heightAt(vec2 q){
  float h = duneAt(q) + fieldAt(uHeightTex, q) + fieldAt(uMarksTex, q) - fieldAt(uWetTex, q) * uWetSink;
  for(int i=0;i<${MAX_DENTS};i++) h += dent(q, uDent[i]);
  return h;
}`;

/* 沙也要收 three 的 shadow map。
 * 沙是自定义 ShaderMaterial，不吃 three 的灯，所以以前 renderer.shadowMap 一开就会变成
 * 「垫子上有影子、沙上没有」—— 这也是 shadowMap 一直关着的原因。
 * 正解不是在沙里另写一套软影，是让它**采样同一张 shadow map**：
 * 直接 include three 自己的 shadowmap 片段，物件投在垫子上和投在沙上就是同一个东西。
 * 前提：材质要 lights: true 且 uniforms 里带上 UniformsLib.lights（见 createSand）。
 * ⚠️ 不用 <shadowmask_pars_fragment> 的 getShadowMask()：它要 lights_pars_begin 里的
 *    `uniform bool receiveShadow`，而我们不想把整套灯的 chunk 都拖进来。直接调 getShadow()。 */
const SAND_VS = /* glsl */`
${HEIGHT_GLSL}
#include <common>
#include <shadowmap_pars_vertex>
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vTrail; varying float vWet;
void main(){
  vec2 q = position.xz;
  float h = heightAt(q);
  vTrail = fieldAt(uHeightTex, q);
  vWet = fieldAt(uWetTex, q);
  // 法线用有限差分：坑和沙痕也要有明暗，沟才看得见
  float e = 0.15;                      // 小到能分辨脚印（1.5cm）
  float hx = heightAt(q + vec2(e, 0.0));
  float hz = heightAt(q + vec2(0.0, e));
  vN = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
  vec3 p = vec3(position.x, h, position.z);
  vW = p;                             // 沙的局部坐标（环境组只做等比缩放，方向不变）
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
  // <shadowmap_vertex> 认这两个名字：worldPosition（世界坐标）、transformedNormal（视图空间法线）
  vec4 worldPosition = wp;
  // ⚠️ 必须 normalize：沙在 envGroup 里被缩放了（stage.envScale ≈ 0.17），
  //    normalMatrix 是逆转置，会把法线放大 1/0.17 ≈ 6 倍 ——
  //    不归一化的话 shadowNormalBias 也跟着放大 6 倍，影子整个飘出去（peter-panning）
  vec3 transformedNormal = normalize(normalMatrix * vN);
  #include <shadowmap_vertex>
}`;

const SAND_FS = /* glsl */`
precision highp float;
${FIELD_GLSL}
#include <common>
#include <packing>
#include <shadowmap_pars_fragment>
// 太阳的阴影。全场只有 key 一盏灯投影，所以这里循环里只会有一项；
// 写成 unroll 的形式是照抄 three 的 <shadowmask_pars_fragment>，多一盏也不会错。
float sunShadow(){
  float sh = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow dls;
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
      dls = directionalLightShadows[ i ];
      sh *= getShadow( directionalShadowMap[ i ], dls.shadowMapSize, dls.shadowIntensity, dls.shadowBias, dls.shadowRadius, vDirectionalShadowCoord[ i ] );
    }
    #pragma unroll_loop_end
  #endif
  return sh;
}
uniform vec3 uSandDark, uSandLight, uFogColor, uWetTint;
uniform float uTime, uSparkS, uFar, uWetDark, uWetGloss, uWaveReach;
uniform vec2 uLightMix;   // x = 环境项, y = 方向项。和 stage 的主光/环境光滑块同一套
uniform vec3 uSunDir;     // 主光方向（世界，指向光源）。全场只有这一个太阳
uniform vec3 uSunC;       // 主光颜色（色温换算出来的）
uniform vec3 uAmbC;       // 环境光颜色
uniform vec2 uWaveDir;
uniform vec4 uDentF[${MAX_DENTS}];
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vTrail; varying float vWet;

float hash(vec2 c){ return fract(sin(dot(c, vec2(41.7,289.3))) * 43758.5453); }

// 沙被推开时，沙粒跟着一起往外挪 —— 风纹和细闪都用挪过的坐标采样，
// 推沙的时候表面纹理跟着沙走，而不是沙变形了、纹路还钉在原地
vec2 advect(vec2 q, vec4 d){
  if(d.w <= 0.0) return vec2(0.0);
  vec2 v = q - d.xy; float r = max(d.z, 0.001); float t = length(v) / r;
  if(t < 0.0001) return vec2(0.0);
  return normalize(v) * d.w * 1.5 * exp(-t*t*1.4);
}

void main(){
  vec3 N = normalize(vN), V = normalize(vV);
  // 两张场逐像素再读一遍：脚印、车辙这种比网格还细的痕迹，靠顶点插值是读不出来的。
  // 用场自己的有限差分做一层细节法线叠在大法线上，明暗也按逐像素的值算
  vec2 q = vW.xz;
  float tr  = fieldAt(uHeightTex, q);
  float mk  = fieldAt(uMarksTex, q);
  float e = 0.08;
  float trx = fieldAt(uHeightTex, q + vec2(e, 0.0)) + fieldAt(uMarksTex, q + vec2(e, 0.0));
  float trz = fieldAt(uHeightTex, q + vec2(0.0, e)) + fieldAt(uMarksTex, q + vec2(0.0, e));
  vec3 Nd = vec3(-(trx - tr - mk) / e, 0.0, -(trz - tr - mk) / e);
  N = normalize(N + Nd * 1.2);
  float wet = clamp(fieldAt(uWetTex, q), 0.0, 1.0);
  // 湿度场只覆盖中央 ±16；更远的沙按解析规则：水线最远处以外的沙永远是湿的（和海一样宽）
  float proj = dot(q, uWaveDir);
  float outside = step(uFieldInfo.x - 0.5, max(abs(q.x), abs(q.y)));
  wet = max(wet, outside * smoothstep(uWaveReach - 1.5, uWaveReach + 0.5, proj));
  vec2 sq = vW.xz;
  for(int i=0;i<${MAX_DENTS};i++) sq += advect(vW.xz, uDentF[i]);

  // 漫射 + 风纹（风纹只是明暗，不是几何起伏）
  // 太阳的方向和颜色由 stage 统一下发（面板「光」区），沙、垫子、物件共用同一个
  vec3 L = normalize(uSunDir);
  // 沙的明暗也走面板的主光/环境光 —— 否则拖亮了主光，物件和垫子有了体积，
  // 沙还是一张平的白纸，整个画面就散了
  // 阴影只乘方向项：环境项没有遮蔽，影子里也不该是全黑
  float sh = sunShadow();
  vec3 dif = uAmbC * uLightMix.x + uSunC * uLightMix.y * max(dot(N, L), 0.0) * sh;
  float rip  = pow(sin(dot(sq,vec2(0.96,0.28))*6.2 + sin(sq.y*0.42)*2.4)*0.5+0.5, 2.4);
  float rip2 = sin(dot(sq,vec2(-0.30,1.0))*11.0 + 1.3)*0.5+0.5;
  float grain = hash(floor(sq*54.0)) * 0.05;
  float fres = pow(1.0 - clamp(abs(dot(N,V)),0.0,1.0), 2.2);
  vec3 col = mix(uSandDark, uSandLight, fres*0.30 + rip*0.26 + rip2*0.10 + grain) * dif;
  // 被推过的沙有記憶：沟槽压暗、堆起的沙提亮（柔光下光靠法线不够看）
  col *= 1.0 + clamp(tr * 2.5 + mk * 4.0, -0.5, 0.5) * 0.8;   // 小痕迹也要读得出来（脚印很浅，增益给大）

  // 湿沙：颜色变深变实、风纹被抹平、有一道水光
  col = mix(col, col * uWetTint, wet * uWetDark);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 60.0) * 0.9 + pow(max(dot(N, H), 0.0), 8.0) * 0.12;
  col += uSunC * vec3(1.0, 0.98, 0.96) * spec * wet * uWetGloss * sh;   // 湿沙的水光是太阳的反射，跟着太阳的颜色走（影子里没有）
  col += vec3(0.85, 0.92, 1.0) * fres * wet * uWetGloss * 0.25;   // 掠射角的薄水膜

  // 细闪：一颗颗圆的亮点（不能是方格，斜视角会拉成条纹），
  // 常亮为主、忽闪幅度很小，掠射角更亮。湿沙上细闪少
  float spk = 0.0;
  vec2 u1 = sq*126.0; vec2 c1 = floor(u1); vec2 f1 = fract(u1)-0.5;
  float g1 = hash(c1);
  if(g1 > 0.968){
    float sz = 0.10 + 0.18*hash(c1+vec2(19.1,7.7));
    float tw = 0.72 + 0.28*sin(uTime*1.5 + g1*62.8);
    spk += smoothstep(sz, sz*0.25, length(f1)) * tw;
  }
  vec2 u2 = sq*38.0 + vec2(3.7,9.1); vec2 c2 = floor(u2); vec2 f2 = fract(u2)-0.5;
  float g2 = hash(c2);
  if(g2 > 0.982){
    float sz = 0.07 + 0.10*hash(c2+vec2(4.4,31.2));
    float tw = 0.65 + 0.35*sin(uTime*0.9 + g2*62.8);
    spk += smoothstep(sz, sz*0.2, length(f2)) * tw * 1.6;
  }
  float grazing = pow(1.0 - clamp(abs(dot(N,V)),0.0,1.0), 1.4);
  col += vec3(1.0, 0.995, 0.98) * spk * uSparkS * (1.6 + grazing*2.0) * (1.0 - 0.6 * wet);

  // 地平线消隐：沙必须在到达地平线之前就完全化成背景色。
  // 指数 < 1，前期就开始化；uFogColor 必须严格等于背景渐变在地平线处的颜色 ——
  // 之前的失败版本就是两边颜色对不上，地平线一条硬线，加多少辉光都盖不住。
  float dd = clamp(length(vW.xz) / (uFar * 0.62), 0.0, 1.0);
  col = mix(col, uFogColor, pow(dd, 0.85));
  gl_FragColor = vec4(col, 1.0);
}`;

/* 中心加密的网格：沟痕都发生在中央 ±16，那里要 0.12 单位的分辨率，
 * 远处化在雾里，2 个单位一格都嫌多。一张网格从密到疏，没有接缝。 */
function warpedGrid(segments, size) {
  const half = size / 2;
  const warp = t => half * (0.16 * t + 0.84 * t * t * t);
  const verts = [];
  for (let j = 0; j <= segments; j++) {
    const z = warp(j / segments * 2 - 1);
    for (let i = 0; i <= segments; i++) {
      verts.push(warp(i / segments * 2 - 1), 0, z);
    }
  }
  const idx = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i, b = a + segments + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  return geo;
}

export function createSand({ size = 150, segments = 210 } = {}) {
  const height = new HeightField();
  const wet = new WetField();
  const marks = new MarksField();
  const dents = Array.from({ length: MAX_DENTS }, () => new THREE.Vector4(0, 0, 0, 0));
  /* 沙面高度相关的 uniforms 单独一组：浪的面片和沙共用同一份对象，谁改都同步 */
  const heightUniforms = {
    uAmp:       { value: 0.26 },
    uWetSink:   { value: 0.04 },
    uDent:      { value: dents },
    uHeightTex: { value: height.tex },
    uWetTex:    { value: wet.tex },
    uMarksTex:  { value: marks.tex },
    uFieldInfo: { value: new THREE.Vector2(FIELD_HALF, FIELD_N) },
  };
  const uniforms = {
    ...heightUniforms,
    uTime:      { value: 0 },
    uSandDark:  { value: new THREE.Color('#CDD4D6') },
    uSandLight: { value: new THREE.Color('#DAE0E1') },
    uFogColor:  { value: new THREE.Color('#B0C4CF') },
    uSparkS:    { value: 0.95 * 1.5 },
    uFar:       { value: SAND_FAR },
    uDentF:     { value: dents },
    uWetTint:   { value: new THREE.Color('#8E9CA4') },
    uWetDark:   { value: 0.55 },
    uWaveDir:   { value: new THREE.Vector2(0, -1) },
    uWaveReach: { value: 7.7 },
    uWetGloss:  { value: 0.6 },
    uLightMix:  { value: new THREE.Vector2(0.80, 0.22) },   // 出厂值 = 改造前的写死值
    uSunDir:    { value: new THREE.Vector3(-0.42, 0.86, 0.40).normalize() },
    uSunC:      { value: new THREE.Color(1, 1, 1) },
    uAmbC:      { value: new THREE.Color(1, 1, 1) },
  };
  /* lights: true + UniformsLib.lights —— 只为了让 three 把 shadow map 那三个 uniform
   * （directionalShadowMap / directionalShadowMatrix / directionalLightShadows）喂进来。
   * ⚠️ 不能用 UniformsUtils.merge：它会深拷贝，而 uniforms 里好几个对象是**故意和 waves.js
   *    共享同一个实例**的（uFogColor、整组 heightUniforms），拷完就断了，浪和沙会各走各的。
   *    所以只克隆 three 那份，我们自己的键用 Object.assign 覆盖上去，引用原样保留。 */
  const mat = new THREE.ShaderMaterial({
    vertexShader: SAND_VS,
    fragmentShader: SAND_FS,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.lights), uniforms),
    lights: true,
  });
  const mesh = new THREE.Mesh(warpedGrid(segments, size), mat);
  mesh.frustumCulled = false;

  let free = 0;
  return {
    mesh, uniforms, heightUniforms,
    fields: { height, wet, marks },
    field: height,                       // 旧名字，stage 里推沙还在用
    /* 占一个坑位。返回句柄（Vector4），推沙就是拿着句柄改 xy。 */
    addDent(x, z, radius, depth) {
      if (free >= MAX_DENTS) { console.warn('沙地凹陷坑位用完了（MAX_DENTS =', MAX_DENTS, '）'); return null; }
      const v = dents[free++];
      v.set(x, z, radius, depth);
      return v;
    },
    /* 局部坐标下的沙面高度（沙丘 + 高度场 − 湿沙下沉 + 凹陷）。和 shader 的 heightAt 同一公式。
     * exclude 传物件自己的 dent 句柄 —— 算"这个物件该坐多高"时要把自己的坑排除掉。 */
    heightAt(x, z, exclude = null) {
      let h = duneHeight(x, z, uniforms.uAmp.value) + height.sample(x, z) + marks.sample(x, z)
            - wet.sample(x, z) * uniforms.uWetSink.value;
      for (const v of dents) if (v !== exclude) h += dentHeight(x, z, v);
      return h;
    },
  };
}

/* ---- 贝壳（原型里的散布，珠光白/粉，不参与全局饱和度）
 * 每颗贝壳现在是独立的可推小物件（Iris 定，2026-08-21）：
 * createShell 造一颗（原点在贝壳底部中心），摆放和陷沙由 stage 管。 ---- */
export const SHELL_SPOTS = [
  [-4.30, 1.90, .30, 0.5, '#F6E4E2', 0], [ 3.60, 2.10, .24, 1.9, '#FDF3EC', 0],
  [ 5.20,-1.30, .27, 3.1, '#F2E6F0', 1], [-3.10,-2.40, .22, 2.2, '#FDEFE6', 1],
  [ 1.10, 2.90, .20, 0.9, '#F7E9E4', 0], [-1.60, 3.20, .26, 4.0, '#FFF6F2', 1],
  [ 6.40, 1.10, .23, 1.2, '#F4E8F2', 0], [-6.00,-0.60, .25, 2.7, '#FDF0E8', 0],
  [ 2.60,-3.10, .21, 5.0, '#F9EDE6', 1], [-0.40,-3.60, .24, 0.2, '#F6E6E8', 0],
];

/* 扇贝的扇面：带放射棱和花边的低多边形扇形（铰在原点，往 +z 展开，轻微拱起） */
function scallopGeometry(r, ribs = 9) {
  const TH = 10, RG = 4;                 // 角向 / 径向段数
  const verts = [], idx = [];
  for (let j = 0; j <= RG; j++) {
    const t = j / RG;
    for (let i = 0; i <= TH; i++) {
      const th = (i / TH * 2 - 1) * 1.12;               // 扇张角 ±64°
      const edge = 1 + 0.09 * Math.cos(th * ribs) * t;  // 花边：外缘一圈圆齿
      const R = r * t * edge;
      // 拱顶：中段最高、到花边缘落回沙面 —— 趴着的扇贝，任何角度都能读
      const dome = Math.sin(t * Math.PI * 0.92) * r * 0.34 * (0.8 + 0.2 * Math.cos(th));
      const rib = Math.cos(th * ribs) * r * 0.055 * t;   // 放射棱
      verts.push(Math.sin(th) * R, dome + rib, Math.cos(th) * R * 0.92);
    }
  }
  for (let j = 0; j < RG; j++) for (let i = 0; i < TH; i++) {
    const a = j * (TH + 1) + i, b = a + TH + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function createShell(r, rot, c, ty) {
  r *= 0.55;                             // 贝壳要小、要精致
  const group = new THREE.Group();
  // 珠光的亮不能全交给方向光 —— 背光面一灰就成小石头了，
  // 给一点点自发光，贝壳在任何角度都是浅色的
  const mat = (col, rough = 0.38) => new THREE.MeshStandardMaterial({
    color: col, roughness: rough, metalness: 0, flatShading: true, side: THREE.DoubleSide,
    emissive: col, emissiveIntensity: 0.22,
  });
  if (ty === 0) {
    // 扇贝：趴着的珠光拱顶扇面 + 粉色内衬花边 + 两粒小铰
    const fan = new THREE.Mesh(scallopGeometry(r), mat(c));
    fan.rotation.x = -0.16;                               // 只微微翘头，不立起来
    const inner = new THREE.Mesh(scallopGeometry(r * 0.82, 9), mat('#F2C6CF', 0.5));
    inner.scale.y = 0.9;
    inner.position.set(0, r * 0.035, r * 0.01);
    inner.rotation.x = -0.16;
    const sph = new THREE.SphereGeometry(1, 8, 6);
    const h1 = new THREE.Mesh(sph, mat(c));
    h1.position.set(-r * 0.09, r * 0.05, -r * 0.015); h1.scale.setScalar(r * 0.10);
    const h2 = new THREE.Mesh(sph, mat(c));
    h2.position.set(r * 0.09, r * 0.05, -r * 0.015); h2.scale.setScalar(r * 0.10);
    group.add(fan, inner, h1, h2);
  } else {
    // 海螺：一串沿螺旋收小的球叠成小螺塔，螺层双色，尾巴翘一粒粉色小尖
    const sph = new THREE.SphereGeometry(1, 9, 7);
    let R = r * 0.50, cr = r * 0.30, y = R * 0.78, ang = 0.6;
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(sph, mat(i % 2 ? '#EFD3D8' : c));
      b.position.set(Math.cos(ang) * cr, y, Math.sin(ang) * cr);
      b.scale.set(R, R * 0.92, R);
      group.add(b);
      ang += 2.3; cr *= 0.58; y += R * 0.62; R *= 0.66;
    }
    const tip = new THREE.Mesh(sph, mat('#F2C6CF', 0.5));
    tip.position.set(Math.cos(ang) * cr, y + R * 0.25, Math.sin(ang) * cr);
    tip.scale.setScalar(R * 0.85);
    group.add(tip);
    group.rotation.z = 0.14;          // 整体微斜，像随手搁下的
  }
  // 拾取代理：贝壳是薄薄的开放曲面，斜射线经常从扇面边上擦过去打不中；
  // 这个球不画任何像素（colorWrite:false），只负责被射线命中 ——
  // 顺便把小贝壳的点击热区放大到手指能点着的程度
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  );
  proxy.position.set(0, r * 0.3, 0);
  proxy.scale.set(r * 1.7, r * 0.9, r * 1.7);
  proxy.userData.noBounds = true;   // 不参与包围盒（陷沙尺寸按贝壳本体算）
  group.add(proxy);
  group.rotation.y = rot;
  return group;
}
