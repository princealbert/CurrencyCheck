# 货币图鉴 · Phase 7 发布前最终 QA 门控评审报告

> 评审人：严守真（质量保障 / 测试负责人）
> 阶段：Phase 7 发布前最终门控
> 评审基准：微信小游戏（Canvas 2D，无 DOM）；浏览器 `localhost:8080` 预览 = 真机同款
> 输出路径：`docs/qa_release_gate.md`
> 说明：本报告**只产出评审结论，未修改任何源代码**；测试断言问题仅在 §7 列行号+改法。

---

## 0. 执行摘要

**判定：`CONCERNS`（含发布阻断）** —— 当前二进制**不可提审**。

| 维度 | 结论 |
|---|---|
| 功能链路（配对 / 自动收藏 / 图鉴 / world tour / 前后台） | ✅ 达标 |
| 音频运行时（零文件 no-op、降级、引用计数、裁剪、淡出） | ✅ 达标 |
| 合规红线（无真钞图 / ISO 4217 + 弱化国旗 / 无投资措辞） | ✅ 达标（汇率快照标注见 §3-B4 待确认） |
| 资产加载**降级**能力（缺失→几何占位/渐变/静默） | ✅ 代码已具备 |
| **wx 包体积（硬上限）** | 🔴 **84MB，顶穿「主包≤4MB / 总包≤30MB」** |
| **资产加载源（是否指向 CDN）** | 🔴 **代码仍写死本地 `assets/`，CDN 迁移未合入** |
| **CDN 域名白名单** | 🔴 **未配置（开发者工具不校验，真机必炸）** |
| **audio-smoke 测试** | 🔴 **117/119，2 条计数断言过期导致红灯** |

**一句话**：代码质量与合规均已达到可发布水准，但**打包策略**尚未落地——wx 包 84MB 无法过微信体积硬上限，且走 CDN 所需的代码改动（4 个 base 常量）尚未合入、CDN 域名白名单未确认。当前 `wx-dist` 在微信开发者工具「上传」一步会直接失败（本地预览一切正常，属「最后一公里才炸」）。**清除下列阻断项前，不应提审。**

---

## 1. 评审范围与依据

**已读取源码（发布前代码/资产/合规一致性核对）**
- `src/core/audioManager.ts`、`src/core/audioEvents.ts`
- `src/app/app.ts`、`src/render/card.ts`、`src/render/hub.ts`、`src/render/worldTour.ts`、`src/render/renderer.ts`
- `src/data/currencies.ts`、`src/data/worldTour.ts`
- `src/platform/wechat.ts`、`src/platform/browser.ts`、`src/platform/types.ts`
- `minigame/build.mjs`、`minigame/audio-smoke.mjs`、`minigame/smoke.mjs`
- 资产树：`assets/`（36 币种 PNG + 4 背景 + deco + remote/worldtour 8 帧 + audio）、`wx-dist/assets/`

**已实测**
- `wx-dist/assets` 实测 **84M**；币种数据 18 个（`18 × 2 形态 = 36 实体`，与「全收集 36 触发 world tour」一致）。
- 音频：bgm 目录 39MB（含 `bgm_tour_take1~5` + `take4_keep` 等出曲候选，已被 build 排除）；包内实际 bgm = `hub/match/codex/tour` 4 首 ≈ 12.2MB；sfx ≈ 1.4MB；包内音频合计 ≈ **13.6MB**。

---

## 2. 资产加载架构核对（关键）

| 资产 | 当前代码路径 | 缺失降级是否已具备 | 弱点 |
|---|---|---|---|
| 货币母题 PNG（卡面） | `assets/cur_${iso}_${denom}_${region}_${form}.png`（**本地**） | ✅ `card.ts` `drawMotifPlaceholder`（区域形状+放大 glyph 几何占位） | 路径未指向 CDN |
| 场景背景 `bg_*.png` | `assets/bg_*.png`（**本地**） | ✅ `renderer.ts:365` 先画 L0 渐变兜底，`sceneFor()` 未就绪返回 `undefined` 则不画场景图（无白屏） | 路径未指向 CDN |
| `deco_globe` | `assets/deco_globe.png`（**本地**） | ✅ `hub.ts:429` `getDeco()` 为 `undefined` 即跳过 | 路径未指向 CDN |
| world tour 8 帧 | `WORLDTOUR_BASE='assets/remote/worldtour/'`（**本地**，含 TODO 未改 CDN） | ✅ `worldTour.ts` L0 暖黑底 + 区域签名色径向渐变兜底；`tourTried` 去重；`getTourFrame()` 未就绪返回 `undefined` | 仅此批设计了 CDN，但 `WORLDTOUR_BASE` 仍是本地路径且未切 CDN |
| 音频 | `AUDIO_ROOT='assets/audio/'`（**本地**） | ✅ `wechat.ts`/`browser.ts` 后端 onError→哑句柄、create 永不抛、全链路静默 | 路径未指向 CDN；**音频 13.6MB 仍在包内** |

