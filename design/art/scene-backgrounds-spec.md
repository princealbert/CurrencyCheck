# 场景背景出图规格（Scene Backgrounds Spec）

> 适用项目：《货币图鉴·对对碰》纯 TS + Canvas 2D 微信小游戏
> 出图后端：火山方舟 Seedream（`tools/image_generator/volcano_ark.py`）
> 上游文档：`design/art/game-feel-direction.md` §3（程序化背景配方）、`design/art/seedream-pipeline.md`（母题出图管线）、`design/art/currency-stylization-strategy.md`
> 本轮定位：在 §3「渐变 + 暗角」之上**补一层真实场景插画底**，解决「各视图只有单色/渐变背景、画面空」的问题。

---

## 合规声明（本文件内所有资产的铁律）

> 本规格下的全部场景与装饰资产，**均为装饰性的「旅行 / 收藏」意象插画**，
> **不含任何真实钞币图样、真实硬币图样、国旗、国徽、人物头像、防伪元素（水印 / 安全线 / 凹版底纹 / 缩微文字 / 全息 / 团花）**。
> 场景中出现的「书册 / 地图 / 邮票纸片 / 指南针 / 地球仪」等均为**虚构的、几何风格化的道具**，不指向任何真实国家、品牌、机构或出版物。
> 地球仪与地图上的「大陆块」为**抽象色块**，不得绘制可辨识的真实国界线、国名或行政区划。
> 每条正向提示词均以 `no text / no letters / no numbers` 结尾；每条负向提示词均继承 `NEG_BASE`（见 §1.4）。
> 违反上述任一条的候选图**一律废弃重出**，不得进入 `minigame/assets/`。

---

## 0. 资产总表

| # | 文件名 | 场景主题 | Seedream 尺寸 | 落盘尺寸 | 透明通道 | 用途 |
|---|---|---|---|---|---|---|
| 1 | `bg_hub.png` | 旅行者书桌 / 摊开的环球图册 + 皮质收藏册（俯视平铺） | `9:16` → 1440×2560 | **780×1688** | 无 | Hub（S1）全屏底 |
| 2 | `bg_board.png` | 绒面游戏垫 / 木质桌面（俯视，中亮四暗） | `9:16` → 1440×2560 | **780×1688** | 无 | Board（S2）全屏底 |
| 3 | `bg_codex.png` | 暖木书架 / 册页（三格书架意象） | `9:16` → 1440×2560 | **780×1688** | 无 | Codex（S3）全屏底 |
| 4 | `bg_detail.png` | 环球地图 / 地球仪柔焦聚焦台 | `9:16` → 1440×2560 | **780×1688** | 无 | Detail（S5）全屏底 |
| 5 | `deco_globe.png` | 扁平矢量地球仪（经纬线 + 抽象大陆块） | `1:1` → 2048×2048 | **512×512** | **有** | 各视图角标 / 点缀叠加 |

存放路径：`minigame/assets/`（与母题 PNG 同级，随 `build.mjs copyAssets()` 自动进包）。

---

## 1. 通用规范

### 1.1 风格锚（必须与 16 张母题 PNG 同族）

母题 PNG 的既有风格串（摘自 `generate_currency_tokens.py build_prompt()`）：

```
flat geometric, minimal, clean vector-like, single flat color with one accent stroke, game asset
```

背景资产在此基础上**只加两个词**，其余不变：

```
soft game-UI illustration, gentle ambient lighting
```

**共用风格串（STYLE_BASE，五条资产逐字复用）**：

```
flat geometric, minimal, clean vector-like, soft game-UI illustration, single flat color per object
with one accent stroke, gentle ambient lighting, soft long shadows, no outline noise, game asset
```

判定标准：把新背景缩到 200px 宽，与任意一张 `cur_*.png` 并排，**边缘硬度、色彩饱和度、投影柔度三项必须读作同一套笔法**。任一项明显偏离即废弃重出。

### 1.2 调色板（严格锁定，禁止扩色）

| 角色 | Hex | 在提示词中的写法 |
|---|---|---|
| 主底（奶油白） | `#F8F5F0` | `warm cream #F8F5F0` |
| 强调一（陶土红） | `#D89575` | `terracotta #D89575` |
| 强调二（青绿） | `#87A878` | `sage teal #87A878` |
| 强调三（金） | `#E0B15E` | `warm gold #E0B15E` |
| 深色（墨，仅用于极少量线条） | `#3A3A38` | `deep ink #3A3A38` |

