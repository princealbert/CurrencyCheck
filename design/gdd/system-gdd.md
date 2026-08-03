# 货币图鉴 · 系统 GDD（System Game Design Document）

> 文档类型：系统级游戏设计文档（Systems GDD）
> 项目：微信小游戏《货币图鉴》· 对对碰 / 配对（memory-match）世界各国货币
> 作者：文策渊（Vince Coyer）· 游戏设计 + 叙事 + UX
> 版本：v1.0 · 日期：2026-07-26
> 状态：待主理人（游承峰）审批
> 依赖文档：
> - `design/menu-ia/game-menu-architecture.md`（IA / 自动收藏 / Hub 中心化）
> - `design/design-philosophy/currency-fidelity-vs-compliance.md`（迁移识别北极星 / 漫画式保真 / 特征还原矩阵 v2）
> - `design/art/currency-stylization-strategy.md`（四层识别码 / 区域双编码 / 单资产 11 要素）
> - `design/market-analysis/competitive-landscape.md`（差异化 / 合规信封）
> - ardot 原型 708097081203153（5 屏：S1 Hub / S2 配对 / S3 图鉴 / S4 档案 / S5 货币详情）

---

## 0. 设计基线（所有系统共享）

### 0.1 设计支柱（Pillars）
1. **愉悦发现（Joyful Discovery）** —— 配对→解锁的爽感来自"靠特征认出"，非分数。
2. **可亲文化学习（Approachable Cultural Learning）** —— 100% 真实内容，分层（儿童/成人）。
3. **轻松无限（Relaxed & Endless）** —— 无体力 / 无计时 / 无限畅玩，广告不卡进度。

### 0.2 北极星指标（North Star）
**迁移识别（Transferable Recognition）** —— 玩家在现实中见到真钞/真币能认出。一切"保真到什么程度"的最终闸门：**抽象掉这个维度，玩家在现实中还认得出吗？** 本北极星新增**物理形态轴（第 5 视觉轴）**：令牌整体形状 = 物理形态（圆牌=硬币 / 长方牌=纸币），token 形状直接呼应真实硬币/纸币，强化"现实认得出"的跨平台视觉迁移。

### 0.3 关键合规红线（必须贯穿每节）
| # | 红线 | GDD 落点 |
|---|------|---------|
| 1 | 禁用真实钞币/硬币图像，仅用风格化原创几何母题 | 所有视觉来自 `signature_color` / `motif_symbol` 数据；卡片渲染走「四层识别码」，绝不引用真实图样；§6 占位契约明确"纯色块+文字" |
| 2 | 货币标识用 ISO 4217 代码，弱化/不用国旗 | `iso_code` 为唯一身份字段；`region` 仅用区域双编码（形状+色），UI 不显示国旗 |
| 3 | 汇率用每日静态快照，页面须标注"仅供参考，非金融建议" | §5 数据结构 + 免责嵌入点；MVP 不展示汇率（降范围，见 §6） |
| 4 | 定位"教育/文化"，禁用投资/预测/交易措辞；不做真假币区分、不拼真实纸币碎片 | 文案 schema 含禁用词 gate（§5）；配对判定基于**币种实体 ID** 而非碎片；详情页无防伪/真假币内容 |

### 0.4 屏幕模型对齐说明（重要）
本 GDD 采用 **ardot 原型 5 屏**：S1 Hub 钱币收藏册 / S2 配对玩法 / S3 图鉴 / S4 收藏家档案 / S5 货币详情。
与原 `game-menu-architecture.md` v1 的差异：v1 的 S5=旅行护照（teaser）在原型中已**下沉为 Hub（S1）内的「敬请期待」槽**，原型 S5 改为「货币详情」页（由 S3 图鉴进入）。本 GDD 以 ardot 原型为准；护照系统在 MVP 范围外，仅作 Hub teaser。

### 0.5 全局枚举与取值（供所有系统引用）
- `region` ∈ { `amer`, `euro`, `asia_afr` }
  - `amer` → `region_shape = rounded_rect`，`region_color = #E0B15E`（金）
  - `euro` → `region_shape = hexagon`，`region_color = #5B8FB0`（蓝）
  - `asia_afr` → `region_shape = diamond`，`region_color = #87A878`（绿）
- `motif_category` ∈ { `portrait`, `architecture`, `animal`, `landscape` }
- `denomination_tier` ∈ { `1`, `2`, `3` }（环数 1/2/3；尺寸 +8%/级；Tier2+ 加柔光带）
- 配对判定键：`iso_code`（同 ISO = 可配对；每 ISO 每局恰好出现 2 次）
- **`form_factor`（物理形态轴，第 5 视觉轴）** ∈ { `coin`, `note` }
  - `coin`：圆牌（圆形 / 圆角方）；竖屏（`COIN_ORIENTATION = portrait`）。
  - `note`：长方牌（约 2:1 横向）；强制横屏（`NOTE_ORIENTATION = landscape`）。
  - 解锁实体键 = `(iso_code, form_factor)`；图鉴按币种分别记录两种形态。
- **布局常量（按 `form_factor` 区分）**：
  - coin-mode：`COIN_ORIENTATION = portrait`，网格 `4×4`（8 对），卡片近方形（MVP 用方块令牌近似圆牌）。
  - note-mode：`NOTE_ORIENTATION = landscape`，`NOTE_GRID_COLS = 4`，`NOTE_GRID_ROWS = 4`（4 列 × 4 行，8 对），`NOTE_CARD_RATIO ≈ 2:1`（横向长方牌）。
  - 注：两模式网格容量均为 `4×4`（8 对）；差异在卡片比例与屏幕朝向，网格容量不变。

---

## 1. 配对玩法系统（Match Gameplay System）

### ① 目标 / 概述
提供核心循环「翻牌 → 记忆 → 配对」的休闲 memory-match 体验。玩家在网格中翻开两张卡，凭**风格化特征（形状/母题色/ISO/面额）**而非文字找出同币种配对。胜利 = 全部配对完成；**无失败态**（对齐"轻松无限"支柱 + 儿童友好 + 无体力/计时）。连击/得分是奖励反馈，非进度门槛。本系统是「愉悦发现」支柱的主战场，也是收藏元循环的触发器。

