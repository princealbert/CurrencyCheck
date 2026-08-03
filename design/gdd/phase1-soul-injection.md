# Phase 1 · 灵魂注入设计规格（Soul Injection Spec）

> 文档类型：可施工设计规格（engineering-ready）
> 项目：微信小游戏《货币图鉴·对对碰》
> 作者：文策渊（Vince Coyer）· design-strategist
> 日期：2026-07-30
> 任务：DS-P1-SPEC ｜ 动机来源：`design/audit/gameplay-audit-2026-07-30.md`
> 依赖数据：`design/content/currency-reference-dataset.md`、`minigame/src/data/currencies.ts`
> 约束：**零新美术资产**；不触碰 R1 内容扩池；纯函数核心 / 幂等解锁 / 平台抽象 / 四层双形态 / no-fail 五条架构红线不动。

---

## 0. 概述

### 0.1 要解决的问题（审计结论映射）

| 审计问题 | 本规格对策 |
|---|---|
| P1-2 解锁瞬间零庆祝、学习未闭环 | ① 现实锚闪现（Reality-Anchor Flash） |
| P1-3 分数无设计意义、无 mastery 信号 | ② 无失败星评（No-Fail Star Rating） |
| P2-2 配对反馈弱、无清除爽感 | ③ 配对清除 + 解锁 Burst |
| P0-1/P0-2 局内多样性枯竭、无难度递进 | ④ 难度阶梯（Board Scaling，8 币内自洽） |
| §5 工程小项 | ⑤ validateDeck 参数化 / 游戏时钟 / 色弱 toggle |

### 0.2 设计支柱对齐
- **靠特征认出**：④ T1 小盘降低首局认知负荷（3 对 vs 现在 8 对）；⑤ 色弱 toggle 强化非颜色通道。
- **愉悦发现**：① 首解锁闪知识；③ burst 庆祝；④ T1 加权抽取未解锁币，让"下一局有新东西"成立。
- **轻松无限（no-fail）**：② 星评只加不罚，完成即 1⭐ 保底；④ T3 解锁提供"纯游玩次数"保底通道。

### 0.3 全局技术公约（四项功能共用）
- **所有计时一律用游戏时钟**（见 §5.2），禁止新增 `setTimeout`/`Date.now()`。
- 所有新增动画期间置 `app.dirty = true`，动画结束即停止脏标记（维持现有按需重绘）。
- 所有新增持久化走现有 `KVStore` 注入模式，键名见 §6.4。
- 所有新增文案过 GDD §5 禁用词 gate（无投资/赌博/收益措辞）——本规格 §1.5 文案已自检通过。

---

## 1. 功能 ① 现实锚闪现（Reality-Anchor Flash）

### 1.1 触发条件（精确）
- 触发点：`app.flipCard` 中现有 `const firstTime = this.store.unlock(matchedIso, this.form)` 返回 `true` 时（**复用现有幂等解锁做幂等，不新增判重逻辑**）。
- 每个解锁实体 `(iso, form)` 一生只触发一次 → 每币种最多 2 次（coin 一次、note 一次）。
- 文案选择规则：
  - 该 iso **首个**形态解锁（`store.isCollected(iso)` 在 unlock 前为 false）→ 显示 `flashPrimary`（母题锚，"这张卡代表什么"）。
  - 该 iso **第二个**形态解锁 → 显示 `flashSecondary`（冷知识，给复玩新信息）。
  - 判定实现注意：须在调用 `unlock()` **之前**读取 `isCollected(iso)` 缓存结果。

### 1.2 内容来源与数据落点
- 文案源自 `design/content/currency-reference-dataset.md` §x.5 教育事实，**提炼后作为静态字段写进 `data/currencies.ts`**（新增 `flashPrimary: string; flashSecondary: string` 两字段到 `Currency` 接口）。属代码内文本数据，非美术资产，零包体图片成本。
- 全部 16 条文案见 §1.5，已定稿，工程直接复制。