**结论**：运行时「缺失降级」能力四类资产**全部齐备且健壮**（无任何资产缺失会白屏/崩溃/卡死）。**唯一缺口是资产「来源」尚未切换到 CDN**——`preloadImages()` / `preloadScenes()` / `WORLDTOUR_BASE` / `AUDIO_ROOT` 四个 base 仍写死本地 `assets/`。这与「浏览器预览 = 真机同款」形成一处偏差：**浏览器预览走本地 assets，真机若要走 CDN，预览环境无法覆盖 CDN 失败路径**，必须单独回归（见 §4）。

---

## 3. 阻塞性缺陷（Blocking）

### 🔴 B1【硬阻断·提审不可过】wx 包 84MB，顶穿微信体积硬上限
- **现象**：`wx-dist/assets` 实测 84M（货币图 62 + 背景 7.4 + deco 0.4 + 音频 13.6 + game.js 0.3 ≈ 84）。
- **根因**：`build.mjs` 的 `copyAssets()` 当前把**全部本地资产**（除 `assets/remote/` 与 backup/take 外）拷进 `wx-dist`。`app.ts:1125` `preloadImages` 与 `app.ts:1143` `preloadScenes` 写死 `assets/...` 本地路径，音频 `AUDIO_ROOT='assets/audio/'`（`audioEvents.ts:72`）同为本地路径。
- **致命二级问题**：生产者结论「图像走 CDN」**只解决一半**——即便把 69MB 图全部移出，**包内仍剩 game.js 0.3 + 音频 13.6 ≈ 13.9MB，仍超 4MB 主包硬上限**。音频也必须走 CDN（流式，后端已支持远程 src）或拆 subpackage，否则主包仍超限。
- **必须动作**：
  1. 货币图 / 背景图 / `deco_globe` / world tour 帧 / 音频 **全部改为 CDN base**（与 world tour 既有异步+降级架构统一，避免出现「半本地半 CDN」双路径）。
  2. 改 4 处 base 常量：`preloadImages`(app.ts:1125)、`preloadScenes`(app.ts:1143)、`WORLDTOUR_BASE`(worldTour.ts:119)、`AUDIO_ROOT`(audioEvents.ts:72)。
  3. `build.mjs` 中增加「货币图/背景图/音频」的排除规则（类比现有 `remote/` 排除）。
  4. 目标：CDN 化后 `wx-dist` 仅留 `game.js`(~0.3MB) + `game.json` + `project.config.json`，远低于 4MB 主包。
- **影响**：当前 `wx-dist` 在微信开发者工具「上传代码」一步直接报错（本地预览不触发，属最后一公里才炸）。**提交前必清。**

### 🔴 B2【硬阻断·真机】CDN 域名白名单未配置
- `worldTour.ts:116` TODO 已明确警告：上线前须将 CDN 域名加入小程序后台 **downloadFile 合法域名**白名单，且「开发者工具不校验」。
- 图像 + 音频若走 CDN，`createInnerAudioContext` / `wx.createImage` 的远程域名须分别进「downloadFile 合法域名」「服务器域名 / 媒体域名」白名单（按微信平台口径）。
- **真机必炸项**：本地与开发者工具都无法提前发现，须 albert 在后台人工确认。**提交前必清。**