### ② 核心机制
- **网格与布局**：`grid_rows × grid_cols`，卡总数 = `rows × cols`，须为偶数；每 ISO 恰好 2 张。`total_pairs = (rows × cols) / 2`。
- **翻牌**：点击未翻卡 → 播放翻牌动画（≤ 300ms）→ 进入"已翻"态。
- **配对判定**：当第 2 张卡翻开时，比较两张卡的 `iso_code`：
  - 相同 → **配对成功**（matched 态，常驻显示，触发发现/收藏事件）。
  - 不同 → **错配**（抖动 + 轻微反馈），延迟 `MISMATCH_FLIPBACK_MS = 800ms` 后两张翻回。
- **输入锁**：当有 2 张卡处于"已翻未判定"态时，锁定网格输入直至判定完成。
- **连击 / 得分**（奖励性，非门槛）：
  - `combo_before_i` = 当前配对前连续成功配对数（错配或首配 = 0）。
  - `match_score_i = round(100 × (1 + 0.5 × combo_before_i))` （单位：分）
  - `session_score = Σ_i match_score_i` （单位：分）
  - 错配 → `combo_before` 重置为 0。
- **关卡 / 地区书架 → 配对局映射**（见 §1.④ / §1.⑦）：
  - Hub「开始配对」CTA → 跨地区"环球"会话（`source = hub_cta`）。
  - 区域书架点击 → 单地区主题会话（`source = region_shelf`，更易）。

### ③ 状态与数据
**每卡运行时状态（CardRuntime）**
| 字段 | 类型 | 说明 |
|------|------|------|
| `card_id` | string | 局内唯一 |
| `iso_code` | string(3) | 配对判定键（来自货币主数据） |
| `state` | enum | `face_down` / `face_up` / `matched` |
| `first_flipped_at` | datetime | 翻面时间戳（用于动画/可选后期计时） |

**会话配置（SessionConfig）**
| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | string | 唯一 |
| `source` | enum | `hub_cta` / `region_shelf` |
| `regions` | region[] | 参与地区（1=单地区易；>1=跨地区难） |
| `grid_rows` / `grid_cols` | int | 如 3×4、4×4、6×6 |
| `pairs` | int | `(rows×cols)/2` |
| `difficulty_tier` | 1\|2\|3 | 见 §1.⑦ |
| `currency_pool` | iso_code[] | 本局选用的币种（长度 = `pairs`） |
| `match_criteria` | const | 恒为 `"iso"` |
| `form_factor` | enum | `coin` / `note`；本局卡片物理形态（coin=圆牌竖屏 / note=长方牌横屏），见 §1.⑨ |

**会话运行时（SessionRuntime）**：`flipped_queue`（已翻未判定卡，≤2）、`matched_pairs`、`steps`（翻牌计数，仅展示）、`combo_current`、`session_score`、`start_at`。

### ④ 规则与边界
- **配对判定永远基于 `iso_code`**，不基于卡面像素/美术（合规 + 儿童友好 + 色弱友好）。
- **无失败态**：不设生命、不设倒计时、步数不触发失败（MVP 无体力/计时）。
- **单地区会话**：`regions` 长度 1，形状统一，靠母题色/ISO/面额区分（更易）。
- **跨地区会话**：形状混合，母题跨地区更多样（更难记忆，但形状可辅助分组）。
- **合规红线落点**：卡面只渲染四层识别码（§6 契约），绝不出现真实钞币图样、国旗、防伪/真假币内容；错配反馈不含任何"真假"措辞。
- **难度边界**：单局币种数 ≤ 货币主数据可用总数；单地区会话的 `currency_pool` 须全部属于该地区且 `motif_category`/`signature_color` 足够区分（避免同区两币视觉不可分 → 触发 §6 兜底）。

### ⑤ 与其他系统交互
- → **收藏与解锁系统**：每次 `match_score` 成功（同 ISO 配对）→ 触发 `OnPairMatched(iso_code)` 事件；由解锁系统决定是否为"首次"并广播 `OnCurrencyUnlocked`（首次才播发现动画、进图鉴）。
- → **进度与成就系统**：会话结束 / 配对成功上报 `matched_pairs`、`combo_max`、`mismatch_count`、`difficulty_tier`，供成就判定（连击大师 / 无瑕配对 / 耐心学者）。MVP 仅维护计数，不展示成就。
- → **图鉴系统**：解锁事件驱动 S3 条目由剪影→实显。
- ← **图鉴 / 货币主数据**：提供 `currency_pool` 候选与卡面四层识别码字段。

### ⑥ 失败 / 异常处理
1. **同 ISO 出现 >2 张（数据错误）**：会话生成时校验 `currency_pool` 每 ISO 计数=2；违例则拒绝开局并记日志，回退 Hub。
2. **奇数卡 / 网格非法**：`(rows×cols)` 非偶数或超设备最小卡尺寸 → 拒绝，使用默认 3×4。
3. **翻牌动画被打断（切后台/来电）**：onPause 冻结 `flipped_queue`；回到前台恢复，不结算错配，不丢进度。
4. **快速连点 2 张同卡（自身）**：同一 `card_id` 第二次点击忽略（已 `face_up`/`matched` 不响应）。
5. **判定期内再次点击**：输入锁生效，点击忽略，防双翻竞态。
6. **币种主数据缺失字段**（如 `signature_color` 空）：用区域默认 `region_color` 兜底渲染，记告警，不阻断。

