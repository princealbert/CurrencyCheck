# 音频实现策略（Audio Implementation Strategy）· 货币图鉴

> 文档：`design/audio/audio-implementation.md` · 作者：阮和鸣（音频 / 声效）
> 版本：v1.0 · 日期：2026-08-01 · 状态：**草案，待主理人审批 + 待程基岩技术复核**
> 上游：`audio-direction.md`（方向 / 总线 / 响度）、`audio-events.md`（事件清单 / 编排 / 抑制规则）
> 性质：**实现策略草案。本文档不含可运行代码、不新增任何 `.ts` 文件、不生成任何音频二进制。** 文中 TypeScript 片段仅为**接口形状说明**，供程基岩评审与后续实现参考。

---

# 1. 架构定位：音频层挂在哪

## 1.1 现有分层事实

```
src/platform/{types,browser,wechat}.ts   宿主能力抽象（无 DOM 依赖契约）
src/core/*.ts                            纯逻辑，注入依赖，Node 可单测
src/render/*.ts                           Canvas 绘制
src/app/app.ts                            装配 + 状态机 + 每帧 tick()
```

关键既有约定（必须遵守，不可绕过）：
- **`core/` 不反向依赖 `data/`**，依赖靠构造注入（见 `DialogueEngineOptions.getCurrency`）；
- **持久化靠注入的 `KVStore`**，未注入时退化为内存 Map，保证 Node 单测安全（见 `MetaStore`、`platformKV()`）；
- **渲染与输入绝不直接引用 `document` / `window` / `wx`**（`platform/types.ts` 头注释）。

## 1.2 音频层落位方案

严格同构于既有的 `KVStore` / `DialogueEngine` 模式，**新增 3 个文件、改动 4 个文件**：

| 文件 | 性质 | 职责 |
|---|---|---|
| `src/platform/types.ts` | **改** | 新增 `AudioHandle` / `AudioBackend` 接口 + `platformAudio()` 便捷包装（对标 `KVStore` / `platformKV`） |
| `src/platform/browser.ts` | **改** | 实现 `AudioBackend`（WebAudio + HTMLAudioElement） |
| `src/platform/wechat.ts` | **改** | 实现 `AudioBackend`（`wx.createInnerAudioContext`） |
| `src/core/audioData.ts` | **新** | 事件清单数据表（对标 `core/dialogueData.ts`） |
| `src/core/audioManager.ts` | **新** | 调度 / 总线 / 节流 / 抑制 / ducking（对标 `core/dialogueEngine.ts`） |
| `src/app/app.ts` | **改** | 装配 + `audio.tick(dt)` + 各事件插桩点 |
| `src/core/metaStore.ts` | **改** | `Settings` 扩展 4 个字段（见 §6） |

> **为什么 AudioManager 放 `core/` 而不是 `app/`**：它是纯调度逻辑（优先级、节流、抑制、ducking 状态机），后端能力靠注入。放 core/ 才能像 `MetaStore`/`DialogueEngine` 一样在 Node 下单测（无后端时全部 no-op）。这也是 §9 验收「删掉音频目录游戏照跑」的架构保证。

---

# 2. 平台后端接口草案（`platform/types.ts`）

> 以下为**接口形状说明**，非实现代码。

```ts
/** 单个音频实例句柄（浏览器=WebAudio source / 小游戏=InnerAudioContext） */
export interface AudioHandle {
  play(): void;
  pause(): void;
  stop(): void;
  seek(sec: number): void;
  /** 0..1；由 AudioManager 计算好最终值后写入，后端不做任何换算 */
  setVolume(v: number): void;
  setLoop(loop: boolean): void;
  /** 释放底层资源（小游戏 InnerAudioContext 必须 destroy，否则泄漏） */
  destroy(): void;
  readonly playing: boolean;
}

export interface AudioCreateOptions {
  /** true=短音效，走低延迟内存解码；false=长音乐，走流式播放 */
  shortSfx: boolean;
  loop?: boolean;
}

export interface AudioBackend {
  /** 是否可用；旧机型/权限异常返回 false，AudioManager 整体降级为 no-op */
  readonly available: boolean;
  /** 创建实例。加载失败不抛异常，返回的 handle 所有方法为 no-op（对齐 loadImage 的静默降级契约） */
  create(src: string, opts: AudioCreateOptions): AudioHandle;
  /** 解除自动播放限制（Web 端必须在首次用户手势中调用；微信端为 no-op） */
  unlock(): void;
}

/** 便捷包装，对标既有的 platformKV(platform) */
export function platformAudio(platform: Platform): AudioBackend;
```

