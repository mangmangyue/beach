/* ============================================================================
 * 共用/audio.js —— 全站唯一的音频出口
 *
 * owner: 窗口 D。契约见 PROJECT.md「音频契约」一节。
 *
 * 为什么音频是全局系统而不是唱机的属性：
 *   网站里会有环境底噪（浪 + 黑胶噪音）、物件音效（快门、碰杯、翻贝壳）、
 *   唱机音乐、全局音量 —— 它们共享同一个 AudioContext 和同一条音量总线。
 *   浏览器还要求首次用户交互之后才能出声，这个解锁逻辑只能有一份。
 *
 * 分两层（版权决定的架构，不是偏好，见 PROJECT.md）：
 *
 *   ┌ 环境层 / 原创层 ┐   自己录的、免版税的、Iris 自己弹的
 *   │ ambience / sfx  │ → 走这里的 AudioContext，受 setVolume / mute / duck 控制
 *   └─────────────────┘
 *   ┌ 音乐层 ─────────┐   别人的歌
 *   │ play / pause    │ → 走平台官方嵌入播放器（Spotify iframe）
 *   └─────────────────┘   **不经过我们的 AudioContext**，音量总线控制不到它
 *
 * 所以「音乐后端」是插进来的：音乐层/player.js 在打开时调用 registerMusicBackend()
 * 把 Spotify 的控制器交给这里。audio.js 只负责持有状态和广播事件。
 *
 * 唱机（窗口 B）只用四个：play、pause、读 state、订阅 on('change')。
 * **唱机不持有任何音频状态** —— 唱片转不转、唱针落不落，全部由 state.playing 驱动。
 * ========================================================================== */

import { WAVE_SOUND, WAVE_REAL } from './浪声参数.js';

/* ---------------------------------------------------------------------------
 * 1 · 事件
 * ------------------------------------------------------------------------- */
const listeners = new Map();   // event -> Set<fn>

function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(payload); }
    catch (err) { console.error(`[audio] on('${event}') 回调抛错：`, err); }
  }
}

/* ---------------------------------------------------------------------------
 * 2 · 状态
 *
 * state 是音乐层的状态，唱机就看它。
 * position / duration 单位是秒；平台 iframe 不一定给得出来，给不出来就是 0。
 * ------------------------------------------------------------------------- */
const _state = {
  trackId: null,     // 当前曲目（Spotify track id）
  albumId: null,     // 当前专辑
  title: '',         // 曲名，给 UI 显示用
  artist: '',
  album: '',
  cover: null,       // 当前专辑封面的 URL（唱机贴到黑胶标签上、小窗口当缩略图）
  accent: null,
  playing: false,
  position: 0,
  duration: 0,
  ready: false,      // 平台播放器是否已经就位
};

let _lastSignature = '';

/* 只在真的变了的时候广播。position 每 200ms 跳一次，
 * 不做这层过滤的话唱机会被每秒五次的重排刷爆。 */
function commit(patch = {}, { force = false } = {}) {
  Object.assign(_state, patch);
  const sig = [_state.trackId, _state.playing, _state.ready,
               Math.floor(_state.position)].join('|');
  if (!force && sig === _lastSignature) return;
  _lastSignature = sig;
  emit('change', audio.state);
}

/* ---------------------------------------------------------------------------
 * 3 · AudioContext 与音量总线
 *
 *   master ─┬─ ambienceBus ─ duckGain ─ (浪 / 风 / 黑胶底噪)
 *           ├─ sfxBus      ─ (一次性音效)
 *           └─ musicBus    ─ analyser ─ (Apple 的 30 秒试听，MediaElementSource)
 *
 * **2026-08-26 起音乐也在这张图里。** 以前音乐是 Spotify 的 iframe，
 * 声音根本不经过我们的 AudioContext —— duck 压不到它、音量滑块管不到它，
 * UI 上只好写「这个滑块只管环境音」。现在 Apple 的 previewUrl 带 CORS *，
 * 可以 createMediaElementSource 接进来，于是：
 *   · duck() 是真的压低（播放器开着的时候浪声退到背景里）
 *   · 主音量 + 环境 / 音乐两条子轨，逻辑干净
 *   · analyser 拿得到低频能量 → 可以驱动唱片的转速抖动
 * ------------------------------------------------------------------------- */