### 1.3 展示形态（非阻塞 toast）
- **形态**：屏幕顶部横幅 toast，位于顶栏（topBar）正下方，**不锁输入、不弹模态**。玩家可继续翻牌。
- 布局：宽 = `min(vp.w - 32, 400)`，水平居中；高 = 56px（两行）；圆角 12。
- 视觉（全部现有绘制原语）：
  - 底：`THEME.panel`，描边 2px = `BAND_COLORS[region]`（该货币区域深色带），投影 `withElevation('E1')`。
  - 行 1（14px bold，`THEME.ink`）：`新发现 · {name} {iso}`，行首画一枚 8px 金色菱形（复用 `drawGoldDiamond` 同款 path，`THEME.gold`）。
  - 行 2（12px，`THEME.ink`）：闪现文案，`fitText` 约束 `maxWidth = 宽 - 24`，minSize 11。
- **点按 toast 区域 = 立即消失**（注册 hitTarget，动作为跳到 exit 段），不做任何跳转。

### 1.4 时间线与队列（精确 ms，游戏时钟）
| 段 | 时长 | 行为 |
|---|---|---|
| enter | 200ms | 从 `y = topBar.bottom - 20` 滑入到 `y = topBar.bottom + 8`，alpha 0→1，ease-out（`1-(1-t)^2`） |
| hold | 2600ms | 静置（队列非空时缩短为 1600ms） |
| exit | 300ms | alpha 1→0，y 上移 12px，ease-in |
- 总时长 3100ms（排队时 2100ms）。
- **队列**：FIFO，容量 3；同帧多个解锁（理论上不可能，防御性）按入队顺序播。队列满则丢弃最旧未播项。
- 时间基准：`app` 的游戏时钟（§5.2），后台切回不跳段。

### 1.5 文案定稿（长度上限：行 2 ≤ 24 个全角字符）

| ISO | flashPrimary（首形态：母题锚） | flashSecondary（次形态：冷知识） |
|---|---|---|
| USD | 母题是富兰克林——美钞上唯一非总统头像 | 绰号 greenback 源自背面的绿色油墨 |
| BRL | 母题是绿翅金刚鹦鹉，巴西生物多样性象征 | real 在葡语中意为「皇家／真实」 |
| EUR | 母题是虚构的桥与窗，以保持成员国中立 | 每个面额对应一个建筑时代，€20 是哥特 |
| GBP | 母题是画家透纳，「光即色彩」印上钞面 | 聚合物钞寿命约是纸钞的 2.5 倍 |
| CNY | 「红票」是最具代表性的高面额红色纸币 | 人民币意为「人民的货币」 |
| JPY | 母题是富士山与樱花，锚定蓝色千元钞 | 日元创设于 1871 年，最新版首次印英文 |
| INR | 母题是圣雄甘地，现行卢比钞的共同肖像 | 印度钞面印有 15 种以上语言 |
| ZAR | 母题是白犀牛，南非「五大兽」之一 | 南非钞印有全部 11 种官方语言 |

- 合规自检：无真实钞币图样引用、无国旗、无投资/收藏增值措辞，纯文化事实 ✅（CNY 文案刻意不落具体人物名，与 `currencies.ts` anchor 口径一致）。

---

## 2. 功能 ② 无失败星评（No-Fail Star Rating）

### 2.1 哲学
完成即胜利（现状不变）；星评是**只加不罚的 mastery 信号**——最低 1⭐，永远不出现 0⭐/失败字样。`score/combo` 保留但降级为次要展示（不删，兼容 best 存档）。

### 2.2 局末星评算法（精确公式）
新增会话计数（core 层，见 §6.1）：
- `mismatches`：`evaluate()` 走错配分支时 +1（单位：次）。

设 `P` = 本局总对数（`cards.length / 2`），`m` = mismatches：

```
stars(m, P) = 3  若 m ≤ ceil(P × 0.50)
            = 2  若 m ≤ ceil(P × 1.25)
            = 1  其余（完成即得）
```

| 档位 | P | 3⭐ 条件 | 2⭐ 条件 | 1⭐ |
|---|---|---|---|---|
| T1 | 3 | m ≤ 2 | m ≤ 4 | 完成 |
| T2 | 8 | m ≤ 4 | m ≤ 10 | 完成 |
| T3 | 18 | m ≤ 9 | m ≤ 23 | 完成 |

