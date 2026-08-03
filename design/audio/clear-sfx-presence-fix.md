# 通关音存在感修复（Clear SFX Presence Fix）· 货币图鉴·对对碰

> 文档：`design/audio/clear-sfx-presence-fix.md` · 作者：阮和鸣（音频 / 声效）
> 版本：v1.0 · 状态：待主理人（游承峰）拍板 → 交 engineering-lead（程基岩）落地
> 性质：**诊断报告 + 调优方案，不含代码改动**。本文所有数值均为实测，可复现。
> 上游：`audio-direction.md`（三条听觉铁律 / 总线）、`audio-events.md`（事件表）、`sfx-metallic-redesign.md`（温润青铜人格）
> 输入：用户反馈「每一关通关应该有通关音效，听不明显」

---

# 0. 一句话总纲

> **让「每关通关」在「温润青铜」人格下明显但不喧宾夺主 —— 靠的是给它一个独占的时间窗和正确的电平位阶，而不是把它调响。**

---

# 1. 结论速览（TL;DR）

**是不是真问题：是。而且不是错觉 —— 有实测证据。**

**最可能的 1 个根因：**

> **通关音 `sfx_win_session` 与「最后一次配对成功音」`sfx_match_success_new` 在同一帧起播、音色同族（都是软槌敲击的青铜钟琴、都是单击 + 衰减、能量都集中在前 250ms），而通关音的峰值还比它低 2.3 dB。**
> **结果：通关那一刻根本不存在一个「属于通关」的独立声音事件 —— 玩家听到的是「最后一次配对成功」，通关音只是它下面 2.3 dB 的同色影子。**

放大这个根因的第二层因素（同样实测）：**整库 44 个 SFX 从未做过响度归一，峰值跨度 46.8 dB**。在这个混乱的电平地图上，通关音（−11.1 dBFS）恰好落在「和翻牌音一样响、比第二颗星低 6.7 dB」的位置 —— 它在自己的高潮时刻只排**第三响**。

**被 BGM 盖住吗：不是。** BGM 在对局场景的实际增益只有 0.165（−15.6 dB），叠加对白 ducking 后再降 9 dB，通关瞬间 BGM 几乎不存在。BGM 完全无辜。

**要不要新增 `sfx_level_clear`：建议不新增。** 真正缺的不是「一层」，是「一个空窗 + 一个位阶」。方案见 §4.5（同时给出两个备选供拍板）。

---

# 2. 实测数据（本报告的地基）

## 2.1 通关瞬间的真实时间线（代码推演）

以「最后一对是新币种」为例（收集类玩法中最常见的收尾）。t=0 = 第二张牌翻中的那一帧，`gameTimeMs` 口径。

| t (ms) | 事件 | 触发点 | 素材实测峰值 | 链路后有效峰值 |
|---:|---|---|---:|---:|
| −300 左右 | `sfx_card_flip` | flipCard | −9.3 dBFS | −10.7 dBFS |
| **0** | `sfx_match_success_new` | `app.ts:623` 立即 | **−8.8 dBFS** | **−10.2 dBFS** |
| **0** | **`sfx_win_session`** | `app.ts:684` 立即（`finishWin()`） | **−11.1 dBFS** | **−12.5 dBFS** |
| ~16 | `sfx_star_pip` `_01` | `app.ts:689` `wonAt + 250×0` → 下一帧出队 | −17.6 dBFS | −19.0 dBFS |
| 250 | `sfx_star_pip` `_02` | `wonAt + 250×1` | **−4.4 dBFS** | **−5.8 dBFS** |
| 500 | `sfx_star_pip` `_03` | `wonAt + 250×2` | −20.3 dBFS | −21.7 dBFS |
| 570 | `sfx_unlock_codex` | `app.ts:625` `t0+370+200` | −1.0 dBFS | **被并发裁剪丢弃**（见 §3.5） |
| 800 | `sfx_region_complete` | `app.ts:748`（若该局集满区域） | −4.2 dBFS | 同上，高风险被丢 |
| 1010 | `sfx_chapter_complete` / `sfx_grade_unlock` | `app.ts:700 / 706` | −13.9 / −0.3 dBFS | 仅整章打通 / 新档解锁时 |

**增益链**（`audioManager.ts:468`）：`final = BUS_GAIN[bus] × volumeMul × sfxVolume/100`
- `SFX_REWARD` / `SFX_GAMEPLAY`：`1.0 × 1.0 × 0.85 = 0.85` → **−1.41 dB**
- `SFX_UI`：`0.7 × 1.0 × 0.85 = 0.595` → −4.51 dB
- `MUSIC`（pair 场景）：`0.3 × 1.0 × 0.55 = 0.165` → **−15.65 dB**；对白 ducking ×0.35 → −24.77 dB

