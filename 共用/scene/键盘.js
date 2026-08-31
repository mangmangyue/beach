/* MacBook 的键盘面（2026-08-28 重画）
 *
 * 原来贴的是 `物件_设备/viewer/tex/mb_deck.png` —— 一张 **Windows 键盘**
 * （Ctrl / Alt / Win 键、独立 F 行），而且字号偏大，凑近看很笨拙。
 * Iris：「我是 MacBook 的键盘不是 windows 的键盘，最好做成有个 touchbar 的那个版本」。
 *
 * 现在整块面是**运行时画出来的**，不是图片：
 *   - 带 Touch Bar 的那代 MacBook Pro（没有实体 F 行，右端是 Touch ID）
 *   - 字号收到键帽高度的 34%（原来接近 60%，所以显得笨）
 *   - S 键上贴一张 Stanford 的贴纸
 * 画出来的好处：键位、字号、贴纸都能改，不用回去 P 图。
 *
 * ⚠️ 方向：键盘面的 UV 和屏幕一样是**上下颠倒**的，所以贴图 `flipY = false`，
 *    然后**正常画**就行 —— 画布顶 = 转轴那头（Touch Bar 在这儿），
 *    画布底 = 靠近人的那头（触控板在这儿），左右不反。
 *    这是拿一张带角标的测试图贴上去量出来的，别凭感觉推。
 */
import * as THREE from 'three';
import { ENV } from '../constitution.js';

export const LIT_MIN = 30, LIT_MAX = 180;   // 亮度轨道两端对应的 ENV.screenLit

/* 喇叭画成有声还是静音。真状态在 audio 里，这儿只是一份给画图看的镜像。
 * ⚠️ 别塞进 ENV —— 面板的「复制参数 JSON」是遍历 Object.keys(ENV) 导出的，
 *    塞进去会把一个纯运行时状态写进宪法里。 */
let _muted = false;
export function setSoundMuted(v) { _muted = !!v; }

const W = 1024, H = 724;               // 原图是 512×362，这里 2 倍

/* Touch Bar 上两个**真的能用**的控件，画完之后把它们在贴图里的位置记下来 ——
 * 点击路由拿 `hit.uv` 和这里比一下就知道点到哪个了（见 环境预览.html 的 deckHit）。
 * ⚠️ 贴图是 flipY = false，所以 uv.v 直接就是「画布 y / H」，不用翻。
 * 单位是 0~1 的 uv：{ x0, y0, x1, y1 }。 */
export const TOUCHBAR = { sun: null, sound: null, track: null };

/* 一行 14.5 个单位宽 —— 这是真 MacBook 的排法。
 * 每项 [标签, 宽度(单位), 小字?]；小字用于 esc/tab/caps 这些名字键。 */
const ROWS = [
  [['`~', 1], ['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1], ['6', 1], ['7', 1],
   ['8', 1], ['9', 1], ['0', 1], ['-', 1], ['=', 1], ['delete', 1.5, 1]],
  [['tab', 1.5, 1], ['Q', 1], ['W', 1], ['E', 1], ['R', 1], ['T', 1], ['Y', 1], ['U', 1],
   ['I', 1], ['O', 1], ['P', 1], ['[', 1], [']', 1], ['\\', 1]],
  [['caps', 1.75, 1], ['A', 1], ['S', 1], ['D', 1], ['F', 1], ['G', 1], ['H', 1], ['J', 1],
   ['K', 1], ['L', 1], [';', 1], ["'", 1], ['return', 1.75, 1]],
  [['shift', 2.25, 1], ['Z', 1], ['X', 1], ['C', 1], ['V', 1], ['B', 1], ['N', 1], ['M', 1],
   [',', 1], ['.', 1], ['/', 1], ['shift', 2.25, 1]],
  // 底行用符号不用单词：'command' 在 1.25 单位宽的键帽上一定溢出（第一版就溢了）。
  // 真机上这几个键本来也是符号在上、单词在下，这个尺寸下只画符号更干净
  [['fn', 1, 1], ['⌃', 1], ['⌥', 1], ['⌘', 1.25], [' ', 5],
   ['⌘', 1.25], ['⌥', 1], ['◀', 1], ['↕', 1], ['▶', 1]],
];
const UNITS = 14.5;

const rr = (x, w, h, r) => { x.beginPath(); x.roundRect ? null : 0; };
function roundRect(x, X, Y, Wd, Ht, R) {
  const r = Math.min(R, Wd / 2, Ht / 2);
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + Wd, Y, X + Wd, Y + Ht, r);
  x.arcTo(X + Wd, Y + Ht, X, Y + Ht, r);
  x.arcTo(X, Y + Ht, X, Y, r);
  x.arcTo(X, Y, X + Wd, Y, r);
  x.closePath();
}

