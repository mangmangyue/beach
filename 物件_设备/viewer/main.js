/* 物件 · 设备（银色 MacBook + 富士 X-S10）
 *
 * 和花 / 贝壳一样：这里没有光照和后处理代码，只有一张材质表 + 摆位 + 热区。
 *   · 机身、镜筒、皮套 —— 实体档（stage.materials.solid），但**关掉 flatShading**：
 *     宪法 v1.0 起是平滑着色，stage 那边的默认还是 flat（那是 v0.5 留下的），
 *     所以在这里逐个改。共用/ 不归我改。
 *   · 前镜片 —— 玻璃档冰壳（stage.materials.ice('glass')）。
 *   · 两块屏幕 —— 光源类（stage.materials.screen，不受光）。MacBook 那块另加光晕。
 *   · 镜头上那个小高光点 —— 加法混合的一小片，固定在镜片上、不跟随光源（宪法 一点五 · 4）。
 *
 * 贴图都过 gradeImageData（统一器 5：贴图也要过同一套变换），
 * 屏幕走 'emissive' 档（只轻微染环境色），键盘面走 'normal'。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStage } from '../../共用/stage.js';
import { ENV, gradeImageData, grade, satBoost } from '../../共用/constitution.js';

/* ⚠️ 临时垫片 —— 不是这个物件的东西，等窗口 A 把 共用/waves.js 补完就删。
 * 2026-08-23 23:30 的 waves.js 里 setParams() 引用了 geoSize / buildGeo，
 * 但这两个还没写出来（海面尺寸滑块做到一半），createStage 一跑就抛 ReferenceError。
 * waves.js 是模块，未声明的标识符会顺作用域链找到 globalThis —— 所以在这里补一份同样的
 * 几何构造就能跑，且窗口 A 一旦在 waves.js 里 const 出这两个名字，本垫片自动失效。
 * 共用/ 不归我改，所以只在自己的 viewer 里垫。 */
if (typeof globalThis.geoSize === 'undefined') {
  globalThis.geoSize = [ENV.seaLength, ENV.seaWidth];
  globalThis.buildGeo = (L, W) => {
    const g = new THREE.PlaneGeometry(L, W * 2, 170, 130);
    g.rotateX(-Math.PI / 2);
    g.translate(L / 2, 0, 0);
    return g;
  };
  console.warn('[物件_设备] 垫了 共用/waves.js 缺的 geoSize / buildGeo —— 窗口 A 补完后删掉');
}

const canvas = document.getElementById('view');
const LAYOUT = new URLSearchParams(location.search).get('layout') || 'pair';
const CAM_LAYOUTS = ['ccd'];
const FOCUS = LAYOUT === 'mb' ? 'macbook' : (CAM_LAYOUTS.includes(LAYOUT) ? 'camera' : null);

const stage = createStage(canvas, {
  target: new THREE.Vector3(0, FOCUS === 'camera' ? 0.035 : 0.07, 0.02),
  distance: FOCUS === 'camera' ? 0.24 : FOCUS ? 0.62 : 0.80,
  polar: Math.PI / 2 - 0.42,
});

/* ---- 银色的可调参数（Iris 自己调的就是这一组）----
 * 面板里的「银色」那一栏直接改这个对象，改完点「复制参数」把 JSON 拷出来贴回这里。
 * 每一项在干什么，见 说明.md 的「透亮」那一节。 */
const SILVER = {
  hex:    '#DFE5EA',   // 基色
  bright: 1.00,        // 基色亮度倍率（0.75~1.20）
  cool:   0.00,        // 冷暖（-20 暖 ~ +20 冷；正数往蓝里偏）
  rough:  0.16,        // 粗糙度。低 = 高光收得紧、亮
  envI:   1.15,        // 环境反射倍率。别开大，开大整块会被糊平
  emis:   0.32,        // 自发光。补回沙的明度区间用的，不是辉光
  rimS:   6.5,         // 边缘亮线强度
  rimP:   3.2,         // 边缘亮线锐度（幂次，大 = 只有掠射的那一条边亮）
  skyLo:  0.55,        // 天光梯度：朝侧 / 朝下的面压到多少（朝天的固定 1.08）
  swAmt:  0.44,        // 键盘面的扫光幅度（平面只能靠这个做出体积）
  swAng:  152,         // 扫光方向（度）
  swBand: 0.14,        // 扫光里那条窄镜面亮带的强度
};

