# 未来版本路线图 · Future Versions Roadmap

> 文档类型：扩展路线规划（分阶段）
> 项目：微信小游戏《货币图鉴·对对碰》
> 作者：文策渊（Vince Coyer）· 游戏设计 + 叙事
> 日期：2026-07-29
> 依赖：`src/core/types.ts`、`src/core/deck.ts`、`src/core/collectionStore.ts`、`src/core/matchLogic.ts`、`design/gdd/system-gdd.md`、`design/art/currency-stylization-strategy.md`

---

## ⚠ 合规铁律（贯穿所有未来版本）

1. **绝不出现真实钞币/硬币图像、国旗图案**；所有美术走 Seedream 风格化原创几何生成（见 `seedream-pipeline.md` / `currency-stylization-strategy.md`）。
2. **国旗元素如需进游戏，只能走「风格化 / ISO 代码呈现」**：可用"区域色条 + ISO 文本"或抽象三角旗几何，绝不使用任何国家的真实国旗图形、国徽精确造型。
3. **参考（reference）仅存 URL，不下载图片二进制**（同 `currency-reference-dataset.md` 边界）。
4. **货币身份一律用 ISO 4217 代码**，弱化/不用国旗；解锁、配对、图鉴全链路以 ISO 为唯一身份键。
5. 任何新文案仍过 `system-gdd.md §5` 的禁用词 gate（禁投资/预测/交易/真伪措辞）。

---

## 0. 现状基线（MVP，作为路线起点）

| 维度 | 现状（来自代码与 GDD） |
|------|----------------------|
| 识别码 | **四层识别码**（① 区域形状 `region_shape` ② 母题色 `signature_color` ③ ISO 码 `iso_code` ④ 面额 `denomination_tier`+数字），见 `system-gdd.md §6.3` |
| 解锁键 | `UnlockKey = entityKey(iso, form) = iso + '_' + form`（`deck.ts`），即 `(iso_code, form_factor)` 二元键（`types.ts` / `collectionStore.ts`） |
| 配对判定 | `matchLogic.evaluate` 比较 `a.iso === b.iso`，每 ISO 每局恰 2 张（`deck.buildDeck` 双推 + Fisher–Yates 洗牌；`validateDeck` 校验） |
| 形态 | `form_factor ∈ {coin, note}`（第 5 视觉轴，卡片整体外轮廓） |
| 内容 | 8 币种 × 2 形态 = 16 实体；`collectionStore.progress()` 分母 = `total×2` |
| 屏幕 | S1 Hub（收藏册）/ S2 配对棋盘 / S3 图鉴 / S4 档案 / S5 货币详情 |
| 内容资产 | `currency-reference-dataset.md/.json`（本路线图的"内容核心资产"） |

> 下列 v1.1 / v1.2 / v2 均在**不破坏 MVP 四层识别码与 `iso` 配对键**前提下增量扩展。所有改动遵循"向后兼容：旧 (iso, form) 实体依旧有效"。

---

## 1. 两个扩展方向的架构命题

### 方向 A：多类元素匹配（multi-element matching）
引入 **国旗、国名、货币上的人物、风景、动物** 作为可配对/可收集元素。这要求：
- **解锁键从二元扩展为多维**：`(iso, form_factor)` → `(iso, form_factor, element_type[, element_ref])`。
- **四层识别码增加第 ⑤ 层（元素层）**：在卡片角落增加一枚"元素徽标"（person / landscape / animal / country_name / flag），与既有的区域形状徽标、ISO、面额并列。

### 方向 B：世界地图棋盘（world-map board）
把货币/元素放到对应国家地理位置的棋盘上，对对碰/消消乐在地图上进行。这要求：
- **数据层先标注经纬度**（不动渲染）；
- **再上地图渲染层**（风格化大陆，非精确政治边界）；
- **最后上棋盘玩法**（地图定位的卡牌布局，复用 `matchLogic`）。

---

## 2. 分阶段路线图

### ▸ MVP（已定基线，非本次新增）
- 目标：验证"配对→自动收藏→图鉴查看"核心循环。
- 涉及系统：配对玩法、收藏解锁、图鉴、4 层识别码、coin-mode。
- 衔接点：后续所有版本以此为准绳（ISO 配对键、四层码、实体进度模型）。

---

### ▸ v1.1 — 多元素内容扩展（Multi-element Content）

**目标**
把"货币"从一个实体扩展为一族**元素实体**：在保留 `currency` 锚定的同时，新增 `person`（人物）、`landscape`（风景）、`animal`（动物）、`country_name`（国名）四类可配对/可收集元素。本阶段**暂不含 flag**（国旗风险最高，留到 v1.2 与地图一起严肃处理）。

**涉及系统**
- `core/types.ts`：新增 `ElementType = 'currency' | 'person' | 'landscape' | 'animal' | 'country_name'`，并在 `Card` 增加 `elementType: ElementType` 与可选 `elementRef?: string`（如人物名/动物种）。
- `core/deck.ts`：
  - 解锁键改为 `entityKey(iso, form, elementType, elementRef?)`（多维键；保留旧 2 参重载以兼容 MVP）。
  - `buildDeck` 接受"元素配方"，按 (iso, form, elementType) 各推 2 张（保持"每实体每局恰 2 张"不变量）。
