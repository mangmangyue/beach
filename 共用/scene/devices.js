/* 设备：MacBook + 小数码相机（物件_设备/）。放垫子上。
 * 材质规则照 物件_设备/viewer/main.js 移植：SILVER 银色系统（基色/粗糙/环境反射/自发光/
 * 天光梯度/键盘扫光）、逐材质边缘亮线、屏幕过曝交给色调映射、暗玻璃前镜片。
 * SILVER 的值取那边 Iris 调好的出厂值。 */
import * as THREE from 'three';
import { ENV, grade, satBoost, gradeImageData } from '../constitution.js';
import { loadGLB, blobShadow, bbox } from './util.js';
import { registerEnvI } from '../光照.js';
import { createWelcomeScreen } from './屏幕.js';
import { createDeckTexture } from './键盘.js';

const DV = '../物件_设备/viewer/';
// envI = 这个材质的「反射性格」（银比周围更亮那一档）。它**不直接生效** ——
// 生效的是 1 + (envI-1) × ENV.envVar%，见 共用/光照.js 的 registerEnvI。
// 全场只有「材质反射差异」一个滑块决定这些性格被放大多少。
// envI 从 1.15 降到 1.05（Iris 2026-08-28：金属反光稍微重了一点）。
// 这是「反射性格」，实际强度还要再乘面板的「材质反射差异」envVar
const SILVER = { hex: '#DFE5EA', bright: 1.00, cool: 0.00, rough: 0.16, envI: 1.05, emis: 0.32,
                 rimS: 6.5, rimP: 3.2, skyLo: 0.55, swAmt: 0.44, swAng: 152, swBand: 0.14 };
// 屏幕光的强度不在这儿了 —— 全部在面板「屏幕光」区（ENV.scrGlow / scrSpill / scrBounce…）
const LCD_DIM = 0.94, SCREEN_GAIN = 1.30;
const SCREENS = { M_ScreenMB: 'tex/mb_screen.png', M_CcdScreen: 'tex/ccd_lcd.png' };
const MATS = {
  M_Silver:     { silver: 1.00, rough: () => SILVER.rough, envI: () => SILVER.envI },
  M_SilverDark: { silver: 0.78, rough: () => SILVER.rough + 0.10, envI: () => SILVER.envI * 0.85 },
  M_Deck:       { silver: 1.00, rough: () => SILVER.rough + 0.04, envI: () => SILVER.envI * 0.9,
                  map: 'tex/mb_deck.png', emisMap: true, sweep: true },
  M_CamSilver:  { silver: 0.88, emisMul: 0.45, rough: () => SILVER.rough + 0.04, envI: () => SILVER.envI * 0.92 },
  M_Bezel:      { color: '#20252A', rough: 0.34, emis: 0.06 },
  M_CamDark:    { color: '#3A4045', rough: 0.40, emis: 0.06 },
  M_Lamp:       { color: '#E9A24E', rough: 0.35, emis: 0.75 },
  M_LensRing:   { color: '#979EA4', rough: 0.26 },
};

function silverColor(mul = 1) {
  const c = new THREE.Color(SILVER.hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, THREE.MathUtils.clamp(hsl.s + SILVER.cool / 900, 0, 1),
           THREE.MathUtils.clamp(hsl.l * SILVER.bright * mul, 0, 1));
  if (SILVER.cool) { c.r -= SILVER.cool / 2600; c.b += SILVER.cool / 2600; }
  return '#' + c.getHexString();
}

/* 实体件的边缘亮线 + 银的天光梯度 + 键盘扫光（那边 main.js 的同一段 shader）。
 * ⚠️ customProgramCacheKey 必须逐材质唯一，否则 three 只编译第一份、uniforms 全串。 */
const rimMats = [];
export function refreshDeviceRims() {
  for (const m of rimMats) {
    const { rimU, rimMul, rimP } = m.userData;
    rimU.uRimS.value = ENV.rimS / 100 * ENV.rimPetal / 100 * 1.6 * rimMul;
    rimU.uRimP.value = rimP ?? ENV.rimP / 100;
  }
}
function addRim(m, key, mul = 1, p = null, sky = null, sweep = false) {
  const rimU = { uRimS: { value: 0.1 }, uRimP: { value: 1.6 }, uRimC: { value: new THREE.Color('#FFFFFF') },
                 uSkyLo: { value: sky ? sky[0] : 1.0 }, uSkyHi: { value: sky ? sky[1] : 1.0 },
                 uSwAmt: { value: 0 }, uSwAng: { value: 0 }, uSwBand: { value: 0 } };
  Object.assign(m.userData, { rimU, rimMul: mul, rimP: p });
  rimMats.push(m);
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, rimU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDevWN; varying vec3 vDevWP;' + (sweep ? '\nvarying vec2 vDevUv;' : ''))
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvDevWN = normalize(mat3(modelMatrix) * normal); vDevWP = (modelMatrix * vec4(position, 1.0)).xyz;' + (sweep ? '\nvDevUv = uv;' : ''));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRimS, uRimP, uSkyLo, uSkyHi, uSwAmt, uSwAng, uSwBand; uniform vec3 uRimC; varying vec3 vDevWN; varying vec3 vDevWP;' + (sweep ? '\nvarying vec2 vDevUv;' : ''))
      .replace('#include <dithering_fragment>',
        `{ vec3 n = normalize(vDevWN); vec3 v = normalize(cameraPosition - vDevWP);
           gl_FragColor.rgb *= mix(uSkyLo, uSkyHi, smoothstep(-0.45, 0.9, n.y));
           ${sweep ? `
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
  m.customProgramCacheKey = () => 'deviceRim_' + key;
  return m;
}

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
  img.src = encodeURI(path);
  return t;
}