/* Stanford 的键盘贴纸，贴在 S 键上。
 *
 * **优先用真的 logo 图**：把一张透明底的 PNG 放到 `内容/屏幕/贴纸_stanford.png`，
 * 这儿会自动用它（加载完重画一次）。没有那张图就退回画一个卡红底白 S ——
 * 所以缺图也不会开天窗，补上图也不用改代码。
 *
 * 真贴纸是贴在键帽上的一小片，所以画得比键帽小一圈、还带一点点旋转，像手贴上去的。 */
const STICKER_SRC = '../内容/屏幕/贴纸_stanford.png';
let stickerImg = null, stickerTried = false;
function loadSticker(onReady) {
  if (stickerTried) return stickerImg;
  stickerTried = true;
  const im = new Image();
  im.onload = () => { stickerImg = im; onReady?.(); };
  im.src = encodeURI(STICKER_SRC);
  return null;
}
function stanfordSticker(x, kx, ky, kw, kh) {
  const w = kw * 0.86, h = kh * 0.86;
  x.save();
  x.translate(kx + kw / 2, ky + kh / 2);
  x.rotate(-0.06);
  if (stickerImg) {
    // 按图自己的比例摆进键帽里（logo 是竖长的，别拉变形）
    const s = Math.min(w / stickerImg.width, h / stickerImg.height);
    const dw = stickerImg.width * s, dh = stickerImg.height * s;
    x.drawImage(stickerImg, -dw / 2, -dh / 2, dw, dh);
  } else {
    roundRect(x, -w / 2, -h / 2, w, h, w * 0.22);
    x.fillStyle = '#8C1515';                   // Stanford Cardinal
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = Math.max(1, w * 0.04); x.stroke();
    x.fillStyle = '#fff';
    x.font = '600 ' + (h * 0.62).toFixed(1) + 'px "Helvetica Neue", Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('S', 0, h * 0.03);
  }
  x.restore();
}