### ⑦ 平衡与难度
- **难度三维**：(a) 网格规模（对数）= 对数越大越难；(b) 地区同质性（单地区易 / 跨地区难）；(c) 同局母题相似度（相似母题更难，属美术层，MVP 用 `motif_category` 多样性保证）。
- **难度分层（设计目标，MVP 默认发 T1）**：
  | Tier | 网格 | 地区 | 面向 | `pairs` |
  |------|------|------|------|---------|
  | T1 新手书架 | 3×4 | 单地区 | 儿童 / 首次 | 6 |
  | T2 收藏家 | 4×4 | 单地区或 2 地区 | 通用 | 8 |
  | T3 环球之旅 | 6×6 | 跨地区混合 | 进阶 | 18（⚠ 见风险 R1 移动端最小卡尺寸） |
  > 注：T3=6×6 为文档化上限；MVP HTML 原型固定 3×4。6×6 在竖屏微信需评估卡最小可点尺寸（≥ 44dp）与是否滚动，待程基岩对齐。
- **主导策略检查**：memory-match 无退化主导策略——必须配齐所有对才能胜，过程记忆是品类本质，连击仅放大奖励感，不构成"唯一正解"。无经济（无代币消费），广告不卡进度 → 无经济失衡。
- **认知过载检查**：单局仅呈现网格，Hub 渐进揭示（区域书架而非 200 币齐列），符合"轻松无限"。

### ⑧ 验收标准
- [ ] 任意合法网格可开局，每 ISO 恰好 2 张，总数偶数。
- [ ] 同 ISO 配对成功、异 ISO 翻回；判定仅基于 `iso_code`。
- [ ] 无计时/无生命/无失败态；步数仅展示。
- [ ] 连击公式与得分计算正确，错配清零连击。
- [ ] 首次配对广播 `OnCurrencyUnlocked`；重复配对不重复解锁（由 §2 保证）。
- [ ] 单地区/跨地区会话可分别触发；区域书架与 CTA 入口正常。
- [ ] 合规：卡面无真实图样/国旗/防伪内容；错配文案无"真假"措辞。
- [ ] 异常 6 项均有处理，不崩、不丢进度。
- [ ] **形态模式**：coin-mode 竖屏 4×4 近方牌、note-mode 强制横屏 4×4 横向 2:1 长方牌均可开局；两模式匹配键均仅 `iso_code`；输入锁/翻牌/连击逻辑通用。

### ⑨ 形态模式（Form Factor）
**概述**：引入"硬币 / 纸币"双物理形态维度，作为卡片整体形状（第 5 视觉轴），直接服务 §0.2 迁移识别北极星。形态是**真实匹配维度**，非仅视觉风格——同一币种在 coin-mode 与 note-mode 下为两个独立可解锁实体。

- **`form_factor` 进入会话配置**：`SessionConfig` 新增 `form_factor ∈ { coin, note }`（见 §1.③ 表）。会话内所有卡共享同一 `form_factor`（卡片继承会话形态）。
- **coin-mode（硬币形态）**：
  - 卡片 = 圆牌（圆形 / 圆角方），整体轮廓呼应真实硬币。
  - 屏幕朝向：竖屏（`COIN_ORIENTATION = portrait`）。
  - 网格：`4×4`（8 对）；卡片近方形（MVP 用方块令牌近似圆牌）。
- **note-mode（纸币形态）**：
  - 卡片 = 长方牌（约 `NOTE_CARD_RATIO ≈ 2:1` 横向），整体轮廓呼应真实纸币。
  - 屏幕朝向：**强制横屏**（`NOTE_ORIENTATION = landscape`）；设备竖持时提示旋转或自动锁定横屏。
  - 网格：`NOTE_GRID_COLS = 4 × NOTE_GRID_ROWS = 4`（4 列 × 4 行，8 对）的横向宽牌网格。
- **匹配键不变**：无论何种 `form_factor`，配对判定仍仅比较 `iso_code`（同 ISO = 可配对）。**跨 `form_factor` 不配对**（一次会话只含一种形态）。
- **通用逻辑**：翻牌动画（≤300ms）、输入锁（`flipped_queue` ≤2）、错配翻回（`MISMATCH_FLIPBACK_MS = 800ms`）、连击/得分公式（`match_score_i = round(100 × (1 + 0.5 × combo_before_i))`）在两种模式下完全一致。
- **区域双编码形状层分隔**：区域徽标（圆角矩形/六边形/菱形）是卡面**角落小徽标**（标记"洲"），与卡片整体物理形态（圆牌/长方牌）视觉上严格区分——尤其 `amer` 的 `rounded_rect` 徽标不得被误读为卡片整体形状（卡片是圆/长方，徽标是角标）。
- **合规**：双形态均只渲染四层识别码（§6.3），绝不引用真实钞币图样；物理形态属抽象几何呼应，非复制。

---

## 2. 收藏与解锁系统（Collection & Unlock System）

### ① 目标 / 概述
实现「首次成功配对即自动收藏」的**风物志式**机制：玩家无需任何手动操作，首次配对某币种即自动加入图鉴与档案。这是相对答题竞品的结构性优势——奖励"长出来的收藏物"而非分数。详情页（S5）为纯阅读态，无"加入收藏"按钮。本系统把配对动作转化为收藏进度，是元循环引擎。

### ② 核心机制
- **解锁实体 = `(iso_code, form_factor)`**：每种币的 coin / note 两种物理形态为**两个独立可解锁实体**。图鉴中同一币种需两种形态都解锁才视为"完整收集"（`is_complete`，见 §2.③）。
- **自动解锁状态机**（每实体 `(iso_code, form_factor)`，全局玩家档案）：
  ```
  [LOCKED] --(首次成功配对 (iso_code X, form_factor F) 且当前 LOCKED)--> [UNLOCKING] --(发现动画结束)--> [UNLOCKED]
  [UNLOCKED] --(后续任何配对 (X, F))--> 保持 [UNLOCKED]，不广播事件
  ```
- **触发源**：监听配对系统的 `OnPairMatched(iso_code, form_factor)`（新形态模式下携带 `form_factor`）。
- **首次判定**：查询玩家档案 `collected_entities` 是否含 `(iso_code, form_factor)`：
  - 不含 → 加入 `collected_entities`，置 `is_new=true`，记录 `first_unlocked_at`，广播 `OnCurrencyUnlocked(iso_code, form_factor)`。
  - 已含 → 仅 gameplay 结算，无事件（**重复配对不重复解锁**）。
