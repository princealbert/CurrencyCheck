/**
 * metaStore.ts — 元进度持久化：最佳星 / 完成局数 / 每币 mastery / 设置
 * （Phase1 §2.3 / §2.4 / §4.4 / §6.4；纯逻辑，零 cc/DOM 依赖）
 *
 * 与 CollectionStore 同模式：构造注入 KVStore（browser=localStorage / wechat=wx.*），
 * 未注入时退化为内存 Map（Node 单测安全）。**不改 CollectionStore**，解锁集合仍归它管。
 *
 * 与 CollectionStore 的一个差异：本类在构造时一次性读入并缓存，之后写时同步回落盘。
 * 原因：Hub 副标题 / 图鉴 pips 会在渲染热路径每帧查询，避免每帧 JSON.parse。
 *
 * 存储键（§6.4，沿用 -v1 约定）：
 *   currency-codex-stars-v1     {"t1_coin":3,"t2_note":2,...} 旧档位最佳星（legacy，只读兼容）
 *   currency-codex-plays-v1     {"t1":5,"t2":3,"t3":0} 旧档位完成局数（legacy，只读兼容）
 *   currency-codex-chstars-v1   {"amer_1":3,"world_2":2,...} **章节 × 难度档**最佳星 0–3
 *   currency-codex-chplays-v1   {"amer_1":5,"euro_2":1,...} **章节 × 难度档**完成局数
 *   currency-codex-mastery-v1   {"USD":7,"BRL":2,...} 累计成功配对次数（上限 999）
 *   currency-codex-seen-v1      {"amer":1,"euro":1} **已进过的章节**（开场白只播一次）
 *   currency-codex-settings-v1  {"colorblind":false}
 *   currency-codex-first-launch-v1   "1"  首次启动标志（S1_HUB_FIRST_OPEN vs RETURN）
 *   currency-codex-visit-tracking-v1  {"consecutiveDays":3,"lastVisitDate":"2026-07-30"}
 *   currency-codex-seen-dialogue-v1   ["S1_HUB_FIRST_OPEN","CODEX_OPEN:USD",...] once-lifetime 对白去重
 *   currency-codex-first-tutorial-v1  "1"  首次配对教学（MATCH_FIRST_TUTORIAL）
 *
 * 关卡章节化（2026-08 · chapters.ts 接入）：
 *   星 / 局数的维度由 (tier, form) 扩展为 **(chapter, grade)**。
 *   - 章节星不再分形态：同一 (chapter, grade) 取两形态中的最好成绩，降低门槛感，
 *     与 chapters.isChapterOpen / isGradeOpen 的判定口径（只看 plays/bestStar）一致。
 *   - 旧的 (tier, form) 接口整体保留为 legacy 只读 + 可写通道，老存档不失效、老调用点不炸。
 *   - **分层红线**：core/ 不依赖 data/，故此处用结构等价的 ChapterKey/GradeKey
 *     而非 import data/chapters 的 ChapterId/Grade（二者可直接赋值兼容）。
 */

import { FormFactor } from './types';
import { KVStore } from './collectionStore';
import { TierId } from './tierConfig';

const STORAGE_STARS = 'currency-codex-stars-v1';
const STORAGE_PLAYS = 'currency-codex-plays-v1';
const STORAGE_CHSTARS = 'currency-codex-chstars-v1';
const STORAGE_CHPLAYS = 'currency-codex-chplays-v1';
const STORAGE_MASTERY = 'currency-codex-mastery-v1';
const STORAGE_SEEN = 'currency-codex-seen-v1';
const STORAGE_SETTINGS = 'currency-codex-settings-v1';
const STORAGE_FIRST_LAUNCH = 'currency-codex-first-launch-v1';
const STORAGE_VISIT_TRACKING = 'currency-codex-visit-tracking-v1';
const STORAGE_SEEN_DIALOGUE = 'currency-codex-seen-dialogue-v1';
const STORAGE_FIRST_TUTORIAL = 'currency-codex-first-tutorial-v1';
/** 「环游世界」全收集结算伪视频是否已看过（world-tour-reward §3.2 第 2 项） */
const STORAGE_WORLDTOUR = 'currency-codex-worldtour-v1';

