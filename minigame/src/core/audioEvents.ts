/**
 * core/audioEvents.ts — 音频事件注册表（数据层，对标 core/dialogueData.ts）
 *
 * 唯一真源：design/audio/audio-events.md（阮和鸣，v1.0）。
 * 本文件只声明「有哪些事件、放哪个文件、多响、多重要」，不含任何播放逻辑
 * （调度 / 节流 / 抑制 / ducking 全在 core/audioManager.ts）。
 *
 * ⚠ 本文件**不产生任何音频二进制**。所列路径在 v1 骨架阶段全部不存在，
 *   AudioManager 对缺失文件静默 no-op（对齐 preloadImages 的 .catch() 契约）。
 *   资产由后续 C 阶段（外包制作）按 audio-implementation.md §7.3 规格产出。
 *
 * 合规（audio-direction.md §3.2 / §8.1）：
 *   全部音色为抽象材质（木 / 纸 / 玻璃 / 软槌 / 微铃）。无金币碰撞、无老虎机、
 *   无收银机、无中奖号角、无真实货币采样。事件命名与注释不含任何投资 / 交易 /
 *   预测语义 —— 这是一款文化学习类收集游戏。
 *
 * 命名（audio-events.md §1.1）：**事件 ID = 文件名（不含变体后缀与扩展名）**，
 *   一一对应，杜绝映射表漂移。
 *
 * ── 任务书简称 → 本表规范 ID 映射（简称仅出现在沟通中，代码一律用规范 ID）──
 *   sfx_flip            → sfx_card_flip            (B1)
 *   sfx_codex_open      → sfx_view_codex_open      (A5)
 *   sfx_star_rate[_NN]  → sfx_star_pip (_01/_02/_03) (C4)
 *   sfx_hub_open        → sfx_hub_first_open       (E2)
 *   sfx_hub_return      → sfx_ui_back              (A2，同一插桩点 backToHub()；
 *                          不新造第 45 个资产，说明见 §「返回 Hub」注释)
 *   sfx_region_complete[_NN] → sfx_region_complete (_amer/_euro/_asia_afr，语义变体)
 */

/* ================= 基础类型 ================= */

/** 总线（audio-direction.md §6.1） */
export type AudioBus = 'MUSIC' | 'SFX_UI' | 'SFX_GAMEPLAY' | 'SFX_REWARD' | 'SFX_NARRATIVE';

/**
 * 优先级：与 dialogueData.DialoguePriority 同口径（**数值越小越高**）。
 * P0 仪式性 / P1 关键正反馈 / P2 常规交互 / P3 装饰性。
 * 同发上限溢出时 P3 先丢，P0/P1 永不丢（audio-events.md §1.2）。
 */
export type AudioPriority = 0 | 1 | 2 | 3;

export interface AudioEventDef {
  /** 事件 ID = 文件基名 */
  eventId: AudioEventId;
  /** 相对 assets/audio/ 的文件基路径（不含变体后缀与扩展名） */
  file: string;
  /** 变体后缀列表；'' = 无后缀（BGM），'_01' = 随机变体，'_amer' = 语义变体 */
  suffixes: string[];
  /** 语义变体（按上下文精确选取）而非随机变体 */
  semanticVariants?: boolean;
  loop: boolean;
  /** 事件级增益微调 0..1（最终音量公式见 audioManager §volume） */
  volumeMul: number;
  priority: AudioPriority;
  bus: AudioBus;
  /** 同事件最小触发间隔（ms）；0 = 不节流 */
  throttleMs: number;
  /** 「减少动态音效」开启时整体静默（audio-events.md §8 降级表） */
  reducedFxSilent: boolean;
  /** 实例池大小：热事件 2 实例轮转，避免连发掐断（§3.4） */
  poolSize: number;
  /**
   * 播放期间把 MUSIC 总线压低到该系数（仅 P0 仪式音使用）。
   * 缺省 = 不压。对白 ducking 是另一条路径（AudioManager.duck/unduck）。
   */
  duck?: number;
}

/* ================= 常量 ================= */

