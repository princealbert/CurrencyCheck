/**
 * render/renderer.ts — 顶层绘制分发 + 配对棋盘（纯 Canvas 2D，无 DOM）
 *
 * drawApp：清背景后按当前视图调用 drawHub / drawBoard / drawCodex / drawDetail。
 * drawBoard：顶栏（返回/得分/重开）+ 4×4 卡牌（coin 近方 / note 2:1）+ 胜利结算 + 横屏提示。
 */

import type { App } from '../app/app';
import { STAR_POP_INTERVAL, STAR_POP_MS, STAR_SEQ_DELAY } from '../app/app';
import { Ctx2DLike, SafeAreaInsets } from '../platform/types';
import { THEME, REGION_COLORS, text, drawButton, fitText, wrapText, drawBackdrop, drawPanelSeam, withElevation, drawScene, SceneOpts, drawStar, roundRectPath } from './theme';
import { boardLayout, Rect } from './layout';
import { drawCard } from './card';
import { CardVisual } from './types';
import { drawHub } from './hub';
import { drawCodex } from './codex';
import { drawDetail } from './detail';
import { drawWorldTour } from './worldTour';
import { chapterById } from '../data/chapters';
import { drawFx, drawGhostSlot, drawToast } from './fx';
import { drawSettings } from './settings';
import { FORM_LABELS } from '../data/currencies';
import { getCurrency } from '../data/currencies';

/**
 * 场景底图合成参数（scene-backgrounds-spec §3.3 不透明度总表）。
 * key = App.view；Hub 暗角用暖褐 (90,70,40) 且圆心偏上（'hub' 策略）。
 */
const SCENE_OPTS: Record<string, SceneOpts> = {
  hub: { alpha: 0.95, veil: 0.1, vignette: 0.1, vignetteColor: '90,70,40', vignetteKind: 'hub' },
  pair: { alpha: 0.85, veil: 0.14, vignette: 0.18 },
  codex: { alpha: 0.92, veil: 0.12, vignette: 0.08 },
  // Detail 用专属 focus-darken（detail.ts）收视线到卡片，场景层 L3 暗角冗余 → 关闭，避免双重压暗
  detail: { alpha: 0.9, veil: 0.12, vignette: 0 },
};

/**
 * toast 锚定基线（相对 safe.top）：各视图返回键行 y=safe.top+8、h=36 → 下沿 safe.top+44。
 * drawToast 内部再叠 ph.yOff（hold 段 +8）→ 实际横幅顶边 safe.top+52。
 */
const TOAST_ANCHOR_OFFSET = 44;

/**
 * 启动加载屏（loading-gate.md）：资产异步就位前显示，覆盖「几何占位→真图」的 messy 期。
 * 纯 Canvas 2D，深品牌底 + 金币母题 + 进度条；progress（0..1）由 App.loadingProgress 传入。
 */
