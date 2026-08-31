/* 风格宪法 · 可执行版本（v0.8 · 白沙海底）
 *
 * 两部分：
 *   1. ENV   —— 环境、材质、排版、后处理的全部数值。**这里是唯一真相**，
 *              规格和宪法都不再复述（风格宪法 v1.0 的规矩）。
 *              全部走 stage 的调试面板，写在这里的是出厂值
 *              （面板「恢复默认」回到的就是这一组）。最近一次更新 2026-08-25。
 *   2. grade —— 《风格宪法.md》第三节「调色变换」，v0.8 未改动。
 *              gradeRGB / gradeImageData 逐行照抄 材质与调色实验室.html，
 *              实验室里调出来的参数拿到 3D 运行时里是同一个结果。
 *
 * 改参数的正确流程：调试面板里调 → 复制 JSON → 贴回下面的 ENV。就这一处。
 * （文档不再抄一份数值 —— 抄两份必然对不上，之前就是这么歪掉的。）
 */

/* ============ 环境参数 · 出厂值（Iris 在面板上定，最近一次 2026-08-28 晚，她把屏幕光整块调过一轮） ============
 * 2026-08-28：Iris 从五个快捷风格里挑了**「清透」**，这组值已经写成出厂值 ——
 * 所以现在「恢复默认」和点「清透」是同一个结果。别的模板还留着，随时能切回去比。 */
