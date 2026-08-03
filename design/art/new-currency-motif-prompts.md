# 扩池新增 10 币种 · Seedream 母题提示词规格（20 张）

> 文档类型：美术资产规格 / 出图提示词单（给「持火山引擎密钥、直接调 Seedream 出图」的用户）
> 项目：微信小游戏《货币图鉴》· 对对碰货币配对 · **Canvas 2D 渲染**
> 作者：林绘澄（art-director）· 美术方向 + 技术美术 + 资产规格 + 可访问性
> 日期：2026-08-01
> 状态：可执行（待主理人 游承峰 审批）
> 依赖 / 上位文档：
> - `design/art/seedream-pipeline.md` —— **风格圣经**（§2 资产规格/命名、§3.1 提示词模板、§6 合规护栏）；本文是其扩池增补，风格词汇与命名规范 100% 沿用
> - `minigame/src/data/currencies.ts` §56–103 —— 10 新币的 `iso/region/denom/motif/motifLabel/signature` 权威源
> - `tools/image_generator/generate_currency_tokens.py` —— 本文 20 条已灌入其 `TOKENS`（现 36 条）
>
> **⚠ 引擎口径说明**：`seedream-pipeline.md` 中的 Cocos 引用为历史残留，实际运行时已转为 **Canvas 2D**。
> 但**命名规范 `cur_<ISO>_<denom>_<region>_<form>.png`、尺寸、构图纪律、风格词汇、合规护栏完全不变**，照用。
> 「代码叠加层」的执行者由 Cocos 组件改为 Canvas 2D 绘制（`card.ts`），职责边界不变。

---

> ## ⚠ 合规底线（置顶，同 pipeline §6，逐条不破例）
> 母题一律**符号化 / 几何化**，不得写实复刻任何真实纸币或硬币图样。所有母题走「essential curve / primitive ≤ 3、扁平单色、无写实五官、无真实建筑照片、无雕版/防伪元素」的化简路径。
> **无国旗、无真实文字 / 数字 / ISO / 面额**——这些一律由 Canvas 2D 代码叠加，**绝不烤进图**。
> 所有 hex 为锚定真钞主色相的**粉彩化重演绎**，非原票复制。

---

## 0. 本次交付概览

| 项 | 值 |
|----|----|
| 新增币种 | 10（CAD / MXN / ARS / CLP / CHF / SEK / RUB / PLN / KRW / NGN） |
| 新增资产 | 10 × 2 形态 = **20 张 PNG** |
| 资产总数 | 16 → **36** |
| 区域分布 | `amer` +4（CAD/MXN/ARS/CLP）· `euro` +4（CHF/SEK/RUB/PLN）· `asia_afr` +2（KRW/NGN） |
| 母题类别分布 | `animal` ×5（CAD/MXN/SEK/RUB/KRW）· `landscape` ×4（ARS/CLP/CHF/NGN）· `architecture` ×1（PLN）· `portrait` ×0 |
| 现状 | 目前由 `drawMotifPlaceholder` 几何占位兜底；出图落盘后自动替换 |
| 包体 | 本次**忽略**微信包体限制（用户明示），不做 pngquant / 压缩 |

> **母题分布设计说明**：本批 **0 个 portrait**，是刻意的。原 8 币 portrait 占 5/8 过重，扩池后 18 币 portrait 降至 5/18，视觉母题多样性显著改善，且规避了「人像最容易踩写实五官红线」的合规风险面。

---

## 1. 资产规格（沿用 pipeline §2，无偏差）

| form | 名义画布 | **实际导出（@2x）** | 构图关键词 | 透明区用途 |
|------|---------|-------------------|-----------|-----------|
| coin | 512 × 512 | **1024 × 1024** | `centered circular composition` | 圆周外 + 四角 → 代码层圆形令牌底 + 区域色环 |
| note | 1024 × 512 | **2048 × 1024** | `horizontal banner composition` | 左右各约 20% → 代码层区域徽标 / ISO / 面值 |

- **命名**：`cur_<ISO>_<denom>_<region>_<form>.png`（`form ∈ {coin, note}`）
- **格式**：PNG-24 **RGBA，强制透明背景**（alpha 干净，无底色填充）
- **颜色**：sRGB；单主色（下表 signature hex）+ 最多 1 道 accent 描边（深墨 `#3A3A38`）
- **同币双形态一致性**：同一 ISO 的 coin / note **共享同一母题几何与签名色**，仅构图不同 —— 保证「同币双形态」视觉连续，这是配对玩法的识别基础

---

## 2. 母题实例设计表（10 币）

