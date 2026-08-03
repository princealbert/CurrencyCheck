# 硬币 / 纸币卡面重设计规格（Coin & Note Redesign Spec）

> 适用项目：《货币图鉴·对对碰》纯 TS + Canvas 2D 微信小游戏
> 影响文件：`src/render/card.ts`、`src/render/layout.ts`、`src/render/types.ts`、`src/render/theme.ts`（新增辅助）
> 上游文档：`design/art/game-feel-direction.md` §4（硬币金属配方）/ §5（纸币纸张配方）、`design/art/currency-stylization-strategy.md` §2.9（四层识别码）
> 本轮定位：**只调布局与材质，不改识别码语义、不改玩法、不重出母题图**

---

## 合规铁律（贯穿全文，任何实现细节不得突破）

> 绝不绘制真实钞币 / 硬币照片、国旗、国徽、人物头像、防伪元素（水印 / 安全线 / 凹版底纹 / 缩微文字 / 全息 / 团花）。
> 16 张母题 PNG 已经是**风格化符号**（`generate_currency_tokens.py` 提示词内含 `no realistic banknote / no flag / no human face` 等护栏），本方案**不重新出图、不改母题内容**，只改「它在币面上占多大、怎么裁、周围放什么」。
> 新增的「面值印压带」「印刷视窗角标」均为**抽象几何装饰**：
> - 不得出现齿边、年份、铸币厂标记、铭文环；
> - 不得出现真实货币的版式布局引用；
> - 面值数字沿用 `data/currencies.ts` 的 `denom + denomSymbol` 文本，与真钞版式无关。

---

## 0. 问题诊断（实测数据，390×844 逻辑视口）

### 0.1 各上下文的实际卡尺寸

| 上下文 | 来源 | 卡尺寸 | 硬币 R | 当前母题半径 `mr = R*0.46` |
|---|---|---|---|---|
| Board 对局 | `layout.ts boardLayout()` coin 分支（safe 44/34）| 85.5 × 85.5 | **42.75** | 19.66 |
| Detail 身份大卡 | `detail.ts` L50 `cardSize = min(120, areaW*0.36)` | 120 × 120 | **60.00** | 27.60 |
| Detail 双形态槽 | `detail.ts` L140 `slotH = 64` | 64 × 64 | **32.00** | 14.72 |
| Codex 图鉴槽 | `codex.ts` L64 `slotH = rect.h*0.4`（rect.h=104）| 41.6 × 41.6 | **20.80** | 9.57 |

### 0.2 「母题没填满」的量化

奶油内盘半径 `Rin = R - inset`，`inset = max(2, R*0.04)` → Board 上 `Rin = 40.75`。

```
母题盘面积 / 内盘面积 = (0.46R)² / (0.96R)² = 0.2116 / 0.9216 ≈ 23%
```

**母题只占奶油内盘的 23%**，其余 77% 是空白穹面。用户的观感完全准确。

### 0.3 第二重原因（比 `mr=0.46` 更隐蔽）

母题 PNG 是 Seedream 直出的 1024×1024 透明图，**主体四周普遍带 15%–30% 的透明留白**。
即使把 `mr` 放大到 `Rin`，主体仍然只能撑到内盘的 70%–85%。

> 结论：**必须「放大绘制半径」+「裁掉透明留白」两件事一起做**，只做前者会得到「稍微大一点但还是没填满」的半吊子结果。

### 0.4 另外两个待修问题

- **币种中文名从未出现在币面上**。`drawFaceCoin` / `drawFaceNote` 只画 ISO 与面额，`CardVisual` 里根本没有 `name` 字段。所以 B 项不是「移到币外」，而是「首次引入 + 放在币外」。
- **纸币母题被拉伸**。`drawFaceNote` L431：`ctx.drawImage(image, bandX, bandY, bandW, bandH)`，源图 2048×1024（2:1）画进约 3:1 的横带 → **横向拉伸 ~50%**。这是 bug 级问题，本轮一并修。

---

## A. 母题填满内盘

### A1. 绘制半径：`mr = R*0.46` → `Rin`

```
R     = min(rect.w, rect.h_face) / 2          // h_face 见 B 项（扣除名称行后的可用高）
inset = max(2, R * 0.04)
Rin   = R - inset                              // 奶油穹面圆半径 = 新的母题半径
```

母题圆心从 `(cx, cy - R*0.08)` 改为 **与内盘同心 `(cx, cy)`**——偏移量存在的唯一理由是给下方的 ISO/面额文本让位，而这两者现在都不在内盘上了（见 C 项）。

面积对比（Board，R=42.75）：

| | 半径 | 面积 | 相对内盘 |
|---|---|---|---|
| 现状 | 19.66 | 1214 px² | 23% |
| 改后（扣掉底部印压带） | 40.75 | 5216 → 有效 **4645** px² | **89%** |

**有效母题面积提升约 3.8 倍。**

### A2. 裁掉透明留白（必做，两条路线二选一）