- **去重保证（按实体幂等）**：广播以 `(iso_code, form_factor)` 为幂等键，同一实体在一次会话内第 2 张匹配不重复触发（首配即锁定）。不同 `form_factor` 的同 ISO 视为不同实体，可分别首次解锁。

### ③ 状态与数据
**玩家档案（PlayerProfile，持久化）**
| 字段 | 类型 | 说明 |
|------|------|------|
| `collected_entities` | (iso_code, form_factor)[] | 已解锁实体集合（解锁态主存；同 ISO 可含 coin/note 两条） |
| `unlock_records` | map | `{ (iso_code, form_factor): { first_unlocked_at, is_new, new_until } }` |
| `total_currency_count` | int | 货币主数据总数（完成度分母；实体分母 = 总数 × 2） |

**解锁态派生字段**（供图鉴/档案读取）
- `collected_isos` = 含至少一种已解锁形态的币种集合（派生；向后兼容 §4 统计）
- `is_entity_collected(iso, ff)` = `collected_entities` 含 `(iso, ff)`
- `is_collected(iso)` = 存在任一 `ff ∈ {coin, note}` 已解锁（单形态即"已发现"）
- `is_complete(iso)` = coin 与 note 均已解锁（"完整收集"）
- `completion_pct_single` = `len(collected_entities) / (total_currency_count × 2) × 100` （%）
- `completion_pct_coin` / `completion_pct_note` = 各形态解锁占比
- 区域完成：`region_collected[r] = count(iso in collected_isos where region=r)`

### ④ 规则与边界
- **无手动收藏按钮**：S5 详情页、S3 图鉴均不提供"加入收藏"动作；解锁唯一路径 = 首次成功配对。
- **未解锁态**：图鉴中以剪影 + ISO「?」占位，不可进入 S5 详情（或进 S5 仅显示"未发现"占位，无数据）。
- **合规红线落点**：解锁/收藏全过程不触碰真实图像、不出现国旗、不引入"真伪"概念；`collected_isos` 存储的是 ISO 与进度，非任何图样。
- **幂等**：跨会话、跨设备（未来云存档）以 `(iso_code, form_factor)` 实体去重，重复配对/重复收到事件均不增计数；不同 `form_factor` 的同 ISO 视为不同实体。

### ⑤ 与其他系统交互
- ← **配对玩法系统**：消费 `OnPairMatched`。
- → **图鉴系统**：广播 `OnCurrencyUnlocked` → S3 对应条目剪影→实显，S5 可读全数据。
- → **进度与成就系统**：解锁计数驱动完成度%；触发"初见/满图鉴/地区全收集"类成就（MVP 不展示）。
- → **Hub（S1）**：更新进度环 / "已收集 N/Total" / 区域完成环。

### ⑥ 失败 / 异常处理
1. **事件丢失（配对成功但未收到 unlock 事件）**：配对系统本地落「已匹配 (iso, ff) 暂存」，重连/重启后由解锁系统对账补齐（以 `collected_entities` 为目标态）。
2. **重复事件风暴**：同一 `(iso_code, form_factor)` 在一帧内多次 `OnPairMatched` → 状态机幂等，仅首次生效。
3. **主数据无此 ISO**（脏数据）：忽略该事件，记告警，不写入 `collected_entities`。
4. **`total_currency_count` 变更**（内容更新增币）：完成度分母动态取最新主数据总数；已解锁集合不受影响。
5. **云存档冲突**（未来）：以"并集"合并 `collected_entities`，不丢已解锁。

### ⑦ 平衡与难度
- 本系统无难度维度；解锁节奏由配对系统的难度分层间接决定（跨地区局更易遇到新币）。
- **支柱漂移检查**：解锁只来自配对，护照（未来）不提前发奖励，避免 MVP 范围泄漏。
- **经济**：收藏是进度非货币，无通胀/贬值概念，无经济失衡。

### ⑧ 验收标准
- [ ] 首次配对 (X, ff) → `collected_entities` 增实体，广播 `OnCurrencyUnlocked(iso, ff)`，图鉴对应形态槽剪影→实显。
- [ ] 同一 (X, ff) 再次配对 → 不重复解锁、不重复广播、计数不变。
- [ ] 同 ISO 不同 `form_factor` 视为不同实体，可分别首次解锁（coin/note 两槽独立）。
- [ ] S3/S5 无"加入收藏"按钮；未解锁条目不可读详情数据。
- [ ] `completion_pct_single`（按实体）、coin/note 单形态占比、区域完成度计算正确并驱动 Hub；`is_complete` 双形态完整收集判定正确。
- [ ] 事件丢失/重复/脏数据均有处理且不崩。
- [ ] 合规：全程无真实图样/国旗/真伪措辞。

---

## 3. 图鉴系统（Codex System）

### ① 目标 / 概述
图鉴（S3）是收藏的**展示与炫耀面**（美学层），也是文化学习的阅读入口。以「地区书架」组织已发现币种；已解锁条目显示完整数据 + 现实锚，未解锁显示剪影。点击已解锁条目进入 S5 货币详情（纯阅读）。本系统兑现"内容真实性"支柱，并通过「现实锚」闭环迁移识别。

### ② 核心机制
- **条目渲染**：每个币种一条 `CurrencyEntry`；因引入双物理形态，每条目含 **coin / note 两个形态槽**：
  - `form_slots = { coin: { unlocked, data }, note: { unlocked, data } }`（详见 §3.③）。
  - 某槽 `unlocked=false` → 显**灰色剪影 + "?"**，不显示真实内容；`unlocked=true` → 显示该形态完整数据。
  - 条目"已发现"（可点入 S5）条件 = 任一形态槽已解锁（`is_collected`，见 §2.③）；"完整收集" = 两槽均解锁（`is_complete`）。
