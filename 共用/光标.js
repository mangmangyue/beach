/* 兔子光标（第二版，2026-08-30）。
 *
 * **头是程序画的固定形状**（照着产品实物照 鼠标状态/截屏2026-08-29 下午12.45.19.png：
 * 两只圆耳、中间一条深 U 槽、圆下巴），不再抠 Iris 的手绘 ——
 * 她画的是概念稿（每次画都不一样），表情从概念稿来，形状要固定。
 * 表情：默认点眼 / 悬停 >< （**静止**，Iris 定）/ 晕 = 🌀 眼**持续旋转**（六个相位帧循环，
 * 因为是程序画的所以真的能转）/ 睡 = 一字眼 + z→zz 逐渐浮现。
 *
 * 全部在启动时画进 64px canvas、缩到 32px 转 dataURL，走 CSS `cursor:url()` 换帧。
 * 不做 JS 假光标（慢一两帧的坑）。canvas 光标只有这一个写入方：
 * stage 拖拽走 setGrab，两处悬停检测走 setHover / setHoverAux。 */

const SIZE = 32, DRAW = 64;        // 画 64 缩 32，边缘有抗锯齿
const HOT = '16 8';                // 热点：两耳之间偏上，感觉是"头顶在点"

/* ---- 头的轮廓：**一条连续的对称贝塞尔路径**（照产品实物照）——
 * 宽扁的倒心形：耳外缘和脸颊是一笔连下来的弧，中间一条窄而深的圆底槽，
 * 下巴收窄成圆弧。⚠️ 别用"几个圆拼并集"——拼出来是米老鼠（第一版被 Iris 骂了）。 */
const INK = '#2E3138';
function bunnyPath(x) {
  // 对着产品照量的比例（第二版把槽画成窄缝被否了）：
  // 槽宽 ≈ 头宽 1/3、深到头高一半、圆底；耳粗壮近竖直；底部宽圆钝，不收尖
  x.beginPath();
  x.moveTo(32, 60);                                  // 底部中点（宽圆钝底）
  x.bezierCurveTo(17, 60, 6, 50, 6, 36);             // 左下大弧到脸颊最宽
  x.bezierCurveTo(6, 24, 6.5, 12, 10.5, 7.5);        // 左耳外缘，近竖直
  x.bezierCurveTo(13, 4.2, 20, 4.2, 22, 8);          // 左耳饱满圆顶
  x.bezierCurveTo(23.3, 10.5, 23.5, 14, 23.5, 18);   // 耳内缘下行（槽左壁上段）
  x.bezierCurveTo(23.5, 26, 25.5, 32.5, 32, 33);     // 槽左壁滑进宽圆底
  x.bezierCurveTo(38.5, 32.5, 40.5, 26, 40.5, 18);   // 宽圆底滑上槽右壁
  x.bezierCurveTo(40.5, 14, 40.7, 10.5, 42, 8);      // 槽右壁上段
  x.bezierCurveTo(44, 4.2, 51, 4.2, 53.5, 7.5);      // 右耳饱满圆顶
  x.bezierCurveTo(57.5, 12, 58, 24, 58, 36);         // 右耳外缘近竖直下来
  x.bezierCurveTo(58, 50, 47, 60, 32, 60);           // 右下大弧回底部
  x.closePath();
}
function makeFrame(face) {
  const big = document.createElement('canvas'); big.width = big.height = DRAW;
  const bx = big.getContext('2d');
  bunnyPath(bx);
  bx.fillStyle = '#FFFFFF'; bx.fill();
  bx.strokeStyle = INK; bx.lineWidth = 3; bx.lineJoin = bx.lineCap = 'round'; bx.stroke();
  bx.fillStyle = INK;
  face(bx);
  const out = document.createElement('canvas'); out.width = out.height = SIZE;
  out.getContext('2d').drawImage(big, 0, 0, SIZE, SIZE);
  return `url(${out.toDataURL('image/png')}) ${HOT}, auto`;
}
const EYE_L = [19, 35], EYE_R = [45, 35];   // 产品照的位置：槽底两侧、分得很开
function dots(x) {                              // 默认：点眼（产品照就是两颗大黑豆）
  for (const [ex, ey] of [EYE_L, EYE_R]) { x.beginPath(); x.arc(ex, ey, 4.2, 0, Math.PI * 2); x.fill(); }
}
function happy(x) {                             // 悬停：> <（静止，Iris 定：不要闪）
  x.lineWidth = 2.8;
  const [lx, ly] = EYE_L, [rx, ry] = EYE_R;
  x.beginPath(); x.moveTo(lx - 3.5, ly - 4); x.lineTo(lx + 3, ly); x.lineTo(lx - 3.5, ly + 4); x.stroke();
  x.beginPath(); x.moveTo(rx + 3.5, ry - 4); x.lineTo(rx - 3, ry); x.lineTo(rx + 3.5, ry + 4); x.stroke();
}
function spiral(x, phase) {                     // 晕：🌀，左右眼反向转，更晕
  // 64px 画完要缩到 32 —— 线宽给足 2.6，不然缩完糊成一颗灰点（第一版踩的）
  x.lineWidth = 2.6;
  for (const [ex, ey, dir] of [[...EYE_L, 1], [...EYE_R, -1]]) {
    x.beginPath();
    for (let t = 0; t <= 1.001; t += 0.04) {
      const a = dir * (phase + t * Math.PI * 2 * 1.6);
      const r = 0.6 + t * 5.2;
      const px = ex + Math.cos(a) * r, py = ey + Math.sin(a) * r;
      t === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
    }
    x.stroke();
  }
}
function asleep(zs) {                           // 睡：一字眼 + z 逐渐浮现
  return x => {
    x.lineWidth = 2.6;
    for (const [ex, ey] of [EYE_L, EYE_R]) { x.beginPath(); x.moveTo(ex - 4, ey); x.lineTo(ex + 4, ey); x.stroke(); }
    x.textBaseline = 'alphabetic';
    if (zs >= 1) { x.font = '700 11px -apple-system, sans-serif'; x.fillText('z', 50, 14); }
    if (zs >= 2) { x.font = '700 9px -apple-system, sans-serif'; x.fillText('z', 57, 7); }
  };
}