const SILVER_DEFAULTS = JSON.stringify(SILVER);

function silverColor(mul = 1) {
  const c = new THREE.Color(SILVER.hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, THREE.MathUtils.clamp(hsl.s + SILVER.cool / 900, 0, 1),
           THREE.MathUtils.clamp(hsl.l * SILVER.bright * mul, 0, 1));
  if (SILVER.cool) {   // 往蓝 / 往黄推一点，比动色相稳
    c.r -= SILVER.cool / 2600; c.b += SILVER.cool / 2600;
  }
  return '#' + c.getHexString();
}

/* ---- 材质表（颜色和 blender/build_devices.py 的 COLORS 一致）---- */
const MATS = {
  M_Silver:     { silver: 1.00, rough: () => SILVER.rough, envI: () => SILVER.envI },
  M_SilverDark: { silver: 0.78, rough: () => SILVER.rough + 0.10, envI: () => SILVER.envI * 0.85 },
  M_Deck:       { silver: 1.00, rough: () => SILVER.rough + 0.04, envI: () => SILVER.envI * 0.9,
                  map: 'tex/mb_deck.png', emisMap: true, sweep: true },
  // 小数码的机身**跟着同一套 SILVER 走**（倍率 0.96，比笔电深一点点）。
  // 调一次银，笔电和相机一起变 —— 这本身就是统一器 1。
  // 相机的银比笔电**深一档、自发光只给一半**：SILVER.emis 是照着笔电那种大平面调的，
  // 原样套到一个小而密的机身上会直接烧成纸白（一坨白盒子）。
  M_CamSilver:  { silver: 0.88, emisMul: 0.45,
                  rough: () => SILVER.rough + 0.04, envI: () => SILVER.envI * 0.92 },
  M_Bezel:      { color: '#20252A', rough: 0.34, emis: 0.06 },
  M_CamDark:    { color: '#3A4045', rough: 0.40, emis: 0.06 },
  M_Lamp:       { color: '#E9A24E', rough: 0.35, emis: 0.75 },
  M_LensRing:   { color: '#979EA4', rough: 0.26 },
};
// X-S10 已停用（Iris，08-24）。它那几个材质（M_CamBody / M_CamTop / M_Dial / M_DialFace /
// M_Shoe / M_Leather / M_LensBarrel / M_LcdBezel / M_Logo）跟着一起删了；
// build_devices.py 里 build_xs10() 还在，真要复活的话这里也要一起加回来。

/* 银的三个材质随 SILVER 实时刷新。stage.applyParams() 会按 userData.baseHex 重刷颜色，
 * 所以改色的时候 baseHex 也要一起改，否则拖别的滑块会把颜色弹回去。 */
const silverMats = [];
function refreshSilver() {
  for (const { m, spec } of silverMats) {
    const hex = silverColor(spec.silver);
    m.userData.baseHex = hex;
    if (!spec.map) m.color.set(grade(satBoost(hex)));
    m.roughness = spec.rough();
    m.envMapIntensity = spec.envI();
    m.emissive.set(hex);
    m.emissiveIntensity = SILVER.emis * (spec.emisMul ?? 1);
    m.userData.rimMul = SILVER.rimS;
    m.userData.rimP = SILVER.rimP;
    const u = m.userData.rimU;
    u.uSkyLo.value = SILVER.skyLo;
    u.uSkyHi.value = 1.08;
    u.uSwAmt.value = SILVER.swAmt;
    u.uSwAng.value = SILVER.swAng * Math.PI / 180;
    u.uSwBand.value = SILVER.swBand;
  }
}

const SCREENS = { M_ScreenMB: 'tex/mb_screen.png', M_CcdScreen: 'tex/ccd_lcd.png' };
const LCD_DIM = 0.94;      // 相机屏：现在正对观众，是相机身上唯一亮的地方，别压太狠
const SCREEN_GAIN = 1.30;  // 笔电屏的过曝量（>1，交给色调映射收）
const GLOW_SPRITE = 1.00;  // 屏幕光晕：对着相机的那一片
const GLOW_SPLAT = 0.85;   // 　　　　　落在垫子上的那一片

