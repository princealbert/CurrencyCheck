# 对白引擎规格（Dialogue Engine Spec）

> **文档类型**：可执行 TS 规格文档（供工程方 ③b engineering-lead 照此实现）
> **项目**：微信小游戏《货币图鉴·对对碰》
> **设计师**：文策渊（design-strategist）
> **日期**：2026-07-31
> **状态**：草案 v1（待主理人 / 程基岩评审）
> **设计源头**：`dialogue-nodes.md`（12 节点，已定稿，不改文案）
> **代码衔接**：`app/app.ts`、`core/metaStore.ts`、`core/collectionStore.ts`、`render/fx.ts`

---

## 0. 文档定位与约束

本文档把 `dialogue-nodes.md` 的 12 个状态触发式对白节点落为**引擎规格**——定义触发评估、文案轮转/去重/冷却、节奏控制、状态键、API 接口、与 `app.ts` 的衔接点。

**不做什么（红线）**：
- 不写 TS 实现代码（工程方的活）。
- 不改 `dialogue-nodes.md` 的文案内容（已定稿）。
- 不改 `currencies.ts` / `app.ts` / `metaStore.ts`（只标注需新增什么）。
- 不做 i18n（中文先）、不做 telemetry（Phase 2）。

**术语约定**：
- **App session**：从应用启动到关闭（对应 `App` 构造 → 页面卸载）。
- **Match session**：从 `startChapter()` 到 `finishWin()` / `backToHub()`（一局配对）。
- **P0–P3**：优先级（P0 教学 > P1 解锁 > P2 日常 > P3 错配）。

---

## §1 触发条件矩阵

每个节点的触发条件以 TS 表达式给出，标注所需状态键、触发频率、优先级、与 toast 队列的衔接方式。

### 优先级定义

| 等级 | 语义 | 节点 | 打断权 |
|------|------|------|--------|
| **P0** | 教学 | `S1_HUB_FIRST_OPEN`、`MATCH_FIRST_TUTORIAL` | 可打断 P2/P3 |
| **P1** | 解锁 | `MATCH_SUCCESS_NEW`、`MATCH_WIN_SESSION`、`REGION_COMPLETE` | 可打断 P2/P3 |
| **P2** | 日常 | `S1_HUB_RETURN`、`MATCH_SUCCESS_REPEAT`、`CODEX_OPEN`、`PROFILE_OPEN`、`PASSPORT_TEASER`、`RATE_SNAPSHOT_NUDGE` | 不打断 |
| **P3** | 错配 | `MATCH_MISS` | 不打断 |

### 触发频率定义

| 策略 | 语义 | 状态载体 |
|------|------|----------|
| `once-lifetime` | 播完永不再播（跨 app session 持久化） | `seenDialogueNodes`（持久化） |
| `once-per-session` | 每 app session 最多 1 次 | `appSessionPlayedNodes`（内存） |
| `once-per-match-session` | 每局最多 1 次 | `matchSessionPlayedNodes`（内存） |
| `cooldown` | 带计数器限频 | `matchSessionCooldowns`（内存） |
| `rotate` | 轮转池选下一条 + cooldown | `rotateIndex` + `matchSessionCooldowns`（内存） |

### 矩阵总表

| # | 节点 ID | 触发条件（TS 表达式） | 所需状态键 | 频率 | 优先级 | Toast 衔接 |
|---|---------|---------------------|-----------|------|--------|-----------|
| 1 | `S1_HUB_FIRST_OPEN` | `!meta.hasLaunchedBefore && view === 'hub'` | `hasLaunchedBefore` **[NEW 持久化]** | once-lifetime | P0 | 多行逐行入队 |
| 2 | `S1_HUB_RETURN` | `meta.hasLaunchedBefore && view === 'hub' && !appSessionPlayedNodes.has('S1_HUB_RETURN')` | `hasLaunchedBefore`、`consecutiveDays` **[NEW]**、`lastVisitDate` **[NEW]**、`appSessionPlayedNodes` **[NEW 内存]** | once-per-session | P2 | 单行（sub-state 选取） |
| 3 | `MATCH_FIRST_TUTORIAL` | `!meta.hasSeenFirstTutorial && flipped.length === 2 && !matchSessionFirstFlipPairFired` | `hasSeenFirstTutorial` **[NEW 持久化]**、`matchSessionFirstFlipPairFired` **[NEW match-session]** | once-lifetime | P0 | 多行逐行入队 |
| 4 | `MATCH_SUCCESS_NEW` | `result.matched && !wasCollected` | `store.isCollected(iso)` **[已有]** | once-lifetime（per iso） | P1 | 多行逐行入队（delayed） |
| 5 | `MATCH_SUCCESS_REPEAT` | `result.matched && wasCollected && matchSessionRepeatSkip === 0` | `store.isCollected(iso)` **[已有]**、`matchSessionRepeatSkip` **[NEW match-session]**、`rotateIndex` **[NEW 内存]** | rotate + cooldown | P2 | 单行 |
| 6 | `MATCH_MISS` | `!result.matched && matchSessionMissCount < MATCH_MISS_MAX` | `matchSessionMissCount` **[NEW match-session]** | cooldown（≤2/局） | P3 | 单行 |
| 7 | `MATCH_WIN_SESSION` | `result.complete && !matchSessionPlayedNodes.has('MATCH_WIN_SESSION')` | `matchSessionPlayedNodes` **[NEW match-session]** | once-per-match-session | P1 | 多行逐行入队 |
| 8 | `CODEX_OPEN` | `view === 'detail' && !seenDialogueNodes.has('CODEX_OPEN:'+iso)` | `seenDialogueNodes` **[NEW 持久化]** | once-lifetime（per iso） | P2 | 多行逐行入队 |
| 9 | `PROFILE_OPEN` | `profileOpened && !seenDialogueNodes.has('PROFILE_OPEN')` | `seenDialogueNodes` **[NEW 持久化]** | once-lifetime | P2 | 单行 |
| 10 | `PASSPORT_TEASER` | `passportSlotTapped && !seenDialogueNodes.has('PASSPORT_TEASER')` | `seenDialogueNodes` **[NEW 持久化]** | once-lifetime | P2 | 多行逐行入队 |
| 11 | `REGION_COMPLETE` | `regionShelfFull(region) && !seenDialogueNodes.has('REGION_COMPLETE:'+region)` | `seenDialogueNodes` **[NEW 持久化]**、`store.progress()` **[已有]** | once-lifetime（per region） | P1 | 多行逐行入队 |
| 12 | `RATE_SNAPSHOT_NUDGE` | `hubRateBarFirstViewed && !seenDialogueNodes.has('RATE_SNAPSHOT_NUDGE')` | `seenDialogueNodes` **[NEW 持久化]** | once-lifetime | P2 | 单行 |

### 各节点触发条件详解

#### 1. S1_HUB_FIRST_OPEN — 首次开启 Hub

```
触发：!meta.hasLaunchedBefore && view === 'hub'
时机：App 构造完毕、首帧渲染前（或 start() 调用后）
播完后：meta.markLaunchedBefore()  → hasLaunchedBefore = true（持久化）
行数：4 行（逐行入队）
delay：无（首帧即播）
```

> **设计意图**：玩家第一次打开游戏时，册册做自我介绍。这是唯一一条在配对玩法开始前播的叙事，建立"继承行囊 → 配回名片"的前提。

#### 2. S1_HUB_RETURN — 日常回访

```
触发：meta.hasLaunchedBefore && view === 'hub' && !appSessionPlayedNodes.has('S1_HUB_RETURN')
时机：backToHub() 调用时（从配对/图鉴返回 Hub）
播完后：appSessionPlayedNodes.add('S1_HUB_RETURN')
行数：1 行（sub-state 选取）
delay：无

sub-state 选取逻辑（按优先级从高到低）：
  ① daysSinceLastVisit >= 7  → "离开≥7天" 行
  ② consecutiveDays >= 3      → "连续≥3天" 行
  ③ 否则                      → "基础" 行

连续天数计算（在 hubOpened 时执行）：
  today = currentDate()  // YYYY-MM-DD
  if (lastVisitDate == null):
    consecutiveDays = 1
  elif (lastVisitDate == today):
    // 同一天重复打开，不重复计数
    break
  elif (lastVisitDate == yesterday):
    consecutiveDays = consecutiveDays + 1
  else:
    consecutiveDays = 1  // 断签重置
  lastVisitDate = today
  daysSinceLastVisit = today - lastVisitDate  // 在计算前保存旧值
```