export function initBunnyCursor(canvas) {
  const F = {
    awake: makeFrame(dots),
    hover: makeFrame(happy),
    dizzy: Array.from({ length: 6 }, (_, i) => makeFrame(x => spiral(x, i / 6 * Math.PI * 2))),
    sleep: [makeFrame(asleep(0)), makeFrame(asleep(1)), makeFrame(asleep(2))],
  };
  let hover = false, hoverAux = false;   // 两路悬停：主 HOVER 表 / 猫·泡泡·相机那条
  let grab = '';                          // stage 拖拽：'' | 'grab' | 'grabbing'
  let dizzyUntil = 0;
  let lastActive = performance.now();
  let clicks = [];
  let lastCss = null;

  const SLEEP_AFTER = 15000;             // 15 秒不动 → 待机（原 30 秒 Iris 等不到）
  const set = css => { if (css !== lastCss) { lastCss = css; canvas.style.cursor = css; } };

  function tick() {
    const now = performance.now();
    if (now < dizzyUntil) {
      set(F.dizzy[Math.floor(now / 90) % 6]);                    // 🌀 一直在转
    } else if (now - lastActive > SLEEP_AFTER) {
      const t = (now - lastActive - SLEEP_AFTER) % 3000;          // z 浮现：0.7s → 0.7s → 停 1.6s
      set(F.sleep[t < 700 ? 0 : t < 1400 ? 1 : 2]);
    } else if (grab === 'grabbing' || hover || hoverAux || grab === 'grab') {
      set(F.hover);                                               // 静止的 ><（Iris：不要闪）
    } else {
      set(F.awake);
    }
  }
  const iv = setInterval(tick, 90);

  const wake = () => { lastActive = performance.now(); };
  canvas.addEventListener('pointermove', wake);
  canvas.addEventListener('pointerdown', () => {
    wake();
    const now = performance.now();
    clicks = clicks.filter(t => now - t < 1600);
    clicks.push(now);
    if (clicks.length >= 5) { dizzyUntil = now + 2200; clicks = []; }
  });
  tick();

  return {
    setHover(on) { hover = !!on; tick(); },
    setHoverAux(on) { hoverAux = !!on; tick(); },
    setGrab(kind) { grab = kind || ''; tick(); },
    dispose() { clearInterval(iv); set(''); },
  };
}