**读这张表只需要看一件事：通关瞬间的响度排行是**

```
① star_pip_02      −5.8 dBFS   ← 全场最响，是「第二颗星」
② match_success_new −10.2 dBFS  ← 第二响，是「最后一次配对」
③ card_flip        −10.7 dBFS  ← 第三响，是 0.3 秒前的「翻牌」
④ win_session      −12.5 dBFS  ← 第四响，这才是「通关」
```

**通关音比它前一秒的翻牌音还低 1.8 dB。** 玩家在一局里听了 18~36 次和「通关」一样响的翻牌声 —— 通关音在电平上没有任何「这是件大事」的信号。

## 2.2 素材包络实测（为什么「像没响」）

`sfx_win_session_01.mp3`（dur 1.80s，分段测量）：

| 窗口 | 峰值 | RMS |
|---|---:|---:|
| 0–0.25s | **−11.1** | **−21.2** |
| 0.25–0.5s | −18.2 | −27.2 |
| 0.5–0.75s | −25.8 | −36.2 |
| 0.75–1.0s | −31.2 | −41.2 |
| 1.0–1.3s | −37.3 | −48.4 |
| 1.3–1.8s | −45.2 | −58.5（静音） |

**两个结论：**

1. **它不是 1.8 秒的音效，是一个 250ms 的单击 + 衰减尾。** 有效内容 1.26s 后就是纯静音（`silencedetect` 实测 `silence_start: 1.258`）。所有能量在前 250ms —— 而这 250ms 正是 `match_success_new` 的峰值窗口。
2. **prompt 里的「three note arpeggio（三音琶音）」没有被生成器兑现。** 包络是单调衰减，听不出三个音的分离。作为对比，`sfx_match_success_new_01` 的包络（0–0.25s 峰 −8.8 / RMS −21.3，0.25–0.5s 峰 −19.9）**形状几乎完全一致**。

> 这就是「同音色、同包络、同起播时刻、通关音还更小声」—— 人耳无法把它们分成两个事件，只会听成一个稍微厚一点的配对音。

## 2.3 通关序列的电平混乱

`sfx_star_pip` 三个变体本应是「音高递升、电平相当」的一组 pip，实测：

| 变体 | 峰值 | 有效内容长度 |
|---|---:|---|
| `_01` | −17.6 dBFS | 0–0.52s |
| `_02` | **−4.4 dBFS** | 0–0.42s |
| `_03` | −20.3 dBFS | 0–0.16s |

**组内跨度 15.9 dB。** 播出来是「叮…**咣！**…（几乎没有）」。第二颗星比通关音本身还响 6.7 dB —— 玩家记住的「过关声」其实是第二颗星。

若 `earnedStars = 1`（新手常见），整个通关只响 `_01`（−17.6 dBFS，全组最弱），更空。

## 2.4 随机变体带来的「有时候听得见」

`sfx_match_success_new` 两个变体：`_01` 峰值 **−8.8**，`_02` 峰值 **−28.4** —— 相差 **19.6 dB**，且 `audioManager.ts:483-487` 是随机轮转。

- 抽到 `_01` → 通关音被压过 → 「没听见通关音」
- 抽到 `_02` → 配对音几乎无声 → 通关音反而清楚 → 「诶这次听见了」

**这解释了用户反馈里「听不明显」而不是「没有声音」的措辞** —— 它是随机时好时坏的，不是恒定缺失。

---

# 3. 四问逐条诊断

## 3.1 【问题一】被 star_pip 掩盖？→ **是，但机制和预期不同**

**结论：是，但主犯不是「升调掩盖」，是「同帧起播 + 电平倒挂」。**

- `finishWin()` 在 `app.ts:684` **同步立即**播 `win_session`；`app.ts:689-693` 把第 i 颗星排到 `wonAt + STAR_POP_INTERVAL × i`，**i=0 的偏移是 0**，由 `tick()` 的 ③b（`app.ts:340-345`）在下一帧出队 → 两者实际相隔 **≤16ms，等同同帧**。
- `STAR_POP_INTERVAL = 250`（`app.ts:77`）、`STAR_POP_MS = 260`（`app.ts:78`）。第二颗星落在 t=250ms —— 此时 `win_session` 已衰减到峰 −18.2 dB，而 pip `_02` 以 −4.4 dBFS 砸下来，**瞬时差 13.8 dB**。
- 所以掩盖是**两段式**的：t=0 被 `match_success_new` 平掩（同色同响），t=250 被 `star_pip_02` 覆盖（后掩蔽 + 强瞬态）。