> **注意**：`daysSinceLastVisit` 应在更新 `lastVisitDate` **之前**计算，否则永远为 0。

#### 3. MATCH_FIRST_TUTORIAL — 首次配对（叙事化教学）

```
触发：!meta.hasSeenFirstTutorial && flipped.length === 2 && !matchSessionFirstFlipPairFired
时机：flipCard() 中，当 flipped.length 首次变为 2 时
播完后：meta.markSeenFirstTutorial()、matchSessionFirstFlipPairFired = true
行数：3 行（逐行入队）
delay：无（翻牌动画期是教学的最佳时机，不需延迟）
```

> **设计意图**：把"翻两张 → 配对"的教学藏在册册的邀请里。教学在玩家翻出第一对时触发，而非进入配对视图时——让玩家先动手再讲解，降低前置说教感。

#### 4. MATCH_SUCCESS_NEW — 配对成功·新发现

```
触发：result.matched && !wasCollected
时机：flipCard() 中，配对成功且该 ISO 首次被收集（任意形态）
去重：store.isCollected(iso) 已为 true 后，wasCollected 必为 true → 自然切到 MATCH_SUCCESS_REPEAT
行数：3 行（逐行入队）
  行 1："好眼力！这两张是一对【<ISO> <中文名>】。"
  行 2："<discoveryLine>"（来自 currencies.ts）
  行 3："（发现动画）它进册子了——翻到图鉴那页，我给你讲讲背后的故事。"
delay：BURST_AT + UNLOCK_TOAST_DELAY = 370 + 200 = 570ms（等 burst 起播后再入队）
```

> **重要变更**：当前 `app.ts` 在 `firstTime` 时推送 `flashPrimary` / `flashSecondary`（短 flash 文案）。引擎接管后，改为播放 `discoveryLine`（完整文化叙事）。`flashPrimary` / `flashSecondary` 不再由配对成功路径触发——它们保留在 `currencies.ts` 中，未来可用于其他场景（如 Hub 悬停预览）。

#### 5. MATCH_SUCCESS_REPEAT — 配对成功·已见过

```
触发：result.matched && wasCollected && matchSessionRepeatSkip === 0
时机：flipCard() 中，配对成功但该 ISO 已被收集过
去重：cooldown — 触发后 matchSessionRepeatSkip = MATCH_REPEAT_COOLDOWN（=2）
      后续每次 repeat 配对时 skip > 0 → skip-- 不播；skip = 0 时才再次触发
轮转：rotateIndex 交替选取 2 行文案
行数：1 行
delay：无
```

> **轮转池**：`dialogue-nodes.md` 提供了 2 条文案（任务描述中的"3 条轮换"系笔误，以节点文档为准）。rotateIndex 在 0–1 间循环递增。

#### 6. MATCH_MISS — 错配

```
触发：!result.matched && matchSessionMissCount < MATCH_MISS_MAX
时机：flipCard() 中，判定为错配时
去重：cooldown — 每次触发 matchSessionMissCount++
      上限 MATCH_MISS_MAX = 2（每局最多播 2 次错配对白）
行数：1 行
delay：无（错配反馈应即时）
```

> **防刷屏**：一局 3 对的关卡可能错配 5–8 次，但册册只会说 2 次"不是一对"。后续错配仅靠翻回动画传达，不叠加语音。

#### 7. MATCH_WIN_SESSION — 一局配对完成

```
触发：result.complete && !matchSessionPlayedNodes.has('MATCH_WIN_SESSION')
时机：flipCard() 中，最后一对配对成功 → finishWin() 调用前
播完后：matchSessionPlayedNodes.add('MATCH_WIN_SESSION')
行数：2 行（逐行入队）
delay：建议 500ms（等胜利面板弹出后再播，避免与星弹入动画抢注意力）
```

#### 8. CODEX_OPEN — 翻开图鉴某币种

```
触发：view === 'detail' && !seenDialogueNodes.has('CODEX_OPEN:'+iso)
时机：openDetail(iso) 调用时（玩家在图鉴中点入某币种详情页）
播完后：seenDialogueNodes.add('CODEX_OPEN:'+iso)
行数：2 行（逐行入队）
  行 1："翻开这一页——<ISO>。"
  行 2："周爷爷在这儿夹了张纸条：'<grandpaNote>'"
delay：无（进详情页即播）
```

> **与现有 playChapterIntro 的关系**：`playChapterIntro` 在首进章节时播放该章首个币的 `grandpaNote`。`CODEX_OPEN` 则在玩家主动翻开图鉴详情时播放对应币的 `grandpaNote`。两者不冲突——首进章节的 `grandpaNote` 是章节开场的一部分，`CODEX_OPEN` 的 `grandpaNote` 是探索行为触发的。

#### 9. PROFILE_OPEN — 收藏家档案

```
触发：profileOpened && !seenDialogueNodes.has('PROFILE_OPEN')
时机：玩家首次打开收藏家档案视图（当前代码中尚无此视图，见 §5 衔接点 #8）
播完后：seenDialogueNodes.add('PROFILE_OPEN')
行数：1 行
delay：无
```

#### 10. PASSPORT_TEASER — 旅行护照 teaser

```
触发：passportSlotTapped && !seenDialogueNodes.has('PASSPORT_TEASER')
时机：玩家点击 Hub 中的护照槽位（当前代码中尚无此 UI 元素，见 §5 衔接点 #9）
播完后：seenDialogueNodes.add('PASSPORT_TEASER')
行数：3 行（逐行入队）
delay：无
```

#### 11. REGION_COMPLETE — 某区域书架集满

```
触发：regionShelfFull(region) && !seenDialogueNodes.has('REGION_COMPLETE:'+region)
时机：每次 store.unlock() 后检查该 region 是否首次集满
  regionShelfFull(region) = CURRENCIES.filter(c => c.region === region).every(c => store.isCollected(c.iso))
播完后：seenDialogueNodes.add('REGION_COMPLETE:'+region)
行数：2 行（逐行入队）
delay：建议 800ms（等新发现 toast 播完后再播集满祝贺）
```

> **检查时机**：在 `flipCard()` 的 `firstTime` 分支中，`store.unlock()` 之后调用 `checkRegionComplete(matchedIso)`。若该 ISO 所在区域首次集满，触发 `REGION_COMPLETE`。

#### 12. RATE_SNAPSHOT_NUDGE — 汇率快照提示

```
触发：hubRateBarFirstViewed && !seenDialogueNodes.has('RATE_SNAPSHOT_NUDGE')
时机：汇率快照条首次在 Hub 中可见时（当前代码中尚无此 UI 元素，见 §5 衔接点 #10）
播完后：seenDialogueNodes.add('RATE_SNAPSHOT_NUDGE')
行数：1 行
delay：无
```

> **合规口径**：此节点的文案已含"这只是参考，不是建议"口径，与 `README.md` §1.4 合规边界一致。

---

## §2 文案轮转与去重规则

### 2.1 去重策略映射

