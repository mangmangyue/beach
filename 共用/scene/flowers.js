/* 花：向日葵躺在垫子上（不陷沙），海边野花零星撒在沙上（浅坑 + 抬 2.5mm）。
 * 材质表照 物件_花/viewer/main.js；踩过的坑见那边说明.md。 */
import * as THREE from 'three';
import { rng, addRim, loadTexRaw, loadGLB, blobShadow, bbox } from './util.js';

const FL = '../物件_花/viewer/';
const MATS = {
  M_SunPetal:   { petal: true, map: 'tex/sun_petal.png' },
  M_SunDisc:    { color: '#FFFFFF', rough: 0.62, map: 'tex/sun_disc.png', emis: 0.22, emisC: '#7A4A24' },
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
const EMISSIVE = 0.08;

export async function loadFlowers(stage, { seed = 23, blanketTop, inBlanket, sunflowers = 4, wild = 9, sunSpots = [] } = {}) {
  const gltf = await loadGLB(FL + 'flowers.glb');
  const r = rng(seed);
  const cache = new Map();
  const getMaterial = name => {
    if (cache.has(name)) return cache.get(name);
    const s = MATS[name] || { color: '#CCCCCC', rough: 0.5 };
    let m;
    if (s.petal) {
      m = stage.materials.ice('petal', { color: s.color || null, map: s.map ? loadTexRaw(FL + s.map) : null });
      if (s.map) m.uniforms.uUseMap.value = 1;
    } else {
      m = stage.materials.solid(s.color, { rough: s.rough, raw: true });
      m.side = THREE.DoubleSide;
      m.emissive = new THREE.Color(s.emisC || (s.map ? '#FFFFFF' : s.color));
      m.emissiveIntensity = s.emis ?? EMISSIVE;
      if (s.map) m.map = loadTexRaw(FL + s.map, () => { m.needsUpdate = true; });
      addRim(m);
    }
    cache.set(name, m);
    return m;
  };
  gltf.scene.traverse(o => { if (o.isMesh) o.material = getMaterial(o.material?.name || ''); });
  const variants = [...gltf.scene.children];
  const wrap = node => { const g = new THREE.Group(); g.name = node.name; g.add(node); node.position.set(0, 0, 0); return g; };

  // 向日葵：三五枝，散在垫子的空处（位置由调用方给）
  const suns = variants.filter(v => v.userData.kind === 'sunflower');
  const sunOrder = ['sunflower_a', 'sunflower_c', 'sunflower_b', 'sunflower_bud', 'sunflower_d'];
  const placedSun = [];
  const spotsSun = sunSpots;
  for (let i = 0; i < Math.min(sunflowers, spotsSun.length); i++) {
    const node = suns.find(v => v.name === sunOrder[i % sunOrder.length]) || suns[i % suns.length];
    const obj = wrap(node.clone());
    const sp = spotsSun[i];
    obj.rotation.y = sp.rot ?? r() * Math.PI * 2;
    obj.position.set(sp.x, 0, sp.z);
    obj.userData.noSink = true;
    stage.world.add(obj);
    const b = bbox(obj);
    const y = blanketTop(sp.x, sp.z) + 0.002;
    obj.position.y += y - b.min.y;
    const sz = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    const shadow = blobShadow(stage, (b.min.x + b.max.x) / 2, y + 0.0012, (b.min.z + b.max.z) / 2, sz * 0.9, 0.22);
    stage.world.add(shadow);
    placedSun.push({ obj, shadow, spot: sp });
  }
  // 野花：撒在沙上，贴着贝壳那个圈，避开垫子
  const wilds = variants.filter(v => v.userData.place === 'sand');
  const placedWild = [];
  let tries = 0;
  while (placedWild.length < wild && tries++ < 200) {
    const a = r() * Math.PI * 2, d = 0.9 + r() * 0.7;
    const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.85;
    if (inBlanket && inBlanket(x, z)) continue;
    const node = r.pick(wilds);
    const obj = wrap(node.clone());
    obj.position.set(x, 0, z);
    obj.rotation.y = r() * Math.PI * 2;
    stage.sink(obj, { radius: node.userData.contactRadius, depth: 0.025, lift: 0.0025, bake: true });
    stage.world.add(obj);
    placedWild.push(obj);
  }
  return { sunflowers: placedSun, wild: placedWild };
}