- **区域双编码徽标位置**：区域徽标（圆角矩形/六边形/菱形，标记"洲"）固定显示在**角落小徽标**位置（尤其 note 长方牌的角落）；在 coin 圆牌上同样置于角落，但**须与卡片整体物理形态（圆/长方）严格区分**，不得让 `amer` 的 `rounded_rect` 徽标被误读为卡片形状。
- **地区书架组织**：按 `region` 分 3 架（美洲 / 欧洲 / 亚洲·非洲）；架内可再按 `motif_category` 或 `denomination_tier` 排序。每架显示「已收集 / 该架总数」进度（可按单形态或双形态口径切换）。
- **完成度统计**：全局 `completion_pct_single`（按实体）、`completion_pct_coin`、`completion_pct_note`；每架 `region_collected / region_total`；Hub 进度环消费此数据。
- **进入详情**：仅 `is_collected=true`（任一形态已解锁）条目可点入 S5；S5 纯阅读（见 §2.④）。

### ③ 状态与数据
**币种条目（CurrencyEntry，来自货币主数据 + 解锁态）**
| 字段 | 类型 | 说明（合规/迁移锚点） |
|------|------|------|
| `iso_code` | string(3) | 身份（红线 2，ISO 非国旗） |
| `name_zh` | string | 中文币种名，如"美元" |
| `region` | enum | `amer`/`euro`/`asia_afr` |
| `region_shape` | enum | `rounded_rect`/`hexagon`/`diamond` |
| `region_color` | hex | `#E0B15E`/`#5B8FB0`/`#87A878` |
| `signature_color` | hex | 锚定真钞主色的粉彩演绎（迁移锚点，不可偏色相） |
| `motif_symbol` | string | 母题符号描述（文本占位，如"圆章+放射星（人像类）"） |
| `motif_category` | enum | `portrait`/`architecture`/`animal`/`landscape` |
| `denomination` | string | 代表面额，如"100" |
| `denomination_tier` | 1\|2\|3 | 环数/尺寸/光泽层级 |
| `real_world_anchor` | obj | `{ real_dominant_color_name, real_central_motif, denom_hint }` 现实锚（§5 / 美术 §2.7） |
| `cultural_text` | obj | `{ child(≤60字), adult(≤200字) }` 文化/历史短文（分层） |
| `is_collected` | bool | 来自解锁系统（任一形态已解锁即 true） |
| `form_slots` | obj | `{ coin: {unlocked:bool, data}, note: {unlocked:bool, data} }` 双形态槽（§3.②）；未解锁槽显灰色剪影+"?" |

### ④ 规则与边界
- **未解锁槽 = 灰色剪影 + "?"**：单形态未解锁时，该形态槽显灰色剪影 + "?"，不显示其 `signature_color`/`motif_symbol`/`real_world_anchor`/`cultural_text`；仅已解锁形态槽渲染真实内容（见 §6.3 四层识别码）。
- **合规红线落点**：
  - 仅用 ISO 代码标识，禁用国旗（红线 2）。
  - 母题为风格化几何描述/符号，非真实钞币图样（红线 1）。
  - 若展示汇率（非 MVP），须同屏"仅供参考，非金融建议"（红线 3，见 §5）。
  - 文案禁投资/预测/交易/真伪措辞（红线 4）。
- **现实锚**属事实数据，落在"内容 100% 真实"支柱内，驱动 token↔真钞映射。

### ⑤ 与其他系统交互
- ← **收藏与解锁系统**：`is_collected` 与 `OnCurrencyUnlocked` 驱动剪影→实显。
- → **Hub（S1）**：供进度环 / 区域完成环。
- → **汇率与文化内容系统**：S5 详情读取 `real_world_anchor` 与 `cultural_text`；汇率展示（未来）读 §5 快照。
- → **进度与成就系统**：完成度供"满图鉴/地区全收集"判定。

### ⑥ 失败 / 异常处理
1. **条目字段缺失**（如 `cultural_text.child` 空）：显示"内容筹备中"占位，不空崩；记内容缺口。
2. **`signature_color` 非法 hex**：回退 `region_color`，记美术缺口（MVP 纯色块也需有效 hex）。
3. **内容更新致条目增删**：图鉴以主数据为准动态重建；已解锁态保留。
4. **点击未解锁条目**：拦截，不进 S5，或进 S5 仅显"未发现"占位。
5. **现实锚数据错**（色名与真钞不符）：内容审核 gate（§5）拦截入库。

### ⑦ 平衡与难度
- 图鉴本身无难度；其"难度"来自配对解锁进度。
- **认知过载检查**：地区书架 + 剪影渐进揭示，避免一次性展示全部币种；儿童默认看 `child` 短文，成人可切 `adult`。
- **支柱漂移检查**：图鉴只展示已解锁，不因"炫耀"提前泄露未解锁真实内容。

### ⑧ 验收标准
- [ ] 3 地区书架正确分组，每架显示进度；coin / note 双形态槽随各自 `unlocked` 切换剪影/实显。
- [ ] 已解锁形态槽显示全部字段（含现实锚、分层文案）；未解锁形态槽仅灰色剪影+「?」。
- [ ] 点击已解锁→S5 纯阅读；无"加入收藏"按钮。
- [ ] 完成度/区域完成度计算正确并供 Hub。
- [ ] 字段缺失/非法有兜底，不崩。
- [ ] 合规：无国旗、无真实图样、汇率展示（未来）带免责、文案无禁用词。

---

## 4. 进度与成就系统（Progress & Achievement System）

### ① 目标 / 概述
把收藏进度转化为可感知的目标与荣誉感（美学/动机层）。MVP **仅实现基础计数**（完成度、区域完成度，因其驱动 Hub/图鉴），**成就/徽章 MVP 不展示但本 GDD 完整定义**供后续阶段。成就不发放任何卡进度的奖励（避免经济失衡），仅为荣誉标识。