## 2.1 双平台实现要点

| | 微信（`wechat.ts`） | 浏览器（`browser.ts`，dev 预览） |
|---|---|---|
| SFX | `wx.createInnerAudioContext({ useWebAudioImplement: true })` —— **必须开**，否则短音效延迟可达 100ms+ | `AudioContext` + `decodeAudioData` + `AudioBufferSourceNode` |
| BGM | `wx.createInnerAudioContext()`（默认流式，省内存） | `HTMLAudioElement`（流式） |
| 静音键 | 启动时 `wx.setInnerAudioOption({ obeyMuteSwitch: true })` —— **遵从系统静音键**（见 §7 可访问性） | 浏览器原生行为 |
| 解锁 | 无需（`unlock()` 为 no-op） | 首次 `pointerdown` 中 `audioCtx.resume()` |
| 释放 | `destroy()` 必调；实例上限见 §3.4 | GC 托管，BGM 需显式 `src=''` |

> ⚠ **`useWebAudioImplement: true` 的代价**：整段音频解码进内存。**只允许用于 SFX**（≤2.4s），BGM 绝不可开，否则内存爆掉。

---

# 3. AudioManager 接口草案（`core/audioManager.ts`）

## 3.1 公开接口

```ts
export type AudioBus = 'MUSIC' | 'SFX_UI' | 'SFX_GAMEPLAY' | 'SFX_REWARD' | 'SFX_NARRATIVE';

export interface PlayOptions {
  /** 延迟触发（ms）；对齐 BURST_AT=370 等既有时间轴 */
  delay?: number;
  /** 事件级增益微调 0..1，默认取 audioData 表内值 */
  gain?: number;
  /** 指定变体序号；缺省=按 audioData 规则随机/轮转 */
  variant?: number;
  /** 强制忽略节流与抑制（仅 P0 场景使用） */
  force?: boolean;
}

export interface AudioManagerOptions {
  backend: AudioBackend | null;   // null → 全局 no-op（Node 单测 / 降级）
  meta: MetaStore;                // 读写静音与音量设置
  /** 资源根路径解析：本地 'assets/audio/...' 或 CDN 'https://...' */
  resolveSrc: (relPath: string) => string;
  now: () => number;              // 注入时钟，对齐 platform.now()
}

export class AudioManager {
  constructor(opts: AudioManagerOptions);

  /* —— 播放 —— */
  play(eventId: AudioEventId, opts?: PlayOptions): void;
  stopBus(bus: AudioBus): void;

  /* —— 音乐 —— */
  /** 切轨；同轨重复调用为 no-op（detail 复用 codex 轨的关键） */
  playMusic(trackId: MusicTrackId | null, fadeMs?: number): void;
  /** 不换轨，仅调音量（codex 0.40 ↔ detail 0.35） */
  setMusicSceneGain(gain: number, rampMs?: number): void;

  /* —— 设置（持久化经 MetaStore，见 §6）—— */
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  setMusicVolume(v: number): void;   // 0..1
  setSfxVolume(v: number): void;     // 0..1
  setReducedAudioFx(on: boolean): void;

  /* —— 对白 ducking（引用计数，见 §5）—— */
  duckPush(): void;
  duckPop(): void;

  /* —— 生命周期 —— */
  /** 首次用户手势调用（Web 自动播放策略） */
  unlock(): void;
  /** 每帧调用，驱动 delay 队列 / 淡变 / ducking 插值（对标 dialogue.tick()） */
  tick(dtMs: number): void;
  onHide(): void;
  onShow(): void;
  dispose(): void;
}
```

