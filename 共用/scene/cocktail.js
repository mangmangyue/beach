/* 鸡尾酒：Tequila Sunrise（物件_酒/）。放在垫子上。
 * 三个材质档（杯 / 酒液 / 冰）和绘制顺序照 物件_酒/viewer/main.js；
 * 这里先不做折射那套，酒液只保留轻微晃动。 */
import * as THREE from 'three';
import { ENV, grade } from '../constitution.js';
import { loadTexRaw, loadGLB, blobShadow, bbox } from './util.js';
import { makeOrangeTexture, makeOrangeAlpha, makeSliceGeometry } from './橙片.js';

const CK = '../物件_酒/viewer/';
const GLASS = { alpha: 20, rim: 100, rimP: 340, core: 0 };
const LIQ   = { alpha: 62, rim: 12,  rimP: 200, core: 16 };
const ICE   = { alpha: 26, rim: 130, rimP: 260, core: 0 };
const ICE_MATS = {
  M_Glass: { tier: 'glass' },
  M_LiqSunrise: { tier: 'liquid', color: '#F0731E', map: 'tex/sunrise.png' },
  M_IceCube: { tier: 'ice', color: '#EAF6FA' },
};
const SOLID = {
  M_Orange:     { color: '#FFFFFF', rough: 0.50, map: 'tex/orange.png', emissive: 0.32, fruit: 0.45 },
  M_OrangeRind: { color: '#E8912A', rough: 0.50, emissive: 0.26, fruit: 0.35 },
  M_Cherry:     { color: '#B4232E', rough: 0.28, emissive: 0.20 },
  M_CherryStem: { color: '#6E7A46', rough: 0.62, emissive: 0.12 },
  M_StrawA:     { color: '#F5F2EC', rough: 0.36, emissive: 0.14 },
  M_StrawB:     { color: '#E8635C', rough: 0.36, emissive: 0.18 },
};
const ORDER = { glassBack: 0, glassFront: 1, garnishin: 2, liquid: 3, ice: 4, garnish: 5 };