| | **路线 1（推荐）· 出图后处理裁切** | 路线 2 · 运行时过扫系数 |
|---|---|---|
| 做法 | 在 `tools/image_generator` 落盘阶段：`bbox = im.getbbox()` → `im.crop(bbox)` → 居中补成正方 → 缩放回 1024×1024 | 在 `card.ts` 引入 `MOTIF_ZOOM` 逐 ISO 表，绘制时按 `2*Rin*Z` 尺寸居中过扫，`Z ≈ 1.18~1.30` |
| 优点 | 一次性、全上下文统一、运行时零成本、`Z` 恒为 1.0 | 不用重跑资产 |
| 缺点 | 需重跑一次后处理（不重新出图，不烧 key） | 每个 ISO 要人工调参，8 币种 × 2 形态 = 16 个魔数，长期维护差 |
| **裁决** | **走路线 1。** 路线 2 仅作为「后处理来不及时」的临时挡板 | |

路线 1 落地后，运行时仍保留一个**全局微过扫** `MOTIF_OVERSCAN = 1.02`，用于吃掉抗锯齿边缘的半透明像素（避免圆周上出现一圈毛边）。

### A3. cover 裁剪（不拉伸）

用 `theme.ts` 新增的通用辅助（与 `scene-backgrounds-spec.md` §4.3 是**同一个函数**）：

```
drawCover(ctx, img, x, y, w, h):
    s  = max(w / img.width, h / img.height)
    dw = img.width  * s
    dh = img.height * s
    ctx.drawImage(img, x + (w - dw)/2, y + (h - dh)/2, dw, dh)
```

硬币调用：

```
ctx.save()
ctx.beginPath(); ctx.arc(cx, cy, Rin, 0, Math.PI*2); ctx.clip()
ctx.fillStyle = v.signature
ctx.fillRect(cx - Rin, cy - Rin, Rin*2, Rin*2)          // 签名色兜底（母题缺失/半透明处）
if (image) {
    const d = Rin * 2 * MOTIF_OVERSCAN
    drawCover(ctx, image, cx - d/2, cy - d/2, d, d)
} else {
    drawMotifGeometry(ctx, v.motif, cx, cy, Rin * 0.78)   // 几何占位同步放大
}
ctx.restore()
```

> **关键**：`drawCover` 只用现有 `Ctx2DLike` 的 **5 参 `drawImage`**（`types.ts` L59 只声明了 5 参重载）。
> 通过「放大绘制尺寸 + 居中 + clip 裁掉溢出」实现 cover，**无需扩展平台接口**。

### A4. 三类母题填满后的观感预期

| 母题类别 | 币种 | 现状观感 | 填满后预期 | 风险 |
|---|---|---|---|---|
| **person（同心圆章）** | USD / GBP / CNY / INR | 小圆章飘在大空盘中央，像"贴纸" | **最理想**。同心圆章本就是圆形构图，与内盘同心放大后，外圈射线/莲花几何自然抵到币缘，读作「铸在币面上的徽记」，与金属倒角连成一体 | 几乎无。同心结构对 cover 裁剪不敏感 |
| **animal（负空间剪影）** | BRL 金刚鹦鹉 / ZAR 白犀牛 | 剪影小且居中，识别靠猜 | **提升最大**。剪影轮廓填满圆盘后，鹦鹉的喙/尾、犀牛的角/背线成为可读特征，一眼区分度显著上升 | ⚠️ 剪影是**横向构图**，cover 到正方圆盘时上下会留签名色。这是**可接受的**（签名色本就是识别层②），但需验收确认剪影主体（头部）没被底部印压带切到——若被切，在后处理阶段给该 ISO 加 `offsetY = -0.06` 的居中偏移 |
| **landscape（三角山 + 点）** | JPY 富士山 | 小三角，几乎无存在感 | 山体底边抵到圆盘下缘、山尖接近上缘，樱花点分布在两侧空域，读作「一枚风景纪念币」 | ⚠️ 山体底边会与底部印压带重叠。**这是设计意图**——印压带正好压在山脚，像"地面/绶带"，视觉上反而更完整。验收时确认山尖没被顶部区域徽标压住 |
| **architecture（拱券 + 梯形）** | EUR | 小拱门 | 拱券顶部接近币缘，梯形基座落在印压带上方，构成稳定的三角构图 | 低 |

---

## B. 币种名移到币外

### B1. 数据链路（当前完全缺失，需新增）

`CardVisual`（`src/render/types.ts` L10–18）**没有 `name` 字段**。新增：

```ts
export interface CardVisual {
  iso: string;
  name: string;          // ← 新增：币种中文名，如「巴西雷亚尔」
  region: Region;
  // ...其余不变
}
```

四处构造点需补 `name`：

| 文件 | 位置 | 取值 |
|---|---|---|
| `renderer.ts` | `toVisual()` L20–38 | `getCurrency(card.iso)?.name ?? card.iso`（该文件 L18 已 import `getCurrency`） |
| `codex.ts` | L74–75 两个字面量 | `c.name`（L53 已取到 `c`） |
| `detail.ts` | L51–59 `coinVisual` | `c.name` |
| `detail.ts` | L146 `noteVisual` | 由 `{...coinVisual}` 自动继承 |