## 3.2 最终音量计算（唯一真源）

```
finalVolume = muted ? 0
            : clamp01( categoryVolume × busGain × eventGain × sceneGain × duckFactor )
```

- `categoryVolume`：用户设置（`musicVolume` / `sfxVolume`）；
- `busGain`：`audio-direction.md` §6.1 常量表（UI ×0.70、NARRATIVE ×0.80 等）；
- `eventGain`：`audioData.ts` 表内逐事件微调；
- `sceneGain`：仅 MUSIC 用（0.45/0.30/0.40/0.35）；
- `duckFactor`：仅 MUSIC 用（1.00 或 0.60，插值中取中间值）。

**后端不参与任何换算**——`AudioHandle.setVolume()` 收到的就是最终值。这样调音只需改一处。

## 3.3 播放决策流水线（`play()` 内部）

```
1. backend 不可用 / muted            → 丢弃
2. reducedAudioFx 且事件在降级表内    → 丢弃（audio-events.md §8）
3. 节流：距上次同事件 < throttleMs    → 丢弃
4. 抑制：E1 的 400ms 规则 / 批次规则  → 丢弃（audio-events.md §6.2）
5. delay > 0                          → 入延迟队列，tick() 到点回到步骤 3
6. 同发上限已满                        → 按优先级抢占（见 §3.4）
7. 取实例（池化）→ 计算音量 → play()
```

> 流水线顺序刻意与 `DialogueEngine.trigger()` 的六步流程同构，便于工程侧复用心智模型。

## 3.4 实例池化与同发上限

微信 `InnerAudioContext` 是**重对象**，低端机上实例过多会导致创建卡顿与内存压力；同一实例也**无法自我叠加**（`play()` 会从头重放）。

| 策略 | 值 |
|---|---|
| 同时发声上限 | **6**（1 BGM + 5 SFX） |
| InnerAudioContext 实例上限 | **12** |
| 热事件（2 实例轮转，允许短暂重叠） | `sfx_card_flip`、`sfx_ui_tap`、`sfx_match_success_repeat` |
| 冷事件 | 1 实例，懒创建（首次触发时创建并常驻） |
| 超上限抢占 | 丢弃最低优先级；同级丢弃最早的（P3 先丢，**P0/P1 永不丢**） |

> **为什么 `sfx_card_flip` 需要 2 实例**：快速连翻两张卡间隔可能 <150ms，单实例会把第一声掐断。2 实例轮转 + 3 变体随机 + ±1.5 半音微调，是「翻牌不像机关枪」的三件套。

---

# 4. 资源目录与加载约定

## 4.1 目录结构（含一个必须处理的构建陷阱）

```
minigame/
├── assets/                        ← build.mjs copyAssets() 整目录复制进包
│   ├── cur_*.png  bg_*.png        （现有美术，53MB，待压缩）
│   └── audio/
│       └── sfx/                   ← ✅ 进主包（43 文件，≈140KB）
│           ├── ui/       sfx_ui_tap_01.mp3 ...
│           ├── card/     sfx_card_flip_01.mp3 ...
│           ├── reward/   sfx_match_success_new_01.mp3 ...
│           └── narrative/sfx_dialogue_pop_01.mp3 ...
└── assets-remote/                 ← ❌ 不进包，构建时上传 CDN
    └── audio/bgm/                 bgm_hub.mp3 / bgm_match.mp3 / bgm_codex.mp3
```

