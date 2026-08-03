# 《货币图鉴》Cocos Creator 3.x 移植架构 + 资产合成方案（规划）

> 文档类型：移植架构规划（非工程落地，不建工程、不写完整实现）
> 作者：程基岩（engineering-lead）· 游戏工程主程
> 日期：2026-07-27
> 引擎：**Cocos Creator 3.x（TypeScript）** · 导出目标：**微信小游戏**
> 依据：MVP 垂直切片（`mvp/`）、系统 GDD（`design/gdd/system-gdd.md` v1.0）、货币风格化策略 v2（`design/art/currency-stylization-strategy.md`）、质量门报告（已 PASS）
> 合规基线：风格化几何母题，绝无真实钞币图；ISO 4217 标识；区域双编码；MVP 不展示汇率（红线 1–4 全程适用）。

---

## 0. 移植原则与范围澄清

- **逻辑可移植、DOM 不可移植**：MVP `game.js` 中的纯逻辑（发牌去重、判定、连击计分、解锁幂等、`(iso, form)` 实体键）是「可玩设计契约」，原样迁为 `core/` 纯 TS；但所有 `document.createElement` / `innerHTML` / CSS `clip-path` 的**视图构建**必须重写为 Prefab + 组件组合。
- **MVP 实际网格 = 4×4（8 对）**，与 GDD §6.1 文字「3×4」不一致。本规划以**代码为准（4×4）**，并标记此文档口径差异待主理人/文策渊在 GDD 校正（见 §8 风险 R4）。
- **继承 MVP polish 已关闭的三项 P2**（QA 报告已 PASS）：B1 区域徽标统一中性白圆衬底、B2 note 横排放大关键文字、B3 已含 S5 详情页。Cocos 设计直接沿用，不回退。
- **美术分工边界**：Seedream 仅输出「母题质感」PNG（符号化、锚定真钞主色）；区域形状、ISO、面值由**代码绘制叠加**（清晰文字，不烤进 AI 图）。Seedream 提示词合规由 art-director 另出，本文仅界定集成方式。

---

## 1. 工程结构（Cocos 项目目录规划）

建议**单 Scene + UICanvas 子节点显隐**，视图（Hub / Pair / Codex / Detail）作为 UICanvas 下的同级容器节点，靠 `node.active` 切换——对齐 MVP `showView()` 仅切 `[hidden]` 的轻量模式，避免场景重载开销、利于 note-mode 同场景内切换横屏。

```
assets/
  scenes/
    Main.scene                 # 唯一场景；根节点 UICanvas（widget 适配）
  resources/
    currencies/               # Seedream 母题 PNG（透明底，按资产命名导入）
      cur_USD_100_amer_coin.png
      cur_CNY_100_asia_afr_note.png
      ...                      # 每 (iso, form) 一个文件
    shared/                   # 共享降 drawcall 资产
      noise_128.png           # 128px tiling 噪点（纸感 ≤4%）
      sheen_band.png          # Tier2+ 柔光带 sprite
      region_atlas.png        # （可选）区域色板 atlas
  prefabs/
    CardNode.prefab           # 卡片单元（母题层 + 识别信息层，见 §6 z-order）
    CodexEntry.prefab        # 图鉴条目（coin/note 双槽）
    DetailCard.prefab        # S5 详情卡
  scripts/
    core/                     # 热路径零分配、无 cc 依赖的纯逻辑（移植自 game.js）
      MatchLogic.ts           # judge / combo / score / input-lock（纯函数）
      CollectionStore.ts      # entities 集合 + 幂等 unlock + 持久化
      CardModel.ts            # CardRuntime 数据模型（GDD §1.③）
      SessionConfig.ts        # T1/T2 网格、form_factor、regions
      Storage.ts              # 平台安全存储封装（见 §4）
    gameplay/
      BoardController.ts      # 网格布局、发牌、洗牌（shuffle 复用）
      CardNode.ts             # 挂在 CardNode.prefab 上：状态/翻牌/点击
      MatchController.ts      # 编排 MatchLogic ↔ BoardController ↔ CardNode
      OrientationManager.ts   # note 强制横屏 / 安全区（见 §5）
    ui/
      HubView.ts             # S1 进度环 + 形态分段
      CodexView.ts           # S3 三书架 + 双形态槽
      DetailView.ts          # S5 纯阅读（四层识别码 + 现实锚 + 双槽 + 文化占位）
      RegionBadge.ts         # cc.Graphics 代码绘制角标（圆衬底 + 洲形状）
    effects/
      FlipAnim.ts            # cc.tween 缩放翻转（见 §3）
    data/
      currencies.ts           # 移植 data.js → TS 模块（CURRENCIES / REGION_STYLE …）
  shaders/                   # MVP 不引入运行时 shader（纸感/光泽走 sprite 叠加）
```