**禁止**出现纯黑、纯白、荧光色、冷灰蓝（`#5B8FB0` 是欧洲区域色，属于**卡面身份色**，背景中不得大面积使用，避免与区域识别争夺语义）。

### 1.3 出图参数（`volcano_ark.py generate()` 建议值）

```
size            = "9:16"（bg_*）/ "1:1"（deco_globe）
num_images      = 4        # 每张出 4 张候选，人工挑 1
watermark       = False
style_strength  = 8        # 插画档（harness 推荐值）
detail_level    = 5        # 背景要「安静」，细节档比母题(7-9)低
guidance_scale  = 7
```

`detail_level` 压到 5 是本轮的关键护栏：**背景一旦细节多就会和卡牌抢眼**。

### 1.4 负向提示词基线（NEG_BASE，五条资产共用）

```
no realistic banknote, no coin replica, no currency, no money, no flag, no national emblem,
no text, no letters, no numbers, no watermark, no security thread, no hologram,
no human face, no people, no hands, no photorealistic, no photograph, no detailed texture,
no heavy contrast, no dark background, no busy clutter, no vignette burn, no lens flare,
no 3d render, no realistic wood grain photo, no noise grain
```

每条资产在此之后追加自己的 `neg_extra`（见 §2）。

### 1.5 后处理（出图 → 落盘）

```
① Seedream 直出            1440×2560 (9:16) / 2048×2048 (1:1)
② 按高缩放                 → 949×1688（Pillow LANCZOS）
③ 居中横裁                 → 780×1688   （裁掉左右各 ~85px，故构图必须遵守 §1.6 安全区）
④ 量化压缩                 pngquant --quality 65-85（256 色）
⑤ 体积门槛                 bg_*  ≤ 300 KB；deco_globe ≤ 60 KB
```

`deco_globe.png` 跳过 ②③，直接 2048×2048 → 512×512，保留 alpha。

> **体积是硬约束**：微信小游戏主包上限 4 MB。当前 `minigame/assets/` 16 张母题 PNG 已占约 **22 MB**（单张 0.8–2.4 MB），**已经超包**。5 张背景即便压到 300 KB 也只是 1.5 MB 增量，真正的问题在母题图。见 §5 风险 R1。

### 1.6 构图安全区（因 §1.5 步骤 ③ 会横裁 18% 宽度）

- **左右各 10% 宽度视为「可牺牲区」**：不得放置任何构图重心。
- **中央 80% 宽 × 全高**为有效画面。
- 各资产另有自己的「UI 让位区」，见 §2 逐条。

---

## 2. 逐资产规格

---

### 2.1 `bg_hub.png` —— Hub 收藏册封面

| 项 | 值 |
|---|---|
| 场景主题 | 温暖的旅行者书桌俯视平铺：摊开的环球图册 + 皮质收藏册，周边散落书签、邮票纸片、指南针等旅行小物 |
| 视角 | 严格俯视（top-down flat lay），无透视灭点 |
| 尺寸 | Seedream `9:16` → 落盘 780×1688 |
| UI 让位区 | **垂直 6%–78% 的中央区域必须近乎空白**（Hub 的标题、进度条、形态选择、两颗大按钮全在这段）。道具一律靠上缘 0–6%、下缘 78%–100% 与左右边缘分布 |

**正向提示词**

```
Top-down flat-lay illustration of a traveler's writing desk: an open world atlas book with abstract
continent color blocks, a leather-bound collector's album with an embossed circular badge, a few
loose bookmarks and ribbon tails, several blank perforated paper stamp squares, a small round
compass, a rolled paper map tied with string, a dried leaf, strips of washi tape;
generous empty warm cream space through the vertical center of the frame;
flat geometric, minimal, clean vector-like, soft game-UI illustration, single flat color per object
with one accent stroke, gentle ambient lighting, soft long shadows, no outline noise, game asset;
warm cream #F8F5F0 base, terracotta #D89575 / sage teal #87A878 / warm gold #E0B15E accent palette,
deep ink #3A3A38 used only for the thinnest linework;
vertical 9:16 composition, calm and airy, no text, no letters, no numbers.
```

**负向提示词** = `NEG_BASE` + 

```
, no globe in the center, no compass needle text, no map labels, no country borders, no city names,
no open book pages full of writing, no coins on the desk, no wallet, no purse, no clock face numbers
```

