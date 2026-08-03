# SFX 金属质感重设计（Metallic Redesign）· 货币图鉴·对对碰

> 文档：`design/audio/sfx-metallic-redesign.md` · 作者：阮和鸣（音频 / 声效）
> 版本：v1.0 · 日期：2026-08-01 · 状态：待主理人（游承峰）审批 → 交 engineering-lead 落地
> 性质：**纯 prompt 语义规格，不含代码、不含脚本改动**。engineering-lead 据此改 `minigame/tools/gen_sfx_elevenlabs.mjs` 的 `BASE` / `SUFFIXES` / `semanticPrompt()`，**只重生成本文档 §3 的 22 个文件**。
> 上游：`design/audio/audio-direction.md`（三条听觉铁律 / 黑名单 / 总线）、`design/audio/audio-events.md`（事件表 B/C/D 组）
> 现状基线：`minigame/tools/gen_sfx_elevenlabs.mjs`（`dur` 单位=秒，`prompt_influence` 默认 0.6、combo/star 为 0.7，计费 ~40 积分/秒，免费档 1 万/月）

---

# 0. 一句话总纲 · 这套金属的「声音人格」

> **温润青铜 · 展柜微光（Warm Bronze, Vitrine Glow）**
> ——像在安静的博物馆里，用指腹轻轻托起展柜中的一枚青铜藏品：**有金属的泛音与余韵，但起振是软的、高频是暖的、尾音是收着的**。它的原型是「文物被珍视地触碰」，**永远不是柜台上的清点声**。

一句话给外包/生成器的锚：**Touched, not counted.**（被触碰的，不是被清点的。）

---

# 1. 为什么是金属，以及金属只能出现在哪里

## 1.1 材质编码（Material Coding）· 本次改动的设计骨架

用户反馈「翻牌 / 配对 / 通关应该是金属」是对的，但如果**全站改金属**，会立刻踩两个坑：错配音金属化 = 刺耳否定（违背铁律 2 与「无失败态」支柱）；UI 金属化 = 变回工具 App。

因此本次确立一条可执行的材质分工，**它同时是「不变清单」的判定依据**：

| 材质 | 语义 | 覆盖事件 | 本次 |
|---|---|---|---|
| **金属（青铜 / 钟琴 / 风铃）** | **藏品本体**：手指触到了那枚钱币名片，或两枚藏品**共鸣成立** | 翻牌、配对成功、连击、通关成套 | ✅ **改** |
| **木 / 纸** | **手账与容器**：册子、页面、按钮、册册说话——「装藏品的东西」 | 全部 `ui/*`、`sfx_view_*`、`sfx_dialogue_pop`、`sfx_hub_first_open` | ⛔ 不动 |
| **木（柔和下行）** | **未共鸣**：两枚不成对 = 金属**没有响** | `sfx_match_miss`、`sfx_card_flipback`（半金属，见下） | ⛔ / 半 |

**这条编码让「金属」自带信息量**：玩家听到金属＝有进展，听到木质＝在操作。金属不再是装饰，而是反馈通道本身。

## 1.2 三个层级：触碰 → 鸣响 → 成套

金属内部必须再分层，否则 18 对的长局里翻牌音会盖过配对音：

| 层 | 事件 | 金属状态 | 关键词 |
|---|---|---|---|
| L1 **触碰** | `sfx_card_flip` | 金属被**摸到**，几乎无泛音尾（damped） | `touched, damped, no ring out` |
| L2 **鸣响** | `sfx_match_success_*` / `sfx_combo_step` | 金属被**敲响**，有 shimmer 短尾 | `struck with soft mallet, shimmer tail` |
| L3 **成套** | `sfx_region/chapter/win/streak/grade` | 金属**共鸣成一片**，长尾 | `bell, long warm decay, chime settling` |

翻牌绝不可进入 L2。翻牌是全局最高频音（T3 环球一局 ≥36 次），一旦带 shimmer 尾，长局必疲劳，且会把配对成功的仪式感稀释掉。

## 1.3 铁律不因改金属而放宽