| iso | 币种 | region | denom | motif 类别 | motifLabel | 母题几何实例（英文，入提示词） | signature |
|-----|------|--------|-------|-----------|-----------|--------------------------------|-----------|
| CAD | 加元 | `amer` | 5 | animal | 极简潜鸟剪影 | minimal negative-space silhouette of a **loon bird** reduced to two or three essential curves | `#B5894E` 赭金 |
| MXN | 墨西哥比索 | `amer` | 20 | animal | 极简蝾螈剪影 | minimal negative-space silhouette of a **salamander-like axolotl** reduced to two or three essential curves | `#5FA88A` 薄荷绿 |
| ARS | 阿根廷比索 | `amer` | 200 | landscape | 极简冰川剪影 | minimal **ice-cliff glacier** silhouette built from a few faceted angular planes | `#6FA3C7` 冰蓝 |
| CLP | 智利比索 | `amer` | 1000 | landscape | 极简石像剪影 | minimal **monolithic stone-head** silhouette reduced to two or three blocky primitives | `#9A7BC0` 紫罗兰 |
| CHF | 瑞士法郎 | `euro` | 10 | landscape | 极简山峦剪影 | minimal **triangular mountain-peak** silhouette with two or three overlapping peaks | `#7A8FB0` 雾蓝灰 |
| SEK | 瑞典克朗 | `euro` | 100 | animal | 极简驼鹿剪影 | minimal negative-space silhouette of a **moose** reduced to two or three essential curves | `#5B9AA0` 青碧 |
| RUB | 俄罗斯卢布 | `euro` | 100 | animal | 极简熊剪影 | minimal negative-space silhouette of a **bear** reduced to two or three essential curves | `#8C6FB0` 淡紫 |
| PLN | 波兰兹罗提 | `euro` | 20 | architecture | 极简塔桥剪影 | **geometric silhouette of a tower bridge** built from two rectangular towers and one connecting arch primitive | `#4F8AA8` 钢蓝 |
| KRW | 韩元 | `asia_afr` | 1000 | animal | 极简虎鲸剪影 | minimal negative-space silhouette of an **orca whale** reduced to two or three essential curves | `#C99A3E` 琥珀金 |
| NGN | 尼日利亚奈拉 | `asia_afr` | 100 | landscape | 极简岩山剪影 | minimal **rounded monolith rock** silhouette built from two or three smooth primitives | `#5E8C6A` 苔绿 |

### 2.1 母题类别与真钞中央母题的对应（合规要点）

每个母题类别**必须对应真钞真实存在的中央母题类别**（这是「迁移识别」北极星的要求），但**一律符号化表达**：

- **CAD / animal** → 加元硬币 loonie 背面的普通潜鸟（loon）。取「鸟身 + 颈弧 + 尾」三条 essential curve。
- **MXN / animal** → 墨西哥 $20 背面的美西螈（axolotl）。取「体弧 + 外鳃冠 + 尾」三条曲线；**特别注意不要出成鱼**。
- **ARS / landscape** → 阿根廷 $200 的莫雷诺冰川。取「切面冰崖」几块 faceted 平面，不画水不画天。
- **CLP / landscape** → 复活节岛摩艾石像。虽是人造石像，但真钞语境属地貌/遗产景观，取「整块石头头形」blocky 剪影 —— **绝不刻五官**，仅一道 accent 描边暗示鼻梁 / 眉脊转折。
- **CHF / landscape** → 阿尔卑斯山。两到三座重叠三角峰，与 JPY 富士山（单峰 + 樱花点）在几何上刻意区分，避免串币。
- **SEK / animal** → 北欧驼鹿。取「厚身 + 垂吻 + 掌状角」；**须避让「细枝叉角的鹿」**，掌状角是驼鹿的辨识锚。
- **RUB / animal** → 熊（俄罗斯最广为人知的动物符号）。取「圆背 + 圆耳 + 短吻」三弧；**须避让熊猫**（黑白双色块极易被模型联想）。
- **PLN / architecture** → 塔桥式历史建筑遗产。两座矩形塔 + 一道连接拱券 primitive。
- **KRW / animal** → 虎鲸（orca）。取「纺锤体 + 背鳍 + 尾叶」；**须避让海豚**（吻部长短是关键差异）。⚠ 见 §5 数据不一致标注。
- **NGN / landscape** → Zuma 岩（Zuma Rock）。取「圆润巨石整块」两三个 smooth primitive，不画植被不画天空。

---

## 3. 负向提示词分组（按 motif 类别）

所有条目共用 `NEG_BASE`（与 pipeline §3.1 完全一致）：

```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture
```

在其后按类别追加 `neg_extra`：

