/**
 * render/layout.ts — 响应式布局计算（无 DOM，纯几何）
 *
 * 提供：
 *  - Rect 类型（贯穿渲染/命中）
 *  - boardLayout：4×4 卡牌 rect（coin 近方 / note 2:1 横排），含顶栏与安全区内边距
 *  - 简单按钮/文本排版辅助
 * 双形态：coin 卡片近正方形（竖屏友好）；note 卡片 2:1 横向（横屏友好）。
 */

import { FormFactor } from '../platform/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardLayout {
  topBar: Rect;
  cards: Rect[];      // cols*rows 个，row-major
  board: Rect;        // 整个棋盘外框（用于背景/边框）
  cellGap: number;
  /** 币外名称行高（note：cell 含名称行；coin：card.ts 内部自算，此值仅供透传） */
  nameH: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const PAD = 12;          // 基础外边距
const TOPBAR_H = 52;     // 顶栏高度
const GAP = 8;           // 卡间距（默认档）
const COLS = 4;
const ROWS = 4;

/**
 * 卡间距（Phase1 §4.3）：cols ≥ 6（T3）收到 6，给 cell 多留 ~4px；其余保持 8。
 * 作为小函数而非硬编码，便于后续档位扩展。
 */
export function gap(cols: number): number {
  return cols >= 6 ? 6 : GAP;
}

/**
 * 计算棋盘布局（coin=近方；note=2:1 横向）。
 * cols/rows 由档位表注入（Phase1 §4.3），缺省 4×4 保持既有行为兼容。
 */
export function boardLayout(
  vp: { w: number; h: number },
  safe: { top: number; right: number; bottom: number; left: number },
  form: FormFactor,
  cols: number = COLS,
  rows: number = ROWS
): BoardLayout {
  const COLS = Math.max(1, Math.floor(cols));
  const ROWS = Math.max(1, Math.floor(rows));
  const GAP = gap(COLS);
  const areaX = safe.left + PAD;
  const areaY = safe.top + PAD + TOPBAR_H;
  const areaW = vp.w - safe.left - safe.right - PAD * 2;
  const areaH = vp.h - areaY - safe.bottom - PAD;

  const topBar: Rect = {
    x: safe.left,
    y: safe.top,
    w: vp.w - safe.left - safe.right,
    h: TOPBAR_H,
  };

  let cardW: number;
  let cardH: number;
  let nameH = 0;
  if (form === 'coin') {
    // 近方：取行列较小约束（名称行在 card.ts 内部消化，cell 尺寸不变）
    const c = Math.min((areaW - GAP * (COLS - 1)) / COLS, (areaH - GAP * (ROWS - 1)) / ROWS);
    cardW = c;
    cardH = c;
  } else {
    // note 2:1（卡面硬比例）+ 币外名称行（coin-redesign-spec §B4）：
    // cell = faceH(2:1 卡面) + nameH；越界则按高反推并二次收敛（一轮即可，误差 < 1px）
    cardW = (areaW - GAP * (COLS - 1)) / COLS;
    nameH = clamp(cardW * 0.11, 11, 16);
    let faceH = cardW / 2;
    let cellH = faceH + nameH;
    if (cellH * ROWS + GAP * (ROWS - 1) > areaH) {
      cellH = (areaH - GAP * (ROWS - 1)) / ROWS;
      faceH = cellH - nameH;
      cardW = faceH * 2;
      nameH = clamp(cardW * 0.11, 11, 16);
      faceH = cellH - nameH;
      cardW = faceH * 2;
    }
    cardH = cellH; // rect.h 含名称行（命中区一并变高，对点按有利）
  }

  const boardW = cardW * COLS + GAP * (COLS - 1);
  const boardH = cardH * ROWS + GAP * (ROWS - 1);
  const originX = areaX + (areaW - boardW) / 2;
  const originY = areaY + Math.max(0, (areaH - boardH) / 2);

  const cards: Rect[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      cards.push({
        x: originX + c * (cardW + GAP),
        y: originY + r * (cardH + GAP),
        w: cardW,
        h: cardH,
      });
    }
  }

  return {
    topBar,
    cards,
    board: { x: originX, y: originY, w: boardW, h: boardH },
    cellGap: GAP,
    nameH,
  };
}

/** 命中判断：点是否在 rect 内 */
export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** 垂直居中排列一组等宽按钮（用于 Hub / 弹层） */
export function vstack(
  x: number,
  centerY: number,
  width: number,
  height: number,
  gap: number,
  count: number
): Rect[] {
  const totalH = height * count + gap * (count - 1);
  const startY = centerY - totalH / 2;
  const out: Rect[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ x, y: startY + i * (height + gap), w: width, h: height });
  }
  return out;
}

/** 水平分段（用于 Hub 形态选择 coin/note） */
export function hstack(
  x: number,
  y: number,
  width: number,
  height: number,
  gap: number,
  count: number
): Rect[] {
  const totalW = width * count + gap * (count - 1);
  const startX = x - totalW / 2;
  const out: Rect[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: startX + i * (width + gap), y, w: width, h: height });
  }
  return out;
}
