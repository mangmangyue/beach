/* 浪 —— 像潮汐一样打上沙滩的一层薄水膜 + 前缘的泡沫带。
 *
 * 一片大网格铺在沙上（include 了 sand.js 的 HEIGHT_GLSL，所以永远贴着当下的沙面），
 * 沿着浪的方向 d 看：水线 front(perp, t) 周期性地冲上来（快）、退回去（慢），
 * 水线前方是泡沫，后方是越来越深的水。水线不是直线：沿垂直方向叠了三个正弦的抖动。
 *
 * 它是两张场的写入者之一（见 场接口.md 第四节）：
 *   被水盖住的格子 → 湿度场写 1
 *   被水盖住的格子 → 高度场往 0 抹（浪把脚印和沙痕冲平）
 * front() 在 JS 和 GLSL 里各有一份，公式必须一致 —— 画面里的水线 = 场里写入的水线。
 */
import * as THREE from 'three';
import { HEIGHT_GLSL, SAND_FAR } from './sand.js';

const WAVE_VS = /* glsl */`
${HEIGHT_GLSL}
uniform float uTime, uPeriod, uReach, uShore;
uniform vec2 uDir, uPerp;
varying float vDist; varying vec2 vQ; varying vec3 vV; varying float vDepth;

// 水线：JS 的 waveFront() 是同一公式
float frontAt(float perp, float t){
  float ph = fract(t / uPeriod);
  float base;
  if(ph < 0.35){ float s = ph / 0.35; s = s*s*(3.0-2.0*s); base = mix(uShore, uReach, s); }
  else        { float s = (ph-0.35) / 0.65; s = s*s*(3.0-2.0*s); base = mix(uReach, uShore, s); }
  float wob = 0.7*sin(perp*0.55 + t*0.40) + 0.4*sin(perp*1.7 - t*0.70) + 0.25*sin(perp*3.1 + t*1.1);
  return base + wob;
}
void main(){
  // position.x = 沿浪方向 u，position.z = 垂直方向 v（几何是轴对齐的带，这里转到 d/perp）
  float u = position.x, v = position.z;
  vec2 q = uDir * u + uPerp * v;
  float h = heightAt(q);
  float dist = u - frontAt(v, uTime);          // >0 在水里，<0 在水线前面的干沙上
  // 近处：贴着沙的薄水（跟着沙面）；远处：真正的海，越远越深、越远越平
  float depth = clamp(dist * 0.06, 0.0, 0.35) + smoothstep(1.5, 12.0, dist) * 0.9;
  float sea = smoothstep(2.0, 9.0, dist);
  float ripple = sin(u*2.2 - uTime*2.6 + v*0.3)*0.012 + sin(u*4.7 + uTime*1.9)*0.006
               + sea * (sin(u*0.9 - uTime*1.1 + v*0.5)*0.05 + sin(v*1.3 + uTime*0.8)*0.03);
  vDist = dist; vQ = q; vDepth = depth;
  float surf = mix(h + depth, 1.05 + depth * 0.3, sea);   // 远海面不再跟着沙丘起伏
  vec3 p = vec3(q.x, surf + 0.012 + ripple * smoothstep(0.0, 1.5, dist), q.y);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const WAVE_FS = /* glsl */`
precision highp float;
uniform vec3 uShallow, uDeep, uFoamC, uFogColor;
uniform float uTime, uFar, uFoam, uClarity;
uniform vec2 uDir;
varying float vDist; varying vec2 vQ; varying vec3 vV; varying float vDepth;