- `core/matchLogic.ts`：
  - `evaluate` 改为接受 `matchKeyOf(card): string` 注入函数，而非硬编码 `a.iso === b.iso`。
  - **v1.1 默认 `matchKeyOf = 实体全键`**（同实体才配对，最低风险）；为 v1.2/v2 的"跨元素关联配对"预留 `matchKeyOf = (iso, form)` 模式。
- `core/collectionStore.ts`：`unlock(iso, form, elementType, elementRef?)`；进度分母改为 `contentManifest` 枚举的"实体总数"（币种×形态×元素类）。
- 渲染层（card/hub/codex）：卡片增加 **⑤ 元素层徽标**（一枚小几何图标：人像=圆章、风景=三角山、动物=爪/羽、国名=ABC）；图鉴条目的 `form_slots` 扩展为 `element_slots`。
- 内容：`currency-reference-dataset.json` 已含 person/landscape/animal 母题（多数币种正反面已天然区分这些类别），可直接抽取生成元素母题。

**与现有架构衔接点**
- 四层识别码 → 五层（加元素层），旧四层不变，`region_shape`/`signature_color`/`iso`/`denom` 全部保留。
- 配对键从 `iso` 升级为"可注入的 matchKey"，`matchLogic` 纯函数结构不变，`validateDeck` 不变量不变。
- 解锁幂等、进度模型、S3/S5 读数据方式不变，只增字段。

**合规注意点**
- `person` = 人像圆章（不画脸），沿用现有母题纪律；`animal` = 极简剪影；`landscape` = 几何山形/景物；`country_name` = 国家名文本 + 区域色（不出现国旗）。
- 仍无任何真实钞币图、无国旗；新增元素母题一律风格化 AI 生成。
- 文案继续过禁用词 gate。

---

### ▸ v1.2 — 国旗（风格化）+ 世界地图棋盘（数据与渲染）

**目标**
(1) 谨慎引入 **flag 元素**，但**仅以风格化/ISO 呈现**（区域色条 + ISO 文本，或抽象三角旗几何），绝不用真实国旗；(2) 落地**世界地图棋盘的数据层与渲染层**（先把货币/元素钉到国家地理位置，先不做地图内玩法）。

**涉及系统**
- 内容/数据：新增 `geoManifest`（`iso → { lat, lng, country_iso2?, anchor_note }`），为 8 币种标注代表经纬（如 USD≈华盛顿、CNY≈北京、JPY≈东京、INR≈新德里、ZAR≈比勒陀利亚、BRL≈巴西利亚、GBP≈伦敦；**EUR 多国，定为代表锚点如法兰克福 ECB，需主理人拍板**）。
- `core/types.ts`：`ElementType` 增加 `'flag'`；`geoManifest` 类型入库。
- 地图渲染层（新增 `render/mapBoard.ts` 或 S2 子模式）：绘制**风格化大陆轮廓**（blobby continents，非精确国界），按 `geoManifest` 在近似位置放令牌/图钉；令牌复用既有四层+⑤元素层渲染。
- Hub（S1）：新增「环球地图」入口/书架，从 Hub CTA 或区域书架下钻进入地图模式。
- flag 母题管线：Seedream 提示词仅生成"抽象色条/三角旗几何 + 区域色"，**负向词强制 `no flag, no national emblem`**；以 ISO 文本叠加代替国名图形。

**与现有架构衔接点**
- 地图只是 **Board（S2）布局提供方**的一种：`LayoutProvider` 抽象出 `GridLayout`（现有 4×4）与 `MapLayout`（地图定位）；`matchLogic` 仍对 `Card[]` 纯函数运作，**完全不动**。
- 解锁键扩展为 `(iso, form, elementType, elementRef?)`，flag 实体即 `(iso, form, 'flag')`；复用 v1.1 的多维键与进度分母。
- Codex（S3）增加"地图视图"显示已解锁图钉（仅 ISO + 风格化色，无真实地图边界）。

**合规注意点（重点）**
- **国旗红线**：flag 元素**只能用风格化/ISO 代码呈现**——区域色条 + ISO 文本，或抽象三角旗几何；**任何真实国旗图形、国徽精确造型一律禁止**（双红线：版权/反假币 + 微信审核 + 政治敏感）。
- 地图用**风格化大陆轮廓**，不画精确政治边界、不叠加国徽/真实国旗；令牌本身已合规（四层码 + 元素层）。
- EUR 多国锚点需明确（避免地图钉错位引发"偏向某国"争议）。
- 参考仍仅存 URL，不下载图像。

---

### ▸ v2 — 地图玩法成熟（Map Gameplay Maturity）

