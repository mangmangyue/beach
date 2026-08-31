/* 沙滩的两张场 —— 见 共用/场接口.md
 *
 * Field2D：覆盖沙滩的二维 Float32 格子 + 一张同步上传的 DataTexture。
 *   HeightField：被推过的沙（坑/堆），有安息角 / 落沙 / 摩擦三条物理规则
 *   WetField   ：被浪打湿的沙，指数变干
 *
 * 坐标一律是沙的局部坐标（原型单位），世界米 ↔ 局部 的换算在 stage 里。
 * 为什么在 CPU 上：物件落位、贝壳吸附都要在 JS 里查沙面高度，CPU 版两边永远一致。
 */
import * as THREE from 'three';

export const FIELD_HALF = 16.0;   // 场覆盖 ±16 局部单位（物件活动区）
export const FIELD_N = 256;   // 一格 ≈ 1.7cm（192 时 2.8cm，小生物的脚印连一格都不到）

export class Field2D {
  constructor(name = 'field') {
    this.name = name;
    this.n = FIELD_N;
    this.half = FIELD_HALF;
    this.cell = (FIELD_HALF * 2) / FIELD_N;
    this.data = new Float32Array(FIELD_N * FIELD_N);
    this.tex = new THREE.DataTexture(this.data, FIELD_N, FIELD_N, THREE.RedFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;   // 双线性在 shader 里手写
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.dirty = false;
    this.calm = true;
    this.maxAbs = 0;
    this.min = -Infinity; this.max = Infinity;   // stamp 的夹取范围
  }

  /* 局部坐标 → 格子坐标（浮点，格心在 .5） */
  toGrid(x, z) {
    const k = this.n / (this.half * 2);
    return [(x + this.half) * k - 0.5, (z + this.half) * k - 0.5];
  }
  cellCenter(i, j) {
    return [-this.half + (i + 0.5) * this.cell, -this.half + (j + 0.5) * this.cell];
  }

  /* 双线性读，出界 0。和 shader 里的 fieldAt() 同一公式。 */
  sample(x, z) {
    const { n, data } = this;
    const [gx, gz] = this.toGrid(x, z);
    if (gx < 0 || gz < 0 || gx > n - 1 || gz > n - 1) return 0;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const fx = gx - x0, fz = gz - z0;
    const x1 = Math.min(x0 + 1, n - 1), z1 = Math.min(z0 + 1, n - 1);
    const a = data[z0 * n + x0], b = data[z0 * n + x1];
    const c = data[z1 * n + x0], d = data[z1 * n + x1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  /* 高斯加一坨（amt<0 挖 / >0 堆） */
  stamp(x, z, r, amt) {
    if (amt === 0) return;
    const { n, half, cell, data } = this;
    const R = Math.max(r, cell);
    const i0 = Math.max(0, Math.floor((x - R * 1.8 + half) / cell));
    const i1 = Math.min(n - 1, Math.ceil((x + R * 1.8 + half) / cell));
    const j0 = Math.max(0, Math.floor((z - R * 1.8 + half) / cell));
    const j1 = Math.min(n - 1, Math.ceil((z + R * 1.8 + half) / cell));
    for (let j = j0; j <= j1; j++) {
      const cz = -half + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const cx = -half + (i + 0.5) * cell;
        const t = ((cx - x) ** 2 + (cz - z) ** 2) / (R * R);
        if (t > 3.2) continue;
        const v = data[j * n + i] + amt * Math.exp(-t * 2.0);
        data[j * n + i] = Math.min(this.max, Math.max(this.min, v));
      }
    }
    this.touch();
  }

  /* 区域遍历写：fn(x, z, v) 返回新值；返回 undefined 表示不改 */
  paintRect(x0, z0, x1, z1, fn) {
    const { n, half, cell, data } = this;
    const i0 = Math.max(0, Math.floor((Math.min(x0, x1) + half) / cell));
    const i1 = Math.min(n - 1, Math.ceil((Math.max(x0, x1) + half) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(z0, z1) + half) / cell));
    const j1 = Math.min(n - 1, Math.ceil((Math.max(z0, z1) + half) / cell));
    let changed = false;
    for (let j = j0; j <= j1; j++) {
      const cz = -half + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        const v = fn(-half + (i + 0.5) * cell, cz, data[k]);
        if (v !== undefined && v !== data[k]) { data[k] = v; changed = true; }
      }
    }
    if (changed) this.touch();
    return changed;
  }
  paint(fn) { return this.paintRect(-this.half, -this.half, this.half, this.half, fn); }