> ⚠ **构建陷阱（必须告知程基岩）**：`minigame/build.mjs` 的 `copyAssets()`（第 35 行）会把整个 `assets/` 目录无差别复制到 `dist/` 与 `wx-dist/`。**若把 BGM 放在 `assets/audio/bgm/` 下，即使决定走 CDN，文件也会被打进包**，CDN 策略等于白做。
>
> 两个可选解法，任选其一（建议 A）：
> **A.** BGM 源文件放包外目录 `minigame/assets-remote/`（如上），`copyAssets` 完全不感知 —— 零构建改动；
> **B.** 改 `copyAssets()` 增加排除规则（`cpSync` 的 `filter` 参数）跳过 `audio/bgm`。
>
> 无论哪种，都需要在 `build.mjs` 增加一步「CDN 清单生成/校验」，否则 BGM 上没上传全靠人肉记忆。

## 4.2 路径解析与 CDN

```ts
resolveSrc('sfx/card/sfx_card_flip_01.mp3')  → 'assets/audio/sfx/card/sfx_card_flip_01.mp3'
resolveSrc('bgm/bgm_hub.mp3')                → `${AUDIO_CDN_BASE}/bgm/bgm_hub.mp3`
```

- `AUDIO_CDN_BASE` 建议与美术 CDN **同域同版本清单**，避免维护两套；
- ⚠ **微信运维项**：`InnerAudioContext` 播放网络音频需在小程序管理后台配置 **`downloadFile` 合法域名**。开发者工具需勾选「不校验合法域名」才能本地联调。**此项须在提审前完成，否则真机 BGM 全哑。**
- CDN 不可达 → BGM 静默，游戏正常运行（§9 兜底）。

## 4.3 加载时序（与现有美术预加载的关系）

现有美术是**启动即 fire-and-forget 全量预加载**（`preloadImages()` / `preloadScenes()`，`app.ts:692/712`）。音频**不照搬**，分三档：

| 档 | 内容 | 时机 | 理由 |
|---|---|---|---|
| **不预载** | 全部 | 冷启动首帧前 | 首帧渲染是体验瓶颈，音频不参与竞争；且 Web 端此时也放不了声 |
| **手势后预载** | 全部 SFX（43 文件 ≈140KB，本地） | 首次 `pointerdown` → `audio.unlock()` 之后 | 本地小文件，一次性建实例；此时用户已交互，可放声 |
| **懒加载** | BGM（CDN） | 进入对应视图时首次请求 | 单文件 ≈1MB，网络加载；未就绪则静默，就绪后淡入 |

**与美术预加载的一致点**：同样 fire-and-forget、同样 `.catch()` 静默降级、同样不阻塞主流程。
**不一致点（有意）**：美术缺失会露出几何占位（视觉可见），音频缺失完全无感 —— 因此音频可以更晚、更懒。

**首次进入 Hub 的特例**：`sfx_hub_first_open`（E2，P0）在 `app.ts:192` 触发，此时可能尚未发生任何手势。规则：**E2 允许延后到首次手势后补播一次**（一生一次的仪式音，值得等）；其余所有事件一律不补播。

---

# 5. 与 dialogueEngine 的衔接

## 5.1 衔接点（3 处，均为单向调用，不改 dialogueEngine）

`DialogueEngine` 通过 `DialogueEngineHost` 接口与 `app.ts` 解耦，音频挂在 **app.ts 实现的 host 方法**里，**引擎本身零改动**：

| host 方法（`app.ts` 实现） | 音频动作 |
|---|---|
| `enqueueToast(item)` | ① `audio.play('sfx_dialogue_pop')`（受 §6.2 抑制规则约束）② `audio.duckPush()` |
| toast 播完退场（`fx.ts` 生命周期结束） | `audio.duckPop()` |
| `dismissCurrentToast()` | `audio.duckPop()`（优先级打断时确保配平） |

## 5.2 Ducking 策略：压低，不静音

**结论：BGM 压低到 ×0.60，不暂停、不静音。**