export async function loadDevices(stage) {
  const gltf = await loadGLB(DV + 'devices.glb');
  let deckTex = null;
  const silverMats = [];
  const refreshSilver = () => {
    for (const { m, spec } of silverMats) {
      const hex = silverColor(spec.silver);
      m.userData.baseHex = hex;
      if (!spec.map) m.color.set(grade(satBoost(hex)));
      m.roughness = spec.rough();
      registerEnvI(m, spec.envI());
      m.emissive.set(hex);
      m.emissiveIntensity = SILVER.emis * (spec.emisMul ?? 1);
      const u = m.userData.rimU;
      m.userData.rimMul = SILVER.rimS; m.userData.rimP = SILVER.rimP;
      u.uSkyLo.value = SILVER.skyLo; u.uSkyHi.value = 1.08;
      u.uSwAmt.value = SILVER.swAmt; u.uSwAng.value = SILVER.swAng * Math.PI / 180; u.uSwBand.value = SILVER.swBand;
    }
    refreshDeviceRims();
  };
  const cache = new Map();
  const getMaterial = name => {
    if (cache.has(name)) return cache.get(name);
    let m;
    if (name === 'M_LensGlass') {
      // 暗玻璃前镜片：深固有色 + 高幂次菲涅尔 + 亮度封顶，俯视不烧白（那边踩过的坑）
      m = stage.materials.ice('glass', { color: '#131A20' });
      const fix = () => {
        m.uniforms.uRimP.value = 5.0;
        m.uniforms.uRimS.value = ENV.rimS / 100 * 0.55;
        m.uniforms.uCoreS.value = ENV.core / 100 * 0.04;
        m.uniforms.uAlpha.value = 0.94;
        m.uniforms.uClampL.value = 0.52;
      };
      fix(); stage.onParams(fix);
    } else if (name === 'M_LensSpec') {
      m = new THREE.MeshBasicMaterial({ map: stage.glowTex, color: new THREE.Color('#EAF6FF'),
        // toneMapped 原来是 false —— 全场唯一一处绕过色调映射的地方，删了
        // （统一光照 第 3 步：色调映射只有 renderer.toneMapping 一个地方）
        // fog: false —— 加色的高光混向雾色只会更亮更脏（同 stage.js 的屏幕光晕）
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.85, fog: false });
    } else if (name === 'M_ScreenMB') {
      // MacBook 屏幕 = Iris 手写的欢迎语（见 ./屏幕.js）。原来那张风景照不用了。
      // 不过 gradeImageData（调色变换）—— 画布是运行时按宪法的颜色画的，再变换一次等于叠两次
      const screen = createWelcomeScreen();
      m = stage.materials.screen(screen.tex);
      // gain 由风格自己带（深底要 1.3 才亮，亮底 ×1.3 会烧成白纸）—— 不再用 SCREEN_GAIN
      const paint = () => { screen.redraw(); m.color.setScalar(screen.gain()); };
      paint(); stage.onParams(paint);            // 换「屏幕风格」或改背景色时重画
    } else if (SCREENS[name]) {
      m = stage.materials.screen(gradedTex(DV + SCREENS[name], 'emissive'));
      m.color.setScalar(LCD_DIM);
    } else {
      const s = MATS[name] || { color: '#B9BFC6', rough: 0.5 };
      const isSilver = !!s.silver;
      m = stage.materials.solid(s.map || isSilver ? '#FFFFFF' : s.color,
                                { rough: typeof s.rough === 'function' ? s.rough() : s.rough });
      m.flatShading = false;
      if (name === 'M_Deck') {
        // 键盘面是**运行时画的**（见 ./键盘.js）—— 原来那张 tex/mb_deck.png 是 Windows 键盘，
        // 而且字号偏大。不过 gradedTex：画布里的颜色已经是最终颜色了，再变换一遍等于叠两次
        m.map = createDeckTexture();
        if (s.emisMap) m.emissiveMap = m.map;
        // Touch Bar 上的亮度/声音要跟着状态重画（点了之后由 环境预览.html 调）
        deckTex = m.map;
      } else if (s.map) {
        m.map = gradedTex(DV + s.map, 'normal', () => { m.needsUpdate = true; });
        if (s.emisMap) m.emissiveMap = m.map;
      }
      if (s.envI && !isSilver) registerEnvI(m, typeof s.envI === 'function' ? s.envI() : s.envI);
      m.emissive = new THREE.Color(s.emisC || s.color || '#FFFFFF');
      m.emissiveIntensity = s.emis || 0;
      addRim(m, name, isSilver ? SILVER.rimS : 1, isSilver ? SILVER.rimP : null,
             isSilver ? [SILVER.skyLo, 1.08] : null, !!s.sweep);
      if (isSilver) { silverMats.push({ m, spec: s }); refreshSilver(); }
      m.needsUpdate = true;
    }
    cache.set(name, m);
    return m;
  };
  gltf.scene.traverse(o => { if (o.isMesh) o.material = getMaterial(o.material?.name || ''); });

  const out = {};
  for (const node of [...gltf.scene.children]) {
    const extras = node.userData;
    node.position.set(0, 0, 0);
    const obj = new THREE.Group();
    obj.name = node.name;
    obj.add(node);
    obj.userData.noSink = true;
    if (node.name === 'macbook') {
      const [sw, sh] = extras.screenSize;
      const glow = stage.createScreenGlow({ width: sw, height: sh });
      const c = extras.screenCenter;
      // 光晕是一块**和屏幕一样形状**的面片（不是正对相机的 billboard），
      // 所以必须跟着屏幕一起后仰 —— 直接挂到屏幕网格底下，姿态自动就是对的。
      let screen = null, deck = null;
      node.traverse(o => {
        if (!o.isMesh) return;
        if (o.name === 'mba_screen') screen = o;
        if (o.name === 'mba_deck') deck = o;
      });
      if (screen) {
        // 几何法线取平均（屏幕是块平板）→ 得到它在**自己局部空间**里的朝向
        const n = new THREE.Vector3(0, 0, 1), a = screen.geometry.attributes.normal;
        if (a) {
          n.set(0, 0, 0);
          for (let i = 0; i < a.count; i++) n.x += a.getX(i), n.y += a.getY(i), n.z += a.getZ(i);
          if (n.lengthSq() < 1e-9) n.set(0, 0, 1); else n.normalize();
        }
        screen.geometry.computeBoundingBox();
        const mid = screen.geometry.boundingBox.getCenter(new THREE.Vector3());
        // 光束的 +Z 要对上屏幕的法线，这样它就是"从这个面往前照"
        glow.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        glow.beam.position.copy(mid).addScaledVector(n, sh * 0.004);   // 贴着面，厚度几乎为零
        glow.cap.quaternion.copy(glow.beam.quaternion);
        glow.cap.position.copy(mid).addScaledVector(n, sh * 0.006);
        screen.add(glow.beam, glow.cap);
      } else {
        glow.beam.position.set(c[0], c[1], c[2] + 0.004);
        glow.cap.position.set(c[0], c[1], c[2] + 0.006);
        obj.add(glow.beam, glow.cap);
      }

      /* 洒光和反射光都躺平（法线朝上），**亮端朝前**。
       * 贴图的亮端是几何体的 +Y；rotation.x=-90° 会把 +Y 甩到世界 -Z（朝里），
       * 所以要再绕 Z 转 180° 翻到 +Z（朝外，屏幕正对的方向）。
       * 这个别凭感觉推 —— 转完拿 getWorldQuaternion 量一下最快。 */
      const nb = new THREE.Box3().setFromObject(node);          // 电脑自己的包围盒（局部坐标）
      const deckBox = deck ? new THREE.Box3().setFromObject(deck) : null;
      // 尺寸是 refreshGlow 每次按参数算的，所以摆位也得跟着重算一遍
      glow.entry.onPlace = () => {
        glow.spill.rotation.set(-Math.PI / 2, 0, Math.PI);
        const len = glow.spill.userData.spillLen || 0.1;
        // 近端顶在电脑前沿，整块在电脑外面 —— 底座和键盘不该泡在光里
        glow.spill.position.set(c[0], nb.min.y + 0.0016, nb.max.z + len / 2);
        // 反射光：贴在键盘面上，从屏幕根部往前
        glow.bounce.rotation.set(-Math.PI / 2, 0, Math.PI);
        const bl = glow.bounce.userData.bounceLen || 0.06;
        const top = deckBox ? deckBox.max.y : nb.min.y;
        const back = deckBox ? deckBox.min.z : c[2];
        glow.bounce.position.set(c[0], top + 0.0012, back + bl / 2);
      };
      glow.entry.onPlace();
      obj.add(glow.spill, glow.bounce);

      // 强度/尺寸/摆位全在 stage 的 refreshGlow 里跟着 ENV 走（面板「屏幕光」区），
      // 这儿不再另外调一遍不透明度
    }
    out[node.name === 'macbook' ? 'macbook' : 'camera'] = { obj, extras };
  }
  out.deckTex = deckTex;          // 点 Touch Bar 之后要 redraw 它
  return out;
}
