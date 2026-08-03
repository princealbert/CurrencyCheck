/**
 * chapters.ts — 关卡章节定义（区域 × 难度），引擎直接读
 *
 * 设计定位（见 design/levels/level-design-doc.md）：
 *   一个 "level" = (chapter, grade) 组合。
 *     - chapter 决定**币种池**（区域维度 / 内容维度）
 *     - grade   决定**网格 / 对数 / 副本**（难度维度）
 *
 * 关键决策：
 *   1. 网格由「对数」推导（gridForPairs），不全局固定——
 *      单区池仅 6 币，硬上 6×6(18对) 会空 12 格 → 不可读。
 *   2. 加权抽取**复用 tierConfig.pickWeighted**：grade1 用 isUnlocked 权重
 *      （未解锁×3，把发现感还给前几局），grade3 用 pips 权重（越不熟越常出现）。
 *   3. 关联模式（环球 T3）= 货币 ↔ 母题 配对，是审计创意 A 的落地；
 *      matchLogic 钩子见底部 associationPlan()，evaluate 接一个分支即可。
 *
 * 合规：仅风格化数据，无真实钞币图 / 国旗 / 防伪语言。
 */

import { Region, FormFactor } from '../core/types';
import { CURRENCIES } from './currencies';
import { PlanItem, PlanContext, TierGrid, pickWeighted } from '../core/tierConfig';

/* ---------------- 类型 ---------------- */

/** 章节 ID：三大单区 + 环球 */
export type ChapterId = Region | 'world';
/** 难度档：1 初识 / 2 环游 / 3 环球（语义随章节略有不同，见 CHAPTERS） */
export type Grade = 1 | 2 | 3;
/** 配对模式：match=货币↔同货币；associate=货币↔其母题元素 */
export type MatchMode = 'match' | 'associate';

export interface ChapterDef {
  id: ChapterId;
  name: string;            // 关卡名（Hub 书架标题）
  subtitle: string;        // 周爷爷足迹副标题
  sequence: number;        // 解锁顺序（itinerary）
  pool: Region | 'all';    // 币种池来源
  narrativeBeat: string;   // 册册进入章节开场白
  grandpaNote: string;     // 周爷爷纸条（环境叙事）
  sceneTheme: string;      // 场景背景 key（art brief）
  introduces?: string;     // 本关首次引入的机制（tutorial beat）
  tiers: Grade[];          // 本章可玩难度档
  mode: MatchMode;         // 本章默认模式
}

/* ---------------- 章节定义（critical path 顺序） ---------------- */

export const CHAPTERS: ChapterDef[] = [
  {
    id: 'amer',
    name: '美洲之旅',
    subtitle: '新大陆的羽毛与冰川',
    sequence: 1,
    pool: 'amer',
    narrativeBeat:
      '周爷爷的第一站是美洲。他说这里的钱都带着翅膀——鹦鹉、潜鸟、神鹰。我们先从最轻的两张开始。',
    grandpaNote: '在里约的清晨，一只金刚鹦鹉落在他肩头，他愣了半天，说「这鸟比我阔」。',
    sceneTheme: 'scene_amer',
    introduces: '翻牌→找相同 ISO 的核心循环 + 现实锚闪现',
    tiers: [1, 2, 3],
    mode: 'match',
  },
  {
    id: 'euro',
    name: '欧洲之旅',
    subtitle: '桥与窗，和不在任何地方的城',
    sequence: 2,
    pool: 'euro',
    narrativeBeat:
      '欧洲的钱最「客气」——桥是画出来的，谁都不偏心。但英镑上有个画家，叫透纳，他说「光就是色彩」。',
    grandpaNote: '他在阿姆斯特丹看了一晚上桥，回来在笔记本上画了三十座，没一座是真的。',
    sceneTheme: 'scene_euro',
    introduces: '母题 ≠ 币种（同 portrait 母题但不同币，靠 glyph 区分）',
    tiers: [1, 2, 3],
    mode: 'match',
  },
  {
    id: 'asia_afr',
    name: '亚非之旅',
    subtitle: '圣山、圣人与犀牛',
    sequence: 3,
    pool: 'asia_afr',
    narrativeBeat:
      '亚洲和非洲共用一本册子。这里的钱背面有山、有圣人、有犀牛——区域形状都是菱形，但每币的角标 glyph 都不一样。',
    grandpaNote: '他在奈良喂鹿，鹿比他熟路。他说「认路的不一定是人」。',
    sceneTheme: 'scene_asia_afr',
    introduces: '区域形状只分洲，币符(glyph)才分币（色弱通道）',
    tiers: [1, 2, 3],
    mode: 'match',
  },
  {
    id: 'world',
    name: '环球之旅',
    subtitle: '周爷爷没走完的路',
    sequence: 4,
    pool: 'all',
    narrativeBeat:
      '周爷爷的护照最后一页是空的。他说「剩下的路，你自己走」。这一章，钱不再成对出现——你要认出「谁属于谁」。',
    grandpaNote: '空页旁边他写：「地图是别人画的，路是自己走的」。',
    sceneTheme: 'scene_world',
    introduces:
      '从 3 对标准配对起手（初识环球），T3 升级为关联配对（货币 ↔ 母题 / 动物 / 景观）',
    tiers: [1, 2, 3],
    mode: 'match', // T3 运行时切 'associate'（见 chapterPlan）
  },
];