### 🔴 B3【测试红灯】audio-smoke 117/119，2 条计数断言过期（非真 bug）
- 现状：因新增 `bgm_tour`，注册表实为 **26 事件 / 4 BGM 文件**，但测试仍断言旧值。
- 失败点（不改则测试永久红灯，门控不能标绿）：
  - `audio-smoke.mjs:249` → `eq('事件总数 = 25', stats.events, 25);` 改为 `26`
  - `audio-smoke.mjs:251` → `eq('BGM 文件 = 3', stats.bgmFiles, 3);` 改为 `4`
- 详见 §7 改法。**合入修复前，audio-smoke 为 RED，不能据此声称音频测试全绿。**

### ⚠️ B4【合规一致性·待确认】汇率快照对白指向不存在的 UI
- `dialogueData.ts:333` 对白：「顶上那行是今天的汇率快照——记得，这只是参考，不是建议。咱们是看故事，不是看盘。」含合规免责口径 ✅。
- 但**全代码无任何汇率数值渲染**（grep `rate|汇率|快照` 仅在对话文案与存档快照语义出现，无数值显示 UI）。即该对白指向一个不存在的「顶上那行」。
- **处置**：当前无「未标注汇率 UI」硬违规；但属**死引用 / 文案-实现漂移**。须二选一：① 确认汇率快照 UI 存在并常驻「仅供参考，非金融建议」标（免责须持久显示在 UI 上，而非仅一次性 toast）；② 不存在则删除/改写该对白，避免误导玩家「顶上那行」凭空而来。**合规红线要求：若展示汇率快照，必须带「仅供参考，非金融建议」标注——目前仅 toast 口述，未见常驻 UI 标注，建议补齐。**

---

## 4. 🔴 资产加载策略变更回归清单（图→CDN 前置条件）

> 本清单是「图像/音频改走 CDN」的**发布前置条件**。浏览器 `localhost:8080` 预览走本地 assets，**无法覆盖 CDN 路径**，须用以下手段专门回归：
> 手段建议：① 临时把 4 个 base 指向一个可达 CDN（或本地静态服务器）跑真机；② 直接断网/改坏 base 模拟 404，验证降级；③ 用微信开发者工具「不校验合法域名」临时开关做弱网/失败回归（注意：真机仍需 B2 白名单）。

| # | 回归项 | 预期 | 现状 |
|---|---|---|---|
| C1 | **异步加载不阻塞首帧** | 首启即渲染（占位/渐变），无白屏、无转圈等待 | ✅ 代码已具备（无 await/阻塞，dirty 驱动按需重绘） |
| C2 | **本地缓存命中** | 二次进入不重复下载；`images` Map 复用 | ✅ `images.has(key)` 去重（preloadImages/preloadScenes） |
| C3 | **缺失降级·货币母题** | 母题 PNG 404 → 卡面画区域形状+放大 glyph 几何占位（非白块） | ✅ `card.ts drawMotifPlaceholder` |
| C4 | **缺失降级·背景** | 背景 PNG 404 → 保留 L0 暖色渐变兜底（非白闪） | ✅ `renderer.ts:365`+`sceneFor()` 未就绪返回 undefined |
| C5 | **缺失降级·deco_globe** | 缺失 → 跳过装饰，不报错 | ✅ `hub.ts:429` |
| C6 | **缺失降级·world tour 帧** | 某帧 404 → 区域签名色渐变兜底 + 字幕照走 + 时间轴不暂停 | ✅ `worldTour.ts drawFallback` + `tourTried` 去重 |
| C7 | **缺失降级·音频** | 音频 404/解码失败 → 静默 no-op，游戏逻辑零影响 | ✅ `wechat.ts`/`browser.ts` 哑句柄 |
| C8 | **弱网不白屏/不卡顿** | 慢速 CDN：游戏可玩、占位逐渐顶替；不冻结渲染线程 | ✅ 无阻塞加载；须真机弱网实测确认体感 |
| C9 | **占位残留** | CDN 永久不可达时，卡面/背景**稳定停留在几何占位**，不闪回、不半图残留 | ⚠️ 代码逻辑支持，但**无自动化用例覆盖**，须真机/弱网实测 |
| C10 | **CDN 域名白名单** | 真机可拉取（非 404/deny） | 🔴 未配置（见 B2） |
| C11 | **tick 级重发防护** | world tour 每帧 `preloadTourFrames` 不去重会弱网打满带宽——已用 `tourTried` 防护；货币图/背景为构造期一次性调用，无重发风险 | ✅ 已防护；若日后改为周期调用须加同款去重 |
| C12 | **双路径一致性** | web 预览（本地）与 wx（CDN）行为一致，仅来源不同 | ⚠️ 需统一 base 策略后回归两端 |

