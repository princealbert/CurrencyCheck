# Seedream（火山引擎）母题提示词管线 + 合成规范 + 合规护栏

> 文档类型：美术生产手册（给「持火山引擎密钥、直接调 Seedream 出图」的用户）
> 项目：微信小游戏《货币图鉴》· 对对碰货币配对
> 作者：林绘澄（art-director）· 美术方向 + 技术美术 + 资产规格 + 可访问性
> 日期：2026-07-27
> 状态：可执行（待主理人 游承峰 审批）
> 依赖：
> - `design/content/real-world-anchors.md`（文策渊核过的真钞锚点事实 + 签名色修正表）
> - `design/art/currency-stylization-strategy.md`（v2 四层识别码 / 漫画式保真）
> - `docs/architecture/cocos-port-plan.md`（资产 z-order：母题 Sprite 在下，代码层在上）
> - `design/gdd/system-gdd.md`（form_factor 维度 / 合规红线 1–4）
> 引擎：Cocos Creator 3.x（TypeScript）· 导出微信小游戏
> 美术分工：**Seedream 出「母题质感层」（符号化、锚定真钞主色、透明底）；区域形状 / ISO / 面值由 Cocos 代码叠加**。

---

> ## ⚠ 合规底线（置顶醒目声明）
> **母题必须符号化 / 几何化，不得写实复刻任何真实纸币或硬币图样。** 这是版权 + 反假币 + 微信审核三重红线，是本项目不可逾越的边界。Seedream 提示词一律走「几何 primitive ≤ 4、扁平单色、无五官无真实建筑照片无雕版」的化简路径；所有 hex 为锚定真钞主色相的**粉彩化重演绎**，非原票复制。母题类别（人像/建筑/动物/景观）必须对应真钞真实存在的中央母题类别，但**一律符号化表达**。

---

## 1. 总原则

北极星指标 **迁移识别（transferable recognition）**：玩家在现实里见到真钞/真币能认出。Seedream 母题美术服务于这一北极星——**符号化呼应真钞中央母题类别、色彩锚定真钞主导色相**，但**绝不直接复制真实纸币/硬币图样**。

四条铁律：

1. **符号化呼应真钞中央母题**：母题类别（portrait / architecture / animal / landscape）必须对应真钞上真实存在的中央母题（人像/建筑/动物/景观），让玩家现实里见到该母题能触发记忆；但一律几何化简，不写实。
2. **色彩锚定真钞主导色相（hue-lock）**：Seedream 主色相 = 真钞主导色的粉彩化重演绎，色相不可偏移（偏移即串币、破坏迁移识别）。具体取值用 `real-world-anchors.md §3` 的**修正后签名 hex**（见 §3.0），不要沿用 `data.js` 占位错色。
3. **绝不直接复制真实钞币图样**：无写实人像五官、无可辨识真实建筑照片、无真实雕版渐变/肖像灰度、无水印/安全线/全息。
4. **无国旗、无真实文字/面额**：国旗、文字、数字、ISO 码、面额一律不进 Seedream 图（由 Cocos 代码叠加，见 §5）。母题图是纯符号质感层。

---

## 2. 资产规格

### 2.1 命名规范（铁律，接入校验用）

格式：`cur_<ISO>_<denom>_<region>_<form>.png`（`form ∈ {coin, note}`）

- `<ISO>`：3 字母 ISO 4217（大写）
- `<denom>`：代表面额数字（见 §3 各币**修正后** denom）
- `<region>`：`amer` / `euro` / `asia_afr`（与 GDD §0.5 一致）
- `<form>`：`coin` / `note`

> 示例：`cur_USD_100_amer_coin.png`、`cur_CNY_100_asia_afr_note.png`、`cur_EUR_20_euro_coin.png`

### 2.2 画布与尺寸（@2x 导出）

| form | 名义画布 | **实际导出（@2x）** | 构图 |
|------|---------|-------------------|------|
| coin | 512 × 512 | **1024 × 1024** | 圆形母题居中方形画布 |
| note | 1024 × 512 | **2048 × 1024** | 横幅母题占 2:1 画布中部色带，两端留透明 |