/**
 * 音频根目录（路线 A：资产全 CDN，Phase 7 B1 修复）。
 * 真源在 src/config/cdn.ts：CDN 激活时 = <CDN_BASE>/assets/audio/，否则本地 assets/audio/。
 * 此处仅 re-export，避免硬编码域名（构建期经 esbuild define 注入 CDN base）。
 */
export { AUDIO_ROOT } from '../config/cdn';

/** 单一格式：mp3（微信 + 浏览器双端通吃；不用 ogg —— iOS 支持不可靠且双份体积） */
export const AUDIO_EXT = '.mp3';

/** 总线增益（audio-direction.md §6.1） */
export const BUS_GAIN: Record<AudioBus, number> = {
  MUSIC: 1.0,
  SFX_UI: 0.7,
  SFX_GAMEPLAY: 1.0,
  SFX_REWARD: 1.0,
  SFX_NARRATIVE: 0.8,
};

/** E1 抑制窗口：前 400ms 内播过任何非 SFX_UI 组音效 → 跳过（§6.2 规则 1） */
export const E1_SUPPRESS_WINDOW_MS = 400;

/**
 * 对白 ducking 目标系数。
 * ⚠ 任务书指定 0.35；audio-implementation.md §5.2 建议 0.60（理由：册册对白极频繁，
 *   压太狠会让 BGM 像开关声）。此处按任务书取 0.35，保留为单点调音旋钮 —— 真机走查
 *   若觉得music「一说话就没了」，改这一个常量即可。
 */
export const DIALOGUE_DUCK_FACTOR = 0.35;

/** ducking 插值（§5.2）：压下去快、放回来慢 */
export const DUCK_ATTACK_MS = 180;
export const DUCK_RELEASE_MS = 400;

/** 同时发声上限（1 BGM + 5 SFX）与后端实例硬上限（§3.4） */
export const MAX_CONCURRENT_VOICES = 6;
export const MAX_AUDIO_INSTANCES = 12;

/** BGM 交叉淡变时长（§7 F 组，场景切换用） */
export const BGM_FADE_MS = 400;

/**
 * 世界-tour 结尾「收住」淡出时长（任务 2/3：一次性 BGM 在落款段淡出到 0）。
 * ⚠ 任务书口头记为「BGM_FADE_MS = 1.5s」，但 BGM_FADE_MS 是 §7 场景交叉淡变（400ms），
 *   二者语义不同；此处单列 1.5s 专供 fadeMusicOut，不改交叉淡变口径。
 */
export const BGM_FADE_OUT_MS = 1500;

/**
 * 连续登录里程碑门槛（D3）。
 * ⚠ audio-events.md §5 标注为「音频侧建议值，需与文策渊 / 主理人确认元进度设计口径」。
 */
export const STREAK_MILESTONES = [3, 7, 14, 30];

/* ================= 事件 ID ================= */

export type SfxEventId =
  // A 组 · UI 与导航
  | 'sfx_ui_tap'
  | 'sfx_ui_back'
  | 'sfx_ui_toggle'
  | 'sfx_ui_locked'
  | 'sfx_view_codex_open'
  | 'sfx_view_detail_open'
  | 'sfx_ui_scroll_tick'
  // B 组 · 对局交互
  | 'sfx_card_flip'
  | 'sfx_card_flipback'
  | 'sfx_match_miss'
  | 'sfx_match_success_repeat'
  | 'sfx_combo_step'
  // C 组 · 奖励与解锁
  | 'sfx_match_success_new'
  | 'sfx_unlock_codex'
  | 'sfx_win_session'
  | 'sfx_star_pip'
  // D 组 · 元进度与里程碑
  | 'sfx_chapter_complete'
  | 'sfx_region_complete'
  | 'sfx_streak_milestone'
  | 'sfx_grade_unlock'
  // E 组 · 叙事
  | 'sfx_dialogue_pop'
  | 'sfx_hub_first_open';

export type MusicTrackId = 'bgm_hub' | 'bgm_match' | 'bgm_codex' | 'bgm_tour';

export type AudioEventId = SfxEventId | MusicTrackId;

/* ================= 辅助 ================= */

/** 生成 `_01`.._0N 变体后缀 */
function vars(n: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push('_' + String(i).padStart(2, '0'));
  return out;
}