| 节点 | 策略 | 去重键 | 载体 | 说明 |
|------|------|--------|------|------|
| `S1_HUB_FIRST_OPEN` | once-lifetime | `"S1_HUB_FIRST_OPEN"` | `seenDialogueNodes`（持久化） | 首次开 Hub 播一次，永不再播 |
| `S1_HUB_RETURN` | once-per-session | `"S1_HUB_RETURN"` | `appSessionPlayedNodes`（内存） | 每次 app 启动最多 1 次；sub-state 选取决定播哪条 |
| `MATCH_FIRST_TUTORIAL` | once-lifetime | `"MATCH_FIRST_TUTORIAL"` | `meta.hasSeenFirstTutorial`（持久化） | 首次翻对播一次，永不再播 |
| `MATCH_SUCCESS_NEW` | once-lifetime（per iso） | —（由 `store.isCollected` 隐式去重） | `CollectionStore`（已有） | ISO 首次被收集才触发；后续收集同 ISO 其他形态时 `wasCollected` 为 true → 切到 REPEAT |
| `MATCH_SUCCESS_REPEAT` | rotate + cooldown | — | `rotateIndex` + `matchSessionRepeatSkip`（内存） | 2 条轮换；触发后 skip=2，后续 2 次 repeat 配对不播 |
| `MATCH_MISS` | cooldown | — | `matchSessionMissCount`（内存） | 每局上限 2 次 |
| `MATCH_WIN_SESSION` | once-per-match-session | `"MATCH_WIN_SESSION"` | `matchSessionPlayedNodes`（内存） | 每局最多 1 次（自然保证：`result.complete` 每局仅触发 1 次） |
| `CODEX_OPEN` | once-lifetime（per iso） | `"CODEX_OPEN:USD"` | `seenDialogueNodes`（持久化） | 每币种首次翻图鉴详情时播 |
| `PROFILE_OPEN` | once-lifetime | `"PROFILE_OPEN"` | `seenDialogueNodes`（持久化） | 首次打开档案播一次 |
| `PASSPORT_TEASER` | once-lifetime | `"PASSPORT_TEASER"` | `seenDialogueNodes`（持久化） | 首次点护照槽播一次 |
| `REGION_COMPLETE` | once-lifetime（per region） | `"REGION_COMPLETE:amer"` | `seenDialogueNodes`（持久化） | 每区域首次集满播一次 |
| `RATE_SNAPSHOT_NUDGE` | once-lifetime | `"RATE_SNAPSHOT_NUDGE"` | `seenDialogueNodes`（持久化） | 首次看到汇率条播一次 |

### 2.2 `seenDialogueNodes` 键格式

```
纯节点级：    "S1_HUB_FIRST_OPEN"  "MATCH_FIRST_TUTORIAL"  "PROFILE_OPEN"  "PASSPORT_TEASER"  "RATE_SNAPSHOT_NUDGE"
per-iso：    "CODEX_OPEN:USD"  "CODEX_OPEN:JPY"  ...
per-region：  "REGION_COMPLETE:amer"  "REGION_COMPLETE:euro"  "REGION_COMPLETE:asia_afr"
```

> **注意**：`MATCH_SUCCESS_NEW` 不写入 `seenDialogueNodes`——其去重由 `CollectionStore.isCollected(iso)` 隐式保证。首次收集后 `isCollected` 返回 true，`wasCollected` 必为 true，触发条件自然切到 `MATCH_SUCCESS_REPEAT`。

### 2.3 S1_HUB_RETURN sub-state 选取

按以下优先级选取 1 条文案（高优先级先判）：

```
if (daysSinceLastVisit >= 7):
  line = linesByState['away']    // "（书页舒展）哟，去远门了？…"
elif (consecutiveDays >= 3):
  line = linesByState['streak']  // "（书页雀跃）连续好几天都来了…"
else:
  line = linesByState['basic']   // "回来啦。今天也挺好，咱们慢慢来。"
```

### 2.4 MATCH_SUCCESS_REPEAT 轮转

```
rotateIndex['MATCH_SUCCESS_REPEAT'] 初始为 0
触发时：
  idx = rotateIndex['MATCH_SUCCESS_REPEAT'] % 2  // 2 条文案
  line = lines[idx]
  rotateIndex['MATCH_SUCCESS_REPEAT'] = idx + 1
  matchSessionRepeatSkip = MATCH_REPEAT_COOLDOWN  // = 2

后续 repeat 配对时：
  if (matchSessionRepeatSkip > 0):
    matchSessionRepeatSkip--
    return  // 不播
```

### 2.5 MATCH_MISS cooldown

```
matchSessionMissCount 初始为 0
触发时：
  if (matchSessionMissCount >= MATCH_MISS_MAX):  // = 2
    return  // 不播
  matchSessionMissCount++
  // 播放文案
```

### 2.6 常量定义

```ts
const MATCH_MISS_MAX = 2;              // 每局错配对白上限
const MATCH_REPEAT_COOLDOWN = 2;       // repeat 对白 cooldown（跳过次数）
const NARRATIVE_HOLD_MS = 3600;        // 叙事 toast hold（比标准 2600ms 长，给阅读时间）
const NARRATIVE_HOLD_SHORT_MS = 2200;  // 叙事 toast hold（队列中有后续行时缩短）
const NARRATIVE_LINE_MAX = 40;         // 叙事 toast 单行字数上限（比标准 26 宽松）
```

> **`NARRATIVE_LINE_MAX` 说明**：现有 `clipLine()` 截断上限为 `TOAST_LINE_MAX = 26`（全角字符），叙事文本（如 `discoveryLine`）可达 40–60 字，直接使用会被截断。建议引擎在构造 `ToastItem` 时使用 `NARRATIVE_LINE_MAX` 而非 `TOAST_LINE_MAX`。`fitText()` 已有 `minSize: 11` 的缩字兜底，40 字在 400px 宽 toast 内可完整显示。

---

## §3 节奏控制

### 3.1 多行播法：逐行入队 + 引擎内部 pendingLines 缓冲

节点有多行文案时（如 `S1_HUB_FIRST_OPEN` 4 行、`MATCH_SUCCESS_NEW` 3 行），**不一次性全部入队**（会超出 toast 队列容量 3 并丢失旧行），而是：

1. `trigger()` 评估通过后，将选中的行存入引擎内部 `pendingLines: InternalLine[]` 缓冲。
2. 引擎 `tick()` 每帧检查：若 toast 队列未满（`!host.isToastQueueFull()`）且 `pendingLines` 非空，取首行转为 `ToastItem` 并 `host.enqueueToast()`。
3. 每行播完后（toast 队列头弹出），下一行自动喂入。

```
InternalLine {
  text: string;        // 对白文本（含舞台提示）
  line1: string;       // toast 标题（如 "册册" / "新发现 · 美元 USD"）
  region: Region;      // toast 描边色
  priority: DialoguePriority;
  hold: number;        // NARRATIVE_HOLD_MS 或 NARRATIVE_HOLD_SHORT_MS
}
```

**hold 时长选取**：
- `pendingLines` 中还有 ≥2 行待播 → 当前行用 `NARRATIVE_HOLD_SHORT_MS`（2200ms），保持节奏。
- 最后一行 → 用 `NARRATIVE_HOLD_MS`（3600ms），给完整阅读时间。
- 单行节点（如 `S1_HUB_RETURN`）→ 用 `TOAST_HOLD_MS`（2600ms）。

### 3.2 打断规则

当新触发节点的优先级**严格高于**当前 `pendingLines` 中所有行的优先级时：

| 新触发 | pendingLines 中 | 动作 |
|--------|----------------|------|
| P0 | P2/P3 | ① 清空 `pendingLines`（丢弃 P2/P3 未播行）<br>② `host.dismissCurrentToast()`（若当前 toast 是 P2/P3）<br>③ 存入 P0 行 |
| P1 | P2/P3 | 同上 |
| P0 | P1 | **不打断**；P0 行追加到 `pendingLines` 尾部（FIFO） |
| P1 | P0 | **不打断**；P1 行追加到尾部 |
| P2/P3 | 任意 | **不打断**；追加到尾部 |

**打断判定细节**：
- 引擎跟踪 `lastEnqueuedPriority: DialoguePriority`（最近一次入队 toast 的优先级）。
- `dismissCurrentToast()` 仅在 `lastEnqueuedPriority > 新触发优先级` 时调用——即只打断比新触发**更低**优先级的当前 toast。
- 打断后 `lastEnqueuedPriority` 更新为新触发的优先级。

> **实际场景举例**：玩家正在看 `S1_HUB_RETURN`（P2，1 行）的 toast，突然配对成功新币种触发 `MATCH_SUCCESS_NEW`（P1）。P1 > P2 → 打断：dismiss 当前 P2 toast，播 P1 的 3 行。这保证新发现叙事不会等到日常回访播完才出现。

### 3.3 队列管理

**不扩容 toast 队列**（保持 `TOAST_QUEUE_MAX = 3`）。原因：