let ctx = null, master = null, ambienceBus = null, duckGain = null, sfxBus = null;
let musicBus = null, analyser = null, musicSrc = null, _freqData = null;

let _volume = 0.8;       // 0..1，主音量
let _ambVol = 1.0;       // 环境子轨
let _musVol = 1.0;       // 音乐子轨
let _muted = false;
let _duck = 1;           // 1 = 不压，0.25 = 压到四分之一

function buildGraph() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master      = ctx.createGain();
  ambienceBus = ctx.createGain();
  duckGain    = ctx.createGain();
  sfxBus      = ctx.createGain();
  musicBus    = ctx.createGain();
  analyser    = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.82;
  _freqData = new Uint8Array(analyser.frequencyBinCount);

  ambienceBus.connect(duckGain);
  duckGain.connect(master);
  sfxBus.connect(master);
  musicBus.connect(analyser);
  analyser.connect(master);
  master.connect(ctx.destination);

  master.gain.value      = _muted ? 0 : _volume;
  ambienceBus.gain.value = _ambVol;
  duckGain.gain.value    = _duck;
  sfxBus.gain.value      = 1;
  musicBus.gain.value    = _musVol;
  return true;
}

function ramp(param, value, ms = 260) {
  if (!ctx) return;
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(value, t + ms / 1000);
}

/* ---------------------------------------------------------------------------
 * 4 · 声音素材登记
 *
 * 现在还没有任何音频文件（阶段 1.9b 才录）。
 * 所以这里只提供登记入口：文件到位之后调 defineAmbience / defineSfx 就能用，
 * 不用改任何调用方的代码。没登记的名字调用时是静默的 no-op（只警告一次）。
 * ------------------------------------------------------------------------- */
const AMBIENCE = new Map();    // name -> { url, gain, buffer, node }
const SFX      = new Map();    // name -> { url, gain, buffer }
const warned   = new Set();

function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.info(`[audio] ${msg}`);
}

async function loadBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

/* ---------------------------------------------------------------------------
 * 4.5 · 浪声
 *
 * **引擎逐层抄自 `海浪声实验室.html` v2**（Cowork 做的，Iris 在里面拖滑块定的音色）。
 * 参数在 `共用/浪声参数.js`，纯数据，实验室里调完整段粘贴过去即可。
 *
 * 上一版是我写的"滤过的白噪音"，实验室里把它列成了反面教材（就是 bed 那一层，
 * Iris 拉到 0.02）—— 原因是滤噪音只有慢包络，没有水声那一层微观颗粒，
 * 所以永远像吹风机不像水。现在主力是 bubble（音高上滑的小气泡，物理上正确的水声合成法）
 * 和 grain（极短颗粒），加上 harp / pad 两层不真实但好听的。
 *
 * 六层各自的 gain 节点 → master → ambienceBus（所以音量、duck 都管得到），
 * 另有一路 send 进卷积混响。
 *
 * **和动画的同步**：实验室里是定时器（每 gap 秒一发）；**这里删掉了定时器**，
 * 改由场景在浪拍岸的那一刻调 `audio.waveBreak()`。只有 chime 保留自己的随机调度 ——
 * 它按设计就"不跟着浪"。
 * ------------------------------------------------------------------------- */
let waveNodes = null;
let _waveMode = 'synth';        // 'synth' | 'real'，见 setWaveMode
const PENT = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2, 3];

function noiseBuffer(seconds = 4) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
/* 混响的脉冲响应：指数衰减的噪声。便宜，够用。 */
function impulse(seconds) {
  const n = Math.max(1, (ctx.sampleRate * seconds) | 0);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.4);
  }
  return b;
}