- 系数 `0.50 / 1.25` 定义为 `core/starRating.ts` 顶部常量 `STAR_K3 / STAR_K2`，**标注 [TUNABLE·待 playtest]**（沿审计 §6 的保留意见；T3 因同 iso 多副本天然变易，playtest 后可能单独收紧）。
- 为何用 mismatches 而非 moves：与审计创意 C 一致、对玩家可解释（"记错了几次"）、且不惩罚慢玩（无时间项，契合轻松无限）。

### 2.3 持久化（最佳星）
- 键粒度：`(tier, form)` → 最佳星 0–3（0 = 从未完成该档）。共 3×2 = 6 个槽。
- 只升不降：`best = max(best, earned)`。
- 另存每档完成局数 `plays[tier]`（供 T3 保底解锁，§4.4）。

### 2.4 每货币 mastery（累计制，非首次制）
- 定义：`mastery[iso]` = 该 iso 累计成功配对次数（coin/note 合并计，上限 999）。选累计制原因：首次制与解锁集合信息重复，累计制才给"重复见面→记住它"的长期信号。
- 里程碑（图鉴单元格显示为小圆点 pips，用 `THEME.gold` 实心/`THEME.locked` 空心）：
  - ●○○ 熟悉：≥ 1 次 ｜ ●●○ 熟识：≥ 5 次 ｜ ●●● 精通：≥ 15 次
- 更新点：`evaluate()` 返回 matched 后在 app 层 `metaStore.addMastery(iso)`（每次配对 +1，不限首次）。

### 2.5 展示位置（三处）
1. **局末胜利面板**（renderer.ts `drawWin`）：面板首要位置改为三颗星（32px，逐颗点亮动画：每颗间隔 250ms，scale 1.4→1.0 弹入，金色；未获得的画空心星轮廓 `THEME.locked`）。其下小字：`记错 {m} 次 · 得分 {score}`（score 降级为 13px 次要行）。
- 星形绘制：10 点 path 五角星（纯 path，零资产），实心 `THEME.gold`，空心描边 1.5px。
2. **Hub 档位按钮副标题**（§4.5）：`最佳 ★★☆`（已获实心/未获空心，取该档位两形态中的最高值）。
3. **图鉴**：单元格右下角 mastery pips（3 点，直径 4px，间距 3px）；图鉴顶栏加总星数 `⭐ {sum}/18`（6 槽 × 3 星）。

---

## 3. 功能 ③ 配对清除 + 解锁 Burst

### 3.1 清除动画时间线（精确 ms，t=0 为 evaluate 判定 matched 的那一帧）
| 段 | 区间 | 视觉 | 缓动 |
|---|---|---|---|
| A 确认停留 | 0–250ms | 两卡保持 face_up，描边加亮为 `REGION_COLORS[region]` 2px（认知节拍：让玩家看清配上的是什么） | — |
| B pop | 250–370ms | scale 1.00 → 1.06（绕卡心） | ease-out |
| C 收缩清除 | 370–650ms | scale 1.06 → 0，alpha 1 → 0 | ease-in（`t^2`） |
| D 幽灵槽位 | ≥650ms 常驻 | 原槽位画 1px 圆角虚线轮廓，`BAND_COLORS[region]` @ alpha 0.10（保留空间记忆锚点 + "棋盘在变空"的可见进度） | — |
- **不锁输入**：matched 卡本就无 hitTarget；动画期间其余 face_down 卡照常可点。两组清除动画可并行（连击快手场景）。
- 渲染实现：drawBoard 按卡查询 `app.clearAnimOf(card)`（类比现有 `cardFlip`），拿 `{scale, alpha}` 后 `ctx.save() → translate 卡心 → scale → drawCard → restore`；state 为 matched 且无活动动画 → 只画幽灵槽位。

### 3.2 Burst 视觉规格
两档，均以两卡矩形中点连线的中心为发射原点：

**标准 burst（每次配对成功都放，t=370ms 起）**
- 粒子：12 个；形状 = 8 圆 + 4 菱形（菱形复用 `drawGoldDiamond` path 逻辑）；尺寸 3–5px（随机）。
- 颜色：8 个 `REGION_COLORS[region]`（该配对货币的区域亮色）+ 4 个 `THEME.gold`。
- 运动：初速度沿 12 等分角度 ±15° 抖动，速率 `cell*1.2 ~ cell*1.8 px/s`（cell = 卡宽），重力 0，速度衰减 ×0.92/帧；寿命 450ms；alpha 随寿命线性 1→0。
- 光环：1 道圆环描边，半径 `cell*0.2 → cell*0.7`，线宽 3→1，颜色 `REGION_COLORS[region]`，alpha 0.8→0，时长 350ms，ease-out。

