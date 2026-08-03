/**
 * render/detail.ts — 货币详情（S5）视图（纯 Canvas 2D，无 DOM，纯阅读态）
 *
 * 展示：四层识别码（区域形状 / 币符 glyph / 母题色 / 文本）+ 现实锚 + 双形态槽 + 文化占位。
 * 合规：无「加入收藏」按钮；未解锁条目不可进入（App.openDetail 已拦截）。
 */

import type { App } from '../app/app';
import { Ctx2DLike, SafeAreaInsets, Region } from '../platform/types';
import { THEME, text, drawButton, REGION_COLORS, fitText, wrapText, withElevation, drawPanelSeam } from './theme';
import { Rect } from './layout';
import { drawCard } from './card';
import { CardVisual } from './types';
import { drawGlyph } from './glyph';
import { REGION_LABELS, REGION_STYLE, GLYPH_LABELS } from '../data/currencies';

export function drawDetail(
  app: App,
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  safe: SafeAreaInsets,
  hits: { rect: Rect; action: () => void }[]
): void {
  const iso = app.detailIso;
  if (!iso) return;
  const c = app.currency(iso);
  if (!c) return;

  // 门控：详情页仅在 isCollected（任一形态解锁）时可进入（见 app.openDetail），
  // 故下方 Tier1 区块（正面/反面母题、文化发现、周爷爷纸条）必然可见；
  // 仅 Tier2 的「历史版本」需按 isComplete（coin+note 双形态齐全）判定。
  const complete = app.store.isComplete(c.iso);

  // 固定头
  const backRect: Rect = { x: safe.left + 8, y: safe.top + 8, w: 84, h: 36 };
  drawButton(ctx, backRect, '‹ 图鉴', { fontSize: 13 });
  hits.push({ rect: backRect, action: () => app.openCodex() });
  fitText(ctx, c.name, vp.w / 2, safe.top + 28, {
    align: 'center',
    size: 22,
    weight: 'bold',
    maxWidth: vp.w - safe.left - safe.right - 24,
  });

  const areaX = safe.left + 14;
  const areaW = vp.w - safe.left - safe.right - 28;
  const headerBottom = safe.top + 56;
  const cardSize = Math.min(120, areaW * 0.36);

  // deco_globe 中心水印（scene-backgrounds-spec §2.5）：背景层，固定屏幕坐标（不随滚动）
  const deco = app.getDeco();
  if (deco) {
    const size = vp.w * 0.62;
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.drawImage(deco, vp.w / 2 - size / 2, vp.h * 0.55 - size / 2, size, size);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 聚焦压暗（scene-backgrounds-spec §2.4/§4.6）：圆心 = 身份大卡中心，
  // 用未加 codexScroll 偏移的固定屏幕坐标 → 必须画在 translate 之前，不随内容滚动。
  {
    const fx = areaX + cardSize / 2;
    const fy = headerBottom + cardSize / 2;
    const diag = Math.sqrt(vp.w * vp.w + vp.h * vp.h);
    const fg = ctx.createRadialGradient(fx, fy, cardSize * 1.25, fx, fy, diag);
    fg.addColorStop(0, 'rgba(58,58,56,0)');
    fg.addColorStop(1, 'rgba(58,58,56,0.22)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, vp.w, vp.h);
  }

  ctx.save();
  ctx.translate(0, app.codexScroll);

  let y = headerBottom;
  const fontBase = '"Noto Sans SC", "PingFang SC", sans-serif';

  // —— 身份卡 + 基础信息 ——
  const coinVisual: CardVisual = {
    iso: c.iso,
    name: c.name,
    region: c.region,
    signature: c.signature,
    motif: c.motif,
    glyph: c.glyph,
    denom: c.denom,
    denomSymbol: c.denomSymbol,
    form: 'coin',
  };
  drawCard(ctx, {
    rect: { x: areaX, y, w: cardSize, h: cardSize },
    visual: coinVisual,
    faceUp: true,
    image: app.imageFor(c.iso, 'coin'),
  });
  const infoX = areaX + cardSize + 14;
  fitText(ctx, c.iso + ' · ' + c.denom + ' ' + c.denomSymbol, infoX, y + 22, {
    align: 'left',
    baseline: 'middle',
    size: 18,
    weight: 'bold',
    maxWidth: areaX + areaW - infoX,
  });
  text(ctx, '区域：' + REGION_LABELS[c.region], infoX, y + 50, {
    align: 'left',
    baseline: 'middle',
    size: 13,
    color: THEME.lockedInk,
  });
  text(ctx, '母题：' + c.motifLabel + '　币符：' + GLYPH_LABELS[c.glyph], infoX, y + 72, {
    align: 'left',
    baseline: 'middle',
    size: 13,
    color: THEME.lockedInk,
  });
  y += cardSize + 18;

  // —— 四层识别码 ——
  sectionTitle(ctx, '四层识别码', areaX, y, areaW);
  y += 26;
  const layerLineH = 24;
  // ① 区域
  drawDot(ctx, areaX + 8, y + layerLineH / 2, 7, REGION_COLORS[c.region]);
  text(ctx, `① 区域 · ${REGION_LABELS[c.region]}（${REGION_STYLE[c.region].shape}）`, areaX + 24, y + layerLineH / 2, {
    align: 'left',
    baseline: 'middle',
    size: 14,
  });
  y += layerLineH;
  // ② 币符（每币唯一几何，色弱模式下的主通道）
  drawGlyph(ctx, c.glyph, areaX + 8, y + layerLineH / 2, 7, THEME.ink);
  text(ctx, `② 币符 · ${GLYPH_LABELS[c.glyph]}`, areaX + 24, y + layerLineH / 2, {
    align: 'left',
    baseline: 'middle',
    size: 14,
  });
  y += layerLineH;
  // ③ 母题色
  drawDot(ctx, areaX + 8, y + layerLineH / 2, 7, c.signature);
  text(ctx, `③ 母题色 · ${c.signature}`, areaX + 24, y + layerLineH / 2, {
    align: 'left',
    baseline: 'middle',
    size: 14,
  });
  y += layerLineH;
  // ④ 文本（ISO + 面额）
  text(ctx, `④ 文本 · ${c.iso} / ${c.denom} ${c.denomSymbol}`, areaX + 24, y + layerLineH / 2, {
    align: 'left',
    baseline: 'middle',
    size: 14,
  });
  y += layerLineH + 10;

  // —— 现实锚 ——
  sectionTitle(ctx, '现实锚', areaX, y, areaW);
  y += 24;
  const anchorLines = wrapText(ctx, c.anchor, areaW - 24, `13px ${fontBase}`);
  const anchorH = anchorLines.length * 20 + 16;
  // 景深 E1（静置面板）+ 手账缝线（§6.3 / §6.4）
  const anchorRect: Rect = { x: areaX, y, w: areaW, h: anchorH };
  withElevation(ctx, 'E1', anchorH, () => roundRectFill(ctx, anchorRect, THEME.panel, 10));
  drawPanelSeam(ctx, anchorRect, 10, 5);
  anchorLines.forEach((ln, i) => {
    text(ctx, ln, areaX + 12, y + 14 + i * 20, { align: 'left', baseline: 'middle', size: 13 });
  });
  y += anchorH + 12;

  // —— 双形态槽 ——
  sectionTitle(ctx, '双形态槽', areaX, y, areaW);
  y += 24;
  const slotH = 64;
  const coinW = slotH;
  const noteW = slotH * 2;
  const gap = 16;
  const coinX = areaX;
  const noteX = coinX + coinW + gap;
  const noteVisual: CardVisual = { ...coinVisual, form: 'note' };
  drawCard(ctx, { rect: { x: coinX, y, w: coinW, h: slotH }, visual: coinVisual, faceUp: app.store.isUnlocked(c.iso, 'coin'), locked: !app.store.isUnlocked(c.iso, 'coin'), image: app.imageFor(c.iso, 'coin') });
  drawCard(ctx, { rect: { x: noteX, y, w: noteW, h: slotH }, visual: noteVisual, faceUp: app.store.isUnlocked(c.iso, 'note'), locked: !app.store.isUnlocked(c.iso, 'note'), image: app.imageFor(c.iso, 'note') });
  text(ctx, '硬币', coinX + coinW / 2, y + slotH + 14, { align: 'center', baseline: 'middle', size: 11, color: THEME.lockedInk });
  text(ctx, '纸币', noteX + noteW / 2, y + slotH + 14, { align: 'center', baseline: 'middle', size: 11, color: THEME.lockedInk });
  y += slotH + 28;

  // —— 正面 · 母题（Tier1，isCollected 即可见；本页进入即已 collected）——
  sectionTitle(ctx, '正面 · 母题', areaX, y, areaW);
  y += 24;
  y = drawTextPanel(ctx, areaX, y, areaW, fontBase, c.frontMotif);

  // —— 反面 · 母题（Tier1，同上门控）——
  sectionTitle(ctx, '反面 · 母题', areaX, y, areaW);
  y += 24;
  y = drawTextPanel(ctx, areaX, y, areaW, fontBase, c.backMotif);

  // —— 文化发现（Tier1，discoveryLine 已按 §3 扩写）——
  sectionTitle(ctx, '文化发现', areaX, y, areaW);
  y += 24;
  y = drawTextPanel(ctx, areaX, y, areaW, fontBase, c.discoveryLine);

  // —— 历史版本（Tier2，isComplete 双形态齐全才可见；否则画虚线空面板占位，
  //     把"集齐硬币+纸币"转成可见动机，避免纯隐藏浪费 §1.2 的设计决策）——
  sectionTitle(ctx, '历史版本', areaX, y, areaW);
  y += 24;
  if (complete) {
    y = drawTextPanel(ctx, areaX, y, areaW, fontBase, c.historyNote ?? '');
  } else {
    y = drawDashedPanel(ctx, areaX, y, areaW, fontBase, '集齐这枚的硬币与纸币，这里会多一段故事。');
  }

  // —— 周爷爷的纸条（Tier2；现状：图鉴条目可开启即显示，与 dialogue 系统一致）——
  sectionTitle(ctx, '周爷爷的纸条', areaX, y, areaW);
  y += 24;
  y = drawTextPanel(ctx, areaX, y, areaW, fontBase, c.grandpaNote);

  ctx.restore();

  const areaH = vp.h - headerBottom - safe.bottom;
  app.codexScrollMin = Math.min(0, areaH - (y - headerBottom));
}

function sectionTitle(ctx: Ctx2DLike, label: string, x: number, y: number, w: number): void {
  text(ctx, label, x, y + 10, { align: 'left', baseline: 'middle', size: 15, weight: 'bold', color: THEME.terracotta });
  ctx.strokeStyle = THEME.panelLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 20);
  ctx.lineTo(x + w, y + 20);
  ctx.stroke();
}

function drawDot(ctx: Ctx2DLike, cx: number, cy: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function roundRectFill(ctx: Ctx2DLike, r: Rect, color: string, radius: number): void {
  const rr = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.lineTo(r.x + r.w - rr, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + rr, rr);
  ctx.lineTo(r.x + r.w, r.y + r.h - rr);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x + r.w - rr, r.y + r.h, rr);
  ctx.lineTo(r.x + rr, r.y + r.h);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y + r.h - rr, rr);
  ctx.lineTo(r.x, r.y + rr);
  ctx.arcTo(r.x, r.y, r.x + rr, r.y, rr);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function roundRectStroke(ctx: Ctx2DLike, r: Rect, radius: number): void {
  const rr = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.lineTo(r.x + r.w - rr, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + rr, rr);
  ctx.lineTo(r.x + r.w, r.y + r.h - rr);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x + r.w - rr, r.y + r.h, rr);
  ctx.lineTo(r.x + rr, r.y + r.h);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y + r.h - rr, rr);
  ctx.lineTo(r.x, r.y + rr);
  ctx.arcTo(r.x, r.y, r.x + rr, r.y, rr);
  ctx.closePath();
  ctx.stroke();
}