function buildWaves() {
  if (waveNodes || !ctx) return waveNodes;
  const M = WAVE_SOUND.master, L = WAVE_SOUND.layers;
  const noise = noiseBuffer(4);

  const out = ctx.createGain();
  out.gain.value = M.vol;                       // Iris 在实验室里定的总混合比
  out.connect(ambienceBus);                     // 场景的「浪声音量」和 duck 作用在这之后

  const conv = ctx.createConvolver();
  conv.buffer = impulse(M.rv);
  const revG = ctx.createGain();
  revG.gain.value = M.rvm;
  conv.connect(revG); revG.connect(ambienceBus);

  const G = {}, SEND = {};
  for (const k of Object.keys(L)) {
    G[k] = ctx.createGain(); G[k].gain.value = L[k].gain; G[k].connect(out);
    SEND[k] = ctx.createGain(); SEND[k].gain.value = (k === 'bed' ? 0.4 : 1);
    G[k].connect(SEND[k]); SEND[k].connect(conv);
  }

  // bed：唯一一层常驻的（滤过的噪音，只当一点空气感）
  const bedSrc = ctx.createBufferSource();
  bedSrc.buffer = noise; bedSrc.loop = true;
  const bedHP = ctx.createBiquadFilter(); bedHP.type = 'highpass'; bedHP.frequency.value = L.bed.hp;
  const bedLP = ctx.createBiquadFilter(); bedLP.type = 'lowpass';  bedLP.frequency.value = L.bed.lp;
  bedSrc.connect(bedHP); bedHP.connect(bedLP); bedLP.connect(G.bed);
  bedSrc.start();

  /* 电平表接在 out 之前，读的是"浪多猛"，不受音量/duck 影响。
   * 别拿它验证音量滑块 —— 那要看 ambienceBus 的 gain。 */
  const meter = ctx.createAnalyser(); meter.fftSize = 1024;
  out.connect(meter);

  waveNodes = { out, conv, revG, G, SEND, noise, bedHP, bedLP, meter,
                buf: new Float32Array(meter.fftSize), nextChime: ctx.currentTime + 1, waves: [] };
  return waveNodes;
}

/* ---- 真实录音那一版 ------------------------------------------------------
 * 和合成版**互斥**：Iris 2026-08-27 定 ——「两种加在一起会很奇怪」，
 * 所以纯真实浪就没有琴音，纯合成就没有录音。切换用 audio.setWaveMode()。
 * 素材路径按 audio.js 自己的位置解析，任何深度的页面都能用。 */
let realNodes = null, realLoading = null;
const REAL_DIR = new URL('../浪声素材/', import.meta.url).href;

async function buildReal() {
  if (realNodes) return realNodes;
  if (realLoading) return realLoading;
  realLoading = (async () => {
    const R = WAVE_REAL;
    const out = ctx.createGain(); out.gain.value = 0;      // 由 setWaveMode 打开
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = R.lp;
    const conv = ctx.createConvolver(); conv.buffer = impulse(R.rv);
    const revG = ctx.createGain(); revG.gain.value = R.rvm;
    const gWave = ctx.createGain(); gWave.gain.value = R.gain;
    gWave.connect(lp); lp.connect(out); lp.connect(conv);
    conv.connect(revG); revG.connect(out);
    out.connect(ambienceBus);
    const meter = ctx.createAnalyser(); meter.fftSize = 1024;
    out.connect(meter);
    const bufs = [];
    for (const f of R.files) {
      try {
        const r = await fetch(REAL_DIR + f);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        bufs.push(await ctx.decodeAudioData(await r.arrayBuffer()));
      } catch (e) { warnOnce('real:' + f, `浪声素材 ${f} 没载入：${e.message}`); }
    }
    realNodes = { out, gWave, bufs, meter, buf: new Float32Array(meter.fftSize) };
    realLoading = null;
    return realNodes;
  })();
  return realLoading;
}

/* 拍一次浪（录音版）：4 个素材随机取一个 + 随机变调 / 音量 / 声像。
 * 游戏音效的标准做法，四个片段就听不出重复了。 */
function fireReal(t, strength = 1) {
  const w = realNodes; if (!w || !w.bufs.length) return;
  const R = WAVE_REAL;
  const b = w.bufs[(Math.random() * w.bufs.length) | 0];
  const src = ctx.createBufferSource(); src.buffer = b;
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * R.pitch;
  const g = ctx.createGain();
  g.gain.value = (0.55 + Math.random() * 0.45) * Math.max(0.15, Math.min(1.4, strength));
  const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() * 2 - 1) * 0.35;
  src.connect(g); g.connect(pan); pan.connect(w.gWave);
  src.start(t);
}