**场景划分决策**：选「单 Scene + UICanvas 子节点显隐」，而非多场景。理由：① 四个视图共享同一组 currency 数据/SpriteFrame 资源，单场景常驻更省内存与加载；② note-mode 横屏仅需在 UICanvas 内对 board 容器做朝向处理，无需切场景；③ 对齐 MVP 的 `showView` 心智。代价是节点树略大——用 Prefab 容器化各视图即可控复杂度。

---

## 2. 核心系统映射（MVP → Cocos 组件 / 状态机）

> 配对判定键恒为 `iso_code`（GDD §1.④）；双形态解锁实体 = `(iso_code, form_factor)`（GDD §0.5 / §2）。以下映射**沿用 GDD 数据模型与状态机**，仅换载体。

| MVP（game.js） | Cocos 映射 | 说明 |
|---|---|---|
| `state.board / flipped / lock / combo / score / matchedPairs / sessionUnlocked` + `judge()` / `onCardClick()` / `flipUp/Down()` | `core/MatchLogic.ts`（纯函数）+ `gameplay/MatchController.ts` + `CardNode.ts` | 判定/连击公式 `round(100*(1+0.5*combo_before))`、输入锁、`MISMATCH_FLIPBACK_MS=800` 原样复用 |
| `buildBoardDom()` / `shuffle()` | `BoardController.ts` | 8 币种×2=16 张 → 4×4；每 ISO 恰好 2 张校验 |
| `buildCardEl` / `buildTokenFace` / `buildRegionBadge` | `CardNode.prefab` + `CardNode.ts` + `RegionBadge.ts` | DOM 构建 → Prefab 组件组合；区域徽标改 `cc.Graphics` 代码绘制 |
| `unlockIfFirst()` / `loadEntities/saveEntities` / `loadBest/saveBest` | `CollectionStore.ts` + `Storage.ts` | 幂等 `(iso, form)` 解锁复用；`collected_entities` 为目标态（GDD §2.② 状态机 LOCKED→UNLOCKING→UNLOCKED） |
| `renderCodex` / `buildCodexEntry` / `buildCodexSlot` | `CodexView.ts` + `CodexEntry.prefab` | 三书架（amer/euro/asia_afr）+ coin/note 双槽；未解锁灰色剪影+「?」 |
| `openDetail` / `renderDetail` | `DetailView.ts` + `DetailCard.prefab` | S5 纯阅读态，无「加入收藏」按钮 |
| `showView()` / `applyFormMode` / `onViewportChange` | `UIManager`（节点 active 切换）+ `OrientationManager.ts` | 见 §5 横屏 |
| `store.get/set`（localStorage + 内存兜底） | `Storage.ts`（wx / cc.sys 封装） | 见 §4 |

**关键 TS 接口（示意，非完整实现）**
```ts
// core/MatchLogic.ts — 纯逻辑，零 cc 依赖
export interface CardRuntime { id:string; iso:string; form:FormFactor;
  state:'face_down'|'face_up'|'matched'; }
export function judge(a:CardRuntime, b:CardRuntime): MatchResult; // 仅比 iso
export function scoreFor(comboBefore:number): number;             // round(100*(1+0.5*comboBefore))

// core/CollectionStore.ts
export class CollectionStore {
  unlock(iso:string, form:FormFactor): boolean;  // 幂等：首次 true，重复 false
  isEntityCollected(iso:string, form:FormFactor): boolean;
  completionPctSingle(): number;                   // len/(total*2)
}
```

**状态机沿用 GDD**：`CardRuntime.state ∈ {face_down, face_up, matched}`；Collection FSM 每实体 `(iso, form)` = LOCKED→(首次配对)→UNLOCKING→(发现动画结束)→UNLOCKED，重复配对保持 UNLOCKED 且不广播。输入锁 `flipped_queue ≤ 2` 在判定期间屏蔽点击（防双翻竞态）。