/** SFX 定义简写（默认值集中在此，逐条只写差异） */
function sfx(
  eventId: SfxEventId,
  dir: string,
  bus: AudioBus,
  priority: AudioPriority,
  variantCount: number,
  throttleMs: number,
  extra: Partial<AudioEventDef> = {}
): AudioEventDef {
  return {
    eventId,
    file: `sfx/${dir}/${eventId}`,
    suffixes: vars(variantCount),
    loop: false,
    volumeMul: 1.0,
    priority,
    bus,
    throttleMs,
    reducedFxSilent: false,
    poolSize: 1,
    ...extra,
  };
}

/* ================= 注册表 ================= */

/**
 * 25 个事件 / 47 个文件（44 SFX + 3 BGM）。
 *
 * ⚠ **与文档汇总表的算术出入（已核对，需阮和鸣确认）**：
 *   audio-events.md §9 汇总 A 组为「7 事件 / 12 文件」，但 §2 逐行变体列相加为
 *   2+1+2+1+2+2+3 = **13**，故 SFX 实为 44、总计 47（文档写 43 / 46）。
 *   本表按 §2 的逐行变体数实现（逐行数据比汇总表更具可执行性）。
 *   影响：+1 文件 ≈ +3.2KB，对 300KB 主包预算无实质影响。
 */