  decay(k) {
    if (k >= 1) return;
    const d = this.data;
    for (let i = 0; i < d.length; i++) d[i] *= k;
    this.touch();
  }

  touch() { this.dirty = true; this.calm = false; }

  /* 有改动就上传贴图。stage 每帧调。 */
  commit() {
    if (!this.dirty) return false;
    this.tex.needsUpdate = true;
    this.dirty = false;
    return true;
  }
}

/* ================================================================
 * 高度场：被推过的沙。三条规则（Iris 定的行为，2026-08-21）：
 *   1. 安息角：相邻格高差超过阈值，沙就快速往低处塌（每帧一遍，塌落有过程感）
 *   2. 落沙蠕动：坡度没到安息角、但还有点斜的地方，沙慢慢往低处落
 *   3. 摩擦力：坡度低于摩擦阈值就永久停住 —— 痕迹变浅但不会完全填平
 * ============================================================== */
export class HeightField extends Field2D {
  constructor() { super('height'); this.min = -0.8; this.max = 0.8; }

  /* reposeK 0..1（1 = 很陡也不塌）；creepK 0..1（0 = 推完就定型）。返回有没有改动。 */
  step(dt, reposeK, creepK) {
    if (this.calm) return false;
    const { n, data, cell } = this;
    const maxDiff   = cell * (0.55 + reposeK * 1.3);   // 沙有一点点黏性：小脚印的边能立住，不会立刻匀成软坑
    const creepDiff = maxDiff * 0.22;                  // 摩擦力的坡度下限
    const creepF    = creepK * 0.06 * Math.min(dt * 60, 2);
    let maxAbs = 0, moved = 0;
    const flow = (a, b) => {
      const d = data[a] - data[b];
      const ad = Math.abs(d);
      let f = 0;
      if (ad > maxDiff) f = (ad - maxDiff) * 0.18;
      else if (ad > creepDiff && creepF > 0) f = (ad - creepDiff) * creepF;
      if (f === 0) return;
      const s = d > 0 ? f : -f;
      data[a] -= s; data[b] += s;
      moved += f;
    };
    for (let j = 0; j < n; j++) {
      const row = j * n, below = row + n;
      for (let i = 0; i < n; i++) {
        const k = row + i;
        if (i + 1 < n) flow(k, k + 1);
        if (j + 1 < n) flow(k, below + i);
        const a = Math.abs(data[k]);
        if (a > maxAbs) maxAbs = a;
      }
    }
    this.maxAbs = maxAbs;
    const wasDirty = this.dirty;
    this.dirty = true;
    this.calm = !wasDirty && moved < 1e-3;   // 这一帧没人写、沙也都被摩擦力咬住了 → 收工
    return true;
  }
}

/* ================================================================
 * 湿度场：被浪打湿的沙。只有一条规则：指数变干。
 * ============================================================== */
export class WetField extends Field2D {
  constructor() { super('wet'); this.min = 0; this.max = 1; }

  /* dryTime：衰减到 1/e 用几秒。返回有没有改动。 */
  step(dt, dryTime) {
    if (this.calm) return false;
    const k = Math.exp(-dt / Math.max(dryTime, 0.5));
    const d = this.data;
    let maxV = 0;
    for (let i = 0; i < d.length; i++) {
      let v = d[i] * k;
      if (v < 0.01) v = 0;
      d[i] = v;
      if (v > maxV) maxV = v;
    }
    this.maxAbs = maxV;
    const wasDirty = this.dirty;
    this.dirty = true;
    this.calm = !wasDirty && maxV === 0;
    return true;
  }
}

/* ================================================================
 * 痕迹场：小生物走过留下的细小痕迹。和高度场分开存 ——
 * 它不参与塌落（小脚印不该被匀平），只是随时间慢慢淡掉。
 * ============================================================== */
export class MarksField extends Field2D {
  constructor() { super('marks'); this.min = -0.05; this.max = 0.05; }   // 脚印再多也叠不深
  /* fadeTime：淡到 1/e 用几秒 */
  step(dt, fadeTime) {
    if (this.calm) return false;
    const k = Math.exp(-dt / Math.max(fadeTime, 1));
    const d = this.data;
    let maxV = 0;
    for (let i = 0; i < d.length; i++) {
      let v = d[i] * k;
      if (Math.abs(v) < 0.002) v = 0;
      d[i] = v;
      const a = Math.abs(v); if (a > maxV) maxV = a;
    }
    this.maxAbs = maxV;
    const wasDirty = this.dirty;
    this.dirty = true;
    this.calm = !wasDirty && maxV === 0;
    return true;
  }
}