---

## 3. 翻牌动画（替代 CSS transform）

MVP 用 CSS `rotateY(180deg)` + `preserve-3d` + `backface-visibility` 实现 3D 翻转。Cocos 无 CSS 3D，改用 **2.5D 缩放翻转**：卡片由 `frontNode`（母题面）与 `backNode`（问号背）两个独立子节点组成，靠 `scale.x` 先收 0 再展 1，中点点切换可见性。总时长 ≤300ms（GDD §1.② 翻牌动画约束）。

```ts
// effects/FlipAnim.ts — 替代 CSS transform
flip(node: CardNode, toFront: boolean) {
  const face = node.frontNode, back = node.backNode;
  tween(node.root)
    .to(0.15, { scale: new Vec3(0,1,1) }, { easing:'sineIn' })   // 收成侧边
    .call(() => { toFront ? (back.active=false, face.active=true)
                          : (face.active=false, back.active=true); })
    .to(0.15, { scale: new Vec3(1,1,1) }, { easing:'sineOut' })   // 展开新面
    .start();
}
```
错配抖动：用 `tween` 对 `position.x` 做 ±5px 往返 0.4s，再 `FlipAnim.flip(card,false)` 翻回（`MISMATCH_FLIPBACK_MS=800` 由 `MatchController` 计时）。匹配常驻高亮：matched 态给 `CardNode` 挂青绿描边子节点/ sprite。

---

## 4. 存档（localStorage → 微信小游戏）

MVP 用 `localStorage` + 内存兜底。`Storage.ts` 封装为**运行时择后端**的抽象，键名沿用以便迁移：

| 键（沿用 MVP） | 内容 |
|---|---|
| `currency-codex-entities-v1` | 已解锁实体数组 `[iso_form, …]`（双形态） |
| `currency-codex-best-v1` | 最高分 |
| `currency-codex-collected-v1`（legacy） | 旧单形态迁移用（Cocos 首包可保留兼容分支，或起点即 v1） |

```ts
// core/Storage.ts
export class Storage {
  get<T>(k:string, def:T):T {
    if (sys.platform === sys.WECHAT_GAME && (wx as any).getStorageSync) {
      const v = (wx as any).getStorageSync(k);   // 注意：未命中返回 undefined（非 null）
      return v === undefined || v === '' ? def : (typeof v==='string'? JSON.parse(v): v);
    }
    const s = sys.localStorage.getItem(k);          // 其他平台兜底
    return s==null ? def : JSON.parse(s);
  }
  set(k:string, v:unknown){ /* wx.setStorageSync(k,v) 或 sys.localStorage.setItem */ }
}
```
**平台差异注意**：① 微信小游戏用 `wx.getStorageSync/setStorageSync`（**同步** API，mini-game 环境可用，无 async 负担）；② 非微信（浏览器预览/DevTools）走 `cc.sys.localStorage`；③ `wx.getStorageSync` 未命中返回 `undefined` 而非 `null`，`get` 须以此判默认；④ 写值 JSON 序列化（与 MVP 一致）。解锁 `(iso, form)` 幂等逻辑（`indexOf` 判重 + `push`）整段复用，确保跨会话/跨设备去重。

---

## 5. 双形态 + 横屏（coin 竖屏 4×4 / note 强制横屏 4×4 宽牌）

| 维度 | coin-mode | note-mode |
|---|---|---|
| 物理形态 | 圆牌（圆形/圆角方） | 横长方牌 ≈2:1 |
| 屏幕朝向 | **portrait** | **强制 landscape** |
| 网格 | 4×4（8 对，近方牌） | 4 列×4 行（8 对，2:1 宽牌） |
| 区域徽标位 | 12 点钟盘缘（上缘居中） | 右上角固定 |
| 匹配键 | 仅 `iso_code`（两种模式一致） | 仅 `iso_code`；跨 `form_factor` 不配对 |

