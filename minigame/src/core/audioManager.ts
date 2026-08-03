/**
 * audioManager.ts —— 音频运行时（Phase 6 打磨 · 实现路径 A）
 *
 * 设计前提：**零音频文件也必须跑通全链路**。
 *   assets/audio/ 整个目录不存在时，本模块必须：
 *     · 不抛任何异常（后端 create() 契约保证返回 no-op 句柄）
 *     · 不阻塞任何一帧（无同步 IO、无 await）
 *     · 设置项（静音/音量/减少动态音效）照常持久化并生效
 *     · ducking 引用计数照常收敛
 *   —— 即「音频是纯装饰层，缺席不改变游戏状态机」。
 *   这条契约对齐现有 loadImage 的 .catch() 静默降级模式。
 *
 * 依赖方向（重要）：
 *   core/ **不反向依赖 platform/**。本文件独立声明 AudioSink / AudioSinkHandle，
 *   与 platform/types.ts 的 AudioBackend / AudioHandle 结构等价，靠 TS 结构化类型
 *   在 app.ts 的注入点对接 —— 与既有 KVStore（core/collectionStore.ts 与
 *   platform/types.ts 各声明一份）完全相同的先例。
 *   未注入 sink 时退化为全局静默，Node 单测可直接 new。
 *
 * 参考：design/audio/audio-direction.md、audio-events.md、audio-implementation.md
 */

import {
  AUDIO_EVENTS,
  AUDIO_ROOT,
  AudioBus,
  AudioEventDef,
  AudioEventId,
  BGM_FADE_MS,
  BUS_GAIN,
  DIALOGUE_DUCK_FACTOR,
  DUCK_ATTACK_MS,
  DUCK_RELEASE_MS,
  E1_SUPPRESS_WINDOW_MS,
  MAX_AUDIO_INSTANCES,
  MAX_CONCURRENT_VOICES,
  MUSIC_SCENES,
  MusicScene,
  MusicTrackId,
  SfxEventId,
  fileOf,
  getAudioEvent,
} from './audioEvents';

/* ================= 与 platform 层结构等价的最小接口 ================= */

/** 结构等价 platform/types.AudioHandle */
export interface AudioSinkHandle {
  play(): void;
  pause(): void;
  stop(): void;
  setVolume(v: number): void;
  setLoop(loop: boolean): void;
  destroy(): void;
  readonly playing: boolean;
}

/** 结构等价 platform/types.AudioBackend */
export interface AudioSink {
  readonly available: boolean;
  create(src: string, opts: { shortSfx: boolean; loop?: boolean }): AudioSinkHandle;
  unlock(): void;
}

/**
 * 设置读写口（MetaStore 结构化满足；窄接口便于单测替身）。
 * 音量域为 0..100 整数（存档口径），AudioManager 对外 API 为 0..1。
 */
export interface AudioSettingsStore {
  readonly muted: boolean;
  readonly musicVolume: number;
  readonly sfxVolume: number;
  readonly reducedAudioFx: boolean;
  setMuted(on: boolean): void;
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  setReducedAudioFx(on: boolean): void;
}

/** 对外暴露的设置快照，音量归一化到 0..1 */
export interface AudioSettingsSnapshot {
  muted: boolean;
  musicVolume: number;
  sfxVolume: number;
  reducedAudioFx: boolean;
}

export interface AudioManagerDeps {
  /** 平台音频后端；缺省 / available=false → 全局静默 */
  sink?: AudioSink | null;
  /** 设置存储；缺省 → 内存态（不落盘，单测安全） */
  settings?: AudioSettingsStore | null;
  /** 时钟注入，便于单测 */
  now?: () => number;
}

export interface PlayOptions {
  /**
   * 变体选择。
   *   · 语义变体事件（semanticVariants）必须传：数字索引或后缀串（'_amer'）。
   *   · 随机变体事件可不传，内部按「避免紧邻重复」轮转。
   */
  variant?: number | string;
  /** 跳过节流与并发裁剪（仅供 P0 仪式音的特殊调用点使用） */
  force?: boolean;
}

/* ================= 内部结构 ================= */

interface PoolSlot {
  handle: AudioSinkHandle;
  src: string;
  /** 最近一次被使用的时间（LRU 淘汰依据） */
  usedAt: number;
}