export function createDeckTexture({ stanfordOnS = true } = {}) {
  let redraw = null;
  if (stanfordOnS) loadSticker(() => redraw?.());   // 图回来了就整块重画一次
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');

  function paint() {
  x.clearRect(0, 0, W, H);
  x.textAlign = 'center'; x.textBaseline = 'middle';

  // --- 整块面：银色，靠近转轴那头稍暗一点点 ---
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#C9CFD5'); g.addColorStop(0.35, '#DDE2E6'); g.addColorStop(1, '#D3D9DE');
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  // --- 键盘区（画布上半）---
  const padX = W * 0.055;
  const kbW = W - padX * 2;
  const u = kbW / UNITS;                       // 一个键位单位
  const gap = u * 0.085;
  const rowH = u * 0.92;
  const tbH = u * 0.52;                        // Touch Bar 比键帽矮
  const top = H * 0.045;

  // 键盘底槽：整块比面板深一点，像真机那块凹进去的区域
  roundRect(x, padX - u * 0.16, top - u * 0.16, kbW + u * 0.32,
            tbH + rowH * ROWS.length + gap * ROWS.length + u * 0.32, u * 0.16);
  x.fillStyle = '#B8BEC5'; x.fill();

  // --- Touch Bar：一条很暗的窄条，右端是 Touch ID ---
  const tidW = u * 0.92;
  roundRect(x, padX, top, kbW - tidW - gap, tbH, tbH * 0.22);
  x.fillStyle = '#20242A'; x.fill();
  /* Touch Bar 上放两个**真的能用**的控件（原来那几个灰方块只是"意思到了"，没有意义，删了）：
   *   左边  ☀ + 一条轨道 = 屏幕亮度（ENV.screenLit），点轨道上任意位置就设到那个值
   *   右边  🔊 = 声音总开关（audio.mute），点一下切
   * 位置在下面记进 TOUCHBAR，点击路由靠它认。 */
  const cy = top + tbH / 2;
  // ── 太阳（亮度）
  const sunR = tbH * 0.30, sunX = padX + u * 0.42;
  x.save();
  x.strokeStyle = '#D9E2EC'; x.lineWidth = Math.max(1.2, tbH * 0.055);
  x.beginPath(); x.arc(sunX, cy, sunR * 0.52, 0, Math.PI * 2); x.stroke();
  for (let i = 0; i < 8; i++) {                     // 八条光芒
    const a = i * Math.PI / 4;
    x.beginPath();
    x.moveTo(sunX + Math.cos(a) * sunR * 0.78, cy + Math.sin(a) * sunR * 0.78);
    x.lineTo(sunX + Math.cos(a) * sunR * 1.06, cy + Math.sin(a) * sunR * 1.06);
    x.stroke();
  }
  x.restore();
  // ── 亮度轨道：底槽 + 已填部分（填到当前亮度）
  const trkX = sunX + sunR * 1.5, trkW = u * 3.6, trkH = tbH * 0.26;
  roundRect(x, trkX, cy - trkH / 2, trkW, trkH, trkH / 2);
  x.fillStyle = '#454C55'; x.fill();
  const lit = Math.max(0, Math.min(1, ((ENV.screenLit ?? 100) - LIT_MIN) / (LIT_MAX - LIT_MIN)));
  roundRect(x, trkX, cy - trkH / 2, Math.max(trkH, trkW * lit), trkH, trkH / 2);
  x.fillStyle = '#E8EEF4'; x.fill();
  // ── 喇叭（声音开关）
  const spX = trkX + trkW + u * 0.75, spR = tbH * 0.30;
  x.save();
  x.fillStyle = _muted ? '#6C7480' : '#E8EEF4';
  x.strokeStyle = x.fillStyle; x.lineWidth = Math.max(1.2, tbH * 0.055);
  x.beginPath();                                    // 喇叭本体
  x.moveTo(spX - spR * 0.55, cy - spR * 0.26);
  x.lineTo(spX - spR * 0.18, cy - spR * 0.26);
  x.lineTo(spX + spR * 0.28, cy - spR * 0.72);
  x.lineTo(spX + spR * 0.28, cy + spR * 0.72);
  x.lineTo(spX - spR * 0.18, cy + spR * 0.26);
  x.lineTo(spX - spR * 0.55, cy + spR * 0.26);
  x.closePath(); x.fill();
  if (_muted) {                                     // 静音：一道斜杠
    x.beginPath();
    x.moveTo(spX + spR * 0.50, cy - spR * 0.50);
    x.lineTo(spX + spR * 1.00, cy + spR * 0.50);
    x.stroke();
  } else {                                          // 有声：两道弧
    for (const k of [0.62, 0.95]) {
      x.beginPath(); x.arc(spX + spR * 0.30, cy, spR * k, -0.85, 0.85); x.stroke();
    }
  }
  x.restore();
  // 记下这三块在 uv 里的位置（flipY=false，所以 v 就是 y/H）
  const box = (x0, y0, x1, y1) => ({ x0: x0 / W, y0: y0 / H, x1: x1 / W, y1: y1 / H });
  TOUCHBAR.sun = box(sunX - sunR * 1.3, top, sunX + sunR * 1.3, top + tbH);
  TOUCHBAR.track = box(trkX, top, trkX + trkW, top + tbH);
  TOUCHBAR.sound = box(spX - spR * 1.2, top, spX + spR * 1.4, top + tbH);
  // Touch ID
  roundRect(x, padX + kbW - tidW, top, tidW, tbH, tbH * 0.22);
  x.fillStyle = '#2A2F36'; x.fill();
  x.beginPath();
  x.arc(padX + kbW - tidW / 2, top + tbH / 2, tbH * 0.26, 0, Math.PI * 2);
  x.fillStyle = '#3C434C'; x.fill();

  // --- 键帽 ---
  let y = top + tbH + gap;
  ROWS.forEach((row, ri) => {
    let cx = padX;
    for (const [label, wu, small] of row) {
      const kw = u * wu - gap, kh = rowH - gap;
      roundRect(x, cx, y, kw, kh, u * 0.16);
      // 键帽：上浅下深一点点，边上一圈更深 —— 不画高光，这个尺寸下高光只会变脏
      const kg = x.createLinearGradient(0, y, 0, y + kh);
      kg.addColorStop(0, '#3B4149'); kg.addColorStop(1, '#2B3037');
      x.fillStyle = kg; x.fill();
      x.strokeStyle = 'rgba(12,15,19,.55)'; x.lineWidth = Math.max(1, u * 0.03); x.stroke();

      const isS = label === 'S';
      if (isS && stanfordOnS) {
        stanfordSticker(x, cx, y, kw, kh);
      } else if (label.trim()) {
        // 字号收到键帽高的 34%（名字键再小一档）—— 原来那张图接近 60%，所以显得笨
        const fs = kh * (small ? 0.26 : 0.34);
        x.font = (small ? '500 ' : '400 ') + fs.toFixed(1) + 'px "Helvetica Neue", Arial, sans-serif';
        x.fillStyle = '#D8DDE3';
        if (small && wu > 1.4) {          // 只有真的宽的名字键才靠边（1.25 的还是居中）
          // 名字键的字靠一边，像真键盘（delete/return 靠右，其余靠左）
          const right = label === 'delete' || label === 'return';
          x.textAlign = right ? 'right' : 'left';
          x.fillText(label, right ? cx + kw - kw * 0.14 : cx + kw * 0.14, y + kh / 2);
          x.textAlign = 'center';
        } else if (label === '↕') {
          // 上下方向键是上下叠在一起的半高键
          x.font = (fs * 0.7).toFixed(1) + 'px "Helvetica Neue", Arial, sans-serif';
          x.fillText('▲', cx + kw / 2, y + kh * 0.29);
          x.fillText('▼', cx + kw / 2, y + kh * 0.72);
          x.strokeStyle = 'rgba(12,15,19,.45)';
          x.beginPath(); x.moveTo(cx, y + kh / 2); x.lineTo(cx + kw, y + kh / 2); x.stroke();
        } else if (label.length === 2 && ri === 0) {
          // 数字行那些双字符键（`~ 之类）上下排
          x.font = (fs * 0.72).toFixed(1) + 'px "Helvetica Neue", Arial, sans-serif';
          x.fillText(label[1], cx + kw / 2, y + kh * 0.32);
          x.fillText(label[0], cx + kw / 2, y + kh * 0.70);
        } else {
          x.fillText(label, cx + kw / 2, y + kh / 2);
        }
      }
      cx += u * wu;
    }
    y += rowH;
  });

  // --- 触控板（画布下半 = 靠近人的那头）---
  const tpW = W * 0.40, tpH = H * 0.245;
  const tpX = (W - tpW) / 2, tpY = H * 0.665;
  roundRect(x, tpX, tpY, tpW, tpH, W * 0.012);
  x.fillStyle = '#CDD3D9'; x.fill();
  x.strokeStyle = 'rgba(120,130,142,.55)'; x.lineWidth = 2; x.stroke();
  // 一点点很淡的竖向渐变，让它不是一块死板的灰
  const tg = x.createLinearGradient(0, tpY, 0, tpY + tpH);
  tg.addColorStop(0, 'rgba(255,255,255,.20)'); tg.addColorStop(1, 'rgba(255,255,255,0)');
  roundRect(x, tpX, tpY, tpW, tpH, W * 0.012);
  x.fillStyle = tg; x.fill();
  }
  paint();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.flipY = false;            // 见文件头「方向」
  // canvas 尺寸一开始就定死了，所以贴纸图解码回来只要重画 + needsUpdate
  redraw = () => { paint(); tex.needsUpdate = true; };
  tex.userData.redraw = redraw;      // Touch Bar 被点了之后要重画（轨道/喇叭要跟着变）
  return tex;
}