export const ENV = {
  // 冰晶全局
  alpha: 46, rimS: 118, rimP: 160, core: 64,
  // 三档（乘进全局；花瓣几乎不透、内核为零 —— 踩过坑的，别改回去）
  rimSoul: 100, alphaSoul: 44,
  rimGlass: 52, alphaGlass: 58,
  rimPetal: 8,  alphaPetal: 96,
  // 光源 / 实体
  emit: 70, screenC: '#BFE8FF', sat: 100,
  screenBg: 0, // MacBook 屏幕的风格 = 雪稿（那张淡蓝色的）。序号对应 SCREEN_BGS
                       // 每档的墨色 / 压带 / gain **不用配** —— 背景画完之后从画布上采样
                       // 自动定（见 共用/scene/屏幕.js 的 autoTune 那一段）。
  /* --- 屏幕光（2026-08-28 全部参数化）。emit 是总闸，下面四组各管一块。
   * **发光的是屏幕那一层薄面**（背板前面的那个面，厚度几乎为零），
   * 光沿着它的法线**往前**走 —— Iris 2026-08-28 说清楚的。
   * 前三版都跑偏，记一下：① 径向渐变贴图 = 后面藏了个灯泡；
   * ② 光晕在背板平面里往外扩 55% = 整个背板一圈都在发光；
   * ③ 地上那块洒光给到屏幕宽的 150% = 一道手电筒光柱。 */
  scrBeam: 40,         // 前射强度 %：从屏幕那层薄面往**前**照出去的那束
  scrBeamLen: 4,      // 前射距离 %（屏幕高的百分比）：光往前走多远才化完
  scrBeamAng: 0,      // 前射张角°：往前张开多少。0 = 一根直筒
  scrSoft: 72,         // 边界柔化 %：光的边化多开。0 = 一条硬边（很"整齐"，假），
                       // 100 = 从中心就开始化。屏幕面上那层柔光和地上的光斑都吃它
  scrLink: 100,        // 亮度联动 %：壁纸调亮 → 往外照的光跟着变亮（真机上本来就是同一回事）。
                       // 0 = 不联动（只看 emit）｜ 100 = 亮度 99% 就出 99% 的光
  scrSpill: 40,        // 洒光强度 %：落在垫子/沙上的那片
  scrSpillLen: 0,     // 洒光长度 %（屏幕宽的百分比）。**"手电筒感"就是这一项**，别给大
  scrSpillWide: 52,   // 洒光宽度 %（近端，屏幕宽的百分比）
  scrSpillAng: 12,     // 洒光张角°：往前张开多少。0 = 直上直下一条
  scrBounce: 0,       // 反射光强度 %：屏幕打在键盘面上那一片（真笔电上最明显的一处）
  scrBounceLen: 0,    // 反射光长度 %（屏幕宽的百分比），从屏幕根部往键盘方向
  screenLit: 99,      // 屏幕壁纸亮度 %：乘在每档自己算出来的 gain 上（100 = 就用自动值）。
                       // 和「屏幕发光」分开 —— 那个管往外洒的光，这个只管壁纸本身多亮
                       // 屏幕上是 Iris 手写的两行欢迎语，墨色跟着风格走 ——
                       // **不用她原图里的纯黑**：纯黑在这个亮场景里是全画面最重的一块，太抢
  // 冰晶颜色：物件本体无色银白，颜色只来自光（宪法 v0.8）
  body: '#EDF3F5', rim: '#FFFFFF', coreC: '#F4FBFF',
  bottle: '#E4F0EC', flower: '#F0BFD0',
  // 空气与后处理
  hazeC: '#9BB0BB', haze: 10, bloom: 30, grain: 0,    // 颗粒默认 0（Iris，2026-08-22）
  spin: 0, horiz: 55, horizC: '#FFC8A2',
  // 沙
  wave: 62, sparkS: 95, sandC: '#CDD4D6',
  // 背景（上暗下亮：不是天空，是水体）
  // 蓝调时刻（日落刚过）：上深蓝 → 中蓝 → 地平线一条暖桃色晚霞（Iris 定方向，2026-08-22）
  bgTop: '#475B8A', bgMid: '#6C98C8', bgBot: '#E6CFC3', bgStop: 34, bgMidStop: 52,   // 天顶 Iris 08-30 调的（原 #1E2F5C）
  bubbleC: '#EAF8FF',
  // 开关
  bubbles: 1, shells: 1,
  // 推沙（阶段 4 提前落地的部分）
  push: 55,       // 推沙强度：拖动物件时挖走多少、堆起多少
  sandGrip: 60,   // 拖动摩擦：死区/跟手/限速都吃它。100 = 08-29 之前的手感（Iris：太难拖），
                  // 越小越"滑"。另外小物件的限速加了下限，贝壳不再只能爬
  heal: 30,       // 落沙速度：推完之后沙往低处再落一阵；因为摩擦力，
                  // 坡度低到一定程度就永久停住 —— 痕迹变浅但不会消失（Iris 定，2026-08-21）
  repose: 55,     // 安息角：沙堆能立多陡，太陡会自己塌流
  pushRange: 60,  // 推动范围：物件最多被推离原位多远（% of 自身半径）。
                  // 「小小的推沙感」—— 能推着玩，但构图不会被玩坏（Iris 定，2026-08-21）
  // 浪（像潮汐一样打上沙滩；退去时同时改写高度场和湿度场，见 共用/场接口.md）
  waveOn: 1,
  wavePeriod: 9,       // 一个涨退周期（秒）
  waveReach: 7.7,      // 水线最远冲到离原点多近（局部单位；野餐垫边缘在 ~4.4）
  waveDir: -90,        // 浪从哪个方向来（度；-90 = 从 -z 远处，即电脑屏幕背后，正对默认视角 —— Iris 定）
  waveErase: 22,       // 浪冲平沙痕的速度（脚印要能留一阵）
  waveFoam: 70,        // 泡沫多少
  waveVol: 55,         // 浪声音量 %（见 共用/audio.js 第 4.5 节）。0 = 静音
  waveSynth: 1,        // 浪声用哪一版：1 = 六层合成（海浪声实验室 v2）｜ 0 = 真实录音切片。
                       // **互斥**，两种叠在一起会很奇怪（Iris 2026-08-27）
  waterC: '#A6DBEA', waterDeepC: '#3E8FC0',   // 浅水 / 远海（Iris：要更蓝）
  seaWidth: 260, seaLength: 140,              // 海面面片的横向半宽 / 纵向长度（局部单位，1 ≈ 17cm）。湿沙带自动跟它一样宽
  // 湿沙（干沙和湿沙的高度、颜色、反光都不一样）
  dryTime: 14,         // 变干：衰减到 1/e 用几秒
  wetDark: 55,         // 湿沙有多深色
  wetGloss: 60,        // 湿沙的水光
  wetSink: 40,         // 湿沙压实后矮多少
  wetC: '#8E9CA4',     // 湿沙的色相倾向（乘到干沙色上）
  markFade: 90,        // 小生物脚印淡掉的时间（秒，到 1/e）
  // 黑胶与贝壳（Iris 要自己调）
  recordThick: 100,    // 黑胶厚度（% of 模型原厚度）—— 之前以为厚的其实是底座，底座已改透明
  /* 透明彩胶（2026-08-29。第三轮定稿：**只有彩胶，没有黑胶**；
   * 颜色**逐张手选**写在 albums.js 的 vinyl 字段，不再自动取色/糖果化）。
   * 贴图是运行时逐像素画的：沟槽更实、盘面更透、曲目分隔那圈最透（见 scene/彩胶.js）。 */
  vinylC: '#4C7DBD',   // **试色板**：拖它会盖过当前专辑的颜色（只在本次会话）。
                       // 试到满意把 hex 写进 albums.js 的 vinyl 才算数。出厂 = Sons 的蓝（Iris 08-30 调的 76,125,189）
  vinylNujabesC: '#DCC68E',  // nujabes 那张的彩胶色（Iris 要在色盘上直接调，所以住在 ENV 不住 albums.js）
  vinylA: 62,          // 彩胶通透 %：越低越透（同 ckFruitA 的语义）
  vinylGroove: 60,     // 沟槽深浅 %：同心纹的明暗和实度
  vinylRim: 110,       // 边缘透光 %：盘边和掠射角上那圈透出来的颜色
  shellCount: 64, shellScale: 330,           // 贝壳数量、放大倍率（%）。111 → 64（Iris 08-29：太多，看不清做的啥）
  shellNear: 125, shellFar: 320,              // 贝壳带：离垫子中心往海里的距离（cm），近端 / 远端
  shellDrift: 30,      // 贝壳被浪卷走的概率 %（深水处的满值；露在沙上的永远不动）。
                       // 越大越"活"，但走得快也补得快，整条带的形状不会变
  shellSwash: 100,     // 浪推贝壳 %：冲刷带里的贝壳被每一浪推上来半步、拖回去半步
                       // （被冲/被带走的"感觉"主要靠这个，卷走反而多发生在看不清的深水里）
  // 排版：垫上每样东西的位置（cm，相对垫子中心）与朝向（度）。Iris 自己摆
  ttX: -44, ttZ: -36, ttR: 17,          // 唱机
  mbX: 20, mbZ: -41, mbR: 5,           // MacBook
  gtX: -71, gtZ: 22, gtR: -38, gtScale: 100,   // 木吉他（gtScale = 缩放%）
  /* 吉他的颜色（2026-08-29 补上面板入口）。以前只能去 `物件_吉他/调色台.html` 调，
   * Iris 在主面板上找不到。现在「发光 · 材质 → 吉他配色」直接切，滑块显示名字。 */
  gtTop: 1, // 面板（正面）木色。⚠️ Iris 报的档位是从 1 数的，数组从 0 数 —— 08-29 已回退一格修正
  gtBack: 4, // 背侧板（侧面）。同上回退一格。连带琴头/指板/琴桥一起换
  gtIrid: 0, // 音孔圈的彩贝虹彩 %。**Iris 定了不要**（那圈变色读起来像 bug）
  ckX: 51, ckZ: -48, ckR: -1,         // 鸡尾酒
  catX: -7, catZ: 18, catR: 0,        // 许愿猫
  camX: 70, camZ: -44, camR: 166,       // 小数码相机
  sunX: 90, sunZ: -21, sunR: 94,      // 向日葵那一束（整束一起动）
  // 光（2026-08-25 补：原本三盏光的强度都硬编码在 stage.js 里，没法调，
  // 而「整个环境的阴影感」就是主光/环境光的比值定的 —— 必须能拖）
  keyLight: 82,        // 主光（方向光）强度 %。它是唯一给体积的光
  ambLight: 92,       // 环境光 = 半球光 + 环境贴图，一起缩放 %。
                       // 它越强画面越平：环境光没有遮蔽，照哪儿都一样亮
  envI: 46,            // 环境反射 %：环境贴图在 ambLight 之上再乘一道。整场只有这一个总倍率。
                       // （历史：收进面板之前这里是硬编码的 0.4 = ambLight 100% × envI 40%）
  envVar: 120,         // 材质反射差异 %（2026-08-27 晚补）。
                       // 「统一」不等于「全都一样」—— 第一版把所有 envMapIntensity 一刀切成
                       // 1.0，结果**清透感掉了**：亮光漆的琴面、银 MacBook、防尘罩靠的
                       // 就是比周围更强的反射。现在各材质还留着自己的「反射性格」base，
                       // 实际强度 = 1 + (base-1) × envVar%：
                       //   0 = 全场一模一样（那个"统一但发闷"的版本）
                       //   100 = 各材质原本的性格（08-27 之前的清透感）｜ 150 = 比原来更拉开
                       // 性格散在各文件里（devices.js 的 SILVER.envI、吉他 材质表.js 的 SLOTS），
                       // 但**放大多少只有这一个滑块**，见 共用/光照.js 的 registerEnvI
  // 太阳的方向：全场只有这一个，沙的着色器、垫子的烘焙、三个 three 灯都读它，
  // 所以拖它的时候所有东西的明暗面一起转（出厂值 = 改造前写死的那个方向）
  sunAz: -46,          // 方位角（度）：0 = 从镜头这边照过来，正值往右转
  sunEl: 56,           // 高度角（度）：0 = 贴着地平线，90 = 正头顶
  keyK: 6500,          // 主光色温 K。6500 = 正白（出厂），低了偏暖、高了偏冷
  ambK: 6500,          // 环境光色温 K
  fill: 15,            // 补光 %：从主光背面来的一盏弱光。
                       // 专治「深色物件读成一个洞」（吉他背侧板、相机、黑胶、小生物）
  /* 鸡尾酒的果肉（2026-08-29）。Iris：「果肉质感不太对，没有晶莹剔透，像一个塑料片」。
   * 根子是它原来只有一层**纯白**的自发光糊在表面 —— 真果肉是背光透出**自己的颜色**。
   * 现在自发光走同一张果肉贴图（emissiveMap），下面三个是手感项。 */
  ckFruitA: 72,        // 果肉通透 %：越低越透（能看见后面的杯壁和酒）
  ckFruitGlow: 58,     // 果肉透光 %：背光透出来的亮度。大了会过曝成一片橙
  ckFruitRim: 100,     // 果肉边缘光 %：切面边上那一圈亮，柑橘的"水感"靠它
  /* 橙片和杯沿的贴合。模型上那个卡口是**矩形槽**，比杯壁厚得多，
   * 从正面看槽里两边各有一条空隙 —— 那就是「缺角比较假」的来源。
   * 几何体归 物件_酒/ 那边改；这三个是运行时能补救的部分。 */
  ckFruitY: -9,        // 橙片高低（毫米，负 = 往下坐）
  ckFruitTilt: 8,      // 橙片前倾°：搭在杯口上的东西不会是正正一片立着的
  ckFruitScale: 100,   // 橙片大小 %
  ckFruitSlit: 2.2,    // 橙片缺口宽度°：**一条极窄的缝**，不是方口。
                       // Iris：「本来是一个圆，再把和杯子重叠的部分挖掉」。改这个要刷新（重建几何）
  ckFruitOn: 1,        // 1 = 挂橙片 ｜ 0 = 不挂（只留樱桃）。想比较两种就拖它
  ckRefract: 130,      // 水下折射放大 %：一杯液体装在圆柱杯里就是个柱面透镜，
                       // 水下那截吸管会被沿水平方向绕杯轴放大。130 = 贴到内壁，
                       // 再大就穿出杯壁了（上限算出来是 138）
  // 野餐垫（Iris 要自己调颜色）
  blanketBase: '#FFFFFF', blanketLine: '#2E67A3', blanketLineA: 61, blanketGlow: 23,   // Iris 调的（08-22）
  blanketShade: 100,   // 褶皱明暗（烘进顶点色的遮蔽 + 受光）%
  // 弹窗（Iris 自己调；高 0 = 跟着内容走）
  wishW: 520, wishH: 0,
  miniW: 230, miniH: 0,   // 右下角那个迷你播放器
  galW: 760, galH: 620,   // 相册（点相机）
  siteW: 900, siteH: 620, // A Cocktail 的内嵌窗口（点酒杯）
  // 后处理与阴影（原本硬编码在 stage.js 里，2026-08-25 收进 ENV：
  // 面板「复制参数 JSON」导出的就是这几个键，出厂值必须和导出值住在同一个地方，
  // 否则「恢复默认」和贴回来的 JSON 会对不上）
  glow: 30,             // 光晕强度（= bloom 的面板键名，applyParams 会把它写回 bloom）
  exposure: 1.02,          // 色调映射曝光
  sunShadow: 50,        // 太阳阴影浓度 %（2026-08-27 统一光照 第 2 步）。
                        // 0 = 完全没有，画面回到开 shadowMap 之前。
                        // 这是**真**影子：同一盏主光同时投在垫子上和沙上，方向跟着 sunAz/sunEl 转。
                        // 沙是自定义着色器，靠 sand.js 的 sunShadow() 采样同一张图，不是另写的一套
  sunSoft: 2.5,           // 太阳阴影柔化（PCF 半径，texel）。大了软但会糊，小了硬
  fogFar: 165,          // 雾的距离 %（2026-08-27 晚补）：整个世界多远才化进背景。
                        // 沙、浪、物件三条雾一起缩放，画面的"清透 ↔ 朦胧"主要归它。
                        // 大 = 清透。⚠️ 别拉太大：沙必须在到达地平线之前化完，
                        // 化不完地平线就会露出一条硬线（老版本栽过）。200 以内是安全的
  contrast: 110,        // 对比度 %（后处理最后一步，2026-08-27 晚补）。100 = 不变
  sandLit: 130,         // 沙 · 受光 %：沙的方向光项（默认只有 0.22，所以沙偏平）。
                        // 拉大沙丘的明暗面更明显，画面更有体积
  objFog: 45,           // 物件吃多少空气透视 %（2026-08-27 统一光照 第 3 步）。
                        // 100 = 和沙**一模一样**的那条地平线消隐（同色、同曲线、同距离）；
                        // 0 = 物件完全不吃雾（= 8-27 之前的样子）。
                        // 这是把物件"焊进"场景的最后一道：沙在三米外已经化进背景了，
                        // 以前那里的贝壳还是一颗颗浮在上面，读起来像贴纸。
                        // 出厂给 45 是折中（Iris 反馈 100 太糊）：三米外的贝壳还是化掉 41%，
                        // 而垫子上的物件只吃到 11%，深色件不会被冲淡
  shadow: 0.3,          // 接触阴影不透明度（blobTex 那片假的）。真影子开了之后它还留着：
                        // shadow map 分辨不出物件贴地那一圈最深的暗，这片补的就是那个"咬住"的感觉
  softness: 2.6,        // 接触阴影铺开程度
  dof: 0.008,           // 景深最大模糊
  aberration: 0.0006,   // 轻微色差
  glassClean: 0.92,     // 透明件上把颗粒抹掉多少（「透明就纯透明」）
};