**风格一致性说明**
- 所有道具用「单一平涂色 + 一道强调描边」，与母题 PNG 的 `single flat color with one accent stroke` 同构。
- 投影统一为柔长影、方向 135°（左上打光），与代码侧全局光源（`game-feel-direction.md` §4.1）一致。
- 图册的「大陆块」必须是**抽象圆角色块**，不得可辨识为真实大洲轮廓（合规 + 与卡面 `REGION_STYLE` 的形状编码不冲突）。

**合成指引**
- 底图整体不透明度 **α = 0.92 ~ 1.00**（推荐 **0.95**）。Hub 是「封面」，可以最实。
- 其上叠奶油统一膜 `rgba(248,245,240,0.10)`，把插画拉回调色板。
- 再叠 Hub 暗角（沿用 §3.1 配方，上限从 0.06 提到 **0.10**）：径向渐变，圆心 `(vp.w/2, vp.h*0.42)`，内半径 `min(w,h)*0.45` 处 `rgba(90,70,40,0)` → 外半径 `对角线*0.75` 处 `rgba(90,70,40,0.10)`。
- **标题保护**：`货币图鉴` 直接压在插画上，需在标题绘制前加一层局部光晕——径向渐变，圆心 `(vp.w/2, safe.top+52)`，半径 `vp.w*0.42`，`rgba(253,251,246,0.72) → rgba(253,251,246,0)`。这条是**对比度硬要求**，不可省。

---

### 2.2 `bg_board.png` —— 对局牌桌

| 项 | 值 |
|---|---|
| 场景主题 | 柔和绒面游戏垫铺在木质桌面上，俯视；中央略亮、四周渐暗，卡牌读作「摆在桌上」 |
| 视角 | 严格俯视 |
| 尺寸 | Seedream `9:16` → 落盘 780×1688 |
| UI 让位区 | **中央 78% 宽 × 62% 高必须是近乎均匀的绒面**（4×4 棋盘落在这里）。任何图案、缝线、木纹接缝只能出现在这块之外 |

**正向提示词**

```
Top-down illustration of a soft felt game mat laid on a warm wooden table, seen from directly above;
the felt mat occupies most of the frame with a large calm even center and softly darker edges,
a subtle stitched border runs along the mat's outline, a narrow band of smooth warm wood is visible
at the very top and very bottom edges of the frame;
flat geometric, minimal, clean vector-like, soft game-UI illustration, single flat color per object
with one accent stroke, gentle ambient lighting, soft long shadows, no outline noise, game asset;
warm cream #F8F5F0 and muted sage teal #87A878 felt, terracotta #D89575 stitching accent,
warm gold #E0B15E hairline trim;
extremely low contrast, quiet, almost empty in the center,
vertical 9:16 composition, no text, no letters, no numbers.
```

**负向提示词** = `NEG_BASE` + 

```
, no cards, no playing cards, no dice, no game pieces, no chips, no tokens, no board grid,
no pattern in the center, no fabric weave close-up, no strong wood grain lines, no objects on the mat
```

**风格一致性说明**
- 这张是五张里**最安静**的一张：`detail_level` 建议进一步压到 **4**。对局中背景一旦有花纹，16 张卡的一眼区分度会崩。
- 绒面色务必偏灰绿（`#87A878` 去饱和后），不得与卡面亚非区域色（同为 `#87A878`）纯度接近——通过「背景低饱和 + 卡面高饱和」拉开层级。

**合成指引**
- 底图整体不透明度 **α = 0.80 ~ 0.90**（推荐 **0.85**）。Board 要最退让。
- 叠奶油统一膜 `rgba(248,245,240,0.14)`。
- 再叠 Board 暗角（§3.2 配方加深）：径向渐变，圆心屏幕中心，`0.30*对角线` 处 `rgba(58,58,56,0)` → `0.50*对角线` 处 `rgba(58,58,56,0.18)`（原 0.10 → **0.18**，把视线牢牢收进牌桌）。
- 与既有的横屏提示遮罩（0.55）、胜利结算遮罩（0.62）互不冲突——两者更深，会整体盖住。

---

### 2.3 `bg_codex.png` —— 图鉴书架

