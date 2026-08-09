/**
 * app/app.ts — 顶层状态机（hub / pair / codex / detail）
 *
 * 职责：
 *  - 持有运行时状态，复用 core 纯逻辑（deck/matchLogic/collectionStore/metaStore/tierConfig/starRating）；
 *  - 自动收藏：首次成功配对 → store.unlock(iso, form)（幂等，GDD §2）；
 *  - 游戏时钟 gameTimeMs（Phase1 §5.2）：每帧 += min(dt,100)，后台切回不跳段；
 *    所有动画（翻牌 / 错配翻回 / 清除 / burst / toast）均以它为唯一时间基准，禁用 setTimeout；
 *  - **关卡 = (chapter, grade)**（关卡文档 §2）：章节定币种池、难度档定对数/网格/副本，
 *    组牌与网格一律走 data/chapters.chapterPlan（对数绑定内容，不再查固定档位表）；
 *  - 局末星评落盘（§2）与现实锚闪现 toast 队列（§1）。
 *
 * 渲染只通过 platform 的 ctx 进行；输入经 input.ts 命中 UI 元素后回调本类方法。
 */

import { Platform, ImageLike, platformKV, platformAudio, Region } from '../platform/types';
import { CollectionStore } from '../core/collectionStore';
import { MetaStore } from '../core/metaStore';
import { buildDeckPlan, entityKey } from '../core/deck';
import {
  flip,
  evaluate,
  flipBack,
  createMatchState,
  MISMATCH_FLIPBACK_MS,
} from '../core/matchLogic';
import { Card, MatchState, FormFactor } from '../core/types';
import { TierId, TierGrid, PlanContext } from '../core/tierConfig';
import { starsFor, Stars } from '../core/starRating';
import {
  ChapterId,
  Grade,
  MatchMode,
  ChapterProgress,
  CHAPTERS,
  chapterById,
  chapterPlan,
  poolIsos,
  isChapterOpen as chapterOpen,
  isGradeOpen as gradeOpen,
} from '../data/chapters';
import {
  CURRENCIES,
  FORM_FACTORS,
  getCurrency,
  REGION_LABELS,
} from '../data/currencies';
import {
  TOUR_FRAME_COUNT,
  tourFrameKey,
  tourFrameSrc,
  tourPhaseAt,
} from '../data/worldTour';
import { IMAGES_BASE, SCENES_BASE, AUDIO_ROOT } from '../config/cdn';
import { drawApp, drawLoadingScreen, drawRotateOverlay } from '../render/renderer';
import { boardLayout, effectiveGrid } from '../render/layout';
import {
  ClearAnim,
  clearAnimAt,
  CLEAR_C_END,
  BURST_AT,
  UNLOCK_TOAST_DELAY,
  spawnBurst,
  updateFx,
  hasActiveFx,
  resetFx,
  ToastItem,
  toastTotal,
  TOAST_ENTER_MS,
  TOAST_HOLD_MS,
  TOAST_HOLD_SHORT_MS,
} from '../render/fx';
import { DialogueEngine } from '../core/dialogueEngine';
import { todayISO } from '../core/metaStore';
import { AudioManager } from '../core/audioManager';
import { MusicScene, SfxEventId, STREAK_MILESTONES } from '../core/audioEvents';
import { HitTarget } from '../render/types';
import { attachInput } from './input';

const FLIP_MS = 300;

/** 场景底图键（preloadScenes 与加载计数共用，loading-gate.md） */
const SCENE_KEYS = ['scene_hub', 'scene_board', 'scene_codex', 'scene_detail', 'deco_globe'];

/** BGM 文件键（preloadAudio 与加载计数共用；4 个场景音乐并行预热进 HTTP 缓存） */
const BGM_KEYS = ['hub', 'codex', 'match', 'tour'];
/** toast 队列容量（§1.4） */
const TOAST_QUEUE_MAX = 3;
/** 胜利面板每颗星弹入间隔（§2.5） */
export const STAR_POP_INTERVAL = 250;
export const STAR_POP_MS = 260;
/**
 * 通关仪式时序错峰（clear-sfx-presence-fix.md §4.1）。
 * 仪式感来自停顿，不来自音量：让通关音先落地、再点星。
 *
 *   t=0    最后一次配对成功（match_success_new / repeat）
 *   t=420  ★ 通关音 win_session —— 独占空窗，前后 280ms 无其它 SFX
 *   t=700  星 ① ┐
 *   t=950  星 ② ├ 视觉与音频严格同帧（renderer.ts 复用 STAR_SEQ_DELAY）
 *   t=1200 星 ③ ┘
 *   t=1710 章节完成 / 新档解锁（若有）
 */
/** 通关音相对 wonAt 的延迟：420 让它落在 match_success_new 可听主体（0–450ms）的尾巴上而非头上 */
export const WIN_SFX_DELAY = 420;
/** 三颗星（视觉 + 音频）整体后移量：700 − 420 = 280ms 即通关音的独占窗 */
export const STAR_SEQ_DELAY = 700;

/**
 * 顶层视图。
 *
 * ⚠ 扩展铁律（world-tour-reward §3.3 坑 1）：tick() 里有
 * `const scene: MusicScene = this.view;`（无 as 断言，故意的）。
 * **本类型新增任何成员，必须与 `core/audioEvents.MusicScene` + `MUSIC_SCENES`
 * 在同一个 commit 落地**，否则编译即报错（这正是那行不加断言的目的），
 * 漏配到运行时就是查表 undefined → 静音或抛错。
 */
export type View = 'hub' | 'pair' | 'codex' | 'detail' | 'world_tour';

export class App {
  readonly platform: Platform;
  readonly ctx: ReturnType<Platform['getContext']>;
  readonly store: CollectionStore;
  readonly meta: MetaStore;

  view: View = 'hub';
  match: MatchState | null = null;
  form: FormFactor = 'coin';          // 当前配对局形态
  selectedForm: FormFactor = 'coin';  // Hub 形态选择
  /** 当前关卡的章节（决定币种池，关卡文档 §2） */
  chapter: ChapterId = 'amer';
  /** 当前关卡的难度档（决定对数/网格/副本） */
  grade: Grade = 1;
  /** 当前局配对模式；world T3 的 'associate' 已 defer 到 Phase 2（见 startChapter） */
  mode: MatchMode = 'match';
  /** 当前局网格：由 chapterPlan 按对数推导，**不再查固定档位表**（单区 6 币不空格） */
  grid: TierGrid = { cols: 2, rows: 3 };
  /** Hub 中展开的章节书架（null = 全部收起） */
  hubOpenChapter: ChapterId | null = null;
  detailIso: string | null = null;
  /** DEV: 跳过 note 形态竖屏遮罩（桌面浏览器测试用；localStorage 'dev_landscape'='1' 开启） */
  readonly devSkipLandscapeMask: boolean;

  /**
   * @deprecated 旧「三档 tier」模型的兼容读口，等价于当前 grade。
   * 星评 / 展示一律直接用 grade；本 getter 仅兜住尚未迁移的外部读取，不可写。
   */
  get tier(): TierId {
    return this.grade as TierId;
  }

  best = 0;
  won = false;
  /** 本局星评（胜利后有效） */
  earnedStars: Stars = 1;
  /** 胜利时刻（游戏时钟，驱动三星逐颗弹入） */
  wonAt = 0;
  sessionUnlocked: string[] = [];     // 本局新解锁实体键（用于胜利结算展示）

