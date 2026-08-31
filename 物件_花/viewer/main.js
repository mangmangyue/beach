/* 物件 · 花
 *
 * 和贝壳一样：这里没有光照 / 后处理代码，只有一张材质表和摆位。
 *   · 花瓣（向日葵 / 月见草 / 滨旋花 / 滨菊）走 共用/stage.js 的冰壳「花瓣档」：
 *     边缘透光 ×0.08、内核 ×0、不透明 96。踩过坑：一透光花色就被冲白，别改。
 *   · 其余（茎、叶、萼、种子盘）是实体类，raw 色（不过调色变换），薄的地方给一点边缘透光。
 * 向日葵承担暖色焦点，颜色往奶油黄偏；野花是环境点缀，低饱和。
 *
 * viewer 里本地画了一块格纹垫（只为看颜色，真垫子归窗口 A）：向日葵躺垫上，野花撒垫外的沙上。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStage } from '../../共用/stage.js';
import { ENV, gradeImageData } from '../../共用/constitution.js';

const canvas = document.getElementById('view');
const layout = new URLSearchParams(location.search).get('layout') === 'grid' ? 'grid' : 'scatter';
const stage = createStage(canvas, {
  target: new THREE.Vector3(0, 0.01, layout === 'grid' ? -0.05 : 0.02),
  distance: layout === 'grid' ? 0.9 : 0.78,
  polar: Math.PI / 2 - 0.70,
});

/* ---- 材质表（颜色和 blender/build_flowers.py 的 COLORS 一致；petal 的走花瓣档冰壳）---- */
const MATS = {
  M_SunPetal:   { petal: true, map: 'tex/sun_petal.png' },
  M_SunDisc:    { color: '#FFFFFF', rough: 0.62, map: 'tex/sun_disc.png', emis: 0.22, emisC: '#7A4A24' },   // 自发光用暖棕，白的会把盘洗灰
  M_DiscRim:    { color: '#A8834C', rough: 0.40, emis: 0.18 },
  M_DiscBack:   { color: '#8FA06A', rough: 0.55 },
  M_Sepal:      { color: '#7E9862', rough: 0.55 },
  M_Stem:       { color: '#86A06B', rough: 0.50 },
  M_StemCut:    { color: '#CBD9A8', rough: 0.50, emis: 0.12 },
  M_Leaf:       { color: '#7C9C63', rough: 0.55 },
  M_PrimPetal:  { petal: true, color: '#F3E7AE' },
  M_PrimEye:    { color: '#E2C86E', rough: 0.45, emis: 0.20 },
  M_PrimSepal:  { color: '#B9A878', rough: 0.55 },
  M_GreyLeaf:   { color: '#A3AD93', rough: 0.60 },
  M_Bud:        { color: '#CDD39B', rough: 0.50, emis: 0.10 },
  M_BindPetal:  { petal: true, map: 'tex/bindweed.png' },
  M_BindThroat: { color: '#F7EFD4', rough: 0.40, emis: 0.25 },
  M_BindLeaf:   { color: '#8CA57A', rough: 0.55 },
  M_BindStem:   { color: '#9A9878', rough: 0.60 },
  M_DaisyPetal: { petal: true, color: '#EFEADB' },
  M_DaisyEye:   { color: '#E3C96C', rough: 0.45, emis: 0.20 },
  M_DaisyLeaf:  { color: '#93A884', rough: 0.55 },
};
const EMISSIVE = 0.08;   // 绿色部分：背光面太暗会变成黑影，给一点点

/* 薄的地方（叶、萼）一点边缘透光：同贝壳的做法，花瓣档强度 × 顶点色 alpha 里的薄度，封顶 1.0 */
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
  m.customProgramCacheKey = () => 'flowerRim';
  return m;
}