1. 引擎逐行喂入，同一时刻 toast 队列中最多 1 条引擎 toast + 1–2 条系统 toast（如 hint），不会溢出。
2. 扩容会增加视觉同时显示的 toast 数量，反而造成认知过载。
3. 现有 FIFO + 满时丢弃最旧未播项的逻辑（`enqueueToast` 中 `splice`）作为兜底已足够。

**与 `playChapterIntro` 的共存**：
- `playChapterIntro` 直接调用 `enqueueToast()`（不走引擎），最多入队 2 条 toast（narrativeBeat + grandpaNote）。
- 引擎的 `pendingLines` 不会与 chapter intro 冲突——引擎在 `tick()` 中检查 `isToastQueueFull()`，若 chapter intro 占满了队列，引擎等待空位。
- **建议**：`playChapterIntro` 入队前调用 `engine.setSilenced(true)`，入队后恢复，避免引擎在 chapter intro 期间插入日常对白。或更简单：chapter intro 仅在首进章节时播（`markChapterSeen` 幂等），与引擎触发时错开。

### 3.4 静默期

**定义**：配对动画密集期（翻牌 / 清除 / burst），视觉信息量大，不宜叠加非紧急对白。

**实现**：引擎暴露 `setSilenced(silenced: boolean)`。app.ts 在以下时机切换：

| 时机 | `setSilenced` | 说明 |
|------|-------------|------|
| `flipCard()` 中 `flipAnim` 开始 | `true` | 翻牌动画期 |
| `pendingBursts` 发射完毕 + `hasActiveFx()` 变 false | `false` | burst 粒子结束 |
| `pendingFlipBackAt` 设置 | `true` | 错配翻回等待期 |
| `pendingFlipBackAt` 到期处理完毕 | `false` | 翻回完成 |
| `clearAnims` 非空 | `true` | 清除动画期 |
| `clearAnims` 变空 | `false` | 清除完成 |

**静默期行为**：
- `silenced === true` 时：
  - P0/P1 触发：正常处理（入队 `pendingLines`），但 `tick()` 不喂入 toast 队列（等静默结束）。
  - P2/P3 触发：存入 `deferredTriggers: DeferredTrigger[]`，静默结束后按优先级排序处理。
- `silenced === false` 时：
  - 先处理 `deferredTriggers`（按优先级降序，同优先级 FIFO）。
  - 再正常 `tick()` 喂入 `pendingLines`。

> **简化方案**（推荐 Phase 1）：不实现 `deferredTriggers`，静默期仅暂停 `tick()` 的喂入（P2/P3 触发仍写入 `pendingLines`，但等静默结束才播）。P0/P1 不受静默影响。这样实现更简单，且不会丢失触发——只是延迟播放。

### 3.5 节奏时间线总览

```
标准 toast：    enter 200ms → hold 2600ms → exit 300ms  = 3100ms 总时长
叙事 toast：    enter 200ms → hold 3600ms → exit 300ms  = 4100ms 总时长（末行）
叙事 toast（续）：enter 200ms → hold 2200ms → exit 300ms  = 2700ms 总时长（非末行）

S1_HUB_FIRST_OPEN（4 行）：
  行1: 2700ms（非末行）→ 行2: 2700ms → 行3: 2700ms → 行4: 4100ms（末行）
  总计 ≈ 12.2s

MATCH_SUCCESS_NEW（3 行，delay 570ms）：
  delay 570ms → 行1: 2700ms → 行2: 2700ms → 行3: 4100ms
  总计 ≈ 10.1s（含 delay）

MATCH_MISS（1 行）：
  3100ms

S1_HUB_RETURN（1 行，sub-state）：
  3100ms
```

> **注意**：多行节点的总时长较长（10–12s）。玩家可通过点按 toast 跳过当前行（现有 `dismissToast()` 机制），引擎在 `tick()` 中检测到当前 toast 被-dismissed 后会立即喂入下一行。这是可接受的——叙事是可选的，不锁输入。

---

## §4 状态键定义

### 4.1 持久化状态（metaStore 新增）

以下状态需持久化到 `metaStore`，跨 app session 保留。

| # | 状态键 | 类型 | 存储键（localStorage / wx） | 用途 | 状态 |
|---|--------|------|---------------------------|------|------|
| 1 | `hasLaunchedBefore` | `boolean` | `currency-codex-first-launch-v1` | S1_HUB_FIRST_OPEN vs S1_HUB_RETURN 判定 | **[NEW]** |
| 2 | `consecutiveDays` | `number` | `currency-codex-visit-tracking-v1` → `{ consecutiveDays, lastVisitDate }` | S1_HUB_RETURN sub-state（连续≥3天） | **[NEW]** |
| 3 | `lastVisitDate` | `string` (YYYY-MM-DD) | 同上 | S1_HUB_RETURN sub-state（离开≥7天）+ consecutiveDays 计算 | **[NEW]** |
| 4 | `seenDialogueNodes` | `string[]` (序列化 Set) | `currency-codex-seen-dialogue-v1` | once-lifetime 节点去重 | **[NEW]** |
| 5 | `hasSeenFirstTutorial` | `boolean` | `currency-codex-first-tutorial-v1` | MATCH_FIRST_TUTORIAL 去重 | **[NEW]** |

**metaStore 需新增的方法**（工程方实现，签名供参考）：

```ts
// 1. hasLaunchedBefore
hasLaunchedBefore(): boolean;
markLaunchedBefore(): void;  // 幂等：首次调用写入 true 并落盘

// 2&3. consecutiveDays + lastVisitDate
getVisitTracking(): { consecutiveDays: number; lastVisitDate: string | null };
updateVisitTracking(today: string): { consecutiveDays: number; daysSinceLastVisit: number };
// ↑ 计算逻辑见 §1 节点 2 的 sub-state 选取；返回值供引擎做 sub-state 判定

// 4. seenDialogueNodes
hasSeenDialogue(key: string): boolean;         // key 如 "CODEX_OPEN:USD"
markDialogueSeen(key: string): void;            // 幂等写入

// 5. hasSeenFirstTutorial
hasSeenFirstTutorial(): boolean;
markSeenFirstTutorial(): void;                   // 幂等写入
```

### 4.2 已有状态（metaStore / collectionStore 中已存在）

| # | 状态键 | 来源 | 用途 |
|---|--------|------|------|
| A | `seenChapters` | `metaStore.hasSeenChapter()` / `markChapterSeen()` | 章节开场白幂等（已有，不改） |
| B | `chPlays` | `metaStore.playsChapter()` / `addPlayChapter()` | 章节完成局数（已有，不改） |
| C | `masteryMap` | `metaStore.mastery()` / `addMastery()` | 每币配对次数（已有，不改） |
| D | `isCollected(iso)` | `collectionStore.isCollected()` | MATCH_SUCCESS_NEW vs REPEAT 判定（已有，不改） |
| E | `progress()` | `collectionStore.progress()` | REGION_COMPLETE 检查（已有，不改） |

### 4.3 App-session 级状态（引擎内存，不持久化）

app 启动时初始化，app 关闭时丢弃。

| # | 状态键 | 类型 | 用途 |
|---|--------|------|------|
| 6 | `appSessionPlayedNodes` | `Set<string>` | once-per-session 去重（S1_HUB_RETURN） |
| 7 | `lastEnqueuedPriority` | `DialoguePriority \| null` | 打断判定（最近入队 toast 的优先级） |

### 4.4 Match-session 级状态（引擎内存，`resetMatchSession()` 时清空）

每局配对开始时（`startChapter()` → `resetTransient()`）重置。

| # | 状态键 | 类型 | 用途 |
|---|--------|------|------|
| 8 | `matchSessionFirstFlipPairFired` | `boolean` | MATCH_FIRST_TUTORIAL 防重触发 |
| 9 | `matchSessionMissCount` | `number` | MATCH_MISS cooldown 计数 |
| 10 | `matchSessionRepeatSkip` | `number` | MATCH_SUCCESS_REPEAT cooldown 计数 |
| 11 | `matchSessionPlayedNodes` | `Set<string>` | once-per-match-session 去重（MATCH_WIN_SESSION） |
| 12 | `rotateIndex` | `Map<string, number>` | rotate 节点的轮转索引（MATCH_SUCCESS_REPEAT） |

