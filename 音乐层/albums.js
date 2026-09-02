/* ============================================================================
 * 音乐层/albums.js —— 唱片架的内容。**这是纯数据，改它不用碰任何代码。**
 *
 * 加一张专辑：
 *   1. 把封面丢进 音乐层/covers/（正方形，512×512 左右就够，jpg）
 *   2. 在 Spotify 里对着专辑「分享 → 复制链接」
 *   3. 在下面照抄一段，粘上去
 *
 * ⚠️ **2026-08-26：播放走 Apple，不再嵌 Spotify 的 iframe。**
 *   `applePreviewUrl`  30 秒试听的 m4a，带 CORS *，直接进我们的 AudioContext
 *   `appleTrackId`     Apple 的曲目 id
 *   `appleUrl`         「在 Apple Music 中打开」的专辑页
 *   这三个是 2026-08-26 从 iTunes Search / Lookup API 一次性抓下来的，
 *   原始数据在 `音乐层/试听覆盖率调查.json`（含每首实测时长）。
 *   **别为了补一首歌去重跑整个抓取** —— iTunes Search API 约 120 次请求就开始 403。
 *   补单张碟用 lookup（一次请求一整张）：
 *     https://itunes.apple.com/lookup?id=<appleAlbumId>&entity=song&limit=200&country=us
 *
 * ⚠️⚠️ **补数据时一律按 lookup 返回的 trackNumber 对位，绝对不要用歌名匹配。**
 *   第一版就是用歌名打分配的，54 首里配错 10 首（2026-08-26 Iris 发现的）：
 *     · 归一化时把括号内容当注释剥掉了 → "How Sweet (Instrumental)" 和人声版打成满分，
 *       伴奏版全指向了人声版（How Sweet / Bubble Gum / Right Now 三首）
 *     · Nujabes 的 "Luv (sic)" 和 "Luv (sic.) pt3" 双双配到了**另一张专辑** Modal Soul
 *     · NJWMX 在 Apple 上有两个版本（1719868691 是 [Alternate]、1719675892 才是 [Instrumental]），
 *       混着配了 5 首。我们用的是 1719675892 那版。
 *   歌名匹配在这个曲库上就是不可靠的：中日文碟 Apple 用罗马字/英译名
 *   （夏の続き→Natsuno Tsuduki、科幻小說→Sci-fi、結晶→The moment）。
 *
 * `spotifyAlbum` / `spotifyTrack` **保留不删** —— 「在 Spotify 中打开」这个外链出口还要用。
 * 两个平台的外链都留着，访客用哪个都有去处。
 *
 * spotifyAlbum / spotifyTrack 三种写法都认（player.js 会自己剥）：
 *   '4N1fROq2oeyLGAlQ1C1j18'
 *   'spotify:album:4N1fROq2oeyLGAlQ1C1j18'
 *   'https://open.spotify.com/album/4N1fROq2oeyLGAlQ1C1j18?si=…'
 *
 * 可选字段：
 *   note      一句话注释。专辑和单曲都能写，**有值才显示**，现在都空着。
 *   tracks[].artist   合辑里某首歌的实际艺人（和专辑艺人不同时才写）
 *
 * spotifyAlbum 留空（null）也没关系 —— 唱片架照样收这张碟，
 * 点进去是「这张还没接上 Spotify」的兜底页，带一个去 Spotify 搜索的按钮。
 *
 * ⚠️ 兜底界面**留着**（封面 + 曲目表 + 两个外链大按钮），但触发条件变了：
 * 以前是"这张碟在你的地区没授权"，现在是**音频加载失败**（断网、CDN 挂了）。
 * 永远不要出现一个空的播放器框。
 *
 * 曲目和曲长来自 Spotify 官方 embed 数据（2026-08-22 核对）；
 * apple* 三个字段来自 iTunes API（2026-08-26 核对）。
 * ========================================================================== */