**朝向管理（OrientationManager）**：会话内 `form_factor` 固定（GDD §1.⑨），故按会话切朝向即可。coin 默认 `game.json` 设 `"orientation":"portrait"`；进入 note 配对时调用 `wx.setPageOrientation({orientation:'landscape'})`，返回 Hub 还原 `portrait`。竖持进 note 时先弹「请旋转至横屏」引导遮罩（复用 MVP `#note-rotate-hint` 逻辑），锁横屏后再渲染 board，避免竖屏挤窄宽牌。

**横屏安全区与可点区**（对齐 QA R1 + 美术 §2.9.4）：用 `cc.view.getSafeAreaRect()`（映射微信 `wx.getSafeAreaInsets`）对 board 容器左右内缩 ≥44px@2x，避开长边中段刘海/挖孔；ISO/面额 Label 置于安全区内不被遮挡；横屏手势返回区与可点元素保持 ≥16px 间距；4×4 宽牌在 SE 横持（高≈667px）每卡高 ≈ (667−2×inset)/4 > 44px，达标，窄屏需微缩放保底 ≥44dp。

**区域徽标（与卡形严格区分）**：`RegionBadge.ts` 用 `cc.Graphics` 代码绘制——中性白圆衬底（circle + 描边）→ 内绘洲形状（rounded_rect/hexagon/diamond 填 `region_color`）。直径 ≈ 卡片短边 18%，coin/note 双形态同款。**关键纪律**：徽标为独立小 chip、单角固定、中性填充，绝不被误读为卡片整体形状（尤其 amer 圆角矩形徽标 ≠ note 长方牌，继承 B1 方案）。

---

## 6. 资产合成方案（关键）

**产线**：Seedream 输出**母题质感 PNG**（符号化几何、锚定真钞主色、透明底）→ 导入 `resources/currencies/` → 作为 Sprite 贴到 `CardNode` 的「**母题层**」；区域形状徽标、ISO Label、面值 Label 由**代码（cc.Graphics / cc.Label）绘制叠加在最上层**，保证四层识别码清晰且每币种一致。

**资产命名与规格（严格对齐美术策略 §3.2）**
- 命名：`cur_<ISO>_<denom>_<region>_<form>.png`（如 `cur_USD_100_amer_coin.png`、`cur_CNY_100_asia_afr_note.png`）。
- 画布：`coin` 512×512 @2x（圆牌）；`note` 1024×512 @2x（≈2:1 横牌）。均 **RGBA 透明底**。
- 共享：128px tiling 噪点（纸感 ≤4%）、Tier2+ 柔光带 sprite——走共享 sprite 叠加，**省 drawcall**，MVP 不做运行时 shader。

**CardNode z-order（自下而上，识别信息恒在上）**
| z | 层 | 来源 | 对应四层 |
|---|---|---|---|
| 0（底） | 卡基底：区域色框带 + 奶油内衬 | Sprite/Graphics（CardNode 背景） | ① 区域色（accent） |
| 1 | **母题层 Sprite**（Seedream PNG） | `resources/currencies/*.png` | ② 母题色（锚定真钞主色） |
| 2 | 区域徽标（圆衬底 + 洲形状） | `RegionBadge.ts` cc.Graphics | ① 区域形状（角落小标） |
| 3 | ISO Label | `cc.Label`（Noto Sans SC，深墨 on 奶油 ≥AA） | ③ ISO 码（权威文字） |
| 4 | 面值 Label（数字 + 符号） | `cc.Label` | ④ 面额（层级，可数） |
| 5（顶） | Tier2+ 柔光带 / matched 青绿描边 | 共享 sprite / 描边节点 | ④ 层级辅助（不替代可数信号） |

**四层冗余硬约束（继承 GDD §6.3 / 美术 §4）**：① 形状（角标轮廓）+ ③ ISO + ④ 面额**不依赖颜色**，色弱下仍 100% 可辨；② 母题色仅作气质层（有形状兜底）。母题几何（portrait/architecture/animal/landscape）原 MVP 为内联 SVG，现迁为 Seedream PNG——母题**类别**仍来自数据 `motif_category`，驱动「现实锚」回显，不丢失 GDD §2.7 迁移锚点。

**图鉴/详情复用同一套合成**：`CodexEntry` 双槽（coin/note）与 `DetailCard` 的母题面，均复用 `CardNode` 的母题层 + 代码识别层；未解锁槽显灰色剪影 +「?」（仅 Graphics，不挂母题 Sprite）。

---