理由：册册对白极其频繁（`MATCH_MISS` 每局最多 3 次、`MATCH_SUCCESS_REPEAT` 轮转常驻）。BGM 若每次对白都暂停/静音，会变成断断续续的开关声，比不做 ducking 更糟。×0.60 足以把注意力让给文字，又不破坏音乐连续性。

| 参数 | 值 |
|---|---|
| duck 目标 | MUSIC 总线 ×0.60 |
| attack | 180ms（线性插值，`tick(dt)` 内推进） |
| release | 400ms |
| 计数 | **引用计数**，`duckPush`/`duckPop` 配对，归零才 release |

**为什么必须引用计数**：toast 队列容量为 3（FIFO），册册叙事常一次推 2–3 行（`MATCH_SUCCESS_NEW` 的 `discoveryLine` 是 3 行约 10s）。若每条各自 release，中间会出现音量「闪回」，听感像卡顿。

**健壮性要求**：`duckPop()` 必须防御性配平 —— 计数不得为负；视图切换 / `onHide` / 对局中断时**强制清零并 release**，避免某条 toast 被异常路径吞掉后 BGM 永久停在 0.60。

## 5.3 静默期

`DialogueEngine.setSilenced(true)` 期间不喂 toast，因此 `enqueueToast` 不触发，音频侧**无需感知**，天然对齐。

---

# 6. 设置持久化（复用 `metaStore.ts`，零新增存储键）

## 6.1 现状

`MetaStore` 已有设置通道：存储键 `currency-codex-settings-v1`，值为 `{"colorblind": 0|1}`，读取走 `readObj()` → `Record<string, number>`，构造时缓存到 `settingsCache`。

## 6.2 扩展方案：**同键、同结构、纯数字**

`readObj()` 返回的是 `Record<string, number>`。只要新字段全部是数字，**解析层一行都不用改**：

```ts
// 现状
export interface Settings { colorblind: boolean; }

// 扩展后
export interface Settings {
  colorblind: boolean;
  muted: boolean;          // 存 0 | 1
  musicVolume: number;     // 存 0..100 整数，运行时 /100
  sfxVolume: number;       // 存 0..100 整数
  reducedAudioFx: boolean; // 存 0 | 1
}
```

落盘形态：`{"colorblind":0,"muted":0,"musicVolume":55,"sfxVolume":85,"reducedAudioFx":0}`

| 优点 | 说明 |
|---|---|
| 不新增存储键 | 与既有 11 个 `currency-codex-*-v1` 键并列，不扩散 |
| 老存档兼容 | 缺字段 → 取默认值（`readObj` 对缺 key 返回 `undefined`，走 `??` 兜底），旧档零迁移 |
| 不改解析层 | 全数字，`readObj()` 的 `Record<string, number>` 契约不变 |
| 同模式 | 沿用 `setColorblind()` 的「改缓存 + 立即落盘」写法 |

新增方法（对标 `setColorblind`）：`setMuted()` / `setMusicVolume()` / `setSfxVolume()` / `setReducedAudioFx()`。

## 6.3 默认值

| 设置 | 默认 | 理由 |
|---|---|---|
| `muted` | `false`（有声） | 但**冷启动不自动播**，等首次手势（§4.3）；且遵从系统静音键（§7） |
| `musicVolume` | `55` | 对齐 `audio-direction.md` §6.1 MUSIC 总线 0.55 |
| `sfxVolume` | `85` | 对齐 SFX 总线 0.85 |
| `reducedAudioFx` | `false` | 可访问性选项，默认关 |

## 6.4 设置 UI 建议（Canvas-only 约束下的务实方案）

本项目**无 DOM**，拖拽滑杆需自己实现命中区 + 拖拽状态机，成本不低且儿童难操作。建议：

- **音乐 / 音效各一个三档点按控件**：`关 / 半 / 全` → 映射 `0 / 50 / 100`，点一下循环切换；
- 顶部一个**静音总开关**图标（一键，最高频操作，必须一步可达）；
- 「减少动态音效」为单个勾选项。