### 4.5 引擎内部缓冲（非状态键，运行时数据）

| # | 缓冲 | 类型 | 用途 |
|---|------|------|------|
| 13 | `pendingLines` | `InternalLine[]` | 待逐行喂入 toast 队列的叙事行 |
| 14 | `deferredTriggers` | `DeferredTrigger[]` | 静默期缓存的 P2/P3 触发（Phase 1 简化方案可不用） |
| 15 | `silenced` | `boolean` | 静默期开关 |

---

## §5 与 app.ts 的衔接点

精确标注 `app.ts` 中哪些方法、哪一行、应调用引擎的什么方法。共 **10 个衔接点**。

### 衔接点 #1：App 构造完毕 → Hub 首开 / 回访

**位置**：`App` 构造函数末尾（`attachInput(this)` 之后、`preloadImages()` 之前或之后）

```ts
// app.ts 构造函数中新增：
this.dialogue = new DialogueEngine({ host: this, meta: this.meta, collection: this.store, getCurrency });

// 判断首开 vs 回访：
if (!this.meta.hasLaunchedBefore()) {
  this.meta.markLaunchedBefore();
  this.dialogue.trigger('S1_HUB_FIRST_OPEN');
} else {
  // 更新访问追踪 + 触发回访
  const today = todayISO();
  const { consecutiveDays, daysSinceLastVisit } = this.meta.updateVisitTracking(today);
  this.dialogue.trigger('S1_HUB_RETURN', { consecutiveDays, daysSinceLastVisit });
}
```

> **注意**：`trigger()` 不会立即入队 toast——行存入 `pendingLines`，由 `tick()` 逐行喂入。需在 `App.loop()` 的 `tick(dt)` 中调用 `this.dialogue.tick()`。

### 衔接点 #2：tick() 中推进引擎

**位置**：`App.tick(dt)` 末尾（现有 ⑥ 粒子推进之后）

```ts
// app.ts tick() 中新增（⑧）：
this.dialogue.tick();
```

### 衔接点 #3：startChapter() → match-session 重置 + 首次教学判定

**位置**：`startChapter()` 中 `this.resetTransient()` 之后

```ts
// app.ts startChapter() 中新增：
this.dialogue.resetMatchSession();
// 注：MATCH_FIRST_TUTORIAL 在 flipCard 中触发，不在此处。
// playChapterIntro 保持不变（首进章节 → narrativeBeat + grandpaNote）。
```

> **关于 `playChapterIntro`**：现有逻辑不变。章节开场白（`narrativeBeat` + `grandpaNote`）继续由 `playChapterIntro` 直接 `enqueueToast`，不经过引擎。引擎仅负责 12 个对白节点。两者通过 toast 队列 FIFO 自然排序，不会冲突（引擎 `tick()` 检查 `isToastQueueFull()`，若 chapter intro 占满队列则等待）。

### 衔接点 #4：flipCard() → 配对成功 / 错配 / 首次教学

**位置**：`flipCard()` 中 `if (this.match.flipped.length === 2)` 块内

```ts
// app.ts flipCard() 中，evaluate 之后：

if (result.matched) {
  // ... 现有 mastery / unlock / clearAnim / burst 逻辑不变 ...

  // 替换原有的 pendingToasts.push(flashPrimary/flashSecondary) 逻辑：
  if (firstTime) {
    // 新发现：改用引擎触发 discoveryLine（而非 flashPrimary）
    this.dialogue.trigger('MATCH_SUCCESS_NEW', {
      iso: matchedIso,
      wasCollected: false,   // firstTime 意味着 !wasCollected
      delay: BURST_AT + UNLOCK_TOAST_DELAY,  // 570ms
    });
  } else if (wasCollected) {
    // 已见过：repeat
    this.dialogue.trigger('MATCH_SUCCESS_REPEAT', {
      iso: matchedIso,
      wasCollected: true,
    });
  }
  // 注：firstTime=true 但 wasCollected=true 的情况（同 ISO 不同形态第二次解锁）
  //     wasCollected 已为 true → 走 MATCH_SUCCESS_REPEAT，不播 discoveryLine。

  // 首次教学判定（仅首次 session 的首次翻对）：
  if (!this.meta.hasSeenFirstTutorial() && !this.matchSessionFirstFlipPairFired) {
    this.dialogue.trigger('MATCH_FIRST_TUTORIAL');
    this.matchSessionFirstFlipPairFired = true;
    this.meta.markSeenFirstTutorial();
  }

  // 区域集满检查（在 unlock 之后）：
  if (firstTime) this.checkRegionComplete(matchedIso);

  if (result.complete) {
    // 局完：延迟触发（等胜利面板）
    this.dialogue.trigger('MATCH_WIN_SESSION', { delay: 500 });
  }
} else {
  // 错配：
  this.dialogue.trigger('MATCH_MISS');
  this.pendingFlipBackAt = this.gameTimeMs + MISMATCH_FLIPBACK_MS;
}
```

**需删除的代码**：现有 `flipCard()` 中 `if (firstTime) { ... pendingToasts.push(...) }` 块（L467–L481）替换为引擎 `trigger('MATCH_SUCCESS_NEW')` 调用。

### 衔接点 #5：flipCard() → 静默期切换

**位置**：`flipCard()` 中翻牌开始 + 配对结果处理

```ts
// 翻牌开始时：
this.dialogue.setSilenced(true);

// 在 tick() 中，当所有动画结束（无 flipAnim / pendingBursts / clearAnims / hasActiveFx）时：
if (!this.flipAnim && this.pendingBursts.length === 0 && this.clearAnims.size === 0
    && !hasActiveFx() && this.pendingFlipBackAt < 0) {
  this.dialogue.setSilenced(false);
}
```

> **简化**：可在 `tick()` 末尾统一计算 `silenced` 状态，一次调用 `setSilenced()`。

### 衔接点 #6：openDetail(iso) → CODEX_OPEN

**位置**：`openDetail(iso)` 方法中

```ts
// app.ts openDetail() 中新增（在 this.view = 'detail' 之后）：
this.dialogue.trigger('CODEX_OPEN', { iso });
```

### 衔接点 #7：backToHub() → S1_HUB_RETURN

**位置**：`backToHub()` 方法中

```ts
// app.ts backToHub() 中新增（在 this.view = 'hub' 之后）：
if (this.meta.hasLaunchedBefore()) {
  // 更新访问追踪
  const today = todayISO();
  const { consecutiveDays, daysSinceLastVisit } = this.meta.updateVisitTracking(today);
  this.dialogue.trigger('S1_HUB_RETURN', { consecutiveDays, daysSinceLastVisit });
}
```

> **注**：构造函数中已触发过一次 `S1_HUB_RETURN`（或 `S1_HUB_FIRST_OPEN`），`appSessionPlayedNodes` 会保证本次 app session 内不再重复触发。`backToHub()` 中的调用是幂等的——引擎内部检查 `appSessionPlayedNodes.has('S1_HUB_RETURN')` 后会跳过。

### 衔接点 #8：openProfile() → PROFILE_OPEN [未来]

**位置**：需新增 `openProfile()` 方法（当前代码中无此视图）

```ts
// app.ts 中新增方法：
openProfile(): void {
  this.view = 'profile';  // 需新增 'profile' 到 View 类型
  this.dirty = true;
  this.dialogue.trigger('PROFILE_OPEN');
}
```

> **状态**：当前 `View` 类型为 `'hub' | 'pair' | 'codex' | 'detail'`，无 `'profile'`。此衔接点为**未来实现**，待档案视图开发时接入。

### 衔接点 #9：tapPassportSlot() → PASSPORT_TEASER [未来]

**位置**：需新增 `tapPassportSlot()` 方法（当前 Hub 渲染中无护照槽 UI 元素）

```ts
// app.ts 中新增方法：
tapPassportSlot(): void {
  this.dialogue.trigger('PASSPORT_TEASER');
}
```

> **状态**：护照槽 UI 元素尚未实现。此衔接点为**未来实现**，待 Hub 护照槽 UI 开发时接入。