### B2. 是否绘制名称行 —— 由调用方决定

在 `CardDrawOpts`（`types.ts` L20–31）新增：

```ts
  /** 是否在卡片下方（币外）绘制币种名；缺省 false。上下文已有名称时应传 false */
  showName?: boolean;
```

| 上下文 | `showName` | 理由 |
|---|---|---|
| Board 对局卡 | **true** | 主战场，用户诉求正是这里 |
| Codex 图鉴槽 | **false** | 单元格顶部 L54 已用 `fitText` 画了 `c.name`；再画一遍是重复。改为在那一行后缀 ISO（见 B5） |
| Detail 身份大卡 | **false** | 页标题（`detail.ts` L32）已是 `c.name` |
| Detail 双形态槽 | **false** | 槽下方 L149–150 已有「硬币 / 纸币」标签，那一行**就是**币外行 |

> 结论：`showName` 实际只在 Board 打开。这是刻意的——**「名字在币外」是一条布局原则，但不等于每个上下文都要重复渲染同一个名字**。

### B3. 硬币的名称行几何（`showName = true` 时）

**不改 `layout.ts` 的 coin 分支**：cell 尺寸保持 85.5×85.5，名称行在 **rect 内部** 消化。
这样命中矩形（`hits.push({rect, ...})`）无需改动，点击区反而变大（含名称行），是好事。

```
nameH   = clamp(min(rect.w, rect.h) * 0.16, 12, 18)      // Board: 13.68
R       = (min(rect.w, rect.h - nameH)) / 2 - 1          // Board: 34.91  ≈ cell * 0.408
cx      = rect.x + rect.w / 2
cy      = rect.y + 1 + R                                  // 硬币贴 cell 上缘，下方让出整行
nameY   = rect.y + rect.h - nameH * 0.5                   // 名称行垂直居中于剩余带
nameSz  = min(nameH * 0.80, 12)                           // Board: 10.9
nameMaxW= rect.w * 0.96
```

校验：`cy + R = rect.y + 1 + 2*34.91 = rect.y + 70.82`，名称行中心 `rect.y + 78.66`，
即名称中心距币缘 `7.84 ≈ R*0.22`。用户建议的 `R*0.35`（= 12.2）会让 11px 文本下探到 `rect.y + 88.5`，**溢出 cell 3px 进入 8px 间隙**。故本规格取 **`R*0.22`，且以 cell 底边反算**，保证零溢出。

**文本内容与降级（两级，用 `measureText` 预判，只调一次 `fitText`）**

```
full = `${v.iso} · ${v.name}`         // 「BRL · 巴西雷亚尔」
ctx.font = `${nameSz}px <家族>`
str = measureText(full).width <= nameMaxW ? full : v.name
fitText(ctx, str, cx, nameY, {
    size: nameSz, color: THEME.ink, align: 'center', baseline: 'middle',
    maxWidth: nameMaxW, minSize: 9
})
```

- 首选 `ISO · 名称`——一次满足「名字在币外」与「ISO 保留为权威身份」两个诉求。
- 放不下则退为纯中文名；`fitText` 内建的缩字号 + 省略号是第三层兜底。
- **文本仍然全程走 `fitText`**（B/C/D 各处一律如此，不新开裸 `fillText` 通路）。

颜色：`THEME.ink #3A3A38`。名称直接绘制在**场景背景**上（不在 panel 内），对比度按 `scene-backgrounds-spec.md` §5 R5 核算——`bg_board` 最暗档约 `#E6DCC9`，与 ink 对比度 > 8:1，安全。

### B4. 纸币的名称行几何（`showName = true` 时）

纸币的 **2:1 是硬比例约束**，名称行不能从卡面里挖，**必须加在 cell 外** → 这次要改 `layout.ts`。

`layout.ts boardLayout()` note 分支（L58–66）改为：

```
cardW = (areaW - GAP*(COLS-1)) / COLS
nameH = clamp(cardW * 0.11, 11, 16)
faceH = cardW / 2
cellH = faceH + nameH
if (cellH * ROWS + GAP*(ROWS-1) > areaH) {
    cellH = (areaH - GAP*(ROWS-1)) / ROWS
    faceH = cellH - nameH
    cardW = faceH * 2
    nameH = clamp(cardW * 0.11, 11, 16)      // 二次收敛一轮即可，误差 < 1px
    faceH = cellH - nameH
    cardW = faceH * 2
}
cardH = cellH        // 返回给 cards[] 的 rect.h 含名称行
```

`BoardLayout` 接口新增 `nameH: number` 一并返回，`renderer.ts drawBoard` 透传给 `drawCard`。
横屏 844×390 实测收敛结果：`cardW ≈ 118.6`，`faceH ≈ 59.3`，`nameH ≈ 13.2`，`cellH ≈ 72.5`。

`drawFaceNote` 内部据此把**卡面 rect 高度收为 `faceH = rect.h - nameH`**，名称行绘制参数同 B3（`nameSz = min(nameH*0.80, 12)`，`nameMaxW = rect.w * 0.96`）。

