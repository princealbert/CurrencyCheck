# 货币图鉴 · 对对碰（微信小游戏 · 纯 TS + Canvas 2D）

**彻底脱离 Cocos Creator** 后的新工程：纯 TypeScript + Canvas 2D，直连 `wx.*` 微信小游戏 API，
用 esbuild 无头打包。同一套 `src/` 既可在浏览器开发测试，又能在微信小游戏运行——只入口不同。

> 背景：Mac 跑不动 Cocos Creator（爆内存）。本工程移除全部 `cc` 依赖，复用已验证的纯逻辑核心。

---

## 1. 目录结构

```
minigame/
  package.json          # dev / build:web / build:wx / test；devDep: esbuild
  build.mjs             # esbuild 双 target（web=iife→dist，wx=cjs→wx-dist）
  serve.mjs             # 极简静态服务器（仅 node 内置，无依赖）
  tsconfig.json
  index.html            # 浏览器入口：<canvas id=game> + <script type=module src=dist/game.js>
  game.json             # 微信小游戏配置（deviceOrientation: auto）
  project.config.json   # 微信开发者工具项目配置（appid: touristappid，需替换为你的）
  src/
    main.ts             # 平台无关 boot(platform)；运行时探测 wx
    web-entry.ts        # 浏览器入口（注入 BrowserPlatform）
    wx-entry.ts         # 微信入口（注入 WechatPlatform）
    core/               # 原样复用的纯逻辑（零 cc）
      types.ts deck.ts matchLogic.ts collectionStore.ts
      __selftest__.mjs  # 纯逻辑自测（PASS 37/37）
    data/
      currencies.ts     # 已修正签名色/面值/母题的主数据
    platform/           # 平台适配层（双后端）
      types.ts          # Platform 接口 / CanvasLike / Ctx2DLike / ImageLike
      browser.ts        # document + localStorage + pointer 事件
      wechat.ts         # wx.createCanvas + wx.getStorageSync + wx.onTouchStart
    app/
      app.ts            # 状态机 hub/pair/codex/detail；复用 core；自动收藏；翻牌动画
      input.ts          # pointer → 命中 UI 元素（点按 / 图鉴滚动）
    render/             # 纯 Canvas 2D 绘制（无 DOM）
      theme.ts layout.ts card.ts hub.ts codex.ts detail.ts renderer.ts
  assets/               # 母题 PNG 落位（见 assets/README.md；当前为空，自动降级几何占位）
```

---

## 2. 浏览器开发（推荐先在浏览器跑通）

依赖：Node 18+（已用 22.22.2 校验）。**esbuild 需安装**（见下）。

```bash
cd minigame
npm install            # 安装 esbuild（devDependency）
npm run build:web      # 产出 dist/game.js（iife）+ 复制 index.html → dist/
npm run dev            # = build:web && 启 serve.mjs → 打开 http://localhost:8080
```

> 也可不装 esbuild，用现成静态服务器：
> `npm run build:web` 产出 `dist/` 后，用 `npx serve dist` 或 `python3 -m http.server 8080 --directory dist` 指向 `dist/` 查看。

浏览器中可用鼠标点击卡牌；视图间切换、图鉴滚动（拖拽）均可用。

---

## 3. 微信小游戏构建预览

```bash
npm run build:wx       # 产出 wx-dist/game.js（cjs）+ 复制 game.json / project.config.json
```

1. 打开「微信开发者工具」→ 导入项目 → 目录选择 `minigame/wx-dist/`。
2. AppID：当前为 `touristappid`（游客模式可直接预览）；正式发布请改为你自己的小程序 AppID，
   并相应修改 `wx-dist/project.config.json` 里的 `appid`（或根目录 `project.config.json`）。
3. 编译预览：真机/模拟器中即可触控游玩。note 形态建议横屏（`game.json` 已设 `deviceOrientation: "auto"`，
   竖屏进入 note 会提示「请横屏」）。

> 微信小游戏无 DOM：`src/platform/wechat.ts` 用 `wx.createCanvas()` / `wx.createImage()` /
> `wx.getStorageSync()` / `wx.onTouchStart()` 实现，不引用 `document` / `window`。

---

## 4. 关键设计

- **平台双后端 + 运行时探测**：`main.boot(platform?)` 优先用入口注入的 Platform；
  不传则 `typeof wx !== 'undefined' && wx.createCanvas` → WechatPlatform，否则 BrowserPlatform。
  `web-entry.ts` / `wx-entry.ts` 分别注入对应后端，逻辑共享一份。
- **core 原样复用**：`types/deck/matchLogic` 与 CurrencyCheck 完全一致（零 cc）；
  `collectionStore` 移除 `cc.sys.localStorage` 依赖，改为「构造注入 KVStore」
  （platform 提供 getStorage/setStorage：浏览器=localStorage，微信=wx.*），无注入则退化为内存 Map。
- **Canvas 2D 无 DOM 渲染**：所有 UI（Hub / 棋盘 / 图鉴 / 详情）均用 `ctx` 原语绘制；
  翻牌动画在 rAF 中按 `scaleX = |cos(t·π)|` 插值，错配 800ms 后翻回（GDD §1.②）。
- **四层识别码**：卡面始终包含 ① 区域徽标（白圆衬底 + 洲形状）② 母题色块 ③ ISO ④ 面额；
  coin 用圆形裁剪、note 用 2:1 圆角矩形；判定只比 `iso_code`。
- **双形态（coin/note）**：解锁实体键 `(iso, form)`，图鉴每币种含coin/note双槽；S5详情纯阅读、无「加入收藏」按钮。
- **自动收藏**：首次成功配对 `(iso, form)` → `store.unlock`（幂等），进度按实体 `N/(8×2)` 计。

---

## 5. 合规说明

- 绝无真实钞币 / 硬币图像；母题仅 Seedream 风格化几何 PNG（资产待出，缺失时自动降级为几何占位）。
- 不绘制国旗；货币标识只用 ISO 4217 代码 + 区域双编码（形状 + 色）。
- Canvas 绘制不写入任何真实钞券图样 / 防伪元素；文案无投资 / 真伪措辞。

---

## 6. 已知限制

- **esbuild 未在本环境安装 / 未执行构建**：只交付源码与配置，由主理人统一 `npm install` 验证打包。
  在此之前 `dist/` 与 `wx-dist/` 不存在，需先 `npm run build:web` / `build:wx`。
- **母题 PNG 待出**：`assets/` 暂空，卡面母题用纯几何占位（白描边符号）。出图后按
  `assets/README.md` 命名放入，引擎会自动 `loadImage` 叠加，缺失自动降级。
- **note 形态横屏**：`game.json` 用 `auto` 以兼容 coin（竖屏友好）/ note（横屏）；竖屏进入 note 显示横屏提示遮罩。
- **文化/历史文案**：S5 为占位文本（分层文案后续接入，见 GDD §5）。
- **字体**：`Noto Sans SC` 在部分设备可能缺失，回退系统 sans（不影响布局）。

---

## 7. 自测

```bash
npm test               # = node src/core/__selftest__.mjs → 期望 PASS 37/37
```