---

## 5. 关键回归 & 冒烟测试清单（微信真机必测）

> 以下为「代码层面已具备、须真机逐条走查」的冒烟。自动化 `smoke.mjs`（无头 iife boot 不抛）仅覆盖启动不崩溃，不覆盖真机交互/资产/CDN，故**真机清单不可省**。

1. **首启加载**：冷启动无白屏；进度/Hub 立即可见；母题 PNG 异步到位后无闪烁错位。
2. **配对流程**：翻牌→匹配→翻回→错配音；连翻不掐断（B1 双实例轮转）。
3. **自动收藏**：首次配对成功 `store.unlock(iso, form)` 幂等；图鉴进度 +1；二次同币仅播 repeat 不重复解锁。
4. **图鉴详情**：`openDetail` 仅已收集可进；未收集拦截；滚动阻尼音（reducedAudioFx 下静默）。
5. **world tour 触发与播放**：第 36 实体解锁置 `pendingWorldTour`→胜利面板「继续」消费；32.7s 影片播放、8 帧交叉淡化、字幕、1.5s 尾部淡出收在终止式；重看入口（`hasSeenWorldTour` 后常驻）跳过开场 2s。
6. **前后台暂停续播**：`onHide` 暂停 BGM、`onShow` 续播不重头（`wechat.ts` 已接 `wx.onHide/onShow`）；world tour 单击暂停/继续，时间轴真停（`tourPauseAccum` 扣减）。
7. **音频缺失静默降级**：零音频文件 / 文件 404 → 全链路 no-op 不抛、设置照常持久化（`audioManager` 已验证）。
8. **合规视觉抽检**：36 张母题 PNG 实为风格化原创（无真钞复刻）；region 用几何形状非国旗。
9. **体积门（提交前）**：`wx-dist` 主包 ≤4MB、总包 ≤30MB（CDN 化后应 ≈0.3MB）。
10. **CDN 全资产拉取**：真机拉取货币图/背景/音频/world tour 帧全部成功（白名单就绪）。

---

## 6. 必须人工确认项

- 🔴 **A. 音频合规人耳签收（albert 戴耳机）**：`bgm_tour.mp3`（loop:false、~32.7s、尾部 1.5s 淡出收终止式）需逐段确认无违规音色——
  - A1 金属敲击 / A2 民族拼盘 / A3 庆典语汇 / A4 人声 / A5 终止式；
  - 全程无金币碰撞、无老虎机、无收银机、无中奖号角、无真实货币采样（对齐 `audioEvents.ts:13` 合规声明）。
- 🔴 **B. wx 真机包 GUI 构建 + 真机预览**：主理人已出 `wx-dist`，但微信开发者工具「上传」+ 真机预览须 albert 操作（GUI 构建/真机预览不在本评审范围内）。
- 🔴 **C. CDN 域名白名单**（小程序后台，见 B2/B10）。
- ⚠️ **D. 汇率快照 UI 处置**（见 B4）：确认 UI 存在且常驻免责标，或改写对白。
- ⚠️ **E. 36 张母题 PNG 人工抽检**：代码层合规（风格化几何/文本、无真钞图样、region 非国旗）已确认，但**资产像素级合规**须人工目检（AI 生成母题可能无意近似真钞，属内容审核项）。

---

## 7. 已知 debt 与建议

### 7.1 audio-smoke 断言修复（仅列改法，未 Edit）
- `audio-smoke.mjs:249`：`eq('事件总数 = 25', stats.events, 25);` → 期望值 `25` 改 `26`（新增 `bgm_tour` 后注册表为 26 事件）。
- `audio-smoke.mjs:251`：`eq('BGM 文件 = 3', stats.bgmFiles, 3);` → 期望值 `3` 改 `4`（`bgm_hub/match/codex/tour` 共 4 首）。
- 理由：非真 bug，是计数断言未随 `bgm_tour` 落地同步更新；改后 audio-smoke 恢复 119/119 全绿。