## 7. 微信小游戏构建约束

- **体积预算**：主包 ≤4MB、总包 ≤30MB（微信硬限）。代码 + 核心 UI + 首发 8 币种母题进**主包**（体积小，启动即用）；其余币种/双形态母题 PNG（最重部分）走**分包（subpackage）或 CDN 远程资源**。
  - 策略建议：首发包内仅放 coin-mode 必需 8 枚（快速开局）；note-mode 与后续扩展币种经 `cc.assetManager` 远程加载（远程资源不计入 30MB，适合未来扩到 16–20 币种 ×2 形态）。`resources/currencies/` 中按 `form` 分目录，便于分包/远程粒度控制。
  - 远程加载用 `cc.assetManager.loadRemote` 或微信 `wx.downloadFile` + 自定义管线；加载期显示占位剪影，避免白屏。
- **「高性能+」模式**：项目设置开启「高性能模式」（降低低端机开销）、启用「分离引擎」减少首包；纹理用压缩格式（如 etc2/astc，按目标机型），Atlas 合并降 drawcall。
- **横屏适配**：`game.json` 默认 `portrait`；note-mode 经 `OrientationManager` 动态申请 `landscape`（依赖较新基础库 `wx.setPageOrientation`）。真机横屏须 playtest 调参（见 §8 R3）。
- **可点区/安全区**：所有按钮/卡片 ≥44px@2x；board 容器套 `cc.view.getSafeAreaRect()` 内缩；ISO/面额 Label 锚定安全区内。

---

## 8. 里程碑与风险

**移植里程碑（P0→P4）**
- **P0 跑通配对**：`core/MatchLogic` + `BoardController` + `CardNode` + `FlipAnim` + `Storage` 落地，浏览器/微信预览可翻牌配对、连击计分、输入锁、胜利态。验证判定仅 `iso`、无失败态。
- **P1 收藏/图鉴**：`CollectionStore` 幂等解锁 + `CodexView`（三书架双槽）+ `DetailView`（S5）。验证刷新保留、`(iso,form)` 独立、未解锁剪影。
- **P2 note-mode 横屏**：`OrientationManager` + note 4×4 宽牌布局 + 安全区/可点区。真机横屏 playtest 调参。
- **P3 美术资产接入**：Seedream PNG 导入、`CardNode` 母题层 + z-order、`RegionBadge` cc.Graphics、共享噪点/柔光叠加。
- **P4 构建导出**：分包/CDN 体积策略、「高性能+」、朝向、QA 真机横屏 playtest 放行。

**关键风险**
- **R1（高）MVP DOM 逻辑需重写为 Cocos 组件**：`game.js` 的 `buildTokenFace/buildCodexEntry/innerHTML` 等视图构建不可直迁，必须 Prefab + 组件化；纯逻辑（`MatchLogic/CollectionStore`）可原样搬。缓解：先抽 `core/` 纯逻辑并单测（复用 MVP 16/16 自测思路），再搭 Prefab。
- **R2（高）Seedream 资产透明底/规格纪律**：PNG 须 RGBA 透明底、coin 512²/note1024×512 @2x、命名严格 `cur_<ISO>_<denom>_<region>_<form>.png`；若底不透明或尺寸错，母题层错位、四层识别失效。缓解：资产 ingest 校验脚本（尺寸/透明通道/命名正则）+ art-director 出图规范。
- **R3（中）真机横屏 note-mode playtest**：安全区、手势返回区、≥44px 可点、朝向切换流畅度，本环境无法真机验证（同 MVP R1）。缓解：P2 末用微信开发者工具「真机预览」实测调参，列为发布前放行项。
- **R4（低·文档）GDD §6.1 与 MVP 代码网格口径不一致**（3×4 vs 实际 4×4）。缓解：本规划以代码 4×4 为准，待文策渊在 GDD 校正验收口径。
- **R5（低·体积）币种扩到 16–20×2 形态时母题 PNG 体积**：早期即引入 CDN 远程加载，避免主/总包触顶。

> 合规红线复核：资产为风格化几何母题，绝无真实钞币图；区域双编码（形状+色）替代国旗；ISO 4217 为唯一身份；MVP 不展示汇率（红线 1–4 全程适用）。Seedream 提示词合规由 art-director 另出，本文仅界定集成方式。
