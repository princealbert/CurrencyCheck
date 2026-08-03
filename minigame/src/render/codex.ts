/**
 * render/codex.ts — 图鉴（S3）视图（纯 Canvas 2D，无 DOM）
 *
 * 3 区域书架（美洲 / 欧洲 / 亚洲·非洲），每架显示「完整 X/Y」；
 * 每币种条目含 coin / note 双形态槽（未解锁=灰色剪影+「?」）；
 * 已解锁条目（任一形态）整卡可点入 S5 详情。纵向滚动（codexScroll）。
 */

import type { App } from '../app/app';
import { Ctx2DLike, SafeAreaInsets, Region } from '../platform/types';
import { THEME, text, drawButton, fitText, withShadow, REGION_COLORS, roundRectPath, drawStar } from './theme';
import { Rect } from './layout';
import { drawCard } from './card';
import { CardVisual } from './types';
import { CURRENCIES, REGION_LABELS } from '../data/currencies';
import { TOTAL_STARS } from '../core/metaStore';

/**
 * §2.5 展示位 3：单元格右下角 mastery pips（3 点，直径 4px，间距 3px）。
 * 已达成里程碑 = 区域色实心；未达成 = 灰描边空心。累计制、只增不减。
 */
function drawMasteryPips(ctx: Ctx2DLike, rect: Rect, region: Region, pips: number): void {
  const d = 4;
  const gap = 3;
  const totalW = d * 3 + gap * 2;
  const cy = rect.y + rect.h - 10;
  const x0 = rect.x + rect.w - 8 - totalW + d / 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x0 + i * (d + gap), cy, d / 2, 0, Math.PI * 2);
    if (i < pips) {
      ctx.fillStyle = REGION_COLORS[region];
      ctx.fill();
    } else {
      ctx.strokeStyle = THEME.locked;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function drawCodexCell(
  app: App,
  ctx: Ctx2DLike,
  rect: Rect,
  iso: string,
  region: Region,
  signature: string,
  motif: any,
  denom: string,
  denomSymbol: string,
  collected: boolean,
  hits: { rect: Rect; action: () => void }[],
  scroll: number,
  vp: { w: number; h: number }
): void {
  // 单元格背景（带柔和投影）
  const r = Math.min(rect.h * 0.08, 10);
  withShadow(ctx, THEME.shadow, Math.max(4, rect.h * 0.08), 2, () => {
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, r);
    ctx.fillStyle = THEME.panel;
    ctx.fill();
  });
  ctx.lineWidth = 1;
  ctx.strokeStyle = THEME.panelLine;
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, r);
  ctx.stroke();

  // 左侧 4px 区域色强调竖条（clip 到圆角内，避免溢出圆角）
  ctx.save();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, r);
  ctx.clip();
  ctx.fillStyle = REGION_COLORS[region];
  ctx.fillRect(rect.x, rect.y, 4, rect.h);
  ctx.restore();

  const pad = 8;
  const c = CURRENCIES.find((x) => x.iso === iso)!;
  fitText(ctx, collected ? `${c.name} · ${c.iso}` : '未发现', rect.x + pad, rect.y + 16, {
    align: 'left',
    baseline: 'middle',
    size: 14,
    weight: 'bold',
    color: collected ? THEME.ink : THEME.lockedInk,
    maxWidth: rect.w - pad * 2,
  });

  // 双形态槽
  const slotH = rect.h * 0.4;
  const coinW = slotH;
  const noteW = slotH * 2;
  const slotY = rect.y + 28;
  const coinX = rect.x + pad;
  const noteX = coinX + coinW + 12;

  const coinUnlocked = app.store.isUnlocked(iso, 'coin');
  const noteUnlocked = app.store.isUnlocked(iso, 'note');

  const coinVisual: CardVisual = { iso, name: c.name, region, signature, motif, glyph: c.glyph, denom, denomSymbol, form: 'coin' };
  const noteVisual: CardVisual = { iso, name: c.name, region, signature, motif, glyph: c.glyph, denom, denomSymbol, form: 'note' };

  drawCard(ctx, {
    rect: { x: coinX, y: slotY, w: coinW, h: slotH },
    visual: coinVisual,
    locked: !coinUnlocked,
    faceUp: coinUnlocked,
    image: app.imageFor(iso, 'coin'),
  });
  drawCard(ctx, {
    rect: { x: noteX, y: slotY, w: noteW, h: slotH },
    visual: noteVisual,
    locked: !noteUnlocked,
    faceUp: noteUnlocked,
    image: app.imageFor(iso, 'note'),
  });

  text(ctx, '硬币', coinX + coinW / 2, slotY + slotH + 12, {
    align: 'center',
    baseline: 'middle',
    size: 10,
    color: THEME.lockedInk,
  });
  text(ctx, '纸币', noteX + noteW / 2, slotY + slotH + 12, {
    align: 'center',
    baseline: 'middle',
    size: 10,
    color: THEME.lockedInk,
  });

  // §2.5 mastery pips（右下角）：未发现时也画空心 3 点，作为「可成长」的稳定占位
  drawMasteryPips(ctx, rect, region, collected ? app.meta.pips(iso) : 0);

  if (collected) {
    fitText(ctx, c.anchor, rect.x + pad, rect.y + rect.h - 8, {
      align: 'left',
      baseline: 'middle',
      size: 10,
      color: THEME.lockedInk,
      // 让位右下角 pips（18px + 8px 边距 + 6px 间隙）
      maxWidth: rect.w - pad * 2 - 32,
    });
    // 命中（视口坐标 = content + scroll）
    const hitY = rect.y + scroll;
    if (hitY + rect.h > 0 && hitY < vp.h) {
      hits.push({ rect: { x: rect.x, y: hitY, w: rect.w, h: rect.h }, action: () => app.openDetail(iso) });
    }
  }
}

