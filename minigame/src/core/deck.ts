/**
 * deck.ts — 发牌 / 洗牌（纯函数，无 cc 依赖，可在 Node 单测）
 * 来源：mvp/game.js buildBoardDom + shuffle（可玩设计契约）
 *
 * 关键不变量：每 ISO 恰好出现 2 次 → 16 张卡（8 对），判定键仅 iso_code。
 */

import { Card, Currency, FormFactor } from './types';

/** 解锁实体键 = (iso, form)（GDD §0.5） */
export function entityKey(iso: string, form: FormFactor): string {
  return iso + '_' + form;
}

function makeCard(c: Currency, form: FormFactor, idx: number): Card {
  return {
    id: 'c' + idx,
    iso: c.iso,
    form,
    region: c.region,
    signature: c.signature,
    motif: c.motif,
    motifLabel: c.motifLabel,
    glyph: c.glyph,
    denom: c.denom,
    denomSymbol: c.denomSymbol,
    anchor: c.anchor,
    state: 'face_down',
  };
}

/**
 * 按组牌计划发牌（Phase1 §4.1）：plan 中每项 { iso, pairs } 推 pairs*2 张，随后 Fisher–Yates 洗牌。
 * plan 中未在 currencies 里找到的 iso 直接跳过（防御）；pairs ≤0 亦跳过。
 * 同 iso 允许多副本（T3），判定仍是 iso 直比 → 任意两张同 iso 即配对成功。
 */
export function buildDeckPlan(
  plan: { iso: string; pairs: number }[],
  currencies: Currency[],
  form: FormFactor
): Card[] {
  const deck: Card[] = [];
  for (const item of plan) {
    const c = currencies.find((x) => x.iso === item.iso);
    if (!c) continue;
    const n = Math.floor(item.pairs);
    for (let i = 0; i < n; i++) {
      deck.push(makeCard(c, form, deck.length));
      deck.push(makeCard(c, form, deck.length));
    }
  }
  return shuffle(deck);
}

/**
 * 构建一副牌：每个币种推 2 张（按 form 决定物理形态），随后 Fisher–Yates 洗牌。
 * 现为 buildDeckPlan 的「每 iso 恰 1 对」全量特例（T2 档），保留导出以兼容既有调用点。
 * 返回新数组，不修改入参。
 */
export function buildDeck(currencies: Currency[], form: FormFactor): Card[] {
  return buildDeckPlan(
    currencies.map((c) => ({ iso: c.iso, pairs: 1 })),
    currencies,
    form
  );
}

/** Fisher–Yates 洗牌（原地但返回同一引用；调用方已持有新数组） */
export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * 校验发牌正确性（供单测与运行时自检，纯函数；Phase1 §5.1 参数化）。
 *
 * 不变量（替代原「恰 16 张 / 每 ISO 恰 2 张」硬编码）：
 *  - 传 expectedPairs → 总张数必须 === expectedPairs*2；不传 → 总张数 >0 且为偶数；
 *  - 每 ISO 张数为偶数且 ≥2（允许 T3 的 4/6 张多副本）。
 */
export function validateDeck(
  cards: Card[],
  expectedPairs?: number
): { ok: boolean; total: number; perIso: Record<string, number> } {
  const perIso: Record<string, number> = {};
  for (const c of cards) perIso[c.iso] = (perIso[c.iso] || 0) + 1;
  const total = cards.length;
  const totalOk =
    expectedPairs !== undefined ? total === expectedPairs * 2 : total > 0 && total % 2 === 0;
  const perIsoOk = Object.keys(perIso).every((k) => perIso[k] % 2 === 0 && perIso[k] >= 2);
  return { ok: totalOk && perIsoOk, total, perIso };
}