### B5. Codex 的 ISO 补位

Codex 不画币外名称行（B2），但 ISO 需要一个去处。改 `codex.ts` L54 那行：

```
当前：fitText(ctx, collected ? c.name : '未发现', ...)
改为：fitText(ctx, collected ? `${c.name} · ${c.iso}` : '未发现', ...)   // maxWidth 不变
```

一行改动，`fitText` 已有的 `maxWidth: rect.w - pad*2` 会自动处理窄屏。

---

## C. 面值与币面融合 ——「面值印压带」

### C1. 设计说明

面额不再是「压在内盘下缘的裸文本」，而是**一条嵌进币面下缘的、区域色的深压印带**，数字以浮雕质感绘于其上。

带的形状选 **弦带（chord band）**：**上缘为直线，下缘随币缘弧线**。

> **为什么不用「弧形绶带」（环带扇形）**：环带扇形需要 `ctx.arc(..., anticlockwise=true)` 反向回描内弧，而 `Ctx2DLike`（`types.ts` L38）声明的 `arc()` **没有 anticlockwise 参数**。
> 弦带可以用「两次 `clip()` 求交」实现（`clip` 是交集语义）：`clip(圆 Rin)` ∩ `clip(下缘矩形)` = 弦带，**零接口改动**。
> 视觉上弦带 = 硬币的「下缘分区面板」，本身就是成熟的钱币设计语言，且比弧带更耐小尺寸。
> 若后续愿意给 `arc()` 补一个可选 `ccw?: boolean` 参数（一行改动），可平滑升级为弧带，本规格的颜色 / 文字方案完全复用。

### C2. 几何

```
t      = max(11, R * 0.32)             // 带厚；Board R=34.91 → 11.17
yTop   = cy + Rin - t                  // 带上缘 y
textY  = yTop + t * 0.52               // 数字光学中心（弦带下窄，故略高于几何中心）
dy     = textY - cy
maxW   = 2 * sqrt(max(1, Rin² - dy²)) * 0.86     // 该 y 处的弦长 × 0.86 安全系数
fontSz = clamp(t * 0.68, 8, 14)
```

Board 实测：`Rin=32.91, t=11.17, yTop=cy+21.74, textY=cy+27.55, maxW=2*sqrt(1083-759)*0.86 = 30.9, fontSz=8`。
`"100 ¥"` 8px bold ≈ 24px 宽 < 30.9 ✓
（对照：**现状**面额字号 `R*0.17 = 7.27px` —— 新方案 8px **不降反升**。）

### C3. 绘制序列（插在母题 `restore()` 之后、区域徽标之前）

```
ctx.save()
// ① 双重 clip 求交 → 弦带形状
ctx.beginPath(); ctx.arc(cx, cy, Rin, 0, Math.PI*2); ctx.clip()
ctx.beginPath(); ctx.rect(cx - Rin, yTop, Rin*2, t + 2); ctx.clip()

// ② 带底：区域色压深两档（× 0.62）
ctx.fillStyle = BAND_COLORS[v.region]
ctx.fillRect(cx - Rin, yTop, Rin*2, t + 2)

// ③ 带面受光（135° 全局光源，与 §4.1 金属层一致）
g = createLinearGradient(cx - Rin*0.5, yTop, cx + Rin*0.5, yTop + t)
g.addColorStop(0,   'rgba(255,255,255,0.18)')
g.addColorStop(0.5, 'rgba(255,255,255,0.00)')
g.addColorStop(1,   'rgba(0,0,0,0.18)')
ctx.fillStyle = g; ctx.fillRect(cx - Rin, yTop, Rin*2, t + 2)

// ④ 压印上唇：暗线 + 亮线（"带子是压进金属里的"）
ctx.fillStyle = 'rgba(0,0,0,0.26)'; ctx.fillRect(cx - Rin, yTop,       Rin*2, 1)
ctx.fillStyle = 'rgba(255,255,255,0.30)'; ctx.fillRect(cx - Rin, yTop + 1, Rin*2, 1)
ctx.restore()

// ⑤ 浮雕数字（两遍 fitText，参数完全一致仅差 color / y，保证两遍字号相同）
label = v.denom + ' ' + v.denomSymbol
base  = { size: fontSz, weight: 'bold', align: 'center', baseline: 'middle',
          maxWidth: maxW, minSize: 8 }
fitText(ctx, label, cx, textY + 1, { ...base, color: 'rgba(0,0,0,0.42)' })   // 暗底遍
fitText(ctx, label, cx, textY,     { ...base, color: '#FDFAF3' })            // 主遍（奶油）
```

> ⑤ 两遍 `fitText` 传入完全相同的 `size / weight / maxWidth / minSize` 与同一字符串，
> `fitText` 的缩字号是纯函数式（`theme.ts` L104–122），两遍必然得到同一字号，不会错位。

### C4. 颜色表与对比度核算

**`BAND_COLORS` = `REGION_COLORS` × 0.62（压深两档）**