export function drawCodex(
  app: App,
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  safe: SafeAreaInsets,
  hits: { rect: Rect; action: () => void }[]
): void {
  const p = app.store.progress();

  // 固定头
  const backRect: Rect = { x: safe.left + 8, y: safe.top + 8, w: 72, h: 36 };
  drawButton(ctx, backRect, '‹ 返回', { fontSize: 13 });
  hits.push({ rect: backRect, action: () => app.backToHub() });
  // deco_globe 标题左侧点缀（scene-backgrounds-spec §2.5：边长 22，锚点 (w/2 - 标题半宽 - 30, safe.top+17)）
  const deco = app.getDeco();
  if (deco) {
    ctx.font = 'bold 24px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
    const titleHalfW = ctx.measureText('图鉴').width / 2;
    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.drawImage(deco, vp.w / 2 - titleHalfW - 30, safe.top + 17, 22, 22);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  text(ctx, '图鉴', vp.w / 2, safe.top + 28, { align: 'center', size: 24, weight: 'bold' });
  text(ctx, `已解锁 ${p.unlocked} / ${p.total}`, vp.w / 2, safe.top + 52, {
    align: 'center',
    size: 13,
    color: THEME.lockedInk,
  });

  // §2.5 展示位 3：顶栏总星数（6 槽 × 3 星 = 18；path 星，零字形依赖）
  const sumStars = app.meta.totalStars();
  const starLabel = `${sumStars}/${TOTAL_STARS}`;
  const rightX = vp.w - safe.right - 12;
  const starY = safe.top + 52;
  ctx.font = '12px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  const labelW = ctx.measureText(starLabel).width;
  text(ctx, starLabel, rightX, starY, {
    align: 'right',
    baseline: 'middle',
    size: 12,
    color: THEME.ink,
  });
  drawStar(ctx, rightX - labelW - 4 - 6, starY, 6, sumStars > 0);

  const areaX = safe.left + 12;
  const areaW = vp.w - safe.left - safe.right - 24;
  const headerBottom = safe.top + 68;

  const regions: Region[] = ['amer', 'euro', 'asia_afr'];
  const gap = 10;
  const headerH = 28;
  const cellGap = 10;
  const cellW = (areaW - gap) / 2;
  const cellH = 104;

  // 计算内容总高
  let contentH = 0;
  const blocks = regions.map((region) => {
    const list = CURRENCIES.filter((c) => c.region === region);
    const rows = Math.ceil(list.length / 2);
    const h = headerH + rows * (cellH + cellGap);
    const block = { region, list, rows, y: contentH };
    contentH += h + gap * 2;
    return block;
  });

  const areaH = vp.h - headerBottom - safe.bottom;
  app.codexScrollMin = Math.min(0, areaH - contentH);
  const scroll = app.codexScroll;

  ctx.save();
  ctx.translate(0, scroll);
  for (const blk of blocks) {
    const hy = headerBottom + blk.y;
    // §3.3 分区标题左侧区域色印章点（直径 ≈ 标题字高 0.8）；标题仅右移让位，文本/字号不变
    const dotR = 16 * 0.8 * 0.5;
    ctx.beginPath();
    ctx.arc(areaX + dotR, hy + headerH * 0.5, dotR, 0, Math.PI * 2);
    ctx.fillStyle = REGION_COLORS[blk.region];
    ctx.fill();
    text(ctx, REGION_LABELS[blk.region], areaX + dotR * 2 + 8, hy + headerH * 0.5, {
      align: 'left',
      baseline: 'middle',
      size: 16,
      weight: 'bold',
    });
    const complete = blk.list.filter((c) => app.store.isComplete(c.iso)).length;
    fitText(ctx, `完整 ${complete}/${blk.list.length}`, areaX + areaW, hy + headerH * 0.5, {
      align: 'right',
      baseline: 'middle',
      size: 13,
      color: THEME.lockedInk,
      maxWidth: areaW - 90,
    });

    blk.list.forEach((c, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const cellX = areaX + col * (cellW + gap);
      const cellY = hy + headerH + row * (cellH + cellGap);
      drawCodexCell(
        app,
        ctx,
        { x: cellX, y: cellY, w: cellW, h: cellH },
        c.iso,
        c.region,
        c.signature,
        c.motif,
        c.denom,
        c.denomSymbol,
        app.store.isCollected(c.iso),
        hits,
        scroll,
        vp
      );
    });

    // §3.3 书架带：分区底部一条架板横线 + 4px 渐变厚度暗示
    const shelfY = hy + headerH + blk.rows * (cellH + cellGap) - cellGap + 8;
    ctx.fillStyle = 'rgba(139,115,85,0.22)';
    ctx.fillRect(areaX, shelfY, areaW, 2);
    const sg = ctx.createLinearGradient(0, shelfY + 2, 0, shelfY + 6);
    sg.addColorStop(0, 'rgba(139,115,85,0.08)');
    sg.addColorStop(1, 'rgba(139,115,85,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(areaX, shelfY + 2, areaW, 4);
  }
  ctx.restore();
}