- **格式**：PNG-24 **RGBA，强制透明背景**（alpha 通道必须干净，无底色填充）。
- **颜色空间**：sRGB；母题主色用 §3 修正签名 hex；单主色 + 最多 1 道 accent 描边（深墨 `#3A3A38`）。
- **母题占比**：coin 母题居中方形画布中部（留给 Cocos 圆形令牌裁切，四角透明）；note 母题占 2:1 横幅中部约 60% 宽色带，左右各约 20% 留透明供代码放区域徽标/ISO/面值。

### 2.3 每币种资产数量

原 8 币种 × 2 形态 = **16 个 PNG**（见附录 A）。
关卡扩展后新增 10 币种 × 2 形态 = **20 个 PNG**（见附录 A-2 + `design/art/new-currency-motif-prompts.md`）。
**当前资产总数：18 币种 × 2 形态 = 36 个 PNG。**

---

## 3. Seedream 提示词模板（8 币种）

### 3.0 颜色锚定说明（关键）

- **Seedream 主色填「修正签名 hex」**（来自 `real-world-anchors.md §3 签名色修正表`），即粉彩化、卡在 Soft Blur Pastel 信封内、色相锚定真钞主色的值。**不要**用 `data.js` 占位错色（如 BRL 占位绿、INR 占位橙红、ZAR 占位蓝灰、EUR/GBP 错面值色）。
- **真实主导色 hex**（如 USD 真绿 `#2E6B40`、CNY 真红 `#C3272D`）仅作「现实锚」事实溯源参考，**不作为 Seedream 填充色**——直接用饱和真色会冲出 pastel 信封、与品牌调性冲突。本手册在每币种附「真实主导色」仅供核对母题色相锚点。
- **euro 区异色相纪律**：EUR = 蓝 `#4A6E8A`、GBP = 紫 `#6A5B8A`，两通道在 euro 区内必须可辨（见 §3 修正注）。

### 3.1 模板骨架（每币种填空）

**正向提示词（英文为主，建议英文）**
```
Stylized symbolic motif of [中央母题几何实例], flat geometric, [修正签名 hex] dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, [centered circular composition for coin / horizontal banner composition for note].
```

**负向提示词（每币种必含，可加动机专属项）**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, [动机专属负向，如 no human face / no realistic animal / no real building photo]
```

> 批处理建议：每个 (iso, form) 生成 4 张候选，人工挑 1 张过 §6 护栏后入包。

---

### 3.2 USD · 美元

| 项 | 值 |
|----|----|
| region / denom（修正后） | `amer` / `100` |
| motif_category | `portrait`（本杰明·富兰克林，非总统） |
| 中央母题实例（符号化） | 同心圆章 + 放射星几何 + 币种首字母负空间（**不画脸**） |
| 修正签名 hex | `#4E7A6B`（海绿，锚定 greenback 绿，**与 data.js 一致，保留**） |
| 真实主导色（溯源参考，不填充） | 绿 `#2E6B40` |

**正向**
```
Stylized symbolic motif of a concentric medallion emblem with radial star geometry and an abstract initial-letter negative space, evoking a historic portrait without showing a face, flat geometric, #4E7A6B sea-green dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, [centered circular composition for coin / horizontal banner composition for note].
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no human face, no realistic portrait, no detailed engraving.
```

---

### 3.3 BRL · 巴西雷亚尔

| 项 | 值 |
|----|----|
| region / denom（修正后） | `amer` / `10` |
| motif_category | `animal`（绿翅金刚鹦鹉 *Ara chloropterus*，背面母题；正名为金刚鹦鹉，**非**大嘴鸟/toucan） |
| 中央母题实例（符号化） | 金刚鹦鹉极简负空间剪影（2–3 条 essential 曲线压成纯色块） |
| 修正签名 hex | `#C77B7B`（灰玫红；data.js 占位绿 `#5B8A72` 色相完全偏离，**须改红**） |
| 真实主导色（溯源参考） | 深红/绯红 `#B3201F` |

**正向**
```
Stylized symbolic motif of a scarlet macaw parrot rendered as a minimal negative-space silhouette with two or three essential curves, flat geometric, #C77B7B dusty rose-red dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, [centered circular composition for coin / horizontal banner composition for note].
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed feathers, no realistic animal, no toucan.
```