| 区域 | REGION_COLORS | BAND_COLORS | 相对亮度 L | 与奶油字 `#FDFAF3` 对比度 |
|---|---|---|---|---|
| amer 美洲 | `#E0B15E` | **`#8B6E3A`** | 0.169 | **4.59 : 1** ✓ |
| euro 欧洲 | `#5B8FB0` | **`#38596D`** | 0.091 | **7.15 : 1** ✓ |
| asia_afr 亚非 | `#87A878` | **`#54684A`** | 0.123 | **5.83 : 1** ✓ |

三档全部 ≥ 4.5:1，满足 WCAG AA 正文级（不依赖"大字例外"）。

> **为什么不直接用区域色原色做带底**：`#E0B15E` 金色是中间调，无论配深墨字（1.88:1）还是奶油字（1.86:1）**都不达标**。压深两档是达成对比度的**必要条件**，不是审美选择。
> **为什么不用深墨字 `#3A3A38`**：在欧洲蓝 `#5B8FB0` 上只有 3.25:1，且 8px 非"大字"，不达标。

### C5. ISO 的去处 —— 分档处理

母题填满内盘后，ISO 不能再压在母题上（对比度不可控）。按硬币半径分三档：

| 档 | 条件 | 币面元素 | 说明 |
|---|---|---|---|
| **T3 完整** | `R ≥ 48` | 满盘母题 + **顶部身份带**（区域徽标 + ISO）+ 底部面值带 | 顶带几何为底带的镜像：`tTop = max(10, R*0.27)`，`yBot = cy - Rin + tTop`，内容为「洲形状徽标 + ISO」水平居中成组。徽标直径 `tTop*0.66`（奶油衬底圆 + 区域色洲形状），间距 `tTop*0.18`，ISO 字号 `clamp(tTop*0.58, 9, 13)`，色 `#FDFAF3` + 同款两遍浮雕。**仅 Detail 身份大卡（R=60）命中** |
| **T2 标准** | `30 ≤ R < 48` | 满盘母题 + 底部面值带 + **区域徽标保留在 12 点**（`drawRegionBadge`，`br = R*0.15`，白圆衬底压在母题上，参数不变）；**ISO 走币外名称行 `ISO · 名称`**（B3） | 命中 **Board（R=34.9）** 与 **Detail 双形态槽（R=32）** |
| **T1 微缩** | `R < 30` | **仅满盘母题 + 区域色外环**（无带、无徽标、无币面文本） | 命中 **Codex 图鉴槽（R=20.8）**。身份完全由上下文文本承担：单元格顶部 `名称 · ISO`（B5）+ 槽下「硬币 / 纸币」标签 |

用户原话中的「ISO 仍作为权威身份保留在币面某处（如环上或**币上方**）」——T2/T1 采用的正是「币外」这一被明确许可的选项，且中文名对学习目标比 3 字母代码更有效。

### C6. 母题可见面积复核

| 档 | 带占内盘面积 | 母题可见 | 对比现状 23% |
|---|---|---|---|
| T3（顶带 8.6% + 底带 11.0%） | 19.5% | **80.5%** | ×3.5 |
| T2（仅底带 11.0%） | 11.0% | **89.0%** | ×3.9 |
| T1（无带） | 0% | **100%** | ×4.3 |

---

## D. 纸币对应改造（`drawFaceNote`）

### D1. 印刷视窗放大到整个内框

现状：`bandY = rect.y + rect.h*0.32`，`bandH = rect.h*0.4`，`bandX = rect.x + inset*1.5`，`bandW = rect.w - inset*3`。
改为**与双细线内框（`f2`）严格对齐**，占满整个印刷区：

```
faceH = rect.h - (showName ? nameH : 0)
inset = max(3, faceH * 0.05)
ix, iy, iw, ih = rect.x+inset, rect.y+inset, rect.w-inset*2, faceH-inset*2
f1    = min(4, ih*0.10)
f2    = f1 + min(2.5, ih*0.06)
bandX = ix + f2 ;  bandY = iy + f2
bandW = iw - f2*2;  bandH = ih - f2*2
```

Board 横屏实测（cardW=118.6, faceH=59.3）：视窗 **99.6 × 40.3**，
对比现状 `109.6 × 23.7` → **面积 +54%**，且高度 +70%（横带最缺的就是高度）。

保留 §5.6 的视窗描边（暗线压内侧 + 外侧纸色亮线），保留 §5.2 纸基渐变与 §5.4 双细线内框。

> ⚠️ 纸基可见区收窄为 `inset + f2 ≈ 9.5px` 的边距环。若真机走查判定「纸感丢失」，
> **回退旋钮**：`bandY += f2 * 1.5`、`bandH -= f2 * 1.5`，让视窗上方露出一条纸带。单参数可调，不改结构。

### D2. 母题 cover 裁剪（修拉伸 bug）

`drawFaceNote` L430–432 的 `ctx.drawImage(image, bandX, bandY, bandW, bandH)` 换成 `drawCover`：

