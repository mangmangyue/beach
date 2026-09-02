/* ============================================================================
 * 音乐层/player.js —— 唱机弹出的播放器窗口
 *
 * owner: 窗口 D。规格见 规格_音乐层.md。
 *
 *   点唱机 → openPlayer() → 千禧年窗口
 *     第一层 · 唱片架（封面网格）
 *     第二层 · 专辑内页（曲目列表）
 *     点某首歌 → 底部那条平台播放器换成它
 *
 * 边界（写死的，别越）：
 *   · 只用 Spotify，不做网易云双轨
 *   · **不托管任何 mp3**，音频全部由平台提供并授权
 *   · 不自动播放（浏览器禁止，跟版权无关）
 *   · 未登录访客听到 30 秒试听 —— 可接受，而且正好是「翻唱片架」的隐喻
 *
 * 这个文件里**没有任何视觉代码** —— 外观全部来自 共用/ui.css 的通用组件。
 * 播放器只是这套组件的第一个用户；许愿页面、简历页用同一批组件搭，不改组件。
 * ========================================================================== */

import { ui, h } from '../共用/ui.js';
import { audio } from '../共用/audio.js';
import { ALBUMS, SHELF } from './albums.js';
import { createPreviewEngine } from './试听引擎.js';

/* ---------------------------------------------------------------------------
 * 1 · Spotify id 的三种写法都认
 * Iris 从「分享 → 复制链接」粘过来的是整条 url，不该逼她手动剥成 22 位 id。
 * ------------------------------------------------------------------------- */
const ID_RE = /^[A-Za-z0-9]{22}$/;

function spotifyId(value, kind) {
  if (!value) return null;
  const s = String(value).trim();
  if (ID_RE.test(s)) return s;
  const m = s.match(new RegExp(`${kind}[:/]([A-Za-z0-9]{22})`));
  return m ? m[1] : null;
}
const albumId = v => spotifyId(v, 'album');
const trackId = v => spotifyId(v, 'track');

const albumUrl  = id => `https://open.spotify.com/album/${id}`;
const trackUrl  = id => `https://open.spotify.com/track/${id}`;
const searchUrl = q  => `https://open.spotify.com/search/${encodeURIComponent(q)}`;


/* ---------------------------------------------------------------------------
 * 2 · 播放
 *
 * **2026-08-26：整段 Spotify IFrame API + 朴素 iframe 的降级机器已删。**
 * 换成 Apple 的 30 秒试听 m4a，逻辑在 `音乐层/试听引擎.js`：
 *   · previewUrl 带 CORS *，能进我们自己的 AudioContext（共用/audio.js 的 musicBus）
 *   · 于是 duck 是真的压低、音量滑块管得到歌、还能取频谱驱动唱片
 *   · 播放条是我们自己的 DOM，不再有"底下那一条是平台的"这回事
 * Spotify 只剩外链（`spotifyAlbum` / `spotifyTrack` 保留就是为了它）。
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * 3 · 播放器窗口
 * ------------------------------------------------------------------------- */

/* 环境音该压低还是放回来：窗口开着、或者还在放歌，就压低。 */
function syncDuckFor(win) {
  if (!win || !win.parked || audio.state.playing) audio.duck(0.25);
  else audio.unduck();
}
let _open = null;   // 播放器只建一次；关掉是收起来，不是拆掉

/* 关掉窗口 ≠ 停止音乐。
 * 唱机是野餐垫上的一个物件 —— 你把唱片放上去，然后回沙滩上玩，它还在转。
 * 所以窗口用 keepAlive 收起来（iframe 留在 DOM 里不重载），
 * 真要停有底部那个「停」，或者场景里 audio.pause()。 */