| motif 类别 | 币种 | `neg_extra` |
|-----------|------|-------------|
| **animal 基线** | CAD/MXN/SEK/RUB/KRW | `no detailed feathers, no detailed scales, no realistic animal, no photograph` |
| ┗ 物种专属避让 | CAD | `+ no duck`（潜鸟极易被出成鸭子） |
| ┗ | MXN | `+ no fish`（美西螈水生体型易被出成鱼） |
| ┗ | SEK | `+ no deer with antlers`（须是驼鹿掌状角，非鹿的枝叉角） |
| ┗ | RUB | `+ no panda`（避免黑白熊猫联想） |
| ┗ | KRW | `+ no dolphin`（虎鲸 vs 海豚吻部差异） |
| **landscape** | ARS/CLP/CHF/NGN | `no realistic landscape photo, no real photograph` |
| **architecture** | PLN | `no real building photo, no euro symbol`（PLN 在 euro 区，须避免欧元符号混淆 —— 波兰未加入欧元区） |

> 注：`no photograph` 在 NEG_BASE 与 animal 基线中重复出现属**有意冗余加权**，非笔误；对写实倾向做双重压制。

---

## 4. 20 条完整提示词（逐条，可直接复制粘贴）

> 以下正向 / 负向文本由 `generate_currency_tokens.py` 的 `build_prompt()` / `build_negative()` **实际输出导出**，与脚本运行时逐字节一致，可直接用于人工复核或手动出图。

### 4.1 coin 形态（10 张 · 1024 × 1024 · centered circular composition）

---

#### ① `cur_CAD_5_amer_coin.png` — CAD / amer / 5 / `#B5894E` / animal

**正向**
```
Stylized symbolic motif of a minimal negative-space silhouette of a loon bird reduced to two or three essential curves, flat geometric, #B5894E dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, centered circular composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no detailed feathers, no detailed scales, no realistic animal, no photograph, no duck
```

---

#### ② `cur_MXN_20_amer_coin.png` — MXN / amer / 20 / `#5FA88A` / animal

**正向**
```
Stylized symbolic motif of a minimal negative-space silhouette of a salamander-like axolotl reduced to two or three essential curves, flat geometric, #5FA88A dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, centered circular composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no detailed feathers, no detailed scales, no realistic animal, no photograph, no fish
```

---

#### ③ `cur_ARS_200_amer_coin.png` — ARS / amer / 200 / `#6FA3C7` / landscape

**正向**
```
Stylized symbolic motif of a minimal ice-cliff glacier silhouette built from a few faceted angular planes, flat geometric, #6FA3C7 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, centered circular composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no realistic landscape photo, no real photograph
```

---

#### ④ `cur_CLP_1000_amer_coin.png` — CLP / amer / 1000 / `#9A7BC0` / landscape

**正向**
```
Stylized symbolic motif of a minimal monolithic stone-head silhouette reduced to two or three blocky primitives, flat geometric, #9A7BC0 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, centered circular composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no realistic landscape photo, no real photograph
```

---

#### ⑤ `cur_CHF_10_euro_coin.png` — CHF / euro / 10 / `#7A8FB0` / landscape

**正向**
```
Stylized symbolic motif of a minimal triangular mountain-peak silhouette with two or three overlapping peaks, flat geometric, #7A8FB0 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, centered circular composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no realistic landscape photo, no real photograph
```

---

#### ⑥ `cur_SEK_100_euro_coin.png` — SEK / euro / 100 / `#5B9AA0` / animal

**正向**
```
Stylized symbolic motif of a minimal negative-space silhouette of a moose reduced to two or three essential curves, flat geometric, #5B9AA0 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, centered circular composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no detailed feathers, no detailed scales, no realistic animal, no photograph, no deer with antlers
```

---

#### ⑦ `cur_RUB_100_euro_coin.png` — RUB / euro / 100 / `#8C6FB0` / animal

**正向**
```
Stylized symbolic motif of a minimal negative-space silhouette of a bear reduced to two or three essential curves, flat geometric, #8C6FB0 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, centered circular composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no detailed feathers, no detailed scales, no realistic animal, no photograph, no panda
```

---

#### ⑧ `cur_PLN_20_euro_coin.png` — PLN / euro / 20 / `#4F8AA8` / architecture

**正向**
```
Stylized symbolic motif of a geometric silhouette of a tower bridge built from two rectangular towers and one connecting arch primitive, flat geometric, #4F8AA8 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, centered circular composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no real building photo, no euro symbol
```

---

#### ⑨ `cur_KRW_1000_asia_afr_coin.png` — KRW / asia_afr / 1000 / `#C99A3E` / animal ⚠

**正向**
```
Stylized symbolic motif of a minimal negative-space silhouette of an orca whale reduced to two or three essential curves, flat geometric, #C99A3E dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, centered circular composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no detailed feathers, no detailed scales, no realistic animal, no photograph, no dolphin
```
> ⚠ **KRW 数据不一致，见 §5**。视觉母题按 `motifLabel`（虎鲸 orca）出图。

---

#### ⑩ `cur_NGN_100_asia_afr_coin.png` — NGN / asia_afr / 100 / `#5E8C6A` / landscape

