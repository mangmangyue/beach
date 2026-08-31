/* 杯口那片橙子（2026-08-29 重做）
 *
 * 原来用的是 glb 里那片 + 一张 128×128 的贴图，两个毛病：
 *   1. 卡口是个**矩形槽**，比杯壁厚得多 —— 正面看槽里两边各一条空隙，很假。
 *      Iris 的说法是对的：「本来是一个圆，再把和杯子重叠的部分挖掉」，
 *      所以缺口应该是一条**极窄的缝**，不是一个方口。
 *   2. 128px 的贴图凑近看全是锯齿，而且果肉是一块平涂，没有"透"的层次。
 *
 * 现在几何和贴图都是**算出来的**：
 *   几何 = 一个圆 − 一条极窄的径向缝（缝宽可调，出厂 2.2°），带一点点厚度
 *   贴图 = 果瓣 + 瓣间的白络 + 外皮 + 果肉里的细颗粒（512²，凑近也不糊）
 * 顺带把"透光"做对：白络和果肉的透光率不一样 —— 缝隙比果肉更透，
 * 这是柑橘片背光时最认得出来的那个层次（alpha 通道就是干这个的）。
 */
import * as THREE from 'three';

const SEG = 10;                  // 果瓣数

/* 果肉贴图。RGB = 颜色，**alpha = 透光率** —— 材质用它当 alphaMap，
 * 于是白络那几条比果肉更透，背光时能看见后面的东西透过缝隙。 */
export function makeOrangeTexture(px = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const x = c.getContext('2d');
  const R = px / 2, cx = R, cy = R;
  x.clearRect(0, 0, px, px);

  // 外皮
  x.beginPath(); x.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
  x.fillStyle = '#F2A03C'; x.fill();
  // 白络（内果皮）：外皮里面那圈
  x.beginPath(); x.arc(cx, cy, R * 0.90, 0, Math.PI * 2);
  x.fillStyle = '#FDF3DE'; x.fill();

  /* 果瓣：每瓣之间留一条缝，缝里露出白络。
   * ⚠️ 中心别给太亮 —— 这张图同时当 emissiveMap，中心一亮、十条白络又都汇到那儿，
   *    叠起来直接过曝成一颗星（第一版就是这样，凑近看杯口是一团白光）。
   *    所以中心只比外圈亮一点点，瓣的起点也从中心往外挪一截。 */
  for (let i = 0; i < SEG; i++) {
    const a0 = i / SEG * Math.PI * 2 + 0.026;
    const a1 = (i + 1) / SEG * Math.PI * 2 - 0.026;
    const g = x.createRadialGradient(cx, cy, R * 0.06, cx, cy, R * 0.86);
    g.addColorStop(0, '#FDC878'); g.addColorStop(0.55, '#FBB456'); g.addColorStop(1, '#F59A34');
    x.beginPath();
    x.moveTo(cx + Math.cos(a0) * R * 0.10, cy + Math.sin(a0) * R * 0.10);
    x.arc(cx, cy, R * 0.855, a0, a1);
    x.closePath();
    x.fillStyle = g; x.fill();
    // 瓣里的汁胞：一排细长的纹，让果肉不是一块平涂
    x.save(); x.clip();
    for (let k = 0; k < 26; k++) {
      const a = a0 + (a1 - a0) * ((k + 0.5) / 26);
      const r0 = R * (0.13 + 0.05 * ((k * 7919) % 13) / 13);
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      x.lineTo(cx + Math.cos(a) * R * 0.845, cy + Math.sin(a) * R * 0.845);
      x.strokeStyle = 'rgba(255,238,200,' + (0.07 + 0.08 * ((k * 104729) % 7) / 7).toFixed(3) + ')';
      x.lineWidth = R * 0.012; x.stroke();
    }
    x.restore();
  }
  // 中心那一小团芯（不是纯白，见上面那条）
  x.beginPath(); x.arc(cx, cy, R * 0.085, 0, Math.PI * 2);
  x.fillStyle = '#F7DFBE'; x.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* 透光率贴图：白络/缝隙更透，果肉次之，外皮几乎不透。
 * 单独画一张灰度图，比从颜色图里猜靠谱。 */
export function makeOrangeAlpha(px = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const x = c.getContext('2d');
  const R = px / 2, cx = R, cy = R;
  x.fillStyle = '#000'; x.fillRect(0, 0, px, px);
  x.beginPath(); x.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
  x.fillStyle = '#E8E8E8'; x.fill();                       // 外皮：厚，最不透 → alpha 高
  x.beginPath(); x.arc(cx, cy, R * 0.90, 0, Math.PI * 2);
  x.fillStyle = '#9A9A9A'; x.fill();                       // 白络：薄，透
  for (let i = 0; i < SEG; i++) {
    const a0 = i / SEG * Math.PI * 2 + 0.035;
    const a1 = (i + 1) / SEG * Math.PI * 2 - 0.035;
    x.beginPath();
    x.moveTo(cx, cy); x.arc(cx, cy, R * 0.855, a0, a1); x.closePath();
    x.fillStyle = '#C4C4C4'; x.fill();                     // 果肉：介于两者之间
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;                       // 遮罩不是颜色，别做 sRGB 变换
  return t;
}

/* 一个圆 − 一条极窄的径向缝，带一点厚度。缝口朝**局部 -Y**（挂上去的时候朝下）。 */
export function makeSliceGeometry(radius, thickness, slitDeg = 2.2, seg = 128) {
  const half = slitDeg * Math.PI / 360;
  const a0 = -Math.PI / 2 + half;                 // 从缝的一侧起
  const a1 = a0 + Math.PI * 2 - half * 2;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.lineTo(Math.cos(a0) * radius, Math.sin(a0) * radius);
  sh.absarc(0, 0, radius, a0, a1, false);
  sh.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: thickness, bevelEnabled: false, curveSegments: seg });
  geo.translate(0, 0, -thickness / 2);
  // UV 自己写：ExtrudeGeometry 默认那套是按世界 xy 铺的，尺寸一变贴图就跟着跑
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / (radius * 2) + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / (radius * 2) + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}
