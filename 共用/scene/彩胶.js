/* 透明彩胶（2026-08-29，Iris：「黑胶直接做成透明彩胶试试」）
 *
 * 彩胶比黑胶难在哪：黑胶是"一块深色 + 一张沟槽图"就成立；
 * 彩胶要同时立住三件事 ——
 *   1. **糖果色的半透明**：透光率不是一个数，是随半径变的
 *      （沟槽区更实、曲目分隔那圈最透最亮、盘边有一圈实的"墙"）
 *   2. **同心沟槽**：明暗和实度一起波动，转起来纹理是旋转对称的所以不跳
 *   3. **压盘的云纹**：真彩胶的料混不匀，有一点大理石般的浓淡 ——
 *      它长在料里，跟着盘转是**物理正确**的（高光才不许转，所以高光交给环境反射）
 * 所以这张图不走"底图 + 调色"，整个盘体**逐像素算**：RGB = 色，alpha = 实度。
 * 标签和中心孔不在这里画（环境预览 redrawRecord 统一叠，和黑胶共用那段）。
 *
 * 用法：drawVinylBody(ctx, N, { tint, alpha, groove, labelR }) 只画盘体；
 *      tint 用 vinylTint() 算（封面取色 pickCoverColor + 糖果化）。
 */

/* ---- 小工具：hex/hsl 互转（constitution 没导出，这里留一份局部的） ---- */
export function hex2hsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [h, s * 100, l * 100];
}
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let t;
  if (h < 60) t = [c, x, 0]; else if (h < 120) t = [x, c, 0]; else if (h < 180) t = [0, c, x];
  else if (h < 240) t = [0, x, c]; else if (h < 300) t = [x, 0, c]; else t = [c, 0, x];
  return [(t[0] + m) * 255, (t[1] + m) * 255, (t[2] + m) * 255];
}
const hsl2hex = (h, s, l) => '#' + hsl2rgb(h, s, l)
  .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/* ---- 封面取色：主导的**鲜艳**色，不是平均色 ----
 * 平均色几乎总是灰的（封面什么颜色都有，一平均就浊）。
 * 做法：按色相分 24 档投票，票的权重 = 饱和度 ×（离中明度多近），
 * 灰/过暗/过亮的像素不投票；赢的那档内部再做加权平均。
 * 色相是环形的，平均要走向量（cos/sin 累加），不然 350° 和 10° 平均成 180°。
 * 返回 [h, s, l]；整张封面都是灰的就返回 null（回落到手动色）。 */
export function pickCoverColor(img) {
  const N = 32;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, N, N);
  let d;
  try { d = x.getImageData(0, 0, N, N).data; } catch { return null; }
  const BINS = 24, W = new Float32Array(BINS),
    X = new Float32Array(BINS), Y = new Float32Array(BINS),
    S = new Float32Array(BINS), L = new Float32Array(BINS);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn;
    const l = (mx + mn) / 2 * 100;
    if (!dd || l < 10 || l > 92) continue;
    const s = dd / (1 - Math.abs(l / 50 - 1)) * 100;
    if (s < 15) continue;
    let h;
    if (mx === r) h = ((g - b) / dd + 6) % 6;
    else if (mx === g) h = (b - r) / dd + 2;
    else h = (r - g) / dd + 4;
    h *= 60;
    const w = Math.pow(s / 100, 1.4) * Math.max(0, 1 - Math.abs(l - 50) / 60);
    const bi = Math.floor(h / 360 * BINS) % BINS, a = h * Math.PI / 180;
    W[bi] += w; X[bi] += w * Math.cos(a); Y[bi] += w * Math.sin(a);
    S[bi] += w * s; L[bi] += w * l;
  }
  let best = 0;
  for (let i = 1; i < BINS; i++) if (W[i] > W[best]) best = i;
  if (W[best] < 0.5) return null;
  const h = (Math.atan2(Y[best], X[best]) * 180 / Math.PI + 360) % 360;
  return [h, S[best] / W[best], L[best] / W[best]];
}

/* ---- 彩胶色 → { hex, rim } ----
 * 第三轮定稿（08-29）：颜色**逐张手选**（albums.js 的 vinyl 字段），写什么色就是什么色，
 * 不再自动取色、不再糖果化 —— 早先的封面提取（pickCoverColor）和糖果化路径已删，
 * pickCoverColor 本体留着（上面），以后加新专辑想先自动出个底色可以用。
 * rim 是边缘透光用的亮一档同色。 */