滑杆可作为 v2 打磨项。三档方案对儿童更友好，也与既有色弱开关的交互形态一致。

---

# 7. 包体预算

## 7.1 前提：先把限额口径核对清楚

> ⚠ **口径存疑，需程基岩以当前基础库文档复核后定稿。**
>
> 任务书表述为「超出微信小游戏 **20MB 主包**红线」。按微信官方分包规则，小游戏实际限制通常为：**单个包（主包或分包）≤ 4MB，全部分包合计 ≤ 20MB**。若按 4MB 主包计算，策略约束会显著收紧。
>
> **本文档按更严格的「主包 ≤4MB」制定预算**——若实际口径更宽，本预算依然安全；反之则会翻车。

## 7.2 音频预算

| 类别 | 位置 | 文件数 | 单文件上限 | 总预算 | 硬上限 |
|---|---|---|---|---|---|
| **SFX** | **主包** | 43 | **24KB** | **≈140KB** | **300KB** |
| **BGM** | **CDN 远程** | 3 | **1.1MB** | **≈2.9MB** | **3.2MB** |
| 合计 | — | 46 | — | ≈3.0MB | 3.5MB |

## 7.3 格式与编码规格

| 项 | 规格 | 说明 |
|---|---|---|
| 格式 | **mp3（单一格式）** | 微信 + 浏览器双端通吃。**不用 ogg** —— iOS 侧支持不可靠，双格式还要双份体积 |
| 采样率 | 44.1kHz | — |
| SFX | **单声道 64kbps** | 短音效无立体声需求；400ms ≈ 3.2KB |
| BGM | **立体声 96kbps** | 90s ≈ 1.05MB；若超预算降为单声道 80kbps（90s ≈ 900KB） |
| 编码器 | LAME `-V5` 或 CBR，**关闭 gapless 元数据依赖** | mp3 编码器 padding 是 loop 接缝的元凶（见 §7.5） |
| 头空 | True Peak ≤ −1.0 dBTP（SFX）/ −1.5 dBTP（BGM） | 运行时无限幅器 |

## 7.4 主包 or CDN：明确结论

| | 决策 | 理由 |
|---|---|---|
| **SFX** | **进主包** | ①总量仅 ≈140KB，占 4MB 主包 3.5%；②交互音**必须零延迟**，网络加载会让翻牌音慢半拍，体验直接崩；③离线可用 |
| **BGM** | **走 CDN** | ①≈2.9MB，进包直接吃掉 72% 主包配额，不可能；②氛围层，晚 1–2 秒淡入无感；③未来加区域变体（v2）不动包体 |

## 7.5 BGM 无缝 loop 的技术风险与回退

mp3 编码器会在首尾插入静音 padding，`InnerAudioContext.loop = true` 是否能无缝取决于解码器实现。**真机实测前不能假设无缝。**

| 方案 | 说明 | 成本 |
|---|---|---|
| **首选** | 直接 `loop = true`，真机验证 | 0 |
| **回退 A** | 素材首尾各预留 ~50ms 淡入淡出，接缝处做成「呼吸」而非「断点」 | 素材侧，0 工程成本 |
| **回退 B** | 双实例交替：A 快播完时启 B 并交叉淡变 | +1 实例，逻辑中等 |
| **回退 C** | 改 `wx.createWebAudioContext()` + `AudioBufferSourceNode.loopStart/loopEnd` 精确循环 | 需确认基础库版本下限，改动大 |

**建议**：外包按「回退 A」制作（首尾自带淡变），真机验证若无缝则皆大欢喜，有缝也已经能听。**回退 C 不进 v1。**

## 7.6 与美术压缩的优先级关系（明确表态）

| 优先级 | 任务 | 量级 |
|---|---|---|
| **P0** | 美术 pngquant 压缩 + CDN 远程资源 | 53MB → 目标 < 4MB 主包 |
| **P1** | 音频 SFX 进主包 | +140KB |
| **P1** | 音频 BGM 上 CDN | +2.9MB（不占包） |