### 衔接点 #10：onRateBarVisible() → RATE_SNAPSHOT_NUDGE [未来]

**位置**：需在 Hub 渲染中检测汇率条首次可见时调用

```ts
// app.ts 中新增方法：
onRateBarVisible(): void {
  this.dialogue.trigger('RATE_SNAPSHOT_NUDGE');
}
```

> **状态**：汇率快照条 UI 尚未实现。此衔接点为**未来实现**，待汇率条 UI 开发时接入。

### 衔接点 #11：checkRegionComplete(iso) → REGION_COMPLETE

**位置**：需新增 `checkRegionComplete(iso)` 方法，在 `flipCard()` 的 `firstTime` 分支中调用

```ts
// app.ts 中新增方法：
private checkRegionComplete(iso: string): void {
  const cur = getCurrency(iso);
  if (!cur) return;
  const region = cur.region;
  // 检查该区域所有币种是否都已收集（任意形态）
  const allCollected = CURRENCIES
    .filter(c => c.region === region)
    .every(c => this.store.isCollected(c.iso));
  if (allCollected) {
    this.dialogue.trigger('REGION_COMPLETE', {
      region,
      delay: 800,  // 等新发现 toast 播完
    });
  }
}
```

### 衔接点总览

| # | app.ts 方法 | 引擎调用 | 状态 |
|---|------------|---------|------|
| 1 | 构造函数 | `trigger('S1_HUB_FIRST_OPEN' \| 'S1_HUB_RETURN')` | **需新增** |
| 2 | `tick()` | `dialogue.tick()` | **需新增** |
| 3 | `startChapter()` | `dialogue.resetMatchSession()` | **需新增** |
| 4 | `flipCard()` (matched) | `trigger('MATCH_SUCCESS_NEW' \| 'MATCH_SUCCESS_REPEAT')` | **替换现有 flash toast** |
| 4 | `flipCard()` (matched) | `trigger('MATCH_FIRST_TUTORIAL')` | **需新增** |
| 4 | `flipCard()` (complete) | `trigger('MATCH_WIN_SESSION')` | **需新增** |
| 4 | `flipCard()` (miss) | `trigger('MATCH_MISS')` | **需新增** |
| 4 | `flipCard()` (firstTime) | `checkRegionComplete(iso)` → `trigger('REGION_COMPLETE')` | **需新增** |
| 5 | `tick()` / `flipCard()` | `dialogue.setSilenced(bool)` | **需新增** |
| 6 | `openDetail(iso)` | `trigger('CODEX_OPEN', { iso })` | **需新增** |
| 7 | `backToHub()` | `trigger('S1_HUB_RETURN', { ... })` | **需新增** |
| 8 | `openProfile()` [未来] | `trigger('PROFILE_OPEN')` | **待视图实现** |
| 9 | `tapPassportSlot()` [未来] | `trigger('PASSPORT_TEASER')` | **待 UI 实现** |
| 10 | `onRateBarVisible()` [未来] | `trigger('RATE_SNAPSHOT_NUDGE')` | **待 UI 实现** |
| 11 | `checkRegionComplete(iso)` | `trigger('REGION_COMPLETE', { region })` | **需新增** |

> **有效衔接点**：Phase 1 共 **11 个**（含 `checkRegionComplete`），其中 **8 个需立即实现**、**3 个待未来 UI 开发**。

---

## §6 引擎 API 设计

### 6.1 类型定义

```ts
/** 对白节点 ID（12 个状态触发式节点） */
type DialogueNodeId =
  | 'S1_HUB_FIRST_OPEN'
  | 'S1_HUB_RETURN'
  | 'MATCH_FIRST_TUTORIAL'
  | 'MATCH_SUCCESS_NEW'
  | 'MATCH_SUCCESS_REPEAT'
  | 'MATCH_MISS'
  | 'MATCH_WIN_SESSION'
  | 'CODEX_OPEN'
  | 'PROFILE_OPEN'
  | 'PASSPORT_TEASER'
  | 'REGION_COMPLETE'
  | 'RATE_SNAPSHOT_NUDGE';

/** 优先级：P0 教学 > P1 解锁 > P2 日常 > P3 错配 */
type DialoguePriority = 0 | 1 | 2 | 3;

/** 对白行（单条文本，来自 dialogue-nodes.md） */
interface DialogueLine {
  speaker: 'CECE' | 'SYSTEM';
  text: string;
  stageDir?: string;
}

/** 触发上下文 */
interface DialogueContext {
  /** 币种 ISO（MATCH_SUCCESS_*、CODEX_OPEN、REGION_COMPLETE 检查用） */
  iso?: string;
  /** 区域（REGION_COMPLETE） */
  region?: Region;
  /** 配对前是否已收集（区分 MATCH_SUCCESS_NEW / REPEAT；由 app.ts 传入） */
  wasCollected?: boolean;
  /** 连续登录天数（S1_HUB_RETURN sub-state 选取） */
  consecutiveDays?: number;
  /** 距上次访问天数（S1_HUB_RETURN sub-state 选取） */
  daysSinceLastVisit?: number;
  /** 延迟触发（ms，游戏时钟基准）；用于等待动画完成后再播对白 */
  delay?: number;
}
```

### 6.2 宿主接口（由 app.ts 实现）

```ts
/**
 * 引擎宿主接口——app.ts 实现此接口，引擎通过它操作 toast 队列。
 * 引擎不直接持有 toast 数组，保持解耦。
 */
interface DialogueEngineHost {
  /** 入队一条 toast（引擎将叙事行转换后调用此方法） */
  enqueueToast(item: ToastItem): void;

  /** 打断当前正在播的 toast（跳到 exit 段）。
   *  仅在优先级打断时由引擎调用。 */
  dismissCurrentToast(): void;

  /** toast 队列是否已满（容量 TOAST_QUEUE_MAX = 3）。
   *  引擎在 tick() 中检查此方法，仅当队列未满时喂入下一行。 */
  isToastQueueFull(): boolean;

  /** 当前游戏时钟（ms）。用于 delay 计算和 toast startAt 设置。 */
  gameTimeMs(): number;
}
```

### 6.3 引擎接口

```ts
/**
 * 对白引擎接口。
 *
 * 职责：
 *  - 接收 trigger 调用，评估去重/冷却/轮转/优先级，决定是否播放及播放哪些行。
 *  - 管理内部 pendingLines 缓冲，逐行喂入 toast 队列（不溢出）。
 *  - 管理静默期（P2/P3 延迟）和优先级打断（P0/P1 打断 P2/P3）。
 *  - 持久化 once-lifetime 状态到 metaStore。
 *
 * 不职责：
 *  - 不直接操作 Canvas / DOM（通过 host 接口间接入队 toast）。
 *  - 不处理 i18n（Phase 2）。
 *  - 不做 telemetry（Phase 2）。
 *  - 不处理 `next` 指令的导航（GOTO_HUB / GOTO_CODEX 等，Phase 2）。
 */
interface DialogueEngine {
  /**
   * 触发对白节点。
   *
   * 引擎内部流程：
   *  1. 检查去重（once-lifetime / once-per-session / once-per-match-session）。
   *  2. 检查 cooldown（MATCH_MISS / MATCH_SUCCESS_REPEAT）。
   *  3. 选取文案行（固定 / sub-state / rotate）。
   *  4. 评估优先级打断（若新触发 P0/P1 且 pendingLines 中有 P2/P3 → 清空 + dismiss）。
   *  5. 将选中行存入 pendingLines（若 ctx.delay > 0 则存入延迟队列）。
   *  6. 更新去重/冷却状态（标记已播、递增计数器等）。
   *
   * @param nodeId  节点 ID
   * @param ctx     触发上下文（iso / region / wasCollected / consecutiveDays / daysSinceLastVisit / delay）
   *
   * @returns void — 引擎通过 host.enqueueToast() 间接输出，不返回值。
   *          调用方无需关心是否实际播放（被去重/冷却跳过是正常行为）。
   */
  trigger(nodeId: DialogueNodeId, ctx?: DialogueContext): void;

  /**
   * 每帧调用（由 app.ts 的 tick() 调用）。
   *
   * 职责：
   *  1. 处理延迟触发（delay 到期的 trigger 开始评估）。
   *  2. 若非静默期且 toast 队列未满且 pendingLines 非空：
   *     取 pendingLines 首行 → 转 ToastItem → host.enqueueToast()。
   *  3. 更新 lastEnqueuedPriority。
   */
  tick(): void;

  /**
   * Match-session 重置。
   * 清空 match-session 级状态（missCount、repeatSkip、firstFlipPairFired、playedNodes）。
   * 注意：**rotateIndex 不清** —— 它是引擎级持久状态，跨局连续轮转，让扩池台词（REPEAT 8 条 / MISS 7 条）全部能轮到见光。
   * 在 startChapter() → resetTransient() 时调用。
   */
  resetMatchSession(): void;

  /**
   * 设置静默期。
   * @param silenced  true = 暂停 P2/P3 的 tick() 喂入（P0/P1 不受影响）；false = 恢复。
   *
   * Phase 1 简化：静默期仅暂停 tick() 喂入，不缓存 deferred triggers。
   * 触发仍正常写入 pendingLines，等静默结束后逐行播放。
   */
  setSilenced(silenced: boolean): void;

  /**
   * 是否有待播叙事行（pendingLines 非空 或 有延迟触发待处理）。
   * 供 app.ts 判断是否需要持续重绘（类似 hasActiveFx()）。
   */
  hasPending(): boolean;

  /**
   * 查询某 once-lifetime 节点是否已播过（主要用于测试验证）。
   * @param nodeId  节点 ID
   * @param iso     可选，per-iso 节点（CODEX_OPEN）的 ISO
   * @param region  可选，per-region 节点（REGION_COMPLETE）的区域
   */
  hasPlayed(nodeId: DialogueNodeId, iso?: string, region?: Region): boolean;
}
```

