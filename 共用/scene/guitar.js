/* 木吉他（物件_吉他/）：材质走那边的 材质表.js —— 调色台和场景必须给一模一样的颜色，
 * 所以这里不重复定义任何材质，palette 也照那边的规则读（localStorage 优先）。 */
import * as THREE from 'three';
import { loadGLB } from './util.js';
import { createMaterials, loadPalette, TOP_WOODS, BACK_WOODS } from '../../物件_吉他/viewer/材质表.js';
import { ENV } from '../constitution.js';

const GT = '../物件_吉他/viewer/';

export async function loadGuitar(stage) {
  const gltf = await loadGLB(GT + 'guitar.glb');
  const base = loadPalette();
  const { mats, apply } = createMaterials(THREE, { texBase: GT + 'tex/', palette: base });
  /* 面板「面板木色 / 背侧板木色」两个滑块：在 材质表.js 的 TOP_WOODS / BACK_WOODS 里各选一个。
   * **两边分开选**（Iris 2026-08-29：想要浅面板配某个侧板，整套换配不出来）。
   * ⚠️ 是**盖在**当前调色板上的（每条只写它管的那几个槽），
   *    所以调色台里存过的颜色不会被整个冲掉，只被这几个槽覆盖。 */
  const withLook = () => {
    const p = JSON.parse(JSON.stringify(base));
    const pick = (list, i) => list[Math.round(i ?? 0)] || list[0];
    for (const w of [pick(TOP_WOODS, ENV.gtTop), pick(BACK_WOODS, ENV.gtBack)])
      for (const [k, c] of Object.entries(w)) if (k !== 'name' && p[k]) p[k].color = c;
    return p;
  };
  apply(withLook());
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const m = mats[o.material?.name];
    if (m) o.material = m;
  });
  stage.onParams(() => apply(withLook()));   // 宪法全局参数变了，配色/rim/emis 跟着刷
  const node = gltf.scene.children.find(n => n.userData.kind === 'guitar') || gltf.scene.children[0];
  const extras = node.userData;
  node.position.set(0, 0, 0);
  const obj = new THREE.Group();
  obj.name = 'guitar';
  obj.add(node);
  obj.userData.noSink = true;
  // 默认藏起来的可选件（护板）
  (extras.optionalMeshes || []).forEach(n => obj.traverse(o => { if (o.name === n) o.visible = false; }));
  return { obj, extras, apply };
}