/* 实体件的边缘亮线。两种用法，同一段 shader：
 *   · 深色件（机身 / 镜筒）—— 很低的强度、软的衰减，只为让轮廓在白沙上不糊掉（同花 / 贝壳）。
 *   · 银色件 —— 强度高、衰减**陡**，于是只有倒角和转折处亮起一条细线。
 *     这条线才是「透亮」的来源：铝的通透感来自边上那道紧的高光，不是把整块调白。
 * 所以强度和幂次是**逐材质**的，不能共用一组 uniform。 */
const rimMats = [];
function refreshRim() {
  for (const m of rimMats) {
    const { rimU, rimMul, rimP } = m.userData;
    rimU.uRimS.value = ENV.rimS / 100 * ENV.rimPetal / 100 * 1.6 * rimMul;
    rimU.uRimP.value = rimP ?? ENV.rimP / 100;
  }
}
/* 天光梯度（只给银用）。
 * 共用的光是「弱主光 + 一个半球光」，而半球光的天空色(bgBot)和地面色(sandC)**都是浅色**，
 * 于是朝上的面和朝前的面拿到的光几乎一样多 —— 深色物件看不出来，
 * 但一块接近白的铝会因此彻底摊平（调得越亮越平，第一版调白之后更糟就是这个）。
 * 这里按法线的 y 补一道很轻的明暗：朝天的面提一点、朝侧朝下的面压一点。
 * 有了这道梯度，机身才敢往亮里调 —— "透亮"是形体清楚 + 边上一条紧的高光，不是整块刷白。 */
function addRim(m, key, mul = 1, p = null, sky = null, sweep = false) {
  const rimU = { uRimS: { value: 0.1 }, uRimP: { value: 1.6 }, uRimC: { value: new THREE.Color('#FFFFFF') },
                 uSkyLo: { value: sky ? sky[0] : 1.0 }, uSkyHi: { value: sky ? sky[1] : 1.0 },
                 uSwAmt: { value: 0 }, uSwAng: { value: 0 }, uSwBand: { value: 0 } };
  Object.assign(m.userData, { rimU, rimMul: mul, rimP: p });
  rimMats.push(m);
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, rimU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDevWN; varying vec3 vDevWP;'
        + (sweep ? '\nvarying vec2 vDevUv;' : ''))
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvDevWN = normalize(mat3(modelMatrix) * normal); vDevWP = (modelMatrix * vec4(position, 1.0)).xyz;'
        + (sweep ? '\nvDevUv = uv;' : ''));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRimS, uRimP, uSkyLo, uSkyHi, uSwAmt, uSwAng, uSwBand; uniform vec3 uRimC; varying vec3 vDevWN; varying vec3 vDevWP;'
        + (sweep ? '\nvarying vec2 vDevUv;' : ''))
      .replace('#include <dithering_fragment>',
        `{ vec3 n = normalize(vDevWN); vec3 v = normalize(cameraPosition - vDevWP);
           gl_FragColor.rgb *= mix(uSkyLo, uSkyHi, smoothstep(-0.45, 0.9, n.y));
           ${sweep ? `
           // 扫光：键盘面是**一个平面**，法线处处相同，天光梯度和边缘光对它统统无效，
           // 只会是一块均匀的亮色。给平面做体积只能靠一道画上去的光 —— 这里用 UV 算，
           // 于是它是可调的（uSw*），不用重画贴图。
           vec2 sd = vec2(cos(uSwAng), sin(uSwAng));
           float g = smoothstep(0.0, 1.0, clamp(dot(vDevUv - 0.5, sd) + 0.5, 0.0, 1.0));
           float k = 1.0 - uSwAmt * 0.5 + uSwAmt * g;
           float bd = (dot(vDevUv - 0.5, vec2(-sd.y, sd.x))) / 0.18;
           k += uSwBand * exp(-bd * bd);
           gl_FragColor.rgb *= k;` : ''}
           float f = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), uRimP);
           gl_FragColor.rgb = min(gl_FragColor.rgb + uRimC * f * uRimS * 0.55, vec3(1.0)); }
         #include <dithering_fragment>`);
  };
  // ⚠️ 缓存键必须**逐材质唯一**。所有材质共用一个键的话，three 只会为第一个编译出的
  // 程序调用 onBeforeCompile，后面的材质直接复用它的 uniforms —— 于是逐材质的
  // 边缘光强度和天光梯度全部失效，而且一点报错都没有（调了半天以为是 shader 没注入）。
  m.customProgramCacheKey = () => 'deviceRim_' + key;
  return m;
}