`audio-direction.md` §2.1 三条铁律**继续全效**，且金属恰恰是最容易违反的材质，故每条 prompt 都必须内建对冲词：

| 铁律 | 金属化风险 | prompt 内建对冲词 |
|---|---|---|
| 铁律 1 · 软起振 ≥8ms、无金属瞬态尖峰 | 金属天然硬瞬态 | `soft mallet` / `no sharp attack` / `damped` |
| 铁律 2 · 上行奖励、下行不惩罚 | 金属下行易刺耳 | 下行仅出现在 `flipback`，且必须 `palm muted` |
| 铁律 3 · 8kHz 以上 −6dB | 金属高频 sizzle | `warm` / `muted high end` / `dark bronze` |

---

# 2. 合规词表（本次生成的硬约束）

## 2.1 可用金属词（白名单，本文档已全部落到 prompt 里）

`metal chime` · `glockenspiel` · `singing bowl` · `bell with metallic overtone` · `glass marimba` · `metallic shimmer` · `wind chime` · `collectible token ping` · `premium artifact` · `cultural relic chime` · `soft anvil ring (轻)` · `bronze` / `silvered` / `pewter`（材质形容，抽象）

## 2.2 硬禁词（任何 prompt 不得出现）

`coin` · `cash` · `register` · `slot machine` · `jackpot` · `win` · `money` · `currency clink` · `bling` · `gold coin` · `treasure` · `prize` · 收银机 · 硬币 · 钱 · 中奖 · 赌

> ⚠️ **给 engineering-lead 的自检提醒**：硬禁词须按**独立单词**校验（正则用 `\bwin\b`、`\bcash\b` 等）。白名单里的 **`wind chime` 含子串 "win"**，若用 `includes('win')` 做校验会误报——这是本次唯一的已知误报陷阱。

## 2.3 两个「虽在允许词表内、但本文档主动弃用」的词（专业判断，请主理人知悉）

| 弃用词 | 理由 |
|---|---|
| `temple bell` | 与 `audio-direction.md` §3.3「明确不做国别/大洲乐器 cosplay」冲突。寺钟带明确地域与宗教联想，用在**全局**的 `sfx_chapter_complete` 会让「亚非区」被隐性代表；用在 `_asia_afr` 则正是我们否决过的刻板印象方案。改用抽象的 `large bronze bell`。 |
| `soft anvil ring` | 铁砧带**锻造/劳作**语义，与「博物馆展柜」人格不同源；且瞬态最硬，最易破铁律 1。备用不启用。 |

## 2.4 区域差异的写法（重要）

`sfx_region_complete` 的三个变体，**prompt 内不出现任何地理词**（不写 americas / europe / asia / africa），区域差异**只用音色形容词 + 混响时长**承载。这既守 §3.3 反刻板印象，也避免生成器擅自套用民族乐器。文件名后缀 `_amer/_euro/_asia_afr` 保持不变，映射关系写在 `semanticPrompt()` 里即可。

---

# 3. 交付表 · 需重生成的 22 个文件

> 表内 `dur` 单位为**秒**（对齐脚本 `duration_seconds`），`prompt_influence` 按用户要求落在 0.6–0.7。
> **prompt 已写成整条可直接粘贴**，建议 engineering-lead 在 `semanticPrompt()` 中按 `(id, suffix)` 显式返回，不再依赖 `variantModifier()` 拼接——避免 `, slightly brighter` 拼到金属描述后语义漂移。

## A. 翻牌（L1 触碰 · 总线 `SFX.GAMEPLAY`）