  /* ---- 「环游世界」全收集结算（world-tour-reward §3.2 第 4 项） ---- */
  /**
   * 第 36 个实体解锁时置起的**待播旗标**（§3.1）：解锁发生在 flipCard 的 firstTime 分支里，
   * 此刻棋盘上通常还有未配对的牌 —— 当场弹 33 秒全屏影片会打断对局、抢在星级结算之前、
   * 让玩家搞不清自己到底赢没赢。所以这里**只置旗标、不改 view**，
   * 由局末胜利面板的「继续」按钮消费（renderer.drawWin）。
   */
  pendingWorldTour = false;
  /** 影片起播时刻（游戏时钟） */
  tourStartedAt = 0;
  /** 当前播放到第几帧（0-based；由 tick 从时间轴反推，渲染层与预载共用） */
  tourFrame = 0;
  /** 重看模式：跳过开场 2s 主文案（§3.4），其余不变 */
  tourReplay = false;
  /** 暂停中（单击画面任意处切换，§2.4：长文化注脚需要停下来读的空间） */
  tourPaused = false;
  /** 进入暂停的时刻（游戏时钟） */
  private tourPausedAt = 0;
  /** 历史暂停累计毫秒 —— 从 elapsed 里扣掉，保证暂停期间时间轴真的停住 */
  private tourPauseAccum = 0;
  /** 世界-tour 尾部已触发 1.5s 淡出（outro 阶段只触发一次） */
  private tourFadeStarted = false;

  /** 游戏时钟（§5.2）：所有动画/延时的唯一时间基准 */
  gameTimeMs = 0;
  /** 错配翻回到点时刻；-1 = 无待处理 */
  private pendingFlipBackAt = -1;

  // 图鉴 / 详情滚动（内容坐标偏移，负向）
  codexScroll = 0;
  codexScrollMin = 0;

  // 母题 PNG 缓存（key = `${iso}_${form}`）；缺失则用几何占位
  images: Map<string, ImageLike> = new Map();

  dirty = true;
  hitTargets: HitTarget[] = [];

  /** 清除动画：cardId → 起始游戏时刻（结束后移除 → 渲染层改画幽灵槽位） */
  private clearAnims: Map<string, number> = new Map();
  /** 延迟发射的 burst（t=370ms 起播，§3.1） */
  private pendingBursts: { at: number; ia: number; ib: number; region: Region; unlock: boolean }[] = [];
  /** 延迟入队的 toast（解锁 burst 起播后 200ms，§3.2） */
  private pendingToasts: { at: number; item: ToastItem }[] = [];
  /** 现实锚闪现 toast 队列（FIFO，容量 3，§1.4） */
  toasts: ToastItem[] = [];

  /** 叙事对白引擎（§5 衔接点 #1） */
  dialogue!: DialogueEngine;

  /**
   * 音频运行时（audio-implementation.md）。
   * 零音频文件时全链路 no-op —— 下方所有 audio.* 调用**都不需要判空/判可用**。
   */
  audio!: AudioManager;

  /** 延迟音效队列（游戏时钟驱动，与 pendingToasts 同构；禁用 setTimeout） */
  private pendingSfx: { at: number; id: SfxEventId; variant?: number | string }[] = [];

  /**
   * 本次点按是否已由具体动作认领了专属音效。
   * handleTap 在动作执行后才补 sfx_ui_tap，避免「翻牌/返回/开图鉴」出现
   * 通用点按音与专属音叠播（audio-direction.md「一次交互只发一个语义音」）。
   */
  private tapSfxClaimed = false;

  /**
   * 当前 toast 批次序号。0 = 队列空闲，下一条是「批头」。
   * 用于 E1 抑制规则②「同一批 toast 第 2 条及以后不再播弹出音」——
   * 「批」的语义只有 app 层知道（队列连续不空期间），故判定放这里，
   * AudioManager 只负责规则①（400ms 让位窗口）与③（reducedAudioFx）。
   */
  private toastBatchSeq = 0;

  /** D3 连续天数里程碑 session 级去重 */
  private streakMilestoneFired = false;

  private flipAnim: { ids: Set<string>; start: number } | null = null;
  private lastVp = { w: 0, h: 0 };
  private lastTime = 0;

  /** 启动加载门状态：资产异步就位前显示加载屏，就位后进入游戏 */
  bootPhase: 'loading' | 'ready' = 'loading';
  /** 预加载资产总数（母题 PNG + 场景底图），用于加载进度 */
  private loadTotal = 0;
  /** 已就位资产数（成功/失败都计，避免单张 404 卡死加载屏） */
  private loadDone = 0;
  /** 加载起始时刻（游戏时钟，ms） */
  private loadStartedAt = 0;
  /** 加载超时（ms）：弱网下宁可提前进游戏（几何占位兜底）也不无限转圈 */
  private static readonly LOADING_TIMEOUT = 45000;

  constructor(platform: Platform) {
    this.platform = platform;
    this.ctx = platform.getContext();
    const kv = platformKV(platform);
    this.store = new CollectionStore(CURRENCIES.length, kv);
    this.meta = new MetaStore(kv);
    this.devSkipLandscapeMask = kv.getItem('dev_landscape') === '1';
    this.best = this.store.loadBest();
    // 老玩家迁移（§4.4）：有解锁记录但无局数记录 → 视为已完成 T1 一局，避免档位倒退
    this.meta.migrateLegacy(this.store.progress().unlocked > 0);
    // 章节化迁移（同一 no-fail 哲学，幂等）：老存档有解锁但无章节局数 → 记美洲初识一局，
    // 否则升级后书架会「只剩美洲」，属于回退。新档 unlocked=0 时不触发，门禁验证不受影响。
    if (this.store.progress().unlocked > 0 && this.meta.playsOfChapter('amer') === 0) {
      this.meta.addPlayChapter('amer', 1);
    }
    attachInput(this);
    // 启动加载门：先计数 + 异步预载；叙事触发延后到资产就位（launchNarrative）
    // loadStartedAt 用单调时钟 platform.now()（与音频斜坡同基准），不依赖 gameTimeMs
    // —— tick() 在加载期提前 return，gameTimeMs 不前进，若用它会令超时判定恒假。
    this.loadStartedAt = this.platform.now();
    // 加载计数含图片(母题+场景)与 BGM：资产就位前加载屏不进 Hub，叙事也不触发。
    this.loadTotal = CURRENCIES.length * FORM_FACTORS.length + SCENE_KEYS.length + BGM_KEYS.length;
    this.loadDone = 0;
    this.preloadImages();
    this.preloadScenes();
    this.preloadAudio();

    // 音频运行时：必须早于 DialogueEngine 建好 —— 首开/回访对白在构造末尾就会
    // 触发 toast，而 toast 起播会调用 audio.duckPush() / play()。
    // 时钟用 platform.now()（单调、与音频斜坡同基准），不用 gameTimeMs（会被 dt 夹逼）。
    this.audio = new AudioManager({
      sink: platformAudio(platform),
      settings: this.meta,
      now: () => this.platform.now(),
    });
    this.audio.init();
    // 前后台：切后台暂停 BGM 省电，回前台续播（不重头）。平台未实现该可选能力 → 跳过。
    if (typeof platform.onVisibilityChange === 'function') {
      platform.onVisibilityChange((visible) => this.audio.setAppVisible(visible));
    }

    // §5 衔接点 #1：实例化对白引擎 + 首开/回访判定
    this.dialogue = new DialogueEngine({
      host: {
        enqueueToast: (item) => this.enqueueToast(item),
        dismissCurrentToast: () => this.dismissToast(),
        isToastQueueFull: () => this.toasts.length >= TOAST_QUEUE_MAX,
        gameTimeMs: () => this.gameTimeMs,
      },
      meta: this.meta,
      collection: this.store,
      getCurrency: (iso) => {
        const c = getCurrency(iso);
        if (!c) return undefined;
        return {
          name: c.name, iso: c.iso, region: c.region,
          discoveryLine: c.discoveryLine, grandpaNote: c.grandpaNote,
        };
      },
      regionLabel: (region) => REGION_LABELS[region] ?? region,
    });

  }