---

### 3.4 EUR · 欧元

| 项 | 值 |
|----|----|
| region / denom（**修正：50→20**） | `euro` / `20` |
| motif_category | `architecture`（文艺复兴式窗/桥，虚构建筑） |
| 中央母题实例（符号化） | 拱券 + 桥几何剪影（半圆 + 梯形 primitives） |
| 修正签名 hex | `#4A6E8A`（石板蓝；锚定 €20 蓝，**保留**） |
| 真实主导色（溯源参考） | €20 = 蓝（注：data.js 原写 denom 50 橙，与签名蓝矛盾 → 按锚点 doc §3.1 改为 denom 20） |

> **⚠ denom 修正说明**：`data.js` 原 `denom=50`（橙）与占位签名蓝 `#4A6E8A`（锚 €20）互相矛盾。锚点 doc §3.1 推荐方案 = **denom 50→20**，保留 v2 策略原蓝签名，且避免与 GBP 在 euro 区撞色。故本管线 EUR 用 `denom=20`，命名 `cur_EUR_20_euro_*.png`。如坚持 €50（流通量最大），签名须改 `#D99A6C` 粉橙——但会与 GBP 同区撞橙，不推荐。

**正向**
```
Stylized symbolic motif of a Renaissance-style window-arch and bridge geometric silhouette built from semicircle and trapezoid primitives, flat geometric, #4A6E8A slate-blue dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, [centered circular composition for coin / horizontal banner composition for note].
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no real building photo, no euro symbol.
```

---

### 3.5 GBP · 英镑

| 项 | 值 |
|----|----|
| region / denom（**修正：10→20**） | `euro` / `20` |
| motif_category | `portrait`（£20 = 画家透纳 JMW Turner；若保留 £10 则为作家简·奥斯汀） |
| 中央母题实例（符号化） | 同心圆章 + 抽象画意放射几何（**不画脸**） |
| 修正签名 hex | `#6A5B8A`（柔紫；锚定 £20 紫，**保留**） |
| 真实主导色（溯源参考） | £20 = 紫（注：data.js 原写 denom 10 橙，与签名紫矛盾 → 按锚点 doc §3.1 改为 denom 20） |

> **⚠ denom 修正说明**：`data.js` 原 `denom=10`（橙）与占位签名紫 `#6A5B8A` 不符。锚点 doc §3.1 推荐 = **denom 10→20**（£20 紫、透纳，最常用的现代英钞之一），紫色签名即正确，且与 EUR 蓝在 euro 区异色相。故本管线 GBP 用 `denom=20`，命名 `cur_GBP_20_euro_*.png`。如保留 £10（奥斯汀），签名须改 `#D0986E` 陶橙——但会与 EUR 同区撞橙，不推荐。

**正向**
```
Stylized symbolic motif of a concentric medallion emblem with abstract painterly radial geometry evoking a historic portrait without showing a face, flat geometric, #6A5B8A muted purple dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, [centered circular composition for coin / horizontal banner composition for note].
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no human face, no realistic portrait, no royal crown emblem.
```

---

### 3.6 CNY · 人民币

| 项 | 值 |
|----|----|
| region / denom（修正后） | `asia_afr` / `100` |
| motif_category | `portrait`（毛泽东人像，正面中央） |
| 中央母题实例（符号化） | 同心圆章 + 放射星几何 + 币种首字母负空间（**不画脸**） |
| 修正签名 hex | `#C75D4F`（暖绯红，锚定 ¥100 红票，**与 data.js 一致，保留**） |
| 真实主导色（溯源参考） | 红 `#C3272D` |

**正向**
```
Stylized symbolic motif of a concentric medallion emblem with radial star geometry and an abstract initial-letter negative space, evoking a historic portrait without showing a face, flat geometric, #C75D4F warm rose-red dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, [centered circular composition for coin / horizontal banner composition for note].
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no human face, no realistic portrait, no detailed engraving.
```

---

### 3.7 JPY · 日元