| eventId | 变体 | 新 text prompt（EN） | dur(s) | prompt_influence | 备注 |
|---|---|---|---|---|---|
| `sfx_card_flip` | `_01` | `small bronze collectible token lifted and turned over on felt cloth, soft metallic touch with a faint glockenspiel overtone, very short and damped, no ring out, no sharp attack, warm muted high end` | 1.0 | 0.65 | L1 基准音。**必须听感干、无尾**；运行时仍按 `audio-events.md` B1 做 ±1.5 半音随机 |
| `sfx_card_flip` | `_02` | `small bronze collectible token lifted and turned over on felt cloth, soft metallic touch with a faint glockenspiel overtone, slightly brighter and a little higher, very short and damped, no ring out, no sharp attack` | 1.0 | 0.65 | 亮变体 |
| `sfx_card_flip` | `_03` | `small bronze collectible token lifted and turned over on felt cloth, soft metallic touch, slightly duller and lower, very short and damped, no ring out, no sharp attack, warm muted high end` | 1.0 | 0.65 | 暗变体。三变体的差异应**只在明暗**，不在节奏 |
| `sfx_card_flipback` | `_01` | `two small metal artifact plates laid back down onto felt, palm muted metallic touch, short gentle falling tone, fully damped, no ring out, no sharp attack` | 1.1 | 0.65 | 半金属：**被按住的金属**。两张卡共播一次，不双发（B2） |
| `sfx_card_flipback` | `_02` | `two small metal artifact plates laid back down onto felt, palm muted metallic touch, slightly softer and lower, short gentle falling tone, fully damped, no ring out` | 1.1 | 0.65 | 下行幅度须 ≤ 小三度（铁律 2） |

## B. 配对消除（L2 鸣响 · 总线 `SFX.GAMEPLAY` / `SFX.REWARD`）

| eventId | 变体 | 新 text prompt（EN） | dur(s) | prompt_influence | 备注 |
|---|---|---|---|---|---|
| `sfx_combo_step` | `_01` | `single glockenspiel note struck with a soft mallet, low pitch, clean metallic shimmer with short decay, step one of a rising five step scale, no harsh attack` | 1.0 | 0.7 | **升调梯度**：建议音阶 C5–D5–E5–G5–A5（大调五声，避半音的紧张感） |
| `sfx_combo_step` | `_02` | `single glockenspiel note struck with a soft mallet, mid low pitch, clean metallic shimmer with short decay, step two of a rising five step scale, no harsh attack` | 1.0 | 0.7 | ↑ D5 |
| `sfx_combo_step` | `_03` | `single glockenspiel note struck with a soft mallet, middle pitch, clean metallic shimmer with short decay, step three of a rising five step scale, no harsh attack` | 1.0 | 0.7 | ↑ E5 |
| `sfx_combo_step` | `_04` | `single glockenspiel note struck with a soft mallet, mid high pitch, clean metallic shimmer with short decay, step four of a rising five step scale, no harsh attack` | 1.0 | 0.7 | ↑ G5 |
| `sfx_combo_step` | `_05` | `single glockenspiel note struck with a soft mallet, high pitch, bright but warm metallic shimmer, short decay, step five of a rising five step scale, no harsh attack` | 1.0 | 0.7 | ↑ A5，5 级封顶后不再升 |
| `sfx_match_success_new` | `_01` | `three ascending notes on a small bronze glockenspiel struck with soft mallets, followed by a faint singing bowl shimmer tail, calm museum artifact discovery, warm and understated, no fanfare, no horns` | 1.7 | 0.6 | **P1 情绪最高点**。素材须留 ≥6dB 头空（见 §5.2） |
| `sfx_match_success_new` | `_02` | `three ascending notes on a small bronze glockenspiel struck with soft mallets, slightly brighter with a longer metallic shimmer tail, calm artifact discovery, warm and understated, no fanfare, no horns` | 1.7 | 0.6 | 亮变体 |
| `sfx_match_success_repeat` | `_01` | `two ascending notes on a small metal chime bar struck with a soft mallet, warm bronze overtone, brief gentle shimmer, calm and understated, no fanfare` | 1.4 | 0.6 | 必须明显**弱于** `_new`，否则新币解锁失去落差 |
| `sfx_match_success_repeat` | `_02` | `two ascending notes on a small metal chime bar struck with a soft mallet, slightly brighter bronze overtone, brief gentle shimmer, calm and understated, no fanfare` | 1.4 | 0.6 | 亮变体 |
| `sfx_match_success_repeat` | `_03` | `two ascending notes on a small metal chime bar struck with a soft mallet, slightly softer and rounder, warm bronze overtone, brief shimmer, calm and understated, no fanfare` | 1.4 | 0.6 | 柔变体 |
| `sfx_match_miss` | `_01/_02` | — | — | — | ⛔ **保持不变**（理由见 §4.1） |

