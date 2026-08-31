/* MacBook 屏幕上的欢迎语（2026-08-28）
 *
 * 屏幕上是 Iris 自己手写的两行：
 *   欢迎进入茫茫的灵质空间 / 请尽情探索这里的一切^^
 *
 * 墨迹是从她的手写稿里抠出来的**遮罩**（`内容/屏幕/欢迎_手写.png`：
 * RGB 全白、alpha = 墨迹浓度），不是直接贴原图。这样墨色在运行时才决定，
 * 换背景 / 换墨色 / 加投影都不用重新导图。
 * 重写文案：白底黑笔再写一张，跑一遍 `内容/屏幕/抠墨迹.py`。
 *
 * ⚠️ 两个坑（都踩过）：
 * 1. **屏幕面片的 UV 是上下颠倒的**（左右不反）。老的 tex/mb_screen.png 是照着这个
 *    反着画的（文件里草地在上、水在下），风景照看不出来，换成字一眼就倒了。
 *    修法 `flipY = false`；**别用 rotation = π**（那是同时翻 U 和 V，字会左右镜像）。
 *    量方向就画一张带角标的测试图贴上去看，比推理快得多。
 * 2. **CanvasTexture 必须在 canvas 定好尺寸之后再建**（沙滩系统_交接.md 5.2）。
 *
 * === 为什么这里有一套"自动定调"（autoTune） ===
 * 底图现在有十几张，深的浅的花的素的都有。要是每张都手配墨色 / 压带 / gain，
 * 加一张就得手调一轮，而且必然有几张调漏。
 * 所以背景画完之后**直接从画布上采样**：文字那条带子的平均亮度决定白字还是深墨，
 * 它的方差决定压带压多重，整张的平均亮度决定 gain。加新底图只要往 SCREEN_STYLES
 * 里加一行文件名，**一个参数都不用配**。配了的（textY / ink / gain…）就覆盖自动值。
 */
import * as THREE from 'three';
import { ENV } from '../constitution.js';

const W = 1024, H = 696;          // 屏幕面片是 512×348 的比例，这里 2 倍
const DIR = '../内容/屏幕/';
const INK_SRC = DIR + '欢迎_手写.png';

/* 屏幕风格。名字和顺序的唯一真相在 constitution.js 的 SCREEN_BGS（面板上显示它）。
 *   photo   —— 底图文件名（已裁成屏幕比例，见 内容/屏幕/裁底图.py）
 *   bg(x)   —— 程序化背景
 * 可选覆盖：textY（文字块中心，0~1）/ textW / ink / scrim / glow / gain。不写就自动定。 */
export const SCREEN_STYLES = [
  // **一个参数都没配** —— 墨色 / 压带 / gain / 文字放哪全靠 autoTune。
  // 加一张只要在这儿加一行（和 constitution.js 的 SCREEN_BGS 对上）。
  { name: '雪稿', photo: '底图_雪稿.jpg' },
  { name: '紫光', photo: '底图_紫光.jpg' },
  { name: '云稿', photo: '底图_云稿.jpg' },
];

/* 屏幕四周那圈很淡的暗角：真屏幕的边缘总比中间暗一点，
 * 没有这一下，贴图会读成"一张图"而不是"一块亮着的屏"。 */
function vignette(x) {
  const g = x.createRadialGradient(W / 2, H / 2, H * 0.30, W / 2, H / 2, H * 0.92);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(30,45,60,0.16)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
}

/* 采样一条横带的平均亮度和方差（0~255）。方差 = 这条带子有多"花"。 */
function bandStats(x, yc, h) {
  const y0 = Math.max(0, Math.round(yc * H - h / 2));
  const hh = Math.min(H - y0, Math.round(h));
  if (hh <= 0) return { mean: 128, sd: 0 };
  const d = x.getImageData(0, y0, W, hh).data;
  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) {        // 每 4 个像素采一个，够用
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    s += l; s2 += l * l; n++;
  }
  const mean = s / n;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