| 项 | 值 |
|---|---|
| 场景主题 | 暖色木质书架 / 册页；三区域可想象为三格书架 |
| 视角 | 正视（平视书架立面），无强透视 |
| 尺寸 | Seedream `9:16` → 落盘 780×1688 |
| UI 让位区 | 图鉴内容**纵向滚动、背景固定**，所以任何强横线都会和滚动内容"对不上"。因此：**架板横线只允许出现在画面最上 12% 与最下 12%**；中段 12%–88% 只能是低频的木色渐变与极淡竖向纹理 |

**正向提示词**

```
Front view illustration of a warm wooden bookcase interior, gentle and out of focus;
one soft horizontal shelf plank hinted near the very top edge and one near the very bottom edge,
the large middle area is a calm smooth warm wood panel with only faint soft vertical grain suggestions;
a few very subtle rounded book spines and a folded paper page tucked into the top corners;
flat geometric, minimal, clean vector-like, soft game-UI illustration, single flat color per object
with one accent stroke, gentle ambient lighting, soft long shadows, no outline noise, game asset;
warm cream #F8F5F0 page tone over warm gold #E0B15E and terracotta #D89575 wood tones,
sage teal #87A878 as a single small accent;
low contrast, airy, vertical 9:16 composition, no text, no letters, no numbers.
```

**负向提示词** = `NEG_BASE` + 

```
, no book titles, no spine labels, no shelf in the middle of the frame, no repeating horizontal lines,
no strong perspective, no ladder, no plants, no lamp, no realistic wood grain, no dense bookshelf
```

**风格一致性说明**
- 「三格书架」是**语义暗示而非画面结构**：真正的三区域分隔由 `codex.ts` 既有的「架板横线 + 区域色印章点」（§3.3）绘制，随内容滚动。背景只提供木色氛围。
- 若出图给出了中段横线，属于**不合格候选**，必须重出——这是本条最容易翻车的点。

**合成指引**
- 底图整体不透明度 **α = 0.88 ~ 0.95**（推荐 **0.92**）。
- 叠奶油统一膜 `rgba(248,245,240,0.12)`。
- Codex 暗角沿用 §3.1（上限 **0.08**），比 Hub 略轻——图鉴要「翻得下去」，四角不能太压。
- **既有 §3.3 架板横线与区域印章点全部保留**，它们绘制在背景之上、单元格之下，是滚动内容的一部分。

---

### 2.4 `bg_detail.png` —— 详情聚焦台

| 项 | 值 |
|---|---|
| 场景主题 | 环球地图 / 地球仪柔焦场景，四周压暗，中央亮出一块「展台」 |
| 视角 | 平视柔焦，景深虚化感（用色块柔边模拟，不用真实模糊） |
| 尺寸 | Seedream `9:16` → 落盘 780×1688 |
| UI 让位区 | Detail 是**长滚动页**（身份卡 → 四层识别码 → 现实锚 → 双形态槽 → 文化）。背景固定不滚。要求：**上 1/3 有明确亮心**（身份大卡落点），中下段为均匀暖底，避免与滚动文本抢读 |

**正向提示词**

```
Soft-focus illustration of a study corner with a large stylized globe standing to one side and a
faded world map field behind it, rendered as abstract rounded continent color blocks on a warm
cream field, thin latitude and longitude arcs, everything gently blurred and low contrast;
a bright soft pool of light in the upper third of the frame, edges of the frame falling into warm shade;
flat geometric, minimal, clean vector-like, soft game-UI illustration, single flat color per object
with one accent stroke, gentle ambient lighting, soft long shadows, no outline noise, game asset;
warm cream #F8F5F0 base, sage teal #87A878 and terracotta #D89575 continent blocks,
warm gold #E0B15E meridian arcs;
vertical 9:16 composition, no text, no letters, no numbers.
```

**负向提示词** = `NEG_BASE` + 

```
, no country borders, no country names, no city dots, no recognizable coastlines, no compass rose text,
no latitude numbers, no realistic earth photo, no satellite image, no dark navy ocean, no bright white highlight
```

**风格一致性说明**
- 「柔焦」用**大色块 + 柔边**表达，不得使用高斯模糊质感（会与母题 PNG 的硬边矢量感割裂）。
- 大陆块必须抽象到「看得出是地球但认不出是哪」的程度——这是合规线。