## C. 通关（L3 成套 · 总线 `SFX.REWARD`）

| eventId | 变体 | 新 text prompt（EN） | dur(s) | prompt_influence | 备注 |
|---|---|---|---|---|---|
| `sfx_region_complete` | `_amer` | `soft mallet struck metal chime chord, warm and bright bronze timbre, short dry room reverb about one second, calm sense of a set completed, no fanfare, no horns` | 1.8 | 0.65 | **明亮**：暖 + 干（对齐 direction §3.3 amer reverb 1.2s）。prompt 内**无地理词** |
| `sfx_region_complete` | `_euro` | `soft mallet struck metal chime chord, clear refined silvered timbre, larger hall reverb about two seconds, calm sense of a set completed, no fanfare, no horns` | 1.8 | 0.65 | **精致**：清亮 + 大空间（euro reverb 1.8s） |
| `sfx_region_complete` | `_asia_afr` | `soft mallet struck metal chime chord, airy singing bowl timbre with a low warm body, medium reverb about one and a half seconds, calm sense of a set completed, no fanfare, no horns` | 1.8 | 0.65 | **空灵**：柔 + 低频略厚（asia_afr reverb 1.5s） |
| `sfx_win_session` | `_01` | `warm three note metal chime arpeggio played with soft mallets, then a paper folder closing softly, calm sense of a session completed, gentle and unhurried, no fanfare, no horns, no cheering` | 1.8 | 0.6 | 「金属琶音 + 纸页收拢」保留纸质收尾，把一局锚回手账语境。**prompt 内不得出现 "win"** |
| `sfx_chapter_complete` | `_01` | `a single large bronze bell struck with a soft mallet, long warm decay, with a faint metal wind chime settling above it, solemn calm museum hall, no fanfare, no horns, no drums` | 2.0 | 0.6 | **全作唯一 P0**，播放期间其余 SFX duck ×0.5。刻意弃用 `temple bell`（§2.3） |
| `sfx_streak_milestone` | `_01` | `gentle ascending metal wind chime phrase, a few small bronze tubes touching each other, soft paper rustle underneath, calm and warm, no fanfare` | 1.5 | 0.6 | 风铃 = 「又来了一天」的轻盈感，不做成就号角 |
| `sfx_grade_unlock` | `_01` | `a small metal latch on a display cabinet easing open, soft muted metallic movement followed by a faint glass marimba overtone, calm and satisfying, no sharp attack` | 1.3 | 0.6 | **展柜门闩**——直接把「解锁」写进博物馆人格 |

## 3.1 用量核算（免费档预算）

| 组 | 文件数 | 合计秒数 |
|---|---|---|
| A 翻牌 | 5 | 5.2s |
| B 配对 | 10 | 17.6s |
| C 通关 | 7 | 12.0s |
| **合计** | **22** | **34.8s** |

≈ 34.8 × 40 ≈ **1392 积分**（免费档 1 万/月）。即使**全量重试两轮仍安全**，为「听感不满意再调一轮」预留了余量。这也是我把翻牌 dur 从 1.3 压到 1.0 的原因之一——翻牌本就该短，顺便省出重试预算。

---

# 4. 保持不变清单（交 engineering-lead 直接跳过）

**共 21 个 SFX 文件 + 3 轨 BGM 不动**。22（改）+ 21（不改）= 43，与 `audio-events.md` §9 的 SFX 总数对齐，无遗漏。