/* MacBook 屏幕风格的名字和顺序 —— **这里是唯一真相**。
 * 面板上的滑块直接显示名字（不是序号），`共用/scene/屏幕.js` 的 SCREEN_STYLES 按同样顺序排。
 * 加一张底图：跑 `内容/屏幕/裁底图.py` 生成 `底图_名字.jpg`，
 * 这里加个名字、那边加一行 `{ name:'名字', photo:'底图_名字.jpg' }` 就行，别的参数都不用配。 */
export const SCREEN_BGS = ['雪稿', '紫光', '云稿'];   // Iris 只要这三张（2026-08-28）

/* ============ 快捷风格模板 ============
 * 面板顶上那排按钮。点一下 = 把下面这几个键盖到 ENV 上，别的键不动
 * （所以排版、贝壳、浪声这些不会被风格冲掉）。
 *
 * 用法：点几个模板挑一个最近的，再拖滑块微调，然后照旧「复制参数 JSON」贴回 ENV。
 * 想加一个模板：在这里加一条就行，面板会自动多一个按钮。
 * 键名必须是 ENV 里已有的键 —— 写错了不会报错，只会静默不生效。
 */
export const LOOKS = {
  '08-27 之前': {
    // 统一光照三步之前的样子。清透感就是从这儿丢的：envVar 100 = 各材质保留自己的反射性格
    envVar: 100, objFog: 0, sunShadow: 0, fogFar: 100, contrast: 100, sandLit: 100,
    haze: 22, glow: 46, fill: 25, exposure: 1,
  },
  '清透': {
    // 保留统一的成果（真影子 + 物件吃雾），但把雾推远、对比拉起来、反射性格拉满
    envVar: 120, objFog: 45, sunShadow: 50, sunSoft: 2.5, fogFar: 165, contrast: 110, sandLit: 130,
    haze: 10, glow: 30, fill: 15, exposure: 1.02, keyLight: 82, ambLight: 92, envI: 46,
  },
  '正午': {
    // 太阳高、影子硬、雾少。最"实"的一档
    envVar: 115, objFog: 40, sunShadow: 78, sunSoft: 1.5, fogFar: 175, contrast: 112, sandLit: 145,
    haze: 6, glow: 24, fill: 10, exposure: 1.0, keyLight: 105, ambLight: 78, envI: 42,
    sunEl: 68, sunAz: -34, keyK: 6200, ambK: 6800,
  },
  '黄昏': {
    // 太阳压到地平线、影子拉长、暖光冷影。晚霞那条背景本来就是为它调的
    envVar: 110, objFog: 70, sunShadow: 65, sunSoft: 4, fogFar: 120, contrast: 104, sandLit: 120,
    haze: 24, glow: 56, fill: 22, exposure: 1.04, keyLight: 95, ambLight: 88, envI: 44,
    sunEl: 15, sunAz: -78, keyK: 3600, ambK: 7400,
  },
  '柔雾': {
    // 最"梦"的一档：雾近、辉光大、对比压低。物件完全化进环境里
    envVar: 60, objFog: 100, sunShadow: 35, sunSoft: 6, fogFar: 80, contrast: 94, sandLit: 90,
    haze: 34, glow: 62, fill: 32, exposure: 1.0, keyLight: 62, ambLight: 108, envI: 38,
  },
  '统一(08-27)': {
    // 我这轮交出去的那版，留个记录好对比
    envVar: 0, objFog: 100, sunShadow: 55, sunSoft: 3, fogFar: 100, contrast: 100, sandLit: 100,
    haze: 22, glow: 46, fill: 25, exposure: 1,
  },
};