**合成指引**
- 底图整体不透明度 **α = 0.85 ~ 0.95**（推荐 **0.90**）。
- 叠奶油统一膜 `rgba(248,245,240,0.12)`。
- 聚焦压暗（§3.4 配方加深）：径向渐变，圆心 = **身份大卡中心**（`areaX + cardSize/2, headerBottom + cardSize/2`，注意要用**未加 `codexScroll` 偏移**的固定屏幕坐标），内半径 `cardSize*1.25` 处 `rgba(58,58,56,0)` → 外缘 `对角线` 处 `rgba(58,58,56,0.22)`（原 0.12 → **0.22**）。
- 保留 §3.4 的「展台接触影」椭圆。

---

### 2.5 `deco_globe.png` —— 地球仪装饰件

| 项 | 值 |
|---|---|
| 场景主题 | 扁平矢量地球仪：球体 + 经纬线 + 抽象大陆块 + 简化底座支架 |
| 尺寸 | Seedream `1:1` → 落盘 **512×512**，**保留透明背景** |
| 用途 | 各视图角标 / 点缀叠加（非全屏底） |

**正向提示词**

```
A single stylized desk globe icon, perfectly centered, filling the frame edge to edge with minimal margin:
a sphere with a few thin latitude and longitude arcs and three or four abstract rounded continent
color blocks, sitting on a simple slim curved stand;
flat geometric, minimal, clean vector-like, soft game-UI illustration, single flat color per object
with one accent stroke, gentle ambient lighting, no outline noise, game asset;
sage teal #87A878 and terracotta #D89575 continent blocks on a warm cream #F8F5F0 sphere,
warm gold #E0B15E meridian arcs and stand;
transparent background, square 1:1 composition, no text, no letters, no numbers.
```

**负向提示词** = `NEG_BASE` + 

```
, no country borders, no country names, no recognizable continents, no realistic earth,
no background scene, no shadow on ground, no desk, no drop shadow, no white background, no frame
```

**风格一致性说明**
- 这是唯一一件**前景装饰**，风格必须与母题 PNG **完全同级**（同样的 transparent background + 边到边构图）。
- 出图后必须做 **alpha bbox 裁切 + 补方**（`im.crop(im.getbbox())` → 居中补到正方），保证运行时按 512 方图绘制时主体真正撑满——这与 `coin-redesign-spec.md` §A2 的母题裁切要求是同一条工艺。

**合成指引（三处点缀，均为可选装饰层，缺失不影响功能）**

| 位置 | 尺寸 | 不透明度 | 说明 |
|---|---|---|---|
| Hub 右下角 | `边长 = min(vp.w,vp.h)*0.18`，锚点 `(vp.w - safe.right - 20 - size, vp.h - safe.bottom - 56 - size)` | **α = 0.45 ~ 0.60**（推荐 0.52） | 压在合规提示小字之上、按钮之下 |
| Codex 头部标题左侧 | `边长 = 22`，锚点 `(vp.w/2 - 标题半宽 - 30, safe.top + 17)` | **α = 0.70 ~ 0.85**（推荐 0.78） | 作为「图鉴」二字的图标伴生 |
| Detail 背景中心水印 | `边长 = vp.w*0.62`，居中于 `(vp.w/2, vp.h*0.55)` | **α = 0.06 ~ 0.12**（推荐 0.08） | 绘制在 `bg_detail` 之上、内容之下，加强「环球」母题 |

---

## 3. 合成管线（renderer 侧）

### 3.1 绘制层序（严格按序，每层可独立降级）

```
L0  drawBackdrop(ctx, vp, kind)        ← 既有渐变 + 暗角，保留！这是背景图缺失时的兜底
L1  场景底图 cover-fit 全屏             ← globalAlpha = 见各资产「合成指引」
L2  奶油统一膜 fillRect                 ← rgba(248,245,240, 0.10~0.14)
L3  视图暗角 / 聚焦压暗                 ← 见各资产，Board 0.18 / Detail 0.22 / Hub 0.10 / Codex 0.08
L4  deco_globe 点缀（可选）
L5  视图内容（drawHub / drawBoard / drawCodex / drawDetail）
```

**L0 必须保留**：`app.imageFor()` 风格的异步加载在首帧一定是 `undefined`，且弱网 / 资源缺失时会永远 `undefined`。保留 L0 意味着**背景图是纯增益，零回归风险**。

### 3.2 cover-fit（不要平铺！）

场景图是**有构图的整图**，`createPattern('repeat')` 平铺会出现可见接缝并破坏构图。正确做法是 **cover 铺满 + 居中裁切**，且**只用现有 `Ctx2DLike` 的 5 参 `drawImage`** 即可实现，无需扩接口：