export function chapterById(id: ChapterId): ChapterDef {
  const c = CHAPTERS.find((x) => x.id === id);
  if (!c) throw new Error('unknown chapter: ' + id);
  return c;
}

/* ---------------- 币种池 ---------------- */

/** 取某章节的币种 ISO 池（region 过滤 or 全池） */
export function poolIsos(ch: ChapterDef): string[] {
  return ch.pool === 'all'
    ? CURRENCIES.map((c) => c.iso)
    : CURRENCIES.filter((c) => c.region === ch.pool).map((c) => c.iso);
}

/* ---------------- 对数推导（content-bound） ---------------- */

/**
 * 各章各档目标对数（与 levels 文档 §4 一致）：
 *   grade 1 初识：min(3, N)
 *   grade 2 环游：min(N, 18)
 *   grade 3 环球：单区 min(2N,18)（双副本）；环球池太大 → min(N,18) 但切关联模式
 */
function pairsForCount(N: number, grade: Grade): number {
  if (grade === 1) return Math.min(3, N);
  if (grade === 2) return Math.min(N, 18);
  // grade 3
  if (N <= 9) return Math.min(2 * N, 18); // 单区 6 → 12
  return Math.min(N, 18); // 环球 18 → 18（关联模式）
}

/**
 * 按对数选最近似方整网格（cols≥rows 给竖屏 coin；note 交换使横排更长）。
 * 优先精确填满（无空格焦虑），其次接近方整。
 */
export function gridForPairs(pairs: number, form: FormFactor): TierGrid {
  const cells = Math.max(1, pairs) * 2;
  let best = { cols: cells, rows: 1 };
  let bestScore = Infinity;
  for (let rows = 1; rows <= cells; rows++) {
    const cols = Math.ceil(cells / rows);
    if (cols * rows < cells) continue;
    const score = Math.abs(cols - rows) + (cols * rows - cells) * 4; // 空格惩罚更重
    if (score < bestScore) {
      bestScore = score;
      best = { cols, rows };
    }
  }
  if (form === 'note') return { cols: best.rows, rows: best.cols };
  return best;
}

/* ---------------- 组牌（复用 tierConfig 权重） ---------------- */

/**
 * 构建某章某档的组牌计划（纯函数）。
 * 与 tierConfig.planFor 的差别：对数由 pairsForCount 精确给出（内容绑定），
 * 而非固定 TIERS[tier].pairs —— 这样单区 6 币也能正确产出 3/6/12 对。
 */
