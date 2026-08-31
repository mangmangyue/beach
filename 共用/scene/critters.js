/* 小生物 🦀 🐢 🐙：外形来自 物件_贝壳/viewer/critters.glb（三姿态 crawl / rest / tuck），
 * 爬行、躲光标、脚印归这里（沙滩窗口）。
 *
 * 三种各有自己的节奏：
 *   螃蟹  横着走、快、走走停停，两排小脚印
 *   海龟  慢而稳，肚子拖出一道浅沟 + 两侧交替的鳍印
 *   章鱼  一收一放地"泵"着走，留一道光滑的拖痕
 * 脚印写进高度场（stage.fields.height），会被浪冲平、被安息角慢慢软化。
 * 光标靠近 → 缩起来（tuck 姿态）不动，走开几秒后继续。 */
import * as THREE from 'three';
import { rng, loadGLB, blobShadow } from './util.js';

const SH = '../物件_贝壳/viewer/';
const MATS = {
  M_CrabBody:   { color: '#E6978A', rough: 0.45 }, M_CrabDark: { color: '#CF8275', rough: 0.45 },
  M_CrabBelly:  { color: '#F1C3B5', rough: 0.50 },
  M_Eye:        { color: '#2B2622', rough: 0.12 }, M_EyeLight: { color: '#FFFFFF', rough: 0.10, glow: true },
  M_Cheek:      { color: '#E9A6A8', rough: 0.60 },
  M_TurtleShell:{ color: '#B7AA87', rough: 0.40 }, M_TurtleScute:{ color: '#A09273', rough: 0.40 },
  M_TurtleRim:  { color: '#D9CDB0', rough: 0.40 }, M_TurtleSkin: { color: '#A9CBA2', rough: 0.55 },
  M_TurtleBelly:{ color: '#EFE8D3', rough: 0.55 },
  M_Octo:       { color: '#E9ADA6', rough: 0.40 },
};
const SPECIES = {
  crab:    { speed: 0.055, walk: [1.2, 3.5], rest: [1.5, 4],   sideways: true,  spacing: 0.009 },
  turtle:  { speed: 0.004, walk: [8, 16],    rest: [6, 14],    sideways: false, spacing: 0.012 },   // 极慢
  octopus: { speed: 0.006, walk: [2, 4],     rest: [12, 30],   sideways: false, spacing: 0.012 },   // 基本不动，偶尔挪一点
};

