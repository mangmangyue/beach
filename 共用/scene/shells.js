/* 贝壳：从 物件_贝壳/viewer/shells.glb 挑一批，成簇随机撒在垫子外圈。
 * 材质规则照 物件_贝壳/viewer/main.js：raw 色、一点自发光当珠光、薄处花瓣档边缘透光。 */
import * as THREE from 'three';
import { rng, addRim, loadTexRaw, loadGLB } from './util.js';

const SH = '../物件_贝壳/viewer/';
const MAPS = { M_Urchin: 'urchin.png', M_DollarBody: 'sand_dollar.png',
  M_PebbleCream: 'pebble_cream.png', M_PebbleGrey: 'pebble_grey.png', M_PebbleTan: 'pebble_tan.png' };
const MATTE = new Set(['M_Star', 'M_StarDark', 'M_Mussel', 'M_MusselEdge', 'M_Oyster', 'M_OysterDark', 'M_Abalone', 'M_AbaloneHole']);
const GLOSSY = { M_Nacre: 0.2, M_Nacre2: 0.12, M_Nacre3: 0.12, M_CowrieBack: 0.18, M_CowrieSpot: 0.18, M_StrombusIn: 0.22, M_Lining: 0.26 };

export function shellMaterialFactory(colors) {
  const cache = new Map();
  return name => {
    if (cache.has(name)) return cache.get(name);
    const col = colors[name] || '#DDD8D0';
    const map = MAPS[name];
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(col), roughness: GLOSSY[name] ?? (MATTE.has(name) ? 0.7 : 0.4),
      metalness: 0, flatShading: true, side: THREE.DoubleSide,
      emissive: new THREE.Color(map ? '#FFFFFF' : col),
      emissiveIntensity: name.startsWith('M_Pebble') ? 0.03 : MATTE.has(name) ? 0.05 : map ? 0.1 : 0.16,
    });
    if (map) m.map = loadTexRaw(SH + 'tex/' + map, () => { m.needsUpdate = true; });
    addRim(m);
    cache.set(name, m);
    return m;
  };
}

/* 撒点：外圈几个小簇 + 零星；大的在簇心。avoid(x,z) 返回 true 的地方不撒 */
export function clusterSpots(r, count, { rMin = 0.8, rMax = 2.4, clusters = 12, avoid = () => false } = {}) {
  const spots = [];
  for (let c = 0; c < clusters; c++) {
    const a = r() * Math.PI * 2, d = rMin + 0.05 + r() * (rMax - rMin - 0.1);
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    const n = 2 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) spots.push({ x: cx + r.gauss() * 0.09, z: cz + r.gauss() * 0.09, core: k === 0 });
  }
  while (spots.length < count * 1.4) {
    const a = r() * Math.PI * 2, d = rMin + r() * (rMax - rMin);
    spots.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, core: false });
  }
  // 打乱，别让簇全排在前面
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  return spots.filter(p => !avoid(p.x, p.z) && Math.hypot(p.x, p.z) < rMax + 0.1).slice(0, count);
}

/* 分布（Iris 08-22："均匀撒一地反而丑"）：
 *   ① 潮痕带：浪退到最远处留下的一条线，大部分贝壳顺着它聚成一条蜿蜒的带（真实海滩就这样）
 *   ② 两三个"主角堆"：大贝壳当中心、小的围着，放在构图需要的地方
 *   ③ 零星几颗
 * 深色种类（贻贝、鲍鱼、海星、鹅卵石、牡蛎）限量，白沙上它们是噪点。 */
const DARK = /mussel|abalone|starfish|pebble|oyster/;
/* 分布（Iris 08-22 看了贝壳 viewer 的散落图："那样才好看"）：
 * 贝壳只在**浪能打到的那条带**上（潮痕线到水线之间），密、大、几乎全是浅色，像被浪一层层铺上来的。
 * 垫子前方不放。退潮时泡在水里的会被带走，涨潮每次送几颗，湿沙上永远有东西在来去。 */