  /**
   * 加载完成后进入游戏：触发首开/回访叙事（原构造尾部逻辑，延后到资产就位）。
   * 放在这里而非构造里，让「自动播放对话框」发生在真图已就位之后，
   * 不再于占位图阶段突兀弹出（用户反馈：进场即自动播对话框观感差，loading-gate.md）。
   */
  private launchNarrative(): void {
    if (!this.meta.hasLaunchedBefore()) {
      this.meta.markLaunchedBefore();
      this.dialogue.trigger('S1_HUB_FIRST_OPEN');
      // E2 首进 Hub 揭幕音（P0）。此刻尚无用户手势，Web 端会被自动播放策略拦下，
      // 属预期 —— 首开揭幕本就该在玩家第一次触屏之后才有意义。
      this.audio.play('sfx_hub_first_open');
    } else {
      const today = todayISO();
      const { consecutiveDays, daysSinceLastVisit } = this.meta.updateVisitTracking(today);
      this.dialogue.trigger('S1_HUB_RETURN', { consecutiveDays, daysSinceLastVisit });
      this.checkStreakMilestone(consecutiveDays);
    }
  }

  /** 单张资产就位（成功或失败都计，失败也计以免 404 卡死加载屏） */
  private onAssetSettled(): void {
    this.loadDone++;
    this.dirty = true;
  }

  /** 加载门推进：资产到齐或超时 → 进入游戏并触发叙事 */
  private advanceBoot(): void {
    if (this.bootPhase !== 'loading') return;
    const settled = this.loadDone >= this.loadTotal;
    const timedOut = this.platform.now() - this.loadStartedAt > App.LOADING_TIMEOUT;
    if (settled || timedOut) {
      this.bootPhase = 'ready';
      this.dirty = true;
      this.launchNarrative();
    }
  }

  /**
   * D3 连续天数里程碑（3/7/14/30 天）。
   * backToHub 每次回 Hub 都会 updateVisitTracking + 触发 S1_HUB_RETURN，
   * 同一天会重复拿到同一个 consecutiveDays —— 故用 session 级标志去重，
   * 一次启动内只响一次（与对白引擎 once-per-session 口径一致）。
   */
  private checkStreakMilestone(consecutiveDays: number): void {
    if (this.streakMilestoneFired) return;
    if (STREAK_MILESTONES.indexOf(consecutiveDays) < 0) return;
    this.streakMilestoneFired = true;
    this.audio.play('sfx_streak_milestone');
  }

  /* ---------------- 生命周期 ---------------- */

  start(): void {
    this.loop();
  }

  private loop = (): void => {
    const vp = this.platform.getViewport();
    if (vp.w !== this.lastVp.w || vp.h !== this.lastVp.h) {
      this.lastVp = vp;
      this.dirty = true; // 旋转 / 尺寸变化 → 重算布局
    }
    // 方向不匹配（显示引导页）时须持续重绘引导页；方向正确则交给动画脏标记按需重绘
    if (!this.orientationMatches()) this.dirty = true;
    const now = this.platform.now();
    const rawDt = this.lastTime ? now - this.lastTime : 16;
    this.lastTime = now;
    // §5.2 游戏时钟：min(dt,100) 夹逼吞掉后台大跳帧 → 切后台动画自然冻结、零漂移
    const dt = Math.min(Math.max(0, rawDt), 100);
    this.gameTimeMs += dt;

    this.tick(dt);

    // 翻牌动画推进（沿用 platform.now 基准，与卡面 scaleX 一致）
    if (this.flipAnim) {
      if (now - this.flipAnim.start >= FLIP_MS) this.flipAnim = null;
      this.dirty = true;
    }

    if (this.dirty) {
      this.render();
      this.dirty = false;
    }
    this.platform.requestAnimationFrame(this.loop);
  };

  /** 每帧推进所有游戏时钟驱动的状态（§5.2） */
  private tick(dt: number): void {
    // 启动加载门：未就位时只推进加载屏，不跑对局逻辑、不抢带宽预载 BGM
    // （加载期任意方向都推进，便于纸币模式在横屏下完成首帧资源加载）
    if (this.bootPhase === 'loading') {
      this.advanceBoot();
      this.dirty = true;
      return;
    }
    // 方向门：方向不匹配当前玩法时暂停一切模拟，仅保留渲染循环绘制引导页
    //   - 竖屏游戏（硬币/Hub/图鉴/详情）被横屏 → 冻结，render 弹「请竖屏」
    //   - 纸币（note）被竖屏 → 冻结，drawBoard 内弹「请横屏」
    if (!this.orientationMatches()) return;
    const t = this.gameTimeMs;

    // ① 错配翻回（替代 setTimeout；时钟与状态同源，无竞态）
    if (this.pendingFlipBackAt >= 0 && t >= this.pendingFlipBackAt) {
      if (this.match && this.match.flipped.length === 2) {
        this.match = flipBack(this.match);
        this.audio.play('sfx_card_flipback'); // B2 翻回（reducedAudioFx 下自动静默）
      }
      this.pendingFlipBackAt = -1;
      this.dirty = true;
    }

    // ② 延迟 burst 发射
    for (let i = this.pendingBursts.length - 1; i >= 0; i--) {
      const b = this.pendingBursts[i];
      if (t < b.at) continue;
      this.fireBurst(b.ia, b.ib, b.region, b.unlock);
      this.pendingBursts.splice(i, 1);
    }

    // ③ 延迟 toast 入队
    for (let i = this.pendingToasts.length - 1; i >= 0; i--) {
      const p = this.pendingToasts[i];
      if (t < p.at) continue;
      this.enqueueToast(p.item);
      this.pendingToasts.splice(i, 1);
    }

    // ④ toast 队列推进
    this.updateToasts();

    // ⑤ 清除动画到期（到期后卡仍为 matched → 渲染层画幽灵槽位）
    if (this.clearAnims.size > 0) {
      this.clearAnims.forEach((start, id) => {
        if (t - start >= CLEAR_C_END) this.clearAnims.delete(id);
      });
      this.dirty = true;
    }

    // ⑥ 粒子推进
    updateFx(t, dt);

    // ③b 延迟音效出队（与 ③ 同构，游戏时钟驱动）
    for (let i = this.pendingSfx.length - 1; i >= 0; i--) {
      const s = this.pendingSfx[i];
      if (t < s.at) continue;
      this.audio.play(s.id, { variant: s.variant });
      this.pendingSfx.splice(i, 1);
    }

    // ⑦ 对白引擎 tick（§5 衔接点 #2）
    this.dialogue.tick();

    // ⑦b 音频推进：BGM 场景同步 + 增益斜坡 + 声部回收。
    // playBgm 同场景时是 O(1) no-op，故每帧无脑调用即可 —— 不会遗漏任何一次
    // view 变更（无论它从哪个方法里改的），也不会重复起播。
    // 不加 as 断言：View 与 MusicScene 当前完全同构，日后 View 新增成员会在此
    // 编译报错，逼迫同步 MUSIC_SCENES，而不是静默漏配一个场景的音乐。
    const scene: MusicScene = this.view;
    this.audio.playBgm(scene);
    this.audio.tick();

    // ⑧ 静默期切换（§5 衔接点 #5）：翻牌/清除/burst/翻回动画期设 true
    const animBusy = !!this.flipAnim
      || this.pendingBursts.length > 0
      || this.clearAnims.size > 0
      || hasActiveFx()
      || this.pendingFlipBackAt >= 0;
    this.dialogue.setSilenced(animBusy);

    // ⑧b 「环游世界」伪视频推进（world-tour-reward §3.3 坑 2 —— 已回确认：
    //     本项目确为**脏标记按需渲染**，故影片激活期间必须每 tick 强制置 dirty，
    //     否则推镜/交叉淡化/字幕淡入全部只画第一帧然后卡住。
    //     做法与下方 won 星序保活窗口同构，只是这里没有"窗口"，是整段常开）。
    if (this.view === 'world_tour') {
      const phase = tourPhaseAt(this.tourElapsedMs(), this.tourReplay);
      // 进入 outro 阶段时一次性触发 1.5s 音乐淡出（影片尾，收在终止式上）
      if (phase.kind === 'outro' && !this.tourFadeStarted) {
        this.tourFadeStarted = true;
        this.audio.fadeMusicOut();
      }
      if (phase.kind === 'done') {
        // 播完 → 与「跳过」走同一出口（标记已看 + 清旗标 + 回 Hub）
        this.closeWorldTour();
      } else {
        // 帧序：与渲染层共用 tourPhaseAt 这一份求值，杜绝两处各算一遍算不一样。
        // 记录它只为「按需预载下一帧」，渲染不读这个字段。
        if (phase.kind === 'frames' && phase.index !== this.tourFrame) {
          this.tourFrame = phase.index;
          // 滚动预载：只多探一帧，弱网时不会一次性并发 8 个请求把首帧挤掉
          this.preloadTourFrames(phase.index + 2);
        }
        // 暂停时也保持 dirty：暂停指示要跟着 view 一起在，掉帧不重绘会留下半张脏图
        this.dirty = true;
      }
    }

    // ⑨ 脏标记：存在活动动画时持续重绘，全部结束即停（维持按需重绘）
    if (
      hasActiveFx() ||
      this.pendingBursts.length > 0 ||
      this.pendingToasts.length > 0 ||
      this.toasts.length > 0 ||
      this.pendingFlipBackAt >= 0 ||
      this.dialogue.hasPending() ||
      // 保活窗口必须含 STAR_SEQ_DELAY，否则星序整体后移后最后一颗星不重绘
      (this.won && t - this.wonAt < STAR_SEQ_DELAY + STAR_POP_INTERVAL * 3 + STAR_POP_MS)
    ) {
      this.dirty = true;
    }
  }