export function vinylTint(hex) {
  const [h, s, l] = hex2hsl(hex);
  /* 边缘光：暗色胶提亮 26 档没问题；**浅色胶再提就顶到白**，
   * 整张盘像在发光（nujabes 浅黄踩的）—— 浅色反过来压深一点，边读成"厚度"而不是光。 */
  const rimL = l > 65 ? Math.max(30, l - 10) : Math.min(88, l + 26);
  return {
    hex,
    rim: hsl2hex(h, s * 0.9, rimL),
  };
}

/* ---- 盘体（逐像素）。alpha 是**绝对**实度（材质 opacity 恒为 1）——
 * 因为标签那块必须全实（封面要看得清），整体透明度只能住在贴图的 alpha 通道里。
 *
 * 径向分区（r 为半径 / 盘半径）：
 *   1.00~0.965  盘边：光滑的引入区 + 最外一圈"墙"（更实、略亮）
 *   0.965~label×1.06  沟槽区：细同心纹 + 四条曲目分隔（分隔处最透最亮）
 *   label×1.06 以内   出针区：光滑（之后被标签盖掉大半）
 * 云纹叠在整个盘体上，幅度很小 —— 大了读成脏。 */
export function drawVinylBody(x, N, { tint, alpha, groove, labelR }) {
  let [h, s, l] = hex2hsl(tint);
  /* 轻量补偿：彩胶走 unlit 着色器（贴图色 ≈ 显示色），不用像受光材质那样狠压。
   * 只按通透度补一点密度（越透越深一点，颜色密度守恒），饱和加一小脚。
   * ⚠️ 压深只对**有彩色**成立 —— 黑/白透明胶（烟熏、奶白）的密度长在明度本身里，
   * 压深会把白胶变灰胶，所以补偿量按饱和度渐入（s=0 完全不压）。
   * 注意这个函数的输出是 raw 的（不过 grade —— grade 会把饱和封顶在 ~75，彩胶直接灰掉）。 */
  const density = Math.min(1, s / 60);
  const lFactor = 0.68 + 0.22 * alpha;
  l = Math.max(8, Math.min(90, l * (1 - density * (1 - lFactor))));
  s = Math.min(96, s * 1.15 + 6);
  const R = N / 2, rOut = R * 0.995;
  const img = x.createImageData(N, N), d = img.data;
  const spacing = Math.max(1.6, N * 0.0045);          // 细沟纹的间距（512² 时约 2.3px）
  const seps = [0.535, 0.645, 0.760, 0.870];          // 曲目分隔环的半径（占 R）
  const sepW = N * 0.006;
  const runIn = labelR * 1.06;                        // 出针区外沿
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const i = (py * N + px) * 4;
      const dx = px - R + 0.5, dy = py - R + 0.5;
      const r = Math.hypot(dx, dy);
      if (r > rOut + 1) continue;                     // 盘外：全透明（createImageData 默认 0）
      const th = Math.atan2(dy, dx);
      let a = alpha, dl = 0;
      if (r > R * 0.965) {                            // 盘边
        a += 0.06; dl += 4;
      } else if (r > runIn) {                         // 沟槽区
        const ring = Math.sin(r * Math.PI * 2 / spacing);
        a += ring * 0.09 * groove;
        dl -= ring * 8 * groove;
        for (const sr of seps) {                      // 曲目分隔：平滑地压向"更透更亮"
          const t = Math.max(0, 1 - Math.abs(r - sr * R) / sepW);
          const tt = t * t * (3 - 2 * t);
          a += (alpha * 0.72 - a) * tt;
          dl += (7 - dl) * tt;
        }
      } else {                                        // 出针区：光滑
        a = alpha * 0.86; dl = 5;
      }
      // 压盘云纹：长在料里，跟着盘转（物理正确）；幅度压得很低
      const w = Math.sin(th * 3 + r / R * 7 + 1.7) * Math.sin(th * 5 - r / R * 11);
      a += w * 0.045 * alpha;
      dl += w * 2.5;
      if (r > rOut - 1.2) a *= (rOut + 1 - r) / 2.2;  // 边缘抗锯齿
      a = Math.max(0.05, Math.min(1, a));
      const [cr, cg, cb] = hsl2rgb(h, s, Math.max(4, Math.min(92, l + dl)));
      d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = a * 255;
    }
  }
  x.putImageData(img, 0, 0);
}