/* 三类透光材质的档位（规格 3.1 的表，别用同一组参数刷所有东西）。
 * rim/core 是乘进全局 rimS/core 的倍率，alpha 键指向 ENV 里的绝对值。 */
export const ICE_TIERS = {
  soul:   { rim: () => ENV.rimSoul  / 100, alpha: () => ENV.alphaSoul,  core: 1.0  },
  glass:  { rim: () => ENV.rimGlass / 100, alpha: () => ENV.alphaGlass, core: 0.35 },
  petal:  { rim: () => ENV.rimPetal / 100, alpha: () => ENV.alphaPetal, core: 0.0  },
  /* 泡泡的"白圈"（双面球壳掠射角上正反两面菲涅尔叠一次）真正的解是
   * **只渲正面**（stage.js 的 iceMaterial）。08-29 早上曾同时把边缘光降到 0.42 ——
   * 两份药叠一起泡泡整个看不见了（Iris 当天报的），边缘光回 1.0，只留单面渲这一个 fix。 */
  bubble: { rim: () => 1.0,                alpha: () => 5,              core: 0.0  },
};

/* 实体类固有色的全局饱和度倍率（原型里的 sat）。
 * 贝壳不参与 —— 用 raw 色直接给。 */
export function satBoost(hexColor, pct = ENV.sat) {
  if (pct === 100) return hexColor;
  const c = hexColor.replace('#', '');
  let [r, g, b] = [0, 2, 4].map(i => parseInt(c.substr(i, 2), 16) / 255);
  const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  const k = pct / 100;
  [r, g, b] = [r, g, b].map(v => l + (v - l) * k);
  return '#' + [r, g, b].map(v =>
    Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
}

export const shade = (h, k) => {
  const c = h.replace('#', '');
  return '#' + [0, 2, 4].map(i =>
    Math.max(0, Math.min(255, Math.round(parseInt(c.substr(i, 2), 16) * (1 + k))))
      .toString(16).padStart(2, '0')).join('');
};

/* ============ 调色变换 · 宪法 第三节（v0.8 未改，2026-08-14 定） ============ */
export const P = {
  s1: 2, s2: 90, l1: 0, l2: 100,
  mix: 16, hue: 8,
  env: '#FFFFFF', dark: '#000000',
  grain: 29, glow: 12,
};

/* ---- 以下与实验室完全一致，勿改 ---- */
const h2r = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
const r2h = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

function hsl2rgb([h, s, l]) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let t;
  if (h < 60) t = [c, x, 0]; else if (h < 120) t = [x, c, 0]; else if (h < 180) t = [0, c, x];
  else if (h < 240) t = [0, x, c]; else if (h < 300) t = [x, 0, c]; else t = [c, 0, x];
  return t.map(v => (v + m) * 255);
}