/** 章节键（结构等价 data/chapters.ChapterId；core 不反向依赖 data） */
export type ChapterKey = string;
/** 难度档键（结构等价 data/chapters.Grade） */
export type GradeKey = 1 | 2 | 3;

/** mastery 累计上限（防溢出/防长整数展示异常） */
export const MASTERY_CAP = 999;

/** mastery 里程碑门槛（§2.4）：●○○ ≥1 熟悉 / ●●○ ≥5 熟识 / ●●● ≥15 精通 */
export const MASTERY_TIERS = [1, 5, 15];

/**
 * 满星总数（章节制）：
 *   3 个单区章 × 3 档 × 3 星 = 27
 * + 环球章       × 3 档 × 3 星 = 9   ← 环球补回 T1（2026-08 playtest 修复）
 * = 36
 * （旧口径 18 = 3 档 × 2 形态 × 3 星，已随章节化作废；图鉴顶栏读本常量，自动跟随）
 *
 * ⚠ 与 data/chapters.CHAPTERS 的 tiers 总数强耦合（core 不反向依赖 data，故手写常量）：
 *   改任何一章的 tiers 数量，必须同步本常量，否则 totalStars() 的 Math.min 会提前封顶。
 */
export const TOTAL_STARS = 36;

/**
 * 用户设置（单键 STORAGE_SETTINGS 持久化，**零新增存储键**）。
 *
 * 落盘格式约定：全部为 number（布尔存 0|1，音量存 0..100 整数），
 * 这样 readObj() 的 Record<string, number> 解析层无需任何改动，
 * 老存档（仅含 colorblind）通过 ?? 兜底自动补齐音频字段。
 *
 * 音量之所以用 0..100 整数而非 0..1 浮点：
 *   ① 避免 JSON 浮点精度噪声（0.55000000000000004）；
 *   ② 设置 UI 的滑块/档位天然按百分比走；
 *   ③ AudioManager 对外 API 仍是 0..1，转换只在 audioManager 一处发生。
 */
export interface Settings {
  colorblind: boolean;
  /** 全局静音（盖过音量） */
  muted: boolean;
  /** 音乐总音量 0..100 */
  musicVolume: number;
  /** 音效总音量 0..100 */
  sfxVolume: number;
  /** 减少动态音效（无障碍/低打扰）：静音高频细碎音效层 */
  reducedAudioFx: boolean;
}

/** 设置默认值（首次启动 / 老存档缺字段时的兜底） */
export const DEFAULT_MUSIC_VOLUME = 55;
export const DEFAULT_SFX_VOLUME = 85;

let memoryFallback: Map<string, string> | null = null;

function getMemory(): Map<string, string> {
  if (!memoryFallback) memoryFallback = new Map<string, string>();
  return memoryFallback;
}

/** 存档里布尔可能是 1 / true（历史写法），统一归一 */
function truthy(v: unknown): boolean {
  return v === 1 || v === true;
}

/** 音量夹紧到 0..100 整数；非数字/NaN 回落默认值 */
function clampVol(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n)) return dflt;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function starKey(tier: TierId, form: FormFactor): string {
  return 't' + tier + '_' + form;
}

function playKey(tier: TierId): string {
  return 't' + tier;
}

/** 章节 × 难度档统一键：'amer_1' / 'world_3' */
function chKey(chapter: ChapterKey, grade: GradeKey): string {
  return chapter + '_' + grade;
}

export class MetaStore {
  private kv: KVStore | null;
  private stars: Record<string, number>;
  private playCounts: Record<string, number>;
  private chStars: Record<string, number>;
  private chPlays: Record<string, number>;
  private masteryMap: Record<string, number>;
  private seenChapters: Record<string, number>;
  private settingsCache: Settings;
  // —— 对白引擎持久化状态（§4.1）——
  private launchedBefore: boolean;
  private consecutiveDays: number;
  private lastVisitDate: string | null;
  private seenDialogueSet: Set<string>;
  private seenFirstTutorial: boolean;
  /** 「环游世界」伪视频已看过标记（构造时读一次，之后内存权威 + 写穿） */
  private seenWorldTour: boolean;

