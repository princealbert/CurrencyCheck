/**
 * starRating.ts — 无失败星评（Phase1 §2.2，纯函数，可 Node 单测）
 *
 * 哲学：完成即胜利，星评是「只加不罚」的 mastery 信号。
 * 最低 1⭐（完成即得），永远不出现 0⭐ / 失败字样（no-fail 红线）。
 *
 *   stars(m, P) = 3  若 m ≤ ceil(P × STAR_K3)
 *               = 2  若 m ≤ ceil(P × STAR_K2)
 *               = 1  其余
 *
 * m = 本局错配次数（MatchState.mismatches）；P = 本局总对数。
 * 用 mismatches 而非 moves：对玩家可解释（「记错了几次」）且不惩罚慢玩（无时间项）。
 */

/** 3⭐ 阈值系数 [TUNABLE·待 playtest]（Phase1 §2.2，T1/T2 通用） */
export const STAR_K3 = 0.5;
/**
 * T3 专用 3⭐ 阈值系数（已收紧 0.5 → 0.35）。
 * 理由：T3 引入同 iso 多副本，「乱撞也能撞上」的概率显著高于 T1/T2，
 * 沿用 0.5 会让 3⭐ 变成保底而非 mastery 信号。
 * 效果：T3 pairs=18 → ceil(18×0.35)=7，3⭐ 需 m≤7（原 ceil(9)=9，即 m≤9）。
 */
export const STAR_K3_T3 = 0.35;
/** 2⭐ 阈值系数 [TUNABLE·待 playtest]（各档统一，未收紧） */
export const STAR_K2 = 1.25;

/** 星评档位：1–3，恒 ≥1（no-fail） */
export type Stars = 1 | 2 | 3;

/**
 * 档位标识：兼容工程内的数字 TierId（1|2|3）与文档口径的字符串（'T1'|'T2'|'T3'）。
 * 这里不 import TierId，保持 starRating 为零依赖纯函数模块（可直接在 Node 断言）。
 */
export type StarTier = 1 | 2 | 3 | 'T1' | 'T2' | 'T3';

/** 取该档位的 3⭐ 系数：仅 T3 收紧，其余沿用 STAR_K3 */
function k3For(tier?: StarTier): number {
  return tier === 3 || tier === 'T3' ? STAR_K3_T3 : STAR_K3;
}

/**
 * 计算局末星评。
 * @param mismatches 本局错配次数（负值/非有限值按 0 处理）
 * @param pairs 本局总对数（≤0 视为无效局，返回 1⭐ 保底）
 * @param tier 档位；缺省 = 旧行为（K3=0.5），保证既有调用点向后兼容
 */
export function starsFor(mismatches: number, pairs: number, tier?: StarTier): Stars {
  const m = Number.isFinite(mismatches) ? Math.max(0, Math.floor(mismatches)) : 0;
  const p = Number.isFinite(pairs) ? Math.floor(pairs) : 0;
  if (p <= 0) return 1;
  if (m <= Math.ceil(p * k3For(tier))) return 3;
  if (m <= Math.ceil(p * STAR_K2)) return 2;
  return 1;
}