export const AUDIO_EVENTS: Record<AudioEventId, AudioEventDef> = {
  /* ---- A 组 · UI 与导航（SFX_UI ×0.70）---- */

  // A1 任意按钮命中。全局最高频交互音，2 实例轮转防掐断
  sfx_ui_tap: sfx('sfx_ui_tap', 'ui', 'SFX_UI', 3, 2, 60, { poolSize: 2 }),

  // A2 返回上一层（backToHub）。音色同 A1 但下行小二度 = 回退语义
  sfx_ui_back: sfx('sfx_ui_back', 'ui', 'SFX_UI', 3, 1, 120),

  // A3 设置项切换（静音 / 色弱 / 音量档）。2 变体 = 开 / 关
  sfx_ui_toggle: sfx('sfx_ui_toggle', 'ui', 'SFX_UI', 3, 2, 100),

  // A4 点击未解锁内容。柔和闷响，**无否定感、非蜂鸣**（项目无失败态）
  sfx_ui_locked: sfx('sfx_ui_locked', 'ui', 'SFX_UI', 3, 1, 300),

  // A5 进入图鉴。书页翻动
  sfx_view_codex_open: sfx('sfx_view_codex_open', 'ui', 'SFX_UI', 3, 2, 200),

  // A6 进入详情。单页轻掀（比 A5 更短更近）
  sfx_view_detail_open: sfx('sfx_view_detail_open', 'ui', 'SFX_UI', 3, 2, 200),

  // A7 图鉴滚动跨行。唯一可整体裁掉的事件；音量压到耳语级
  sfx_ui_scroll_tick: sfx('sfx_ui_scroll_tick', 'ui', 'SFX_UI', 3, 3, 80, {
    volumeMul: 0.55,
    reducedFxSilent: true,
  }),

  /* ---- B 组 · 对局交互（SFX_GAMEPLAY ×1.00）---- */

  // B1 翻牌命中帧。全局最高频；3 变体 + 2 实例轮转 = 防「机关枪感」
  sfx_card_flip: sfx('sfx_card_flip', 'card', 'SFX_GAMEPLAY', 2, 3, 50, { poolSize: 2 }),

  // B2 错配翻回。两张卡共播一次，不双发；B3 已提示错配故降级时静默
  sfx_card_flipback: sfx('sfx_card_flipback', 'card', 'SFX_GAMEPLAY', 3, 2, 0, {
    volumeMul: 0.85,
    reducedFxSilent: true,
  }),

  // B3 错配判定帧。柔和下行小三度，**禁止**下行大跳 / 噪声爆发 / 蜂鸣
  sfx_match_miss: sfx('sfx_match_miss', 'card', 'SFX_GAMEPLAY', 2, 2, 0),

  // B4 已收集币种再次配对成功。卡林巴上行二音，温暖克制
  sfx_match_success_repeat: sfx('sfx_match_success_repeat', 'card', 'SFX_GAMEPLAY', 2, 3, 0, {
    poolSize: 2,
  }),

  // B5 连击装饰层。5 个音阶级变体，5 级封顶
  sfx_combo_step: sfx('sfx_combo_step', 'card', 'SFX_GAMEPLAY', 3, 5, 0, {
    semanticVariants: true,
    reducedFxSilent: true,
  }),

  /* ---- C 组 · 奖励与解锁（SFX_REWARD ×1.00）---- */

  // C1 新币首次配对成功（t=0）。卡林巴上行三音 + 八音盒尾光
  sfx_match_success_new: sfx('sfx_match_success_new', 'reward', 'SFX_REWARD', 1, 2, 0),

  // C2 自动入册盖章（t=BURST_AT 370ms）。与 C1 在 370–900ms 完全重叠，叠加峰值须 ≤ −3dBFS
  sfx_unlock_codex: sfx('sfx_unlock_codex', 'reward', 'SFX_REWARD', 1, 1, 0),

  // C3 一局完成。温暖三和弦琶音 + 纸页收拢
  sfx_win_session: sfx('sfx_win_session', 'reward', 'SFX_REWARD', 1, 1, 0),

  // C4 胜利面板星星逐颗点亮。3 变体为**音高级**（_01/_02/_03 递增），按星序精确选取
  sfx_star_pip: sfx('sfx_star_pip', 'reward', 'SFX_REWARD', 1, 3, 0, { semanticVariants: true }),

  /* ---- D 组 · 元进度与里程碑（SFX_REWARD ×1.00）---- */

  // D1 章节内三档全部 ≥1 星。**全作唯一 P0**，播放期间其余 SFX 压低 ×0.5
  sfx_chapter_complete: sfx('sfx_chapter_complete', 'reward', 'SFX_REWARD', 0, 1, 0, { duck: 0.5 }),

  // D2 区域集满。语义变体按 region 精确选取（唯一的「区域音色微染」落地点）
  sfx_region_complete: {
    eventId: 'sfx_region_complete',
    file: 'sfx/reward/sfx_region_complete',
    suffixes: ['_amer', '_euro', '_asia_afr'],
    semanticVariants: true,
    loop: false,
    volumeMul: 1.0,
    priority: 1,
    bus: 'SFX_REWARD',
    throttleMs: 0,
    reducedFxSilent: false,
    poolSize: 1,
  },

  // D3 连续登录里程碑（STREAK_MILESTONES）
  sfx_streak_milestone: sfx('sfx_streak_milestone', 'reward', 'SFX_REWARD', 1, 1, 0),

  // D4 新难度档开启（isGradeOpen false→true 那一帧）
  sfx_grade_unlock: sfx('sfx_grade_unlock', 'reward', 'SFX_REWARD', 1, 1, 0),

  /* ---- E 组 · 叙事（SFX_NARRATIVE ×0.80）---- */

  // E1 册册 toast 弹出。**册册的声音签名**（v1 无 VO）——音色一致性优先于独特性。
  //    2 变体仅为极轻微呼吸变化，不得有可辨识差异。抑制规则见 audioManager。
  sfx_dialogue_pop: sfx('sfx_dialogue_pop', 'narrative', 'SFX_NARRATIVE', 2, 2, 400, {
    reducedFxSilent: true,
  }),

  // E2 首次进入 Hub（一生一次）。P0，允许延后到首次手势后补播
  sfx_hub_first_open: sfx('sfx_hub_first_open', 'narrative', 'SFX_NARRATIVE', 0, 1, 0),

  /* ---- F 组 · 背景音乐（MUSIC）---- */

  bgm_hub: {
    eventId: 'bgm_hub',
    file: 'bgm/bgm_hub',
    suffixes: [''],
    loop: true,
    volumeMul: 1.0,
    priority: 2,
    bus: 'MUSIC',
    throttleMs: 0,
    reducedFxSilent: false,
    poolSize: 1,
  },
  bgm_match: {
    eventId: 'bgm_match',
    file: 'bgm/bgm_match',
    suffixes: [''],
    loop: true,
    volumeMul: 1.0,
    priority: 2,
    bus: 'MUSIC',
    throttleMs: 0,
    reducedFxSilent: false,
    poolSize: 1,
  },
  bgm_codex: {
    eventId: 'bgm_codex',
    file: 'bgm/bgm_codex',
    suffixes: [''],
    loop: true,
    volumeMul: 1.0,
    priority: 2,
    bus: 'MUSIC',
    throttleMs: 0,
    reducedFxSilent: false,
    poolSize: 1,
  },
  bgm_tour: {
    eventId: 'bgm_tour',
    file: 'bgm/bgm_tour',
    suffixes: [''],
    loop: false,
    volumeMul: 1.0,
    priority: 2,
    bus: 'MUSIC',
    throttleMs: 0,
    reducedFxSilent: false,
    poolSize: 1,
  },
};