/* 贴图：读进 canvas → 过调色变换 → CanvasTexture。
 * （行序不用倒：build_devices.py 里画图时 v=1 已经对到图的顶行了） */
function gradedTex(path, kind, onReady) {
  const c = document.createElement('canvas');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.putImageData(gradeImageData(x.getImageData(0, 0, c.width, c.height), kind), 0, 0);
    // 必须 dispose：贴图是在 canvas 还是默认 300×150 空白时就交给 three 的，
    // 图片解码回来再改 canvas 尺寸，光靠 needsUpdate 不会重新分配那块 GPU 纹理 ——
    // 结果就是键盘和屏幕永远是一块死黑（谁先跑完全看图片解码和首帧的赛跑，所以时好时坏）。
    t.dispose();
    t.needsUpdate = true;
    onReady?.(t);
  };
  img.src = path;
  return t;
}

const cache = new Map();
function getMaterial(name) {
  if (cache.has(name)) return cache.get(name);
  let m;
  if (name === 'M_LensGlass') {
    // 前镜片是**暗**的玻璃。玻璃档的出厂值（浅色 body + 内核）会把它冲成一颗白眼珠，
    // 所以给一个很深的固有色、几乎关掉内核、把不透明度拉高 ——
    // 要的是"一块实心的黑玻璃 + 一圈掠射角的亮边"，不是一摊水。
    // 还要把菲涅尔的**幂次**拉高：前镜片是一块很平的球冠，用出厂的 rimP(1.6)
    // 整个镜片会被边缘光均匀照亮 —— 平的面上没有"边缘"，f 在整片上几乎是常数（第一版就糊成一片灰）。
    // 幂次高了，只有真正掠射的那一圈才亮，中间保持黑。
    m = stage.materials.ice('glass', { color: '#131A20' });
    // uClampL 给镜片单独封顶：相机可以 orbit 到很高的俯角，那时候整片镜片都是掠射，
    // 不封顶的话它会整块烧成白的（俯视图上就是一颗白眼珠）。
    const fix = () => {
      m.uniforms.uRimP.value = 5.0;
      m.uniforms.uRimS.value = ENV.rimS / 100 * 0.55;
      m.uniforms.uCoreS.value = ENV.core / 100 * 0.04;
      m.uniforms.uAlpha.value = 0.94;
      m.uniforms.uClampL.value = 0.52;
    };
    fix();
    stage.onParams(fix);          // applyParams 会按档位重置，压回去
  } else if (name === 'M_LensSpec') {
    // 那个很小的高光点：stage 的软圆光斑贴图 + 加法混合、不受光、不写深度。
    // 固定在镜片上、不跟随光源 —— 宪法 一点五 · 第 4 条「手绘高光条」。
    m = new THREE.MeshBasicMaterial({
      map: stage.glowTex, color: new THREE.Color('#EAF6FF'), blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, opacity: 0.85, toneMapped: false,
    });
  } else if (SCREENS[name]) {
    m = stage.materials.screen(gradedTex(SCREENS[name], 'emissive'));
    // 「发光感加一点」（Iris，08-24）：MeshBasicMaterial 的 color 可以超过 1，
    // 乘上去再交给色调映射，屏幕就从"一张贴图"变成"在发光的一块面"。
    m.color.setScalar(name === 'M_ScreenMB' ? SCREEN_GAIN : LCD_DIM);
  } else {
    const s = MATS[name] || { color: '#B9BFC6', rough: 0.5 };
    const isSilver = !!s.silver;
    m = stage.materials.solid(s.map || isSilver ? '#FFFFFF' : s.color,
                              { rough: typeof s.rough === 'function' ? s.rough() : s.rough });
    m.flatShading = false;                       // 宪法 v1.0：平滑着色
    if (s.map) {
      m.map = gradedTex(s.map, 'normal', () => { m.needsUpdate = true; });
      if (s.emisMap) m.emissiveMap = m.map;
    }
    if (s.envI && !isSilver) m.envMapIntensity = s.envI;
    m.emissive = new THREE.Color(s.emisC || s.color || '#FFFFFF');
    m.emissiveIntensity = s.emis || 0;
    addRim(m, name, isSilver ? SILVER.rimS : 1, isSilver ? SILVER.rimP : null,
           isSilver ? [SILVER.skyLo, 1.08] : null, !!s.sweep);
    if (isSilver) { silverMats.push({ m, spec: s }); refreshSilver(); }
    m.needsUpdate = true;
  }
  cache.set(name, m);
  return m;
}