  /** 当前是否处于「需要横屏」的玩法上下文：纸币（note）形态对局中。 */
  private wantLandscape(): boolean {
    return this.view === 'pair' && this.form === 'note';
  }

  /** 当前设备方向是否符合当前玩法要求（方向门：true=可玩，false=显示引导页并冻结）。 */
  private orientationMatches(): boolean {
    const orient = this.platform.getOrientation();
    return this.wantLandscape() ? orient === 'landscape' : orient === 'portrait';
  }

  private render(): void {
    this.platform.resetTransform();
    this.hitTargets = [];
    // 加载门：任意方向都先推进加载屏（让纸币模式能在横屏下完成首帧资源加载）
    if (this.bootPhase === 'loading') {
      drawLoadingScreen(this.ctx, this.platform.getViewport(), this.loadingProgress);
      return;
    }
    const orient = this.platform.getOrientation();
    // 竖屏游戏（硬币/Hub/图鉴/详情）被横屏 → 铺满全屏弹「请竖屏」引导页
    if (orient === 'landscape' && !this.wantLandscape()) {
      const d = this.platform.getDeviceSize();
      drawRotateOverlay(this.ctx, d.w, d.h);
      return;
    }
    // 其余情况渲染游戏：
    //   - 纸币（note）横屏 → 正常对局
    //   - 纸币（note）竖屏 → drawBoard 内自带「请横屏」遮罩（冻结对局）
    //   - 硬币/Hub 等竖屏 → 正常
    drawApp(this, this.ctx, this.platform.getViewport(), this.platform.safeAreaInset, this.hitTargets);
  }

  /* ---------------- 章节 / 难度档（关卡文档 §2） ---------------- */

  /**
   * 解锁判定所需的进度快照。
   * 唯一真源 = metaStore 的**章节 × 难度档**维度；chapters.ts 只消费，不自己存。
   */
  chapterProgress(): ChapterProgress {
    return {
      plays: (c: ChapterId, g: Grade) => this.meta.playsChapter(c, g),
      bestStar: (c: ChapterId, g: Grade) => this.meta.bestStarChapter(c, g),
    };
  }

  /** 章节是否解锁（itinerary 顺序 + no-fail 保底通道） */
  isChapterOpen(id: ChapterId): boolean {
    return chapterOpen(id, this.chapterProgress());
  }

  /** 章内难度档是否解锁（章未开 → 档一律不开，避免绕过 itinerary） */
  isGradeOpen(id: ChapterId, grade: Grade): boolean {
    return this.isChapterOpen(id) && gradeOpen(id, grade, this.chapterProgress());
  }

  /** 组牌上下文：随机源 + 解锁权重 + mastery 权重，全部注入 → chapters 保持纯函数 */
  private planContext(form: FormFactor): PlanContext {
    return {
      rng: Math.random,
      isUnlocked: (iso: string) => this.store.isUnlocked(iso, form),
      pips: (iso: string) => this.meta.pips(iso),
    };
  }

  /** 轻提示（复用 §1.3 toast 通道，hold 1200ms，不锁输入、不跳转） */
  private hint(line1: string): void {
    // A4 未解锁提示音。合规红线：是「门还锁着」的中性木质闷响，
    // 不用刺耳错误音，避免把「暂不可用」渲染成惩罚。
    this.audio.play('sfx_ui_locked');
    this.claimTapSfx();
    this.enqueueToast({ line1, line2: '', region: 'amer', hold: 1200, startAt: -1 });
    this.dirty = true;
  }

  /** 点击未解锁章节书架 */
  hintChapterLocked(id: ChapterId): void {
    const prevOf: Partial<Record<ChapterId, ChapterId>> = { euro: 'amer', asia_afr: 'euro' };
    const prev = prevOf[id];
    this.hint(
      prev ? `先完成「${chapterById(prev).name}」初识一局吧` : '先在两个大洲各走完一次「环游」吧'
    );
  }

  /** 点击未解锁难度档 */
  hintGradeLocked(id: ChapterId, grade: Grade): void {
    this.hint(`先完成「${chapterById(id).name}」${grade >= 3 ? '环游' : '初识'}一局吧`);
  }

  /* ---------------- 视图切换 ---------------- */

  /**
   * 开一局：关卡 = (chapter, grade, form)。
   * 组牌 / 网格 / 模式全部由 chapters.chapterPlan 决定（内容绑定，单区 6 币也不空格）。
   */
  startChapter(id: ChapterId, grade: Grade, form: FormFactor): void {
    if (!this.isChapterOpen(id)) {
      this.hintChapterLocked(id);
      return;
    }
    if (!this.isGradeOpen(id, grade)) {
      this.hintGradeLocked(id, grade);
      return;
    }

    const res = chapterPlan(id, grade, form, this.planContext(form));
    this.form = form;
    this.chapter = id;
    this.grade = grade;
    this.grid = res.grid;
    /* TODO Phase2: world T3 associate mode via chapters.associationPlan()
     * 关联判定（货币 ↔ 母题）需 matchLogic.evaluate 支持注入 matchKeyOf；本阶段
     * 强制退回标准 match，保证环球 T3 可玩不崩。数据侧 associationPlan() 钩子保留不删。 */
    this.mode = id === 'world' && grade === 3 ? 'match' : res.mode;

    const cards = buildDeckPlan(res.plan, CURRENCIES, form);
    this.match = createMatchState(cards);
    this.won = false;
    this.earnedStars = 1;
    this.wonAt = 0;
    this.sessionUnlocked = [];
    this.resetTransient();
    this.dialogue.resetMatchSession(); // §5 衔接点 #3
    this.view = 'pair';
    this.dirty = true;

    // 首进本章 → 开场白 + 周爷爷纸条（markChapterSeen 幂等，只播一次）
    if (this.meta.markChapterSeen(id)) this.playChapterIntro(id);
  }