**解锁 burst（仅 `firstTime === true` 时替换标准档）**
- 粒子 20 个（12 区域色 + 8 金）；光环两道（第二道延迟 120ms，颜色 `THEME.gold`）；其余同上。
- 与功能①联动：解锁 burst 起播后 200ms 入队现实锚 toast（爽感先行、知识跟上）。

### 3.3 性能预算（Canvas 2D 硬约束）
- **粒子池预分配**：固定 48 槽对象池（`{x,y,vx,vy,size,color,shape,bornAt,life,active}`），模块加载时一次性创建，运行期**零 new / 零数组分配**；并行 burst 超出池容量时复用最老槽。
- 绘制：粒子按颜色分组批量 `beginPath` + 一次 `fill`（每帧 ≤3 次 fill 调用）；**粒子与光环绘制期间禁 shadow**（不调 `withElevation`）。
- 帧成本上界：48 粒子 × arc/path ≈ 每帧 <0.3ms（低端机余量充足）；无任何离屏 canvas 需求。
- 脏标记：存在活动粒子/清除动画/toast 时每帧 `dirty=true`，全部结束后停。

---

## 4. 功能 ④ 难度阶梯（Board Scaling）

### 4.1 档位定义（8 币自洽，零新内容）

| 档 | 名称 | 对数 P | 卡数 | coin 网格(列×行,竖屏) | note 网格(列×行,横屏) | 组牌规则 |
|---|---|---|---|---|---|---|
| T1 | 初识 | 3 | 6 | 2×3 | 3×2 | 从 8 币**加权抽 3 种**，每种 1 对 |
| T2 | 环游 | 8 | 16 | 4×4 | 4×4（现状） | 全 8 币各 1 对（= 当前局） |
| T3 | 环球 | 18 | 36 | 6×6 | 6×6 | 全 8 币各 2 对（16 对）+ 加权抽 2 币各再 +1 对 |

- **T1 加权抽取**（把"发现感"还给前几局）：币种权重 `w = 该 (iso, 当前form) 未解锁 ? 3 : 1`，按权重无放回抽 3 种。→ 新玩家前 3 局大概率每局见到新面孔；老玩家仍有随机变化。
- **T3 多副本机制**：同 iso 出现 4 或 6 张。判定不变（`a.iso === b.iso`），任意两张同 iso 即配对成功，`matchedCount` 照常按次数累加、`isWin = matchedCount ≥ cards.length/2` **现有逻辑零改动即正确**。多副本让单对更易配、但 36 张记忆总量大 → 净难度仍显著高于 T2，且天然 no-fail 友好。T3 的 +1 对加权：`w = 4 - min(3, masteryPips(iso))`（越不熟越常出现，服务学习）。
- **matchKey 架构不动**：本阶段判定仍是 iso 直比；roadmap 的 `matchKeyOf` 注入点留给 v1.1 元素关联配对，本规格不占用。

### 4.2 发牌不变量（替代"每 ISO 恰 2 张"）
- 新不变量：**每 ISO 张数为偶数且 ≥2；总张数 = 2P**。`validateDeck` 参数化见 §5.1。
- 洗牌仍用现有 Fisher–Yates。

### 4.3 布局参数化
- `boardLayout(vp, safe, form)` → `boardLayout(vp, safe, form, cols, rows)`；`COLS/ROWS` 常量改为参数（默认 4×4 保兼容）。cell 计算逻辑（coin 近方 / note 2:1 + 名称行收敛）不变。
- **最小可点尺寸校验**：375pt 宽竖屏下 T3 coin cell ≈ (351−40)/6 ≈ 51px ≥ 44pt 触控底线 ✅；T1 大卡（≈165px）自然成为"新手看清母题"的教学放大镜。
- T3 建议将卡间距 GAP 由 8 收到 6（仅 cols ≥ 6 时），给 cell 多留 ~4px——作为 `gap(cols)` 小函数，非硬编码。