**正向**
```
Stylized symbolic motif of a minimal rounded monolith rock silhouette built from two or three smooth primitives, flat geometric, #5E8C6A dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, centered circular composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no realistic landscape photo, no real photograph
```

---

### 4.2 note 形态（10 张 · 2048 × 1024 · horizontal banner composition）

> 母题几何与签名色与对应 coin **完全相同**，仅末尾构图关键词改为 `horizontal banner composition`；负向提示词与 coin 逐字节相同。

---

#### ⑪ `cur_CAD_5_amer_note.png` — CAD / amer / 5 / `#B5894E` / animal

**正向**
```
Stylized symbolic motif of a minimal negative-space silhouette of a loon bird reduced to two or three essential curves, flat geometric, #B5894E dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, horizontal banner composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no detailed feathers, no detailed scales, no realistic animal, no photograph, no duck
```

---

#### ⑫ `cur_MXN_20_amer_note.png` — MXN / amer / 20 / `#5FA88A` / animal

**正向**
```
Stylized symbolic motif of a minimal negative-space silhouette of a salamander-like axolotl reduced to two or three essential curves, flat geometric, #5FA88A dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, horizontal banner composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no detailed feathers, no detailed scales, no realistic animal, no photograph, no fish
```

---

#### ⑬ `cur_ARS_200_amer_note.png` — ARS / amer / 200 / `#6FA3C7` / landscape

**正向**
```
Stylized symbolic motif of a minimal ice-cliff glacier silhouette built from a few faceted angular planes, flat geometric, #6FA3C7 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, horizontal banner composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no realistic landscape photo, no real photograph
```

---

#### ⑭ `cur_CLP_1000_amer_note.png` — CLP / amer / 1000 / `#9A7BC0` / landscape

**正向**
```
Stylized symbolic motif of a minimal monolithic stone-head silhouette reduced to two or three blocky primitives, flat geometric, #9A7BC0 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, horizontal banner composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no realistic landscape photo, no real photograph
```

---

#### ⑮ `cur_CHF_10_euro_note.png` — CHF / euro / 10 / `#7A8FB0` / landscape

**正向**
```
Stylized symbolic motif of a minimal triangular mountain-peak silhouette with two or three overlapping peaks, flat geometric, #7A8FB0 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, horizontal banner composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no realistic landscape photo, no real photograph
```

---

#### ⑯ `cur_SEK_100_euro_note.png` — SEK / euro / 100 / `#5B9AA0` / animal

**正向**
```
Stylized symbolic motif of a minimal negative-space silhouette of a moose reduced to two or three essential curves, flat geometric, #5B9AA0 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, horizontal banner composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no detailed feathers, no detailed scales, no realistic animal, no photograph, no deer with antlers
```

---

#### ⑰ `cur_RUB_100_euro_note.png` — RUB / euro / 100 / `#8C6FB0` / animal

**正向**
```
Stylized symbolic motif of a minimal negative-space silhouette of a bear reduced to two or three essential curves, flat geometric, #8C6FB0 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, horizontal banner composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no detailed feathers, no detailed scales, no realistic animal, no photograph, no panda
```

---

#### ⑱ `cur_PLN_20_euro_note.png` — PLN / euro / 20 / `#4F8AA8` / architecture

**正向**
```
Stylized symbolic motif of a geometric silhouette of a tower bridge built from two rectangular towers and one connecting arch primitive, flat geometric, #4F8AA8 dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, horizontal banner composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no real building photo, no euro symbol
```

---

#### ⑲ `cur_KRW_1000_asia_afr_note.png` — KRW / asia_afr / 1000 / `#C99A3E` / animal ⚠

**正向**
```
Stylized symbolic motif of a minimal negative-space silhouette of an orca whale reduced to two or three essential curves, flat geometric, #C99A3E dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, horizontal banner composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no detailed feathers, no detailed scales, no realistic animal, no photograph, no dolphin
```
> ⚠ **KRW 数据不一致，见 §5**。视觉母题按 `motifLabel`（虎鲸 orca）出图。

---

#### ⑳ `cur_NGN_100_asia_afr_note.png` — NGN / asia_afr / 100 / `#5E8C6A` / landscape

**正向**
```
Stylized symbolic motif of a minimal rounded monolith rock silhouette built from two or three smooth primitives, flat geometric, #5E8C6A dominant palette, minimal, clean vector-like, single flat color with one accent stroke, game asset, transparent background, horizontal banner composition.
```
**负向**
```
no realistic banknote, no coin replica, no flag, no text, no numbers, no letters, no watermark, no security thread, no hologram, no photorealistic, no photograph, no detailed texture, no realistic landscape photo, no real photograph
```

---

## 5. ⚠ 已知数据不一致（须由「④ R4 事实核查」处理，本文不擅改数据）

### 5.1 KRW 母题 vs 文案冲突（P1）