| 项 | 值 |
|----|----|
| region / denom（修正后） | `asia_afr` / `1000` |
| motif_category | `landscape`（背面：富士山 + 樱花；正面为人物肖像，本币取景观母题作符号锚） |
| 中央母题实例（符号化） | 富士山三角山形 + 几点樱花点（negative-space 极简） |
| 修正签名 hex | `#6E97A3`（青灰，锚定 ¥1000 空色蓝，**与 data.js 一致，保留**） |
| 真实主导色（溯源参考） | 蓝 `#4A90C2` |

**正向**
```
Stylized symbolic motif of Mount Fuji as a flat triangular mountain silhouette with a few cherry-blossom dot accents in negative space, flat geometric, #6E97A3 muted sky-blue dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, [centered circular composition for coin / horizontal banner composition for note].
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no realistic landscape photo, no real portrait.
```

---

### 3.8 INR · 印度卢比

| 项 | 值 |
|----|----|
| region / denom（修正后） | `asia_afr` / `100` |
| motif_category | `portrait`（圣雄甘地人像，正面中央；**data.js 误填 architecture，须改为 portrait**） |
| 中央母题实例（符号化） | 同心圆章 + 放射莲纹几何 + 币种首字母负空间（**不画脸**；原「几何符号剪影」改「人像圆章」） |
| 修正签名 hex | `#B08FB5`（柔薰衣草；data.js 占位橙红 `#C77A4F` 色相完全偏离，**须改紫**） |
| 真实主导色（溯源参考） | 薰衣草紫 `#9E7FB5` |

**正向**
```
Stylized symbolic motif of a concentric medallion emblem with radial lotus geometry and an abstract initial-letter negative space, evoking a historic portrait without showing a face, flat geometric, #B08FB5 soft lavender dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, [centered circular composition for coin / horizontal banner composition for note].
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no human face, no realistic portrait, no rupee symbol, no detailed engraving.
```

---

### 3.9 ZAR · 南非兰特

| 项 | 值 |
|----|----|
| region / denom（修正后） | `asia_afr` / `10` |
| motif_category | `animal`（白犀牛 White Rhinoceros，R10 背面母题；**data.js 误填跳羚 springbok，跳羚是硬币图案，须改为白犀牛**） |
| 中央母题实例（符号化） | 白犀牛极简负空间剪影（2–3 条 essential 曲线压成纯色块） |
| 修正签名 hex | `#6E9B7E`（灰绿/sage；data.js 占位蓝灰 `#4F7A8A` 色相偏离，**须改绿**） |
| 真实主导色（溯源参考） | 绿 `#4A8C5A` |

**正向**
```
Stylized symbolic motif of a white rhinoceros rendered as a minimal negative-space silhouette with two or three essential curves, flat geometric, #6E9B7E sage green dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, [centered circular composition for coin / horizontal banner composition for note].
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed hide texture, no realistic animal, no springbok.
```

---

## 4. coin / note 形态差异（构图纪律）

| 维度 | coin（圆形令牌） | note（横长方牌 ≈2:1） |
|------|----------------|----------------------|
| 画布（@2x 导出） | 1024 × 1024 | 2048 × 1024 |
| 母题构图 | **居中圆形母题**：母题主体落在画布中心圆形区（约直径 70% 画布），四角与圆周外留透明，供 Cocos 圆形令牌裁切 + 区域色环 | **横幅中部色带**：母题占 2:1 画布中部约 60% 宽的水平色带，左右各约 20% 留透明，供代码放区域徽标 / ISO / 面值 |
| 透明区用途 | 圆周外 → Cocos 圆形令牌底 + 区域色环（z=0） | 左右端 → 代码层区域徽标/ISO/面值（z=2–4） |
| 构图关键词 | centered circular composition | horizontal banner composition |

> 同一币种的 coin / note 两图**共享同一母题几何与签名色**，仅构图不同；母题几何必须一致以保证「同币双形态」视觉连续。

---

## 5. AI 生成 vs 代码合成边界（明确分界）