```
s  = max(vp.w / img.width, vp.h / img.height)
dw = img.width  * s
dh = img.height * s
dx = (vp.w - dw) / 2
dy = (vp.h - dh) / 2
ctx.drawImage(img, dx, dy, dw, dh)      // 超出视口的部分自然被画布裁掉
```

以 780×1688 源、390×844 逻辑视口为例：`s = 1/2`，`dw=390, dh=844, dx=0, dy=0` —— 正好整贴，无裁切。这是把落盘尺寸定为 780×1688（= 逻辑视口 @2x）的原因。

### 3.3 不透明度总表

| 视图 | L1 底图 α | L2 奶油膜 | L3 暗角上限 |
|---|---|---|---|
| Hub | 0.92 – 1.00（**0.95**） | 0.10 | 0.10 |
| Board | 0.80 – 0.90（**0.85**） | 0.14 | 0.18 |
| Codex | 0.88 – 0.95（**0.92**） | 0.12 | 0.08 |
| Detail | 0.85 – 0.95（**0.90**） | 0.12 | 0.22 |

调参口径：**先定 L3 暗角，再回调 L1**。判据是「卡牌 / 面板边缘是否仍然一眼跳出背景」，不是「背景好不好看」。

### 3.4 降级阶梯

| 情况 | 行为 |
|---|---|
| 背景图未加载完 / 加载失败 | 只画 L0+L3，视觉 = 当前版本，无任何异常 |
| 主包体积吃紧，只能保 1 张 | **优先保 `bg_hub.png`**（首屏第一印象）。其余视图退回 L0 |
| 真机走查发现背景抢眼 | 先降 L1 α 各 −0.10；仍抢眼则该视图退回 L0，不要靠加暗角硬压（会显脏） |
| 低端机掉帧 | 背景图每帧 `drawImage` 一次全屏，成本固定且低；若仍有压力，改为「视图切换时渲染到离屏 canvas 缓存」——需平台层 `createOffscreenCanvas`，见风险 R3 |

---

## 4. 实现映射表

| # | 内容 | 文件 / 位置 | 改动性质 |
|---|---|---|---|
| 4.1 | 背景图预加载（5 个 key） | `src/app/app.ts` `preloadImages()`（L211–228）后追加一个 `preloadScenes()`，沿用同样的 `platform.loadImage().then().catch()` 容错模式，存入同一个 `images` Map（key 用 `scene_hub` / `scene_board` / `scene_codex` / `scene_detail` / `deco_globe`） | 新增私有方法 + 构造器内调用 |
| 4.2 | 取图入口 | `src/app/app.ts` 新增 `sceneFor(view): ImageLike \| undefined`，与既有 `imageFor()`（L230–232）同构 | 新增方法 |
| 4.3 | cover-fit 辅助 | `src/render/theme.ts` 新增 `drawCover(ctx, img, x, y, w, h)`（§3.2 公式），供背景与卡面母题共用（`coin-redesign-spec.md` 也依赖它） | 新增导出函数 |
| 4.4 | 场景层绘制 | `src/render/theme.ts` 新增 `drawScene(ctx, vp, img, opts)`：内部按 L1→L2→L3 顺序绘制，`opts = { alpha, veil, vignette }` | 新增导出函数 |
| 4.5 | 顶层接入 | `src/render/renderer.ts` `drawApp()` L237：`drawBackdrop(...)` 一行**后面**插入 `drawScene(ctx, vp, app.sceneFor(app.view), SCENE_OPTS[app.view])`。**不要替换 `drawBackdrop`** | 插入 1 行 |
| 4.6 | Detail 聚焦压暗改为跟随大卡 | `src/render/detail.ts` `drawDetail()` L46 附近，在 `ctx.translate(0, app.codexScroll)` **之前**绘制聚焦径向渐变（固定屏幕坐标，不随滚动） | 视图内新增绘制 |
| 4.7 | Hub 标题光晕 | `src/render/hub.ts` `drawHub()` L36 `fitText('货币图鉴', ...)` **之前**插入径向渐变光晕（§2.1 合成指引） | 视图内新增绘制 |
| 4.8 | deco_globe 三处点缀 | `hub.ts`（右下角，L146 合规小字之前）/ `codex.ts`（L134 标题之前）/ `detail.ts`（L46 背景层） | 视图内新增绘制 |
| 4.9 | 出图脚本 | 新建 `tools/image_generator/generate_scene_backgrounds.py`：结构照抄 `generate_currency_tokens.py`（`SCENES` 列表 + `NEG_BASE` + `build_prompt/build_negative` + `download` + `maybe_resize`），但 `SIZE_MAP = {"bg": "9:16", "deco": "1:1"}`、`TARGET = {"bg": (780,1688), "deco": (512,512)}`，并新增 §1.5 的「按高缩放 + 居中横裁」步骤与 pngquant 调用 | 新建脚本（本轮不写，仅规格） |