export function openPlayer({ albums = ALBUMS, shelf = SHELF, onClose } = {}) {
  /* 已经开过就把它捞回来。注意要看 closed —— 调用方可能 destroy() 过，
   * 那时候 _open 还指着一个已经拆掉的窗口，reopen 它会得到一个空壳。 */
  if (_open && !_open.closed) { _open.reopen(); syncDuckFor(_open); return _open; }
  _open = null;

  const win = ui.window({
    title: shelf.title, sub: shelf.sub,
    width: '740px', height: '620px',
    fixedHeight: true,             // 唱片架 ⇄ 专辑内页来回切，窗口不该跟着一跳一跳
    keepAlive: true,               // 关掉只是收起 —— 歌不断
    onClose: () => {
      syncDuckFor(win);
      onClose?.();
    },
  });
  _open = win;

  /* 打开时把环境音压低（duck，不是静音 —— 规格_音乐层.md）。
   * 窗口收起来之后：还在放歌就继续压低，停了才放回来。 */
  audio.duck(0.25);

  /* --- 状态 ---------------------------------------------------------------
   * playing  = 播放器里装着哪首歌（跟着音频走，翻页不会变）
   * viewing  = 现在看的是哪一层（跟着导航走）
   * 两件事分开，从专辑页退回唱片架再点回来，选中高亮不会丢。 */
  const playing = { album: null, track: null, index: -1 };
  let viewing = null;
  let trackRows = [];

  /* --- 底部常驻的「正在放」 -----------------------------------------------
   * 放在窗口底部而不是专辑页内部：从专辑内页退回唱片架时 iframe 不会被拆掉，
   * 正在听的歌不会断。 */
  const npThumb = h('img.y2k-row__thumb', { alt: '', src: '' });
  const npTitle = h('span.y2k-row__title', '');
  const npSub   = h('span.y2k-row__sub', '');
  const npTag   = h('span.y2k-tag.y2k-tag--quiet', { hidden: true });

  /* 连播：一首试听放完，自动上下一首。
   * 未登录访客每首只有 30 秒，一首首手点很累；连着放才像「一张唱片在转」。
   *
   * ⚠️ 2026-08-31 Iris：「连播 / 停 这两个按钮我不太懂，删掉吧。」
   * 删的是**按钮**，不是行为 —— 连播原来默认就是开着的，她一直是在开着的状态下听的，
   * 所以这里保留 `autoNext = true`，只是不再给一个开关。想关的话改这一行。
   * 「停」也一样：关窗口歌照样继续放（那是设计），要停就按暂停。 */
  const autoNext = true;

  /* 放不出声时才出现的一行。平时不占位置。 */
  const npNotice = h('div.y2k-note', { hidden: true,
    style: { padding: '0 0 8px', display: 'flex', gap: '8px', alignItems: 'center' } });

  const nowPlaying = h('div.y2k-section.y2k-section--tight', { hidden: true },
    h('div.y2k-row.y2k-row--static', { style: { padding: '0 0 8px', gap: '8px' } },
      npThumb,
      h('span.y2k-row__main', npTitle, npSub),
      npTag,
    ),
    npNotice,
  );

  /* --- 播放条 -----------------------------------------------------------
   * ⚠️ 这一片 DOM 是**临时的能用版**，等 UI 窗口照设计系统重画。
   * 播放逻辑全在 音乐层/试听引擎.js 里，重画这块不用碰逻辑。
   * 时长一律读引擎给的 duration，**不要写死 30** —— Apple 长曲子给 90 秒。 */
  const fmt = t => {
    if (!Number.isFinite(t) || t < 0) t = 0;
    return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  };
  const npPlay = ui.btn({ label: '▶', size: 'sm', variant: 'primary', title: '播放 / 暂停',
                          onClick: () => (engine.state.playing ? engine.pause() : engine.play()) });
  const npPrev = ui.btn({ label: '⏮', size: 'sm', variant: 'ghost', title: '上一首', onClick: () => step(-1) });
  const npNext = ui.btn({ label: '⏭', size: 'sm', variant: 'ghost', title: '下一首', onClick: () => step(+1) });
  const npSeek = h('input.y2k-slider', {
    type: 'range', min: '0', max: '1000', value: '0', 'aria-label': '播放进度',
    style: { flex: '1', minWidth: '80px' },
    oninput: e => { const d = engine.state.duration; if (d) engine.seek(d * e.target.value / 1000); },
  });
  const npTime = h('span.y2k-row__meta', { style: { fontVariantNumeric: 'tabular-nums', minWidth: '76px', textAlign: 'right' } }, '0:00 / 0:00');
  const npVol = h('input.y2k-slider', {
    type: 'range', min: '0', max: '100', value: String(Math.round(audio.musicVolume * 100)),
    'aria-label': '音乐音量', style: { width: '72px' },
    oninput: e => audio.setMusicVolume(Number(e.target.value) / 100),
  });
  const transport = h('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', padding: '2px 0 4px' } },
    npPrev, npPlay, npNext, npSeek, npTime, h('span.y2k-field__label', '音量'), npVol);
  nowPlaying.appendChild(transport);

  let seeking = false;
  npSeek.addEventListener('pointerdown', () => { seeking = true; });
  addEventListener('pointerup', () => { seeking = false; });

  const engine = createPreviewEngine({
    onState: s => {
      /* 引擎的真实状态推回全局音频出口。
       * 唱机订阅 audio.on('change') 决定唱片转不转 —— 它不认识 Apple 也不认识 Spotify。 */
      audio._pushMusicState({
        playing: !!s.playing,
        position: s.position || 0,
        duration: s.duration || 0,
        ready: !!s.ready,
      });

      npPlay.textContent = s.playing ? '⏸' : '▶';
      npTime.textContent = `${fmt(s.position)} / ${fmt(s.duration)}`;
      if (!seeking) npSeek.value = String(s.duration ? Math.round(s.position / s.duration * 1000) : 0);
      npSeek.disabled = !s.duration;

      if (s.playing) {
        npTag.className = 'y2k-tag';
        npTag.hidden = false;
        ui.fill(npTag, h('span.y2k-dot'), '正在放');
        npNotice.hidden = true;
      } else {
        /* ⚠️ 「已暂停」和「待机」都不显示了（Iris 2026-08-31：看不懂，删掉）——
         * 暂停与否看播放键的图标就知道，多一个标签只是多分走一点注意力。
         * 「载入中 / 放不出来」留着：那两个是**只有这里说得出口**的信息。 */
        const msg = s.loading ? '载入中' : s.failed ? '放不出来' : '';
        npTag.className = 'y2k-tag y2k-tag--quiet';
        npTag.hidden = !msg;
        ui.fill(npTag, msg);
      }
      syncDuckFor(win);
      renderTrackStates();
    },

    /* 一段试听放完 → 自动接下一首（连播开着的时候） */
    onEnded: () => { if (autoNext) step(+1, { wrap: false }); },

    /* 加载失败：给封面 + 曲目表 + 两个平台的外链，**绝不留一个空的播放器框** */
    onFail: reason => {
      if (!playing.track) return;
      npNotice.hidden = false;
      ui.fill(npNotice,
        h('span', reason + '。可以去平台上听完整版：'),
        ui.btn({ label: 'Apple Music', size: 'sm', variant: 'ghost', ext: true, href: appleUrlFor(playing.album) }),
        ui.btn({ label: 'Spotify', size: 'sm', variant: 'ghost', ext: true, href: openUrlFor(playing.album) }),
      );
    },
  });

  /* --- 把音乐层接进全局音频出口 -------------------------------------------
   * 之后唱机只要 audio.play() / audio.pause()，完全不用认识 Spotify。 */
  const backend = {
    play(tid) {
      if (tid) {
        const found = findTrack(tid);
        if (found) return selectTrack(found.album, found.index);
      }
      engine.play();
    },
    pause() { engine.pause(); },
    next()  { step(+1); },
    prev()  { step(-1); },
    seek(sec) { engine.seek(sec); },
  };
  audio.registerMusicBackend(backend);

  function findTrack(tid) {
    const id = trackId(tid);
    for (const album of albums) {
      const index = album.tracks.findIndex(t => trackId(t.spotifyTrack) === id);
      if (index >= 0) return { album, index };
    }
    return null;
  }

  function step(delta, { wrap = true } = {}) {
    if (!playing.album || playing.index < 0) return false;
    const n = playing.album.tracks.length;
    if (!n) return false;
    const next = playing.index + delta;
    if (!wrap && (next < 0 || next >= n)) return false;   // 一张碟放完就停，不绕回第一首
    selectTrack(playing.album, (next + n) % n);
    return true;
  }

  /* ======================= 第一层 · 唱片架 ================================ */
  const shelfView = ui.scroll(
    ui.section(
      /* legend「唱片架」删了（Iris 2026-08-31）—— 标题栏已经写着 VINYL，
       * 一个窗口不需要把自己的名字说两遍。 */
      albums.length
        ? ui.grid(albums.map(album => ui.card({
            cover: album.cover,
            alt: `${album.title} 封面`,
            label: album.title,
            sub: [album.artist, album.year].filter(Boolean).join(' · '),
            flag: albumId(album.spotifyAlbum) ? null : ui.tag({ label: '未接入', variant: 'quiet' }),
            onClick: () => showAlbum(album),
          })))   /* 列宽交给 ui.css 的 --y2k-card-w —— 这样窄屏的媒体查询才管得着 */
        : ui.state({
            kind: 'empty',
            title: '架子是空的',
            text: '往 音乐层/albums.js 里加一张专辑，它就会出现在这儿。',
          }),
    ),
  );

  function showShelf() {
    viewing = null;
    trackRows = [];
    win.setAccent(playing.album?.accent || null);   // 架子上就跟着「正在放」的那张
    win.setTitle(shelf.title, shelf.sub);
    win.setView(shelfView, nowPlaying);
    /* 原来这里有一行 ui.note（「关掉窗口歌会继续放 —— 唱片还在转。」/ shelf.blurb），
     * 2026-08-31 Iris 要求删掉。行为没变，关掉窗口歌照样继续放。 */
    win.setFooter(ui.spacer(), ambienceControl());
  }

  /* ======================= 第二层 · 专辑内页 ============================== */
  function showAlbum(album) {
    viewing = album;
    trackRows = [];
    /* 整块玻璃染成这张碟的颜色。底下那条 Spotify 播放条的底色也是从封面取的，
     * 染过之后它就不像一块外来的色块，而像是同一件东西的一部分。 */
    win.setAccent(album.accent || null);
    const aid = albumId(album.spotifyAlbum);

    win.setTitle(shelf.title, album.title);

    const head = h('div.y2k-section',
      h('div', { style: { display: 'flex', gap: '14px', alignItems: 'flex-start' } },
        h('span.y2k-card__art', { style: { flex: 'none', width: '96px' } },
          h('img', { src: album.cover, alt: `${album.title} 封面` }),
        ),
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', { style: { fontSize: '17px', fontWeight: '700', lineHeight: '1.3' } }, album.title),
          h('div.y2k-note', { style: { marginTop: '4px' } },
            [album.artist, album.year, album.tracks.length ? `${album.tracks.length} 首` : null]
              .filter(Boolean).join(' · ')),
          /* note 是可选的：有值才显示，现在都空着（规格） */
          album.note && h('div.y2k-note', { style: { marginTop: '6px' } }, album.note),
          h('div', { style: { display: 'flex', gap: '6px', marginTop: '9px', flexWrap: 'wrap' } },
            aid ? ui.tag({ label: '30 秒试听', variant: 'citron' })
                : ui.tag({ label: '未接入 Spotify', variant: 'quiet' }),
          ),
        ),
      ),
    );

    let content;
    if (!aid) {
      /* 这张碟不在 Spotify 上（比如 玲子4.0）。不假装，直接说清楚。 */
      content = ui.state({
        kind: 'empty', icon: '◍',
        title: '这张还没接上 Spotify',
        text: '架子上有这张碟，但 Spotify 上没找到对得上的版本，所以这里放不了。'
            + '在 音乐层/albums.js 里把 spotifyAlbum 填上，它就能听了。',
        actions: [ui.btn({
          label: '去 Spotify 搜', variant: 'primary', ext: true,
          href: searchUrl(`${album.title} ${album.artist}`),
        })],
      });
    } else if (!album.tracks.length) {
      content = ui.state({
        kind: 'empty', icon: '◌',
        title: '还没有曲目',
        text: '这张专辑的 tracks 是空的。整张听可以直接去 Spotify。',
        actions: [ui.btn({ label: '在 Spotify 中打开', href: albumUrl(aid), variant: 'primary', ext: true })],
      });
    } else if (!album.tracks.some(t => t.applePreviewUrl)) {
      /* 兜底：封面 + 专辑名 + 曲目列表 + 两个大按钮。**永远不要出现一个空的播放器框。**
       * 这个界面必须好看 —— 它是最坏情况下访客看到的东西（规格 · 兜底）。
       * 触发条件 2026-08-26 改了：以前是"iframe 加载失败"，现在是"这张碟一首试听都没有"。
       * 单首加载失败不走这里，走 nowPlaying 里那行 npNotice。 */
      content = h('div',
        ui.section(ui.state({
          kind: 'error', icon: '⚠',
          title: '这张暂时没有试听',
          text: '曲目还在，去平台上一样能听完整版。',
          actions: [
            ui.btn({ label: '在 Apple Music 中打开', href: appleUrlFor(album), variant: 'primary', size: 'lg', ext: true }),
            ui.btn({ label: '在 Spotify 中打开', href: albumUrl(aid) || openUrlFor(album), ext: true }),
          ],
        })),
        ui.divider(),
        trackList(album, { linkOnly: true }),
      );
    } else {
      content = trackList(album);
    }

    win.setView(ui.scroll(head, ui.divider(), content), nowPlaying);
    showFooterFor(album);
    renderTrackStates();
  }

  /* Apple Music 的外链。逐曲深链需要 ?i=<appleTrackId>。 */
  function appleUrlFor(album) {
    if (!album?.appleUrl) return 'https://music.apple.com/';
    if (playing.album === album && playing.track?.appleTrackId)
      return `${album.appleUrl}?i=${playing.track.appleTrackId}`;
    return album.appleUrl;
  }

  /* 有选中的歌就链到那首歌，没有就链整张；都没有就去搜。 */
  function openUrlFor(album) {
    if (!album) return 'https://open.spotify.com/';
    const aid = albumId(album.spotifyAlbum);
    if (playing.album === album && playing.track) {
      const tid = trackId(playing.track.spotifyTrack);
      if (tid) return trackUrl(tid);
    }
    return aid ? albumUrl(aid) : searchUrl(`${album.title} ${album.artist}`);
  }

  function showFooterFor(album) {
    // 两个平台的外链都给 —— 访客用哪个都有去处（Iris 2026-08-26）
    win.setFooter(
      ui.btn({ label: '返回', icon: '←', variant: 'ghost', onClick: showShelf }),
      ui.spacer(),
      ambienceControl(),
      ui.btn({ label: 'Apple Music', href: appleUrlFor(album), ext: true }),
      ui.btn({ label: 'Spotify', href: openUrlFor(album), ext: true }),
    );
  }

  function trackList(album, { linkOnly = false } = {}) {
    const rows = album.tracks.map((t, i) => {
      const tid = trackId(t.spotifyTrack);
      const sub = [t.artist && t.artist !== album.artist ? t.artist : null, t.note]
        .filter(Boolean).join(' · ') || null;

      if (linkOnly && tid) {
        /* 兜底模式：每一行变成一个外链，列表仍然有用 */
        const node = h('a.y2k-row.y2k-row--static', {
          href: trackUrl(tid), target: '_blank', rel: 'noopener noreferrer',
          style: { textDecoration: 'none', cursor: 'pointer' },
        },
          h('span.y2k-row__index', String(i + 1)),
          h('span.y2k-row__main', h('span.y2k-row__title', t.title),
            sub && h('span.y2k-row__sub', sub)),
          h('span.y2k-row__meta', t.duration || ''),
        );
        return node;
      }

      const can = !!t.applePreviewUrl;        // 能不能试听看 Apple，不看 Spotify
      const node = ui.row({
        index: i + 1,
        title: t.title,
        sub,
        meta: t.duration,
        static: !can,
        onClick: can ? () => selectTrack(album, i) : undefined,
      });
      trackRows.push({ node, album, index: i });
      return node;
    });
    return ui.list(rows);
  }

  /* --- 选曲 --------------------------------------------------------------- */
  function selectTrack(album, index) {
    const t = album.tracks[index];
    if (!t?.applePreviewUrl) return;          // 没有试听源就不装碟
    const tid = trackId(t.spotifyTrack);

    playing.album = album; playing.track = t; playing.index = index;

    npThumb.src = album.cover;
    npTitle.textContent = t.title;
    npSub.textContent = [t.artist || album.artist, album.title].filter(Boolean).join(' — ');
    nowPlaying.hidden = false;
    npNotice.hidden = true;

    audio._pushMusicState({
      trackId: tid,
      albumId: albumId(album.spotifyAlbum),
      title: t.title,
      artist: t.artist || album.artist,
      album: album.title,
      cover: album.cover,        // 唱机把它贴到黑胶的标签上；小窗口也用它当缩略图
      accent: album.accent || null,
      /* 换歌这一瞬间要显式标成「没在放」。不然新歌名配着上一首的 playing:true，
       * 唱片会在装新碟的空档继续转一下，看着像卡了。 */
      playing: false,
      position: 0, duration: 0,
    });

    engine.load(t, album);
    engine.play();                            // 点了曲目就是要听，这本来就在用户手势里
    renderTrackStates();
    if (viewing) showFooterFor(viewing);      // 外链跟着换成这首歌
  }

  /* 选中 / 播放中的高亮。状态只有一份，重画时统一刷。 */
  function renderTrackStates() {
    const isPlaying = audio.state.playing;
    for (const r of trackRows) {
      const on = r.album === playing.album && r.index === playing.index;
      r.node.classList.toggle('is-active', on);
      r.node.classList.toggle('is-playing', on && isPlaying);
    }
  }

  /* --- 环境音音量 ----------------------------------------------------------
   * ⚠️ 这个滑块只管**环境音**（浪 + 黑胶底噪 + 物件音效）。
   * 平台 iframe 的音频不经过我们的 AudioContext，歌的音量在 Spotify 那条播放条里。
   * 所以标签必须写「环境音」，不能只写「音量」（规格_音乐层.md）。 */
  function ambienceControl() {
    return h('label', {
      title: '只管浪声（黑胶底噪以后也走这条）；歌的音量是右边那条',
      style: { display: 'flex', alignItems: 'center', gap: '8px' },
    },
      h('span.y2k-field__label', '环境音'),
      h('input.y2k-slider', {
        type: 'range', min: 0, max: 100, step: 1,
        value: String(Math.round(audio.ambienceVolume * 100)),
        'aria-label': '环境音音量（不含歌曲）',
        style: { width: '92px' },
        // 2026-08-26：以前调的是 audio.setVolume（主音量）。音乐进了同一张图之后，
        // 主音量会连歌一起调，滑块就名不副实了 —— 改成只调环境子轨
        oninput: e => audio.setAmbienceVolume(Number(e.target.value) / 100),
      }),
    );
  }

  showShelf();
  return win;
}

export default openPlayer;