| 职责 | Seedream（AI 出图） | Cocos 代码（cc.Graphics / cc.Label） |
|------|-------------------|--------------------------------------|
| 母题质感层 | ✅ 符号化几何母题 PNG，透明底，锚定签名色 | ❌ |
| 区域双编码形状徽标（圆角矩形/六边形/菱形 + 区域色） | ❌ | ✅ `RegionBadge.ts` cc.Graphics，角落小标（coin 上缘 / note 右上角） |
| ISO 4217 代码文本 | ❌ | ✅ `cc.Label`（Noto Sans SC，深墨 on 奶油 ≥AA） |
| 面值数字 / 符号 | ❌ | ✅ `cc.Label` |
| 面额 Tier 环数 / 尺寸 / 微光泽 | ❌（仅母题可暗示层级） | ✅ Tier 驱动环数+尺寸+柔光带 sprite |
| 纸感噪点 / 柔光带 | ❌（禁止烤进 AI 图） | ✅ 共享 sprite 叠加（≤4% 噪点） |
| 卡基底 / 区域色框带 / 奶油内衬 | ❌ | ✅ CardNode 背景 Sprite/Graphics |

**铁律**：区域形状、ISO、面值、Tier 环数、纸感噪点、柔光带**全部由代码叠加**；**禁止把任何文字 / ISO / 面额 / 区域形状烤进 Seedream 图**。Seedream 只交付「母题质感层」PNG。

**Cocos 合成 z-order（自下而上，识别信息恒在上）**——对齐 `cocos-port-plan.md §6`：
| z | 层 | 来源 |
|---|----|------|
| 0（底） | 卡基底：区域色框带 + 奶油内衬 | CardNode 背景 |
| 1 | **母题层 Sprite（Seedream PNG）** | `resources/currencies/*.png` |
| 2 | 区域徽标（圆衬底 + 洲形状） | `RegionBadge.ts` cc.Graphics |
| 3 | ISO Label | `cc.Label` |
| 4 | 面值 Label | `cc.Label` |
| 5（顶） | Tier2+ 柔光带 / matched 描边 | 共享 sprite |

---

## 6. 合规护栏清单（逐图发布前复核）

每一张 Seedream 出图入包前，必须逐条复核；**任一不通过则打回重生成**：

- [ ] **(a) 非真实钞币复刻**：母题为原创几何符号，无可辨识真实纸币/硬币图样、无写实人像五官、无真实建筑照片、无雕版/防伪元素（水印/安全线/全息）。
- [ ] **(b) 无国旗**：图像中无任何国旗、国徽精确造型（文化纹样仅取装饰语汇类型，非具体国徽）。
- [ ] **(c) 色弱可辨（形状 + ISO 冗余）**：母图关闭颜色后，仍能凭后续代码叠加的「区域形状角标 + ISO 码 + 面额」100% 辨识（四层识别码不依赖单一颜色通道）；euro 区内 EUR 蓝 / GBP 紫异色相。
- [ ] **(d) 透明底正确**：RGBA 透明背景干净，无底色填充、无意外不透明边；coin 圆周外 / note 两端透明区完整，供代码层可见。
- [ ] **(e) 尺寸 / 命名符合**：coin = 1024×1024、note = 2048×1024；文件名严格 `cur_<ISO>_<denom>_<region>_<form>.png`；denom 用 §3 修正值（EUR/GBP = 20）。
- [ ] **(f) 色相锚定（额外）**：主色相 = §3 修正签名 hex，未沿用 data.js 错色，未偏移真钞主色相。

> 任一 (a)–(f) 不通过 → 打回重生成，不进 `resources/currencies/`。

---

## 7. 交付 / 接入

1. **出图**：用户持火山引擎密钥，按 §3 提示词在 Seedream 逐 (iso, form) 生成 → 按 §2 规格导出 PNG（coin 1024² / note 2048×1024，RGBA 透明底）。
2. **自检**：过 §6 护栏清单（a–f）。
3. **落盘**：放入 Cocos 项目 `resources/currencies/`，文件名严格 `cur_<ISO>_<denom>_<region>_<form>.png`（见附录清单）。
4. **代码合成**：工程按 `cocos-port-plan.md §6` 的 z-order 将母题 Sprite（z=1）置于代码识别层（z=2–4 区域徽标/ISO/面值）之下合成。
5. **分包策略**：首发包内仅放 coin-mode 必需 8 枚快速开局；note-mode 与后续扩展币种经 `cc.assetManager` 远程加载（远程资源不计入 30MB 微信总包硬限）。