**修正一处认知**：`sfx_star_pip` 并**不是**上轮金属重做的素材（`sfx-metallic-redesign.md` §4 明确列入「保持不变清单」，文件时间戳 19:21 vs 金属组 21:22）。它是旧版小铃 pip，从未和新版青铜 `win_session` 做过一次同场混音校准 —— 这是本次问题的直接来源。

## 3.2 【问题二】ducking 压低？→ **否（不是直接元凶），但它是「感觉安静了」的共犯**

**逐项核实：**

- **ducking 只作用于 MUSIC 总线。** `targetMusicGain()`（`audioManager.ts:687`）里 `duckFactor` 只乘在 music 上；`sfxVolumeFor()`（`:468`）完全不含 duck。**任何 duck 都不会压低通关音。**
- **finishWin 时确实有对白在 duck。** `app.ts:646-648`：完成局的同一帧触发 `MATCH_SUCCESS_NEW` toast，`app.ts:648` 再排 `MATCH_WIN_SESSION`（delay 500）。toast 起播 → `app.ts:819 duckPush()`（默认 `DIALOGUE_DUCK_FACTOR = 0.35`）。
- **引用计数没有漏解。** push / pop 严格同点配对（`app.ts:819` push / `app.ts:825` pop），且 `resetTransient()` 有硬归零 `this.audio.resetDuck()`（`app.ts:527`）。`sfx_chapter_complete` 的 `duck:0.5` 走自动释放队列（`audioManager.ts:447-450`），释放时刻 = `now + ASSUMED_DURATION_MS.SFX_REWARD(2000)`，素材实长 2.04s，基本吻合；`sweepDuckReleases()` 由 `tick()` 每帧驱动（`app.ts:280` → `audioManager.ts:313`），`loop()` 无条件每帧调用，**不存在卡在压低档的路径**。

  → **ducking 引用没有漏解。这一项可以从怀疑名单划掉。**

- **但它制造了「变安静了」的错觉。** 通关瞬间 BGM 的实际电平：`−17.6 LUFS`（文件） × 0.165 = **−33.2 LUFS**，再 ducking ×0.35 → **−42.4 LUFS**，等于消失。同时前景只有一个 −12.5 dBFS 的软起音短击。**整个高潮时刻的总声能比刚才的对局过程还低** —— 玩家的主观描述「听不明显」，一半来自这个能量塌陷。

  → 这不需要改 ducking（压低 BGM 让位给仪式音本身是对的），需要的是把前景补上去。

## 3.3 【问题三】音量 / 被 BGM 盖住？→ **BGM 否；素材电平 是**

**BGM 部分：明确否。**

| | 文件响度 | 链路增益 | 有效响度 |
|---|---:|---:|---:|
| `bgm_match` | −17.6 LUFS | ×0.165（−15.6 dB） | **−33.2 LUFS** |
| `sfx_win_session` | −24.6 LUFS | ×0.85（−1.4 dB） | **−26.0 LUFS** |

通关音比 BGM **高 7.2 LU**，ducking 后**高 16.4 LU**。BGM 不构成掩蔽，`musicVolume` 默认 55、`MUSIC_SCENES.pair.gain = 0.3` 都不需要动。

**素材电平部分：是，而且是系统性的。**

`sfx_win_session` 是奖励组里**最弱的一档**：

| 事件 | 峰值 dBFS | 相对 win_session |
|---|---:|---:|
| `sfx_grade_unlock` | −0.3 | +10.8 |
| `sfx_unlock_codex` | −1.0 | +10.1 |
| `sfx_region_complete_amer` | −4.2 | +6.9 |
| `sfx_star_pip_02` | −4.4 | +6.7 |
| `sfx_match_success_new_01` | −8.8 | +2.3 |
| `sfx_card_flip_01` | −9.3 | +1.8 |
| **`sfx_win_session_01`** | **−11.1** | **0（基准）** |
| `sfx_chapter_complete` | −13.9 | −2.8 |

