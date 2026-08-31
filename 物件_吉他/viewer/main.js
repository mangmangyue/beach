/* 物件 · 吉他 —— 场景里的预览
 *
 * 和花 / 贝壳 / 设备一样：这里没有光照和后处理代码，只有摆位、接触阴影和热区。
 * **材质表在 ./材质表.js，和 调色台.html 共用同一份** —— 那边挑的颜色，
 * 这边刷新就是这个颜色（走 localStorage）。这是这个物件唯一的颜色来源。
 *
 * 一条和别的物件不一样的地方：**吉他是平放的，而且只有琴身着地**。
 * 面朝上的吉他，琴颈是悬空的（琴头背面离布面 1.7 cm，琴颈中段 6~7 cm）。
 * 所以接触阴影铺三片，深浅不一样 —— 见下面 blobShadow 那几行。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStage } from '../../共用/stage.js';
import { ENV, gradeImageData } from '../../共用/constitution.js';
import { loadPalette, createMaterials } from './材质表.js';

const canvas = document.getElementById('view');
const stage = createStage(canvas, {
  target: new THREE.Vector3(0.02, 0.07, 0.0),
  distance: 1.62,                       // 它是全场最大的物件，机位要退得比别的物件远
  polar: Math.PI / 2 - 0.44,
});

/* 材质：和调色台同一份表。glb 里的材质只带名字，颜色全在这儿。
 * stage.materials.solid() 没用上 —— 它默认还带着 v0.5 的 flatShading，
 * 而且调色台那边没有 stage，两边要用同一个构造函数才可能给出同一个颜色。 */
const palette = loadPalette();
const M = createMaterials(THREE, { texBase: 'tex/', palette });

/* ---- 一块格纹垫（viewer 本地道具，照 设备 / 花 的做法；真垫子归窗口 A）---- */
const BLANKET = { x: 0.0, z: 0.0, w: 1.52, h: 1.06, lift: 0.006 };
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
  t.repeat.set(5.4, 3.8);
  return t;
}
function addBlanket() {
  const S = stage.envScale;
  stage.sand.addDent((BLANKET.x - 0.36) / S, BLANKET.z / S, 3.4, 0.06);
  stage.sand.addDent((BLANKET.x + 0.36) / S, BLANKET.z / S, 3.4, 0.06);
  const geo = new THREE.PlaneGeometry(BLANKET.w, BLANKET.h, 40, 28);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i) + BLANKET.x, vz = pos.getZ(i) + BLANKET.z;
    const fold = Math.sin(vx * 11 + 1.3) * Math.sin(vz * 9 - 0.4) * 0.004
               + Math.sin(vx * 6 - vz * 5) * 0.0025;
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

function blobShadow(x, z, w, h, rot, opacity) {
  const b = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
    map: stage.blobTex, color: '#6E7A86', transparent: true, depthWrite: false, opacity,
  }));
  b.rotation.x = -Math.PI / 2;
  b.rotation.z = -rot;
  // 抬 6 mm：布面有 ±4 mm 的褶，贴太近影子会被布自己盖掉（第一版就是这样，看着像贴纸）
  b.position.set(x, blanketY(x, z) + 0.006, z);
  b.userData.noSink = true;
  b.userData.noBounds = true;
  stage.world.add(b);
  return b;
}

/* ---- 摆位 ----
 * 一把 1.03 m 的吉他躺在 1.9×1.4 m 的垫子上，占掉半边。斜着放（0.30 rad）
 * 有两个理由：① 正着放它把画面横着切成两半；② 斜着的时候**缺角和琴头同时在画面里**。
 * 真正摆哪儿归窗口 A，这只是我试出来的一个角度。 */
const YAW = 0.30;
const guitar = { obj: null, extras: null };