  /**
   * 章节开场叙事：册册开场白 + 该章首个币的周爷爷纸条。
   * 复用现实锚 toast 通道（非阻塞、FIFO 可叠加），**不新建弹窗、不锁输入**。
   */
  private playChapterIntro(id: ChapterId): void {
    const ch = chapterById(id);
    // world 无专属区域色 → 借美洲暖金描边，保持横幅描边语言统一
    const region: Region = id === 'world' ? 'amer' : id;
    // 完整文本入队（不 clipLine）：drawToast 的 wrapText 负责换行、横幅高度自适应
    this.enqueueToast({
      line1: `${ch.name} · ${ch.subtitle}`,
      line2: '',
      lines: [ch.narrativeBeat],
      region,
      hold: TOAST_HOLD_MS,
      startAt: -1,
    });
    const firstIso = poolIsos(ch)[0];
    const cur = firstIso ? getCurrency(firstIso) : undefined;
    if (cur && cur.grandpaNote) {
      this.enqueueToast({
        line1: '周爷爷的纸条',
        line2: '',
        lines: [cur.grandpaNote],
        region: cur.region,
        hold: TOAST_HOLD_MS,
        startAt: -1,
      });
    }
  }

  /** 清空一切局内瞬态动画状态（换局 / 回 Hub），避免跨局残留 */
  private resetTransient(): void {
    this.clearAnims.clear();
    this.pendingBursts.length = 0;
    this.pendingToasts.length = 0;
    this.toasts.length = 0;
    this.pendingFlipBackAt = -1;
    resetFx();
    // 音频瞬态：toasts 被整体清空 → 已 push 的 duck 失去配对的 pop，必须硬归零，
    // 否则 BGM 会永久停在压低档。延迟音效同理，跨局不再有意义。
    this.pendingSfx.length = 0;
    this.toastBatchSeq = 0;
    this.audio.resetDuck();
  }

  restart(): void {
    this.startChapter(this.chapter, this.grade, this.form); // 记住当前关卡（§4.5）
  }

  backToHub(): void {
    // A2 返回音。任务书的「sfx_hub_return」与「返回上一层」是同一个插桩点，
    // 故复用 A2 而不新造第 45 个资产（见 audioEvents.ts 头部映射表）。
    this.audio.play('sfx_ui_back');
    this.claimTapSfx();

    this.view = 'hub';
    this.match = null;
    this.won = false;
    this.resetTransient();
    this.dirty = true;

    // §5 衔接点 #7：回访对白（once-per-session 幂等，引擎内部去重）
    if (this.meta.hasLaunchedBefore()) {
      const today = todayISO();
      const { consecutiveDays, daysSinceLastVisit } = this.meta.updateVisitTracking(today);
      this.dialogue.trigger('S1_HUB_RETURN', { consecutiveDays, daysSinceLastVisit });
      this.checkStreakMilestone(consecutiveDays);
    }
  }

  /* ---------------- 「环游世界」全收集结算（world-tour-reward §3.2 第 5 项） ---------------- */

  /**
   * 进入伪视频。
   * @param replay 重看入口（Hub §3.4）：跳过开场 2s 主文案，其余不变。
   *
   * 起播前把 8 帧全丢进预载队列（§3.3 坑 3 要求「至少前 2 帧」，这里给足）。
   * **不等待任何一张图** —— 未就绪的帧走区域签名色兜底渐变，字幕照常，时间轴不停。
   */
  openWorldTour(replay = false): void {
    // 电影化结算刻意不播进入音（避免像翻开图鉴）；独立进入音待 audioEvents TODO 接入。
    this.claimTapSfx();

    this.view = 'world_tour';
    this.tourReplay = replay;
    this.tourStartedAt = this.gameTimeMs;
    this.tourFrame = 0;
    this.tourPaused = false;
    this.tourPausedAt = 0;
    this.tourPauseAccum = 0;
    this.tourFadeStarted = false;
    this.preloadTourFrames(TOUR_FRAME_COUNT);
    this.dirty = true;
  }

  /**
   * 退出伪视频（播完 / 跳过 / 主动关闭 **走同一个出口**）。
   * 落「已看过」并清旗标 → 回 Hub（§2.3：结束是回 Hub，**不是**回对局）。
   *
   * 复用 backToHub() 而不是直接 `this.view='hub'`：那里还挂着回访对白、连续天数
   * 里程碑与 resetTransient（清 duck / 清延迟音效队列）。绕过它会留下脏状态。
   */
  closeWorldTour(): void {
    this.meta.markWorldTourSeen();
    this.pendingWorldTour = false;
    this.tourPaused = false;
    this.backToHub();
  }

  /** 单击画面任意处 = 暂停/继续（§2.4）。暂停期间时间轴真的停住，不是只停动画。 */
  toggleTourPause(): void {
    if (this.view !== 'world_tour') return;
    if (this.tourPaused) {
      this.tourPauseAccum += this.gameTimeMs - this.tourPausedAt;
      this.tourPaused = false;
      this.audio.setBgmPaused(false);
    } else {
      this.tourPausedAt = this.gameTimeMs;
      this.tourPaused = true;
      this.audio.setBgmPaused(true);
    }
    // 暂停/继续是"控制"不是"确认"，走通用点按音即可 —— 这里不认领，让 handleTap 补 A1。
    this.dirty = true;
  }

  /** 已播毫秒（已扣除暂停累计）。渲染层与 tick 的唯一时间口径。 */
  tourElapsedMs(): number {
    const ref = this.tourPaused ? this.tourPausedAt : this.gameTimeMs;
    return Math.max(0, ref - this.tourStartedAt - this.tourPauseAccum);
  }

  openCodex(): void {
    // §音频收尾：删除进入图鉴的翻页提示音（A5）。通用点按音由 handleTap 兜底补播，
    // 故同时取消 claimTapSfx，避免静音 —— 保留「其他必要 SFX」（点按 A1）。
    this.view = 'codex';
    this.codexScroll = 0;
    this.dirty = true;
  }

  openDetail(iso: string): void {
    if (!this.store.isCollected(iso)) return; // 未解锁不可进 S5
    this.audio.play('sfx_view_detail_open'); // A6
    this.claimTapSfx();
    this.detailIso = iso;
    this.view = 'detail';
    this.codexScroll = 0;
    this.dirty = true;

    // §5 衔接点 #6：翻开图鉴 → CODEX_OPEN（once-lifetime per iso）
    this.dialogue.trigger('CODEX_OPEN', { iso });
  }

  /* ---------------- 配对交互 ---------------- */