export function drawLoadingScreen(
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  progress: number
): void {
  const W = vp.w;
  const H = vp.h;
  // 品牌深底
  ctx.fillStyle = '#1A1614';
  ctx.fillRect(0, 0, W, H);
  // 顶部暖光（多层同心圆叠加近似径向渐变，避免依赖 createLinearGradient）
  const glowY = H * 0.30;
  for (let i = 4; i >= 1; i--) {
    ctx.beginPath();
    ctx.arc(W / 2, glowY, (Math.min(W, H) * 0.5 * i) / 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(224,177,94,${0.04 * i})`;
    ctx.fill();
  }

  const cx = W / 2;
  const coinY = H * 0.40;
  const r = Math.min(W, H) * 0.13;
  // 金币外环 + 内圈（抽象几何母题，非真实币种）
  ctx.beginPath();
  ctx.arc(cx, coinY, r, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = THEME.gold;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, coinY, r * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(224,177,94,0.12)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(224,177,94,0.5)';
  ctx.stroke();
  text(ctx, '币', cx, coinY, { align: 'center', baseline: 'middle', size: Math.round(r * 0.7), weight: 'bold', color: THEME.gold });

  text(ctx, '货币图鉴 · 对对碰', cx, H * 0.58, { align: 'center', baseline: 'middle', size: 22, weight: 'bold', color: '#F3EAD8' });
  text(ctx, '正在整理周爷爷的钱币收藏册…', cx, H * 0.63, { align: 'center', baseline: 'middle', size: 13, color: 'rgba(243,234,216,0.6)' });

  // 进度条
  const barW = W * 0.6;
  const barH = 8;
  const barX = (W - barW) / 2;
  const barY = H * 0.72;
  roundRectPath(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fillStyle = 'rgba(243,234,216,0.14)';
  ctx.fill();
  const p = Math.max(0, Math.min(1, progress));
  if (p > 0) {
    roundRectPath(ctx, barX, barY, Math.max(barH, barW * p), barH, barH / 2);
    ctx.fillStyle = THEME.gold;
    ctx.fill();
  }
  text(ctx, Math.round(p * 100) + '%', cx, barY + barH + 18, { align: 'center', baseline: 'middle', size: 12, color: 'rgba(243,234,216,0.5)' });
}

/** 横屏「请竖屏」引导页：品牌深底 + 旋转手机图标 + 文案，铺满全屏（w/h 为设备 CSS 像素）。 */
export function drawRotateOverlay(ctx: Ctx2DLike, w: number, h: number): void {
  // 品牌深底
  ctx.fillStyle = '#1A1614';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2 - Math.min(w, h) * 0.04;
  const unit = Math.min(w, h);
  const phoneW = unit * 0.16;
  const phoneH = phoneW * 1.9;

  ctx.save();
  ctx.translate(cx, cy);

  // 旋转环箭头（提示把设备转正）
  const ringR = phoneH * 0.72;
  ctx.strokeStyle = '#F3E9D8';
  ctx.lineWidth = Math.max(2, unit * 0.006);
  ctx.beginPath();
  ctx.arc(0, 0, ringR, Math.PI * 0.35, Math.PI * 1.65);
  ctx.stroke();
  const aHead = Math.PI * 1.65;
  const hx = Math.cos(aHead) * ringR;
  const hy = Math.sin(aHead) * ringR;
  const tang = aHead + Math.PI / 2;
  const ah = Math.max(6, unit * 0.022);
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - Math.cos(tang - 0.5) * ah, hy - Math.sin(tang - 0.5) * ah);
  ctx.lineTo(hx - Math.cos(tang + 0.5) * ah, hy - Math.sin(tang + 0.5) * ah);
  ctx.closePath();
  ctx.fillStyle = '#F3E9D8';
  ctx.fill();

  // 竖向手机轮廓（目标姿态）
  ctx.strokeStyle = THEME.gold;
  ctx.lineWidth = Math.max(2, phoneW * 0.09);
  roundRectPath(ctx, -phoneW / 2, -phoneH / 2, phoneW, phoneH, phoneW * 0.18);
  ctx.stroke();
  // 听筒提示
  ctx.fillStyle = THEME.gold;
  ctx.fillRect(-phoneW * 0.26, -phoneH * 0.1, phoneW * 0.52, phoneH * 0.05);

  ctx.restore();

  // 文案
  text(ctx, '请将手机竖屏', cx, cy + phoneH * 0.95, {
    align: 'center', baseline: 'middle', size: Math.round(unit * 0.058), weight: 'bold', color: THEME.gold,
  });
  text(ctx, '以获得最佳体验', cx, cy + phoneH * 0.95 + unit * 0.085, {
    align: 'center', baseline: 'middle', size: Math.round(unit * 0.042), color: 'rgba(243,233,216,0.7)',
  });
}

function toVisual(card: {
  iso: string;
  region: any;
  signature: string;
  motif: any;
  denom: string;
  denomSymbol: string;
  form: any;
  glyph?: any;
}): CardVisual {
  const cur = getCurrency(card.iso);
  return {
    iso: card.iso,
    name: cur?.name ?? card.iso,
    region: card.region,
    signature: card.signature,
    motif: card.motif,
    // 币符：优先取牌上携带的（deck 已注入），缺省回落主数据查表 —— 老牌局数据也能出 glyph
    glyph: card.glyph ?? cur?.glyph,
    denom: card.denom,
    denomSymbol: card.denomSymbol,
    form: card.form,
  };
}

function drawBoard(
  app: App,
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  safe: SafeAreaInsets,
  hits: { rect: Rect; action: () => void }[]
): void {
  if (!app.match) return;
  /* 网格由**对数**推导（关卡文档 §4，chapters.gridForPairs），开局时算好存在 app.grid，
   * 与 app.fireBurst 同源 —— 单区 6 币也不会出现 6×6 空 12 格的不可读棋盘。 */
  const grid = app.grid;
  const layout = boardLayout(vp, safe, app.form, grid.cols, grid.rows);
  const pairs = app.match.cards.length / 2;
  const cb = app.colorblind;

  // 顶栏
  const tb = layout.topBar;
  const backRect: Rect = { x: tb.x + 8, y: tb.y + 8, w: 72, h: tb.h - 16 };
  drawButton(ctx, backRect, '‹ 返回', { fontSize: 14 });
  hits.push({ rect: backRect, action: () => app.backToHub() });

  text(ctx, '得分 ' + app.match.score, vp.w / 2, tb.y + tb.h * 0.42, {
    align: 'center',
    baseline: 'middle',
    size: 17,
    weight: 'bold',
  });
  // 次要行：章节 · 难度档 + 进度 + 记错次数（星评输入对玩家可见，可解释）
  fitText(
    ctx,
    `${chapterById(app.chapter).name} · T${app.grade} · ${app.match.matchedCount}/${pairs} 对 · 记错 ${app.match.mismatches}`,
    vp.w / 2,
    tb.y + tb.h - 6,
    {
      align: 'center',
      baseline: 'bottom',
      size: 11,
      color: THEME.lockedInk,
      maxWidth: tb.w - 176,
    }
  );

  const restRect: Rect = { x: tb.x + tb.w - 8 - 72, y: tb.y + 8, w: 72, h: tb.h - 16 };
  drawButton(ctx, restRect, '重开', { fontSize: 14 });
  hits.push({ rect: restRect, action: () => app.restart() });

  // 卡牌
  const n = Math.min(layout.cards.length, app.match.cards.length);
  for (let i = 0; i < n; i++) {
    const card = app.match.cards[i];
    const rect = layout.cards[i];
    const visual = toVisual(card);
    const img = app.imageFor(card.iso, card.form);
    const fl = app.cardFlip(card);
    const ca = app.clearAnimOf(card);

    if (card.state === 'matched') {
      // §3.1：清除动画进行中 → 缩放/淡出绘制；结束（或无动画）→ 幽灵槽位
      if (ca && !ca.done && ca.alpha > 0.01 && ca.scale > 0.01) {
        const ccx = rect.x + rect.w / 2;
        const ccy = rect.y + rect.h / 2;
        ctx.save();
        ctx.globalAlpha = ca.alpha;
        ctx.translate(ccx, ccy);
        ctx.scale(ca.scale, ca.scale);
        ctx.translate(-ccx, -ccy);
        drawCard(ctx, { rect, visual, faceUp: true, image: img, showName: true, nameH: layout.nameH, colorblind: cb });
        if (ca.highlight) {
          // A 段认知节拍：描边加亮为区域亮色 2px
          ctx.strokeStyle = REGION_COLORS[card.region];
          ctx.lineWidth = 2;
          if (card.form === 'coin') {
            ctx.beginPath();
            ctx.arc(ccx, rect.y + 1 + Math.min(rect.w, rect.h * 0.86) / 2, Math.min(rect.w, rect.h * 0.86) / 2 - 1, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            roundRectPath(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - layout.nameH - 2, Math.max(2, rect.h * 0.1));
            ctx.stroke();
          }
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      } else {
        drawGhostSlot(ctx, rect, card.region, card.form);
      }
      continue; // matched 卡无 hitTarget
    }

    if (fl) {
      drawCard(ctx, { rect, visual, faceUp: fl.faceUp, flipScaleX: fl.scaleX, image: img, showName: true, nameH: layout.nameH, colorblind: cb });
    } else {
      drawCard(ctx, { rect, visual, faceUp: card.state !== 'face_down', image: img, showName: true, nameH: layout.nameH, colorblind: cb });
    }
    if (card.state === 'face_down' && !app.match.lock) {
      hits.push({ rect, action: () => app.flipCard(card.id) });
    }
  }

  // burst 粒子 / 光环（§3.3：禁 shadow、批量 fill；无活动粒子时零成本）
  drawFx(ctx, app.gameTimeMs);

  // toast 不在此绘制：已上提到 drawApp 末尾统一绘制（四视图通吃 + 永远最顶层）

  // note 形态在竖屏：横屏提示遮罩（桌面 dev 可 localStorage dev_landscape=1 跳过）
  if (app.form === 'note' && vp.h > vp.w && !app.devSkipLandscapeMask) {
    ctx.fillStyle = 'rgba(58,58,56,0.55)';
    ctx.fillRect(0, 0, vp.w, vp.h);
    fitText(ctx, '请横屏以游玩「纸币」形态', vp.w / 2, vp.h / 2, {
      align: 'center',
      baseline: 'middle',
      size: 18,
      color: '#FFFFFF',
      weight: 'bold',
      maxWidth: vp.w * 0.9,
    });
    fitText(ctx, '（硬币形态可在竖屏游玩）', vp.w / 2, vp.h / 2 + 28, {
      align: 'center',
      baseline: 'middle',
      size: 13,
      color: '#EEEEEE',
      maxWidth: vp.w * 0.9,
    });
  }

  // 胜利结算
  if (app.won) drawWin(app, ctx, vp, hits);
}

function drawWin(
  app: App,
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  hits: { rect: Rect; action: () => void }[]
): void {
  ctx.fillStyle = 'rgba(58,58,56,0.62)';
  ctx.fillRect(0, 0, vp.w, vp.h);

  const pw = Math.min(vp.w * 0.82, 360);
  const ph = 280;
  const px = (vp.w - pw) / 2;
  const py = (vp.h - ph) / 2;
  const panel: Rect = { x: px, y: py, w: pw, h: ph };
  // 景深 E3（聚焦层）+ 手账缝线（§6.3 / §6.4）
  withElevation(ctx, 'E3', ph, () => theme_roundRectFill(ctx, panel, THEME.panel, 16));
  drawPanelSeam(ctx, panel, 16, 6);

  text(ctx, '全部配对完成！', px + pw / 2, py + 32, {
    align: 'center',
    baseline: 'middle',
    size: 21,
    weight: 'bold',
  });

  /* ② 星评面板（§2.5）：三颗星为首要位置，逐颗弹入（间隔 250ms，scale 1.4→1.0）。
   *    未获得的画空心轮廓；永不出现 0⭐/失败字样（no-fail 红线）。 */
  const starR = 16;
  const starGap = 12;
  const starStep = starR * 2 + starGap;
  const starY = py + 80;
  const startX = px + pw / 2 - (starStep * 3 - starGap) / 2 + starR;
  const sinceWin = app.gameTimeMs - app.wonAt;
  for (let i = 0; i < 3; i++) {
    // 整体后移 STAR_SEQ_DELAY，给通关音让出 t=420~700 的独占空窗；
    // 该常量与 app.ts 排 sfx_star_pip 的落点是同一个，保证视听严格同帧。
    const appearAt = STAR_SEQ_DELAY + i * STAR_POP_INTERVAL;
    if (sinceWin < appearAt) continue;
    const t = Math.min(1, (sinceWin - appearAt) / STAR_POP_MS);
    const ease = 1 - (1 - t) * (1 - t);
    const scale = 1.4 - 0.4 * ease; // 1.4 → 1.0 弹入
    const sx = startX + i * starStep;
    ctx.save();
    ctx.translate(sx, starY);
    ctx.scale(scale, scale);
    drawStar(ctx, 0, 0, starR, i < app.earnedStars);
    ctx.restore();
  }

  // 次要行：记错次数 + 得分（score 降级为次要展示）
  text(ctx, `记错 ${app.match!.mismatches} 次 · 得分 ${app.match!.score}`, px + pw / 2, py + 112, {
    align: 'center',
    baseline: 'middle',
    size: 13,
    color: THEME.ink,
  });
  text(ctx, `${chapterById(app.chapter).name} · T${app.grade} · 最高分 ${app.best}`, px + pw / 2, py + 132, {
    align: 'center',
    baseline: 'middle',
    size: 12,
    color: THEME.lockedInk,
  });

  // 新解锁列表
  let listY = py + 158;
  if (app.sessionUnlocked.length === 0) {
    text(ctx, '本局无新解锁（已全收集）', px + pw / 2, listY, {
      align: 'center',
      baseline: 'middle',
      size: 13,
      color: THEME.lockedInk,
    });
  } else {
    text(ctx, '新解锁：', px + pw / 2, listY, {
      align: 'center',
      baseline: 'middle',
      size: 13,
      color: THEME.good,
    });
    listY += 22;
    const names = app.sessionUnlocked
      .map((k) => {
        const [iso, form] = k.split('_');
        const c = getCurrency(iso);
        return (c ? c.name : iso) + '·' + (FORM_LABELS[form as 'coin' | 'note'] ?? form);
      })
      .join('  ');
    // 面板宽度内换行（复用 theme.wrapText，按字符累加宽度），最多 2 行，超出末行加「…」
    const nameMaxW = pw - 32;
    const nameFont = '13px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
    const nameLines = wrapText(ctx, names, nameMaxW, nameFont);
    const maxLines = 2;
    const shown = nameLines.slice(0, maxLines);
    if (nameLines.length > maxLines) {
      let last = shown[maxLines - 1];
      while (last.length > 0 && ctx.measureText(last + '…').width > nameMaxW) {
        last = last.slice(0, -1);
      }
      shown[maxLines - 1] = last + '…';
    }
    shown.forEach((ln, i) => {
      text(ctx, ln, px + pw / 2, listY + i * 18, {
        align: 'center',
        baseline: 'middle',
        size: 13,
      });
    });
  }

  // 按钮
  const bw = (pw - 16 * 3) / 2;
  const bh = 44;
  const by = py + ph - bh - 18;
  const againRect: Rect = { x: px + 16, y: by, w: bw, h: bh };
  const hubRect: Rect = { x: px + 16 + bw + 16, y: by, w: bw, h: bh };
  /* 「继续」键在全收集达成的那一局改指影片（world-tour-reward §3.2 第 9 项，
   * 这是**唯一的自动入口**；文档写的 `app.goHub()` 在本仓库叫 `backToHub()`）。
   * 刻意不加第三个按钮：面板宽按两键均分算死，塞三个会把中文标签挤成省略号。
   * 主次也一起翻转 —— 此刻「再来一局」不该抢走注意力。
   * 文案「去看看远方」过 §1.4 词表：不含 奖励/领取/稀有 等禁用词。 */
  const toTour = app.pendingWorldTour;
  drawButton(ctx, againRect, '再来一局', toTour ? undefined : { active: true });
  drawButton(ctx, hubRect, toTour ? '去看看远方' : '回 Hub', toTour ? { active: true } : undefined);
  hits.push({ rect: againRect, action: () => app.restart() });
  hits.push({
    rect: hubRect,
    action: () => (toTour ? app.openWorldTour() : app.backToHub()),
  });
}

function theme_roundRectFill(ctx: Ctx2DLike, r: Rect, color: string, radius: number): void {
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

/** 顶层分发 */
export function drawApp(
  app: App,
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  safe: SafeAreaInsets,
  hits: { rect: Rect; action: () => void }[]
): void {
  /* 「环游世界」伪视频是**全屏独占影片**（world-tour-reward §2.1 层序 L0–L6）：
   * 这里必须**早退**，而不是塞进下面的 switch，有三个理由 ——
   *   ① 它自带 L0 暖黑底（#1A1614），走 paper/table backdrop 只是白填一遍再被盖掉；
   *   ② 早退才能挡住函数尾部的册册对白 toast：结算那一刻解锁 toast 往往还在队列里，
   *      若照常绘制会有一条米色横幅压在落款「—— 周爷爷，写在册子最后一页」上；
   *   ③ hits 由本函数独占填充，避免设置角/toast 抢走"点按 = 暂停"的全屏命中区。 */
  if (app.view === 'world_tour') {
    drawWorldTour(app, ctx, vp, safe, hits);
    return;
  }

  // 场景底（美术 §3.1–3.4）：Board 用桌面绒底（暗角较重，收视线进牌桌），
  // Hub / Codex / Detail 用同一张「暖手账纸」（渐变 + 轻暗角），保证翻页连贯感。
  // 颗粒瓦片（§3.5）需离屏 canvas（平台层能力），本轮跳过，留二期。
  drawBackdrop(ctx, vp, app.view === 'pair' ? 'table' : 'paper');

  // L1–L3 场景底图合成（scene-backgrounds-spec §3.1）：图未加载/缺失 → 上面的 L0 兜底，零回归
  const sc = app.sceneFor(app.view);
  if (sc) drawScene(ctx, vp, sc, SCENE_OPTS[app.view]);

  switch (app.view) {
    case 'hub':
      drawHub(app, ctx, vp, safe, hits);
      break;
    case 'pair':
      drawBoard(app, ctx, vp, safe, hits);
      break;
    case 'codex':
      drawCodex(app, ctx, vp, safe, hits);
      break;
    case 'detail':
      drawDetail(app, ctx, vp, safe, hits);
      break;
  }

  /* 声音设置入口 + 面板：只在 Hub 提供（与色弱 toggle 同一处「设置角」），
   * 画在视图之后 → 面板压住 Hub 内容；但在 toast 之前 → 册册对白仍是最顶层，
   * 不会被设置面板盖掉（层级修复的既定口径）。 */
  if (app.view === 'hub') drawSettings(app, ctx, vp, safe, hits);

  /* 册册对白 toast —— **统一在所有视图之后绘制**（层级修复）。
   * 曾经只有 drawBoard / drawHub 内部各自调一次，codex / detail 两个分支根本不画，
   * 玩家一翻到图鉴，正在排队的对白就"消失"了。上提到这里后：
   *  ① 四视图（hub/pair/codex/detail）都显示；
   *  ② 画在 backdrop/scene/cards/codex/detail 全部之后 → 永远最顶层；
   *  ③ hits 最后 push → 命中判定逆序遍历时优先命中（点按 = dismiss）。
   * 锚点取 safe.top + 44：各视图返回键行（safe.top+8 起、高 36）的下沿，
   * 既贴着顶栏又不盖住返回键、不抢它的点击。 */
  const head = app.toasts[0];
  if (head) {
    const tr = drawToast(ctx, vp, safe.top + TOAST_ANCHOR_OFFSET, head, app.gameTimeMs);
    if (tr) hits.push({ rect: tr, action: () => app.dismissToast() });
  }
}