/* ---- 一块格纹垫（viewer 本地道具，照 物件_花 的做法，只为看颜色；真垫子归窗口 A）---- */
const BLANKET = { x: 0, z: 0.02, w: 0.78, h: 0.50, lift: 0.006 };
function ginghamTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#F4F6F5'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = 'rgba(150,180,205,0.55)';
  for (let i = 0; i < 4; i++) x.fillRect(i * 32 + 18, 0, 14, 128);
  for (let i = 0; i < 4; i++) x.fillRect(0, i * 32 + 18, 128, 14);
  x.putImageData(gradeImageData(x.getImageData(0, 0, 128, 128)), 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.8, 1.8);
  return t;
}
function addBlanket() {
  const S = stage.envScale;
  stage.sand.addDent((BLANKET.x - 0.18) / S, BLANKET.z / S, 1.7, 0.08);
  stage.sand.addDent((BLANKET.x + 0.18) / S, BLANKET.z / S, 1.7, 0.08);
  const geo = new THREE.PlaneGeometry(BLANKET.w, BLANKET.h, 34, 24);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i) + BLANKET.x, vz = pos.getZ(i) + BLANKET.z;
    const fold = Math.sin(vx * 17 + 1.3) * Math.sin(vz * 14 - 0.4) * 0.003 + Math.sin(vx * 9 - vz * 8) * 0.002;
    pos.setY(i, stage.sandY(vx, vz) + BLANKET.lift + fold);
  }
  geo.computeVertexNormals();
  const b = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: ginghamTexture(), roughness: 0.92, metalness: 0, flatShading: true,
  }));
  b.position.set(BLANKET.x, 0, BLANKET.z);
  b.userData.noSink = true;
  stage.world.add(b);
}
const blanketY = (x, z) => stage.sandY(x, z) + BLANKET.lift + 0.002;

/* ---- 摆位 ---- */
/* 相机**背对观众**摆：镜头朝 -Z，也就是朝海（Iris，08-24）。
 * 模型自己的镜头朝 +Z，所以偏航要绕到 π 附近；再偏 0.52 rad 是为了留一点侧面，
 * 让镜筒和握把还看得见，不至于变成一个正正方方的背影（0.3 试过，镜头整根消失）。
 *
 * 默认摆的是 **camera_ccd**（千禧年银色小数码）。`camera_xs10` 还在 glb 里，
 * `?layout=xs10` 单看、`?layout=both` 两台并排比 —— 但它不进默认场景。
 * 这只是 viewer 的摆样，真正摆哪儿归窗口 A。 */
const CAM_YAW = Math.PI - 0.52;
const PLACE = {
  pair:  { macbook: { x: -0.055, z: -0.10, rot: 0.10 }, camera_ccd: { x: 0.195, z: 0.085, rot: CAM_YAW } },
  mb:    { macbook: { x: 0, z: -0.02, rot: 0.06 } },
  ccd:   { camera_ccd: { x: 0.05, z: 0.03, rot: CAM_YAW } },
};

const devices = [];
function blobShadow(x, z, y, fp, rot, opacity = 0.46) {
  const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: stage.blobTex, color: '#6E7A86', transparent: true, depthWrite: false, opacity,
  }));
  b.rotation.x = -Math.PI / 2;
  b.rotation.z = -rot;
  b.position.set(x, y + 0.0015, z);
  b.scale.set(fp[0] * 1.20, fp[1] * 1.20, 1);
  b.userData.noSink = true;
  stage.world.add(b);
  return b;
}