### 6.4 构造选项

```ts
interface DialogueEngineOptions {
  /** 宿主（app.ts 实现） */
  host: DialogueEngineHost;
  /** 元进度持久化（已有实例，引擎读取/写入 once-lifetime 状态） */
  meta: MetaStore;
  /** 收藏集合（已有实例，引擎查询 isCollected / progress） */
  collection: CollectionStore;
  /** 币种查询函数（注入，避免 core/ 反向依赖 data/） */
  getCurrency: (iso: string) => {
    name: string;
    iso: string;
    region: Region;
    discoveryLine: string;
    grandpaNote: string;
  } | undefined;
}
```

### 6.5 引擎内部数据结构（供工程方参考）

```ts
/** 引擎内部使用的叙事行（比 DialogueLine 多 toast 元数据） */
interface InternalLine {
  text: string;        // 对白文本（含舞台提示，如 "（书页轻轻翻动）哎哟…"）
  line1: string;       // toast 标题（如 "册册" / "新发现 · 美元 USD"）
  region: Region;      // toast 描边色来源
  priority: DialoguePriority;
  hold: number;        // NARRATIVE_HOLD_MS / NARRATIVE_HOLD_SHORT_MS / TOAST_HOLD_MS
}

/** 延迟触发项 */
interface DelayedTrigger {
  nodeId: DialogueNodeId;
  ctx: DialogueContext;
  fireAt: number;  // 游戏时钟 ms
}
```

### 6.6 line1 标题映射

引擎在将 `DialogueLine` 转为 `ToastItem` 时，`line1` 按节点类型选取：

| 节点 | line1 | 说明 |
|------|-------|------|
| `S1_HUB_FIRST_OPEN` | `"册册"` | 角色名 |
| `S1_HUB_RETURN` | `"册册"` | 角色名 |
| `MATCH_FIRST_TUTORIAL` | `"册册"` | 角色名 |
| `MATCH_SUCCESS_NEW` | `"新发现 · ${name} ${iso}"` | 与现有 flash toast 一致 |
| `MATCH_SUCCESS_REPEAT` | `"册册"` | 角色名 |
| `MATCH_MISS` | `"册册"` | 角色名 |
| `MATCH_WIN_SESSION` | `"册册"` | 角色名 |
| `CODEX_OPEN` | `"周爷爷的纸条 · ${iso}"` | 与现有 chapter intro grandpaNote 一致 |
| `PROFILE_OPEN` | `"册册"` | 角色名 |
| `PASSPORT_TEASER` | `"册册"` | 角色名 |
| `REGION_COMPLETE` | `"册册"` | 角色名 |
| `RATE_SNAPSHOT_NUDGE` | `"册册"` | 角色名 |

### 6.7 ToastItem 转换规则

```ts
// 引擎内部将 InternalLine 转为 ToastItem：
function lineToToast(line: InternalLine, nowMs: number): ToastItem {
  return {
    line1: line.line1,
    line2: clipLine(line.text, NARRATIVE_LINE_MAX),  // 用 NARRATIVE_LINE_MAX 而非 TOAST_LINE_MAX
    region: line.region,
    hold: line.hold,
    startAt: -1,  // 由 app.ts updateToasts() 在成为队列头时设置
  };
}
```

> **`clipLine` 注意**：现有 `clipLine(s, max)` 在 `app.ts` 中定义为模块级函数。引擎需使用 `NARRATIVE_LINE_MAX = 40` 调用。建议将 `clipLine` 提取为独立工具函数（如 `render/textUtils.ts`），供引擎和 app.ts 共用。

---

## §7 合规自检

### 7.1 对白文本合规

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 零投资/交易/预测措辞 | ✅ 通过 | 12 节点文案均无"升值/贬值/买入/卖出/囤/抄底/投资/理财"等措辞 |
| `discoveryLine` 文化/历史事实 | ✅ 通过 | 18 币的 `discoveryLine` 均为文化/历史/生物/地理事实（见 `currencies.ts`），无金融建议 |
| `grandpaNote` 个人回忆视角 | ✅ 通过 | 周爷爷纸条均为旅行见闻/个人感受，不含投资建议 |
| 汇率快照提示含免责口径 | ✅ 通过 | `RATE_SNAPSHOT_NUDGE` 文案"这只是参考，不是建议。咱们是看故事，不是看盘" |
| 无灵异/鬼魂设定 | ✅ 通过 | 册册定位为"录制向导"，非魂魄附体（见 `character-voice-pillars.md` What They Would Never Say #2） |
| 无失败/压力措辞 | ✅ 通过 | `MATCH_MISS` 文案"不是一对。再看看——它们差在哪儿？"无惩罚语气 |
| 角色声音一致性 | ✅ 通过 | 所有节点 speaker = CECE；语气符合 voice pillars（温暖口语、舞台提示、旅行词汇） |

### 7.2 引擎机制合规

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 不锁输入 | ✅ 通过 | 引擎通过 toast 通道输出，不弹模态、不阻断玩家操作 |
| 不卡进度 | ✅ 通过 | 对白为纯附加（`lore-architecture.md` 原则：lore 永远可选） |
| 可跳过 | ✅ 通过 | 玩家点按 toast 可跳过当前行（现有 `dismissToast()` 机制） |
| 防刷屏 | ✅ 通过 | `MATCH_MISS` ≤2/局、`MATCH_SUCCESS_REPEAT` cooldown=2、`S1_HUB_RETURN` ≤1/session |
| 无主导策略 | ✅ 通过 | 对白不影响玩法/数值/解锁，纯叙事反馈 |

### 7.3 与 lore 架构对齐

| Tier | 节点 | 对应字段 | 来源 |
|------|------|---------|------|
| Tier 1（必得） | `MATCH_SUCCESS_NEW` 行 2 | `discoveryLine` | `currencies.ts` |
| Tier 2（探索） | `CODEX_OPEN` 行 2 | `grandpaNote` | `currencies.ts` |
| Tier 1（必得） | `RATE_SNAPSHOT_NUDGE` | 免责口径文案 | `dialogue-nodes.md` |
| Tier 1（必得） | `S1_HUB_FIRST_OPEN` | 前提叙事 | `dialogue-nodes.md` |

---

## §8 范围限定

### 本次做（Phase 1）