function loadTex(path) {
  const t = new THREE.TextureLoader().load(path);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const cache = new Map();
function getMaterial(name) {
  if (cache.has(name)) return cache.get(name);
  const s = MATS[name] || { color: '#CCCCCC', rough: 0.5 };
  let m;
  if (s.petal) {
    // 花瓣档：贴图给颜色（向日葵 / 滨旋花），或直接一个固有色（月见草 / 滨菊）
    m = stage.materials.ice('petal', { color: s.color || null, map: s.map ? loadTex(s.map) : null });
    if (s.map) m.uniforms.uUseMap.value = 1;
  } else {
    m = stage.materials.solid(s.color, { rough: s.rough, raw: true });
    m.side = THREE.DoubleSide;                 // 叶子两面都看得到
    m.emissive = new THREE.Color(s.emisC || (s.map ? '#FFFFFF' : s.color));
    m.emissiveIntensity = s.emis ?? EMISSIVE;
    if (s.map) m.map = loadTex(s.map);
    addRim(m);
  }
  cache.set(name, m);
  return m;
}

/* ---- 一块格纹垫（viewer 本地道具，照 共用/环境预览.html 的做法，只为看颜色）---- */
const BLANKET = { x: 0.0, z: 0.0, w: 0.62, h: 0.44, lift: 0.006 };
function ginghamTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#F4F6F5'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = 'rgba(150,180,205,0.55)';
  for (let i = 0; i < 4; i++) x.fillRect(i * 32 + 18, 0, 14, 128);
  for (let i = 0; i < 4; i++) x.fillRect(0, i * 32 + 18, 128, 14);
  const d = x.getImageData(0, 0, 128, 128);
  x.putImageData(gradeImageData(d), 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.2, 1.5);
  return t;
}
function addBlanket() {
  const S = stage.envScale;
  stage.sand.addDent((BLANKET.x - 0.14) / S, BLANKET.z / S, 1.5, 0.08);
  stage.sand.addDent((BLANKET.x + 0.14) / S, BLANKET.z / S, 1.5, 0.08);
  const geo = new THREE.PlaneGeometry(BLANKET.w, BLANKET.h, 30, 22);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i), lz = pos.getZ(i);
    const vx = lx + BLANKET.x, vz = lz + BLANKET.z;
    const fold = Math.sin(vx * 17 + 1.3) * Math.sin(vz * 14 - 0.4) * 0.003 + Math.sin(vx * 9 - vz * 8) * 0.002;
    pos.setY(i, stage.sandY(vx, vz) + BLANKET.lift + fold);
  }
  geo.computeVertexNormals();
  const blanket = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: ginghamTexture(), roughness: 0.92, metalness: 0, flatShading: true,
  }));
  blanket.position.set(BLANKET.x, 0, BLANKET.z);
  blanket.userData.noSink = true;
  stage.world.add(blanket);
  return blanket;
}
function blanketY(x, z) {
  return stage.sandY(x, z) + BLANKET.lift + 0.002;
}

/* ---- 摆位 ---- */
const flowers = [];     // { obj, extras, node }
const SEED = 3;
let rs = SEED * 9301 + 49297;
const rnd = () => ((rs = (rs * 9301 + 49297) % 233280) / 233280);

// 「散落」：四枝向日葵随手躺在垫上（朝向各异，互相略叠），野花零星在垫外的沙上
const SCATTER = {
  sunflower_a:   { x: -0.10, z:  0.03, rot: 0.35 },
  sunflower_b:   { x:  0.06, z: -0.06, rot: -0.9 },
  sunflower_c:   { x:  0.12, z:  0.08, rot: 2.4 },
  sunflower_d:   { x: -0.16, z: -0.10, rot: 1.3 },
  sunflower_bud: { x:  0.20, z: -0.12, rot: -2.2 },
  primrose_a:    { x: -0.42, z:  0.16, rot: 0.4, sand: true },
  primrose_b:    { x:  0.44, z: -0.04, rot: 2.0, sand: true },
  bindweed_a:    { x:  0.30, z:  0.30, rot: 1.1, sand: true },
  bindweed_b:    { x: -0.46, z: -0.22, rot: -0.6, sand: true },
  mayweed_a:     { x: -0.22, z:  0.32, rot: 0.0, sand: true },
  mayweed_b:     { x:  0.48, z:  0.22, rot: 0.8, sand: true },
};
const ORDER = ['sunflower_a', 'sunflower_b', 'sunflower_c', 'sunflower_d', 'sunflower_bud',
               'primrose_a', 'primrose_b', 'bindweed_a', 'bindweed_b', 'mayweed_a', 'mayweed_b'];