  constructor(kv?: KVStore) {
    this.kv = kv ?? null;
    this.stars = this.readObj(STORAGE_STARS);
    this.playCounts = this.readObj(STORAGE_PLAYS);
    this.chStars = this.readObj(STORAGE_CHSTARS);
    this.chPlays = this.readObj(STORAGE_CHPLAYS);
    this.masteryMap = this.readObj(STORAGE_MASTERY);
    this.seenChapters = this.readObj(STORAGE_SEEN);
    this.settingsCache = this.readSettings();
    // 对白引擎状态
    this.launchedBefore = this.raw(STORAGE_FIRST_LAUNCH) === '1';
    const vt = this.readVisitTracking();
    this.consecutiveDays = vt.consecutiveDays;
    this.lastVisitDate = vt.lastVisitDate;
    this.seenDialogueSet = this.readSeenDialogue();
    this.seenFirstTutorial = this.raw(STORAGE_FIRST_TUTORIAL) === '1';
    this.seenWorldTour = this.raw(STORAGE_WORLDTOUR) === '1';
  }

  /* ---------------- 底层读写 ---------------- */

  private raw(k: string): string | null {
    return this.kv ? this.kv.getItem(k) : getMemory().get(k) ?? null;
  }

  private writeRaw(k: string, v: string): void {
    if (this.kv) this.kv.setItem(k, v);
    else getMemory().set(k, v);
  }