```
ctx.save()
roundRectPath(ctx, bandX, bandY, bandW, bandH, bandH*0.22); ctx.clip()
ctx.fillStyle = v.signature; ctx.fillRect(bandX, bandY, bandW, bandH)
if (image) drawCover(ctx, image, bandX, bandY, bandW, bandH)
else drawMotifGeometry(ctx, v.motif, bandX+bandW/2, bandY+bandH/2, min(bandW,bandH)*0.42)
ctx.restore()
```

2048×1024 源图进 99.6×40.3 视窗：`s = max(99.6/2048, 40.3/1024) = 0.0486`，
`dw=99.6, dh=49.8`（>40.3，纵向溢出 9.5px 被 clip 吃掉），**横纵等比、零变形**。
圆角从 `bandH*0.3` 收到 `bandH*0.22`（视窗变高后 0.3 会显得过圆）。

### D3. 面额 →「印压面值牌」

面额不再是左下裸文本（现状 L464–470），改为一枚**压在视窗右下角的印压小牌**：

```
chipH  = clamp(bandH * 0.34, 11, 20)
chipFs = clamp(chipH * 0.62, 8, 13)
label  = v.denom + ' ' + v.denomSymbol
chipW  = measureText(label, chipFs bold) + chipH * 0.80        // 左右各 0.4*chipH 内边距
chipX  = bandX + bandW - bandH*0.10 - chipW
chipY  = bandY + bandH - bandH*0.10 - chipH
radius = chipH * 0.32
```

绘制（与 C3 同一套材质语言）：

1. `roundRectPath(chip)` → `fillStyle = BAND_COLORS[v.region]` → `fill()`
2. 受光渐变（同 C3 ③，方向 135°）
3. 上唇暗线 `rgba(0,0,0,0.26)` + 下唇亮线 `rgba(255,255,255,0.28)`，各 1px，沿 chip 内缘
4. 浮雕文本两遍 `fitText`：`rgba(0,0,0,0.42)` @ `y+1`，然后 `#FDFAF3` @ `y`；
   `align:'center'`，`x = chipX + chipW/2`，`y = chipY + chipH/2`，`baseline:'middle'`，`maxWidth = chipW - chipH*0.5`

对比度沿用 C4 表（同色同字），三区域全部 ≥ 4.5:1。

### D4. ISO →「印压身份牌」（左上镜像）

同款 chip，放在视窗**左上角**，`chipH = clamp(bandH*0.28, 10, 17)`（比面值牌小一档，面值优先级更高）：

```
chipX = bandX + bandH*0.10
chipY = bandY + bandH*0.10
```

内容 = `v.iso`，其余材质/浮雕/对比度完全同 D3。

### D5. 区域徽标位置

现状 `drawRegionBadge(..., stamp=true)` 在 `rect` 右上角的纸边距上（L451–452）。视窗放大后那里只剩 9.5px 边距，放不下。
**移入视窗右上角**，且必须改用**奶油实心衬底圆**（`#FDFAF3`）而非 `stamp` 模式——`stamp` 的 0.15 透明底压在母题上会糊：

```
br = bandH * 0.17
drawRegionBadge(ctx, v.region, bandX + bandW - bandH*0.12 - br, bandY + bandH*0.12 + br, br, false)
```

`stamp=false` 分支（`card.ts` L83–88）画的正是白圆衬底 + 区域色洲形状，只需把 `'#FFFFFF'` 改为 `THEME.panel` 暖白，与整体色调一致。

### D6. 视窗四角占位总览

```
┌──────────────────────────────┐
│ [ISO牌]                 (徽标)│
│                              │
│        母题 cover 满铺        │
│                              │
│                      [面值牌] │
└──────────────────────────────┘
        ↓ 币外
      ISO · 币种名（仅 Board）
```

左上 ISO / 右上区域徽标 / 右下面值 —— 三角分布，中央大片留给母题。

### D7. 纸币分档（按 `faceH`）

| 档 | 条件 | 视窗内元素 | 命中 |
|---|---|---|---|
| **T3** | `faceH ≥ 58` | ISO 牌 + 区域徽标 + 面值牌 + 满铺母题 | Board 横屏（59.3）、Detail 双形态槽（64） |
| **T2** | `46 ≤ faceH < 58` | 区域徽标 + 面值牌（省 ISO 牌） | 缓冲档，当前无上下文命中 |
| **T1** | `faceH < 46` | 仅满铺母题 + 区域色边框带 + 双细线内框 | Codex 图鉴槽（41.6） |

---

## E. 实现映射表

### E1. `src/render/card.ts`