/* 一记钟形音（琴音和风铃都用它）：基频 + 一个三倍泛音 */
function bell(t, f, amp, dec) {
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 3.01;
  const g = ctx.createGain(), g2 = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(amp, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(amp * 0.13, t + 0.006);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + dec * 0.45);
  o.connect(g); o2.connect(g2);
  o.start(t); o.stop(t + dec + 0.05);
  o2.start(t); o2.stop(t + dec * 0.5 + 0.05);
  return [g, g2];
}
const envAt = (d, A, R) => (d < 0 ? 0 : d < A ? d / A : (k => (k >= 1 ? 0 : Math.pow(1 - k, 2.2)))((d - A) / R));

/* 拍一次浪。strength 0..1 缩放力度（大浪响、小浪轻）。 */
function fireWave(t, strength = 1) {
  const w = waveNodes; if (!w) return;
  const M = WAVE_SOUND.master, L = WAVE_SOUND.layers, { G } = w;
  const A = M.atk, R = M.rel, D = A + R;
  const S = Math.max(0.15, Math.min(1.4, strength));
  w.waves.push({ t0: t, atk: A, rel: R });

  // ① 气泡：音高上滑的极短音（物理上的水声）
  if (L.bubble.gain > 0.001) {
    const n = (L.bubble.dens * S) | 0;
    for (let i = 0; i < n; i++) {
      const u = Math.pow(Math.random(), 0.7), tt = t + u * D * 0.85 + Math.random() * 0.05;
      const f0 = L.bubble.pit * (0.45 + Math.random() * 1.7);
      const dur = 0.018 + Math.random() * 0.055;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.25 + Math.random() * 0.5), tt + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.16 * (0.4 + Math.random() * 0.6) * S, tt + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
      o.connect(g); g.connect(G.bubble); o.start(tt); o.stop(tt + dur + 0.02);
    }
  }
  // ② 沙粒：极短噪声颗粒
  if (L.grain.gain > 0.001) {
    const n = (L.grain.dens * S) | 0;
    for (let i = 0; i < n; i++) {
      const u = Math.random(), tt = t + u * D * 0.9;
      const amp = envAt(u * D, A, R);
      if (amp < 0.05) continue;
      const src = ctx.createBufferSource(); src.buffer = w.noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.6;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = L.grain.tone * (0.6 + Math.random() * 0.9); bp.Q.value = 2.2;
      const g = ctx.createGain(), d = 0.004 + Math.random() * 0.008;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.34 * amp * S, tt + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + d);
      src.connect(bp); bp.connect(g); g.connect(G.grain);
      src.start(tt, Math.random() * 3); src.stop(tt + d + 0.02);
    }
  }
  // ③ 琴音：一串滚上去（偶尔滚下来）的五声音阶
  if (L.harp.gain > 0.001) {
    const n = L.harp.cnt | 0, sp = L.harp.spd / 1000;
    const up = Math.random() > 0.28;
    for (let i = 0; i < n; i++) {
      const idx = up ? i : (n - 1 - i);
      const f = M.key * 2 * PENT[(idx + (Math.random() < 0.25 ? 1 : 0)) % PENT.length] * (idx >= PENT.length ? 2 : 1);
      const tt = t + A * 0.25 + i * sp * (0.85 + Math.random() * 0.3);
      const [g] = bell(tt, f, 0.09 * (1 - i / (n * 1.9)) * S, 1.4 + Math.random() * 1.2);
      g.connect(G.harp);
    }
  }
  // ④ 气息：随浪起落的和声
  if (L.pad.gain > 0.001) {
    const det = L.pad.det, chord = [1, 3 / 2, 2, 5 / 2];
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(L.pad.tone * 0.5, t);
    lp.frequency.linearRampToValueAtTime(L.pad.tone, t + A);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, L.pad.tone * 0.4), t + D);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.075 * S, t + A);
    g.gain.exponentialRampToValueAtTime(0.0001, t + D);
    lp.connect(g); g.connect(G.pad);
    for (const [i, r] of chord.entries()) {
      const o = ctx.createOscillator(); o.type = i ? 'sine' : 'triangle';
      o.frequency.value = M.key * r * Math.pow(2, (Math.random() * 2 - 1) * det / 1200);
      o.connect(lp); o.start(t); o.stop(t + D + 0.1);
    }
  }
}