**`sfxVolume` 默认 85 不该动。** 理由：① BGM 已证明无辜；② 提到 100 只有 +1.4 dB，杯水车薪；③ `grade_unlock`(−0.3)、`ui_toggle_02`(−0.13)、`dialogue_pop_02`(−0.44) 三个文件本身就贴顶，全局提增益会在部分安卓机的 `innerAudioContext` 上直接削顶失真。
**正确做法是把素材电平重整到分层目标，代码侧的音量默认值保持不变。**

## 3.4 【问题四】缺「过关层」？→ **不缺层，缺「空窗 + 位阶」。建议不新增事件**

普通一局确实只响 `win_session` 一档（`app.ts:684`），`chapter_complete` 仅整章打通才推（`app.ts:696-701`）。但**新增 `sfx_level_clear` 解决不了根因**：

1. **语义重复。** `sfx_win_session` 在 `audio-events.md` 里的定义就是 C3「一局完成」—— 它**就是**过关层。新增一个同义事件，等于在承认注册表设计失败，还要维护两套语义。
2. **新事件会继承同一个坑。** 如果它仍然在 t=0 和 `match_success_new` 同帧起播、仍然没做电平归一，换个 ID 一样听不见。
3. **成本不对称。** +1 事件 = +1 资产 + +1 条合规 prompt 面 + 注册表/落点/降级表全链路改动；而真正的修复只需要「延后 420ms + 电平归一」。

**判定：这是混音问题，不是事件缺失问题。** 备选方案仍列在 §4.5 供主理人拍板。

## 3.5 【额外发现】并发裁剪把 P1 奖励音静默丢弃（本次连带修复）

`reserveVoiceSlot()`（`audioManager.ts:513-527`）在满位时的规则是：找优先级数值最大者，**仅当它严格低于来者才抢占**（`:523` `if (worstIdx < 0 || worstPri <= def.priority) return false;`）。**同优先级 → 丢弃来者。**

配合 `ASSUMED_DURATION_MS.SFX_REWARD = 2000`（`audioManager.ts:136`）—— 而实测奖励音的**可听内容普遍 ≤ 0.5s**，`win_session` 1.26s 后是纯静音 —— 声部记账会把奖励音「挂账」整整 2 秒。

**推演 t=570ms（新币种收尾局）：**
存活声部 = `match_success_new`(P1) + `win_session`(P1) + `star_pip_01/02/03`(P1) = **5 个，全部 P1**，`MAX_CONCURRENT_VOICES − 1 = 5` 已满 → `worstPri(1) <= def.priority(1)` → **`sfx_unlock_codex` 被静默丢弃**。

同理 t=800ms 的 `sfx_region_complete`（区域集满，最稀有的正反馈之一）在收尾局也会被丢。

> 这不是用户报的那个问题，但它就藏在同一段代码里，**是「最该响的时刻反而更空」的第二个成因**，建议一并修。

---

# 4. 调优方案

按「先做 P0-B（纯代码，30 分钟见效）→ 再做 P0-A（资产，根治）→ 补 P1」的顺序落地。两项 P0 互相独立，可分批发版。

## 4.1 P0-B · 代码侧：通关仪式时序错峰（给通关音一个 280ms 的独占空窗）

**设计意图：仪式感来自停顿，不来自音量。** 在「温润青铜·展柜微光」的人格下，正确的做法是让通关音**先落地、再点星**，而不是把它推到最响 —— 后者会直接违反 §0 的「不喧宾夺主」。

**目标时间线：**

```
t=0     最后一次配对成功（match_success_new / repeat）  ← 保留，它是「这一对成了」
t=420   ★ 通关音 win_session                          ← 独占空窗，前后 280ms 无其它 SFX
t=700   星 ①  ┐
t=950   星 ②  ├ 逐颗点亮，电平低于通关音 3~5 dB
t=1200  星 ③  ┘
t=1710  章节完成 / 新档解锁（若有）
```

读法从「一坨响」变成 **「成了 → 过关了 → 一、二、三颗星 → 整章打通」**，四个层级各占各的时间窗。

**新增常量（建议放在 `app.ts` 与 `STAR_POP_INTERVAL` 同处，供 renderer 复用）：**

| 常量 | 值 | 含义 |
|---|---:|---|
| `WIN_SFX_DELAY` | `420` | 通关音相对 `wonAt` 的延迟。取 420 是因为 `match_success_new` 的可听主体在 0–450ms（§2.2 实测），420 让通关音落在它的尾巴上而不是头上 |
| `STAR_SEQ_DELAY` | `700` | 三颗星（**视觉与音频同时**）整体后移量。700 − 420 = 280ms，即通关音的独占窗 |