| 项 | 现状行号 | 改动 | 性质 |
|---|---|---|---|
| A · 母题半径 | L318 `const mr = R * 0.46;` | 删除，改用 `Rin = R - inset`（`inset` 已在 L248 算出） | 改 1 行 |
| A · 母题圆心 | L319–320 `mcx/mcy = cy - R*0.08` | 改为与内盘同心 `(cx, cy)` | 改 2 行 |
| A · cover 裁剪 | L321–332（clip + fillRect + drawImage 5 参） | `drawImage` 换 `drawCover(...)`，绘制框 `Rin*2*MOTIF_OVERSCAN`；几何占位 `mr*0.9` → `Rin*0.78` | 改 ~6 行 |
| A · 珐琅内阴影 | L334–348 | 半径 `mr` → `Rin`，线宽系数 `mr*0.05` → `Rin*0.035`（半径放大后原系数会过粗） | 改 3 处常数 |
| B · 名称行 | 新增（`drawFaceCoin` 末尾） | 按 B3 绘制；`R` 的计算（L247）改为扣除 `nameH` | 新增 ~10 行 + 改 1 行 |
| C · 面值印压带 | **替换** L363–370（现面额 `fitText`） | 按 C2/C3 绘制弦带 + 浮雕数字 | 替换 ~25 行 |
| C · ISO | **替换** L354–362（现 ISO `fitText`） | T3 走顶部身份带；T2/T1 从币面移除（进名称行 / 上下文） | 替换 ~10 行 |
| C · 区域徽标 | L350–352 | T3 移入顶带；T2 保持不变；T1 不绘制 | 加分档条件 |
| D1 · 视窗几何 | L421–424 | 按 D1 公式重算 `bandX/Y/W/H`；新增 `faceH` | 改 4 行 |
| D2 · 母题 cover | L425–435 | 换 `drawCover` + 圆角 `0.3→0.22` | 改 ~4 行 |
| D3 · 面值牌 | **替换** L464–470 | 按 D3 绘制 chip | 替换 ~20 行 |
| D4 · ISO 牌 | **替换** L455–462 | 按 D4 绘制 chip | 替换 ~15 行 |
| D5 · 区域徽标 | L451–452 | 移入视窗右上，`stamp=true → false` | 改 2 行 |
| D5 · 徽标衬底色 | L86 `ctx.fillStyle = '#FFFFFF'` | 改 `THEME.panel` | 改 1 行 |
| B · 纸币名称行 | 新增（`drawFaceNote` 末尾） | 按 B4 绘制 | 新增 ~10 行 |
| — · 常量表 | 文件头 | 新增 `BAND_COLORS`（C4 三色）、`MOTIF_OVERSCAN = 1.02`、分档阈值常量 | 新增 ~8 行 |

**`drawCard` / `drawFace` 的函数签名不变**，改动全部封闭在两个 `drawFace*` 内部 + 类型扩展。

### E2. `src/render/layout.ts`

| 项 | 现状行号 | 改动 |
|---|---|---|
| coin 分支 | L53–57 | **不改**（名称行在 card.ts 内部消化，cell 尺寸与命中矩形保持原样） |
| note 分支 | L58–66 | 按 B4 改写：引入 `nameH`，`cellH = faceH + nameH`，二次收敛 |
| `BoardLayout` | L20–25 | 新增 `nameH: number` |

### E3. `src/render/types.ts`

| 项 | 现状行号 | 改动 |
|---|---|---|
| `CardVisual` | L10–18 | 新增 `name: string` |
| `CardDrawOpts` | L20–31 | 新增 `showName?: boolean`、`nameH?: number` |

### E4. `src/render/theme.ts`

| 项 | 改动 |
|---|---|
| 新增 `drawCover(ctx, img, x, y, w, h)` | A3 公式；**与 `scene-backgrounds-spec.md` §4.3 共用同一个函数**，两份规格只实现一次 |
| 新增 `BAND_COLORS: Record<Region, string>` | C4 三色（也可放 card.ts，建议放 theme 与 `REGION_COLORS` 相邻） |

### E5. 调用点

| 文件 | 改动 |
|---|---|
| `renderer.ts` L20–38 `toVisual()` | 补 `name` |
| `renderer.ts` L74–88 卡牌循环 | `drawCard` 传 `showName: true`、`nameH: layout.nameH` |
| `codex.ts` L54 | 文本改 `` `${c.name} · ${c.iso}` `` |
| `codex.ts` L74–75 | `CardVisual` 补 `name: c.name`；`drawCard` 不传 `showName` |
| `detail.ts` L51–59 / L146 | `CardVisual` 补 `name: c.name`；两处 `drawCard` 不传 `showName` |

### E6. 文本通路确认

**是——B/C/D 所有文本一律走 `fitText`**，包括：币外名称行、弦带面额（两遍）、顶带 ISO（两遍）、纸币两枚 chip（各两遍）。
理由：`fitText`（`theme.ts` L83–132）已内建「按 `maxWidth` 缩字号 → 到 `minSize` 仍不下则省略号」两级保护，是本项目防溢出的唯一通路。新增绘制**不得**开裸 `fillText` 分支。
唯一例外是浮雕的「暗底遍」——它也是 `fitText`，只是参数除 `color`/`y` 外与主遍完全一致。

---

## F. 与现有代码的冲突点 / 风险