function place(mode) {
  for (const { obj, extras } of flowers) {
    if (mode === 'scatter') {
      const p = SCATTER[obj.name];
      obj.rotation.set(0, p.rot, 0);
      obj.position.set(p.x, 0, p.z);
      if (p.sand) {
        // 野花长在沙里：用 stage 的陷沙（接触半径来自 extras）。
        // 坑要浅、还要整体抬一点：坑是碗形，碗沿比中心高，贴地的叶尖会被沙盖住（看起来像叶子破洞）
        stage.sink(obj, { radius: extras.contactRadius, depth: 0.025, lift: 0.0025 });
      } else {
        // 向日葵躺在垫上：贴布面，不陷沙，留一片软阴影
        obj.userData.noSink = true;
        obj.position.y = blanketY(p.x, p.z);
        const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: stage.blobTex, color: '#6E7A86', transparent: true, depthWrite: false, opacity: 0.5 }));
        blob.rotation.x = -Math.PI / 2;
        blob.rotation.z = -p.rot;
        blob.position.set(p.x, obj.position.y + 0.0015, p.z);
        blob.scale.set(extras.footprint[0] * 1.15, extras.footprint[1] * 1.5, 1);
        blob.userData.noSink = true;
        stage.world.add(blob);
      }
    } else {
      const k = ORDER.indexOf(obj.name);
      const row = k < 5 ? 0 : 1;
      const col = k < 5 ? k : k - 5;
      obj.rotation.set(0, row === 0 ? -Math.PI / 2 : 0, 0);
      obj.position.set(row === 0 ? -0.36 + col * 0.18 : -0.3 + col * 0.12, 0, row === 0 ? -0.22 : 0.14);
      stage.sink(obj, { radius: extras.contactRadius, depth: 0.025, lift: 0.0025 });
    }
    stage.world.add(obj);
  }
}

const label = document.getElementById('label');
new GLTFLoader().load('flowers.glb', gltf => {
  gltf.scene.traverse(o => { if (o.isMesh) o.material = getMaterial(o.material?.name || ''); });
  if (layout === 'scatter') addBlanket();
  for (const node of [...gltf.scene.children]) {
    const extras = node.userData;
    const obj = new THREE.Group();
    obj.name = node.name;
    obj.add(node);
    node.position.set(0, 0, 0);
    flowers.push({ obj, extras, node });
  }
  place(layout);
  const tris = flowers.reduce((n, s) => n + (s.extras.tris || 0), 0);
  const sun = flowers.filter(f => f.extras.kind === 'sunflower').length;
  label.textContent = `${flowers.length} 个变体 · 共 ${tris} 面 · 向日葵 ${sun} 枝 + 野花 3 种`;
  document.getElementById('loading')?.remove();
  window.__dbg = { flowers, cache, stage, THREE, ENV };
});

let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  refreshRim();
  stage.render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---- 面板（同贝壳）---- */
const ui = document.getElementById('panel');
const SLIDERS = [
  ['grain', '颗粒', 0, 60, 1], ['glow', '柔光', 0, 40, 1],
  ['exposure', '曝光', 0.6, 1.8, 0.01], ['shadow', '接触阴影', 0, 1, 0.02],
  ['softness', '影子软度', 0.5, 9, 0.25], ['dof', '景深', 0, 0.03, 0.001],
  ['rimPetal', '花瓣·边缘', 0, 40, 1], ['alphaPetal', '花瓣·不透明', 50, 100, 1],
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
  const go = l => { location.search = l === 'grid' ? '?layout=grid' : ''; };
  const bS = mk('散落', () => go('scatter'));
  const bQ = mk('排队', () => go('grid'));
  (layout === 'grid' ? bQ : bS).classList.add('on');
  mk('存图', () => window.captureAs(null));
  ui.appendChild(row2);
}

function setView(az, po, dist = null) {
  const c = stage.controls, t2 = c.target;
  const d = dist ?? stage.camera.position.distanceTo(t2);
  stage.camera.position.set(t2.x + d * Math.sin(po) * Math.sin(az),
                            t2.y + d * Math.cos(po),
                            t2.z + d * Math.sin(po) * Math.cos(az));
  c.update();
}
window.setView = setView;

window.captureAs = n => {
  stage.render(1 / 60);
  const name = n || `花_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  const data = canvas.toDataURL('image/png');
  fetch(`/save?dir=${encodeURIComponent('物件_花')}&name=${encodeURIComponent(name)}.png`, { method: 'POST', body: data })
    .then(r => { if (!r.ok) throw 0; })
    .catch(() => { const a = document.createElement('a'); a.download = name + '.png'; a.href = data; a.click(); });
};

addEventListener('keydown', e => {
  if (e.key === 'h' || e.key === 'H') ui?.classList.toggle('hidden');
});