  flipCard(cardId: string): void {
    if (!this.match || this.won) return;
    const next = flip(this.match, cardId);
    if (next === this.match) return; // 输入锁 / 已翻 → 忽略
    this.match = next;
    this.startFlip([cardId]);
    this.audio.play('sfx_card_flip'); // B1（2 实例轮转，连翻不掐断）
    this.claimTapSfx();

    if (this.match.flipped.length === 2) {
      const a = this.match.flipped[0];
      const b = this.match.flipped[1];
      const matchedIso = a.iso;
      // §1.1：必须在 unlock() 之前读取 isCollected，用于选 primary/secondary 文案
      const wasCollected = this.store.isCollected(matchedIso);

      const { state, result } = evaluate(this.match);
      this.match = state;

      if (result.matched) {
        // ② mastery 累计（§2.4，每次配对 +1，不限首次）
        this.meta.addMastery(matchedIso);

        // 幂等解锁（红线）：firstTime 直接驱动功能①③，不新增判重
        const firstTime = this.store.unlock(matchedIso, this.form);
        if (firstTime) this.sessionUnlocked.push(entityKey(matchedIso, this.form));

        // 「环游世界」全收集检查（world-tour-reward §3.1/§3.2 第 3 项）：
        // 触发条件 = 18 币种 × 2 形态 = 36 个实体（**不是 19，也不是 38**）。
        // 这里**只置旗标、不改 view**，影片延迟到局末由胜利面板的「继续」消费。
        // 顺手预载前 2 帧：等玩家点完「继续」通常已经到手，避免开场就露兜底渐变。
        if (firstTime && this.store.isAllComplete() && !this.meta.hasSeenWorldTour()) {
          this.pendingWorldTour = true;
          this.preloadTourFrames(2);
        }

        // ③ 清除动画 + burst（t=0 为判定帧）
        const t0 = this.gameTimeMs;
        this.clearAnims.set(a.id, t0);
        this.clearAnims.set(b.id, t0);
        const ia = this.match.cards.findIndex((c) => c.id === a.id);
        const ib = this.match.cards.findIndex((c) => c.id === b.id);
        this.pendingBursts.push({ at: t0 + BURST_AT, ia, ib, region: a.region, unlock: firstTime });

        // ① 对白引擎触发（§5 衔接点 #4）：替换原有 flashPrimary/flashSecondary
        if (firstTime && !wasCollected) {
          // 新发现：改播 discoveryLine（3 行逐行，~10s），延迟等 burst 起播
          this.dialogue.trigger('MATCH_SUCCESS_NEW', {
            iso: matchedIso,
            wasCollected: false,
            delay: BURST_AT + UNLOCK_TOAST_DELAY, // 570ms
          });
          // C1 新发现（P1）立即响；C2 图鉴新增（收录感）跟随解锁 toast 落位，
          // 错开两层不叠在同一瞬间，避免「一坨响」糊成噪音。
          this.audio.play('sfx_match_success_new');
          this.pendingSfx.push({
            at: t0 + BURST_AT + UNLOCK_TOAST_DELAY,
            id: 'sfx_unlock_codex',
          });
        } else if (wasCollected) {
          // 已见过：repeat（rotate + cooldown）
          this.dialogue.trigger('MATCH_SUCCESS_REPEAT', {
            iso: matchedIso,
            wasCollected: true,
          });
          this.audio.play('sfx_match_success_repeat'); // B4（轻，2 实例轮转）
        }

        // 首次配对教学（once-lifetime，引擎内部去重 + matchSession 防重）
        if (!this.meta.hasSeenFirstTutorial()) {
          this.dialogue.trigger('MATCH_FIRST_TUTORIAL');
        }

        // 区域集满检查（§5 衔接点 #11）
        if (firstTime) this.checkRegionComplete(matchedIso);

        if (result.complete) {
          this.finishWin();
          // 一局完成对白（延迟 500ms 等胜利面板弹出）
          this.dialogue.trigger('MATCH_WIN_SESSION', { delay: 500 });
        }
      } else {
        // 错配：保持 lock，MISMATCH_FLIPBACK_MS 后翻回（游戏时钟，§5.2）
        this.dialogue.trigger('MATCH_MISS');
        // B3 错配。合规红线：这里是「温和的否定」而非惩罚音，
        // 更不得带任何亏损/下跌语义（audio-direction.md 合规章）。
        this.audio.play('sfx_match_miss');
        this.pendingFlipBackAt = this.gameTimeMs + MISMATCH_FLIPBACK_MS;
      }
    }
    this.dirty = true;
  }

  /** 局末结算：星评落盘 + 局数 +1（§2.3 / §4.4） */
  private finishWin(): void {
    if (!this.match) return;
    this.won = true;
    this.wonAt = this.gameTimeMs;
    const pairs = this.match.cards.length / 2;
    // 传入当前难度档：T3 走收紧后的 3⭐ 阈值（K3=0.35），T1/T2 不变
    this.earnedStars = starsFor(this.match.mismatches, pairs, this.grade);

    // 解锁链快照：必须在写盘**之前**取，用于判定「这一局解锁了什么」
    const gradesBefore = this.openGradeCount();
    const chapterDoneBefore = this.isChapterCleared(this.chapter);

    // 落盘维度 = (chapter, grade)：只升不降 + 局数累计，喂 chapters 的解锁链
    this.meta.setBestStarChapter(this.chapter, this.grade, this.earnedStars);
    this.meta.addPlayChapter(this.chapter, this.grade);
    if (this.match.score > this.best) {
      this.best = this.match.score;
      this.store.saveBest(this.best);
    }

    // C3 通关音（P1）：延后 WIN_SFX_DELAY 入队，而非立即 play。
    // 原本与 match_success_new 同帧起播（同音色 + 同包络 + 电平更低）→ 人耳听成一个音；
    // 错峰后它独占 t=420~700 的空窗（§4.1）。
    this.pendingSfx.push({
      at: this.wonAt + WIN_SFX_DELAY,
      id: 'sfx_win_session',
    });

    // C4 星级评定：与渲染层星星弹出节奏严格同步（STAR_SEQ_DELAY + STAR_POP_INTERVAL），
    // 第 i 颗星用第 i 个语义变体（音高递升），逐颗落点 = 逐颗音。
    // ⚠ 改这里必须同步改 renderer.ts 的 appearAt，否则「星亮了没声 / 有声星没了」。
    for (let i = 0; i < this.earnedStars; i++) {
      this.pendingSfx.push({
        at: this.wonAt + STAR_SEQ_DELAY + STAR_POP_INTERVAL * i,
        id: 'sfx_star_pip',
        variant: i, // 语义变体：_01/_02/_03
      });
    }

    // D1 章节完成（P0，自带 duck）：本局把整章打通才响。
    // 落点 = 最后一颗星弹完之后（含 STAR_SEQ_DELAY 的整体后移），即 t≈1710ms
    if (!chapterDoneBefore && this.isChapterCleared(this.chapter)) {
      this.pendingSfx.push({
        at: this.wonAt + STAR_SEQ_DELAY + STAR_POP_INTERVAL * 3 + STAR_POP_MS,
        id: 'sfx_chapter_complete',
      });
    } else if (this.openGradeCount() > gradesBefore) {
      // D4 新档位解锁（P1）：让位于章节完成，二者不同时响
      this.pendingSfx.push({
        at: this.wonAt + STAR_SEQ_DELAY + STAR_POP_INTERVAL * 3 + STAR_POP_MS,
        id: 'sfx_grade_unlock',
      });
    }
  }

  /** 全局已解锁 (章, 档) 计数 —— 解锁链的单一数值指纹，变大即代表「解锁了新东西」 */
  private openGradeCount(): number {
    let n = 0;
    for (const ch of CHAPTERS) {
      for (const g of [1, 2, 3] as Grade[]) {
        if (this.isGradeOpen(ch.id, g)) n++;
      }
    }
    return n;
  }

  /** 某章是否已通关：三档均至少拿到 1 星 */
  private isChapterCleared(id: ChapterId): boolean {
    return ([1, 2, 3] as Grade[]).every((g) => this.meta.bestStarChapter(id, g) >= 1);
  }

