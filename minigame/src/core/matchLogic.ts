/**
 * matchLogic.ts — 翻牌 / 配对判定 / 输入锁 / 连击计分（纯函数，无 cc/DOM 依赖）
 * 来源：mvp/game.js onCardClick/judge（可玩设计契约）
 * 对齐 GDD §1.②：判定仅比 iso_code；连击公式 round(100*(1+0.5*combo_before))；MISMATCH_FLIPBACK_MS=800。
 *
 * 设计：所有函数返回「新状态」而非就地修改，便于 Node 单测与不可变推理。
 * 控制流：flip →（第 2 张）→ evaluate → 成功直接结算 / 失败保持 lock + 计时器调 flipBack。
 */

import { Card, MatchState } from './types';

/** 错配翻回延迟（ms），由 BoardController/MatchController 计时（GDD §1.②） */
export const MISMATCH_FLIPBACK_MS = 800;

/** 单局失败反馈不计分、无失败态；combo 仅做奖励放大 */

/** 配对得分：combo_before = 本次配对前的连续成功数（GDD §1.②） */
export function scoreFor(comboBefore: number): number {
  return Math.round(100 * (1 + 0.5 * comboBefore));
}

/** 建立空会话状态（cards 已洗好） */
export function createMatchState(cards: Card[]): MatchState {
  return {
    cards,
    flipped: [],
    lock: false,
    matchedCount: 0,
    score: 0,
    combo: 0,
    sessionUnlocked: [],
    mismatches: 0,
  };
}

/**
 * 翻一张卡。返回新状态。
 * 输入锁生效 / 卡非 face_down（防同卡重复点）/ 不存在 → 原样返回（忽略）。
 */
export function flip(state: MatchState, cardId: string): MatchState {
  if (state.lock) return state;
  const card = state.cards.find((c) => c.id === cardId);
  if (!card || card.state !== 'face_down') return state;

  const flipped = state.flipped.concat([card]);
  const cards = state.cards.map((c) =>
    c.id === cardId ? { ...c, state: 'face_up' as const } : c
  );
  const lock = flipped.length === 2;
  return { ...state, cards, flipped, lock };
}

export interface MatchResult {
  matched: boolean;
  gained: number;        // 本次得分增量（错配为 0）
  comboBefore: number;
  comboAfter: number;
  complete: boolean;     // 是否胜利（全部配对）
}

/**
 * 评估当前两张已翻卡（flipped.length === 2）。
 * - 相同 iso → matched 常驻、score += scoreFor(comboBefore)、combo+1、matchedCount+1、清 flipped、解锁 lock。
 * - 不同 → combo 清零、lock 保持 true（等待 flipBack 计时翻回）、flipped 保留。
 * 不足 2 张 → 原样返回（no-op），matched=false。
 */
export function evaluate(state: MatchState): { state: MatchState; result: MatchResult } {
  if (state.flipped.length < 2) {
    return {
      state,
      result: { matched: false, gained: 0, comboBefore: state.combo, comboAfter: state.combo, complete: false },
    };
  }
  const [a, b] = state.flipped;
  const comboBefore = state.combo;

  if (a.iso === b.iso) {
    const gained = scoreFor(comboBefore);
    const cards = state.cards.map((c) =>
      c.id === a.id || c.id === b.id ? { ...c, state: 'matched' as const } : c
    );
    const next: MatchState = {
      ...state,
      cards,
      flipped: [],
      lock: false,
      matchedCount: state.matchedCount + 1,
      score: state.score + gained,
      combo: comboBefore + 1,
    };
    return {
      state: next,
      result: { matched: true, gained, comboBefore, comboAfter: comboBefore + 1, complete: isWin(next) },
    };
  }

  // 错配：清零连击，保持 lock（计时器到点后调 flipBack）；mismatches+1 供星评（Phase1 §2.2）
  const next: MatchState = { ...state, lock: true, combo: 0, mismatches: state.mismatches + 1 };
  return {
    state: next,
    result: { matched: false, gained: 0, comboBefore, comboAfter: 0, complete: false },
  };
}

/**
 * 错配翻回：将 flipped 的两张翻回 face_down，清队列、解输入锁。
 * 由计时器在 MISMATCH_FLIPBACK_MS 后调用。
 */
export function flipBack(state: MatchState): MatchState {
  if (state.flipped.length === 0) return state;
  const ids = new Set(state.flipped.map((c) => c.id));
  const cards = state.cards.map((c) =>
    ids.has(c.id) ? { ...c, state: 'face_down' as const } : c
  );
  return { ...state, cards, flipped: [], lock: false };
}

/** 胜利：全部配对完成（无失败态） */
export function isWin(state: MatchState): boolean {
  const totalPairs = state.cards.length / 2;
  return totalPairs > 0 && state.matchedCount >= totalPairs;
}