---

## 5. 风险与决策点（落地前须由主理人 / 程基岩确认）

| # | 风险 | 说明 | 建议 |
|---|---|---|---|
| **R1** | **主包体积已超限** | `minigame/assets/` 现有 16 张母题 PNG 约 **22 MB**，微信小游戏主包上限 4 MB。背景资产（+1.5 MB）不是主因，但会让问题更早暴露 | **本轮必须同步处理**：① 母题 PNG 走 pngquant 量化（预计可压到 1/6～1/10）；② 或改为**远程加载 + 本地缓存**（`wx.downloadFile` + `wx.getFileSystemManager`）；③ 或拆分包。需程基岩定夺 |
| **R2** | 横裁损失构图 | §1.5 步骤 ③ 会裁掉左右各 ~9% | 已用 §1.6 安全区约束；若某张关键道具落在裁切区，改用「按宽缩放 + 上下裁」并同步改后处理脚本 |
| **R3** | 离屏缓存能力缺失 | 若要缓存合成后的背景，需平台层 `createOffscreenCanvas(w,h)`（`Platform` 接口当前没有） | 本轮**不需要**：全屏 `drawImage` 每帧一次成本很低，且已有 `dirty` 脏标记。仅在真机掉帧时才考虑扩接口 |
| **R4** | 背景 vs 卡面语义冲突 | `bg_board` 的绒面色与亚非区域色同为 `#87A878` | 已在 §2.2 用「背景低饱和 / 卡面高饱和」拉开；真机走查必须专门核对**亚非区绿卡在绿绒面上的一眼区分度** |
| **R5** | 文本对比度 | Hub 标题、Board 顶栏「得分/连击」、Hub 底部合规小字**直接压在背景图上**，不在 panel 内 | Hub 标题已有 §2.1 光晕方案；**Board 顶栏与 Hub 合规小字需在实施后实测**，若 < 4.5:1，给它们加同款局部光晕或改为半透明 panel 底 |
| **R6** | Codex 固定背景 vs 滚动内容 | 强横线会「对不上」滚动 | 已在 §2.3 用「中段禁横线」约束；这是该张图**唯一的废片判据**，验收时重点看 |
| **R7** | 出图不稳定 | Seedream 对「留白」「低细节」类指令服从度一般 | 每张出 4 候选人工挑 1；若 3 轮仍拿不到合格的 `bg_board`，退化方案 = 该视图只用 L0 程序化绒底（现状已可用） |

---

## 6. 验收清单

出图完成后逐条打勾，任一不过即重出：

- [ ] 五张图与任意母题 PNG 缩略并排，笔法读作同一套
- [ ] 无文字 / 数字 / 字母（含道具上的任何刻字）
- [ ] 无钞币、硬币、国旗、国徽、人脸、人手
- [ ] 无可辨识的真实国界 / 国名 / 海岸线
- [ ] 调色板只出现 §1.2 五色（取色器抽查 10 点）
- [ ] `bg_hub` 垂直 6%–78% 中央通道确为空
- [ ] `bg_board` 中央 78%×62% 无图案
- [ ] `bg_codex` 中段 12%–88% 无横线
- [ ] `bg_detail` 上 1/3 有明确亮心
- [ ] `deco_globe` 透明通道干净、主体撑满方图（alpha bbox 贴边）
- [ ] 落盘尺寸精确（780×1688 / 512×512）
- [ ] 体积达标（bg ≤ 300 KB，deco ≤ 60 KB）
- [ ] 接入后四视图各截一张真机图，卡牌 / 面板边缘仍一眼跳出背景

---

*本文档为纯设计规格，不含任何游戏代码。落地实施由工程负责人按 §4 映射表执行；出图由主理人调度 §4.9 脚本执行。实施后需真机截图回传美术侧做一轮氛围走查（重点：背景是否抢眼、文本对比度、Board 区域色区分度）。*