**⚠ 视听必须同步改，否则出 bug：** 星星弹出动画在 `renderer.ts:229` 用 `appearAt = i * STAR_POP_INTERVAL`。只改音频不改渲染 → 「星星亮了但没声、声音响了星星早没了」。三处必须同一次改完，见 §5 清单。

## 4.2 P0-A · 资产侧：全库响度归一 + 前导静音裁剪（根治）

**这是唯一能修「同一事件三个变体差 16 dB」的手段** —— 因为 `AudioEventDef.volumeMul` 是**事件级**参数（`audioEvents.ts:53`），无法逐变体调节。代码侧改不了 `star_pip_02` 单独太响。

**方法：离线 ffmpeg 处理，零 ElevenLabs 积分，可逆。**

先备份（沿用既有 `_backup_wooden/` 先例）：
```
cp -R minigame/assets/audio/sfx minigame/assets/audio/sfx_backup_prelevel
```

每个文件做三件事：
1. **去前导静音**（阈值 −50 dB，容差 10ms）→ 触发即响，消除感知延迟
2. **峰值增益到分层目标** `volume=<G>dB` + `alimiter` 兜底防削顶
3. **裁尾**：保留自然衰减至 −50 dB 后再留 150ms → 顺带缩包体、让 §4.3 的声部记账更准

编码回 mp3 128k 单声道（与现状一致），**只做一次重编码**。

### 通关序列目标表（P0 范围，7 个文件）

目标口径 = **文件真峰值**，已倒推掉总线增益，使「有效电平」形成正确位阶。

| 文件 | 总线 | 实测 TP | 目标 TP | 需增益 | 备注 |
|---|---|---:|---:|---:|---|
| `sfx_win_session_01` | REWARD | −11.1 | **−5.1** | **+6.0 dB** | 通关锚点，仅次于章节完成 |
| `sfx_chapter_complete_01` | REWARD | −13.9 | −4.1 | +9.8 dB | 全作唯一 P0，最高位阶 |
| `sfx_match_success_new_01` | REWARD | −8.8 | −9.1 | −0.3 dB | 退到通关音下方 4 dB |
| `sfx_match_success_new_02` | REWARD | −28.4 | −9.1 | +19.3 dB | ⚠ B 档，见下 |
| `sfx_star_pip_01` | REWARD | −17.6 | −10.1 | +7.5 dB | 三颗递升 1 dB |
| `sfx_star_pip_02` | REWARD | −4.4 | −9.1 | **−4.7 dB** | 从「最响」降到通关音下方 4 dB |
| `sfx_star_pip_03` | REWARD | −20.3 | −8.1 | +12.2 dB | ⚠ B 档边界 |
| `sfx_unlock_codex_01` | REWARD | −1.0 | −11.1 | −10.1 dB | 与 new 靠材质对比分离，不需要抢电平 |
| `sfx_grade_unlock_01` | REWARD | −0.3 | −5.6 | −5.3 dB | 顺带解除贴顶风险 |
| `sfx_region_complete_amer/euro/asia_afr` | REWARD | −4.2 / −9.6 / −14.3 | −5.6 | −1.4 / +4.0 / +8.7 | 三区域必须等响 |

处理后的有效电平位阶（`sfxVolume=85`）：

```
chapter_complete  −5.5 dBFS   最大仪式
win_session       −6.5 dBFS   ★ 每关通关（比翻牌高 11 dB）
region / grade    −7.0 dBFS
star_pip ①②③     −11.5 / −10.5 / −9.5 dBFS   （通关音下方 3~5 dB）
match_success_new −10.5 dBFS
unlock_codex      −12.5 dBFS
card_flip         −17.5 dBFS  最高频，最低
```

> **通关音比翻牌高 11 dB、比星星高 3~5 dB、比章节完成低 1 dB** —— 这就是「明显但不喧宾夺主」的量化定义。

**⚠ B 档（需增益 > +12 dB）：拉伸会同时抬起编码底噪，建议重生成而非硬拉。**
本次涉及 `sfx_match_success_new_02`(+19.3)、`sfx_star_pip_03`(+12.2)，加上附录里的 `ui_tap_01`(+33)、`ui_locked_01`(+17.1)、`streak_milestone_01`(+20.1)、`view_codex_open_02`(+12.7)，共 6 个文件 ≈ **8.2 秒 ≈ 330 积分**（免费档 1 万/月，可忽略）。重生成时 **prompt 一字不改**，只重跑 —— 属于「同规格重摇」，不触发合规复审。

### 合规声明（重要，避免误判为违规）