export async function loadCritters(stage, { seed = 5, avoid = () => false, counts = { crab: 2, turtle: 1, octopus: 1 } } = {}) {
  const [json, gltf] = await Promise.all([fetch(SH + 'critters.json').then(r => r.json()), loadGLB(SH + 'critters.glb')]);
  const r = rng(seed);
  const cache = new Map();
  const getMat = name => {
    if (cache.has(name)) return cache.get(name);
    const s = MATS[name] || { color: json.colors?.[name] || '#D8C8C0', rough: 0.5 };
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(s.color), roughness: s.rough, metalness: 0, flatShading: true,
      emissive: new THREE.Color(s.color), emissiveIntensity: s.glow ? 0.9 : 0.05,
    });
    cache.set(name, m);
    return m;
  };
  gltf.scene.traverse(o => { if (o.isMesh) o.material = getMat(o.material?.name || ''); });
  const byName = Object.fromEntries([...gltf.scene.children].map(n => [n.name, n]));

  const critters = [];
  const marks = stage.fields.marks;     // 小生物的脚印写痕迹场：很小、很浅、会淡掉

  function spawn(species, x, z) {
    const P = SPECIES[species];
    const group = new THREE.Group();
    group.userData.noSink = true;
    const poses = {};
    for (const pose of ['crawl', 'rest', 'tuck']) {
      const n = byName[`${species}_${pose}`]; if (!n) continue;
      const c = n.clone(); c.position.set(0, 0, 0); c.visible = pose === 'crawl';
      group.add(c); poses[pose] = c;
    }
    const ex = byName[`${species}_crawl`].userData;
    group.position.set(x, 0, z);
    stage.world.add(group);
    const shadow = blobShadow(stage, x, 0, z, ex.contactRadius * 3.2, 0.26);
    stage.world.add(shadow);
    const c = {
      species, P, group, poses, shadow, ex,
      x, z, heading: r() * Math.PI * 2, tx: x, tz: z,
      state: 'rest', timer: r.range(0.5, 2), carry: 0, side: 1, t: r() * 10, tuckUntil: 0,
    };
    pickTarget(c);
    critters.push(c);
    return c;
  }
  /* 选目标：在外圈随机挑一点，要求直线路径不穿过垫子（沿路径采样几个点） */
  function pathClear(x0, z0, x1, z1) {
    for (let k = 1; k <= 8; k++) { const t = k / 8; if (avoid(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false; }
    return true;
  }
  function pickTarget(c) {
    for (let k = 0; k < 40; k++) {
      const a = r() * Math.PI * 2, d = 0.8 + r() * 1.5;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (avoid(x, z)) continue;
      if (Math.hypot(x - c.x, z - c.z) < 0.15) continue;
      if (!pathClear(c.x, c.z, x, z)) continue;
      c.tx = x; c.tz = z; return;
    }
    // 实在找不到就原地掉头
    c.heading += Math.PI * 0.7;
  }
  function setPose(c, pose) {
    for (const k in c.poses) c.poses[k].visible = k === pose;
  }

  // 初始散布
  const kinds = [];
  for (const k in counts) for (let i = 0; i < counts[k]; i++) kinds.push(k);
  kinds.forEach(k => {
    for (let t = 0; t < 30; t++) {
      const a = r() * Math.PI * 2, d = 0.9 + r() * 1.2;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!avoid(x, z)) { spawn(k, x, z); break; }
    }
  });

  /* 脚印：按走过的距离打戳，三种各不一样 */
  function footprints(c, dx, dz, dist) {
    const P = c.P;
    c.carry += dist;
    const ux = dx / dist, uz = dz / dist, px = -uz, pz = ux;     // 前进方向 / 垂直方向
    while (c.carry >= P.spacing) {
      c.carry -= P.spacing;
      const [lx, lz] = stage.toLocal(c.x, c.z);
      const S = stage.envScale;
      if (c.species === 'crab') {
        // 横着走：两排针尖大的小脚印落在身体两侧（相对行进方向），和它自己差不多宽
        const o = 0.010 / S;
        marks.stamp(lx + px * o, lz + pz * o, 0.035, -0.018);
        marks.stamp(lx - px * o, lz - pz * o, 0.035, -0.018);
      } else if (c.species === 'turtle') {
        marks.stamp(lx, lz, 0.12, -0.012);                        // 肚子拖出的一道浅痕
        c.side = -c.side;
        const o = 0.03 / S;
        marks.stamp(lx + px * o * c.side, lz + pz * o * c.side, 0.045, -0.025);   // 鳍印，左右交替
      } else {
        marks.stamp(lx, lz, 0.10, -0.010);                        // 一道很淡的拖痕
      }
    }
  }

  /* 点一下：螃蟹突然跑开几步；乌龟把头缩进去；章鱼鼓一下、吐几个小泡泡 */
  function poke(obj) {
    const c = critters.find(x => x.group === obj || obj.parent === x.group || (obj.parent && obj.parent.parent === x.group));
    if (!c || c.state === 'swept' || c.state === 'gone') return null;
    if (c.species === 'crab') {
      const a = c.heading + Math.PI + (r() - 0.5) * 1.6;      // 背着你逃
      c.dash = { until: c.t + 0.9, dirx: Math.sin(a), dirz: Math.cos(a) };
      c.state = 'walk'; c.timer = 1.2; setPose(c, 'crawl');
    } else if (c.species === 'turtle') {
      c.tuckUntil = c.t + 3.5;
    } else {
      c.puff = c.t;
      for (let k = 0; k < 3; k++) setTimeout(() => stage.spawnBubble({ kind: 'circle', at: [c.x + (r() - 0.5) * 0.03, c.z + (r() - 0.5) * 0.03], ttl: 4 + r() * 3, size: 0.12 + r() * 0.08 }), k * 220);
    }
    return c;
  }

  let pointer = null;   // 光标落在沙上的世界坐标 [x, z]
  const S = stage.envScale;
  /* 被浪卷走：泡在水里超过一秒多就顺着退潮漂进海里；过一阵子下一次涨潮再把它送回岸边 */
  function tide(c, dt) {
    const wv = stage.waves; if (!wv || !wv.state.on) return false;
    const [lx, lz] = stage.toLocal(c.x, c.z);
    const d = wv.dir();
    if (c.state === 'gone') {
      const ph = wv.phase();
      if (c.t > c.backAt && ph > 0.33 && ph < 0.37) {
        const [fx, fz] = wv.frontPoint((Math.random() * 2 - 1) * 8);
        c.x = (fx - d.x * 0.8) * S; c.z = (fz - d.y * 0.8) * S;
        c.heading = Math.atan2(-d.x, -d.y);          // 背对海往岸上走
        c.group.visible = c.shadow.visible = true;
        c.state = 'walk'; c.timer = r.range(...c.P.walk); c.wet = 0; pickTarget(c); setPose(c, 'crawl');
      }
      return true;
    }
    if (c.state === 'swept') {
      const age = c.t - c.sweptAt, sp = 0.15 + age * 0.15;
      c.x += d.x * S * sp * dt; c.z += d.y * S * sp * dt;
      c.heading += dt * 2.2;
      const y = stage.sandY(c.x, c.z);
      c.group.position.set(c.x, y + Math.abs(Math.sin(c.t * 6)) * 0.01, c.z);
      c.group.rotation.y = c.heading; c.shadow.position.set(c.x, y + 0.0015, c.z);
      const proj = (c.x / S) * d.x + (c.z / S) * d.y;
      if (proj > wv.state.reach + 3 || age > 10) { c.state = 'gone'; c.group.visible = c.shadow.visible = false; c.backAt = c.t + r.range(8, 18); }
      return true;
    }
    c.wet = wv.covered(lx, lz) ? (c.wet || 0) + dt : 0;
    if (c.wet > 1.2) { c.state = 'swept'; c.sweptAt = c.t; setPose(c, 'tuck'); return true; }
    return false;
  }
  /* 互相让开：两只挨太近就各退半步、换个目标，别穿模打架 */
  function separate() {
    for (let i = 0; i < critters.length; i++) for (let j = i + 1; j < critters.length; j++) {
      const a = critters[i], b = critters[j];
      if (a.state === 'gone' || b.state === 'gone') continue;
      const minD = (a.ex.contactRadius + b.ex.contactRadius) * 1.6 + 0.02;
      let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz);
      if (d >= minD) continue;
      if (d < 1e-4) { dx = 1; dz = 0; }
      const push = (minD - Math.max(d, 1e-4)) / 2;
      a.x -= dx / Math.max(d, 1e-4) * push; a.z -= dz / Math.max(d, 1e-4) * push;
      b.x += dx / Math.max(d, 1e-4) * push; b.z += dz / Math.max(d, 1e-4) * push;
      if (a.state === 'walk') pickTarget(a);
      if (b.state === 'walk') pickTarget(b);
    }
  }
  function update(dt) {
    separate();
    for (const c of critters) {
      const P = c.P;
      c.t += dt;
      if (tide(c, dt)) continue;
      // 躲光标：靠近就缩起来
      if (pointer && Math.hypot(pointer[0] - c.x, pointer[1] - c.z) < 0.13) c.tuckUntil = c.t + 2.5;
      if (c.t < c.tuckUntil) { setPose(c, 'tuck'); c.state = 'tucked'; c.timer = 0.3; }
      else if (c.state === 'tucked') { c.state = 'rest'; c.timer = r.range(0.5, 1.5); setPose(c, 'rest'); }

      c.timer -= dt;
      if (c.state === 'rest' && c.timer <= 0) { c.state = 'walk'; c.timer = r.range(...P.walk); pickTarget(c); setPose(c, 'crawl'); }
      else if (c.state === 'walk' && c.timer <= 0) { c.state = 'rest'; c.timer = r.range(...P.rest); setPose(c, 'rest'); }

      let bob = 0;
      if (c.dash) {                                   // 螃蟹被戳：横冲几步
        if (c.t > c.dash.until) c.dash = null;
        else {
          const sp = 0.28, nx = c.x + c.dash.dirx * sp * dt, nz = c.z + c.dash.dirz * sp * dt;
          if (!avoid(nx, nz) && Math.hypot(nx, nz) < 2.5) { footprints(c, nx - c.x, nz - c.z, Math.hypot(nx - c.x, nz - c.z)); c.x = nx; c.z = nz; }
          c.heading = Math.atan2(c.dash.dirx, c.dash.dirz);
          bob = Math.abs(Math.sin(c.t * 30)) * 0.004;
        }
      } else if (c.state === 'walk') {
        const want = Math.atan2(c.tx - c.x, c.tz - c.z);
        let d = want - c.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
        c.heading += d * Math.min(1, dt * 2.5);
        let sp = P.speed;
        if (c.species === 'octopus') sp *= 0.35 + 0.65 * Math.max(0, Math.sin(c.t * 3.2));   // 一泵一泵地走
        if (c.species === 'crab') sp *= 0.7 + 0.3 * Math.sin(c.t * 9);
        const dx = Math.sin(c.heading) * sp * dt, dz = Math.cos(c.heading) * sp * dt;
        const nx = c.x + dx, nz = c.z + dz;
        if (!avoid(nx, nz) && Math.hypot(nx, nz) < 2.5) { c.x = nx; c.z = nz; footprints(c, dx, dz, Math.hypot(dx, dz)); }
        else { c.heading += Math.PI * 0.6; pickTarget(c); }   // 撞上垫子/边界：转身再选
        if (Math.hypot(c.tx - c.x, c.tz - c.z) < 0.04) pickTarget(c);
        bob = c.species === 'crab' ? Math.abs(Math.sin(c.t * 18)) * 0.0025
            : c.species === 'turtle' ? Math.sin(c.t * 2.2) * 0.0012
            : Math.max(0, Math.sin(c.t * 3.2)) * 0.004;
      }
      const y = stage.sandY(c.x, c.z);
      c.group.position.set(c.x, y + bob, c.z);
      c.group.rotation.y = c.heading + (P.sideways ? Math.PI / 2 : 0);
      if (c.species === 'turtle' && c.state === 'walk') c.group.rotation.z = Math.sin(c.t * 2.2) * 0.05;
      const puff = c.puff ? Math.max(0, 1 - (c.t - c.puff) / 0.8) : 0;
      if (c.species === 'octopus') c.group.scale.setScalar(1 + (c.state === 'walk' ? Math.sin(c.t * 3.2) * 0.05 : 0) + Math.sin(puff * Math.PI) * 0.22);
      c.shadow.position.set(c.x, y + 0.0015, c.z);
    }
  }
  return { critters, update, poke, setPointer: p => { pointer = p; } };
}
