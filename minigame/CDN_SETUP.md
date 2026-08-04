# CDN 资产接入说明（路线 A：资产全 CDN）

> Phase 7 发布阻断 B1/B2 修复配套文档。本文只讲「怎么把资产搬到 CDN、代码怎么指向它、微信后台要配什么」，**不涉及玩法/美术/叙事改动**。

## 1. 为什么这么做

wx 小游戏主包硬上限 **4MB**、总包 **30MB**。原打包策略把 `assets/`（母题 PNG ≈60MB、音频 ≈42MB、环游世界帧图 ≈7.5MB）整目录塞进 `wx-dist`，直接顶穿上限（改造前 `wx-dist ≈ 77MB`）。

修复路线：**代码已支持异步加载 + 缺失降级**（图像缺失走区域兜底渐变 / 几何占位，音频缺失静默 no-op）。发布包只留 `game.js + 配置`，图像/音频运行时从 HTTPS CDN 拉取。

## 2. 域名注入方式（代码绝不硬编码）

唯一真源：`src/config/cdn.ts`。4 个 base 常量由 `CDN_BASE` 派生：

| 常量 | 本地（web） | CDN（wx） |
|------|-------------|-----------|
| `IMAGES_BASE`  | `assets/` | `<CDN_BASE>/assets/` |
| `SCENES_BASE`  | `assets/` | `<CDN_BASE>/assets/` |
| `AUDIO_ROOT`   | `assets/audio/` | `<CDN_BASE>/assets/audio/` |
| `WORLDTOUR_BASE` | `assets/remote/worldtour/` | `<CDN_BASE>/assets/remote/worldtour/` |

`CDN_BASE` 由**构建期**经 esbuild `define __CDN_BASE__` 注入，**源码不含任何域名**：

- **web target（本地预览）**：`__CDN_BASE__ = ''` → 运行时走本地 `assets/`。
- **wx target（发布）**：读取环境变量 `CDN_BASE_URL`，如 `https://cdn.example.com`。

因此发布命令：

```bash
# 发布 wx（带域名）
CDN_BASE_URL=https://your-cdn.example.com node build.mjs wx

# 或一次性打两份
CDN_BASE_URL=https://your-cdn.example.com node build.mjs all
```

> 未设 `CDN_BASE_URL` 时，`node build.mjs wx` 仍能成功构建（包内不含资产），**仅用于体积验证**。真机运行时资产不在包内 → 静默降级为几何占位/无音，发布前必须用带域名的命令重打。

## 3. 本地兜底（开发 / 预览）

- `npm run dev`（= `build.mjs web` + `serve.mjs`，localhost:8080）：`CDN_BASE` 为空 → 全部走本地 `assets/`，`build.mjs web` 仍把 `assets/`（含 `assets/remote/`）复制到 `dist/`，预览与验收照常。
- 弱网 / 资产 404：既有契约保留 —— 图像缺失走区域兜底渐变 / 几何占位；音频缺失静默 no-op。不抛、不转圈。

## 4. 微信后台白名单（用户侧操作，代码无需改）

微信小游戏从 CDN 拉取 `wx.createImage()` / `InnerAudioContext` 资源时，域名须加入小程序后台 **「开发 → 开发管理 → 服务器域名」**：

- **downloadFile 合法域名**：图像帧图（`assets/remote/worldtour/`）经 `wx.createImage` 加载，走此白名单。
- **request 合法域名**：若后续走 `wx.request` 拉清单（当前未用）。
- 音频（`InnerAudioContext.src` 走 HTTPS 直链）：域名同样需在 **downloadFile 合法域名**（或对应音频域名）白名单内。

> ⚠ `project.config.json` 的 `urlCheck` 已设为 `false`，**开发者工具不校验域名**。但真机上传后由微信后台强制校验，务必提前把 CDN 域名加进白名单，否则真机加载失败、静默降级。

## 5. CDN 目录布局（发布资源上传）

将本地 `assets/` 整目录**原样上传到 CDN root**（`CDN_BASE` 指向该根）。本地与线上文件尾段（文件名）完全一致，无需重命名：

```
assets/cur_*.png                     →  <CDN_BASE>/assets/cur_*.png
assets/bg_*.png                     →  <CDN_BASE>/assets/bg_*.png
assets/deco_globe.png               →  <CDN_BASE>/assets/deco_globe.png
assets/audio/**                     →  <CDN_BASE>/assets/audio/**
assets/remote/worldtour/*.png       →  <CDN_BASE>/assets/remote/worldtour/*.png
```

> 若希望 worldtour 放在 CDN 顶层 `worldtour/`（而非 `assets/remote/worldtour/`），改 `src/config/cdn.ts` 的 `WORLDTOUR_BASE` 派生即可；本仓库默认镜像 `assets/`，与本地结构零差异、最低出错率。

## 6. 包体预期（改造后）

- `wx-dist` = `game.js`（≈284KB）+ `game.json` + `project.config.json`，**无 `assets/`**。
- 总包 ≤ 1MB，远低于主包 4MB / 总包 30MB 上限。
- 图像/音频合计 ≈ `assets/` 总量（图像 ≈60MB、音频 ≈42MB、worldtour ≈7.5MB）全部走 CDN，**不计入 wx 包**。

## 7. 验证清单

- [ ] `node build.mjs all` exit 0，无 esbuild 错误。
- [ ] `du -sh wx-dist` 应骤降至 ≈ 数百 KB（改造前 ≈ 77MB）。
- [ ] `CDN_BASE_URL=https://your-cdn node build.mjs wx` 后，`wx-dist/game.js` 内 `__CDN_BASE__` 已被替换为域名（grep 确认无 `assets/cur_` 等写死本地路径残留于运行时字符串拼接；路径改由 `config/cdn.ts` 生成）。
- [ ] CDN 域名已加入小程序后台 downloadFile 合法域名白名单。
- [ ] 真机预览：图像/音频从 CDN 正常加载；断网时降级为几何占位 / 静默，不崩溃。