| eventId | 变体 | 当前材质 | 保持不变的理由 |
|---|---|---|---|
| `sfx_ui_tap` | `_01/_02` | 木 | 全局最高频音；金属化即「工具 App 化」，且与材质编码（金属=藏品）冲突 |
| `sfx_ui_back` | `_01` | 木（下行） | 同上；金属下行更易读成「否定」 |
| `sfx_ui_toggle` | `_01/_02` | 木 | 设置项属容器层 |
| `sfx_ui_locked` | `_01` | 木质闷响 | **关键**：无失败态。金属闷响很难不带「拒绝」质感，木质毛毡才是「这扇门还没开」 |
| `sfx_view_codex_open` | `_01/_02` | 纸 | 翻册子＝纸。纸质在此是**信息**，不是妥协 |
| `sfx_view_detail_open` | `_01/_02` | 纸 | 同上 |
| `sfx_ui_scroll_tick` | `_01/_02/_03` | 纸 | 极高频装饰；金属 tick 必刺耳 |
| `sfx_match_miss` | `_01/_02` | 木质柔和下行 | **明确保持不变**，理由见 §4.1 |
| `sfx_unlock_codex` | `_01` | 木质盖章 | **明确保持不变**，理由见 §4.2 |
| `sfx_star_pip` | `_01/_02/_03` | 小铃 pip | 本就是铃音（自带金属泛音），与新人格自洽；且它与新版 `sfx_win_session` 在 350/570/790ms 连发，同帧改两处风险高于收益。见 §4.3 |
| `sfx_dialogue_pop` | `_01/_02` | 纸 + 木 pip | 册册的「声音签名」，一致性 > 独特性（`audio-events.md` §6.1）。金属化会让册册变成「通知栏」 |
| `sfx_hub_first_open` | `_01` | 木 + 暖垫 | 一生一次的「摊开册子」，属容器层 |
| `bgm_hub` / `bgm_match` / `bgm_codex` | — | — | BGM 全不动。金属只做 SFX 层，BGM 一旦金属化会与交互音打架 |

## 4.1 `sfx_match_miss` —— 保持木质，不加金属（明确结论）

三条理由，任一条都足以否决：

1. **语义自洽**：本次材质编码是「金属＝共鸣成立」。错配恰恰是**两枚不共鸣**，金属**不该响**。让错配保持木质，玩家在几十次配对后会无意识建立「有金属＝对了」的条件反射——这是把音效变成信息通道的免费收益。
2. **铁律 2 + 无失败态**：金属 + 下行 = 听感上最接近「答错蜂鸣」的组合。册册的错配台词是「（轻轻摇头）不是一对。再看看——」，金属下行与这个语气不同温度。
3. **听觉卫生**：错配是对局中第二高频的反馈音。金属高频能量本就大，高频事件金属化 = 长局疲劳的最快路径。

> 若后续用户仍希望错配「有点材质感」，我建议的**替代方案不是金属，而是把木质做得更实**（更厚的木块 + 更短的尾），而非换材质。此项留作 v2 观察。

## 4.2 `sfx_unlock_codex` —— 木质盖章必须保留（这是本次最关键的「不改」）

`audio-events.md` §4.1 的编排里，t=0 的 `sfx_match_success_new` 与 t=370ms 的 `sfx_unlock_codex` **完全重叠**。

- 若两者都金属 → 泛音互相糊住，「上行报喜 + 落章确认」两层会塌成一坨金属噪。
- 保持 **金属上行（C1）+ 木质盖章（C2）** 的材质对比，两层在频谱上天然分离，玩家能清楚听出「发现了 → 收进册子了」两个动作。

**这是本次改动里唯一一处「靠不改来让改动生效」的地方，请 engineering-lead 务必不要顺手一起重生成。**

## 4.3 `sfx_star_pip` —— 保持不变，但列为 v2 观察项

保持理由已在表内。**观察点**：新版 `sfx_win_session` 带金属琶音尾，星星 pip 在其后 350ms 起连发三颗。若真机试听发现「琶音尾 + pip」音色打架或音高冲突，再单独重生成 3 个 pip（成本 3 × 0.8s ≈ 96 积分，极低）。**本轮不动，先听。**

---

# 5. 验收与风险（给 engineering-lead 与主理人）

## 5.1 生成后必听的三个点（按优先级）