| 字段 | 当前值（`currencies.ts` L96–99） | 指向 |
|------|-------------------------------|------|
| `motif` | `'animal'` | 动物 |
| `motifLabel` | `'极简虎鲸剪影'` | 虎鲸 orca |
| `glyph` | `'bolt'` | — |
| `anchor` | 【待核查】韩元纸币母题含**历史文化人物**与建筑 | 人物 / 建筑 |
| `discoveryLine` | 「韩元上的**面孔**，是**朝鲜时代的学者**……」 | 人物 portrait |

**冲突**：视觉母题字段（animal / 虎鲸）与文案字段（anchor / discoveryLine 讲朝鲜时代学者）互相矛盾。

**本次处置（美术侧）**：按任务指令，**视觉一律按 `motifLabel` 出图（orca 虎鲸）**，即 §4 ⑨⑲ 两条。**不修改 `currencies.ts`。**

**归属与建议**：归 **「④ R4 事实核查」** 处理。届时二选一：
- **方案 A（改文案就视觉）**：保留 animal/orca，把 `anchor` / `discoveryLine` / `flashPrimary` 改写为海洋生物或韩国自然向的文化事实。**美术侧零返工**。
- **方案 B（改视觉就文案）**：把 `motif` 改回 `portrait`、`motifLabel` 改为「人像圆章」。**代价**：本文 ⑨⑲ 两条提示词作废需重出图；且 portrait 占比回升（5/18 → 6/18），并重新引入「写实五官」合规风险面。

> 林绘澄倾向 **方案 A** —— 美术侧零返工、母题多样性更好、合规风险面更小。但事实准确性是文策渊的判断域，最终由 R4 定夺，美术侧无条件配合。

### 5.2 其余 9 币 anchor 均带【待核查】标记

CAD/MXN/ARS/CLP/CHF/SEK/RUB/PLN/NGN 的 `anchor` / `flashPrimary` / `flashSecondary` 在 `currencies.ts` 中均标注【待核查】。本文母题实例是**基于这些草稿锚点的视觉演绎**。若 R4 核查后某币的真钞中央母题类别发生变更（如 SEK 实际非驼鹿），对应提示词须同步修订并重出图。

> **风险提示给主理人**：建议 **R4 事实核查先于用户实际出图**，否则可能出现「出图后因锚点被推翻而返工」。若用户急于验证视觉管线，可先出 CAD/MXN/CHF/NGN 四张（锚点相对最稳），KRW 缓出。

---

## 6. 合规护栏自检（pipeline §6 · 逐条对 20 条条目复核）

> 本节是**提示词层面**的事前自检（已全部通过）。**出图后仍须对每张实际 PNG 再走一遍 (a)–(f)**，任一不通过则打回重生成。

| 护栏项 | 提示词层面自检结果 | 依据 |
|-------|------------------|------|
| **(a) 非真实钞币复刻** | ✅ 20/20 通过 | 全部母题为 `minimal / geometric silhouette / primitives` 化简表述；无 portrait 母题故无写实五官风险；CLP 摩艾明确「blocky primitives」不刻五官；PLN 带 `no real building photo`；NEG_BASE 含 `no realistic banknote / no coin replica / no watermark / no security thread / no hologram` |
| **(b) 无国旗** | ✅ 20/20 通过 | NEG_BASE 含 `no flag`；无任何母题实例涉及国徽/旗帜造型 |
| **(c) 色弱可辨（四层识别码）** | ✅ 20/20 通过 | 母题关色后仍为可辨形状剪影；识别不依赖颜色 —— 区域形状角标 + ISO + 面额由 Canvas 2D 代码叠加。**同区异色相核查**：`amer` 内 CAD 赭金/MXN 薄荷绿/ARS 冰蓝/CLP 紫罗兰四色相分离；`euro` 内 CHF 雾蓝灰/SEK 青碧/RUB 淡紫/PLN 钢蓝 —— **⚠ CHF `#7A8FB0` 与 PLN `#4F8AA8` 同为蓝系，见下方备注**；`asia_afr` 内 KRW 琥珀金/NGN 苔绿分离 |
| **(d) 透明底正确** | ✅ 20/20 通过 | 每条正向含 `transparent background`；coin 用 `centered circular composition`（圆周外留透明）、note 用 `horizontal banner composition`（两端留透明） |
| **(e) 尺寸 / 命名符合** | ✅ 20/20 通过 | 命名严格 `cur_<ISO>_<denom>_<region>_<form>.png`，denom/region 逐条回源 `currencies.ts` 核对一致；脚本 `TARGET` 强制 coin 1024²/note 2048×1024；36 条文件名唯一性已用脚本校验通过 |
| **(f) 色相锚定** | ✅ 20/20 通过 | 全部使用 `currencies.ts` 中既有 `signature` hex（该字段本身即粉彩化锚定值），无 data.js 错色沿用，无自行改色 |
| **无真实文字 / 数字 / ISO / 面额** | ✅ 20/20 通过 | NEG_BASE 含 `no text, no numbers, no letters`；PLN 额外 `no euro symbol`；提示词中无任何字符要求烤进图 |