### 7.2 `WORLDTOUR_BASE` TODO 落地（`worldTour.ts:116-119`）
- 当前 `'assets/remote/worldtour/'` 为本地预览路径；上线须改为 `<CDN_BASE>/worldtour/`，并确认域名进白名单（见 B2）。

### 7.3 `audioEvents.ts` 头部注释数字与实现不符
- 第 192-199 行注释写「25 个事件 / 47 个文件（44 SFX + 3 BGM）」，实际已因 `bgm_tour` 变为 **26 事件 / 48 文件（44 SFX + 4 BGM）**。注释与实现漂移，建议同步（虽不影响运行，但误导后续维护）。

### 7.4 统一「资产全 CDN」策略建议
- 当前架构只有 world tour 帧设计了 CDN；货币图/背景/音频仍本地。建议**统一为全 CDN**（与 world tour 同构），避免「半本地半 CDN」双路径带来的预览/真机行为差与回归面膨胀。`build.mjs` 同步把图/音频从 `wx-dist` 排除。

### 7.5 弱网「占位残留」补自动化用例
- C9 目前仅靠逻辑推断，无自动化覆盖。建议在 `smoke.mjs` 或新增 `asset-fallback-smoke` 中：用坏掉的 base 模拟 100% 404，断言 boot 不抛、首帧可渲染、`images` 中对应 key 保持 `undefined` 且渲染走占位分支（可注入计数桩验证 `drawMotifPlaceholder` / `drawFallback` 被调用）。

### 7.6 体积治理收尾
- CDN 化后，`wx-dist` 应仅 `game.js`(~0.3MB)+`game.json`+`project.config.json`；建议 CI 加体积断言（主包 ≤4MB、总包 ≤30MB），防止日后资产回漏进包再次顶穿。

---

## 8. 合规红线逐条核对

| 红线 | 结论 | 依据 |
|---|---|---|
| 禁用真实钞币图像（仅风格化原创母题） | ✅ 代码层达标；⚠️ 资产像素级须人工抽检（§6-E） | `card.ts` 全为几何/文本+风格化母题；`currencies.ts:12` 声明无真钞图；`assets/cur_*` 命名 `amer/euro/asia_afr` 段非国旗 |
| 货币标识用 ISO 4217 + 弱化国旗（region 段非真实国旗） | ✅ | region 用 `amer/euro/asia_afr` + 几何形状（圆角矩/六边/菱，`card.ts regionShapePath`）；ISO 码大字文本为权威身份 |
| 汇率静态快照须标注「仅供参考，非金融建议」 | ⚠️ 待确认 | 对白含「只是参考不是建议」(`dialogueData.ts:333`)，但指向 UI 缺失（§3-B4）；须常驻 UI 标注 |
| 定位教育/文化，禁投资/预测/交易措辞 | ✅ | 全量扫描无 投资/交易/预测/收益/涨跌/升值 措辞；`discoveryLine/grandpaNote` 均为可查证文化/历史事实（`currencies.ts:22` 自检） |

---

## 9. Handoff 要点（回传主理人汇编）

1. **当前不可提审**：wx 包 84MB 顶穿硬上限；CDN 迁移代码（4 个 base 常量）尚未合入，B1 是头号阻断。
2. **B1 的隐藏二级阻断**：仅移图不够——音频 13.6MB 仍在包内、超 4MB 主包，音频也须 CDN 或拆 subpackage。建议「资产全 CDN」一步到位（§7.4）。
3. **B2 CDN 白名单**是开发者工具不校验的真机必炸项，须后台人工确认。
4. **B3 audio-smoke 红灯**非真 bug，2 行断言（249/251）改 25→26、3→4 即全绿；合入前不能声称音频测试通过。
5. **B4 汇率快照**对白指向不存在的 UI，合规口径须落到常驻 UI 标注或改写对白。
6. **人工签收项**：A 组 `bgm_tour` 五段音色人耳合规（albert 戴耳机）、wx 真机 GUI 构建+预览、36 张母题 PNG 像素级合规抽检。
7. **功能/合规/音频运行时质量本身达标**，放行与否取决于上述打包策略阻断项的清除，路径清晰、范围可控。

---
*评审完成时间基准：依据 `/Users/albert/Documents/GameDream/minigame/` 当前工作区快照。本报告不含任何源代码修改。*