1. **翻牌的起振**（铁律 1）：连点 5 次 `sfx_card_flip`。若听到 click/尖峰 → prompt_influence 从 0.65 降到 0.55 重生一轮，或在 prompt 末尾追加 `no metallic clang, no transient spike`。这是本次最可能翻车的一条。
2. **`_new` 与 `_repeat` 的落差**：连听两者。若 `_repeat` 听起来同样隆重 → 新币解锁的情绪高点被抹平，需把 `_repeat` 的 dur 压到 1.2s 重生。
3. **区域三变体的可辨识度**：连听 `_amer/_euro/_asia_afr`。三者应能听出「干/大空间/柔厚」的差别，但**不能**听出任何民族乐器。若生成器擅自加了民族音色 → 立即重生，这是合规问题不是审美问题。

## 5.2 头空（硬要求，素材阶段解决）

`sfx_match_success_new` + `sfx_unlock_codex` 在 t=370–900ms 完全重叠，叠加 True Peak 必须 ≤ **−3 dBFS**（`audio-direction.md` §6.2）。运行时**无限幅器**（InnerAudioContext 不提供）。金属音色峰值密度高于木质，因此 `_new` 素材需比原木质版本**多留约 6dB 头空**。若生成结果偏响，在 `audioEvents.ts` 的 `eventGain` 上补一刀（建议 ×0.85）比重生更省。

## 5.3 已知风险清单

| 风险 | 等级 | 说明与建议 |
|---|---|---|
| 金属高频破铁律 3（8kHz 以上 −6dB） | 🟡 中 | ElevenLabs 无法保证频响。prompt 已加 `warm / muted high end` 对冲，但**需真机戴耳机复听**。若 sizzle 明显，建议工程侧对 `SFX.GAMEPLAY` 组整体 ×0.9，或后期统一过一道高频搁架。**存疑项，需真机验证后定稿。** |
| 生成器不遵守音高梯度（combo 五级） | 🟡 中 | ElevenLabs 对「low/mid/high」的服从度不稳定。**低成本兜底**：只生成 `_03`（middle）一个素材，工程侧用 `InnerAudioContext.playbackRate` 取 `1.00 / 1.06 / 1.12 / 1.19 / 1.26` 得到严格单调的五级升调——比生成五个更可控，且省 4 次调用。**建议先按表生成，若梯度不单调再切兜底方案（需程基岩确认目标基础库对 playbackRate 的支持）。** |
| 硬禁词自检误报 `wind chime` | 🟢 低 | 用 `\bwin\b` 词边界正则，见 §2.2 |
| 免费档次数上限（传闻 8 次/月） | 🟡 中 | 脚本已有 402/403 熔断。22 个文件若中途触顶，**优先级顺序**建议：翻牌 5 个 → 配对 10 个 → 通关 7 个（翻牌频次最高，改动收益最大） |
| 覆盖旧文件不可回滚 | 🟢 低 | 建议 engineering-lead 生成前先把这 22 个旧文件备份到 `assets/audio/sfx/_backup_wooden/`，A/B 试听后再决定留哪套 |

## 5.4 与其他方向的对齐

| 项 | 状态 |
|---|---|
| 合规红线（禁钱味） | ✅ §2.2 硬禁词表 + §2.3 主动弃用词；prompt 全部经词表自检 |
| 与 `audio-direction.md` §3.2 黑名单 | ✅ 金币/老虎机/收银机/中奖号角/真实币采样**依然全禁**。本次新增的是「抽象金属材质」，不是「货币音」——黑名单无需修改 |
| 与 §3.3 反国别 cosplay | ✅ 区域差异只用音色形容词 + 混响，prompt 内零地理词 |
| 与三条听觉铁律 | ⚠️ 设计层已内建对冲词，**执行层需真机复听**（§5.1 / §5.3） |
| 与 `audio-events.md` 事件表 | ✅ eventId / 变体后缀 / 优先级 / 总线 / 变体数全部沿用，**无一处改动**——本次只换音色，不改结构 |
| 文档同步 | 🔲 待办：本轮定稿后，需回写 `audio-direction.md` §3.1 白名单（加「青铜/钟琴/风铃」层）与 `audio-events.md` B/C/D 组的「音色方向」列，保持三份文档不漂移 |

---

*本文档为 prompt 语义规格，不含代码。脚本改动与资产重生成由 engineering-lead 执行，需主理人审批后启动。*