/* ================= BGM 场景映射（audio-events.md §7） ================= */

/**
 * 与 app.View 同名，保证「视图 → 音乐」是一次查表，不写 if-else 链。
 *
 * ⚠ 铁律（world-tour-reward §3.3 坑 1）：`app.tick()` 里是
 * `const scene: MusicScene = this.view;` —— **View 新增成员必须与本类型 + 下方
 * MUSIC_SCENES 同一个 commit 落地**，否则运行时查表得 undefined → 静音或抛错。
 */
export type MusicScene = 'hub' | 'pair' | 'codex' | 'detail' | 'world_tour';

/**
 * 场景 → 轨 + 场景增益。
 * **detail 复用 codex 轨**（进出详情不换轨，仅音量 0.40↔0.35 平滑），
 * 这条规则被编码在数据里，AudioManager 只需比较 track 是否变化。
 */
export const MUSIC_SCENES: Record<MusicScene, { track: MusicTrackId; gain: number }> = {
  hub: { track: 'bgm_hub', gain: 0.45 },
  pair: { track: 'bgm_match', gain: 0.3 },
  codex: { track: 'bgm_codex', gain: 0.4 },
  detail: { track: 'bgm_codex', gain: 0.35 },
  // 「环游世界」全收集结算（world-tour-reward §5）：专用 BGM = bgm_tour，非循环一次性播放
  // （loop:false，约 32.7s，收在完整终止式上），gain 0.44（阮和鸣 spec）。影片尾部由
  // app.tick 在转入 outro 阶段时触发 1.5s fade-out，结束在终止式上 —— 不循环、不重起播。
  world_tour: { track: 'bgm_tour', gain: 0.44 },
};

/* ================= 查询辅助 ================= */

export function getAudioEvent(id: AudioEventId): AudioEventDef | undefined {
  return AUDIO_EVENTS[id];
}

/** 某事件的全部变体相对路径（含扩展名，相对 AUDIO_ROOT） */
export function filesOf(def: AudioEventDef): string[] {
  return def.suffixes.map((s) => def.file + s + AUDIO_EXT);
}

/** 单个变体的相对路径；index 越界时回绕，永不返回 undefined */
export function fileOf(def: AudioEventDef, index: number): string {
  const n = def.suffixes.length;
  const i = n > 0 ? ((index % n) + n) % n : 0;
  return def.file + (def.suffixes[i] ?? '') + AUDIO_EXT;
}

/** 需交付的全部音频文件相对路径（供资产管线 / 清单校验消费） */
export function allAudioFiles(): string[] {
  const out: string[] = [];
  for (const key of Object.keys(AUDIO_EVENTS) as AudioEventId[]) {
    out.push(...filesOf(AUDIO_EVENTS[key]));
  }
  return out;
}

/** 事件总数 / 文件总数（自检与文档核对用） */
export function audioManifestStats(): { events: number; files: number; sfxFiles: number; bgmFiles: number } {
  let sfxFiles = 0;
  let bgmFiles = 0;
  const ids = Object.keys(AUDIO_EVENTS) as AudioEventId[];
  for (const id of ids) {
    const def = AUDIO_EVENTS[id];
    const n = def.suffixes.length;
    if (def.bus === 'MUSIC') bgmFiles += n;
    else sfxFiles += n;
  }
  return { events: ids.length, files: sfxFiles + bgmFiles, sfxFiles, bgmFiles };
}