`sfx-metallic-redesign.md` §4 的「保持不变清单」约束的是**材质 / prompt 语义**（`star_pip` 必须保持小铃、`match_miss` 必须保持木质…）。
**本方案只改电平与静音裁剪，不改任何音色、不改任何 prompt。** 三条听觉铁律与合规黑名单（无金币碰撞 / 无收银机 / 无中奖号角）全部不受影响。B 档重生成使用**完全相同的 prompt**。

## 4.3 P1 · 并发记账与抢占规则修正（`audioManager.ts`）

| 项 | 现状 | 建议 | 理由 |
|---|---|---|---|
| `ASSUMED_DURATION_MS.SFX_REWARD` | `2000`（`:136`） | **`1200`** | 实测奖励音可听内容 ≤0.5s，`win_session` 1.26s 后纯静音。2000 会让奖励音「挂账」整 2 秒，白占并发位 |
| `ASSUMED_DURATION_MS.SFX_GAMEPLAY` | `700` | `600` | 实测 `card_flip` 有效内容 ≈0.55s |
| `reserveVoiceSlot()` 同优先级策略 | `worstPri <= def.priority → return false`（`:523`），**丢来者** | **同优先级时抢占「起播最早」者（FIFO）** | 现状会在 5 个 P1 挤满时静默丢掉 `unlock_codex` / `region_complete`（§3.5 推演）。新来的奖励音永远比 500ms 前的更相关 |

> 若 §4.2 的裁尾落地（win_session 1.80s → ~1.35s），`sweepVoices()` 的 `handle.playing` 判定也会同步变准，两项修改互相加成。

## 4.4 `sfxVolume` 默认值：**不动，保持 85**

`metaStore.ts:98 DEFAULT_SFX_VOLUME = 85`、`audioManager.ts:144`（内存兜底）保持一致，不改。
理由见 §3.3：BGM 无辜、提到 100 只有 +1.4 dB、且会让三个贴顶文件削顶。**先做资产归一，归一后 85 是正确值**（留 3 dB 数字余量给微信端解码）。

## 4.5 是否新增 `sfx_level_clear`：三个方案供主理人拍板

| | 方案甲（推荐） | 方案乙 | 方案丙 |
|---|---|---|---|
| **做法** | §4.1 时序错峰 + §4.2 电平归一，**不新增事件** | 甲 + **重生成 `sfx_win_session` 素材**为「双段式」 | 甲 + **新增 `sfx_level_clear` 事件** |
| **听感** | 通关音获得独占空窗与位阶，能清楚听到「过关」 | 在甲之上，通关音与配对音**音型对比**（和弦绽放 vs 三音上行），不只是响度差 | 与乙接近，但多一层事件语义 |
| **成本** | 0 资产 / 0 积分；代码 3 文件 | + 1 文件重生成 ≈ **80 积分** | + 1 事件 + 1 资产 + 注册表/降级表/落点全链路 |
| **风险** | 低。若素材本身太「软」，可能仍偏含蓄 | 低。prompt 已备好，合规词表已自检 | 中。语义与 C3 重复，长期维护负担 |
| **我的建议** | **先上甲**，真机走查后再决定要不要加乙 | 甲不够时的**首选补强** | ❌ 不建议 |

**方案乙的 prompt（已过合规词表自检，`dur 2.0` / `pi 0.6`）：**

```
a soft mallet struck bronze chime chord that settles into a short warm bell bloom,
followed by a paper folder closing softly, a clear calm sense of completion,
unhurried, no fanfare, no horns, no cheering, no coins, no cash register
```

关键变化：把没有被兑现的「three note **arpeggio**」改为「**chord** that settles + bell **bloom**」—— 让它在**音型**上与 `match_success_new` 的「三音上行」天然区分。**这是比调音量更符合人格的做法：靠形状被听见，不靠音量被听见。**

---

# 5. 给 engineering-lead（程基岩）的落地清单

## 5.1 P0-B · 代码（3 个文件，必须同一次改完）

