/**
 * tierConfig.ts — 难度阶梯档位表 + 加权抽取（Phase1 §4，纯函数，可 Node 单测）
 *
 * 8 币自洽、零新内容：靠「对数 / 网格 / 组牌规则」三件套拉开难度。
 *   T1 初识 3 对（6 张）  — 从 8 币加权抽 3 种，每种 1 对（未解锁权重 ×3 → 新面孔优先）
 *   T2 环游 8 对（16 张） — 全 8 币各 1 对（= 原有局）
 *   T3 环球 18 对（36 张）— 全 8 币各 2 对 + 加权抽 2 币各再 +1 对（越不熟越常出现）
 *
 * 判定不变：matchKey 仍是 iso 直比；同 iso 多副本时任意两张即配对成功，
 * matchedCount / isWin 现有逻辑零改动即正确（Phase1 §4.1）。
 * 发牌新不变量：每 ISO 张数为偶数且 ≥2，总张数 = 2P（§4.2）。
 */

import { FormFactor } from './types';

/** 档位 ID */
export type TierId = 1 | 2 | 3;

export const TIER_IDS: TierId[] = [1, 2, 3];

export interface TierGrid {
  cols: number;
  rows: number;
}

export interface TierDef {
  id: TierId;
  /** 档位名（Hub 按钮主标题用） */
  name: string;
  /** 本档总对数 P */
  pairs: number;
  /** 每形态网格（coin 竖屏 / note 横屏，Phase1 §4.1） */
  grid: Record<FormFactor, TierGrid>;
  /** 每 iso 的基础对数（T3 = 2，其余 = 1） */
  basePairsPerIso: number;
  /** 在基础之上再加权抽多少个 iso 各 +1 对（T3 = 2） */
  bonusPicks: number;
  /** 限定只抽 N 个 iso 参与（T1 = 3；0 = 全部 iso 参与） */
  limitIsos: number;
}

/**
 * 档位表。
 * T3 note 同样开放 6×6（决策 Q1 = 选项 A：接受横屏 note 卡偏小，playtest 后再收）。
 */
export const TIERS: Record<TierId, TierDef> = {
  1: {
    id: 1,
    name: '初识',
    pairs: 3,
    grid: { coin: { cols: 2, rows: 3 }, note: { cols: 3, rows: 2 } },
    basePairsPerIso: 1,
    bonusPicks: 0,
    limitIsos: 3,
  },
  2: {
    id: 2,
    name: '环游',
    pairs: 8,
    grid: { coin: { cols: 4, rows: 4 }, note: { cols: 4, rows: 4 } },
    basePairsPerIso: 1,
    bonusPicks: 0,
    limitIsos: 0,
  },
  3: {
    id: 3,
    name: '环球',
    pairs: 18,
    grid: { coin: { cols: 6, rows: 6 }, note: { cols: 6, rows: 6 } },
    basePairsPerIso: 2,
    bonusPicks: 2,
    limitIsos: 0,
  },
};

/** 安全取档位定义（越界夹到 T1） */
export function tierDef(tier: TierId): TierDef {
  return TIERS[tier] ?? TIERS[1];
}

/** 取某档某形态的网格 */
export function gridFor(tier: TierId, form: FormFactor): TierGrid {
  return tierDef(tier).grid[form];
}

/**
 * 按权重无放回抽 n 个（纯函数，rng 注入 → 可测）。
 * - weightOf 返回值 ≤0 视为 0（该项仅在候选不足时才可能被兜底选中）。
 * - n ≥ items.length 时返回全部（顺序为抽取顺序）。
 * - 不修改入参数组。
 */