new GLTFLoader().load('guitar.glb', gltf => {
  addBlanket();
  const node = gltf.scene.children.find(o => o.name === 'guitar') || gltf.scene;
  node.traverse(o => {
    if (!o.isMesh) return;
    const n = o.material?.name || '';
    if (M.mats[n]) o.material = M.mats[n];
    if (o.name === 'guitar_pickguard') o.visible = !!palette._showPickguard;
  });
  const extras = node.userData;
  node.position.set(0, 0, 0);

  const obj = new THREE.Group();
  obj.name = 'guitar';
  obj.add(node);
  obj.rotation.set(0, YAW, 0);
  obj.userData.noSink = true;
  obj.position.set(0.02, blanketY(0.02, 0), 0.0);
  stage.world.add(obj);
  guitar.obj = obj; guitar.extras = extras;

  /* 影子分三片，因为**这把琴只有琴身着地**：
   *   琴身   —— 实的，压得住；
   *   琴颈   —— 悬空 6~7 cm，只能给一片很淡很散的；
   *   琴头   —— 只离布面 1.7 cm，比琴颈实一点，它是"另一个着地点"的暗示。
   * 一整条均匀的影子会让整把琴读成平贴在垫子上，那就不对了。 */
  obj.updateWorldMatrix(true, true);
  const at = p => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(node.matrixWorld);
  const b0 = at(extras.bodyCenter), n0 = at([-0.24, 0, 0]), h0 = at([-0.47, 0, 0]);
  blobShadow(b0.x, b0.z, 0.78, 0.70, YAW, 0.30);   // 环境遮蔽那一层，大而散
  blobShadow(b0.x, b0.z, 0.48, 0.44, YAW, 0.50);   // 真正的接触那一层，紧而实
  blobShadow(n0.x, n0.z, 0.58, 0.15, YAW, 0.16);
  blobShadow(h0.x, h0.z, 0.21, 0.15, YAW, 0.46);

  document.getElementById('label').textContent =
    `guitar · ${(extras.footprint[0] * 100).toFixed(1)} × ${(extras.footprint[1] * 100).toFixed(1)}`
    + ` × ${(extras.height * 100).toFixed(1)} cm · ${extras.tris} 面\n`
    + `琴颈离布面 ${(extras.neckClearance * 100).toFixed(1)} cm（面朝上放，只有琴身着地）`;
  document.getElementById('loading')?.remove();
  window.__dbg = { guitar, stage, THREE, M, palette };
});

/* ---- 热区：点吉他 → 播一段 Iris 自己弹的原创片段 ----
 * 音频还没接（阶段 1 的边界：不接真实音频）。这里只把热区留出来，
 * 接口按 PROJECT.md 的音频契约走 共用/audio.js —— 归窗口 D，不在这儿实现。 */
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const hitEl = document.getElementById('hit');
function onPlay() {
  hitEl.textContent = '▸ 点到吉他 —— 这里以后接 audio.sfx(\'guitar\') / 播原创片段';
  clearTimeout(hitEl._t);
  hitEl._t = setTimeout(() => { hitEl.textContent = ''; }, 2400);
}
addEventListener('pointerdown', e => {
  if (!guitar.obj) return;
  ptr.x = (e.clientX / innerWidth) * 2 - 1;
  ptr.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ptr, stage.camera);
  const names = guitar.extras.hotspot || [];
  const targets = [];
  guitar.obj.traverse(o => { if (o.isMesh && names.includes(o.name)) targets.push(o); });
  if (targets.length && ray.intersectObjects(targets, false).length) onPlay();
});

let last = performance.now();
(function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  stage.render(dt);
  requestAnimationFrame(loop);
})(last);

/* ---- 面板（同花 / 贝壳 / 设备）---- */
const ui = document.getElementById('panel');
const SLIDERS = [
  ['glow', '柔光', 0, 40, 1], ['exposure', '曝光', 0.6, 1.8, 0.01],
  ['shadow', '接触阴影', 0, 1, 0.02], ['softness', '影子软度', 0.5, 9, 0.25],
  ['dof', '景深', 0, 0.03, 0.001], ['bubbles', '泡泡', 0, 1, 1],
];
SLIDERS.forEach(([k, name, min, max, step]) => {
  const row = document.createElement('label');
  row.innerHTML = `<span>${name}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${stage.params[k]}"><b>${stage.params[k]}</b>`;
  const [inp, out] = [row.querySelector('input'), row.querySelector('b')];
  inp.oninput = () => { stage.params[k] = +inp.value; out.textContent = inp.value; stage.applyParams(); };
  ui.appendChild(row);
});
const views = document.createElement('div');
views.className = 'views';
[['正面', 0, 62], ['3/4', 28, 56], ['侧面', 76, 74], ['俯视', 8, 16],
 ['左 3/4', -32, 56], ['缺角', 18, 44]].forEach(([n, az, po]) => {
  const b = document.createElement('button');
  b.textContent = n;
  b.onclick = () => setView(az * Math.PI / 180, po * Math.PI / 180);
  views.appendChild(b);
});
ui.appendChild(views);
const row2 = document.createElement('div'); row2.className = 'views';
const mk = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.onclick = fn; row2.appendChild(b); };
mk('调色台', () => location.href = '../调色台.html');
mk('存图', () => window.captureAs(null));
ui.appendChild(row2);

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
  const name = n || `吉他_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  const data = canvas.toDataURL('image/png');
  return fetch(`/save?dir=${encodeURIComponent('物件_吉他')}&name=${encodeURIComponent(name)}.png`,
               { method: 'POST', body: data })
    .then(r => { if (!r.ok) throw 0; return 'ok'; })
    .catch(() => { const a = document.createElement('a'); a.download = name + '.png'; a.href = data; a.click(); return 'dl'; });
};

addEventListener('keydown', e => {
  if (e.key === 'h' || e.key === 'H') ui?.classList.toggle('hidden');
});