**表态：音频不应在美术压缩落地前占用任何主包配额。**

算术很清楚：音频全部资产（含 CDN 部分）约 3.0MB，仅为当前美术体积的 **5.7%**。**美术不压缩，音频省到 0 也没有意义；美术压缩到位，音频这 140KB 根本不构成压力。** 因此：

1. 美术压缩 + CDN 是包体问题的**唯一主要矛盾**，音频不参与抢配额、也不该被拿来当省包体的筹码；
2. 建议音频与美术**复用同一套 CDN 基础设施与版本清单**（同域、同上传脚本、同 `downloadFile` 白名单），边际运维成本接近 0；
3. 排期上音频实现可与美术压缩**并行**（两者无代码耦合），但**音频资产入包应排在美术压缩验证通过之后**，避免在一个已经爆表的包上再叠增量、干扰体积归因。

---

# 8. 合规与可访问性

## 8.1 合规（红线落点）

| 红线 | 音频侧落点 |
|---|---|
| 禁投资 / 交易 / 预测措辞 | 音频**无任何文案**（v1 无 VO，见 `audio-direction.md` §8.1），文案风险为零 |
| 禁真实钞币图像（听觉对应物） | **禁用真实货币采样**：无硬币碰撞、无纸币摩擦真声、无点钞机 |
| 教育/文化定位，非博彩 | **禁用博彩音语言**：无老虎机、无中奖号角、无金币瀑布、无收银机 —— 见 `audio-direction.md` §3.2 黑名单 |
| 无失败态 / 轻松无限 | 错配音为柔和下行小三度，**非否定、非蜂鸣**；禁用倒计时滴答与心跳 |
| 文化尊重 | **不做国别乐器 cosplay**，区域差异仅用音色微染 —— 见 `audio-direction.md` §3.3 |

> **验收 gate 建议**：素材入库前逐条过一遍黑名单，与文案的禁用词 gate（GDD §5.④）同等对待。音频没有正则可扫，只能人工听审 —— 建议由我（音频侧）出具一份逐条签核表随资产交付。

## 8.2 可访问性

| 能力 | 设计 |
|---|---|
| **静音总开关** | 一键，全局最高频操作，**一步可达**（不藏二级菜单）；持久化（§6） |
| **音乐 / 音效独立音量** | 两条独立通道，三档点按控件（§6.4）；关掉音乐仍保留音效反馈，反之亦然 |
| **减少动态音效** | `reducedAudioFx` 开关，静默高频装饰音（滚动/连击/翻回/对白 pop），**保留全部关键反馈**（`audio-events.md` §8）。服务听觉敏感人群（含部分自闭谱系儿童） |
| **遵从系统静音键** | 微信侧 `obeyMuteSwitch: true` —— 用户拨了物理静音键就该安静。对儿童+成人混合受众的公共场合使用是基本尊重 |
| **不依赖音频传达信息** | **硬约束**：音频 100% 为冗余通道。所有反馈（配对成功/失败/解锁/星级）均已有视觉表达（粒子、toast 文字、星星、剪影→实显）。**全程静音可完整通关**，听障玩家零信息损失 |
| **字幕** | 册册对白本就是 toast 文字，v1 无语音旁白 → **无需字幕**。若未来加 VO，toast 文字必须保留并同步，不得因有 VO 而隐藏 |
| **无骤响** | 无 jump-scare、无突发大音量；所有音符合 §7.3 头空规格，奖励叠加峰值 ≤ −3 dBFS |

---

# 9. 验收标准