export function createWelcomeScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;               // 先定尺寸，再建贴图（踩过的坑）
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.flipY = false;                                 // 见文件头「坑 1」

  const style = () => SCREEN_STYLES[Math.round(ENV.screenBg ?? 0)] || SCREEN_STYLES[0];
  let gain = 1.0;                                    // autoTune 每次重画时更新

  let inkImg = null;
  const imgs = new Map();                            // 文件名 → Image（用到哪张加载哪张）
  const need = src => {
    if (imgs.has(src)) return imgs.get(src);
    imgs.set(src, null);
    const im = new Image();
    im.onload = () => { imgs.set(src, im); draw(); };
    im.src = encodeURI(DIR + src);
    return null;
  };
  const inkLoader = new Image();
  inkLoader.onload = () => { inkImg = inkLoader; draw(); };
  inkLoader.src = encodeURI(INK_SRC);

  function draw() {
    const s = style();
    const x = canvas.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, W, H);

    /* --- 背景 --- */
    if (s.photo) {
      x.fillStyle = '#D6DDE1'; x.fillRect(0, 0, W, H);            // 还没解码：先铺个底，别闪黑
      const im = need(s.photo);
      if (im) x.drawImage(im, 0, 0, W, H);                        // 已裁成屏幕比例，直接铺满
    } else {
      s.bg(x);
    }

    /* --- 自动定调：文字放哪、白字还是深墨、压多重、整体多亮 --- */
    const textH = W * (s.textW ?? 0.82) * (inkImg ? inkImg.height / inkImg.width : 0.29);
    let ty = s.textY;
    if (ty === undefined) {                          // 没指定就挑"更安静"的那条带子
      const up = bandStats(x, 0.22, textH), dn = bandStats(x, 0.80, textH);
      ty = up.sd <= dn.sd ? 0.22 : 0.80;
    }
    const band = bandStats(x, ty, textH);
    const whole = bandStats(x, 0.5, H);
    const light = band.mean > 150;                   // 底子亮 → 用深墨，白字会消失
    const ink = s.ink ?? (light ? '#37454F' : '#FFFFFF');
    const glow = s.glow ?? (light ? null : 'rgba(226,240,248,0.42)');
    const shadow = s.shadow ?? (light ? 'rgba(96,120,134,0.30)' : 'rgba(12,22,32,0.46)');
    // 压带：底子越花压得越重（sd 0→0.16，sd 60+→0.48）。程序化那三档是自己画的渐变，不压
    const scrim = s.scrim ?? (s.photo
      ? [light ? 'rgba(255,255,255,1)' : 'rgba(10,20,28,1)',
         Math.min(0.50, 0.16 + band.sd / 60 * 0.32)]
      : null);
    // gain：屏幕材质自发光、后面还有 bloom。把整张的平均亮度拉到 ~0.78，
    // 亮底不会烧成白纸，暗底也还"亮着"。夹在 0.82~1.30
    gain = s.gain ?? Math.max(0.82, Math.min(1.30, 0.78 * 255 / Math.max(1, whole.mean)));
    gain *= (ENV.screenLit ?? 100) / 100;          // 面板「壁纸亮度」：在自动值之上再手动压/提

    if (inkImg) {
      const w = W * (s.textW ?? 0.82), h = w * inkImg.height / inkImg.width;
      const dx = (W - w) / 2, dy = H * ty - h / 2;

      if (scrim) {                                   // 两头淡到 0，不留硬边
        const [c, a] = scrim;
        const pad = h * 0.55;
        const g = x.createLinearGradient(0, dy - pad, 0, dy + h + pad);
        const A = v => c.replace(/[\d.]+\)$/, v + ')');
        g.addColorStop(0, A(0)); g.addColorStop(0.5, A(a)); g.addColorStop(1, A(0));
        x.fillStyle = g; x.fillRect(0, dy - pad, W, h + pad * 2);
      }

      // 染色：把遮罩画进离屏 canvas，再用 source-in 刷成墨色
      const off = document.createElement('canvas');
      off.width = Math.ceil(w); off.height = Math.ceil(h);
      const ox = off.getContext('2d');
      ox.drawImage(inkImg, 0, 0, off.width, off.height);
      ox.globalCompositeOperation = 'source-in';
      ox.fillStyle = ink;
      ox.fillRect(0, 0, off.width, off.height);

      if (glow) {                                    // 深底上白字要一圈光，不然会"薄"
        x.save(); x.filter = 'blur(6px)'; x.globalAlpha = 0.7;
        x.drawImage(off, dx, dy); x.restore();
      }
      if (shadow) {                                  // 自己画的投影：柔、偏移小，保留手写的手感
        const sh = document.createElement('canvas');
        sh.width = off.width; sh.height = off.height;
        const sx = sh.getContext('2d');
        sx.drawImage(inkImg, 0, 0, sh.width, sh.height);
        sx.globalCompositeOperation = 'source-in';
        sx.fillStyle = shadow;
        sx.fillRect(0, 0, sh.width, sh.height);
        x.save(); x.filter = 'blur(3px)';
        x.drawImage(sh, dx + w * 0.006, dy + h * 0.014);
        x.restore();
      }
      x.drawImage(off, dx, dy);
    }
    vignette(x);
    tex.needsUpdate = true;
  }

  draw();
  return { tex, redraw: draw, gain: () => gain };
}