### ⚠ (c) 项备注：euro 区 CHF / PLN 蓝系接近（P2，不阻塞出图）

`CHF #7A8FB0`（雾蓝灰）与 `PLN #4F8AA8`（钢蓝）在 euro 区内色相较接近。**不阻塞本次出图**，理由：

1. 二者母题几何差异极大（三角山峰 vs 双塔+拱券），形状通道完全可分；
2. 四层识别码不依赖单一颜色通道 —— 区域形状 + ISO + 面额三层冗余仍在；
3. CHF 明显偏灰、PLN 明显偏饱和，明度/饱和度通道有差。

**建议**：出图后在真机做一次色弱模拟（Deuteranopia / Protanopia）实拍核对。若确认易混，最小改动是把 PLN 往青绿方向推约 10–15° 色相（如 `#4F8AA8` → `#4F9CA0`），CHF 保持不动 —— PLN 锚点本就带【待核查】，调整成本低于 CHF。此项列入待用户/主理人决策，**美术侧不擅自改 `currencies.ts`**。

---

## 7. 出图操作指引（给持密钥的用户）

### 7.1 一键出全部 36 张

```bash
export ARK_API_KEY="ark-xxxx"
cd tools/image_generator
python3 generate_currency_tokens.py --candidates 4
```

### 7.2 只出本次新增的某一币（推荐分批验证）

```bash
python3 generate_currency_tokens.py --only CAD --candidates 4   # 一次出该 ISO 的 coin + note
```

### 7.3 参数建议

| 参数 | 建议值 | 理由 |
|------|-------|------|
| `--candidates` | **4** | 与 pipeline 附录 B 一致。符号化几何母题的「化简程度」在模型侧波动大 —— 4 张里通常 1–2 张够扁平、其余偏写实或元素过多。低于 4 张挑选余地不足；高于 4 张边际收益递减、徒增 token 成本。 |
| ┗ 高风险币 | **6** | CAD（易出鸭）/ MXN（易出鱼）/ SEK（易出枝叉角鹿）/ KRW（易出海豚）/ CLP（易刻五官）五币物种或五官误判率偏高，建议单独 `--only <ISO> --candidates 6` 加大挑选余量。 |
| `--no-ref` | 首轮建议**加上** | 本次无 `reference_subjects/` 参考图，纯文生图；显式 `--no-ref` 可避免后续误放参考图导致风格漂移。 |

### 7.4 落盘

1. 出图 → 逐张过 §6 护栏 (a)–(f)，重点肉眼查「有无意外冒出的文字/数字/国旗/写实痕迹」，以及 §3 表中的物种误判项。
2. 挑中的图重命名为 §4 各条标题的文件名，放入运行时资产目录（与现有 16 张同目录）。
3. 落盘后 `drawMotifPlaceholder` 几何占位自动被真图替换（集成层已就绪，无需改 `card.ts` / `app.ts`）。
4. **本次不做 pngquant / 包体压缩**（用户明示忽略包体限制）。若后续恢复包体红线，再单独起「资产压缩」任务。

---

## 附录 · 20 张新增资产清单

| # | 文件命名 | form | 导出尺寸 | 签名 hex | 母题类别 | region |
|---|---------|------|---------|---------|---------|--------|
| 17 | `cur_CAD_5_amer_coin.png` | coin | 1024² | `#B5894E` | animal | amer |
| 18 | `cur_CAD_5_amer_note.png` | note | 2048×1024 | `#B5894E` | animal | amer |
| 19 | `cur_MXN_20_amer_coin.png` | coin | 1024² | `#5FA88A` | animal | amer |
| 20 | `cur_MXN_20_amer_note.png` | note | 2048×1024 | `#5FA88A` | animal | amer |
| 21 | `cur_ARS_200_amer_coin.png` | coin | 1024² | `#6FA3C7` | landscape | amer |
| 22 | `cur_ARS_200_amer_note.png` | note | 2048×1024 | `#6FA3C7` | landscape | amer |
| 23 | `cur_CLP_1000_amer_coin.png` | coin | 1024² | `#9A7BC0` | landscape | amer |
| 24 | `cur_CLP_1000_amer_note.png` | note | 2048×1024 | `#9A7BC0` | landscape | amer |
| 25 | `cur_CHF_10_euro_coin.png` | coin | 1024² | `#7A8FB0` | landscape | euro |
| 26 | `cur_CHF_10_euro_note.png` | note | 2048×1024 | `#7A8FB0` | landscape | euro |
| 27 | `cur_SEK_100_euro_coin.png` | coin | 1024² | `#5B9AA0` | animal | euro |
| 28 | `cur_SEK_100_euro_note.png` | note | 2048×1024 | `#5B9AA0` | animal | euro |
| 29 | `cur_RUB_100_euro_coin.png` | coin | 1024² | `#8C6FB0` | animal | euro |
| 30 | `cur_RUB_100_euro_note.png` | note | 2048×1024 | `#8C6FB0` | animal | euro |
| 31 | `cur_PLN_20_euro_coin.png` | coin | 1024² | `#4F8AA8` | architecture | euro |
| 32 | `cur_PLN_20_euro_note.png` | note | 2048×1024 | `#4F8AA8` | architecture | euro |
| 33 | `cur_KRW_1000_asia_afr_coin.png` ⚠ | coin | 1024² | `#C99A3E` | animal | asia_afr |
| 34 | `cur_KRW_1000_asia_afr_note.png` ⚠ | note | 2048×1024 | `#C99A3E` | animal | asia_afr |
| 35 | `cur_NGN_100_asia_afr_coin.png` | coin | 1024² | `#5E8C6A` | landscape | asia_afr |
| 36 | `cur_NGN_100_asia_afr_note.png` | note | 2048×1024 | `#5E8C6A` | landscape | asia_afr |