// 文本面板：wrapText → 算高 → 景深 E1 + 手账缝线 → 逐行 text。返回新的 y。
function drawTextPanel(
  ctx: Ctx2DLike,
  x: number,
  y: number,
  w: number,
  fontBase: string,
  body: string
): number {
  const padX = 12;
  const padTop = 14;
  const lineH = 20;
  const lines = wrapText(ctx, body, w - padX * 2, `13px ${fontBase}`);
  const h = lines.length * lineH + 16;
  const r: Rect = { x, y, w, h };
  withElevation(ctx, 'E1', h, () => roundRectFill(ctx, r, THEME.panel, 10));
  drawPanelSeam(ctx, r, 10, 5);
  lines.forEach((ln, i) => {
    text(ctx, ln, x + padX, y + padTop + i * lineH, { align: 'left', baseline: 'middle', size: 13 });
  });
  return y + h + 12;
}

// 未解锁占位：虚线空面板 + 占位文案（§6，historyNote 未 isComplete 时）。返回新的 y。
function drawDashedPanel(
  ctx: Ctx2DLike,
  x: number,
  y: number,
  w: number,
  fontBase: string,
  body: string
): number {
  const padX = 12;
  const lineH = 20;
  const lines = wrapText(ctx, body, w - padX * 2, `13px ${fontBase}`);
  const h = Math.max(56, lines.length * lineH + 24);
  ctx.save();
  ctx.strokeStyle = THEME.panelLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  roundRectStroke(ctx, { x, y, w, h }, 10);
  ctx.setLineDash([]);
  ctx.restore();
  const startY = y + h / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((ln, i) => {
    text(ctx, ln, x + padX, startY + i * lineH, { align: 'left', baseline: 'middle', size: 13, color: THEME.lockedInk });
  });
  return y + h + 12;
}