### ② 核心机制
- **进度计数**：`collected_isos` 长度、各区 `region_collected`、全局 `completion_pct`（定义见 §2.③）。
- **成就判定**：监听 `OnCurrencyUnlocked`、会话结算事件（`combo_max`/`mismatch_count`/`difficulty_tier`）、S5 浏览事件；对每枚徽章的 `trigger_condition` 谓词求值，满足则解锁 `achievements` 集合中的该 id。
- **幂等**：徽章以 id 去重，已得不再触发。

### ③ 状态与数据
**PlayerProfile 扩展**
| 字段 | 类型 | 说明 |
|------|------|------|
| `collected_isos` | iso_code[] | 来自 §2 |
| `achievements` | badge_id[] | 已得徽章（MVP 空集合/不展示） |
| `stats` | obj | `{ combo_max, flawless_sessions, t3_completed, motif_categories_seen:set, anchor_viewed_count }` |

**徽章定义表（完整定义，MVP 不实现展示）**
| badge_id | 名称 | 触发条件（谓词） | 层级 |
|----------|------|----------------|------|
| `first_light` | 初见 | `len(collected_isos) == 1` | 铜 |
| `amer_scholar` | 美洲通 | `region_collected[amer] == region_total[amer]` | 银 |
| `euro_explorer` | 欧陆漫游 | `region_collected[euro] == region_total[euro]` | 银 |
| `east_south` | 东方收藏家 | `region_collected[asia_afr] == region_total[asia_afr]` | 银 |
| `globetrotter` | 环球收藏家 | `len(collected_isos) >= 0.5 × total` | 金 |
| `codex_complete` | 满图鉴 | `len(collected_isos) == total` | 金 |
| `combo_master` | 连击大师 | `stats.combo_max >= 5`（单局） | 银 |
| `flawless` | 无瑕配对 | `stats.flawless_sessions >= 1`（0 错配完成一局） | 银 |
| `motif_hunter` | 风格猎人 | `motif_categories_seen` ⊇ {portrait,architecture,animal,landscape} | 金 |
| `patient_scholar` | 耐心学者 | `stats.t3_completed >= 1`（完成 T3 局） | 金 |
| `recognizer` | 现实辨认者 | `stats.anchor_viewed_count >= 10`（阅读现实锚） | 铜 |

### ④ 规则与边界
- **成就不发放进度奖励**：徽章仅为标识，不解锁币种、不给可消费代币（防经济失衡 / 支柱漂移）。
- **合规红线落点**：徽章命名与描述定位"教育/文化/探索"，禁用投资/收益/排行变现措辞；不出现国旗。
- **MVP 边界**：`achievements` 字段可预留，但 UI 不展示、不弹窗；`stats` 中 MVP 仅维护 `collected_isos` 相关计数。

### ⑤ 与其他系统交互
- ← **收藏与解锁**：`OnCurrencyUnlocked` 驱动 `first_light`/地区/满图鉴类。
- ← **配对玩法**：会话结算事件驱动 `combo_master`/`flawless`/`patient_scholar`。
- ← **图鉴/S5**：现实锚浏览事件驱动 `recognizer`。
- → **Hub（S1）/ 档案（S4）**：未来展示徽章墙（MVP 不接）。

### ⑥ 失败 / 异常处理
1. **谓词依赖字段缺失**（如 `region_total` 未算）：徽章暂不求值，待数据齐备后下一事件重试。
2. **成就定义变更**（增删 badge）：以 `badge_id` 稳定键迁移；旧 id 保留，新 id 追加。
3. **云存档合并**：`achievements` 取并集；`stats` 取上限（max）。
4. **触发风暴**：单事件满足多徽章 → 批量解锁，UI（未来）可合并提示，不重复写入。

### ⑦ 平衡与难度
- 成就构成"软目标梯度"：初见（易）→ 地区全收集（中）→ 满图鉴/风格猎人（难），契合元循环回访动机。
- **主导策略检查**：成就不提供进度捷径，无"刷分最优解"破坏收集元循环。
- **经济**：纯荣誉，无代币，无经济失衡。

### ⑧ 验收标准（MVP 部分 + 后续）
- [ ] MVP：`collected_isos` 长度、区域完成度、全局 `completion_pct` 正确计算并供 Hub/图鉴。
- [ ] 徽章定义表 11 枚完整、谓词可机器求值（后续阶段验收）。
- [ ] 幂等：重复事件不重复得章。
- [ ] 成就不发放任何进度/代币奖励。
- [ ] 合规：徽章文案无投资/收益/国旗措辞。

---

## 5. 汇率与文化内容系统（Exchange Rate & Culture Content System）

### ① 目标 / 概述
承载两类"真实内容"：(a) **静态每日汇率快照**（红线 3，须带"非金融建议"免责）；(b) **文化/历史文本**（红线 4，教育/文化定位，分层字数）。MVP **不展示汇率**（降范围，见 §6），但数据结构与免责嵌入点本 GDD 完整定义；文化文本是图鉴/S5 的核心内容，MVP 即需。

### ② 核心机制
- **汇率快照**：每日从后端/打包拉取一次静态快照，`snapshot_date` 标注日期；任何展示点同屏渲染免责声明。
- **文化文本分层**：每条目含 `child`（儿童简版 ≤60 字）与 `adult`（成人详版 ≤200 字）；按玩家分层偏好（默认按设备/设置）择一显示，可切换。
- **现实锚**：`real_world_anchor` 一行（≤40 字）点出真钞主导色名 + 中央母题，闭环迁移识别（美术 §2.7）。

### ③ 状态与数据
**汇率快照（ExchangeRateSnapshot，存储：打包 JSON + 可选每日后端刷新）**
| 字段 | 类型 | 说明 |
|------|------|------|
| `snapshot_date` | date(YYYY-MM-DD) | 快照日期 |
| `base_currency` | iso_code | 基准币（默认 `CNY`） |
| `rates` | map | `{ iso_code: number }` 相对基准 |
| `source` | string | 数据来源（静态参考） |
| `fetched_at` | datetime | 拉取时间 |
| `disclaimer` | const | `"仅供参考，非金融建议"` |