export const ALBUMS = [
  /* ⚠️ **数组的顺序就是唱片架上的顺序**，代码不会再排一遍。
   * 2026-09-01 Iris 定的：**从新到旧**，其中 How Sweet 排在 Supernatural 前面
   * （两张都是 2024，谁在前是她挑的，不是日期算出来的 —— 所以别加自动排序，
   *   加了就把这个手排的选择冲掉了，和 照片/清单.json 那边是同一条规矩）。 */
  {
    id: 'happy-happy',
    title: '如果每天都可以 happy happy 誰想要sad:)) - 一起去度假',
    artist: '陳嫺靜',
    year: 2025,
    cover: 'covers/happy-happy.jpg',
    accent: '#C78257',
    vinyl: '#8F5A32',   // 封面里那个棕（accent 偏橙，Iris 08-29 要棕）
    spotifyAlbum: '4IVCRrXA13fqInFbyhN4y9',
    appleAlbumId: 1799903617,
    appleUrl: 'https://music.apple.com/us/album/new-notes/1799903617',
    tracks: [
      { title: 'New notes'                    , duration: '3:14', spotifyTrack: '4PwO55sEmOZr89pNhCUFuY',
        appleTrackId: 1799903620, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/5a/24/44/5a24449d-c2a8-71c1-dbe6-85e4456a0ee3/mzaf_8158187045711020970.plus.aac.p.m4a',  },
      { title: 'e04嘛那麼累'                      , duration: '2:15', spotifyTrack: '1CjKw3Php8zVhaHvNFLIeD',
        appleTrackId: 1799903622, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/8c/71/60/8c716077-638c-da47-97a7-db6de9afcefe/mzaf_194999288671456112.plus.aac.p.m4a',  },
      { title: 'Super hyper'                  , duration: '3:14', spotifyTrack: '58CEgJTbh9XNJG70GSeS3B',
        appleTrackId: 1799903623, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/8c/83/76/8c8376d8-427c-e887-5954-446f4311a6e8/mzaf_17576478634229073173.plus.aac.p.m4a',  },
      { title: '科幻小說'                         , duration: '2:57', spotifyTrack: '416Z4twQflY6NmXtxI013g',
        appleTrackId: 1799903625, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/37/37/70/37377096-bd72-cd0f-1983-d6744df82d9d/mzaf_8297350837692810214.plus.aac.p.m4a',  },
      { title: '吸塵器 維他命'                      , duration: '5:47', spotifyTrack: '1brkyYuqCUGB66g2c7auZc',
        appleTrackId: 1799903627, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/ac/4e/bc/ac4ebcb7-c0c4-1367-5128-33c6a6f17dad/mzaf_3618712220723385462.plus.aac.p.m4a',  },
      { title: 'Whisper to my ear'            , duration: '3:10', spotifyTrack: '2wm8sD5ZG6MNJUl9j6haT2',
        appleTrackId: 1799903628, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/a9/d4/2e/a9d42e45-e869-b9ca-b31a-fefb47dd4206/mzaf_18199785153109631864.plus.aac.p.m4a',  },
      { title: '春雨'                           , duration: '4:19', spotifyTrack: '5naJyBiXYbtXhYNPBA2nr6',
        appleTrackId: 1799903629, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/af/81/09/af810999-e8c7-7191-2ed7-8bb24039bc62/mzaf_11478487524077249121.plus.aac.p.m4a',  },
      { title: '結晶'                           , duration: '3:50', spotifyTrack: '1X1mGJZnRRxdC1zuzyRVE5',
        appleTrackId: 1799903750, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/21/6e/4b/216e4b62-7d0b-7baf-21ab-5602a0929e55/mzaf_8315761872415470107.plus.aac.p.m4a',  },
      { title: 'Wui229'                       , duration: '3:00', spotifyTrack: '6ys5ZWv1RTBlwBs1vRFyd1',
        appleTrackId: 1799903751, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/59/b9/f4/59b9f44d-308e-db3d-298c-15e4e3ee0fd3/mzaf_7688935202351904198.plus.aac.p.m4a',  },
      { title: '如果每天都可以 happy happy 誰想要sad:))', duration: '4:28', spotifyTrack: '5u6xwrIwh9cPW9VXCODU7v',
        appleTrackId: 1799903752, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/d5/ff/93/d5ff93a7-2c0b-e2c4-f64f-bf23c3609498/mzaf_13594939706966217636.plus.aac.p.m4a',  },
    ],
  },
  {
    id: 'how-sweet',
    title: 'How Sweet',
    artist: 'NewJeans',
    year: 2024,
    cover: 'covers/how-sweet.jpg',
    accent: '#578EC7',
    vinyl: '#EDEAE4',   // 白色透明（奶白磨砂）
    spotifyAlbum: '0EhZEM4RRz0yioTgucDhJq',
    appleAlbumId: 1744448415,
    appleUrl: 'https://music.apple.com/us/album/how-sweet/1744448415',
    tracks: [
      { title: 'How Sweet'                , duration: '3:39', spotifyTrack: '38tXZcL1gZRfbqfOG0VMTH',
        appleTrackId: 1744448416, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/4d/f8/ec/4df8ec06-579b-0b92-1c4d-d8714cc5d1bc/mzaf_8361635933595309894.plus.aac.p.m4a',  },
      { title: 'Bubble Gum'               , duration: '3:20', spotifyTrack: '19D8LNpWwIPpi6hs9BG7dq',
        appleTrackId: 1744448549, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/94/d6/aa/94d6aab6-6654-5aca-dbf8-9874b7975bcd/mzaf_16231939766265640228.plus.aac.p.m4a',  },
      { title: 'How Sweet (Instrumental)' , duration: '3:39', spotifyTrack: '54tBIDmNdxGp04gPNWCCbi',
        appleTrackId: 1744448551, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/66/1e/53/661e53a0-7b94-a107-5566-3c0965ecbe9a/mzaf_16927712233418403912.plus.aac.p.m4a',  },
      { title: 'Bubble Gum (Instrumental)', duration: '3:20', spotifyTrack: '54uNtM77iZ5gawWBQGnEar',
        appleTrackId: 1744448555, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/55/cf/ca/55cfca9e-66fb-39a8-ed00-72e587332ed0/mzaf_14657405780734511175.plus.aac.p.m4a',  },
    ],
  },
  {
    id: 'supernatural',
    title: 'Supernatural',
    artist: 'NewJeans',
    year: 2024,
    cover: 'covers/supernatural.jpg',
    accent: '#1FCEFF',
    /* vinyl = 这张专辑放的时候彩胶的颜色（Iris 08-29 逐张选的；写什么色就是什么色，
     * 不做糖果化）。没有 vinyl 字段的专辑回落到 accent（会糖果化）。 */
    vinyl: '#262A33',   // 黑色透明（烟熏）。Iris 的备选：粉色透明 '#E784A6'，两个都渲过图
    spotifyAlbum: '1FVw30SoC91lq1UZ6N9rwN',
    appleAlbumId: 1750576829,
    appleUrl: 'https://music.apple.com/us/album/supernatural/1750576829',
    tracks: [
      { title: 'Supernatural'               , duration: '3:11', spotifyTrack: '5ocSQW5sIUIOFojwXEz9Ki',
        appleTrackId: 1750576834, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/41/ce/f9/41cef96a-6b48-2ddd-72a8-f479e7a1c752/mzaf_5570335600994446876.plus.aac.p.m4a',  },
      { title: 'Right Now'                  , duration: '2:40', spotifyTrack: '58Q3FZFs1YXPpliWQB5kXB',
        appleTrackId: 1750576838, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/d9/a5/ff/d9a5ff09-9936-60c3-322d-6541eb8228a0/mzaf_8507832924895951906.plus.aac.p.m4a',  },
      { title: 'Supernatural (Instrumental)', duration: '3:11', spotifyTrack: '4823f9W4xmR3n1BebPyNaR',
        appleTrackId: 1750576846, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/54/37/ea/5437eafd-88eb-1bd8-8820-a7db4e10e6b8/mzaf_2206439411773151287.plus.aac.p.m4a',  },
      { title: 'Right Now (Instrumental)'   , duration: '2:40', spotifyTrack: '6jgUrLEivd4DaiYb1izJLF',
        appleTrackId: 1750576848, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/ca/f5/08/caf50809-faf4-7a50-f4d5-3ca9eaf0bf33/mzaf_4788667005915297884.plus.aac.p.m4a',  },
    ],
  },
  {
    id: 'njwmx',
    title: 'NJWMX',
    artist: 'NewJeans',
    year: 2023,
    cover: 'covers/njwmx.jpg',
    accent: '#57C763',
    vinyl: '#2D7739',   // 封面画里那个深绿（accent 的绿太浅亮，Iris 08-29）
    spotifyAlbum: '6XRGc3GNodkhSrPwHnx1KX',
    appleAlbumId: 1719675892,
    appleUrl: 'https://music.apple.com/us/album/njwmx/1719675892',
    tracks: [
      { title: 'Ditto (250 Remix)'                   , duration: '3:22', spotifyTrack: '6JVXVLqCPaodBSEwRFUN8w',
        appleTrackId: 1719675894, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/9c/24/22/9c2422b8-bd90-73ef-dc91-53447501defd/mzaf_3220046181659171521.plus.aac.p.m4a',  },
      { title: 'OMG (FRNK Remix)'                    , duration: '3:30', spotifyTrack: '4yjDMKCAeLovlo9ih0AgXW',
        appleTrackId: 1719675900, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/c7/8a/ce/c78ace6e-d0cf-39d5-2cf8-03f0f47757eb/mzaf_6157086767733036339.plus.aac.p.m4a',  },
      { title: 'Attention (250 Remix)'               , duration: '3:01', spotifyTrack: '2nW48vXnZZ5EYka46v7GOk',
        appleTrackId: 1719675905, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/1c/f8/8c/1cf88c7d-d53c-0390-df4f-4c811fd5656f/mzaf_5270976809792294234.plus.aac.p.m4a',  },
      { title: 'Hype Boy (250 Remix)'                , duration: '4:11', spotifyTrack: '6CUKsv928uT4561qJovhhG',
        appleTrackId: 1719675908, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/83/81/38/8381388c-174f-9d14-2195-c2d05e9928a1/mzaf_2004875623485883148.plus.aac.p.m4a',  },
      { title: 'Cookie (FRNK Remix)'                 , duration: '3:32', spotifyTrack: '5bwpbZBOY0mrmRhZ94c0kW',
        appleTrackId: 1719675909, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/23/e2/b1/23e2b1ca-bb55-495e-144f-66428ef087e4/mzaf_1255983532844140691.plus.aac.p.m4a',  },
      { title: 'Hurt (250 Remix)'                    , duration: '3:44', spotifyTrack: '2gWWYL6iXZKkOqCE3TQHBM',
        appleTrackId: 1719675914, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/c2/8e/d7/c28ed715-c3ba-3783-5b4e-099043cb484d/mzaf_9812539762910171858.plus.aac.p.m4a',  },
      { title: 'Ditto (250 Remix) (Instrumental)'    , duration: '3:22', spotifyTrack: '3dCCHYqCAMdm1GCuklUaZG',
        appleTrackId: 1719675916, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/fb/77/7b/fb777be1-35d9-fcd2-e0e9-73e7196f2dc5/mzaf_11884354558156667393.plus.aac.p.m4a',  },
      { title: 'OMG (FRNK Remix) (Instrumental)'     , duration: '3:30', spotifyTrack: '2oLVT9Lo0SavCNpGw4WfPp',
        appleTrackId: 1719676158, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/bb/bf/35/bbbf3523-8048-6322-8876-36e59b0de8e1/mzaf_7696172654545998345.plus.aac.p.m4a',  },
      { title: 'Attention (250 Remix) (Instrumental)', duration: '3:01', spotifyTrack: '4MhgDz4lSj2HtlUcpe3yrd',
        appleTrackId: 1719676164, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/94/58/d8/9458d887-c4f3-9250-f13e-d28cc828b2a7/mzaf_8373480962038954727.plus.aac.p.m4a',  },
      { title: 'Hype Boy (250 Remix) (Instrumental)' , duration: '4:11', spotifyTrack: '6tU4EeTSSawN9sbfAjWPX4',
        appleTrackId: 1719676166, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/ae/00/10/ae0010ea-653e-9b96-f933-9f9e795d7862/mzaf_6851475643826315235.plus.aac.p.m4a',  },
      { title: 'Cookie (FRNK Remix) (Instrumental)'  , duration: '3:32', spotifyTrack: '2akxtSALPUX8orriSWyDi4',
        appleTrackId: 1719676279, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/6f/3f/39/6f3f39be-c47d-5741-668f-635a43e1d09a/mzaf_6344091502621127882.plus.aac.p.m4a',  },
      { title: 'Hurt (250 Remix) (Instrumental)'     , duration: '3:37', spotifyTrack: '1q9V1vsIEehAm2hDT6l53g',
        appleTrackId: 1719676306, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/b3/cc/39/b3cc3972-c66a-ac4a-a763-b7ac19e4f169/mzaf_3872730702217111820.plus.aac.p.m4a',  },
    ],
  },
  {
    id: 'kei-nujabes',
    title: 'Kei Nishikori meets Nujabes',
    artist: 'Nujabes',
    year: 2016,
    cover: 'covers/kei-nujabes.jpg',
    accent: '#1FCDFF',
    /* ⚠️ 这张的彩胶色**不在这里** —— Iris 要在面板色盘上直接调，
     * 所以住在 共用/constitution.js 的 ENV.vinylNujabesC（面板「颜色」区有它）。
     * 历程：糖果黄 #EFD98A → 奶油黄 #EAD79B（发光）→ 向日葵金 #E3C173 → 更浅更灰一档。 */
    spotifyAlbum: '2267JWMfKfqwPLNYkfDOl2',
    appleAlbumId: 1078923064,
    appleUrl: 'https://music.apple.com/us/album/another-reflection/1078923064',
    tracks: [
      { title: 'Another Reflection'               , duration: '3:45', spotifyTrack: '1wHl96hFeSYuLZhsImff2g',
        appleTrackId: 1078923065, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/6d/fc/d3/6dfcd36c-dab0-6c1b-9341-06cb17b3d631/mzaf_18131513798374305675.plus.aac.p.m4a',  },
      { title: 'Spiritual State'                  , duration: '6:33', spotifyTrack: '2W9rm7y98nLJeTocWNGNdf',
        appleTrackId: 1078923066, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/3e/fa/84/3efa849b-b445-e782-3cd4-231befd0ec62/mzaf_6271436488190275266.plus.aac.p.m4a',  artist: 'Nujabes, Uyama Hiroto', },
      { title: 'Luv (sic) pt2'                    , duration: '4:35', spotifyTrack: '3A5nUGT7jOzzHy4MjSApac',
        appleTrackId: 1078923067, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/7d/0f/be/7d0fbec9-a2b1-b386-0a5b-5a308b9e29d3/mzaf_9504001162444648229.plus.aac.p.m4a',  artist: 'Shing02', },
      { title: 'The Final View'                   , duration: '3:36', spotifyTrack: '2Ws6zwuHUNmiKOaCXW42E7',
        appleTrackId: 1078923068, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/5c/4e/70/5c4e7010-6f79-b611-2288-71449f09bb3d/mzaf_2581426563331842032.plus.aac.p.m4a',  },
      { title: 'A day by atmosphere supreme'      , duration: '4:01', spotifyTrack: '6pohqHcqJ33ZqZ4NnPBLDU',
        appleTrackId: 1078923069, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/60/40/62/60406210-c787-f267-d29f-597fe85086cc/mzaf_10251490181426487464.plus.aac.p.m4a',  },
      { title: 'Luv (sic) pt4 (feat. Shing02)'    , duration: '5:12', spotifyTrack: '3wGDieYO20Btdly6qFCDBN',
        appleTrackId: 1078923070, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/6f/ea/e4/6feae4a4-cf13-44fd-59a5-bb929e947bd6/mzaf_12093719535267473081.plus.aac.p.m4a',  artist: 'Nujabes, Shing02', },
      { title: 'Beat laments the world'           , duration: '4:24', spotifyTrack: '3jPniUE89uvF2sC1bexIRt',
        appleTrackId: 1078923521, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/50/9a/ab/509aab49-46fb-bc3d-c616-79c743dc0ad0/mzaf_532840430535960700.plus.aac.p.m4a',  },
      { title: 'City Lights'                      , duration: '3:16', spotifyTrack: '2XJ0M5v104BXGcDDlItm9v',
        appleTrackId: 1078923522, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/e6/8d/5c/e68d5cb8-9ecc-64ad-3f9a-649885158dbb/mzaf_9870511261490690258.plus.aac.p.m4a',  artist: 'Nujabes, Pase Rock, Substantial', },
      { title: 'Luv (sic)'                        , duration: '4:49', spotifyTrack: '0tKS21zgeZE6HBvUajTyWh',
        appleTrackId: 1078923523, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/d6/a9/2f/d6a92f50-505e-a146-3a95-9d9b0f1f3415/mzaf_9976441952649253076.plus.aac.p.m4a',  artist: 'Shing02', },
      { title: 'Horizon'                          , duration: '7:21', spotifyTrack: '3jM0azdqI4hCvMmPTMSHMb',
        appleTrackId: 1078923524, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/67/ca/0f/67ca0f81-386e-fad9-e6d8-12d41c80c0ab/mzaf_10491109041163790998.plus.aac.p.m4a',  },
      { title: 'Luv (sic.) pt3'                   , duration: '5:38', spotifyTrack: '4cNyAxiMlQBqkyhj6wg9Mg',
        appleTrackId: 1078923525, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/26/52/01/265201af-2697-c114-a3ca-1ec3797dd3b8/mzaf_1897975554057315245.plus.aac.p.m4a',  artist: 'Nujabes, Shing02', },
      { title: 'Feather'                          , duration: '2:56', spotifyTrack: '70qBowDkLu9PqUUfaXiCaO',
        appleTrackId: 1078923526, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/5e/c2/00/5ec20040-e85b-77c0-6976-571fa4aebd3c/mzaf_8009078761645376098.plus.aac.p.m4a',  artist: 'Nujabes, Cise Starr, Akin', },
      { title: 'Searching For You'                , duration: '3:59', spotifyTrack: '0YVS6Hu9AqnRYCl6CGRUhr',
        appleTrackId: 1078923531, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/54/2e/e1/542ee175-315e-f67d-914e-b10730f52c8d/mzaf_4988394828058962138.plus.aac.p.m4a',  artist: 'Matt Cab', },
      { title: 'Spiral'                           , duration: '3:43', spotifyTrack: '352APx5Wt2gDzl2NJL8FdN',
        appleTrackId: 1078923533, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/9c/c3/79/9cc3795f-a4db-b9c8-401e-2be0a8301ce3/mzaf_14102076446784956964.plus.aac.p.m4a',  },
      { title: 'Counting Stars'                   , duration: '4:08', spotifyTrack: '3d9GBklH58z0TKCv0oryxU',
        appleTrackId: 1078923534, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/07/78/e8/0778e842-d029-2987-a516-0d1b8c103907/mzaf_7827798918382547195.plus.aac.p.m4a',  },
      { title: 'reflection eternal'               , duration: '4:20', spotifyTrack: '5QEyskrSjoBKrOZ0m0SVu6',
        appleTrackId: 1078923535, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/73/92/04/73920470-b7f0-27b4-a500-f78ebdff012a/mzaf_12097243895745096726.plus.aac.p.m4a',  },
      { title: 'After Hanabi -Listen to My Beats-', duration: '5:23', spotifyTrack: '2oqJBJzHTKLFUs9etAluju',
        appleTrackId: 1078923536, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/8f/1f/88/8f1f885a-b2db-9029-908d-4823b6b41f2b/mzaf_5949039441072944166.plus.aac.p.m4a',  },
    ],
  },
  {
    id: 'sons-of-1973',
    title: 'Sons of 1973',
    artist: 'Satellite Lovers',
    year: 1996,
    cover: 'covers/sons-of-1973.jpg',
    accent: '#4282E8',
    vinyl: '#4C7DBD',   // Iris 08-30 自己在试色板上调的（76,125,189）
    spotifyAlbum: '5kzKkjwgvJ2az8v54K8wQh',
    appleAlbumId: 1804827966,
    appleUrl: 'https://music.apple.com/us/album/best-friend/1804827966',
    tracks: [
      { title: 'Best Friend'                            , duration: '5:00', spotifyTrack: '2H0oDen2wJi5RrF1Ws5ETn',
        appleTrackId: 1804827968, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/de/18/3f/de183fe0-b968-9805-75fc-85fbd2870787/mzaf_16041649160631541851.plus.aac.p.m4a',  },
      { title: '夏の続き'                                   , duration: '3:53', spotifyTrack: '5BgeIE0Vd237X8I0n5NbQq',
        appleTrackId: 1804827971, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/50/7f/a3/507fa3ac-09af-badb-15cb-925420d6af75/mzaf_4540116478961504056.plus.aac.p.m4a',  },
      { title: 'How Much I Love You, Baby'              , duration: '4:48', spotifyTrack: '4lSnffr4CoJVCyw81nyI9u',
        appleTrackId: 1804827973, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/dd/8a/20/dd8a206f-5474-d418-3f39-9124400e9998/mzaf_8787673930705524803.plus.aac.p.m4a',  },
      { title: 'Sunnyday, Holiday'                      , duration: '4:43', spotifyTrack: '50gkbluKHHoA6ODpj3oMnr',
        appleTrackId: 1804827976, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/b3/2f/4e/b32f4efc-a6c3-19e6-b35b-b0bdbd15d364/mzaf_17515866562876776688.plus.aac.p.m4a',  },
      { title: '空へ (S.L. Meets Hv!)'                    , duration: '5:48', spotifyTrack: '0z5SH9Ut4MuymJm4uuV8YK',
        appleTrackId: 1804827978, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/86/c8/46/86c8469b-da9e-4e5f-aa8f-e8819e1a3936/mzaf_9032190894293754795.plus.aac.p.m4a',  },
      { title: '外はいい天気'                                 , duration: '3:37', spotifyTrack: '6fWS8epk2M31mCCOqRJN8w',
        appleTrackId: 1804828042, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/ab/f4/c4/abf4c4cd-391c-0967-7f8a-7bcb6dd3d151/mzaf_14128908374080714602.plus.aac.p.m4a',  },
      { title: 'Sunshine Love (Lover\'s Picnic Version)', duration: '1:53', spotifyTrack: '4aIYo1vUU4xbLwsBjyg2It',
        appleTrackId: 1804828044, applePreviewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/37/63/8a/37638ae5-f9a7-7ee2-4b39-88ed925d7af8/mzaf_8008673070012614353.plus.aac.p.m4a',  },
    ],
  },
];

/* 唱片架标题栏。想换就换。
 * ⚠️ `sub` 原来是「N 张」，2026-08-31 Iris 要求去掉 —— 留 VINYL 就够了。
 * 留成空字符串而不是删掉这个字段：player.js 有三处 `shelf.sub` 在用它。
 * `blurb` 现在也没人读了（页脚那行说明一起删的），留着当备用文案。 */
export const SHELF = {
  title: 'VINYL',
  sub: '',
  /* 未登录访客只有 30 秒试听 —— 与其藏着，不如把它说成一个概念。 */
  blurb: '一张张抽出来试听。喜欢就去 Spotify 听完整的。',
};