const mixRgb = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
function lerpHue(a, b, t) { let d = ((b - a + 540) % 360) - 180; return a + d * t; }

/* 调色变换。kind:
 *   'normal'   —— 走完整变换（绝大多数物件）
 *   'emissive' —— 自发光物件，只轻微染环境色
 *   'raw'      —— 不参与变换（背景、贝壳、接触阴影）
 */
export function gradeRGB(rgb, kind = 'normal') {
  if (kind === 'raw') return rgb;
  let [h, s, l] = rgb2hsl(rgb);
  const envRgb = h2r(P.env);
  if (kind === 'emissive') return mixRgb(hsl2rgb([h, s, l]), envRgb, P.mix / 200);
  s = P.s1 + (s / 100) * (P.s2 - P.s1);
  l = P.l1 + (l / 100) * (P.l2 - P.l1);
  h = lerpHue(h, rgb2hsl(envRgb)[0], P.hue / 100);
  let out = hsl2rgb([h, s, l]);
  const t = l / 100;
  out = mixRgb(out, envRgb, P.mix / 100 * t);
  out = mixRgb(out, h2r(P.dark), P.mix / 100 * (1 - t) * 0.8);
  return out;
}

export const grade = (hex, kind = 'normal') => r2h(gradeRGB(h2r(hex), kind));

/* 贴图也必须过同一套变换 —— 统一器 5：「每个物件的真实颜色，都过同一套变换后才进画面」。
 * 真实照片（唱片封面 / 画集 / 酒瓶标签）全都走这个函数，
 * 否则贴图物件会和纯色物件不在一个世界里。 */
export function gradeImageData(img, kind = 'normal') {
  const d = img.data;
  const memo = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let o = memo.get(key);
    if (o === undefined) {
      o = gradeRGB([d[i], d[i + 1], d[i + 2]], kind).map(v => Math.max(0, Math.min(255, Math.round(v))));
      memo.set(key, o);
    }
    d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2];
  }
  return img;
}