**文化文本 schema（CurrencyEntry 子集）**
| 字段 | 类型 | 字数上限 | 说明 |
|------|------|---------|------|
| `cultural_text.child` | string | ≤60 字 | 儿童：具体/趣味事实 |
| `cultural_text.adult` | string | ≤200 字 | 成人：历史/语境 |
| `real_world_anchor` | obj | ≤40 字(渲染) | `{real_dominant_color_name, real_central_motif, denom_hint}` |

### ④ 规则与边界
- **免责声明强制同屏**：任何汇率展示处（Hub 快照条 / S5 汇率区 / Splash）必须可见 `disclaimer`，不可折叠隐藏。
- **静态非实时**：快照每日一次，明确非实时、非金融建议；不提供"刷新/预测/走势"。
- **合规红线落点**：
  - 红线 3：静态快照 + 免责（本系统核心）。
  - 红线 4：文案禁投资/预测/交易/升值/贬值/建议买入等词；定位教育/文化；不拼真实纸币碎片、不做真伪区分。
- **文本审核 gate**：入库前正则扫描禁用词；命中则拦截，不进入 MVP/正式内容。

### ⑤ 与其他系统交互
- → **图鉴系统 / S5**：提供 `cultural_text`、`real_world_anchor`；汇率展示（未来）读 `rates` + `disclaimer`。
- → **Hub（S1）**：未来汇率快照条（含免责 micro-text）。
- → **Splash（S0）**：冷启动免责 micro 声明。
- ← **内容生产**：文策渊补全事实并核对（竞品分析风险 3：知识点须准确）。

### ⑥ 失败 / 异常处理
1. **汇率拉取失败 / 过期**：显示"汇率暂不可用"占位 + 免责仍可见；不展示旧率误导（或标注 `snapshot_date` 明确陈旧）。
2. **`rates` 缺某 ISO**：该币汇率区显示"—"，不报错。
3. **文化文本超字数**：入库 gate 拒绝，提示作者压缩（儿童 ≤60 / 成人 ≤200）。
4. **禁用词命中**：拦截入库，不进入任何展示。
5. **`snapshot_date` 缺失**：视为无效快照，不展示数值。

### ⑦ 平衡与难度
- 本系统无玩法难度；其"平衡"在于**信息量分层**——儿童不被长文压垮，成人有深度，符合"可亲文化学习"。
- **支柱漂移检查**：汇率/文化始终服务于教育，不演变为"投资参考"（禁用词 gate 保证）。

### ⑧ 验收标准
- [ ] 汇率快照结构完整，`snapshot_date`/`base`/`rates`/`disclaimer` 齐备（MVP 可不展示）。
- [ ] 任何汇率展示处同屏可见"仅供参考，非金融建议"。
- [ ] 文化文本 `child` ≤60 字、`adult` ≤200 字；现实锚 ≤40 字渲染。
- [ ] 禁用词 gate 拦截投资/预测/交易/真伪类措辞。
- [ ] 拉取失败/缺字段/超字数/禁用词均有处理，不崩、不误导。
- [ ] 内容事实经核对（后续阶段人工审核）。

---

## 6. MVP 垂直切片子集（Vertical Slice Scope）

> 目标：用最小可用原型验证核心循环，证明"配对→自动收藏→图鉴查看"成立。**不含成就系统展示、不含汇率内容展示。**

### 6.1 MVP 范围定义
**实现**：
1. **配对核心循环**：默认 3×4 网格（6 对），翻牌/配对判定/胜利（无失败态），连击得分（可选展示）。
2. **自动收藏（coin-mode）**：首次配对（`form_factor=coin`）→ 写入 `collected_entities`（`(iso_code, coin)`），图鉴 coin 槽剪影→实显。
3. **图鉴查看**：S3 地区书架 + S5 货币详情（纯阅读，无"加入收藏"按钮）。

**不实现（明确降范围）**：
- 成就/徽章 UI 与弹窗（定义保留于 §4，MVP 不展示）。
- 汇率内容展示（结构保留于 §5，MVP 不接 Snapshot 展示）。
- 旅行护照（Hub 内 teaser 占位即可）。
- T2/T3 难度、跨地区"环球"局（MVP 仅 T1 单地区 3×4，可预置 1–2 个地区书架演示）。

### 6.2 MVP 最小数据表结构（币种字段）
| 字段 | 类型 | 示例 | 说明 |
|------|------|------|------|
| `iso_code` | string(3) | `USD` | ISO 4217 身份（红线 2） |
| `region` | enum | `amer` | 驱动区域双编码形状/色 |
| `signature_color` | hex | `#4E7A6B` | 锚定真钞主色的粉彩（迁移锚点） |
| `motif_symbol` | string | `"圆章+放射星（人像类）"` | 母题符号**文本描述**（MVP 占位美术） |
| `motif_category` | enum | `portrait` | 母题类别 |
| `denomination` | string | `"100"` | 代表面额 |
| `denomination_tier` | int(1-3) | `2` | 面额层级（环数/尺寸） |
| `grid_config` | ref | `"T1_3x4"` | 该币种所属会话模板（MVP 默认 3×4） |

**玩家状态（MVP 最小）**：`collected_isos: iso_code[]`（localStorage 持久化）。

### 6.3 「四层识别码」占位美术契约（工程可读规范）
即使无美术、仅纯色块+文字，也必须保证它是"货币图鉴"而非通用记忆游戏。卡片渲染**严格依赖以下 4 层**，且层间信息冗余、不依赖单一通道。

**字段 → 渲染层映射（优先级 = 渲染顺序/显著度）**
| 优先级 | 层 | 来源字段 | 渲染为 | 取值 | 依赖颜色？ |
|--------|----|----------|--------|------|-----------|
| 1（基底） | ① 形状层（大洲） | `region_shape` | 卡面外框/轮廓形状 | `rounded_rect`(美洲) / `hexagon`(欧洲) / `diamond`(亚洲·非洲) | **否**（靠轮廓） |
| 2（填充） | ② 母题色层（币种气质） | `signature_color` | 卡填充/母题填充色 | hex（锚定真钞主色） | 是（① 形状兜底） |
| 3（层级） | ④ 面额层（层级） | `denomination_tier` + `denomination` | 环数(1/2/3) + 尺寸 + 数字 | tier 1/2/3；数字串 | **否**（靠数量/字） |
| 4（权威） | ③ ISO 码层（无歧义身份） | `iso_code` | 左上徽标带文本 | 3 字母，如 `USD` | **否**（靠文字） |