const label = document.getElementById('label');
new GLTFLoader().load('devices.glb', gltf => {
  const spots = PLACE[LAYOUT] || PLACE.pair;
  gltf.scene.traverse(o => { if (o.isMesh) o.material = getMaterial(o.material?.name || ''); });
  if (LAYOUT !== 'grid') addBlanket();

  for (const node of [...gltf.scene.children]) {
    const p = spots[node.name];
    if (!p) continue;
    const extras = node.userData;
    node.position.set(0, 0, 0);
    const obj = new THREE.Group();
    obj.name = node.name;
    obj.add(node);
    obj.rotation.set(0, p.rot, 0);
    obj.userData.noSink = true;
    obj.position.set(p.x, blanketY(p.x, p.z), p.z);
    stage.world.add(obj);
    const blob = blobShadow(p.x, p.z, obj.position.y, extras.footprint, p.rot,
                            node.name === 'macbook' ? 0.42 : 0.5);
    devices.push({ obj, extras, node, blob });

    // MacBook 的屏幕光晕：一片对着相机的 billboard + 一片落在垫子上的光斑。
    // 位置来自 extras.screenCenter（脚本导出的，y-up 局部坐标）。
    if (node.name === 'macbook') {
      const [sw, sh] = extras.screenSize;
      const glow = stage.createScreenGlow({ width: sw, height: sh });
      const c = extras.screenCenter;
      glow.sprite.position.set(c[0], c[1], c[2] + 0.02);
      glow.splat.position.set(c[0], 0.0016, c[2] + 0.14);
      // 收一收：v1.0 是明亮的白天，屏幕不再是场景里唯一的光源了。
      // stage 每次 applyParams 都会按 ENV.emit 重置这两个 opacity，所以挂个回调压回去。
      const dim = () => {
        glow.sprite.material.opacity = ENV.emit / 100 * 0.38 * GLOW_SPRITE;
        glow.splat.material.opacity = ENV.emit / 100 * 0.22 * GLOW_SPLAT;
      };
      dim();
      stage.onParams(dim);
      obj.add(glow.group);
      obj.userData.glow = glow;
    }
  }
  const tris = devices.reduce((n, d) => n + (d.extras.tris || 0), 0);
  label.textContent = devices.map(d =>
    `${d.obj.name} · ${(d.extras.footprint[0] * 100).toFixed(1)}×${(d.extras.footprint[1] * 100).toFixed(1)}×${(d.extras.height * 100).toFixed(1)} cm · ${d.extras.tris} 面`
  ).join('\n') + `\n共 ${tris} 面`;
  document.getElementById('loading')?.remove();
  window.__dbg = { devices, cache, stage, THREE, ENV, SILVER, refreshSilver };
});

/* ---- 热区（说明.md 里写清是哪个 mesh）---- */
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const hitEl = document.getElementById('hit');
addEventListener('pointerdown', e => {
  ptr.x = (e.clientX / innerWidth) * 2 - 1;
  ptr.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ptr, stage.camera);
  for (const d of devices) {
    const names = d.extras.hotspot || [];
    const targets = [];
    d.obj.traverse(o => { if (o.isMesh && names.includes(o.name)) targets.push(o); });
    if (targets.length && ray.intersectObjects(targets, false).length) {
      hitEl.textContent = `▸ 点到 ${d.obj.name} 的热区（${names.join(' / ')}）`;
      clearTimeout(hitEl._t);
      hitEl._t = setTimeout(() => { hitEl.textContent = ''; }, 2200);
      return;
    }
  }
});

let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  refreshRim();
  stage.render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---- 面板（同花 / 贝壳）---- */
const ui = document.getElementById('panel');

/* 全局的（stage 的参数，影响整个场景） */
const SLIDERS = [
  ['exposure', '曝光', 0.6, 1.8, 0.01], ['glow', '柔光', 0, 40, 1],
  ['emit', '屏幕光', 0, 100, 1], ['haze', '雾', 0, 60, 1],
  ['shadow', '接触阴影', 0, 1, 0.02], ['softness', '影子软度', 0.5, 9, 0.25],
  ['dof', '景深', 0, 0.03, 0.001], ['bubbles', '泡泡', 0, 1, 1],
];
/* 银色的（只影响 MacBook 的三个银材质）*/
const SILVER_SLIDERS = [
  ['bright', '亮度', 0.75, 1.20, 0.01],
  ['cool', '冷暖', -20, 20, 1],
  ['rough', '粗糙度', 0.02, 0.60, 0.01],
  ['envI', '环境反射', 0, 3, 0.05],
  ['emis', '自发光', 0, 0.60, 0.01],
  ['rimS', '边缘亮线', 0, 14, 0.25],
  ['rimP', '边缘锐度', 1, 8, 0.1],
  ['skyLo', '天光梯度', 0.30, 1.00, 0.01],
  ['swAmt', '扫光', 0, 0.90, 0.01],
  ['swAng', '扫光方向', 0, 360, 2],
  ['swBand', '亮带', 0, 0.40, 0.01],
];