function addFruitRim(m, s) {
  const u = { uFruitS: { value: s } };
  m.userData.fruitU = u;
  m.onBeforeCompile = sh => {
    sh.uniforms.uFruitS = u.uFruitS;
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
  m.customProgramCacheKey = () => 'fruitRim';   // uniform 是共享对象，一份程序就够
  return m;
}

export async function loadCocktail(stage, { x = 0, z = 0, rot = 0, blanketTop }) {
  const [json, gltf] = await Promise.all([fetch(CK + 'cocktails.json').then(r => r.json()), loadGLB(CK + 'cocktails.glb')]);
  const info = json.cocktails.find(c => c.key === 'sunrise') || json.cocktails[0];
  const tiered = [], fruitMats = [], refractors = [];
  const REFRACT = 1.30;
  const put = (m, t) => {
    m.uniforms.uAlpha.value = t.alpha / 100;
    m.uniforms.uRimS.value = ENV.rimS / 100 * t.rim / 100;
    m.uniforms.uRimP.value = t.rimP / 100;
    m.uniforms.uCoreS.value = ENV.core / 100 * t.core / 100;
  };
  const glassBack = stage.materials.ice('glass'); glassBack.side = THREE.BackSide; tiered.push([glassBack, GLASS]);
  const glassFront = stage.materials.ice('glass'); glassFront.side = THREE.FrontSide; tiered.push([glassFront, GLASS]);
  const cache = new Map();
  const getMaterial = name => {
    if (cache.has(name)) return cache.get(name);
    let m;
    const s = ICE_MATS[name];
    if (s) {
      m = stage.materials.ice('glass', { color: s.color || null, map: s.map ? loadTexRaw(CK + s.map) : null });
      if (s.map) m.uniforms.uUseMap.value = 1;
      if (s.tier === 'liquid') { m.side = THREE.DoubleSide; tiered.push([m, LIQ]); }
      else if (s.tier === 'ice') tiered.push([m, ICE]);
    } else {
      const d = SOLID[name] || { color: '#B9BFC6', rough: 0.5 };
      m = stage.materials.solid(d.map ? '#FFFFFF' : d.color, { rough: d.rough });
      if (d.emissive) { m.emissive = new THREE.Color(d.map ? '#FFFFFF' : grade(d.color, 'emissive')); m.emissiveIntensity = d.emissive; }
      if (d.fruit) { m.transparent = true; addFruitRim(m, d.fruit); fruitMats.push({ m, base: d.fruit }); }
      if (d.map) {
        m.map = loadTexRaw(CK + d.map, () => { m.needsUpdate = true; });
        /* ⚠️ 果肉也要 emissiveMap。原来只给了一个**纯白**的 emissive，
         * 整片橙子被一层均匀的白光糊住 —— 那正是"像塑料片"的来源：
         * 真的果肉是**背光透出自己的颜色**，不是表面刷了层白。
         * 用同一张图当 emissiveMap，透出来的就是果肉自己的橙红。 */
        if (d.fruit) m.emissiveMap = m.map;
      }
    }
    cache.set(name, m);
    return m;
  };

  const group = new THREE.Group();
  group.name = 'cocktail';
  let slosh = null;
  /* 果肉的通透 / 透光 / 边缘光都上面板（「鸡尾酒」区）——
   * Iris 2026-08-29：「果肉质感不太对，没有晶莹剔透，像一个塑料片；调不好就做成参数」。 */
  function refreshFruit() {
    /* ⚠️ 只动**橙片那一片**。上一版是把 part 为 garnish/garnishin 的**整个节点**一起挪 ——
     * 而吸管、樱桃也在同一个节点里，结果一调前倾，吸管整根跑到杯子外面去了
     * （Iris 2026-08-29 截图）。橙片现在是单独一个自己造的 mesh，动它不牵连别人。 */
    if (slice) {
      slice.position.y = sliceBase.y + (ENV.ckFruitY ?? -6) / 1000;
      slice.rotation.x = sliceBase.rx + (ENV.ckFruitTilt ?? 8) * Math.PI / 180;
      slice.scale.setScalar((ENV.ckFruitScale ?? 100) / 100);
      slice.visible = (ENV.ckFruitOn ?? 1) > 0.5;
    }
    for (const { m, base } of fruitMats) {
      m.opacity = (ENV.ckFruitA ?? 72) / 100;
      m.emissiveIntensity = (ENV.ckFruitGlow ?? 85) / 100 * 1.1;
      m.userData.fruitU && (m.userData.fruitU.uFruitS.value = base * (ENV.ckFruitRim ?? 100) / 100);
    }
  }
  for (const node of [...gltf.scene.children].filter(n => info.parts.includes(n.name))) {
    const part = node.userData.part;
    node.position.set(0, 0, 0);
    if (part === 'glass') {
      const front = node.clone();
      node.traverse(o => { if (o.isMesh) { o.material = glassBack; o.userData.slot = 'glassBack'; } });
      front.traverse(o => { if (o.isMesh) { o.material = glassFront; o.userData.slot = 'glassFront'; } });
      group.add(node, front); stage.markGlass(node); stage.markGlass(front);
      continue;
    }
    node.traverse(o => {
      if (!o.isMesh) return;
      o.userData.matName = o.material?.name || '';
      o.material = getMaterial(o.userData.matName);
      o.userData.slot = part;
      // ⚠️ 只开 transparent，**别在这儿写 opacity** ——
      //    以前这里拍成 1，把上面果肉那档的 0.88 悄悄盖掉了，参数写了等于没写
      if (part === 'garnish' || part === 'garnishin') o.material.transparent = true;
      if (part !== 'liquid') o.userData.noBounds = true;
    });
    if (part === 'liquid' || part === 'ice') stage.markGlass(node);
    if (part === 'liquid') {
      const b = new THREE.Box3().setFromObject(node);
      const c = b.getCenter(new THREE.Vector3());
      const sp = info.sloshPivot || [0, 0]; c.set(sp[0], c.y, sp[1]);
      const pivot = new THREE.Group(); pivot.position.copy(c); node.position.sub(c); pivot.add(node); group.add(pivot);
      slosh = pivot;
    } else if (part === 'garnishin') {
      /* 水面以下的装饰要**折射**（这一条 08-22 在 物件_酒/viewer 里做过，
       * 移植到场景的时候漏了 —— Iris 2026-08-29：「我之前做过吸管的折射怎么没有了」）。
       * 一杯液体装在圆柱杯里就是个**柱面透镜**：水下的东西在画面上会被
       * 沿水平方向、绕杯轴放大。所以水下那截吸管往外挪、自己也变粗，
       * 而水面以上那截不动 —— 交界处断开一截，那就是"折射"看起来的样子。
       * 做法不是加个偏移量（那样只有一个机位对），是真的做一次**沿相机右方向的缩放**：
       *   A(rotY=θ) → scaleX=M → B(rotY=-θ)  合起来 = R(θ)·S·R(-θ)
       * 相机转到哪都对；转到吸管正对镜头时错位自然消失 —— 物理上本来就该消失。
       * M 的上限是算出来的：吸管在液面处离轴 2.19cm、自身半径 0.36cm，
       * 放大后外缘 (2.19+0.36)·M 不能超过杯外壁 3.52cm，所以 M ≤ 1.38，取 1.30。 */
      const outer = new THREE.Group(), inner = new THREE.Group();
      outer.add(inner); inner.add(node); group.add(outer);
      refractors.push({ outer, inner });
    } else {
      group.add(node);
    }
  }
  group.traverse(o => { if (o.isMesh && o.userData.slot) o.renderOrder = ORDER[o.userData.slot] ?? 0; });
  group.position.set(x, 0, z); group.rotation.y = rot;
  group.userData.noSink = true;
  stage.world.add(group);
  const y = blanketTop(x, z) + 0.001;
  group.position.y = y;                          // 杯子最低点 y=0 就是杯底
  const shadow = blobShadow(stage, x, y + 0.0012, z, info.footRadius * 2 * 1.6, 0.3);
  stage.world.add(shadow);

  /* --- 把 glb 里那片橙子换成自己造的 -------------------------------------
   * 换的理由见 ./橙片.js 顶上：卡口是个矩形槽（太假），贴图只有 128px（凑近全是锯齿）。
   * 做法：先量出原来那片的**中心 / 半径 / 朝向**，把原件藏掉，
   * 在同一个位置放一片自己造的（圆 − 一条极窄的缝）。这样不用改 glb，
   * 而且以后 glb 换了也能自动对上。 */
  let slice = null, sliceBase = { y: 0, rx: 0 };
  {
    const olds = [];
    group.traverse(o => {
      const n = o.material?.userData?.name || o.userData.matName;
      if (o.isMesh && (n === 'M_Orange' || n === 'M_OrangeRind')) olds.push(o);
    });
    if (olds.length) {
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      for (const o of olds) { o.updateWorldMatrix(true, false); tmp.setFromObject(o); box.union(tmp); }
      // ⚠️ setFromObject 给的是**世界**坐标，而 slice 是加进 group 的（局部坐标）——
      //    直接拿来当 position 会多偏一个 group 的位移，橙片会飞到杯子外面老远。
      group.updateWorldMatrix(true, false);
      const c = group.worldToLocal(box.getCenter(new THREE.Vector3()));
      const size = box.getSize(new THREE.Vector3());
      // 片是薄的：最短那条边是厚度，另外两条里取大的当直径
      const dims = [size.x, size.y, size.z];
      const thin = dims.indexOf(Math.min(...dims));
      const R = Math.max(...dims.filter((_, i) => i !== thin)) / 2;
      const thickness = Math.max(dims[thin], R * 0.045);
      const geo = makeSliceGeometry(R, thickness, ENV.ckFruitSlit ?? 2.2);
      const mat = new THREE.MeshStandardMaterial({
        map: makeOrangeTexture(), roughness: 0.42, metalness: 0,
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
        emissive: new THREE.Color('#FFFFFF'),
      });
      mat.emissiveMap = mat.map;                 // 背光透出果肉**自己的**颜色，不是一层白
      mat.alphaMap = makeOrangeAlpha();          // 白络/缝隙比果肉更透 —— 柑橘"透"的那一层
      slice = new THREE.Mesh(geo, mat);
      slice.userData = { noBounds: true, noShadow: true, slot: 'garnish' };
      slice.renderOrder = ORDER.garnish;
      // 片面朝哪：厚度最薄的那个轴就是法线
      if (thin === 0) slice.rotation.y = Math.PI / 2;
      else if (thin === 1) slice.rotation.x = Math.PI / 2;
      slice.position.copy(c);
      sliceBase = { y: c.y, rx: slice.rotation.x };
      group.add(slice);
      fruitMats.push({ m: mat, base: 0.45 });
      for (const o of olds) o.visible = false;   // 原件留着不删，方便对比 / 回退
    }
  }

  refreshFruit();
  stage.onParams(refreshFruit);

  let t = 0;
  return {
    group, shadow,
    update(dt) {
      t += dt;
      // 折射的缩放轴要跟着机位转：θ 是「相机右方向」的方位角
      if (refractors.length) {
        const e = stage.camera.matrixWorld.elements;
        const th = Math.atan2(-e[2], e[0]);
        const m = (ENV.ckRefract ?? 130) / 100;
        for (const { outer, inner } of refractors) {
          outer.rotation.y = th; inner.rotation.y = -th; outer.scale.x = m;
        }
      }
      tiered.forEach(([m, tier]) => put(m, tier));    // stage.applyParams 会刷回玻璃档，每帧盖回来
      if (slosh) { slosh.rotation.x = Math.sin(t * 0.9) * 0.011; slosh.rotation.z = Math.sin(t * 0.63 + 1.7) * 0.011; }
    },
  };
}