**目标**
地图棋盘成为完整玩法：在地图上进行对对碰/消消乐；支持**跨元素关联配对**（如 currency 卡 ↔ 其 flag 卡 ↔ 其 person 卡）；Codex 含地理视图与"旅行/路线"元循环。

**涉及系统**
- `core/matchLogic.ts`：正式启用 `matchKeyOf` 的多模式——
  - `same-entity`（默认，同实体 2 张）；
  - `association`（同 `(iso, form)`，跨 element_type 配对，如 USD-currency 配 USD-flag）；
  - `pure-element`（同 `(elementType, elementRef)`，如两枚 USA-flag 配对）。
- 地图交互（新增）：点按图钉翻牌、邻近/同国高亮、可选"路线"连击奖励；仍**无失败态、无计时**（守住"轻松无限"支柱）。
- Codex（S3/S5）：地理视图 + 元素槽全展开；成就系统（MVP 已留 11 枚徽章定义）可接"环球收藏家""风格猎人"等。
- 内容：随元素类增长，`contentManifest` 自动扩分母；新币种可增量追加（同 `currency-reference-dataset` 流程）。

**与现有架构衔接点**
- Hub（S1）→ 提供「环球地图」模式；Board（S2）= `MapLayout` + `matchLogic`（matchKey 注入）；图鉴/档案读取解锁态不变。
- 所有 v1.1/v1.2 的层（四层 + ⑤元素层、多维解锁键、geoManifest、LayoutProvider）在此**自然组合**。
- 进度分母 = 实体总数（币种×形态×元素类），`collectionStore.progress()` 已支持动态总数。

**合规注意点**
- 在更大内容规模下重申：flag 永远风格化/ISO；地图永远风格化大陆；所有母题 AI 生成；参考仅 URL。
- 成就/路线文案定位"教育/探索"，禁投资/收益措辞（对齐 GDD §4 红线）。
- 内容事实核对：新增 researched 事实过 `real-world-anchors.md` 式的事实 gate（R4 风险）。

---

## 3. 关键架构改动清单（汇总）

| 改动点 | 文件/系统 | MVP | v1.1 | v1.2 | v2 |
|--------|-----------|-----|------|------|----|
| 识别码层数 | 渲染/契约 | 4 层 | **5 层**（+元素层） | 5 层 | 5 层 |
| 解锁键 | `deck.entityKey` / `collectionStore` | `(iso, form)` | `(iso, form, elementType, elementRef?)` | 同 v1.1 + flag | 同 |
| 配对判定 | `matchLogic.evaluate` | `a.iso===b.iso` | 注入 `matchKeyOf`（默认全实体键） | 同 | 多模式（same/association/pure-element） |
| 内容分母 | `collectionStore.progress` | 币种×2 | 币种×形态×元素类 | 同 + flag | 同 |
| 地理数据 | 新增 `geoManifest` | — | — | ✅ 经纬度 | ✅ |
| Board 布局 | `buildDeck`/`LayoutProvider` | `GridLayout` | `GridLayout` | `GridLayout`+`MapLayout` | `MapLayout` 主玩法 |
| flag 元素 | — | — | 不含 | ✅（风格化/ISO 仅） | ✅ |
| 地图渲染 | — | — | — | ✅ 风格化大陆 | ✅ 交互玩法 |

---

## 4. 数据缺口 / 待主理人决策（Risk & Open Questions）

- **R1（EUR 多国锚点）**：EUR 为跨国家电网币，地图钉应选代表锚点（建议法兰克福 ECB 或欧元区几何中心）——**需主理人拍板**。
- **R2（flag 呈现细则）**：v1.2 的"风格化国旗"最终形态（区域色条+ISO vs 抽象三角旗）需与美术（林绘澄）对齐 Seedream 提示词。
- **R3（coin 母题缺口）**：本 ship 的 8 个面值绝大多数无对应面值流通硬币（$100/€20/¥1000/₹100/R$10/R10 均无），游戏 coin 令牌为抽象；若未来要做"真实硬币母题"扩展，需另做硬币调研（不阻塞当前路线）。
- **R4（历史母题精度）**：本资料集对个别前代反面母题（如 INR 旧 MG 系列 ₹100 反面、BRL 第一家族 R$10 反面动物）仅给到"系列级"描述，未断言精确母题；若要做"同币历史演变"深度内容，建议补研这两处。
- **R5（跨元素配对难度）**：v2 的 association/pure-element 配对会改变"每 ISO 恰 2 张"的棋盘约束，需在 `buildDeck` 引入"配对组"概念（一组 = 2 张可配对卡，组内可跨 element_type）——建议 v1.1 即预留 `PairGroup` 数据结构。
- **R6（区域划分 R2 沿用）**：GDD R2（亚洲·非洲是否拆 4 架）仍待主理人决策；地图落地后此问题自然缓解（按真实地理位置分布）。

> 合规声明：本路线图全部美术走风格化原创几何（Seedream AI 生成），不复制真实钞币/硬币/国旗；参考仅存 URL，不下载图像；货币身份一律 ISO 4217。