**渲染契约规则（工程须遵守）**
1. **配对判定键 = `iso_code`**（③），与美术无关；同 ISO 即配对。
2. **四层必须同时可解码**：开启色弱模式（② 置灰/中性）时，①+③+④ 仍 100% 辨识——这是契约的硬约束（合规 + 儿童 + 色弱友好）。
3. **MVP 纯色块+文字实现**：
   - ① 形状：CSS `clip-path` / SVG polygon 画 rounded_rect/hexagon/diamond 作卡外框。
   - ② 填充：`signature_color` 实心填充卡面。
   - ④ 面额：卡内画 `denomination_tier` 个环（CSS border 圆 / 点）+ 显示 `denomination` 数字。
   - ③ ISO：左上角高对比文本徽标（深墨 `#3A3A38` on 奶油 `#F8F5F0`，≥ WCAG AA）。
4. **视觉即身份**：因形状编码大洲、色编码币种气质、ISO 编码身份、面额编码层级——任一通用记忆游戏无此四元组，故天然是"货币图鉴"。
5. **合规锁定**：四层全部来自风格化数据，绝不引用真实钞币图样/国旗；`region` 用区域双编码而非国旗。
6. **第 5 视觉轴 = 物理形态（卡片整体形状）**：coin-mode 整体为圆牌（圆形/圆角方）、note-mode 整体为横向长方牌（≈2:1）。此轴是**卡片整体外轮廓**，独立于 ① 区域形状层（① 是卡面内标记"洲"的轮廓/角标）。务必区分：区域双编码徽标（圆角矩形/六边形/菱形）落在卡片角落，不得被误读为卡片整体形状（尤其 `amer` 的 `rounded_rect` 角标 ≠ 圆牌）。

**MVP 验收（本契约）**
- [ ] 卡片同时呈现 ①形状 ②色 ③ISO ④面额 四层。
- [ ] 置灰②后，靠①③④仍可区分任意两币。
- [ ] 配对仅靠 `iso_code` 成功/失败。
- [ ] 无真实图样/国旗/真伪措辞。

### 6.4 双形态（Form Factor）MVP 范围与扩展项
- **当前 MVP 仅为 coin-mode**：卡片用方块令牌近似圆牌（MVP 不强制圆形渲染），竖屏 3×4（T1）；解锁实体为 `(iso_code, coin)`，图鉴仅填 coin 槽。note-mode 与强制横屏为**后续构建项**，由 engineering-lead 在 **TASK-MVP-NOTEMODE** 扩展。
- **MVP 已预留、尚未启用**：§0.5 的 `form_factor` 枚举与 note-mode 布局常量（`NOTE_GRID_COLS`/`NOTE_GRID_ROWS`/`NOTE_CARD_RATIO`/`NOTE_ORIENTATION`）已写入 GDD，供后续直接引用。
- **MVP 扩展到 note-mode 需新增 / 改动字段**：
  1. `SessionConfig.form_factor`（会话物理形态；MVP 恒为 `coin`，note-mode 可置 `note`）。
  2. 横屏布局：note-mode 强制 `landscape` 朝向 + `4×4` 横向宽牌网格（卡片 ≈2:1）。
  3. 双形态解锁：`collected_entities` 由 `(iso_code, coin)` 扩展支持 `(iso_code, note)`；图鉴条目增 `form_slots` 双槽，未解锁槽显灰色剪影+"?"。
  4. 区域徽标固定角落位置（与卡片整体形态区分，`amer` 圆角矩形徽标不得误读为卡片形状）。
  5. 完成度口径：`completion_pct_single`（按实体）与 coin/note 单形态拆分统计。
- 合规红线（禁用真实钞币图、ISO 标识、MVP 无汇率）在 coin/note 两形态下均不变。

---

## 7. 跨系统一致性 & 风险登记（摘要）

### 7.1 一致性约定
- **身份唯一键**：全系统以 `iso_code` 为币种身份，禁止用国旗/图像标识。
- **解锁唯一路径**：仅「首次成功配对」→ §2 状态机 → `collected_entities`（实体键 `(iso_code, form_factor)`；`collected_isos` 为派生币种集合）。
- **完成度唯一源**：按实体 `len(collected_entities) / (total_currency_count × 2)`（`completion_pct_single`）；并支持 coin/note 单形态拆分；Hub/图鉴/档案共用。
- **合规贯穿**：红线 1–4 在 §1–§5 ④/⑧ 及 §6.3 均有落点。

### 7.2 风险登记（需主理人/用户决策）
- **R1（布局）**：T3=6×6（18 对）在竖屏微信的最小可点尺寸/是否滚动，需程基岩评估；MVP 固定 3×4 规避。
- **R2（地区划分）**：美术策略将亚洲·非洲合并为同一双编码（菱形+绿）。图鉴书架按 3 架（amer/euro/asia_afr）还是拆 4 架（亚/非分列）？建议先 3 架保一致，未来可亚非内子分组——**待主理人拍板**。
- **R3（挑战/计时模式）**：MVP 无计时（红线/无体力）。未来"限时挑战"是否引入？须确保不卡进度、不惩罚、广告不绑定——**待主理人决策，且需合规复核**。
- **R4（内容准确性）**：文化/历史/现实锚须事实核对（竞品风险 3）；MVP 内容量小，建议先由文策渊核对首批币种再入库。

---
> 合规声明：本 GDD 所有视觉标识均来自风格化原创数据（四层识别码），非任何真实钞币的复制或近似再现；文化知识点须由文策渊补全并核对事实后入库。