  /**
   * 检查某 ISO 所在区域是否首次集满 → 触发 REGION_COMPLETE（§5 衔接点 #11）。
   * 在 flipCard() 的 firstTime 分支中、store.unlock() 之后调用。
   */
  private checkRegionComplete(iso: string): void {
    const cur = getCurrency(iso);
    if (!cur) return;
    const region = cur.region;
    // 检查该区域所有币种是否都已收集（任意形态）
    const allCollected = CURRENCIES
      .filter((c) => c.region === region)
      .every((c) => this.store.isCollected(c.iso));
    if (allCollected) {
      this.dialogue.trigger('REGION_COMPLETE', {
        region,
        delay: 800, // 等新发现 toast 播完
      });
      // D2 区域集满（P1）：语义变体 —— 按大洲选对应音色（_amer/_euro/_asia_afr），
      // 与对白同步落位，不抢在新发现音前面。
      this.pendingSfx.push({
        at: this.gameTimeMs + 800,
        id: 'sfx_region_complete',
        variant: region,
      });
    }
  }

  /** 到点发射 burst：现算 layout 以正确处理旋转/尺寸变化 */
  private fireBurst(ia: number, ib: number, region: Region, unlock: boolean): void {
    if (!this.match) return;
    const vp = this.platform.getViewport();
    const g = effectiveGrid(this.grid, this.form, this.platform.getOrientation()); // 横屏纸币互换为宽排，与 renderer.drawBoard 同源
    const layout = boardLayout(vp, this.platform.safeAreaInset, this.form, g.cols, g.rows);
    const ra = layout.cards[ia];
    const rb = layout.cards[ib];
    if (!ra || !rb) return;
    const x = (ra.x + ra.w / 2 + rb.x + rb.w / 2) / 2;
    const y = (ra.y + ra.h / 2 + rb.y + rb.h / 2) / 2;
    spawnBurst(this.gameTimeMs, x, y, ra.w, region, unlock, this.colorblind);
    this.dirty = true;
  }

  private startFlip(ids: string[]): void {
    this.flipAnim = { ids: new Set(ids), start: this.platform.now() };
    this.dirty = true;
  }

  /** 供渲染层查询某卡当前翻牌动画状态（无动画返回 null） */
  cardFlip(card: Card): { scaleX: number; faceUp: boolean } | null {
    if (!this.flipAnim || !this.flipAnim.ids.has(card.id)) return null;
    const t = Math.min(1, (this.platform.now() - this.flipAnim.start) / FLIP_MS);
    return { scaleX: Math.abs(Math.cos(t * Math.PI)), faceUp: t >= 0.5 };
  }

  /** 供渲染层查询某卡清除动画（无动画返回 null → matched 卡应画幽灵槽位） */
  clearAnimOf(card: Card): ClearAnim | null {
    const start = this.clearAnims.get(card.id);
    if (start === undefined) return null;
    return clearAnimAt(this.gameTimeMs - start);
  }

  /* ---------------- toast 队列（§1.4） ---------------- */

  private enqueueToast(item: ToastItem): void {
    if (this.toasts.length >= TOAST_QUEUE_MAX) {
      // 队列满 → 丢弃最旧的「未播」项（索引 1；索引 0 正在播放）
      this.toasts.splice(this.toasts.length > 1 ? 1 : 0, 1);
    }
    this.toasts.push(item);
    this.dirty = true;
  }

  /**
   * toast 队列推进 + 音频衔接（audio-implementation.md §5）。
   *
   * ducking 的**唯一** push/pop 点就在这里，保证引用计数由构造即配对：
   *   起播（startAt 由 -1 变正）→ duckPush()；出队（shift）→ duckPop()。
   * 不放在 enqueueToast/dismissToast 里，是因为「入队 ≠ 显示」——
   * 队列里排着的 toast 若在显示前被 resetTransient 清掉，push 就会失去配对的 pop，
   * 造成 BGM 永久压低（引用计数泄漏）。
   */
  private updateToasts(): void {
    if (this.toasts.length === 0) return;
    const head = this.toasts[0];
    if (head.startAt < 0) {
      head.startAt = this.gameTimeMs;
      // 队列非空（后面还排着）→ hold 缩短，避免堆积
      if (this.toasts.length > 1 && head.hold === TOAST_HOLD_MS) head.hold = TOAST_HOLD_SHORT_MS;

      // E1 抑制规则②：仅「批头」发弹出音；同批后续静默（见 toastBatchSeq 注释）
      if (this.toastBatchSeq === 0) this.audio.play('sfx_dialogue_pop');
      this.toastBatchSeq++;
      this.audio.duckPush(); // ← 与下方 shift 处的 duckPop 严格配对

      this.dirty = true;
    }
    if (this.gameTimeMs - head.startAt >= toastTotal(head.hold)) {
      this.toasts.shift();
      this.audio.duckPop();
      if (this.toasts.length === 0) this.toastBatchSeq = 0; // 队列排空 = 本批结束
      this.dirty = true;
    }
  }

  /**
   * 点按 toast → 立即跳到 exit 段（§1.3）。
   *
   * 实现要点：通过**缩短 hold** 让 exit 段立刻开始，而不是把 startAt 往前回拨。
   * 回拨 startAt 会在游戏时钟较小时算出负值，与 `startAt < 0`（「尚未起播」哨兵）
   * 语义相撞 → updateToasts 会把它当成新 toast 重新起播，表现为「点一下反而重播」。
   * （回归用例见 phase1-integration.mjs 段 C）
   */
  dismissToast(): void {
    const head = this.toasts[0];
    if (!head || head.startAt < 0) return;
    const elapsed = this.gameTimeMs - head.startAt;
    const nextHold = Math.max(0, elapsed - TOAST_ENTER_MS);
    if (nextHold < head.hold) head.hold = nextHold;
    this.dirty = true;
  }

  /* ---------------- 设置（§5.3） ---------------- */

  get colorblind(): boolean {
    return this.meta.colorblind;
  }

  /** 加载进度 0..1（供加载屏绘制；加载门就绪后恒为 1） */
  get loadingProgress(): number {
    return this.loadTotal > 0 ? Math.min(1, this.loadDone / this.loadTotal) : 1;
  }

  toggleColorblind(): void {
    this.meta.setColorblind(!this.meta.colorblind);
    this.audio.play('sfx_ui_toggle'); // A3
    this.claimTapSfx();
    this.dirty = true;
  }

  /* ---------------- 音频设置（转发给 AudioManager，存档由 metaStore 统一持有） ---------------- */

  /** 声音设置面板是否展开（纯 UI 瞬态，不持久化） */
  settingsOpen = false;

  toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    this.audio.play(this.settingsOpen ? 'sfx_ui_tap' : 'sfx_ui_back');
    this.claimTapSfx();
    this.dirty = true;
  }

  closeSettings(): void {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    this.audio.play('sfx_ui_back');
    this.claimTapSfx();
    this.dirty = true;
  }

  get muted(): boolean {
    return this.meta.muted;
  }

  toggleMuted(): void {
    // 先播再切：从「有声」切到「静音」时，这一下反馈音还听得见；
    // 反向（解除静音）则由 AudioManager 恢复 BGM 时给出听觉确认。
    this.audio.play('sfx_ui_toggle');
    this.claimTapSfx();
    this.audio.setMuted(!this.meta.muted);
    this.dirty = true;
  }

  /** 0..100（UI 口径）；AudioManager 内部换算到 0..1 */
  get musicVolume(): number {
    return this.meta.musicVolume;
  }

  setMusicVolume(v: number): void {
    this.audio.setMusicVolume(v / 100);
    this.claimTapSfx();
    this.dirty = true;
  }

  get sfxVolume(): number {
    return this.meta.sfxVolume;
  }

  setSfxVolume(v: number): void {
    this.audio.setSfxVolume(v / 100);
    this.audio.play('sfx_ui_tap'); // 即时试听：让玩家听见刚调到的音量
    this.claimTapSfx();
    this.dirty = true;
  }

  get reducedAudioFx(): boolean {
    return this.meta.reducedAudioFx;
  }

  toggleReducedAudioFx(): void {
    this.audio.setReducedAudioFx(!this.meta.reducedAudioFx);
    this.audio.play('sfx_ui_toggle');
    this.claimTapSfx();
    this.dirty = true;
  }

  /* ---------------- 输入回调（由 input.ts 命中后调用） ---------------- */

  /** 动作已发出专属音效 → 本次点按不再补通用 A1 点按音 */
  private claimTapSfx(): void {
    this.tapSfxClaimed = true;
  }

  handleTap(x: number, y: number): void {
    if (this.bootPhase === 'loading') return; // 加载期不响应输入
    // 方向门：方向不匹配当前玩法 → 不响应输入（与 tick 同构，防止引导页期间误触）
    if (!this.orientationMatches()) return;
    // 逆序：后绘制的（上层）优先命中
    for (let i = this.hitTargets.length - 1; i >= 0; i--) {
      const t = this.hitTargets[i];
      const r = t.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        this.tapSfxClaimed = false;
        t.action();
        // A1 通用点按音兜底：只有当动作没认领专属音时才补，
        // 避免「翻牌 / 返回 / 开图鉴」出现两层音叠播。
        if (!this.tapSfxClaimed) this.audio.play('sfx_ui_tap');
        return;
      }
    }
  }

  /** 图鉴滚动阻尼刻度音（A7，reducedAudioFx 下静默；由 input.ts 按位移调用） */
  notifyScrollTick(): void {
    this.audio.play('sfx_ui_scroll_tick');
  }

  /** 首次用户手势 → 解除 Web 自动播放限制（由 input.ts 在 pointerdown 调用） */
  notifyUserGesture(): void {
    this.audio.notifyUserGesture();
  }

  /* ---------------- 资源 ---------------- */

  private preloadImages(): void {
    for (const c of CURRENCIES) {
      for (const f of FORM_FACTORS) {
        const key = c.iso + '_' + f;
        if (this.images.has(key)) continue;
        const src = IMAGES_BASE + `cur_${c.iso}_${c.denom}_${c.region}_${f}.png`;
        this.platform
          .loadImage(src)
          .then((img) => {
            this.images.set(key, img);
            this.onAssetSettled();
          })
          .catch(() => {
            /* 资源缺失 → 几何占位；仍计为就位，避免卡死加载屏 */
            this.onAssetSettled();
          });
      }
    }
  }

  /** 场景底图 / 装饰件预加载（scene-backgrounds-spec §4.1）；缺失 → drawBackdrop 兜底，忽略错误 */
  private preloadScenes(): void {
    const keys = SCENE_KEYS;
    const files: Record<string, string> = {
      scene_hub: SCENES_BASE + 'bg_hub.png',
      scene_board: SCENES_BASE + 'bg_board.png',
      scene_board_land: SCENES_BASE + 'bg_board_land.png',
      scene_codex: SCENES_BASE + 'bg_codex.png',
      scene_detail: SCENES_BASE + 'bg_detail.png',
      deco_globe: SCENES_BASE + 'deco_globe.png',
    };
    for (const key of keys) {
      if (this.images.has(key)) continue;
        this.platform
          .loadImage(files[key])
          .then((img) => {
            this.images.set(key, img);
            this.onAssetSettled();
          })
          .catch(() => {
            /* 资源缺失 → L0 渐变兜底；仍计为就位，避免卡死加载屏 */
            this.onAssetSettled();
          });
    }
  }

  /**
   * BGM 预加载：在加载屏期间并行 fetch 4 个场景音乐，预热进浏览器 HTTP 缓存。
   * 这样 Hub 出现时 playBgm() 复用缓存、音乐即时起播，不再"进游戏才现下"。
   * 成功/失败都计为就位（onAssetSettled），单文件异常不卡死加载屏。
   */
  private preloadAudio(): void {
    for (const key of BGM_KEYS) {
      const url = AUDIO_ROOT + `bgm/bgm_${key}.mp3`;
      fetch(url)
        .then(() => this.onAssetSettled())
        .catch(() => this.onAssetSettled());
    }
  }

  /** 按视图取场景底图（scene-backgrounds-spec §4.2；与 imageFor 同构） */
  sceneFor(view: string): ImageLike | undefined {
    // 纸币（note）对局 + 横屏：优先用横屏专用背景 bg_board_land（缺失则回退竖屏版，零回归）
    if (view === 'pair' && this.form === 'note' && this.platform.getOrientation() === 'landscape') {
      const land = this.images.get('scene_board_land');
      if (land) return land;
    }
    const map: Record<string, string> = {
      hub: 'scene_hub',
      pair: 'scene_board',
      codex: 'scene_codex',
      detail: 'scene_detail',
    };
    const key = map[view];
    return key ? this.images.get(key) : undefined;
  }

  /** deco_globe 装饰件（缺失 → 调用方跳过） */
  getDeco(): ImageLike | undefined {
    return this.images.get('deco_globe');
  }

  /* ---------------- 「环游世界」帧图（world-tour-assets §C.4 / §3.3 坑 3） ----------------
   * 与 preloadScenes 的区别只有两点，别的完全同构：
   *   1) 这批图**上线走 CDN**（wx 主包 4MB 放不下 8 张 1080×1920），所以要记
   *      tourTried 去重 —— tick 每帧都会调 preloadTourFrames，不去重会把失败的
   *      请求每帧重发一次，弱网下直接把带宽打满。
   *   2) 失败**不重试、不阻塞、不转圈**：拿不到就画区域兜底渐变（§3.3 坑 3），
   *      时间轴照走。故 catch 里只标 tried，不改 dirty、不弹任何提示。
   */

  /** 已发起过请求的帧 index（成功/失败都记，防 tick 级重发） */
  private tourTried: Set<number> = new Set();

  /**
   * 预载前 n 帧（n 会被夹到帧数上限）。可重复调用，已请求过的自动跳过。
   * 调用点：全收集命中时预热 2 帧 / 进入影片时全量 / tick 里滚动多探 1 帧。
   */
  preloadTourFrames(n: number): void {
    const upto = Math.min(TOUR_FRAME_COUNT, Math.max(0, n));
    for (let i = 0; i < upto; i++) {
      if (this.tourTried.has(i)) continue;
      this.tourTried.add(i);
      const key = tourFrameKey(i);
      if (!key || this.images.has(key)) continue;
      this.platform
        .loadImage(tourFrameSrc(i))
        .then((img) => {
          this.images.set(key, img);
          // 迟到的图也要能立刻顶掉兜底渐变：影片期间 tick 本就常开 dirty，
          // 这里补一次是为了「预热阶段（还在 Hub/结算）就位」时不留脏图。
          this.dirty = true;
        })
        .catch(() => {
          /* §3.3 坑 3：静默失败 → drawFrameLayer 走区域兜底渐变，绝不转圈 */
        });
    }
  }

  /** 取第 i 帧图；未就位 → undefined，渲染层走 §A.3.1 兜底渐变 */
  getTourFrame(i: number): ImageLike | undefined {
    const key = tourFrameKey(i);
    return key ? this.images.get(key) : undefined;
  }

  imageFor(iso: string, form: FormFactor): ImageLike | undefined {
    return this.images.get(iso + '_' + form);
  }

  currency(iso: string) {
    return getCurrency(iso);
  }
}