export function pickWeighted<T>(
  rng: () => number,
  items: T[],
  weightOf: (item: T) => number,
  n: number
): T[] {
  const pool = items.slice();
  const out: T[] = [];
  const take = Math.min(n, pool.length);
  for (let k = 0; k < take; k++) {
    let total = 0;
    for (let i = 0; i < pool.length; i++) total += Math.max(0, weightOf(pool[i]));
    let idx = pool.length - 1;
    if (total > 0) {
      let r = rng() * total;
      for (let i = 0; i < pool.length; i++) {
        r -= Math.max(0, weightOf(pool[i]));
        if (r < 0) {
          idx = i;
          break;
        }
      }
    } else {
      // 全零权重 → 退化为均匀抽取（保证仍能凑够张数）
      idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    }
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

/** 组牌计划项：某 iso 出 pairs 对（= pairs*2 张） */
export interface PlanItem {
  iso: string;
  pairs: number;
}

/** 组牌上下文（全部由调用方注入 → tierConfig 保持纯函数、可脱离 store 单测） */
export interface PlanContext {
  /** 随机源，注入以便测试 */
  rng: () => number;
  /** 该 iso 在当前形态下是否已解锁（T1 加权：未解锁权重 3、已解锁 1） */
  isUnlocked: (iso: string) => boolean;
  /** 该 iso 的 mastery pips 0–3（T3 加权：w = 4 - pips，越不熟越常出现） */
  pips: (iso: string) => number;
}

/** T1 权重：未解锁 ×3，把「发现感」还给前几局（§4.1） */
export function t1Weight(iso: string, ctx: PlanContext): number {
  return ctx.isUnlocked(iso) ? 1 : 3;
}

/** T3 加抽权重：w = 4 - min(3, pips)，服务学习（§4.1） */
export function t3Weight(iso: string, ctx: PlanContext): number {
  return 4 - Math.min(3, Math.max(0, ctx.pips(iso)));
}

/**
 * 生成某档的组牌计划（纯函数）。
 * 返回 PlanItem[]，满足 sum(pairs) === TIERS[tier].pairs（isos 数量足够时）。
 */
export function planFor(tier: TierId, isos: string[], ctx: PlanContext): PlanItem[] {
  const def = tierDef(tier);
  // ① 选参与的 iso 集合
  const chosen =
    def.limitIsos > 0
      ? pickWeighted(ctx.rng, isos, (iso) => t1Weight(iso, ctx), def.limitIsos)
      : isos.slice();

  // ② 基础对数
  const plan: PlanItem[] = chosen.map((iso) => ({ iso, pairs: def.basePairsPerIso }));

  // ③ 加权加抽 +1 对（T3）
  if (def.bonusPicks > 0 && plan.length > 0) {
    const bonus = pickWeighted(ctx.rng, chosen, (iso) => t3Weight(iso, ctx), def.bonusPicks);
    for (const iso of bonus) {
      const item = plan.find((p) => p.iso === iso);
      if (item) item.pairs += 1;
    }
  }
  return plan;
}

/* ---------------- 解锁条件（§4.4 双通道，no-fail 保底） ---------------- */

/** 解锁判定所需的进度快照（由 metaStore 提供，保持本模块纯净） */
export interface TierProgress {
  /** 各档累计完成局数 */
  plays: (tier: TierId) => number;
  /** 该档两形态中的最佳星（0 = 从未完成） */
  bestStar: (tier: TierId) => number;
}

/**
 * 档位是否已解锁（全局，不分形态 → 减少门槛感）：
 *   T1 始终开放
 *   T2 T1 累计完成 ≥ 1 局
 *   T3 T2 最佳星 ≥ 2 **或** T2 累计完成 ≥ 3 局（星评通道奖励 mastery，局数通道是保底）
 */
export function isTierUnlocked(tier: TierId, p: TierProgress): boolean {
  if (tier === 1) return true;
  if (tier === 2) return p.plays(1) >= 1;
  return p.bestStar(2) >= 2 || p.plays(2) >= 3;
}

/** 未解锁时的轻提示文案（点击锁定按钮弹 toast，§4.5） */
export function lockHintFor(tier: TierId): string {
  const prev = tier === 3 ? TIERS[2] : TIERS[1];
  return `先完成「${prev.name}」一局吧`;
}