### 4.4 递进方式（Hub 自由选 + 温和门槛，双通道保底）
| 档 | 解锁条件 |
|---|---|
| T1 | 始终开放 |
| T2 | T1 累计完成 ≥ 1 局（任意形态、任意星） |
| T3 | T2 最佳星 ≥ 2（任意形态）**或** T2 累计完成 ≥ 3 局 |
- 设计理由：星评通道奖励 mastery；局数通道是 no-fail 保底——**只玩就一定能全解锁**，无技巧墙。解锁状态为全局（不分形态），减少门槛感。
- 老玩家迁移：已有存档玩家（`progress().unlocked > 0`）视为已满足 T2 解锁（首次升级时若 `plays` 为空但解锁集非空，写入 `plays.t1 = 1`），避免倒退体感。

### 4.5 Hub 入口改造
- 现"开始配对"单按钮 → **三个档位按钮**（复用 `vstack`，count 2→4：T1/T2/T3/图鉴；按钮高 56 不变，`vp.h*0.62` 中心上移至 `vp.h*0.60`）。
- 按钮文案：主标题 `初识 · 3 对` / `环游 · 8 对` / `环球 · 18 对`；副标题（`sub`）：已解锁 → `最佳 ★★☆`（空心星用 ☆ 字符即可，或 path 星，交工程选）；未解锁 → 灰底（`THEME.locked`）+ `完成上一档解锁`，点击仅弹轻提示（复用 toast 通道，文案 `先完成「{上一档名}」一局吧`，hold 1200ms）。
- 形态选择（coin/note segment）保持现状，作用于所选档位。
- `startPair(form)` → `startPair(form, tier: 1|2|3)`；`restart()` 记住当前 tier。

---

## 5. 审计小修（随本阶段一并交付）

### 5.1 validateDeck 参数化
```ts
validateDeck(cards: Card[], expectedPairs?: number): { ok, total, perIso }
// ok = (expectedPairs ? cards.length === expectedPairs*2 : cards.length>0 && cards.length%2===0)
//      && 每 perIso[iso] 为偶数且 ≥2
```
不再硬编码 16；旧调用点传 `expectedPairs = tier 对数`。

### 5.2 游戏时钟（替换 wall-clock setTimeout）
- `app` 维护 `gameTimeMs`：每帧 `gameTimeMs += min(dt, 100)`（dt 来自现有 `platform.now()` 差值；min 夹逼吞掉后台大跳帧）。
- 错配翻回：删除 `setTimeout`，改为 `pendingFlipBackAt = gameTimeMs + MISMATCH_FLIPBACK_MS`，主循环中 `gameTimeMs ≥ pendingFlipBackAt` 时执行 `flipBack` 并清空。现有 `this.match === ref` 防御可简化为存在性检查（时钟与状态同源，无竞态）。
- 功能①③的全部时间线同用 `gameTimeMs`。**收益**：微信 onHide/onShow 切后台时所有动画与翻回自然冻结，零漂移。

### 5.3 色弱 / 高对比 toggle（方案建议，允许排入本阶段末位或顺延）
- 入口：Hub 右上角 32×32 图标按钮（纯 path 画"半圆填充对比圈"），点击开关，存 `KVStore`。
- 开启效果（全部零资产，绘制层）：
  1. 卡面 ISO 字号 ×1.25、加粗；
  2. 区域徽标（现有形状层）描边加粗至 3px；
  3. 卡面顶部加**区域纹理带**：amer=圆点、euro=斜线、asia_afr=交叉线（8×8 重复 path，第 4 条非颜色通道）；
  4. burst 粒子改为全 `THEME.gold`（避免依赖区域色传达信息）。
- 验收：置灰签名色②后，任意两币仍可由 ISO 文本+形状+纹理区分（GDD §6.3 规则 2）。

---

## 6. 数据流与改动清单（core / render / app / data）