  private readObj(k: string): Record<string, number> {
    const raw = this.raw(k);
    if (raw == null) return {};
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, number>) : {};
    } catch (e) {
      return {};
    }
  }

  /* ---------------- 最佳星（§2.3，只升不降） ---------------- */

  /** 某档某形态最佳星（0 = 从未完成） */
  bestStar(tier: TierId, form: FormFactor): number {
    const v = this.stars[starKey(tier, form)];
    return typeof v === 'number' && v > 0 ? Math.min(3, Math.floor(v)) : 0;
  }

  /** 某档两形态中的最高星（Hub 副标题 / T3 解锁判定用） */
  bestStarOfTier(tier: TierId): number {
    return Math.max(this.bestStar(tier, 'coin'), this.bestStar(tier, 'note'));
  }

  /** 只升不降写入最佳星；返回是否刷新了纪录 */
  setBestStar(tier: TierId, form: FormFactor, earned: number): boolean {
    const e = Math.max(0, Math.min(3, Math.floor(earned)));
    const key = starKey(tier, form);
    const prev = this.bestStar(tier, form);
    if (e <= prev) return false;
    this.stars[key] = e;
    this.writeRaw(STORAGE_STARS, JSON.stringify(this.stars));
    return true;
  }

  /* ---------------- 章节 × 难度档最佳星（只升不降，幂等） ---------------- */

  /** 某章某档最佳星（0 = 从未完成）；不分形态 —— 两形态取其一的最好成绩 */
  bestStarChapter(chapter: ChapterKey, grade: GradeKey): number {
    const v = this.chStars[chKey(chapter, grade)];
    return typeof v === 'number' && v > 0 ? Math.min(3, Math.floor(v)) : 0;
  }

  /** 某章全档中的最高星（Hub 书架副标题展示） */
  bestStarOfChapter(chapter: ChapterKey): number {
    let best = 0;
    for (const g of [1, 2, 3] as GradeKey[]) {
      const s = this.bestStarChapter(chapter, g);
      if (s > best) best = s;
    }
    return best;
  }

  /** 只升不降写入章节最佳星；返回是否刷新了纪录（幂等：重复写同值不落盘） */
  setBestStarChapter(chapter: ChapterKey, grade: GradeKey, earned: number): boolean {
    const e = Math.max(0, Math.min(3, Math.floor(earned)));
    const prev = this.bestStarChapter(chapter, grade);
    if (e <= prev) return false;
    this.chStars[chKey(chapter, grade)] = e;
    this.writeRaw(STORAGE_CHSTARS, JSON.stringify(this.chStars));
    return true;
  }

  /**
   * 已获总星数（图鉴顶栏展示，上限 TOTAL_STARS）。
   * 章节星为主；旧档位星一并计入，保证老存档升级后星数不「凭空蒸发」。
   */
  totalStars(): number {
    let sum = 0;
    for (const k of Object.keys(this.chStars)) {
      const v = this.chStars[k];
      if (typeof v === 'number' && v > 0) sum += Math.min(3, Math.floor(v));
    }
    for (const k of Object.keys(this.stars)) {
      const v = this.stars[k];
      if (typeof v === 'number' && v > 0) sum += Math.min(3, Math.floor(v));
    }
    return Math.min(TOTAL_STARS, sum);
  }

  /* ---------------- 完成局数（§4.4 保底通道） ---------------- */

  plays(tier: TierId): number {
    const v = this.playCounts[playKey(tier)];
    return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
  }

  addPlay(tier: TierId): void {
    const key = playKey(tier);
    this.playCounts[key] = this.plays(tier) + 1;
    this.writeRaw(STORAGE_PLAYS, JSON.stringify(this.playCounts));
  }

  /**
   * 老玩家迁移（§4.4）：已有存档（解锁集非空）但 plays 为空 → 视为已完成过 T1 一局，
   * 避免升级后档位倒退回「只剩 T1」的体感。幂等（plays 非空即跳过）。
   */
  migrateLegacy(hasUnlockedAny: boolean): void {
    if (!hasUnlockedAny) return;
    if (Object.keys(this.playCounts).length > 0) return;
    this.playCounts[playKey(1)] = 1;
    this.writeRaw(STORAGE_PLAYS, JSON.stringify(this.playCounts));
  }

  /* ---------------- 章节 × 难度档完成局数（解锁链唯一真源） ---------------- */

  /** 某章某档累计完成局数（喂 chapters.isChapterOpen / isGradeOpen） */
  playsChapter(chapter: ChapterKey, grade: GradeKey): number {
    const v = this.chPlays[chKey(chapter, grade)];
    return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
  }

  /** 某章全档累计完成局数（Hub 展示 / 首进判定的保底通道） */
  playsOfChapter(chapter: ChapterKey): number {
    let sum = 0;
    for (const g of [1, 2, 3] as GradeKey[]) sum += this.playsChapter(chapter, g);
    return sum;
  }

  /** 局末 +1（只增不减；解锁链是「累计」语义，重复通关只会更开放，不会倒退） */
  addPlayChapter(chapter: ChapterKey, grade: GradeKey): void {
    const key = chKey(chapter, grade);
    this.chPlays[key] = this.playsChapter(chapter, grade) + 1;
    this.writeRaw(STORAGE_CHPLAYS, JSON.stringify(this.chPlays));
  }

  /* ---------------- 首进章节标记（开场白只播一次，幂等） ---------------- */

  /** 是否已进过该章（含未通关就退出的情况 —— 开场白按「进过」算，不重复轰炸） */
  hasSeenChapter(chapter: ChapterKey): boolean {
    return this.seenChapters[chapter] === 1;
  }

  /**
   * 标记该章已进入；返回 true 表示**这次是首进**（调用方据此播叙事）。
   * 幂等：第二次调用返回 false 且不落盘。
   */
  markChapterSeen(chapter: ChapterKey): boolean {
    if (this.hasSeenChapter(chapter)) return false;
    this.seenChapters[chapter] = 1;
    this.writeRaw(STORAGE_SEEN, JSON.stringify(this.seenChapters));
    return true;
  }

  /* ---------------- 每币 mastery（§2.4 累计制） ---------------- */

  mastery(iso: string): number {
    const v = this.masteryMap[iso];
    return typeof v === 'number' && v > 0 ? Math.min(MASTERY_CAP, Math.floor(v)) : 0;
  }

  /** 每次成功配对 +1（不限首次；coin/note 合并计） */
  addMastery(iso: string): void {
    const next = Math.min(MASTERY_CAP, this.mastery(iso) + 1);
    this.masteryMap[iso] = next;
    this.writeRaw(STORAGE_MASTERY, JSON.stringify(this.masteryMap));
  }

  /** 里程碑点数 0–3（图鉴单元格 pips / T3 加抽权重） */
  pips(iso: string): number {
    const n = this.mastery(iso);
    let p = 0;
    for (const t of MASTERY_TIERS) if (n >= t) p++;
    return p;
  }

  /* ---------------- 设置（§5.3 色弱开关 + 音频四项） ---------------- */

  /** 读取并规范化设置；缺字段走默认值，脏值被夹紧到合法域 */
  private readSettings(): Settings {
    const s = this.readObj(STORAGE_SETTINGS);
    return {
      colorblind: truthy(s.colorblind),
      muted: truthy(s.muted),
      musicVolume: clampVol(s.musicVolume, DEFAULT_MUSIC_VOLUME),
      sfxVolume: clampVol(s.sfxVolume, DEFAULT_SFX_VOLUME),
      reducedAudioFx: truthy(s.reducedAudioFx),
    };
  }

  /**
   * 合并式落盘：**永远写全字段**。
   * 历史缺陷：旧 setColorblind 用 `{ colorblind }` 整体替换缓存并只写单字段，
   * 扩展 Settings 后会静默吞掉音频设置。所有 setter 统一走此处，杜绝复发。
   */
  private persistSettings(patch: Partial<Settings>): void {
    this.settingsCache = { ...this.settingsCache, ...patch };
    const c = this.settingsCache;
    this.writeRaw(
      STORAGE_SETTINGS,
      JSON.stringify({
        colorblind: c.colorblind ? 1 : 0,
        muted: c.muted ? 1 : 0,
        musicVolume: c.musicVolume,
        sfxVolume: c.sfxVolume,
        reducedAudioFx: c.reducedAudioFx ? 1 : 0,
      })
    );
  }

  /** 返回设置快照（副本，防外部就地改缓存） */
  settings(): Settings {
    return { ...this.settingsCache };
  }

  get colorblind(): boolean {
    return this.settingsCache.colorblind;
  }

  setColorblind(on: boolean): void {
    this.persistSettings({ colorblind: !!on });
  }

  /* --- 音频设置（AudioManager 为唯一读写方，UI 经 AudioManager 转发） --- */

  get muted(): boolean {
    return this.settingsCache.muted;
  }

  setMuted(on: boolean): void {
    this.persistSettings({ muted: !!on });
  }

  /** 0..100 */
  get musicVolume(): number {
    return this.settingsCache.musicVolume;
  }

  setMusicVolume(v: number): void {
    this.persistSettings({ musicVolume: clampVol(v, DEFAULT_MUSIC_VOLUME) });
  }

  /** 0..100 */
  get sfxVolume(): number {
    return this.settingsCache.sfxVolume;
  }

  setSfxVolume(v: number): void {
    this.persistSettings({ sfxVolume: clampVol(v, DEFAULT_SFX_VOLUME) });
  }

  get reducedAudioFx(): boolean {
    return this.settingsCache.reducedAudioFx;
  }

  setReducedAudioFx(on: boolean): void {
    this.persistSettings({ reducedAudioFx: !!on });
  }

  /* ---------------- 对白引擎持久化状态（§4.1） ---------------- */

  /** 1. hasLaunchedBefore — S1_HUB_FIRST_OPEN vs S1_HUB_RETURN 判定 */
  hasLaunchedBefore(): boolean {
    return this.launchedBefore;
  }

  /** 幂等：首次调用写入 true 并落盘 */
  markLaunchedBefore(): void {
    if (this.launchedBefore) return;
    this.launchedBefore = true;
    this.writeRaw(STORAGE_FIRST_LAUNCH, '1');
  }

  /* ---------------- 「环游世界」全收集结算（world-tour-reward §3.2 第 2 项） ---------------- */

  /**
   * 是否已看过「周爷爷的礼物」。
   * 双职责：① 自动触发的去重闸（否则每次回 Hub 都会重播）；
   *         ② Hub 重看入口的显示条件（§3.4，只有看过的人才看得到那枚入口）。
   */
  hasSeenWorldTour(): boolean {
    return this.seenWorldTour;
  }

  /**
   * 幂等：首次调用写入 true 并**落盘**。
   * ⚠ 必须持久化 —— 只存内存的话，杀进程重进会重播 33 秒，礼物立刻变成骚扰。
   * 调用点唯一：`App.closeWorldTour()`（播完 / 跳过 / 主动关闭走同一出口）。
   */
  markWorldTourSeen(): void {
    if (this.seenWorldTour) return;
    this.seenWorldTour = true;
    this.writeRaw(STORAGE_WORLDTOUR, '1');
  }

  /** 2&3. 连续登录天数 + 上次访问日期 */
  getVisitTracking(): { consecutiveDays: number; lastVisitDate: string | null } {
    return { consecutiveDays: this.consecutiveDays, lastVisitDate: this.lastVisitDate };
  }

  /**
   * 更新访问追踪（§1 节点 2 sub-state 计算）。
   * daysSinceLastVisit 在更新 lastVisitDate **之前**计算。
   *
   * 算法：
   *   today = YYYY-MM-DD
   *   if (lastVisitDate == null):  consecutiveDays = 1
   *   elif (lastVisitDate == today): 同天不重复计数（daysSinceLastVisit=0）
   *   elif (lastVisitDate == yesterday): consecutiveDays += 1
   *   else: consecutiveDays = 1  (断签重置)
   *   lastVisitDate = today
   */
  updateVisitTracking(today: string): { consecutiveDays: number; daysSinceLastVisit: number } {
    // 在更新前计算 daysSinceLastVisit
    let daysSinceLastVisit = 0;
    if (this.lastVisitDate && this.lastVisitDate !== today) {
      daysSinceLastVisit = daysBetween(this.lastVisitDate, today);
    }

    if (this.lastVisitDate == null) {
      this.consecutiveDays = 1;
    } else if (this.lastVisitDate === today) {
      // 同一天重复打开，不重复计数
      // consecutiveDays 不变
    } else {
      const yesterday = addDays(today, -1);
      if (this.lastVisitDate === yesterday) {
        this.consecutiveDays += 1;
      } else {
        this.consecutiveDays = 1; // 断签重置
      }
    }
    this.lastVisitDate = today;
    this.writeRaw(STORAGE_VISIT_TRACKING, JSON.stringify({
      consecutiveDays: this.consecutiveDays,
      lastVisitDate: this.lastVisitDate,
    }));
    return { consecutiveDays: this.consecutiveDays, daysSinceLastVisit };
  }

  /** 4. seenDialogueNodes — once-lifetime 节点去重（key 如 "CODEX_OPEN:USD"） */
  hasSeenDialogue(key: string): boolean {
    return this.seenDialogueSet.has(key);
  }

  /** 幂等写入 */
  markDialogueSeen(key: string): void {
    if (this.seenDialogueSet.has(key)) return;
    this.seenDialogueSet.add(key);
    this.writeRaw(STORAGE_SEEN_DIALOGUE, JSON.stringify([...this.seenDialogueSet]));
  }

  /** 5. hasSeenFirstTutorial — MATCH_FIRST_TUTORIAL 去重 */
  hasSeenFirstTutorial(): boolean {
    return this.seenFirstTutorial;
  }

  /** 幂等写入 */
  markSeenFirstTutorial(): void {
    if (this.seenFirstTutorial) return;
    this.seenFirstTutorial = true;
    this.writeRaw(STORAGE_FIRST_TUTORIAL, '1');
  }

  /* ---------------- 对白引擎持久化底层读写 ---------------- */

  private readVisitTracking(): { consecutiveDays: number; lastVisitDate: string | null } {
    const raw = this.raw(STORAGE_VISIT_TRACKING);
    if (raw == null) return { consecutiveDays: 0, lastVisitDate: null };
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        return {
          consecutiveDays: typeof o.consecutiveDays === 'number' ? o.consecutiveDays : 0,
          lastVisitDate: typeof o.lastVisitDate === 'string' ? o.lastVisitDate : null,
        };
      }
    } catch (e) {
      // fallthrough
    }
    return { consecutiveDays: 0, lastVisitDate: null };
  }

  private readSeenDialogue(): Set<string> {
    const raw = this.raw(STORAGE_SEEN_DIALOGUE);
    if (raw == null) return new Set();
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr as string[]);
    } catch (e) {
      // fallthrough
    }
    return new Set();
  }
}

/* ================= 日期工具（对白引擎 visit tracking） ================= */

/** YYYY-MM-DD → Date（本地午夜，避免 UTC 偏移） */
function parseDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Date → YYYY-MM-DD */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 在 YYYY-MM-DD 上加减天数，返回新的 YYYY-MM-DD */
function addDays(iso: string, delta: number): string {
  const d = parseDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + delta);
  return formatDate(d);
}

/** 计算两个 YYYY-MM-DD 之间的天数差（b - a，正数=b 在 a 之后） */
function daysBetween(a: string, b: string): number {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** 当前日期 → YYYY-MM-DD（本地时区） */
export function todayISO(): string {
  return formatDate(new Date());
}