| # | 文件 | 位置 | 改动 |
|---|---|---|---|
| 1 | `minigame/src/app/app.ts` | `:77-78` 常量区 | 新增 `export const WIN_SFX_DELAY = 420;` 与 `export const STAR_SEQ_DELAY = 700;`（与 `STAR_POP_INTERVAL/STAR_POP_MS` 并列，便于 renderer import） |
| 2 | `app.ts` | `:684` `finishWin()` 内 | `this.audio.play('sfx_win_session')` 改为入队：`pendingSfx.push({ at: this.wonAt + WIN_SFX_DELAY, id: 'sfx_win_session' })` |
| 3 | `app.ts` | `:688-694` 星 pip 循环 | `at` 由 `this.wonAt + STAR_POP_INTERVAL * i` 改为 `this.wonAt + STAR_SEQ_DELAY + STAR_POP_INTERVAL * i` |
| 4 | `app.ts` | `:696-708` 章节 / 档位落点 | `at` 由 `wonAt + STAR_POP_INTERVAL*3 + STAR_POP_MS` 改为 `wonAt + STAR_SEQ_DELAY + STAR_POP_INTERVAL*3 + STAR_POP_MS` |
| 5 | `app.ts` | `:375` 脏标记保活条件 | `t - this.wonAt < STAR_POP_INTERVAL*3 + STAR_POP_MS` → `< STAR_SEQ_DELAY + STAR_POP_INTERVAL*3 + STAR_POP_MS`。**漏改会导致最后一颗星不重绘** |
| 6 | `minigame/src/render/renderer.ts` | `:229` | `const appearAt = i * STAR_POP_INTERVAL;` → `const appearAt = STAR_SEQ_DELAY + i * STAR_POP_INTERVAL;`；`:9` 的 import 补 `STAR_SEQ_DELAY` |

**自测点：** 通关后依次听到「配对 →(约 0.4s)→ 通关 →(约 0.3s)→ 星① → 星② → 星③」，且**星星视觉与 pip 音严格同帧**。

## 5.2 P0-A · 资产（离线 ffmpeg，不改代码）

1. `cp -R minigame/assets/audio/sfx minigame/assets/audio/sfx_backup_prelevel`
2. 按 §4.2 表逐文件处理（去前导静音 → `volume=<G>dB` → `alimiter` → 裁尾 → mp3 128k 单声道）
3. 处理后复测校验：`ffmpeg -i <f> -af astats -f null -` 的 `Peak level dB` 落在目标 ±0.5 dB 内
4. B 档 6 个文件走 `SFX_ONLY=... node tools/gen_sfx_elevenlabs.mjs` 重生成（**prompt 一字不改**），重生成后同样过一遍归一
5. **不要动** `tools/gen_sfx_elevenlabs.mjs` 的 `BASE` 表（本方案不改 prompt；仅方案乙被采纳时才改 `sfx_win_session` 一行）

## 5.3 P1 · 并发记账（1 个文件）

| # | 文件 | 位置 | 改动 |
|---|---|---|---|
| 7 | `minigame/src/core/audioManager.ts` | `:132-138` | `SFX_REWARD: 2000 → 1200`；`SFX_GAMEPLAY: 700 → 600` |
| 8 | `audioManager.ts` | `:513-527` `reserveVoiceSlot()` | 同优先级时改为抢占**最早起播**者（需给 `Voice` 加 `startedAt`，或复用 `slot.usedAt`），而非 `return false` |

## 5.4 不需要改的（已核实，勿动）

- `metaStore.ts:97-98` `DEFAULT_MUSIC_VOLUME=55` / `DEFAULT_SFX_VOLUME=85` — **保持**
- `audioEvents.ts:348-351` `MUSIC_SCENES`（hub 0.45 / pair 0.3） — **保持**
- `audioEvents.ts:95` `DIALOGUE_DUCK_FACTOR=0.35` — **保持**（ducking 无泄漏，§3.2 已核实）
- `audioEvents.ts:263` `sfx_chapter_complete` 的 `duck:0.5` — **保持**
- `app.ts:819/825` toast duck push/pop 配对 — **保持**（写得是对的）

---

# 6. 验收标准

**客观（可脚本校验）：**
1. `sfx_win_session_01` 文件真峰值 = **−5.1 ±0.5 dBFS**
2. 在 `wonAt` → `wonAt+1400ms` 窗口内，`win_session` 的有效峰值是**全窗口最高的 SFX**（`chapter_complete` 除外）
3. `win_session` 有效峰值 − `card_flip` 有效峰值 ≥ **10 dB**
4. `star_pip` 三变体峰值单调递升，组内跨度 ≤ **2 dB**（现状 15.9 dB）
5. 全库无文件真峰值 > **−3 dBFS**
6. 新币种收尾局中 `sfx_unlock_codex` **不再被丢弃**（`debugState().voices` 在 t=570 时 ≤5 且该事件 `play()` 返回 `true`）