> 本文是「用户调 Seedream」的提示词与规范手册；Seedream 出图后由工程依 cocos-port-plan 合成。本文不改动 MVP / anchor 源码。

### 7.1 现行落盘口径（Canvas 2D 运行时 · 以本节为准）

> ⚠ **上面第 3 / 4 / 5 条是 Cocos 时代口径，已废弃。** 运行时已切换为
> **纯 TypeScript + Canvas 2D**（`minigame/`，esbuild 无头打包，无 Cocos、无 `resources/`、无 `cc.assetManager`）。
> 落盘请一律按本小节执行。

**目录映射（替代原第 3 条的 `resources/currencies/`）**

| 环节 | 现行路径 |
|------|---------|
| 出图产物 | `tools/image_generator/output/` |
| 运行时资产 | `minigame/assets/` ← **游戏实际读取处** |
| web 产物 | `minigame/dist/assets/`（`build.mjs` 自动复制） |
| 微信产物 | `minigame/wx-dist/assets/`（`build.mjs` 自动复制） |

**命名铁律不变**：`cur_<ISO>_<denom>_<region>_<form>.png`。
`minigame/src/app/app.ts:preloadImages` 按 `assets/cur_${iso}_${denom}_${region}_${form}.png` 精确请求，
命中即用真图、缺失即 `catch` 静默降级为几何占位。**故「命名正确地放进 `minigame/assets/`」= 集成完成，无需改任何代码。**

**三步落盘**

```bash
# 1) output → minigame/assets（幂等、只增不删、带命名校验与覆盖率报告）
cd tools/image_generator && python3 copy_to_assets.py

# 2) 重建（同步 dist/assets 与 wx-dist/assets）
cd ../../minigame && node build.mjs web

# 3) 预览 —— 必须从 minigame/ 目录启动
node serve.mjs        # → http://localhost:8080
```

> **`serve.mjs` 必须在 `minigame/` 下启动**：它以 `process.cwd()` 为文档根，而 `index.html` 写死引用
> `dist/game.js`、运行时又请求相对路径 `assets/`。只有 `minigame/` 同时满足这两条；
> 在仓库根启动会 404（无 `index.html`），在 `dist/` 启动会白屏（路径变成 `dist/dist/game.js`）。

**代码合成层（替代原第 4 条的 Cocos z-order）**：调用链为
`app.imageFor(iso, form)` → `render/card.ts: drawFaceCoin / drawFaceNote` → `render/theme.ts: drawCover()` → `ctx.drawImage`
（`drawCover` 按 cover 规则铺满并居中，coin 走圆形裁切区、note 走横幅带）。
拿不到图时同一位置改调 `drawMotifPlaceholder()` 画几何占位 —— 这就是「缺图不报错、只降级」的实现点。
代码识别层（区域形状 / ISO / 面值 / 形态标签）在母题之上逐层 `ctx` 绘制：分层语义与原 z-order 设计等价，
仅实现方式由 Sprite 节点改为 Canvas 2D 顺序绘制调用。

**分包策略（替代原第 5 条）**：远程加载依赖 Cocos `cc.assetManager`，现行运行时无此机制，**暂不分包**；
当前用户已明示忽略微信包体限制，36 张 @2x PNG 全部内置。若后续恢复 30MB 红线，需另起「资产压缩 / 分包」任务
（候选方案：pngquant 有损压缩 + 微信原生分包 `subpackages`）。

> 逐步命令、参数建议与排查表见 **`design/art/new-currency-motif-prompts.md` 末节「用户运行步骤（出图 → 落盘 → 运行）」**。

---

## 附录 A · 资产清单（原 8 币种 16 文件，命名 + 规格）

> 扩池新增 10 币种 20 文件见 **附录 A-2**；资产总数 16 → **36**。

