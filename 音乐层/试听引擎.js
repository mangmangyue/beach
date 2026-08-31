/* 试听引擎 —— 纯逻辑，**一行 DOM 都没有**。
 *
 * 2026-08-26：播放从 Spotify 的 iframe 换成 Apple 的 30 秒试听 m4a。
 * previewUrl 带 `Access-Control-Allow-Origin: *`，所以能 createMediaElementSource
 * 接进 共用/audio.js 那张图 —— 音乐和浪声走同一条总线，duck 是真的压低。
 *
 * 为什么单独一个文件：播放器长什么样归 UI 窗口，播放逻辑归主窗口。
 * UI 窗口整个重画 player.js 的 DOM 时，这个文件一个字都不用动。
 *
 * ⚠️ 三条踩过的规矩：
 *   1. **只有一个 <audio> 元素，换 src 不换元素。**
 *      一个 media element 只能 createMediaElementSource 一次，新建一个就断线。
 *   2. **时长一律读 el.duration，不要写死 30。**
 *      Apple 的规则是长曲子给 90 秒、短的给 30 秒，逐首不同。
 *      （2026-08-26 实测这 54 首碰巧全是 30 秒，但那是数据的巧合，不是接口的保证。）
 *   3. **play() 必须在用户手势里，或者 AudioContext 已经解锁过。**
 *      加载页的 ENTER 会调 audio.unlock()。
 *
 * 用法：
 *   const eng = createPreviewEngine({ onState, onEnded, onFail });
 *   eng.load(track, album); eng.play(); eng.pause(); eng.seek(sec);
 *   eng.state → { playing, position, duration, ready, loading, failed }
 */
import { audio } from '../共用/audio.js';

export function createPreviewEngine({ onState, onEnded, onFail } = {}) {
  /* 整个站只有这一个 <audio>。crossOrigin 必须在设 src 之前定，
   * 否则拿到的是 opaque 响应，接不进 AudioContext（也读不出频谱）。 */
  const el = new Audio();
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  el.volume = 1;                       // 音量走 AudioContext 的 musicBus，这里保持满

  let attached = false;
  let current = null;                  // { track, album, url }
  let failed = false;
  let loading = false;

  const state = () => ({
    playing: !el.paused && !el.ended && el.readyState > 2,
    position: el.currentTime || 0,
    duration: Number.isFinite(el.duration) ? el.duration : 0,
    ready: el.readyState > 0 && !failed,
    loading, failed,
    track: current?.track || null,
    album: current?.album || null,
  });

  const emit = () => onState?.(state());

  el.addEventListener('loadedmetadata', () => { loading = false; emit(); });
  el.addEventListener('canplay', emit);
  el.addEventListener('play', emit);
  el.addEventListener('pause', emit);
  el.addEventListener('timeupdate', emit);
  el.addEventListener('ended', () => { emit(); onEnded?.(); });
  el.addEventListener('error', () => {
    loading = false;
    failed = true;
    const code = el.error?.code;
    // 4 = SRC_NOT_SUPPORTED（多半是 CDN 链接过期或网络被挡）
    onFail?.(code === 4 ? '这一首的试听链接取不到了' : '音频加载失败');
    emit();
  });

  return {
    el,
    get state() { return state(); },

    /* 装一首。不自动播 —— 播放要由用户的手势触发。 */
    load(track, album) {
      const url = track?.applePreviewUrl;
      failed = false;
      current = { track, album, url };
      if (!url) { failed = true; onFail?.('这一首没有试听'); emit(); return false; }
      if (!attached) { audio.attachMusicElement(el); attached = true; }
      loading = true;
      el.src = url;
      el.load();
      emit();
      return true;
    },

    async play() {
      if (!current?.url || failed) return false;
      try {
        await audio.unlock();          // 没解锁过就先解锁；已解锁是便宜的 no-op
        await el.play();
        return true;
      } catch (e) {
        // NotAllowedError = 还没有用户手势。这不算故障，别弹兜底界面
        if (e?.name !== 'NotAllowedError') { failed = true; onFail?.('放不出来：' + e.message); }
        emit();
        return false;
      }
    },

    pause() { el.pause(); return true; },
    toggle() { return el.paused ? this.play() : (this.pause(), false); },

    seek(sec) {
      const d = state().duration;
      if (!d) return;
      el.currentTime = Math.max(0, Math.min(d - 0.05, sec));
      emit();
    },

    stop() { el.pause(); el.currentTime = 0; emit(); },
  };
}

export default createPreviewEngine;