- [ ] **删除整个 `assets/audio/` 目录后，游戏可完整通关一局，无任何报错**（音频层解耦的唯一硬检验）
- [ ] CDN 不可达 / 断网时，SFX 正常、BGM 静默、游戏无异常
- [ ] 静音开关一步可达，重启后设置保持（`currency-codex-settings-v1`）
- [ ] 音乐 / 音效音量独立生效，互不影响
- [ ] 老存档（仅含 `colorblind`）升级后不报错，音频设置取默认值
- [ ] 全程静音可完整通关，无任何仅靠音频传达的信息
- [ ] 新币解锁瞬间三音编排正确（`audio-events.md` §4.1），叠加峰值 ≤ −3 dBFS
- [ ] `sfx_dialogue_pop` 抑制规则生效：3 行 `discoveryLine` 只响一次
- [ ] ducking 引用计数配平：连播 3 条 toast 期间 BGM 无音量闪回；异常路径后能恢复到 1.00
- [ ] 快速连翻 10 张卡无「机关枪感」，无爆音，无掉帧
- [ ] 切后台立即静音，回前台 BGM 续播（不重头），无积压 SFX 补播
- [ ] 真机同发 6 音时无卡顿；`InnerAudioContext` 实例数 ≤ 12，退出对局无泄漏
- [ ] BGM 连播 3 圈接缝可接受（无缝或呼吸式，非硬断点）
- [ ] 素材逐条通过黑名单听审签核（§8.1）
- [ ] 主包音频增量 ≤ 300KB；BGM 全部在 CDN，未被 `copyAssets()` 打进包

---

# 10. 分阶段落地建议

| 阶段 | 内容 | 依赖 |
|---|---|---|
| **A. 骨架**（可立即开工，零资产） | `AudioBackend` 接口 + 双平台实现 + `AudioManager` 骨架 + `metaStore` 设置扩展 + 静音/音量 UI。**用占位音（或全静默）跑通全链路** | 无 |
| **B. 插桩** | 按 `audio-events.md` 在 22 个事件点插 `audio.play()`；ducking 接入 host 三处 | A |
| **C. 资产**（可与 A/B 并行） | 外包按 §7.3 规格产 43 SFX + 3 BGM；逐条黑名单听审 | 方向审批 |
| **D. 调音** | 真机走查：响度、节流、抑制、loop 接缝、同发上限；按需回退 §7.5 | A+B+C |
| **E. 入包** | SFX 进主包、BGM 上 CDN、`downloadFile` 域名配置、`build.mjs` CDN 清单校验 | **美术压缩验证通过后** |

> A 阶段**不需要任何音频文件**即可完成并验收（全静默下所有开关与持久化可测）。这是把音频风险前移、避免卡在资产交付上的最优切法。

---

# 11. 待确认清单（需主理人 / 程基岩拍板）

| # | 项 | 需谁确认 | 影响 |
|---|---|---|---|
| 1 | 微信包体限额真实口径（主包 4MB？20MB？） | 程基岩 | 决定 BGM 是否有任何进包可能性 |
| 2 | `build.mjs copyAssets()` 排除方案 A 或 B（§4.1） | 程基岩 | 不处理则 CDN 策略失效 |
| 3 | `downloadFile` 合法域名配置与 CDN 域名 | 程基岩 + 运维 | 未配置则真机 BGM 全哑 |
| 4 | 胜利面板星星点亮动画时间轴（§`audio-events.md` 4.2） | 程基岩 | 星评音同步 |
| 5 | 连续天数里程碑门槛 `{3,7,14,30}` | 文策渊 / 主理人 | D3 触发点 |
| 6 | 章节数口径：任务书「8 章」vs 代码 4 章 × 3 档 | 主理人 | D1 触发条件 |
| 7 | v1 不做 VO 的决策 | 主理人 | 包体 1.5–3MB + 本地化成本 |
| 8 | 音频外包预算与档期 | 主理人 | C 阶段启动 |
| 9 | 目标基础库版本下限（影响 WebAudio 路径可用性） | 程基岩 | v2 分层与 loop 回退 C |

---

*本文档为实现策略草案。任何代码改动与资产制作均需主理人审批后启动。技术假设（微信基础库能力、包体限额、构建流程）须经程基岩复核后方可作为实现依据。*