/* 风铃：按设计**不跟着浪**，自己随机响。场景每帧调一次就够。 */
function tickChime() {
  const w = waveNodes; if (!w || !ctx) return;
  const M = WAVE_SOUND.master, L = WAVE_SOUND.layers;
  const now = ctx.currentTime;
  if (L.chime.gain > 0.001) {
    while (w.nextChime < now + 0.4) {
      const f = M.key * L.chime.pit * PENT[(Math.random() * PENT.length) | 0];
      const [g] = bell(w.nextChime, f, 0.055, 2.2 + Math.random() * 1.8);
      g.connect(w.G.chime);
      w.nextChime += L.chime.rate * (0.5 + Math.random());
    }
  } else w.nextChime = now + 0.5;
  while (w.waves.length && w.waves[0].t0 + w.waves[0].atk + w.waves[0].rel < now - 0.5) w.waves.shift();
}

/* ---------------------------------------------------------------------------
 * 5 · 音乐后端
 *
 * 音乐层/player.js 提供实现；没有它的时候（比如唱机 viewer 单独打开），
 * play/pause 只改状态并广播，唱机照样能转 —— 便于单独调试 3D 表现。
 * ------------------------------------------------------------------------- */
let backend = null;

/* ---------------------------------------------------------------------------
 * 6 · 对外的 audio 对象
 * ------------------------------------------------------------------------- */