export async function loadShells(stage, { seed = 11, avoid, bandX = 2.4, getParams } = {}) {
  let { count, scale, bandZ } = getParams();
  const [json, gltf] = await Promise.all([fetch(SH + 'shells.json').then(r => r.json()), loadGLB(SH + 'shells.glb')]);
  const r = rng(seed);
  const mat = shellMaterialFactory(json.colors);
  gltf.scene.traverse(o => { if (o.isMesh) o.material = mat(o.material?.name || ''); });
  const variants = [...gltf.scene.children];
  const pale = variants.filter(v => !DARK.test(v.name)), dark = variants.filter(v => DARK.test(v.name));
  const bySize = (arr, sz) => arr.filter(v => v.userData.size === sz);
  const pickOne = pool => pool[Math.floor(r() * pool.length)];

  /* 同一种贝壳最多出现两颗（Iris 2026-08-26：「太多一模一样的贝壳了」）。
   * 库里有 77 种，但按尺寸分完是很不平均的：
   *   pale-L 只有 3 种、pale-M 20、pale-S 30、dark-M 8、dark-S 16
   * 所以 L 号必然不够用 —— 用满了就往小一档退，而不是把同一只大贝壳复制十遍。
   * （改之前实测：104 颗只用了 46 种，最多的一种出现了 9 次。） */
  const MAX_SAME = 2;
  /* 海星另有**全场限额**（不分变体）：库里海星有好几个变体，逐变体限 2 的话
   * 场上能同时出现 5-6 颗 —— 而海星是唯一的橙红五角星，视觉权重远超米色贝壳，
   * Iris 08-30：「感觉看到太多海星了」。全场最多 2 颗。 */
  const STAR_CAP = 2;
  let starTaken = 0;
  const isStar = v => /star/i.test(v.name);
  const used = new Map();                       // node → 场上有几颗
  const takeCount = v => used.get(v) || 0;
  const avail = pool => pool.filter(v => takeCount(v) < MAX_SAME && !(isStar(v) && starTaken >= STAR_CAP));
  /* ⚠️ 名额在**挑的时候**就占掉，不能等 spawn。
   * makeSpots 是先把 111 个 node 全挑完、再一个个 spawn 的 ——
   * 如果计数放在 spawn 里，初始那一整批挑的时候 used 全是 0，上限等于没有
   * （踩过：改完还是有一种出现 7 次）。 */
  const pickShell = size => {
    const useDark = r() < 0.10 && dark.length;
    const base = useDark ? dark : pale;
    // 本尺寸没富余就往小一档退（大的稀有是对的：L 本来就该少而显眼）
    const order = size === 'L' ? ['L', 'M', 'S'] : size === 'M' ? ['M', 'S', 'L'] : ['S', 'M', 'L'];
    let v = null;
    for (const sz of order) {
      const p = avail(bySize(base, sz));
      if (p.length) { v = pickOne(p); break; }
    }
    if (!v) {
      const other = avail(useDark ? pale : dark);  // 这一色系全用满了，换另一色系
      v = other.length ? pickOne(other) : pickOne(base);   // 真的没了（要 154 颗以上才会到这儿）
    }
    used.set(v, takeCount(v) + 1);
    if (isStar(v)) starTaken++;   // 和 MAX_SAME 一样：名额在**挑的时候**占，等 spawn 就晚了
    return v;
  };
  const ok = (x, z) => !(avoid && avoid(x, z)) && Math.abs(x) < bandX + 0.3;
  /* 带里采一个点。**初始撒点和潮汐补货用的是同一个函数** ——
   * 以前补货只在水线内侧那一小条上生成，跑久了整条带就往近处塌（Iris 2026-08-26 报的 bug）。 */
  function randomSpot(rr, near01 = null) {
    const x = (rr() * 2 - 1) * bandX;
    // u=0 在近端(shellNear)，u=1 在远端(shellFar)；sqrt 让远端更密（原来的手感）
    const u = near01 == null ? Math.sqrt(rr()) : near01;
    const z = bandZ[0] + (bandZ[1] - bandZ[0]) * u + rr.gauss() * 0.04;
    const size = u > 0.8 ? (rr() < 0.4 ? 'L' : 'M') : rr() < 0.5 ? 'M' : 'S';
    return { x, z, u, size };
  }
  function makeSpots(rr) {
    const spots = [];
    let tries = 0;
    while (spots.length < count && tries++ < count * 6) {
      const sp = randomSpot(rr);
      if (!ok(sp.x, sp.z)) continue;
      if (spots.some(p => Math.hypot(p.x - sp.x, p.z - sp.z) < 0.085)) continue;   // 撒开一点（Iris 08-26）
      spots.push({ x: sp.x, z: sp.z, node: pickShell(sp.size) });
    }
    return spots;
  }

  const placed = [];
  function spawn(node, x, z) {
    const ex = node.userData;
    const obj = new THREE.Group();
    obj.name = node.name; obj.add(node.clone()); obj.children[0].position.set(0, 0, 0);
    obj.position.set(x, 0, z);
    obj.rotation.y = r() * Math.PI * 2;
    obj.scale.setScalar(scale);          // 贝壳按真实尺寸只有两三厘米，画面里太小，整体放大一档
    obj.userData.rangeMul = 5;
    obj.userData.home = { x, z };        // 「家」：冲刷带里被浪搡来搡去，干了慢慢回这儿（带型不漂）
    obj.userData.sway = 0.35 + r() * 0.65;   // 对浪的敏感度：轻的壳被搡得多，重的几乎不动
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    const pr = Math.max(ex.contactRadius * 1.5, 0.018);
    proxy.scale.set(pr, pr * 0.6, pr); proxy.position.y = pr * 0.3; proxy.userData.noBounds = true;
    obj.add(proxy);
    obj.userData.variant = node;                 // 记住是哪一种，卷走的时候把名额还回去
    stage.sink(obj, { radius: ex.contactRadius * scale, lift: -(ex.buryDepth || 0) * scale, bake: true });
    stage.world.add(obj);
    placed.push(obj);
    return obj;
  }
  makeSpots(r).forEach(sp => spawn(sp.node, sp.x, sp.z));
  /* 面板改了数量/大小/位置 → 全部拿走重撒（同一个 seed，撒法一致） */
  function rebuild() {
    ({ count, scale, bandZ } = getParams());
    for (const o of [...placed]) stage.unsink(o);
    placed.length = 0;
    used.clear();
    starTaken = 0;
    vacancies.length = 0;               // 换了带的位置，旧空位就没意义了
    makeSpots(rng(seed)).forEach(sp => spawn(sp.node, sp.x, sp.z));
  }

  /* 潮汐：碎浪那一下把贝壳卷走一两颗，涨潮再补回来。
   *
   * ⚠️ 2026-08-26 重写。旧版跑十几分钟就把整条带塌成靠近镜头的一小片（Iris 报的 bug），
   * 三个原因叠在一起，缺一不可：
   *   ① 删除阈值是 `reach + 3.5`（水线附近，11.2 局部），而贝壳带是 7.4–18.9 局部 ——
   *      **带的外 60% 一开始就在阈值之外**，一旦开始漂就当场删掉。
   *   ② 触发条件是"泡在水里"，而涨潮时整条带都在水下 → 几乎所有贝壳都会开始漂。
   *   ③ 补货只在水线内侧 0.3–1.5 局部生成，比 shellNear 还近 → 补回来的全挤在最近处。
   * 现在：只有**拍岸带里**的会被卷走、删除阈值按**场的边界**（moveObject 也只能推到那儿）、
   * 补货用和初始撒点**同一个分布函数**。净效果是数量和形状都稳定。 */
  const S = stage.envScale;
  const vacancies = [];                 // 被卷走的贝壳原来躺的位置，等下次涨潮补回去
  let lastPhase = 0, t = 0;
  /* 每秒的卷走概率（深水处的满值）。面板「贝壳漂走」在拖它。
   * 换算：水线扫过一颗贝壳约 2.7 秒，所以「一潮被卷走的概率」≈ 1-exp(-p×2.7)。 */
  const DRIFT = () => (getParams().drift ?? 8) / 100;
  const SWASH = () => (getParams().swash ?? 100) / 100;   // 面板「浪推贝壳」
  function update(dt) {
    const wv = stage.waves; if (!wv || !wv.state.on) return;
    t += dt;
    const ph = wv.phase();
    const d = wv.dir();
    const pp = wv.perp();
    /* 这一颗贝壳所在的那条横断线上，**当下**的水线在哪。
     * ⚠️ 不能用 wv.state.reach —— 那是"水线最近能冲到哪"的**参数**（常数 7.7），
     * 不是当下的位置。用它当水线的话，拍岸带永远钉在 5.5–9.9 局部，
     * 于是只有带的近端会被卷走，中段和远端一颗都轮不到（2026-08-26 Iris 发现的）。
     * 真实的水线在 reach…shore 之间来回扫，退潮时会扫过整条贝壳带。 */
    const frontAt = (lx, lz) => {
      const [fx, fz] = wv.frontPoint(lx * pp.x + lz * pp.y);
      return fx * d.x + fz * d.y;
    };
    const farLocal = (-bandZ[0]) / S;    // 贝壳带外沿（局部单位）
    for (const obj of [...placed]) {
      const [lx, lz] = stage.toLocal(obj.position.x, obj.position.z);
      const proj = lx * d.x + lz * d.y;
      const front = frontAt(lx, lz);
      const dr = obj.userData.drift;
      if (!dr) {
        /* **水越深越容易被带走**（Iris 2026-08-26 定的规则，比"只在拍岸带"好）：
         *   露在沙上的（depth <= 0）—— 永远不动，它们是被搁浅在那儿的
         *   浅水里的           —— 偶尔动一下
         *   深水里的（靠海那头）—— 一直在被浪翻来翻去
         * 这条既符合直觉，也让**外侧那段真的活起来**（之前只在拍岸带里挑，
         * 每颗机会均等，结果哪儿都看不出在动）。
         * depth 用的就是浪的着色器里那个 vDist：离水线多远 = 水有多深。
         * 平方是为了把浅水压下去，让深浅差别读得出来。 */
        const depth = proj - front;
        /* 冲刷带（水线刚扫过的那 0~2.2 局部）：**每一浪都把贝壳搡半步**——
         * 涨的时候往岸上搡、退的时候往海里拖，加一点翻转。
         * 「被浪冲上来/带走的感觉」主要靠这个：真正的卷走多发生在深水里根本看不清，
         * 而这半步就发生在眼前的湿沙上（Iris 08-29 要的就是这个）。
         * 位移上限 12cm、干了慢慢回家 —— 搡是演出，不改变分布。 */
        if (depth > 0 && depth < 2.2) {
          const hm = obj.userData.home;
          if (Math.hypot(obj.position.x - hm.x, obj.position.z - hm.z) < 0.18) {
            const sign = ph > 0.42 ? 1 : -1;
            // 0.22：一浪扫过挪 3~6cm（0.09 时实测最大才 1.3cm，肉眼看不出，白做）
            const step = S * 0.22 * obj.userData.sway * (1 - depth / 2.2) * SWASH() * dt * sign;
            stage.moveObject(obj, obj.position.x + d.x * step, obj.position.z + d.y * step, { free: true, quiet: true });
            obj.rotation.y += dt * 1.1 * obj.userData.sway * sign;
          }
        } else if (depth <= -0.5) {
          // 干沙上极慢地弹回家（每秒收 8% 的余量，肉眼看不出在滑）——
          // 没有这条，搡来搡去的净位移会累积，整条带慢慢糊掉（08-26 塌带 bug 的亲戚）
          const hm = obj.userData.home;
          const rx = hm.x - obj.position.x, rz = hm.z - obj.position.z;
          if (rx * rx + rz * rz > 1e-6) {
            const e = Math.min(1, dt * 0.08);
            stage.moveObject(obj, obj.position.x + rx * e, obj.position.z + rz * e, { free: true, quiet: true });
          }
        }
        const w = depth <= 0 ? 0 : Math.min(1, depth / 6) ** 2;
        if (ph > 0.42 && w > 0 && Math.random() < dt * w * DRIFT())
          // 记下它原来躺在哪 —— 补货要补回这个位置，整条带才真的不动
          obj.userData.drift = { t0: t, wob: Math.random() * 6.28, ox: obj.position.x, oz: obj.position.z };
        continue;
      }
      // 顺着退潮的水往海里漂，越漂越快
      const age = t - dr.t0;
      const sp = 0.12 + age * 0.12;
      const nx = obj.position.x + d.x * S * sp * dt + Math.sin(t * 3 + dr.wob) * 0.02 * dt;
      const nz = obj.position.z + d.y * S * sp * dt + Math.cos(t * 2.3 + dr.wob) * 0.02 * dt;
      stage.moveObject(obj, nx, nz, { free: true });
      obj.rotation.y += dt * 1.5;
      /* 什么时候算"走了"。三个条件任一：
       *   ① 漂出贝壳带外沿 3 个局部单位 —— 不加这条，退潮时水线跟着往外跑、
       *      depth 一直不够大，贝壳就一路滑到带外面停着，z 的最大值会慢慢爬
       *      （实测 3.11 → 3.57）
       *   ② 沉进浑水里：离水线 6 个局部单位以外，浪的着色器那边已经完全不透明，
       *      看不见了才删，不会当着面消失
       *   ③ age 兜底，防止某颗卡住 */
      if (proj > farLocal + 3 || proj - front > 6 || age > 14) {
        vacancies.push({ x: dr.ox, z: dr.oz });          // 空出来一个位置，下次涨潮补回去
        if (vacancies.length > 40) vacancies.shift();
        const v = obj.userData.variant;                 // 名额还回去，这一种又能再出现了
        if (v) used.set(v, Math.max(0, takeCount(v) - 1));
        if (v && isStar(v)) starTaken = Math.max(0, starTaken - 1);
        stage.unsink(obj); placed.splice(placed.indexOf(obj), 1);
      }
    }
    /* 涨到最高处（相位 0.35）补货：**优先补回刚刚空出来的那些位置**（带一点抖动），
     * 空位用完了才按初始分布随机补。
     * 为什么要记空位：被卷走的永远集中在拍岸带（近端），而按分布随机补是均匀的，
     * 于是近端只出不进，整条带会慢慢往外挪 —— 实测十分钟中位数从 1.82m 爬到 2.09m 才停。
     * 丢哪儿补哪儿，才是真的原地不动。 */
    if (lastPhase < 0.35 && ph >= 0.35 && placed.length < count) {
      const want = Math.min(5, count - placed.length);   // 一潮送几颗就够（原来 18 颗一批太像刷新）
      let tries = 0;
      for (let got = 0; got < want && tries < want * 8; tries++) {
        let sp, fromVac = null;
        if (vacancies.length) {
          fromVac = vacancies.shift();
          sp = { x: fromVac.x + (Math.random() * 2 - 1) * 0.03, z: fromVac.z + (Math.random() * 2 - 1) * 0.03,
                 size: Math.random() < 0.45 ? 'M' : 'S' };
        } else {
          sp = randomSpot(r);
        }
        if (!ok(sp.x, sp.z)) { if (fromVac) vacancies.push(fromVac); continue; }
        /* 只在**当下泡在水里**的位置出生 —— 贝壳是被涨潮送上来的：
         * 出生在半透明的水膜底下（看不见"凭空出现"），退潮水一撤，沙上多了一颗。
         * 还露在沙上的位置这一潮轮不到（空位还回去），等下一潮水漫过来再说。 */
        const [slx, slz] = stage.toLocal(sp.x, sp.z);
        if ((slx * d.x + slz * d.y) - frontAt(slx, slz) < 0.5) { if (fromVac) vacancies.push(fromVac); continue; }
        if (placed.some(o => Math.hypot(o.position.x - sp.x, o.position.z - sp.z) < 0.085)) continue;
        spawn(pickShell(sp.size), sp.x, sp.z);
        got++;
      }
    }
    lastPhase = ph;
  }
  return { shells: placed, update, rebuild };
}