float hash(vec2 c){ return fract(sin(dot(c, vec2(41.7,289.3))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void main(){
  if(vDist < -1.6) discard;
  vec3 N = vec3(0.0, 1.0, 0.0), V = normalize(vV);
  float fres = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.0);

  // 水体：前缘薄得透明 → 浅水 → 远处实打实的深蓝海面
  vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 5.0, vDist));
  float body = smoothstep(-0.2, 1.6, vDist) * (0.30 + 0.45 * (1.0 - uClarity));
  body += fres * 0.25 * smoothstep(0.0, 1.0, vDist);
  body = mix(body, 0.96, smoothstep(2.0, 8.0, vDist));          // 海体不透明
  // 海面的碎光：慢慢流动的亮斑
  float n0 = vnoise(vec2(vQ.x*0.7 + uTime*0.15, vQ.y*0.7 - uTime*0.1));
  water += vec3(0.10, 0.12, 0.12) * smoothstep(0.55, 0.9, n0) * smoothstep(2.0, 6.0, vDist);

  // 泡沫：水线前后一条带，两层噪声打碎成絮状，随时间流动
  float band = smoothstep(-1.6, -0.2, vDist) * (1.0 - smoothstep(0.3, 2.4, vDist));
  float n1 = vnoise(vec2(vQ.x*2.3 + uTime*0.6, vQ.y*2.3));
  float n2 = vnoise(vec2(vQ.x*6.0 - uTime*1.1, vQ.y*6.0 + uTime*0.4));
  float foam = band * smoothstep(0.35, 0.8, n1*0.6 + n2*0.5) * uFoam;
  // 水线最前沿一道细白边
  foam += (1.0 - smoothstep(0.0, 0.35, abs(vDist + 0.1))) * 0.6 * uFoam;
  // 再往外一道破碎的浪线（浪头在浅滩碎掉的地方），随潮汐前后漂
  float band2 = smoothstep(3.0, 4.0, vDist) * (1.0 - smoothstep(4.6, 6.4, vDist));
  float n3 = vnoise(vec2(vQ.x*1.6 - uTime*0.9, vQ.y*1.9 + uTime*0.3));
  foam += band2 * smoothstep(0.5, 0.85, n3) * 0.55 * uFoam;

  vec3 col = mix(water, uFoamC, clamp(foam, 0.0, 1.0));
  float a = clamp(body + foam, 0.0, 0.92);

  // 海的消隐比沙远得多：蓝色一直保持到接近地平线才化成背景色（沙那时早就藏在海面下了）
  // 海的雾只按"往海里去的深度"算，不按离原点的距离 —— 否则侧面的海会先化掉，看起来像到头了
  float dd = clamp(max(dot(vQ, uDir), 0.0) / (uFar * 1.9), 0.0, 1.0);
  col = mix(col, uFogColor, pow(dd, 1.6));
  a *= 1.0 - pow(dd, 4.0);
  gl_FragColor = vec4(col, a);
}`;

/* JS 侧的水线（和 shader 一致）。perp 是垂直浪向的坐标，t 秒。 */
export function waveFront(perp, t, { period, reach, shore }) {
  const ph = (t / period) % 1;
  let base;
  if (ph < 0.35) { let s = ph / 0.35; s = s * s * (3 - 2 * s); base = shore + (reach - shore) * s; }
  else { let s = (ph - 0.35) / 0.65; s = s * s * (3 - 2 * s); base = reach + (shore - reach) * s; }
  return base + 0.7 * Math.sin(perp * 0.55 + t * 0.40) + 0.4 * Math.sin(perp * 1.7 - t * 0.70)
              + 0.25 * Math.sin(perp * 3.1 + t * 1.1);
}

export function createWaves(sand) {
  const { height, wet } = sand.fields;
  // 网格：x = 沿浪方向 u（从岸上到海里），z = 垂直方向 v
  const NU = 170, NV = 130;
  let geoSize = [0, 0];
  function buildGeo(U1, V) {       // 纵向 0..U1、横向 ±V（局部单位），面板里可调
    const g = new THREE.PlaneGeometry(U1, V * 2, NU, NV);
    g.rotateX(-Math.PI / 2); g.translate(U1 / 2, 0, 0);
    geoSize = [U1, V];
    return g;
  }
  const geo = buildGeo(140, 260);
  const uniforms = {
    ...sand.heightUniforms,                 // 同一份对象：沙怎么变，水就贴着怎么变
    uTime:    { value: 0 },
    uPeriod:  { value: 9 },
    uReach:   { value: 6.5 },
    uShore:   { value: 16 },
    uDir:     { value: new THREE.Vector2(1, 0) },
    uPerp:    { value: new THREE.Vector2(0, 1) },
    uShallow: { value: new THREE.Color('#BFE3EA') },
    uDeep:    { value: new THREE.Color('#7FB7C8') },
    uFoamC:   { value: new THREE.Color('#FFFFFF') },
    uFogColor: sand.uniforms.uFogColor,
    uFar:      { value: SAND_FAR },
    uFoam:    { value: 0.7 },
    uClarity: { value: 0.6 },
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    vertexShader: WAVE_VS, fragmentShader: WAVE_FS, uniforms,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const state = { t: 0, dir: 0, period: 9, reach: 6.5, shore: 16, erase: 0.4, on: true };
  const frontTable = new Float32Array(257);   // 一帧内水线沿 perp 的采样表，省得每格算三个 sin

  function setParams(p) {
    state.on = !!p.waveOn;
    state.period = p.wavePeriod;
    state.reach = p.waveReach;
    state.shore = p.waveReach + 9.5;
    state.erase = p.waveErase / 100;
    const th = p.waveDir * Math.PI / 180;
    uniforms.uDir.value.set(Math.cos(th), Math.sin(th));
    uniforms.uPerp.value.set(-Math.sin(th), Math.cos(th));
    uniforms.uPeriod.value = state.period;
    uniforms.uReach.value = state.reach;
    uniforms.uShore.value = state.shore;
    uniforms.uFoam.value = p.waveFoam / 100;
    uniforms.uShallow.value.set(p.waterC);
    uniforms.uDeep.value.set(p.waterDeepC);
    if (p.seaLength !== geoSize[0] || p.seaWidth !== geoSize[1]) { mesh.geometry.dispose(); mesh.geometry = buildGeo(p.seaLength, p.seaWidth); }
    mesh.visible = state.on;
  }

  /* 每帧：推进时间，把"现在被水盖住的格子"写进两张场 */
  function update(dt) {
    if (!state.on) return;
    state.t += dt;
    uniforms.uTime.value = state.t;
    const d = uniforms.uDir.value, pp = uniforms.uPerp.value;
    const half = wet.half;
    const L = half * Math.SQRT2 * 1.05;
    for (let i = 0; i <= 256; i++) frontTable[i] = waveFront(-L + (2 * L) * i / 256, state.t, state);
    const frontOf = perp => {
      const g = (perp + L) / (2 * L) * 256;
      const i = Math.max(0, Math.min(255, Math.floor(g)));
      return frontTable[i] + (frontTable[i + 1] - frontTable[i]) * (g - i);
    };
    const keep = Math.max(0, 1 - state.erase * dt * 2.5);
    // 两张场同一网格、同一遍历：一次判定，两处写
    const hd = height.data, wd = wet.data, n = wet.n, cell = wet.cell;
    let wrote = false;
    for (let j = 0; j < n; j++) {
      const z = -half + (j + 0.5) * cell;
      for (let i = 0; i < n; i++) {
        const x = -half + (i + 0.5) * cell;
        const proj = x * d.x + z * d.y;
        if (proj < state.reach - 2.5) continue;        // 水最远也够不着的地方，跳过
        const perp = x * pp.x + z * pp.y;
        if (proj < frontOf(perp)) continue;            // 水线前面：干的
        const k = j * n + i;
        if (wd[k] < 1) { wd[k] = 1; wrote = true; }
        if (hd[k] !== 0) { hd[k] *= keep; if (Math.abs(hd[k]) < 1e-4) hd[k] = 0; wrote = true; }
      }
    }
    if (wrote) { wet.touch(); height.touch(); }
  }

  /* 某个局部坐标现在在不在水下（浪线以海的那一侧） */
  function covered(lx, lz) {
    if (!state.on) return false;
    const d = uniforms.uDir.value, pp = uniforms.uPerp.value;
    const proj = lx * d.x + lz * d.y, perp = lx * pp.x + lz * pp.y;
    return proj >= waveFront(perp, state.t, state);
  }
  /* 当前水线在某个 perp 处的位置（局部坐标），放新贝壳用 */
  function frontPoint(perp) {
    const d = uniforms.uDir.value, pp = uniforms.uPerp.value;
    const f = waveFront(perp, state.t, state);
    return [d.x * f + pp.x * perp, d.y * f + pp.y * perp];
  }
  const phase = () => (state.t / state.period) % 1;
  /* 水线现在在哪（局部单位，沿浪的方向）。声音就是靠它和画面对齐的 ——
   * 和着色器里的 frontAt() 是同一个公式，所以听到的和看到的是同一条线。 */
  const frontLine = (perp = 0, dt = 0) => waveFront(perp, state.t + dt, state);
  return { mesh, uniforms, state, setParams, update, covered, frontPoint, phase, frontLine,
           dir: () => uniforms.uDir.value, perp: () => uniforms.uPerp.value };
}