function slider(parent, name, val, min, max, step, onInput) {
  const row = document.createElement('label');
  row.innerHTML = `<span>${name}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}"><b>${val}</b>`;
  const [inp, out] = [row.querySelector('input'), row.querySelector('b')];
  inp.oninput = () => { out.textContent = inp.value; onInput(+inp.value); };
  parent.appendChild(row);
  return row;
}
function heading(parent, txt) {
  const h = document.createElement('div');
  h.className = 'sec';
  h.textContent = txt;
  parent.appendChild(h);
}

if (ui) {
  heading(ui, '场景 / 渲染器');
  SLIDERS.forEach(([k, name, min, max, step]) =>
    slider(ui, name, stage.params[k], min, max, step, v => { stage.params[k] = v; stage.applyParams(); }));
  // 主光是 stage 的（全场共用），但调银色的时候常常要动它，所以也放出来
  slider(ui, '主光强度', +stage.key.intensity.toFixed(2), 0, 1.6, 0.02, v => { stage.key.intensity = v; });

  heading(ui, '银色（MacBook）');
  SILVER_SLIDERS.forEach(([k, name, min, max, step]) =>
    slider(ui, name, SILVER[k], min, max, step, v => { SILVER[k] = v; refreshSilver(); }));

  const views = document.createElement('div');
  views.className = 'views';
  [['正面', 0, 62], ['3/4', 30, 58], ['侧面', 78, 72], ['俯视', 12, 24], ['左 3/4', -34, 58]]
    .forEach(([n, az, po]) => {
      const b = document.createElement('button');
      b.textContent = n;
      b.onclick = () => setView(az * Math.PI / 180, po * Math.PI / 180);
      views.appendChild(b);
    });
  ui.appendChild(views);

  const row2 = document.createElement('div'); row2.className = 'views';
  const mk = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.onclick = fn; row2.appendChild(b); return b; };
  const go = l => { location.search = l === 'pair' ? '' : '?layout=' + l; };
  const bP = mk('两件', () => go('pair'));
  const bM = mk('笔电', () => go('mb'));
  const bC = mk('相机', () => go('ccd'));
  ({ pair: bP, mb: bM, ccd: bC })[LAYOUT]?.classList.add('on');
  mk('存图', () => window.captureAs(null));
  ui.appendChild(row2);

  const row3 = document.createElement('div'); row3.className = 'views';
  const mk3 = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.onclick = fn; row3.appendChild(b); return b; };
  mk3('复制银色参数', () => {
    const out = JSON.stringify({ ...SILVER, 主光强度: +stage.key.intensity.toFixed(2),
                                 曝光: stage.params.exposure, 柔光: stage.params.glow }, null, 1);
    navigator.clipboard?.writeText(out).catch(() => {});
    console.log(out);
    const b = row3.firstChild; const old = b.textContent;
    b.textContent = '已复制 ✓'; setTimeout(() => { b.textContent = old; }, 1400);
  });
  mk3('恢复默认', () => { Object.assign(SILVER, JSON.parse(SILVER_DEFAULTS)); refreshSilver(); location.reload(); });
  ui.appendChild(row3);
}

function setView(az, po, dist = null) {
  const c = stage.controls, t = c.target;
  const d = dist ?? stage.camera.position.distanceTo(t);
  stage.camera.position.set(t.x + d * Math.sin(po) * Math.sin(az),
                            t.y + d * Math.cos(po),
                            t.z + d * Math.sin(po) * Math.cos(az));
  c.update();
}
window.setView = setView;
window.setDist = d => { const c = stage.controls; const v = stage.camera.position.clone().sub(c.target).normalize().multiplyScalar(d); stage.camera.position.copy(c.target).add(v); c.update(); };
window.setTarget = (x, y, z) => { stage.controls.target.set(x, y, z); stage.controls.update(); };

window.captureAs = n => {
  stage.render(1 / 60);
  const name = n || `设备_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  const data = canvas.toDataURL('image/png');
  return fetch(`/save?dir=${encodeURIComponent('物件_设备')}&name=${encodeURIComponent(name)}.png`,
               { method: 'POST', body: data })
    .then(r => { if (!r.ok) throw 0; return 'ok'; })
    .catch(() => { const a = document.createElement('a'); a.download = name + '.png'; a.href = data; a.click(); return 'dl'; });
};

addEventListener('keydown', e => {
  if (e.key === 'h' || e.key === 'H') ui?.classList.toggle('hidden');
});