> 编号 17–36 接续 `seedream-pipeline.md` 附录 A 的 1–16。**资产总数 16 → 36。**
> ⚠ = KRW 两条存在数据不一致标注，见 §5.1。

---

> 合规声明：本文所有 hex 与母题为符号化原创 / 风格化重演绎，非任何真实钞币的复制或近似再现；母题类别对应真钞真实中央母题类别但一律几何化简。10 新币的文化知识点锚点尚带【待核查】标记，须经「④ R4 事实核查」核实后方可上线。

---

## 用户运行步骤（出图 → 落盘 → 运行）

> **执行人 = 持密钥的用户，不是 agent。** 本次工程环境**无 `ARK_API_KEY`**，agent 未发起任何真实出图请求，
> 也未产生任何新 PNG。下列命令需由你在本机执行。
> 工程侧已完成的前置校验（无需你重跑）：
> - `python3 -m py_compile tools/image_generator/generate_currency_tokens.py` → **通过，无语法错误**
> - TOKENS(36) × `currencies.ts` CURRENCIES(18) × `app.ts` 加载命名 **三方一致，全 PASS**
> - 结论：**PNG 按约定命名落盘即生效，零代码改动。**

### 步骤总览

| # | 动作 | 在哪执行 |
|---|------|---------|
| 0 | （可选）免密钥自检 | `tools/image_generator/` |
| 1 | 设置密钥 | 任意 |
| 2 | 出图 → `output/` | `tools/image_generator/` |
| 3 | 人工挑图 + 过 §6 护栏 | 本地看图 |
| 4 | 落盘 → `minigame/assets/` | `tools/image_generator/` |
| 5 | 重建产物 | `minigame/` |
| 6 | 起预览 + 浏览器核对 | **`minigame/`（铁律）** |

---

### 步骤 0 · 免密钥自检（可选，不消耗额度）

```bash
cd tools/image_generator
python3 generate_currency_tokens.py --selfcheck
```

> 注意标志是 `--selfcheck`（非 `--selftest`）。它只验证参考图解析与图生图/文生图分支，**不发起真实请求**。

### 步骤 1 · 设置火山方舟密钥

```bash
export ARK_API_KEY="ark-xxxx"        # 换成你自己的密钥
```

### 步骤 2 · 出图（产物落在 `tools/image_generator/output/`）

```bash
cd tools/image_generator

# 推荐：先单币试跑，确认风格与额度消耗符合预期
python3 generate_currency_tokens.py --only CAD --candidates 4 --no-ref

# 全量 36 张（含已有 8 币，会重出并覆盖 output/ 内同名文件）
python3 generate_currency_tokens.py --candidates 4 --no-ref

# 高误判币加大候选余量（物种/五官易画偏）
for ISO in CAD MXN SEK KRW CLP; do
  python3 generate_currency_tokens.py --only $ISO --candidates 6 --no-ref
done
```

- **首轮建议加 `--no-ref`**：本仓库无 `reference_subjects/` 参考图，纯文生图；显式声明可避免日后误放参考图导致风格漂移。
- `--candidates N` 只是让模型多出候选，**脚本仅自动落盘第 1 张**；其余需你在火山控制台挑选后手动替换。
- 只想补新增 10 币、不动已有 8 币，就逐个 `--only`：`CAD MXN ARS CLP CHF SEK RUB PLN KRW NGN`。

### 步骤 3 · 挑图与护栏自检

逐张过 §6 护栏 (a)–(f)，重点查：意外冒出的**文字 / 数字 / 国旗 / 写实痕迹**，以及 §3 表列出的物种误判项
（CAD 易出鸭、MXN 易出鱼、SEK 易出鹿角分叉、KRW 易出海豚、CLP 易刻五官）。