| # | 冲突点 | 影响 | 处置 |
|---|---|---|---|
| **X1** | `Ctx2DLike.drawImage` 只声明 **5 参**（`types.ts` L59），无 9 参裁剪重载 | cover 裁剪不能用源矩形 | **已规避**：A3 的 `drawCover` 用「放大 + 居中 + clip」实现 cover，只需 5 参。**无需改平台接口** |
| **X2** | `Ctx2DLike.arc` 无 `anticlockwise` 参数（L38） | 无法用标准方式描环带扇形路径 | **已规避**：C1 改用「双 clip 求交」的弦带。若日后想升级为弧形绶带，需给 `arc()` 补可选第 6 参（一行），并同步 `browser.ts` / `wechat.ts` |
| **X3** | 母题 PNG 带 15%–30% 透明留白 | 只改 `mr` 无法真正填满 | A2 路线 1：出图后处理做 alpha bbox 裁切 + 补方。**这是 A 项能否达成用户预期的关键前置**，需在改 `card.ts` 之前完成 |
| **X4** | `CardVisual` 无 `name` 字段 | B 项无数据源 | E3 扩类型 + E5 四处构造点补值。**跨 4 个文件的破坏性类型变更**，TS 会全量报错定位，风险可控 |
| **X5** | `layout.ts` note 分支改动影响命中矩形 | `rect.h` 含名称行 → 点击区变高 | 对玩法**有利**（更好点）。但 `renderer.ts` L86 `hits.push({rect, ...})` 用的是同一个 rect，无需额外改动 |
| **X6** | Codex coin 槽 R=20.8 落入 T1 | 图鉴里的硬币**没有面额显示** | 可接受：Codex 单元格是"索引"，点进 Detail 才是"详情"，Detail 的四层识别码列表（L116）已明确列出面额。若产品侧坚持要，唯一解是加大 `codex.ts` L64 的 `slotH`（0.4 → 0.5）并同步加大 `cellH`（104 → 118），需与文策渊确认信息密度 |
| **X7** | 与 `game-feel-direction.md` §4.4/§4.5 的关系 | 内盘穹面渐变（L280–287）在母题满盘后**几乎完全被遮住** | 保留代码（母题缺失时是兜底），但需知晓：§4.4 的视觉贡献从"内盘主质感"降为"边缘 1–2px 的过渡"。§4.2 倒角双线、§4.3 金属双弧**不受影响**（都在 `Rin` 之外或压在最上层） |
| **X8** | 纸币纸基可见面积锐减 | §5.2 纸基渐变只剩 9.5px 边距环 | 已给 D1 回退旋钮（`bandY += f2*1.5`）。真机走查后由美术侧拍板 |
| **X9** | `drawMotifGeometry` 占位尺寸 | 母题放大后，PNG 缺失时的几何占位会显得很小 | A3 已同步把占位从 `mr*0.9` 放大到 `Rin*0.78`；`drawMotifGeometry` 内部的 `lineWidth = max(1.5, size*0.08)` 会自动跟随，无需改该函数 |
| **X10** | Board 名称行落在场景背景上 | 与 `scene-backgrounds-spec.md` 的 `bg_board` 叠加 | 对比度已核（ink on `#E6DCC9` > 8:1）。但**两份规格必须同批上线并一起走查**，否则名称行可能压在背景图的深色道具上 |
| **X11** | 翻牌动画 | `drawCard` L483–487 对整个 rect 做水平挤压 | 名称行在 rect 内（coin）或 rect 内（note，`cardH` 含名称行）→ **会跟着一起挤压**。这是正确行为（名字是卡的一部分），但需真机确认挤压中段名称不会闪烁。若观感差，把名称行绘制移到 `drawCard` 的 `flip` 变换**之外** |

---

## G. 验收清单

- [ ] Board 硬币：母题主体明显抵到币缘，签名色空白区目测 < 15%
- [ ] Board 硬币：下缘有一条区域色深压带，奶油面额数字清晰可读（@2x 真机）
- [ ] Board 硬币：币外下方一行 `ISO · 中文名`，不溢出 cell、不与下一行卡碰撞
- [ ] Board 硬币：8 币种逐一确认 —— 鹦鹉/犀牛剪影主体未被印压带切掉头部，富士山尖未被区域徽标压住
- [ ] Detail 身份大卡（T3）：顶带徽标+ISO、底带面额，两带对称
- [ ] Codex 槽（T1）：只有满盘母题 + 区域色外环，单元格标题为 `名称 · ISO`
- [ ] 纸币：视窗满铺、母题**无横向拉伸**（对比改前截图）
- [ ] 纸币：左上 ISO 牌 / 右上区域徽标 / 右下面值牌三角分布，不重叠
- [ ] 三区域面值带的奶油字对比度实测 ≥ 4.5:1（取色器）
- [ ] 无任何真实钞币 / 硬币 / 国旗 / 人脸 / 防伪元素
- [ ] 翻牌动画中名称行无闪烁 / 错位
- [ ] 四个上下文（Board / Codex / Detail 大卡 / Detail 槽）分档正确，无文本溢出

---

*本文档为纯设计规格，不含任何游戏代码，也不重出任何母题图。落地实施由工程负责人按 §E 映射表执行，前置依赖为 §A2 的资产后处理。实施后需真机截图回传美术侧做一轮走查（重点：母题填充度、面值带对比度、名称行防溢出、纸币视窗比例）。本规格与 `scene-backgrounds-spec.md` 共用 `drawCover()` 辅助，建议同批上线。*
