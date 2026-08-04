# 货币图鉴 · 对对碰（Currency Codex）

一个以「真实世界货币文化」为主题的教育向休闲小游戏：翻牌配对（memory-match）各国货币名片，配对成功自动解锁进图鉴；集齐全部后触发「环游世界」伪视频串烧奖励。

> 本项目定位为 **教育 / 文化**，不含任何投资、预测、交易内容。游戏内货币一律使用风格化原创几何母题，**禁用真实钞币图像**。

## 玩法
- **对对碰**：翻牌找出成对货币名片（按 ISO 4217 代码标识，弱化国旗）。
- **自动收藏**：首次成功配对即自动入册，图鉴详情页纯阅读，无「加入收藏」按钮。
- **环游世界**：集齐全部 36 实体后，触发 8 帧名胜图 + Ken Burns 推镜 + 字幕 + 专属 BGM 的串烧奖励。
- **受众**：儿童与成人兼顾，内容分层；广告（旅游主题）变现，**不卡进度**。

## 技术栈
- 纯 **TypeScript + Canvas 2D**，无游戏引擎（不依赖 Cocos / Unity）。
- 双端运行时：微信小游戏（`src/wx-entry.ts`）+ Web（`src/web-entry.ts`），共用同一份 Canvas 逻辑。
- 无头构建：`build.mjs`（esbuild），Web / 微信双 target。
- 资产：风格化货币母题 PNG、背景图、BGM / SFX（本地自包含；生产微信包走 CDN）。

## 本地运行
```bash
cd minigame
npm install
npm run dev        # 构建 web 并起本地预览 localhost:8080
```
浏览器打开 `localhost:8080` 即为真机同款体验（同一份 Canvas 代码，web 预览 == 部署版）。

## 部署为 Web Demo（EdgeOne Pages / Vercel / Netlify / Cloudflare Pages）
项目构建根目录指向 **`minigame/`**：
- 构建命令：`npm install && node build.mjs web`
- 输出目录：`dist`
- `dist/` 为自包含静态站点（`index.html` + `game.js` + `assets/`），可直接拖到任意静态托管，或连 Git 仓库由 EdgeOne Pages 自动构建（每次 push 自动重部署）。

> 在线试玩：见仓库 Homepage（EdgeOne 部署后填入永久链接）。

## 目录结构
| 路径 | 说明 |
|---|---|
| `minigame/src/` | 源码（core / app / render / data / config） |
| `minigame/assets/` | 美术 / 音频资产 |
| `minigame/build.mjs` | 构建脚本 |
| `design/` | 设计文档（GDD / 美术圣经 / 叙事 / 合规） |
| `docs/` | QA 与发布门控 |
| `production/` | 发布清单 / 补丁说明 / 上线清单 |
| `tools/image_generator/` | 资产生成管线（Seedream / Volcano Ark） |

## 合规红线（务必守住）
- 禁用真实钞币图像，仅风格化原创母题。
- 货币标识用 ISO 4217 代码，弱化 / 不用国旗。
- 汇率采用每日静态快照，页面须标注「仅供参考，非金融建议」。
- 定位教育 / 文化，禁投资 / 预测 / 交易措辞；与微信内「红包 / 赚钱版」克隆划清界限。

## 许可
源码仅供学习与教育演示使用。