| # | 文件命名 | form | 导出尺寸 | 签名 hex | 母题类别 |
|---|---------|------|---------|---------|---------|
| 1 | `cur_USD_100_amer_coin.png` | coin | 1024² | `#4E7A6B` | portrait |
| 2 | `cur_USD_100_amer_note.png` | note | 2048×1024 | `#4E7A6B` | portrait |
| 3 | `cur_BRL_10_amer_coin.png` | coin | 1024² | `#C77B7B` | animal |
| 4 | `cur_BRL_10_amer_note.png` | note | 2048×1024 | `#C77B7B` | animal |
| 5 | `cur_EUR_20_euro_coin.png` | coin | 1024² | `#4A6E8A` | architecture |
| 6 | `cur_EUR_20_euro_note.png` | note | 2048×1024 | `#4A6E8A` | architecture |
| 7 | `cur_GBP_20_euro_coin.png` | coin | 1024² | `#6A5B8A` | portrait |
| 8 | `cur_GBP_20_euro_note.png` | note | 2048×1024 | `#6A5B8A` | portrait |
| 9 | `cur_CNY_100_asia_afr_coin.png` | coin | 1024² | `#C75D4F` | portrait |
| 10 | `cur_CNY_100_asia_afr_note.png` | note | 2048×1024 | `#C75D4F` | portrait |
| 11 | `cur_JPY_1000_asia_afr_coin.png` | coin | 1024² | `#6E97A3` | landscape |
| 12 | `cur_JPY_1000_asia_afr_note.png` | note | 2048×1024 | `#6E97A3` | landscape |
| 13 | `cur_INR_100_asia_afr_coin.png` | coin | 1024² | `#B08FB5` | portrait |
| 14 | `cur_INR_100_asia_afr_note.png` | note | 2048×1024 | `#B08FB5` | portrait |
| 15 | `cur_ZAR_10_asia_afr_coin.png` | coin | 1024² | `#6E9B7E` | animal |
| 16 | `cur_ZAR_10_asia_afr_note.png` | note | 2048×1024 | `#6E9B7E` | animal |

> 注：EUR / GBP 的 denom 已按锚点 doc §3.1 推荐从 50/10 修正为 **20**，以保留 v2 策略蓝/紫签名并在 euro 区异色相；命名与 data.js 原 denom 不同属预期偏差，非错误。

### 附录 A-2 · 扩池新增 10 币种资产清单（20 文件，2026-08-01 追加）

> 关卡扩展后新增 10 币种（每区达 6 币，支撑单区关卡章节）。母题实例设计、20 条完整正/负向提示词、
> 逐条 §6 护栏自检、出图操作指引详见 **`design/art/new-currency-motif-prompts.md`**。
> 提示词已灌入 `tools/image_generator/generate_currency_tokens.py` 的 `TOKENS`（16 → **36 条**）。
> 签名 hex 取自 `minigame/src/data/currencies.ts` 既有 `signature` 字段（已为粉彩化锚定值），未改色。