### 步骤 4 · 落盘到运行时资产目录

```bash
# 仍在 tools/image_generator/
python3 copy_to_assets.py --dry-run    # 先预览：会复制哪些、跳过哪些，不写盘
python3 copy_to_assets.py              # 实际复制 output/cur_*.png → minigame/assets/
```

该脚本的工程保证：

- **幂等**：同名同内容自动跳过；同名不同内容才覆盖，并明确标注「覆盖更新」。反复执行结果一致。
- **只增不删**：从不删除 / 清空 / 重命名任何既有文件，现有 16 张母题图与 `bg_*` / `deco_*` 场景图不受影响。
- **命名校验**：只搬 `cur_<ISO>_<denom>_<region>_<form>.png`（region ∈ `amer|euro|asia_afr`，form ∈ `coin|note`）。
  命名不符的文件会被拦下并告警 —— 因为 `app.ts` 按该命名精确请求，错名文件落盘后**不报错、只静默失效**（永远显示几何占位），极难排查。
- **覆盖率报告**：结尾打印「x/36 张已就位」并列出仍缺的 ISO。

可选参数：`--only CAD`（只落某币）、`--include-scenes`（连 `bg_*` / `deco_*` 场景图一起搬，默认不搬）。

### 步骤 5 · 重建产物

```bash
cd ../../minigame        # 从 tools/image_generator/ 回到 minigame/
node build.mjs web       # 等价：npm run build:web
```

> `build.mjs` 会把整个 `minigame/assets/` 递归复制到 `dist/assets/`（`node build.mjs wx` 则复制到 `wx-dist/assets/`）。
> **注意**：它**不会**自动从 `tools/image_generator/output/` 取图 —— 所以步骤 4 的复制不能省。
>
> 严格说，步骤 6 从 `minigame/` 起服务时，浏览器读的是 `minigame/assets/`（不是 `dist/assets/`），
> 因此**仅为看效果可跳过重建**。但仍建议执行，以保持 `dist/` 与 `wx-dist/` 同步、避免后续打包用到陈旧资产。

### 步骤 6 · 起预览服务（⚠ 铁律：必须从 `minigame/` 目录启动）

```bash
# 必须在 minigame/ 目录下
node serve.mjs                    # 等价：npm run dev（= build:web + serve 一步到位）
```

**为什么必须是 `minigame/`？** `serve.mjs` 以**当前工作目录**为文档根（`resolve(process.cwd())`）。而：

- `minigame/index.html` 里写死 `<script src="dist/game.js">` → 文档根必须是 `dist/` 的**父目录**；
- `app.ts:preloadImages` 请求 `assets/cur_*.png`（相对路径）→ 文档根下必须直接有 `assets/`。

只有 `minigame/` 同时满足这两条。常见错误后果：

| 启动目录 | 结果 |
|---------|------|
| **`minigame/`** | ✅ 正确 |
| 仓库根 `GameDream/` | ❌ 404 —— 根目录没有 `index.html` |
| `minigame/dist/` | ❌ 白屏 —— `dist/index.html` 仍找 `dist/game.js`，实际路径成了 `dist/dist/game.js` |

### 步骤 7 · 浏览器核对

打开 <http://localhost:8080> ，**硬刷新**（macOS `Cmd+Shift+R` / Windows `Ctrl+F5`）避开图片缓存，然后：

1. 进**图鉴**视图，逐个查看 18 币 —— 10 张新币（CAD / MXN / ARS / CLP / CHF / SEK / RUB / PLN / KRW / NGN）应显示**真母题图**；
2. 确认几何占位（`drawMotifPlaceholder` 画的区域形状）**已消失**；
3. 切 coin / note 两种形态各看一遍（每币 2 张图，共 36 张）。

**排查表**：

| 现象 | 原因 | 处理 |
|------|------|------|
| 某币仍是几何占位 | 该 PNG 没落盘或**文件名拼错** | 重跑 `python3 copy_to_assets.py --dry-run` 看覆盖率报告缺哪张 |
| 全部币都是占位 | 服务起错目录 | 确认在 `minigame/` 下执行 `node serve.mjs` |
| 页面白屏 | 未构建或起错目录 | 先 `node build.mjs web`，再从 `minigame/` 起服务 |
| 图片是旧版 | 浏览器缓存 | 硬刷新 |

### 一条命令链（已出好图、只想落盘看效果）

```bash
cd tools/image_generator && python3 copy_to_assets.py && cd ../../minigame && node build.mjs web && node serve.mjs
```

> **包体说明**：本次**不做** pngquant / 包体压缩（用户明示暂不考虑微信包体限制）。
> 36 张 @2x PNG 未压缩体积可观，若后续恢复 30MB 包体红线，需单独起「资产压缩 / 分包」任务。