### 6.1 core（纯函数，全部可 Node 单测）
| 文件 | 改动 |
|---|---|
| `types.ts` | `MatchState` + `mismatches: number`；`Currency` + `flashPrimary/flashSecondary` |
| `matchLogic.ts` | `evaluate` 错配分支 `mismatches+1`（不可变返回）；其余不动 |
| `deck.ts` | 新增 `buildDeckPlan(plan: {iso: string; pairs: number}[], currencies, form): Card[]`（现 `buildDeck` 改为其 P=1 全量特例，保留导出）；`validateDeck` 按 §5.1 |
| `tierConfig.ts`（新） | `TIERS` 常量表（对数/网格/组牌规则/解锁条件谓词）+ 加权抽取纯函数 `pickWeighted(rng, items, weightOf, n)`（rng 注入，可测） |
| `starRating.ts`（新） | `starsFor(mismatches, pairs)` + `STAR_K3/STAR_K2` 常量 |
| `metaStore.ts`（新） | 星/局数/mastery/设置 持久化，构造注入 `KVStore`（与 CollectionStore 同模式；**不改 CollectionStore**） |

### 6.2 render
| 文件 | 改动 |
|---|---|
| `layout.ts` | `boardLayout(..., cols, rows)`；`gap(cols)` |
| `fx.ts`（新） | 粒子池 + burst 更新/绘制、清除动画插值、toast 绘制（纯绘制 + 池状态，不持久） |
| `renderer.ts` | drawBoard 接清除动画/幽灵槽位/fx 绘制调用 + 顶部 toast；`drawWin` 星评面板改版（§2.5） |
| `hub.ts` | 三档位按钮 + 最佳星 + 锁定态 + 色弱 toggle 图标 |
| `codex.ts` | 单元格 mastery pips + 顶栏总星 |
| `card.ts` | matched 幽灵槽位分支（或由 renderer 直接画，工程自选） |

### 6.3 app / platform
- `app.ts`：`gameTimeMs`、`pendingFlipBackAt`、`startPair(form, tier)`、fx/toast 队列状态、`metaStore` 实例、局末结算写星与 mastery。
- `platform/`：**零改动**（所有新能力都在现有 `now/rAF/KVStore` 之内）。

### 6.4 新存储键（沿用 `-v1` 命名约定）
```
currency-codex-stars-v1     // {"t1_coin":3, "t2_note":2, ...} 最佳星 0–3
currency-codex-plays-v1     // {"t1":5,"t2":3,"t3":0} 各档完成局数
currency-codex-mastery-v1   // {"USD":7,"BRL":2,...} 累计配对次数
currency-codex-settings-v1  // {"colorblind":false}
```

---

## 7. 开放问题（需主理人/用户拍板，不阻塞开工）
1. **T3 note 形态小屏适配**：横屏 6×6 note 卡在 iPhone SE 级宽度约 90×45px，可玩但偏小。选项 A：接受；选项 B：T3 仅开放 coin（note 停在 T2）。**建议 A**，playtest 后再收。
2. **星评阈值系数**（`0.50/1.25`）与 **T3 是否单独收紧**：标注 TUNABLE，首轮 playtest 数据定稿。
3. **色弱 toggle 排期**：方案已给（§5.3），建议本阶段末位实现；若工期紧可顺延一档但**不建议**（GDD 硬要求）。
4. **score/best 的长期去留**：本阶段保留降级展示；若星评验证成功，建议 Phase 2 移除 best 分展示（存档键保留）。

## 8. 建议实现顺序（依赖拓扑）
1. **core 地基**：§6.1 全部（mismatches、starRating、tierConfig、deck plan、validateDeck、metaStore）——纯函数先行，单测覆盖。
2. **游戏时钟重构**（§5.2）——后续所有动画的时间基准，必须先落。
3. **难度阶梯**（④）：layout 参数化 → startPair(tier) → Hub 三按钮。此步完成即解决 P0 体验问题。
4. **清除 + burst**（③）：fx.ts 池 → 清除时间线 → 两档 burst。
5. **现实锚闪现**（①）：currencies.ts 文案字段 → toast 通道（复用 fx 的时间线设施）。
6. **星评落盘与三处展示**（②）：胜利面板 → Hub 副标题 → codex pips。
7. **色弱 toggle**（§5.3）。

> 验收总则：全程无失败态字样；关闭所有新特效（资源缺失/低端机）游戏仍完整可玩；所有新逻辑在 core 层可脱离 Canvas 单测。