**主观（真机走查，建议 iOS + 中低端安卓各一台，外放 + 耳机各一遍）：**
- 通关瞬间能**明确指认**出「这一声是过关」，而不是「配对音变厚了」
- 通关音**不比章节完成音更抢**（位阶正确）
- 连打 5 局不产生疲劳感（通关音只比配对音高 4 dB，是有意为之）
- 静音 / 减少动态音效开关照常生效

---

# 7. 附录 A · 全库电平体检（同源问题，建议分批落地）

实测 44 个 SFX 文件，**峰值跨度 46.8 dB**（−0.13 ~ −47.0 dBFS）。这是一批未经响度归一的 AI 生成素材，通关音只是最容易被察觉的受害者。以下缺陷与本次问题同源，建议在 §4.2 的同一次批处理里一并修：

| 严重度 | 现象 | 实测 | 影响 |
|---|---|---|---|
| **P0** | `sfx_ui_tap_01` 峰值 **−47.0 dBFS** | 与 `_02`(−25.6) 随机轮转 | **约一半的按钮点击几乎无声** —— 全局最高频交互音，体感「按钮有时没反应」 |
| **P0** | `sfx_dialogue_pop_01` −19.7 vs `_02` **−0.4** | 差 19.3 dB | 册册说话忽大忽小；`_02` 还贴顶。§4 说「2 变体不得有可辨识差异」，现状严重违反 |
| **P1** | `sfx_match_success_new_01` −8.8 vs `_02` −28.4 | 差 19.6 dB | 新发现（游戏核心正反馈）一半时候听不见 |
| **P1** | `sfx_card_flip_01/02` −9.3/−9.5 vs `_03` −23.5 | 差 14 dB | 翻牌忽响忽轻，破坏「机关枪防抖」的初衷 |
| **P1** | `sfx_combo_step_04` −7.0 vs 其余 −20~−25 | 差 13~18 dB | 连击第 4 级突然爆响，读作「出错了」 |
| **P1** | `sfx_region_complete` 三区域 −4.2/−9.6/−14.3 | 跨度 10 dB | 三大洲的仪式感不等价，asia_afr 明显吃亏 |
| **P2** | `sfx_ui_toggle_01/02` −0.43/−0.13 | 贴顶 | 设置面板点一下就削顶，安卓端易失真 |
| **P2** | `sfx_ui_locked_01` −31.1 | 过弱 | 「这扇门还没开」几乎听不到 |
| **P2** | 前导静音：`ui_toggle` 289/352ms、`dialogue_pop_01` 240ms、`view_codex_open_02` 207ms、`unlock_codex` 112ms | — | 触发到出声有可感延迟，UI 反馈「粘手」 |
| **P2** | 尾部静音：`win_session` 1.26s 后 0.54s 纯静音，全库普遍 | — | 白占包体 + 干扰 `sweepVoices` 的 `playing` 判定 |

> 全库归一 + 裁尾预计减小音频体积约 15~25%，属顺带收益。

# 8. 附录 B · 本次诊断的方法与边界

- **代码侧**：只读 `app.ts` / `audioEvents.ts` / `audioManager.ts` / `settings.ts` / `metaStore.ts` / `renderer.ts` / `fx.ts`，未做任何修改。
- **资产侧**：使用 `ffprobe` / `ffmpeg -f null -`（只读测量，不写文件）取时长、真峰值、RMS、EBU R128 积分响度、静音边界、分段包络。**未生成、未覆盖、未删除任何音频文件。**
- **测量口径说明**：<2s 的短音效用 EBU R128 积分响度会受门限影响，故位阶判定**以真峰值 + 0.6s 窗口 RMS 为主**，积分响度仅作交叉验证。两套口径给出的排序一致。
- **未覆盖**：真机播放链路（微信 `innerAudioContext` 的实际增益曲线、部分安卓机的解码音量差异）。§6 的主观走查需要真机补齐，若真机与本文预期不符，请回传实测，我据此再调一轮目标表。

---

**审批项（需主理人拍板）：**
1. 采用 **方案甲**（时序错峰 + 电平归一，0 积分）还是 **甲 + 乙**（额外重生成 `win_session` 素材，+80 积分）？—— 我建议先甲，走查后再定乙。
2. 附录 A 的全库归一是**与 P0 同批落地**，还是**下一版单独发**？—— 我建议同批，因为它和 P0 是同一次 ffmpeg 批处理，边际成本接近零。
3. `sfx_ui_tap_01`（−47 dBFS，约一半点击无声）是否提为**独立 P0 缺陷**单独跟进？