function buildChapterPlan(
  isos: string[],
  grade: Grade,
  ctx: PlanContext
): { plan: PlanItem[]; pairs: number } {
  const N = isos.length;
  const pairs = pairsForCount(N, grade);
  const plan: PlanItem[] = [];

  if (pairs <= N) {
    // 子集：每 iso 1 对；grade1 用 isUnlocked 权重（未解锁优先）
    const weightOf = (iso: string) => (grade === 1 ? (ctx.isUnlocked(iso) ? 1 : 3) : 1);
    const chosen = pickWeighted(ctx.rng, isos, weightOf, pairs);
    for (const iso of chosen) plan.push({ iso, pairs: 1 });
  } else {
    // 双副本：每 iso 2 对；若 2N > 目标，优先把"最熟"(pips 高) 的降为 1 对，保持场上多为不熟币
    const all: PlanItem[] = isos.map((iso) => ({ iso, pairs: 2 }));
    const excess = 2 * N - pairs;
    if (excess > 0) {
      const toReduce = pickWeighted(
        ctx.rng,
        all.map((a) => a.iso),
        (iso) => 1 + ctx.pips(iso),
        excess
      );
      const reduceSet = new Set(toReduce);
      for (const a of all) if (reduceSet.has(a.iso)) a.pairs = 1;
    }
    plan.push(...all);
  }
  const total = plan.reduce((s, p) => s + p.pairs, 0);
  return { plan, pairs: total };
}

export interface ChapterPlanResult {
  plan: PlanItem[];
  grid: TierGrid;
  pairs: number;
  mode: MatchMode;
}

/**
 * 生成一个关卡的全部数据：组牌计划 + 网格 + 对数 + 模式。
 * 直接喂给 buildDeckPlan(plan, CURRENCIES, form) 即可开局。
 */
export function chapterPlan(
  id: ChapterId,
  grade: Grade,
  form: FormFactor,
  ctx: PlanContext
): ChapterPlanResult {
  const ch = chapterById(id);
  const isos = poolIsos(ch);
  const { plan, pairs } = buildChapterPlan(isos, grade, ctx);
  const grid = gridForPairs(pairs, form);
  const mode: MatchMode = id === 'world' && grade === 3 ? 'associate' : ch.mode;
  return { plan, grid, pairs, mode };
}

/* ---------------- 解锁链（no-fail 保底） ---------------- */

export interface ChapterProgress {
  plays: (chapter: ChapterId, grade: Grade) => number;
  bestStar: (chapter: ChapterId, grade: Grade) => number;
}

/** 章节是否解锁（itinerary 顺序 + 保底） */
export function isChapterOpen(id: ChapterId, p: ChapterProgress): boolean {
  if (id === 'amer') return true;
  if (id === 'euro') return p.plays('amer', 1) >= 1;
  if (id === 'asia_afr') return p.plays('euro', 1) >= 1;
  // world：任意 ≥2 个单区章完成 T2，或某单区 T2 累计 ≥3 局
  const single: ChapterId[] = ['amer', 'euro', 'asia_afr'];
  const doneT2 = single.filter((c) => p.plays(c, 2) >= 1).length;
  const anyHeavy = single.some((c) => p.plays(c, 2) >= 3);
  return doneT2 >= 2 || anyHeavy;
}

/** 章内难度档是否解锁 */
export function isGradeOpen(id: ChapterId, grade: Grade, p: ChapterProgress): boolean {
  if (grade === 1) return true;
  if (grade === 2) return isChapterOpen(id, p) && p.plays(id, 1) >= 1;
  // grade 3：需本章 T2 完成（环球关联 / 单区双副本）
  return p.plays(id, 2) >= 1;
}

/* ---------------- 关联模式钩子（环球 T3 · 审计创意 A） ---------------- */

export interface AssociationPair {
  iso: string;
  element: string; // 该币的母题标签（风格化，无真实钞币图）
}

/**
 * 关联模式卡组计划（纯函数，供 matchLogic 接入）。
 * 卡牌一半是「货币」，一半是「它的母题元素」，判定键 = (iso, element) 而非同 iso 直比。
 * matchLogic.evaluate 需支持注入 matchKeyOf(card)，本函数只产出配对数据。
 */
export function associationPlan(ctx: PlanContext, count = 9): AssociationPair[] {
  const isos = pickWeighted(
    ctx.rng,
    CURRENCIES.map((c) => c.iso),
    (iso) => (ctx.isUnlocked(iso) ? 1 : 3),
    count
  );
  return isos.map((iso) => {
    const c = CURRENCIES.find((x) => x.iso === iso)!;
    return { iso, element: c.motifLabel };
  });
}