| 交付项 | 状态 |
|--------|------|
| 12 节点触发条件矩阵（§1） | ✅ 本文档 |
| 文案轮转/去重/冷却规则（§2） | ✅ 本文档 |
| 节奏控制（多行播法 / 打断 / 静默期）（§3） | ✅ 本文档 |
| 状态键定义（持久化 + session）（§4） | ✅ 本文档 |
| app.ts 衔接点（11 个，含 3 个未来）（§5） | ✅ 本文档 |
| 引擎 TS 接口定义（§6） | ✅ 本文档 |
| 合规自检（§7） | ✅ 本文档 |
| `metaStore` 需新增的方法签名（§4.1） | ✅ 本文档 |

### 不做（超出范围）

| 不做项 | 原因 / 归属 |
|--------|------------|
| TS 实现代码 | 工程方 ③b 的职责 |
| 新增/改写对白文案 | `dialogue-nodes.md` 已定稿，不改 |
| i18n 多语言 | Phase 2 |
| Telemetry（哪条文案被跳过最多） | Phase 2 |
| `next` 指令导航（GOTO_HUB / GOTO_CODEX / OFFER_THEMED_AD） | Phase 2；当前 toast 为纯展示，不触发导航 |
| `PROFILE_OPEN` / `PASSPORT_TEASER` / `RATE_SNAPSHOT_NUDGE` 的 UI 实现 | 待对应视图/ UI 开发后接入 |
| 修改 `currencies.ts` / `app.ts` / `metaStore.ts` | 本文档只标注需新增什么，不改动代码 |
| `playChapterIntro` 改造为引擎节点 | 章节开场白是独立机制，保持现状；引擎与之间通过 toast FIFO 自然排序 |
| `flashPrimary` / `flashSecondary` 的其他用途 | 保留在 `currencies.ts` 中，不在本次范围定义其新用途 |

### 待用户审批项

1. **`MATCH_SUCCESS_NEW` 替换 flashPrimary**：当前配对成功新发现时播放 `flashPrimary`/`flashSecondary`（短文案 ≤24 字）。引擎接管后改为播放 `discoveryLine`（完整文化叙事 40–60 字，3 行逐行播）。这会增加单次配对成功的 toast 时长（~10s vs ~3s），但叙事价值显著提升。**请确认是否接受此变更。**

2. **`NARRATIVE_HOLD_MS = 3600ms`**：比标准 `TOAST_HOLD_MS = 2600ms` 长 1s。是否合适？过长可能拖沓，过短则阅读不完。建议 playtest 调参。

3. **`NARRATIVE_LINE_MAX = 40`**：比标准 `TOAST_LINE_MAX = 26` 宽松。`fitText()` 会缩字号适配，但 40 字在 56px 高 toast 中可能略显拥挤。是否需要增加叙事 toast 的面板高度？此为美术/UX 决策。

4. **静默期简化方案**：Phase 1 不实现 `deferredTriggers`（静默期仅暂停 tick 喂入，不缓存 P2/P3 触发）。这意味着静默期内的 P2/P3 触发会正常写入 `pendingLines`，但等静默结束后才播。如果静默期较长（如连续配对），`pendingLines` 可能积压。是否接受此简化？

5. **`consecutiveDays` 是否持久化**：当前设计为持久化（跨 app session 保留连续天数）。如果玩家跨天不打开 app，连续天数会断。这是预期行为——"连续≥3天"鼓励每日回访。

### 已知风险与取舍

| 风险 | 影响 | 缓解 |
|------|------|------|
| 多行节点总时长 10–12s | 玩家可能感到拖沓 | ① 可点按跳过 ② hold 时长可调 ③ Phase 2 可加"自动跳过已读" |
| `discoveryLine` 部分超 40 字 | `clipLine` 会截断 | ① `fitText` 缩字号兜底 ② 建议文案团队复查超长行 |
| 静默期 `pendingLines` 积压 | 多条叙事排队等待 | Phase 1 可接受（最多 3–4 行）；Phase 2 加 deferredTriggers 优先级排序 |
| `playChapterIntro` 与引擎 toast 竞争队列 | 章节开场白可能被引擎 toast 挤掉 | 引擎 `tick()` 检查 `isToastQueueFull()`；chapter intro 仅首进章节播一次，时序错开 |
| `hasLaunchedBefore` 首次写入时机 | 构造函数中读取 → 判定首开 → 写入。若 app 在写入前崩溃，下次启动仍判定为首开 | 可接受——首开多播一次无负面影响 |

---

## 附录 A：节点 → 文案行 → ToastItem 映射速查

| 节点 | 行数 | line1 | line2 来源 | region | hold |
|------|------|-------|-----------|--------|------|
| `S1_HUB_FIRST_OPEN` | 4 | `"册册"` | `dialogue-nodes.md` 4 行 | `'amer'` | NARRATIVE |
| `S1_HUB_RETURN` | 1 | `"册册"` | sub-state 选取 1 行 | `'amer'` | STANDARD |
| `MATCH_FIRST_TUTORIAL` | 3 | `"册册"` | `dialogue-nodes.md` 3 行 | 当前章 region | NARRATIVE |
| `MATCH_SUCCESS_NEW` | 3 | `"新发现 · ${name} ${iso}"` | 行1 固定 + 行2 `discoveryLine` + 行3 固定 | `currency.region` | NARRATIVE |
| `MATCH_SUCCESS_REPEAT` | 1 | `"册册"` | rotate 2 选 1 | `currency.region` | SHORT |
| `MATCH_MISS` | 1 | `"册册"` | 固定 1 行 | `'amer'` | SHORT |
| `MATCH_WIN_SESSION` | 2 | `"册册"` | `dialogue-nodes.md` 2 行 | 当前章 region | NARRATIVE |
| `CODEX_OPEN` | 2 | `"周爷爷的纸条 · ${iso}"` | 行1 固定 + 行2 `grandpaNote` | `currency.region` | NARRATIVE |
| `PROFILE_OPEN` | 1 | `"册册"` | 固定 1 行 | `'amer'` | STANDARD |
| `PASSPORT_TEASER` | 3 | `"册册"` | `dialogue-nodes.md` 3 行 | `'amer'` | NARRATIVE |
| `REGION_COMPLETE` | 2 | `"册册"` | `dialogue-nodes.md` 2 行（含 `<region名>`） | 完成区域 | NARRATIVE |
| `RATE_SNAPSHOT_NUDGE` | 1 | `"册册"` | 固定 1 行（含免责口径） | `'amer'` | STANDARD |

> **hold 缩写**：NARRATIVE = `NARRATIVE_HOLD_MS` (3600ms, 末行) / `NARRATIVE_HOLD_SHORT_MS` (2200ms, 非末行)；STANDARD = `TOAST_HOLD_MS` (2600ms)；SHORT = `TOAST_HOLD_SHORT_MS` (1600ms)。

---

## 附录 B：引擎内部节点注册表结构（供工程方参考）

```ts
/** 节点定义（引擎初始化时注册，运行时只读） */
interface NodeDefinition {
  id: DialogueNodeId;
  priority: DialoguePriority;
  dedup: 'once-lifetime' | 'once-per-session' | 'once-per-match-session' | 'cooldown' | 'rotate';
  /** 固定行（无 sub-state 的节点） */
  lines?: DialogueLine[];
  /** 按 sub-state 选行（S1_HUB_RETURN） */
  linesByState?: {
    basic: DialogueLine[];
    streak: DialogueLine[];  // consecutiveDays >= 3
    away: DialogueLine[];    // daysSinceLastVisit >= 7
  };
  /** 行数（用于判定末行 → hold 选取） */
  lineCount: number;
  /** 默认 region（无 iso 上下文时） */
  defaultRegion: Region;
  /** 是否需要 iso 上下文 */
  requiresIso: boolean;
  /** 是否需要 region 上下文 */
  requiresRegion: boolean;
  /** delay 默认值（ms；0 = 无延迟） */
  defaultDelay: number;
}
```

引擎初始化时构建 `NODE_REGISTRY: Record<DialogueNodeId, NodeDefinition>`，所有文案来自 `dialogue-nodes.md`（硬编码或从 JSON 加载）。

---

*文档结束。等待主理人 / 程基岩评审。*