interface Voice {
  eventId: AudioEventId;
  priority: number;
  slot: PoolSlot;
  /** 记账用的预估结束时刻（见 ASSUMED_DURATION_MS 注释） */
  expiresAt: number;
  /** 起播时刻。同优先级抢占时按它选「最早起播」者（FIFO），见 reserveVoiceSlot */
  startedAt: number;
}

/**
 * 并发记账用的预估时长（ms）。
 * ⚠ 这不是真实音频时长（零文件阶段根本没有时长可读），仅用于
 *   「同时发声数」这一软约束的滑窗回收；配上 handle.playing 的双重判定，
 *   估短了最多导致并发裁剪略保守，不会产生功能性错误。
 *   真实资产到位后可按 audio-events.md §7 的时长表校准。
 */
const ASSUMED_DURATION_MS: Record<AudioBus, number> = {
  MUSIC: 0,
  SFX_UI: 400,
  SFX_GAMEPLAY: 700,
  // 实测奖励音可听内容 ≤0.5s、win_session 1.26s 后纯静音；2000 会让奖励音「挂账」
  // 整整 2 秒白占并发位，导致 t=570 的 unlock_codex 被静默丢弃（§3.5 / §4.3）
  SFX_REWARD: 1200,
  SFX_NARRATIVE: 500,
};

/** 内存态设置兜底：未注入 MetaStore 时使用（不落盘） */
class MemorySettings implements AudioSettingsStore {
  muted = false;
  musicVolume = 55;
  sfxVolume = 85;
  reducedAudioFx = false;
  setMuted(on: boolean): void {
    this.muted = !!on;
  }
  setMusicVolume(v: number): void {
    this.musicVolume = clamp100(v);
  }
  setSfxVolume(v: number): void {
    this.sfxVolume = clamp100(v);
  }
  setReducedAudioFx(on: boolean): void {
    this.reducedAudioFx = !!on;
  }
}