| # | 文件命名 | form | 导出尺寸 | 签名 hex | 母题类别 |
|---|---------|------|---------|---------|---------|
| 17 | `cur_CAD_5_amer_coin.png` | coin | 1024² | `#B5894E` | animal（潜鸟 loon） |
| 18 | `cur_CAD_5_amer_note.png` | note | 2048×1024 | `#B5894E` | animal（潜鸟 loon） |
| 19 | `cur_MXN_20_amer_coin.png` | coin | 1024² | `#5FA88A` | animal（美西螈 axolotl） |
| 20 | `cur_MXN_20_amer_note.png` | note | 2048×1024 | `#5FA88A` | animal（美西螈 axolotl） |
| 21 | `cur_ARS_200_amer_coin.png` | coin | 1024² | `#6FA3C7` | landscape（冰川） |
| 22 | `cur_ARS_200_amer_note.png` | note | 2048×1024 | `#6FA3C7` | landscape（冰川） |
| 23 | `cur_CLP_1000_amer_coin.png` | coin | 1024² | `#9A7BC0` | landscape（摩艾石像） |
| 24 | `cur_CLP_1000_amer_note.png` | note | 2048×1024 | `#9A7BC0` | landscape（摩艾石像） |
| 25 | `cur_CHF_10_euro_coin.png` | coin | 1024² | `#7A8FB0` | landscape（山峦） |
| 26 | `cur_CHF_10_euro_note.png` | note | 2048×1024 | `#7A8FB0` | landscape（山峦） |
| 27 | `cur_SEK_100_euro_coin.png` | coin | 1024² | `#5B9AA0` | animal（驼鹿 moose） |
| 28 | `cur_SEK_100_euro_note.png` | note | 2048×1024 | `#5B9AA0` | animal（驼鹿 moose） |
| 29 | `cur_RUB_100_euro_coin.png` | coin | 1024² | `#8C6FB0` | animal（熊 bear） |
| 30 | `cur_RUB_100_euro_note.png` | note | 2048×1024 | `#8C6FB0` | animal（熊 bear） |
| 31 | `cur_PLN_20_euro_coin.png` | coin | 1024² | `#4F8AA8` | architecture（塔桥） |
| 32 | `cur_PLN_20_euro_note.png` | note | 2048×1024 | `#4F8AA8` | architecture（塔桥） |
| 33 | `cur_KRW_1000_asia_afr_coin.png` ⚠ | coin | 1024² | `#C99A3E` | animal（虎鲸 orca） |
| 34 | `cur_KRW_1000_asia_afr_note.png` ⚠ | note | 2048×1024 | `#C99A3E` | animal（虎鲸 orca） |
| 35 | `cur_NGN_100_asia_afr_coin.png` | coin | 1024² | `#5E8C6A` | landscape（Zuma 岩） |
| 36 | `cur_NGN_100_asia_afr_note.png` | note | 2048×1024 | `#5E8C6A` | landscape（Zuma 岩） |

**资产总数：16 → 36**（原 8 币 16 张 + 扩池 10 币 20 张；18 币种 × 2 形态）。

> ⚠ **KRW 数据不一致（须由「④ R4 事实核查」处理，美术侧未擅改数据）**：
> `currencies.ts` 中 KRW 的 `motif='animal'` / `motifLabel='极简虎鲸剪影'`（orca），
> 但 `anchor` / `discoveryLine` 文案讲的是「朝鲜时代的学者」（指向 portrait）。
> **本次视觉母题按 `motifLabel` 出图（虎鲸 orca）**，文案冲突留待 R4 定夺（改文案就视觉 / 改视觉就文案）。
> 详见 `new-currency-motif-prompts.md §5.1`。

> ⚠ **euro 区 CHF / PLN 蓝系接近（P2，不阻塞出图）**：`CHF #7A8FB0` 与 `PLN #4F8AA8` 色相较近，
> 但母题几何差异极大（三角山峰 vs 双塔+拱券），且四层识别码不依赖单一颜色通道，故不阻塞。
> 建议出图后做色弱模拟实拍核对。详见 `new-currency-motif-prompts.md §6`。

> 📌 **其余 9 币锚点带【待核查】**：CAD/MXN/ARS/CLP/CHF/SEK/RUB/PLN/NGN 的 `anchor` 在 `currencies.ts` 中
> 均标【待核查】。建议 **R4 事实核查先于用户实际出图**，避免「出图后锚点被推翻而返工」。

---

## 附录 B · Seedream 调用参数建议（给操盘用户）

- **分辨率**：coin 直接设 1024×1024；note 直接设 2048×1024（即 @2x 最终文件，无需二次缩放）。
- **格式**：PNG，输出带透明通道（alpha）；如平台仅出 JPG，则本地用工具抠底转 RGBA（但优先要原生透明 PNG）。
- **风格权重**：正向提示词中 `flat geometric, minimal, clean vector-like, transparent background` 加权；负向提示词全量生效。
- **候选数**：每 (iso, form) 生成 4 张，人工挑 1 张过 §6 护栏。
- **禁止项复核**：生成后肉眼 + §6 清单核对，重点查「有无意外出现的文字/数字/国旗/写实痕迹」。

---

> 合规声明：本文所有 hex 与母题为符号化原创 / 风格化重演绎，非任何真实钞币的复制或近似再现；母题类别对应真钞真实中央母题但一律几何化简。文化知识点溯源见 `real-world-anchors.md`（文策渊核过，仅用公开事实）。