export const audio = {

  /* ---- 解锁 -------------------------------------------------------------
   * 浏览器禁止未交互就出声。ENTER 按钮的真正作用之一就是解锁音频。
   * 重复调用是安全的。 */
  async unlock() {
    if (!ctx && !buildGraph()) {
      warnOnce('noctx', '这个浏览器没有 AudioContext，环境层与音效层会静音（音乐层不受影响）。');
      return false;
    }
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* 用户还没真的交互过，下次再试 */ }
    }
    const ok = ctx.state === 'running';
    if (ok) emit('unlock', true);
    return ok;
  },

  get unlocked() { return !!ctx && ctx.state === 'running'; },

  /* 挂一个一次性的全局监听，任何点击/按键都会解锁。
   * 页面上有 ENTER 按钮的话，直接在按钮里 await audio.unlock() 更好。 */
  autoUnlock() {
    const go = () => { audio.unlock(); };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) {
      window.addEventListener(ev, go, { once: true, passive: true, capture: true });
    }
    return audio;
  },

  /* ---- 环境层 -----------------------------------------------------------
   * 循环播放的底噪。同一时刻只有一条环境音在响；换名字就交叉淡入淡出。
   * ambience(null) 淡出停掉。 */
  /* 开/关浪声。合成的，不需要任何音频文件。 */
  async waves(on = true, { fade = 1200 } = {}) {
    if (on) {
      if (!ctx) await audio.unlock();
      if (!ctx) return false;
      buildWaves();
      await audio.setWaveMode(_waveMode, { fade });
      return true;
    }
    if (waveNodes) ramp(waveNodes.out.gain, 0, fade);
    if (realNodes) ramp(realNodes.out.gain, 0, fade);
    return true;
  },

  /* 浪声用哪一版：'synth' 六层合成 ｜ 'real' 真实录音切片。
   * **互斥**（Iris 2026-08-27：两种叠在一起会很奇怪）。
   * 切换是淡入淡出的，拖面板不会"啪"一下。 */
  async setWaveMode(mode = 'synth', { fade = 700 } = {}) {
    _waveMode = mode === 'real' ? 'real' : 'synth';
    if (!ctx) return audio;
    if (_waveMode === 'real') await buildReal();
    if (waveNodes) ramp(waveNodes.out.gain, _waveMode === 'synth' ? WAVE_SOUND.master.vol : 0, fade);
    if (realNodes) ramp(realNodes.out.gain, _waveMode === 'real' ? WAVE_REAL.vol : 0, fade);
    return audio;
  },
  get waveMode() { return _waveMode; },

  /* 浪拍岸了 —— 场景在动画到那一帧的时候调。strength 0..1 大浪响小浪轻。
   * `when` 可以提前一点点排（Web Audio 的调度比 rAF 准）。 */
  waveBreak({ strength = 1, when = 0 } = {}) {
    if (!ctx) return audio;
    const t = ctx.currentTime + Math.max(0, when);
    if (_waveMode === 'real') fireReal(t, strength);
    else fireWave(t, strength);
    return audio;
  },

  /* 每帧调一次：推进风铃的随机调度、清理过期的浪。
   * 录音版没有风铃（纯真实浪 = 一点合成都不要），所以只在合成模式下跑。 */
  waveTick() { if (_waveMode === 'synth') tickChime(); return audio; },

  /* 当前包络（0..1），画面想跟着浪的声音动可以读它 */
  waveEnvelope() {
    const w = waveNodes; if (!w || !ctx) return 0;
    let a = 0;
    for (const v of w.waves) a = Math.max(a, envAt(ctx.currentTime - v.t0, v.atk, v.rel));
    return a;
  },
  get wavesOn() { return !!waveNodes; },

  /* 浪声这一刻的电平（RMS，0..1 量级）。在音量总线**之前**取的，
   * 所以它是"浪多猛"而不是"你听到多响"。确认真的在出声、或拿去驱动画面都可以。 */
  waveLevel() {
    const w = _waveMode === 'real' ? realNodes : waveNodes;
    if (!w) return 0;
    w.meter.getFloatTimeDomainData(w.buf);
    let sum = 0;
    for (let i = 0; i < w.buf.length; i++) sum += w.buf[i] * w.buf[i];
    return Math.sqrt(sum / w.buf.length);
  },

  defineAmbience(name, { url, gain = 1 } = {}) {
    AMBIENCE.set(name, { url, gain, buffer: null, node: null });
    return audio;
  },

  async ambience(name, { fade = 900 } = {}) {
    if (!ctx) await audio.unlock();
    if (!ctx) return false;

    /* 先把正在响的淡出 */
    for (const [key, a] of AMBIENCE) {
      if (key === name || !a.node) continue;
      const node = a.node, g = a.gainNode;
      a.node = null; a.gainNode = null;
      ramp(g.gain, 0, fade);
      setTimeout(() => { try { node.stop(); } catch { /* 已经停了 */ } }, fade + 60);
    }
    if (!name) return true;

    const a = AMBIENCE.get(name);
    if (!a) { warnOnce('amb:' + name, `环境音「${name}」还没登记（阶段 1.9b 录了再 defineAmbience）。`); return false; }
    if (a.node) return true;                       // 已经在响

    try {
      if (!a.buffer) a.buffer = await loadBuffer(a.url);
    } catch (err) {
      warnOnce('ambload:' + name, `环境音「${name}」载入失败：${err.message}`);
      return false;
    }
    const src = ctx.createBufferSource();
    src.buffer = a.buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g); g.connect(ambienceBus);
    src.start();
    ramp(g.gain, a.gain, fade);
    a.node = src; a.gainNode = g;
    return true;
  },

  /* ---- 音效层 -----------------------------------------------------------
   * 一次性音效。快门、碰杯、翻贝壳、唱针落下。 */
  defineSfx(name, { url, gain = 1 } = {}) {
    SFX.set(name, { url, gain, buffer: null });
    return audio;
  },

  async sfx(name, { gain, rate = 1 } = {}) {
    if (!ctx) return false;                        // 没解锁就别出声，也别报错
    const s = SFX.get(name);
    if (!s) { warnOnce('sfx:' + name, `音效「${name}」还没登记（阶段 1.9b）。`); return false; }
    try {
      if (!s.buffer) s.buffer = await loadBuffer(s.url);
    } catch (err) {
      warnOnce('sfxload:' + name, `音效「${name}」载入失败：${err.message}`);
      return false;
    }
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain ?? s.gain;
    src.connect(g); g.connect(sfxBus);
    src.start();
    return true;
  },

  /* ---- 音乐层 -----------------------------------------------------------
   * 别人的歌，走平台嵌入播放器。这里只是转发 + 持有状态。 */
  registerMusicBackend(impl) {
    backend = impl;
    commit({ ready: !!impl }, { force: true });
    return audio;
  },
  unregisterMusicBackend(impl) {
    if (backend === impl) {
      backend = null;
      commit({ ready: false, playing: false }, { force: true });
    }
    return audio;
  },

  /* 音乐层自己（player.js）用它把平台播放器的真实状态推回来。
   * 别的地方不要调 —— 唱机只读 state。 */
  _pushMusicState(patch) { commit(patch); },

  play(trackId, meta = {}) {
    if (backend?.play) { backend.play(trackId, meta); }
    else commit({ trackId: trackId ?? _state.trackId, playing: true, ...meta });
    return audio;
  },
  pause()  { backend?.pause ? backend.pause() : commit({ playing: false }); return audio; },
  toggle() { return _state.playing ? audio.pause() : audio.play(); },
  next()   { backend?.next?.();  return audio; },
  prev()   { backend?.prev?.();  return audio; },
  seek(sec) { backend?.seek?.(sec); return audio; },

  /* ---- 把 <audio> 接进这张图 -----------------------------------------------
   * player.js 建一个 <audio crossorigin="anonymous">，交给这里接线。
   * 一个 media element 只能 createMediaElementSource 一次，所以整个站
   * **只用同一个 <audio> 元素换 src**，不要每首歌新建一个。 */
  attachMusicElement(el) {
    if (!ctx && !buildGraph()) return null;      // 没有 AudioContext 就直接放，不接图
    if (musicSrc) return musicSrc;
    try {
      musicSrc = ctx.createMediaElementSource(el);
      musicSrc.connect(musicBus);
    } catch (e) {
      console.warn('[audio] 这个 <audio> 接不进 AudioContext，音乐将走系统直出：', e.message);
      musicSrc = null;
    }
    return musicSrc;
  },

  /* 音乐的低频能量 0..1。给唱片的转速抖动用；没在放就是 0。 */
  musicEnergy() {
    if (!analyser || !_state.playing) return 0;
    analyser.getByteFrequencyData(_freqData);
    let sum = 0;
    const n = Math.max(1, Math.floor(_freqData.length * 0.18));   // 只看低频那一段
    for (let i = 0; i < n; i++) sum += _freqData[i];
    return Math.min(1, sum / n / 200);
  },

  /* ---- 音量 -------------------------------------------------------------
   * 一个主音量 + 两条子轨（环境 / 音乐）。
   * 2026-08-26 起音乐也在我们的图里，所以主音量是真的管全部了 ——
   * 以前那条「这个滑块管不到 Spotify iframe」的免责说明可以删掉了。 */
  setVolume(v) {
    _volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (master) ramp(master.gain, _muted ? 0 : _volume, 120);
    emit('volume', { volume: _volume, muted: _muted, ambience: _ambVol, music: _musVol });
    return audio;
  },
  get volume() { return _volume; },

  setAmbienceVolume(v) {
    _ambVol = Math.max(0, Math.min(1, Number(v) || 0));
    if (ambienceBus) ramp(ambienceBus.gain, _ambVol, 120);
    emit('volume', { volume: _volume, muted: _muted, ambience: _ambVol, music: _musVol });
    return audio;
  },
  get ambienceVolume() { return _ambVol; },

  setMusicVolume(v) {
    _musVol = Math.max(0, Math.min(1, Number(v) || 0));
    if (musicBus) ramp(musicBus.gain, _musVol, 120);
    emit('volume', { volume: _volume, muted: _muted, ambience: _ambVol, music: _musVol });
    return audio;
  },
  get musicVolume() { return _musVol; },

  mute(on = true) {
    _muted = !!on;
    if (master) ramp(master.gain, _muted ? 0 : _volume, 120);
    emit('volume', { volume: _volume, muted: _muted });
    return audio;
  },
  get muted() { return _muted; },

  /* ---- 压低 / 恢复 -------------------------------------------------------
   * 播放器窗口打开时压低环境音，关闭时恢复。压低不是静音。 */
  duck(level = 0.25, ms = 320) {
    _duck = Math.max(0, Math.min(1, level));
    if (duckGain) ramp(duckGain.gain, _duck, ms);
    return audio;
  },
  unduck(ms = 520) {
    _duck = 1;
    if (duckGain) ramp(duckGain.gain, 1, ms);
    return audio;
  },
  get ducked() { return _duck < 1; },

  /* ---- 状态与事件 -------------------------------------------------------- */
  get state() { return { ..._state }; },

  /* on('change' | 'volume' | 'unlock', cb) → 返回退订函数 */
  on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(cb);
    return () => audio.off(event, cb);
  },
  off(event, cb) { listeners.get(event)?.delete(cb); return audio; },

  /* 调试用：看看图搭起来没有 */
  get context() { return ctx; },
};

export default audio;