function clamp100(v: number): number {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** 静默句柄（core 侧兜底，与 platform.silentAudioHandle 等价） */
function silentHandle(): AudioSinkHandle {
  return {
    play: () => {},
    pause: () => {},
    stop: () => {},
    setVolume: () => {},
    setLoop: () => {},
    destroy: () => {},
    playing: false,
  };
}

const NULL_SINK: AudioSink = {
  available: false,
  create: () => silentHandle(),
  unlock: () => {},
};

/* ================= AudioManager ================= */

export class AudioManager {
  private sink: AudioSink;
  private store: AudioSettingsStore;
  private clock: () => number;

  /** 后端可用且已 init；false → 所有 play/playBgm 直接返回 false */
  private enabled = false;
  private initialized = false;

  /** Web 自动播放策略：首次用户手势前不得起播 */
  private unlocked = false;
  private pendingScene: MusicScene | null = null;

  /** 前后台可见性：后台暂停 BGM，回前台续播 */
  private visible = true;

  /* --- 实例池 --- */
  private pools = new Map<AudioEventId, PoolSlot[]>();
  private poolCursor = new Map<AudioEventId, number>();
  private instanceCount = 0;

  /* --- 变体轮转 --- */
  private lastVariant = new Map<AudioEventId, number>();

  /* --- 节流与并发 --- */
  private lastPlayAt = new Map<AudioEventId, number>();
  private voices: Voice[] = [];
  /** E1 抑制规则①：最近一次「非 UI 组」音效的起播时刻 */
  private lastNonUiAt = -1e9;

  /* --- BGM --- */
  private bgmSlot: PoolSlot | null = null;
  private bgmTrack: MusicTrackId | null = null;
  private bgmScene: MusicScene | null = null;

  /* --- ducking（引用计数） --- */
  private duckDepth = 0;
  private duckFactor = 1;
  /** 事件自带 duck（P0 仪式音）的自动释放队列 */
  private duckReleases: number[] = [];

  /* --- 音乐增益斜坡 --- */
  private gainFrom = 1;
  private gainTo = 1;
  private rampStart = 0;
  private rampMs = 0;
  private tickSeen = false;

  constructor(deps: AudioManagerDeps = {}) {
    this.sink = deps.sink ?? NULL_SINK;
    this.store = deps.settings ?? new MemorySettings();
    this.clock = deps.now ?? (() => Date.now());
  }

  /* ---------------- 生命周期 ---------------- */

  /**
   * 初始化。幂等；**永不抛异常**。
   * 后端不可用（无 AudioContext / 无 wx.createInnerAudioContext / 注入为空）
   * 时静默停在 enabled=false，全部 API 退化为 no-op。
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.enabled = !!this.sink && this.sink.available === true;
    } catch {
      this.enabled = false;
    }
    this.gainFrom = this.gainTo = 1;
  }

  /** 后端是否真的在工作（供设置 UI 灰显、smoke 断言使用） */
  get active(): boolean {
    return this.enabled;
  }

  /**
   * 首次用户手势回调：解除 Web 自动播放限制，并补播挂起的 BGM。
   * 可重复调用，内部幂等。
   */
  notifyUserGesture(): void {
    if (!this.enabled || this.unlocked) return;
    this.unlocked = true;
    try {
      this.sink.unlock();
    } catch {
      /* 解锁失败不影响后续 SFX 尝试 */
    }
    if (this.pendingScene) {
      const s = this.pendingScene;
      this.pendingScene = null;
      this.playBgm(s);
    }
  }

  /** 前后台切换：后台暂停 BGM 省电，回前台续播（不重头） */
  setAppVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!this.enabled || !this.bgmSlot) return;
    try {
      if (visible) {
        if (!this.isMutedEffective()) this.bgmSlot.handle.play();
      } else {
        this.bgmSlot.handle.pause();
      }
    } catch {
      /* 忽略 */
    }
  }

  /**
   * 每帧推进：斜坡插值 + 声部回收 + 自动 duck 释放。
   * 未接线时（tick 从未被调用）所有斜坡退化为瞬时切换，
   * 功能不缺失、只是没有淡入淡出 —— 见 rampMs 计算处。
   */
  tick(nowMs?: number): void {
    if (!this.enabled) return;
    this.tickSeen = true;
    const now = nowMs ?? this.clock();
    this.sweepVoices(now);
    this.sweepDuckReleases(now);
    if (this.rampMs > 0) this.applyMusicGain(now);
  }

  /** 释放全部资源（退出 / 热重载用） */
  dispose(): void {
    for (const slots of this.pools.values()) {
      for (const s of slots) safeDestroy(s.handle);
    }
    this.pools.clear();
    this.poolCursor.clear();
    if (this.bgmSlot) safeDestroy(this.bgmSlot.handle);
    this.bgmSlot = null;
    this.bgmTrack = null;
    this.bgmScene = null;
    this.voices = [];
    this.instanceCount = 0;
    this.duckDepth = 0;
    this.duckFactor = 1;
    this.duckReleases = [];
  }

  /* ---------------- 设置 ---------------- */

  /** 音量以 0..1 返回（存档内部是 0..100 整数） */
  getSettings(): AudioSettingsSnapshot {
    return {
      muted: this.store.muted,
      musicVolume: this.store.musicVolume / 100,
      sfxVolume: this.store.sfxVolume / 100,
      reducedAudioFx: this.store.reducedAudioFx,
    };
  }

  setMuted(on: boolean): void {
    this.store.setMuted(!!on);
    this.applyMuteState();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.store.muted);
    return this.store.muted;
  }

  /** v ∈ 0..1 */
  setMusicVolume(v: number): void {
    this.store.setMusicVolume(clamp01(v) * 100);
    this.applyMusicGain(this.clock());
  }

  /** v ∈ 0..1 */
  setSfxVolume(v: number): void {
    this.store.setSfxVolume(clamp01(v) * 100);
    // SFX 音量在每次 play() 时现算，无需回写在播实例（短音效，下一次即生效）
  }

  setReducedAudioFx(on: boolean): void {
    this.store.setReducedAudioFx(!!on);
  }

  private isMutedEffective(): boolean {
    return this.store.muted;
  }

  private applyMuteState(): void {
    if (!this.enabled) return;
    if (this.store.muted) {
      // 静音：停掉全部在播 SFX，BGM 暂停（保留播放位点，取消静音可续播）
      for (const v of this.voices) safeCall(() => v.slot.handle.stop());
      this.voices = [];
      if (this.bgmSlot) safeCall(() => this.bgmSlot!.handle.pause());
    } else if (this.bgmSlot && this.visible) {
      this.applyMusicGain(this.clock());
      safeCall(() => this.bgmSlot!.handle.play());
    }
  }

  /* ---------------- SFX 播放 ---------------- */

  /**
   * 播放一枚音效。返回是否真的起播（被静音 / 节流 / 裁剪 / 无后端 → false）。
   * **永不抛异常**：任何内部失败都吞掉并返回 false。
   */
  play(eventId: SfxEventId, opts: PlayOptions = {}): boolean {
    if (!this.enabled) return false;
    const def = getAudioEvent(eventId);
    if (!def || def.bus === 'MUSIC') return false;
    if (this.isMutedEffective()) return false;
    // §8 降级表：「减少动态音效」静默高频细碎层
    if (this.store.reducedAudioFx && def.reducedFxSilent) return false;

    const now = this.clock();
    this.sweepVoices(now);
    this.sweepDuckReleases(now);

    // E1 抑制（audio-events.md §6.2）：对白弹出音让位于同期奖励/反馈音
    if (eventId === 'sfx_dialogue_pop' && !this.passesE1Suppression(now)) return false;

    // 节流：同事件最小间隔
    if (!opts.force && def.throttleMs > 0) {
      const last = this.lastPlayAt.get(eventId);
      if (last != null && now - last < def.throttleMs) return false;
    }

    // 并发裁剪：溢出时 P3 先丢；P0/P1 抢占最低优先级声部，永不被丢
    if (!opts.force && !this.reserveVoiceSlot(def)) return false;

    const idx = this.resolveVariant(def, opts.variant);
    const src = AUDIO_ROOT + fileOf(def, idx);
    const slot = this.acquireSlot(def, src, now);
    if (!slot) return false;

    const vol = this.sfxVolumeFor(def);
    if (
      !safeCall(() => {
        slot.handle.setLoop(false);
        slot.handle.setVolume(vol);
        slot.handle.stop(); // 池内复用：掐断上一次残留
        slot.handle.play();
      })
    ) {
      return false;
    }

    this.lastPlayAt.set(eventId, now);
    if (def.bus !== 'SFX_UI' && def.bus !== 'SFX_NARRATIVE') this.lastNonUiAt = now;
    this.voices.push({
      eventId,
      priority: def.priority,
      slot,
      expiresAt: now + ASSUMED_DURATION_MS[def.bus],
      startedAt: now,
    });

    // 事件自带 duck（P0 仪式音压低 BGM），到点自动释放
    if (def.duck != null && def.duck < 1) {
      this.duckPush(def.duck);
      this.duckReleases.push(now + ASSUMED_DURATION_MS[def.bus]);
    }
    return true;
  }

  /**
   * E1（sfx_dialogue_pop）抑制规则 · audio-events.md §6.2
   *   ① 前 400ms 内已有非 UI 组音效 → 跳过（不与奖励音打架）
   *   ② 同一批 toast 的第 2 条及以后 → 跳过（duckDepth>0 即代表已有对白在显示）
   *   ③ reducedAudioFx 开启 → 跳过（已由 def.reducedFxSilent=true 在上游拦截）
   */
  private passesE1Suppression(now: number): boolean {
    if (now - this.lastNonUiAt < E1_SUPPRESS_WINDOW_MS) return false;
    if (this.duckDepth > 0) return false;
    return true;
  }

  /** 最终 SFX 音量 = 总线增益 × 事件增益 × 用户音效音量 */
  private sfxVolumeFor(def: AudioEventDef): number {
    return clamp01(BUS_GAIN[def.bus] * def.volumeMul * (this.store.sfxVolume / 100));
  }

  /** 变体索引解析：语义变体按后缀精确匹配，随机变体避免紧邻重复 */
  private resolveVariant(def: AudioEventDef, variant?: number | string): number {
    const n = def.suffixes.length;
    if (n <= 1) return 0;
    if (typeof variant === 'number' && isFinite(variant)) return Math.floor(variant);
    if (typeof variant === 'string') {
      const want = variant.charAt(0) === '_' ? variant : '_' + variant;
      const i = def.suffixes.indexOf(want);
      if (i >= 0) return i;
      return 0; // 语义变体传错 → 回落首个，不静音
    }
    if (def.semanticVariants) return 0; // 语义变体未指定 → 首个
    const last = this.lastVariant.get(def.eventId);
    let i = Math.floor(Math.random() * n) % n;
    if (last != null && i === last) i = (i + 1) % n;
    this.lastVariant.set(def.eventId, i);
    return i;
  }

  /* ---------------- 并发与实例池 ---------------- */

  /** 回收已结束声部：句柄自报未在播 或 已过预估时长 */
  private sweepVoices(now: number): void {
    if (this.voices.length === 0) return;
    const alive: Voice[] = [];
    for (const v of this.voices) {
      let playing = false;
      try {
        playing = v.slot.handle.playing;
      } catch {
        playing = false;
      }
      if (playing && now < v.expiresAt) alive.push(v);
    }
    this.voices = alive;
  }

  /**
   * 预留一个发声位。
   * 同发上限 MAX_CONCURRENT_VOICES（1 BGM + 5 SFX）；溢出时按优先级抢占：
   * 找当前优先级数值最大（=最低优先级）的声部，**同优先级则取起播最早者**（FIFO）。
   * 仅当在场声部全都严格高于来者时，才丢弃来者。
   *
   * 为什么同优先级要抢占而不是丢来者（§3.5 / §4.3）：
   * 旧规则 `worstPri <= def.priority → return false` 会在 5 个 P1 挤满时把
   * sfx_unlock_codex / sfx_region_complete 静默丢掉 —— 恰好是最该响的时刻。
   * 新来的奖励音永远比 500ms 前那个更相关，所以让最老的那个让位。
   */
  private reserveVoiceSlot(def: AudioEventDef): boolean {
    if (this.voices.length < MAX_CONCURRENT_VOICES - 1) return true; // 预留 1 位给 BGM
    let worstIdx = -1;
    let worstPri = -1;
    let worstStartedAt = Infinity;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      // 主序：优先级数值越大越该被抢占；次序：同优先级下起播越早越该被抢占
      if (v.priority > worstPri || (v.priority === worstPri && v.startedAt < worstStartedAt)) {
        worstPri = v.priority;
        worstStartedAt = v.startedAt;
        worstIdx = i;
      }
    }
    if (worstIdx < 0 || worstPri < def.priority) return false; // 在场的都比来者更重要 → 丢弃来者
    safeCall(() => this.voices[worstIdx].slot.handle.stop());
    this.voices.splice(worstIdx, 1);
    return true;
  }

  /** 取一个可用池位（懒创建 + LRU 淘汰，遵守 MAX_AUDIO_INSTANCES 硬上限） */
  private acquireSlot(def: AudioEventDef, src: string, now: number): PoolSlot | null {
    let slots = this.pools.get(def.eventId);
    if (!slots) {
      slots = [];
      this.pools.set(def.eventId, slots);
    }
    const cap = Math.max(1, def.poolSize);

    // 已有同源池位可复用（多变体事件下同源命中率随变体数下降，属预期）
    for (const s of slots) {
      if (s.src === src && !isPlaying(s.handle)) {
        s.usedAt = now;
        return s;
      }
    }

    if (slots.length < cap) {
      const created = this.createSlot(src, true, false, now);
      if (created) {
        slots.push(created);
        return created;
      }
      // 实例满 → 落到下面的轮转复用
    }

    if (slots.length === 0) return null;
    const cur = (this.poolCursor.get(def.eventId) ?? 0) % slots.length;
    this.poolCursor.set(def.eventId, (cur + 1) % slots.length);
    const slot = slots[cur];
    if (slot.src !== src) {
      // 变体切换：换源需重建句柄（后端句柄与 src 绑定）
      safeDestroy(slot.handle);
      this.instanceCount--;
      const rebuilt = this.createSlot(src, true, false, now);
      if (!rebuilt) {
        slots.splice(cur, 1);
        return null;
      }
      slots[cur] = rebuilt;
      return rebuilt;
    }
    slot.usedAt = now;
    return slot;
  }

  /** 创建句柄；超出实例硬上限时先尝试 LRU 淘汰一个空闲 SFX 池位 */
  private createSlot(src: string, shortSfx: boolean, loop: boolean, now: number): PoolSlot | null {
    if (this.instanceCount >= MAX_AUDIO_INSTANCES && !this.evictIdleSlot()) return null;
    let handle: AudioSinkHandle;
    try {
      handle = this.sink.create(src, { shortSfx, loop });
    } catch {
      return null; // 后端契约上不该抛，双保险
    }
    this.instanceCount++;
    return { handle, src, usedAt: now };
  }

  /** LRU 淘汰一个未在播的池位；无可淘汰返回 false */
  private evictIdleSlot(): boolean {
    let victimList: PoolSlot[] | null = null;
    let victimIdx = -1;
    let oldest = Infinity;
    for (const slots of this.pools.values()) {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (isPlaying(s.handle)) continue;
        if (s.usedAt < oldest) {
          oldest = s.usedAt;
          victimList = slots;
          victimIdx = i;
        }
      }
    }
    if (!victimList || victimIdx < 0) return false;
    safeDestroy(victimList[victimIdx].handle);
    victimList.splice(victimIdx, 1);
    this.instanceCount--;
    return true;
  }

  /* ---------------- BGM ---------------- */

  /**
   * 切换场景music。同轨不同场景（codex ↔ detail）只改增益不重起播，
   * 避免打开详情时音乐从头开始这类破坏沉浸的瑕疵。
   */
  playBgm(scene: MusicScene): boolean {
    if (!this.enabled) return false;
    const cfg = MUSIC_SCENES[scene];
    if (!cfg) return false;
    if (this.bgmScene === scene && this.bgmSlot) return true;

    if (!this.unlocked) {
      this.pendingScene = scene; // 等首次用户手势
      this.bgmScene = scene;
      return false;
    }

    const now = this.clock();
    if (this.bgmTrack === cfg.track && this.bgmSlot) {
      this.bgmScene = scene;
      this.rampMusicTo(this.targetMusicGain(), BGM_FADE_MS, now);
      return true;
    }

    if (this.bgmSlot) {
      safeCall(() => this.bgmSlot!.handle.stop());
      safeDestroy(this.bgmSlot.handle);
      this.instanceCount--;
      this.bgmSlot = null;
    }

    const src = AUDIO_ROOT + fileOf(AUDIO_EVENTS[cfg.track], 0);
    const slot = this.createSlot(src, false, true, now);
    if (!slot) {
      this.bgmTrack = null;
      this.bgmScene = scene;
      return false;
    }
    this.bgmSlot = slot;
    this.bgmTrack = cfg.track;
    this.bgmScene = scene;

    const target = this.targetMusicGain();
    return safeCall(() => {
      slot.handle.setLoop(true);
      slot.handle.setVolume(this.isMutedEffective() ? 0 : target);
      if (!this.isMutedEffective() && this.visible) slot.handle.play();
    });
  }

  stopBgm(): void {
    if (!this.bgmSlot) {
      this.bgmScene = null;
      this.bgmTrack = null;
      this.pendingScene = null;
      return;
    }
    safeCall(() => this.bgmSlot!.handle.stop());
    safeDestroy(this.bgmSlot.handle);
    this.instanceCount--;
    this.bgmSlot = null;
    this.bgmTrack = null;
    this.bgmScene = null;
    this.pendingScene = null;
  }

  /** 当前 BGM 场景（供 app 判断是否需要切换，避免重复调用） */
  get currentScene(): MusicScene | null {
    return this.bgmScene;
  }

  /** 目标音乐增益 = 场景增益 × 总线增益 × 用户音乐音量 × duck 系数 */
  private targetMusicGain(): number {
    const scene = this.bgmScene ? MUSIC_SCENES[this.bgmScene] : null;
    const sceneGain = scene ? scene.gain : 1;
    return clamp01(sceneGain * BUS_GAIN.MUSIC * (this.store.musicVolume / 100) * this.duckFactor);
  }

  /**
   * 启动增益斜坡。
   * tick() 从未被调用过时（tickSeen=false）退化为瞬时切换 —— 这样即便
   * 宿主忘了接线 tick，音量/ducking 依然**功能正确**，只是没有淡变。
   */
  private rampMusicTo(target: number, ms: number, now: number): void {
    this.gainFrom = this.currentMusicGain(now);
    this.gainTo = target;
    this.rampStart = now;
    this.rampMs = this.tickSeen ? Math.max(0, ms) : 0;
    this.applyMusicGain(now);
  }

  private currentMusicGain(now: number): number {
    if (this.rampMs <= 0) return this.gainTo;
    const t = (now - this.rampStart) / this.rampMs;
    if (t >= 1) return this.gainTo;
    if (t <= 0) return this.gainFrom;
    return this.gainFrom + (this.gainTo - this.gainFrom) * t;
  }

  private applyMusicGain(now: number): void {
    if (!this.bgmSlot) return;
    const g = this.rampMs > 0 ? this.currentMusicGain(now) : this.targetMusicGain();
    if (this.rampMs > 0 && now - this.rampStart >= this.rampMs) this.rampMs = 0;
    safeCall(() => this.bgmSlot!.handle.setVolume(this.isMutedEffective() ? 0 : clamp01(g)));
  }

  /* ---------------- Ducking ---------------- */

  /**
   * 压低 BGM（对白弹出等）。**引用计数**：duck/unduck 必须配对，
   * 归零才恢复 —— 多条 toast 叠加时不会提前抬回音量。
   * factor 缺省 = DIALOGUE_DUCK_FACTOR（0.35，本项目任务书口径；
   * audio-implementation.md 建议 0.60，二者差异集中在该常量单点，改一处即可）。
   */
  duck(factor: number = DIALOGUE_DUCK_FACTOR): void {
    this.duckPush(factor);
  }

  unduck(): void {
    this.duckPop();
  }

  duckPush(factor: number = DIALOGUE_DUCK_FACTOR): void {
    this.duckDepth++;
    const f = clamp01(factor);
    // 多重 duck 取最深，避免浅 duck 覆盖深 duck
    if (this.duckDepth === 1 || f < this.duckFactor) {
      this.duckFactor = f;
      this.rampMusicTo(this.targetMusicGain(), DUCK_ATTACK_MS, this.clock());
    }
  }

  duckPop(): void {
    if (this.duckDepth <= 0) return; // 多余的 pop 无害
    this.duckDepth--;
    if (this.duckDepth === 0) {
      this.duckFactor = 1;
      this.rampMusicTo(this.targetMusicGain(), DUCK_RELEASE_MS, this.clock());
    }
  }

  /** 强制归零 ducking（场景切换等硬边界，防引用计数泄漏卡住音量） */
  resetDuck(): void {
    if (this.duckDepth === 0 && this.duckFactor === 1) return;
    this.duckDepth = 0;
    this.duckFactor = 1;
    this.duckReleases = [];
    this.rampMusicTo(this.targetMusicGain(), DUCK_RELEASE_MS, this.clock());
  }

  private sweepDuckReleases(now: number): void {
    if (this.duckReleases.length === 0) return;
    const keep: number[] = [];
    for (const at of this.duckReleases) {
      if (now >= at) this.duckPop();
      else keep.push(at);
    }
    this.duckReleases = keep;
  }

  /* ---------------- 自检 ---------------- */

  /** 运行时诊断快照（smoke / 调试面板用） */
  debugState(): {
    enabled: boolean;
    unlocked: boolean;
    instances: number;
    voices: number;
    duckDepth: number;
    scene: MusicScene | null;
  } {
    return {
      enabled: this.enabled,
      unlocked: this.unlocked,
      instances: this.instanceCount,
      voices: this.voices.length,
      duckDepth: this.duckDepth,
      scene: this.bgmScene,
    };
  }
}

/* ================= 工具 ================= */

function isPlaying(h: AudioSinkHandle): boolean {
  try {
    return h.playing === true;
  } catch {
    return false;
  }
}

function safeDestroy(h: AudioSinkHandle): void {
  try {
    h.destroy();
  } catch {
    /* 忽略 */
  }
}

/** 执行并吞异常；返回是否成功 —— 音频层任何失败都不得冒泡到游戏逻辑 */
function safeCall(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}
