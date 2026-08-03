/**
 * render/hub.ts — Hub（S1 钱币收藏册）视图（纯 Canvas 2D，无 DOM）
 *
 * 标题 + 进度条 + 最高分 + 形态选择（coin/note）+ **4 区域书架**（关卡文档 §2/§8①）+
 * 图鉴 + 右上角色弱 / 高对比 toggle（§5.3）+ 轻提示 toast（复用 §1.3 通道）。
 *
 * 书架 = 章节（amer/euro/asia_afr/world，按 CHAPTERS 的 itinerary 顺序）：
 *   解锁态 + 发现进度 + 最佳星；点击展开本章 T1/T2/T3 子菜单（isGradeOpen 门禁）。
 *   未解锁书架点击只弹轻提示，不跳转（no-fail：永远看得见路，但要按足迹走）。
 */

import type { App } from '../app/app';
import { Ctx2DLike, SafeAreaInsets } from '../platform/types';
import {
  THEME,
  REGION_COLORS,
  text,
  drawButton,
  fitText,
  roundRectPath,
  drawGoldDiamond,
  drawStar,
  drawStarRow,
} from './theme';
import { Rect, hstack } from './layout';
import { FORM_FACTORS, FORM_LABELS, REGION_STYLE } from '../data/currencies';
import { CHAPTERS, ChapterId, Grade, chapterById, poolIsos } from '../data/chapters';
import { regionShapePath } from './card';

/** 难度档名（与关卡文档 §4 口径一致；grade 语义随章节略变，文案保持稳定） */
const GRADE_NAMES: Record<Grade, string> = { 1: '初识', 2: '环游', 3: '环球' };

/**
 * §5.3 色弱 / 高对比 toggle 图标（32×32，纯 path 的「半圆填充对比圈」）。
 * 关：细描边圆 + 右半填充；开：加青绿粗环，语义为「对比强化已生效」。
 */
function drawContrastIcon(ctx: Ctx2DLike, rect: Rect, on: boolean): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = Math.min(rect.w, rect.h) / 2 - 4;

  // 圆底（暖白），保证在任何底图上都能看清
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = THEME.panel;
  ctx.fill();

  // 右半填充（对比圈本体）
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = THEME.ink;
  ctx.fill();

  // 外环：开=青绿 2.5px / 关=面板线 1.5px
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = on ? THEME.teal : THEME.panelLine;
  ctx.lineWidth = on ? 2.5 : 1.5;
  ctx.stroke();
}

/**
 * 「环游世界」重看入口图标（明信片，32×32 纯 path，world-tour-reward §3.4）。
 *
 * 为什么是图标不是整行按钮：Hub 的书架栈高度是按「4 书架 + 1 图鉴」算死的（needH），
 * 再插一行会连带压缩所有书架，矮屏上直接把副标题挤没。文档也明确写的是
 * 「常驻一枚小图标（行囊 / 明信片）」，图标是更小的改动面。
 *
 * 造型：暖白卡片底 + 金色描边 + 右上角邮票方块 + 左侧两道地址线。
 * 用金色而非青绿：与色弱 toggle（青绿）在视觉上区分开，且金色在本作里
 * 一直是「周爷爷 / 收藏册」的语义色（标题菱形、进度条游标都用它）。
 */
function drawPostcardIcon(ctx: Ctx2DLike, rect: Rect): void {
  const s = Math.min(rect.w, rect.h);
  const w = s * 0.82;
  const h = s * 0.58;
  const x = rect.x + (rect.w - w) / 2;
  const y = rect.y + (rect.h - h) / 2;
  const r = Math.max(2, s * 0.08);

  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = THEME.panel;
  ctx.fill();
  ctx.strokeStyle = THEME.gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 邮票：右上角小方块
  const st = h * 0.3;
  ctx.fillStyle = THEME.gold;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(x + w - st - h * 0.16, y + h * 0.16, st, st);
  ctx.globalAlpha = 1;

  // 地址线：左侧两道短线
  ctx.strokeStyle = THEME.lockedInk;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const ly = y + h * (0.52 + i * 0.22);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.14, ly);
    ctx.lineTo(x + w * 0.62, ly);
    ctx.stroke();
  }
}

/**
 * 档位按钮副标题区：`最佳 ★★☆`（path 星，§2.5 展示位 2）。
 * bestStar=0（尚未完成）→ 不画星、改文案，避免任何「0⭐」读感（no-fail 红线）。
 */
function drawTierSub(ctx: Ctx2DLike, rect: Rect, bestStar: number): void {
  const cy = rect.y + rect.h * 0.72;
  const cx = rect.x + rect.w / 2;
  if (bestStar <= 0) {
    text(ctx, '尚未挑战', cx, cy, {
      align: 'center',
      baseline: 'middle',
      size: 12,
      color: THEME.lockedInk,
    });
    return;
  }
  const label = '最佳';
  const size = 11;
  const starR = 5.5;
  const starGap = starR * 0.6;
  const rowW = (starR * 2 + starGap) * 3 - starGap;
  ctx.font = `${size}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
  const labelW = ctx.measureText(label).width;
  const totalW = labelW + 6 + rowW;
  const startX = cx - totalW / 2;
  text(ctx, label, startX, cy, {
    align: 'left',
    baseline: 'middle',
    size,
    color: THEME.lockedInk,
  });
  drawStarRow(ctx, startX + labelW + 6 + rowW / 2, cy, starR, bestStar, 3, starGap);
}

/**
 * 书架副标题区：`发现 3/6 · ★★☆`（drawTierSub 的章节版，同一套排版语言）。
 * 星为「本章全档最高」；0 星不画星（no-fail 红线：任何位置都不出现 0⭐ 读感）。
 */
function drawShelfSub(
  ctx: Ctx2DLike,
  rect: Rect,
  found: number,
  total: number,
  bestStar: number
): void {
  const cy = rect.y + rect.h * 0.72;
  const cx = rect.x + rect.w / 2;
  const label = `发现 ${found}/${total}`;
  const size = 11;
  const starR = 5.5;
  const starGap = starR * 0.6;
  const rowW = bestStar > 0 ? (starR * 2 + starGap) * 3 - starGap : 0;
  const sep = bestStar > 0 ? 8 : 0;
  ctx.font = `${size}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
  const labelW = ctx.measureText(label).width;
  const startX = cx - (labelW + sep + rowW) / 2;
  text(ctx, label, startX, cy, {
    align: 'left',
    baseline: 'middle',
    size,
    color: THEME.lockedInk,
  });
  if (bestStar > 0) {
    drawStarRow(ctx, startX + labelW + sep + rowW / 2, cy, starR, bestStar, 3, starGap);
  }
}

/**
 * 书架左侧章节图标（纯 path，零资产）：
 *   单区章 = 该洲的区域形状（与卡面 ① 区域徽标同一形状语言，形状即身份）；
 *   环球章 = 星图 icon（轨道环 + 中心星），与三洲形状明确区分。
 * 未解锁 → 统一走 locked 灰，形状仍在（看得见目的地）。
 */
function drawChapterIcon(
  ctx: Ctx2DLike,
  id: ChapterId,
  cx: number,
  cy: number,
  r: number,
  open: boolean
): void {
  if (r < 3) return;
  ctx.save();
  if (id === 'world') {
    const col = open ? THEME.gold : THEME.locked;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.52, -Math.PI * 0.18, 0, Math.PI * 2);
    ctx.strokeStyle = open ? THEME.teal : THEME.locked;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    drawStar(ctx, cx, cy, r * 0.62, true, col);
  } else {
    regionShapePath(ctx, REGION_STYLE[id].shape, cx, cy, r * 2);
    ctx.fillStyle = open ? REGION_COLORS[id] : THEME.locked;
    ctx.fill();
  }
  ctx.restore();
}

export function drawHub(
  app: App,
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  safe: SafeAreaInsets,
  hits: { rect: Rect; action: () => void }[]
): void {
  const cx = vp.w / 2;

  // §2.1 标题保护光晕（对比度硬要求）：标题绘制前打一层局部径向亮渐变
  const haloR = vp.w * 0.42;
  const haloCy = safe.top + 52;
  const halo = ctx.createRadialGradient(cx, haloCy, 0, cx, haloCy, haloR);
  halo.addColorStop(0, 'rgba(253,251,246,0.72)');
  halo.addColorStop(1, 'rgba(253,251,246,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - haloR, haloCy - haloR, haloR * 2, haloR * 2);

  // 标题（fitText 约束不溢出窄屏；文本/位置/字号均不变）
  const titleW = vp.w * 0.9;
  const titleY = safe.top + 46;
  const titleSize = fitText(ctx, '货币图鉴', cx, titleY, {
    align: 'center',
    size: 30,
    weight: 'bold',
    maxWidth: titleW,
  });
  // §6.1 降级方案：标题左右金色菱形 + 下方金色短划线（纯 path 装饰，不动文本）
  // fitText 返回后 ctx.font 即生效字号，可直接测量标题实宽来定位装饰。
  const titleTextW = ctx.measureText('货币图鉴').width;
  const ornY = titleY - titleSize * 0.32;
  const ornR = Math.max(3, titleSize * 0.16);
  const ornDX = titleTextW / 2 + ornR + 12;
  drawGoldDiamond(ctx, cx - ornDX, ornY, ornR);
  drawGoldDiamond(ctx, cx + ornDX, ornY, ornR);
  const ruleW = 60;
  ctx.fillStyle = THEME.gold;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(cx - ruleW / 2, safe.top + 56, ruleW, 2);
  ctx.globalAlpha = 1;
  fitText(ctx, '对对碰 · 世界各国货币', cx, safe.top + 76, {
    align: 'center',
    size: 14,
    color: THEME.lockedInk,
    maxWidth: titleW,
  });

  // 进度
  const p = app.store.progress();
  fitText(ctx, `已解锁 ${p.unlocked} / ${p.total}`, cx, safe.top + 110, {
    align: 'center',
    size: 16,
    weight: 'bold',
    maxWidth: titleW,
  });
  const barW = Math.min(vp.w * 0.7, 320);
  const barH = 10;
  const barX = cx - barW / 2;
  const barY = safe.top + 124;
  // §6.2 轻量版：胶囊轨道 + 受光填充 + 头部硬币游标（几何尺寸/文案均不变）
  const barR = barH / 2;
  roundRectPath(ctx, barX, barY, barW, barH, barR);
  ctx.fillStyle = 'rgba(139,115,85,0.18)';
  ctx.fill();
  if (p.pct > 0) {
    const fillW = Math.max(barH, (barW * p.pct) / 100);
    ctx.save();
    roundRectPath(ctx, barX, barY, barW, barH, barR);
    ctx.clip();
    roundRectPath(ctx, barX, barY, fillW, barH, barR);
    ctx.fillStyle = THEME.teal;
    ctx.fill();
    // 上半受光
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(barX, barY, fillW, barH / 2);
    ctx.restore();
    // 硬币游标（金圆 + 白高光弧），直径 = 条高 × 1.8
    const curX = barX + Math.min(barW, fillW);
    const curY = barY + barH / 2;
    const curR = (barH * 1.8) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(curX, curY, curR, 0, Math.PI * 2);
    ctx.fillStyle = THEME.gold;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(curX, curY, curR * 0.68, Math.PI * 1.08, Math.PI * 1.48);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }
  text(ctx, '最高分 ' + app.best, cx, barY + barH + 18, {
    align: 'center',
    size: 13,
    color: THEME.lockedInk,
  });

  // 形态选择（coin / note）
  const segW = 120;
  const segH = 46;
  const segY = safe.top + 188;
  const segs = hstack(cx, segY, segW, segH, 16, 2);
  FORM_FACTORS.forEach((f, i) => {
    drawButton(ctx, segs[i], FORM_LABELS[f], {
      active: app.selectedForm === f,
      sub: f === 'coin' ? '圆牌·竖屏' : '长方牌·横屏',
      fontSize: 16,
      shadow: true,
    });
    const idx = i;
    hits.push({
      rect: segs[i],
      action: () => {
        app.selectedForm = FORM_FACTORS[idx];
        app.dirty = true;
      },
    });
  });

  /* —— 4 区域书架 + 图鉴（关卡文档 §8①）——
   * 高度自适应：书架 ×4 + 可选展开行 + 图鉴，必须完整落在「形态条」与「合规行」之间。
   * 矮屏（含展开态）按同一系数等比压缩，宁可整体变小也不让按钮溢出或互相压叠。 */
  const btnW = Math.min(vp.w * 0.8, 340);
  const stackX = cx - btnW / 2;
  const topY = segY + segH + 12;
  const availH = Math.max(150, vp.h - safe.bottom - 30 - topY);
  const openId = app.hubOpenChapter;
  const openCh = openId ? chapterById(openId) : null;

  let shelfH = 52;
  let gradeH = 38;
  let gap = 10;
  // 需求高度 = 书架 ×4 + 图鉴 ×1 + 间隙 ×4（+ 展开的难度档行）
  const needH =
    shelfH * (CHAPTERS.length + 1) + gap * CHAPTERS.length + (openCh ? gradeH + gap * 0.6 : 0);
  const k = Math.min(1, availH / needH);
  shelfH *= k;
  gradeH *= k;
  gap *= k;
  let y = topY + Math.max(0, (availH - needH * k) / 2);

  CHAPTERS.forEach((ch) => {
    const rect: Rect = { x: stackX, y, w: btnW, h: shelfH };
    const open = app.isChapterOpen(ch.id);
    const expanded = openId === ch.id;
    drawButton(ctx, rect, ch.name, {
      active: open && expanded,
      // sub 占位：让主标题保持「有副标题」的排版基线，真实副标题由下方自绘（path 星）
      sub: ' ',
      fontSize: Math.max(13, Math.min(19, shelfH * 0.36)),
      shadow: true,
      bg: open ? undefined : THEME.locked,
      fg: open ? undefined : THEME.lockedInk,
    });
    drawChapterIcon(ctx, ch.id, rect.x + shelfH * 0.44, rect.y + shelfH * 0.38, shelfH * 0.16, open);
    if (open) {
      const pool = poolIsos(ch);
      const found = pool.filter((iso) => app.store.isCollected(iso)).length;
      drawShelfSub(ctx, rect, found, pool.length, app.meta.bestStarOfChapter(ch.id));
    } else {
      fitText(ctx, ch.subtitle, rect.x + rect.w / 2, rect.y + rect.h * 0.72, {
        align: 'center',
        baseline: 'middle',
        size: 11,
        color: THEME.lockedInk,
        maxWidth: rect.w - 24,
      });
    }
    // 命中：解锁 → 展开/收起子菜单；未解锁 → 轻提示（不跳转，单一真源在 app）
    hits.push({
      rect,
      action: () => {
        if (!open) {
          app.hintChapterLocked(ch.id);
          return;
        }
        app.hubOpenChapter = expanded ? null : ch.id;
        app.dirty = true;
      },
    });
    y += shelfH + gap;

    if (!expanded) return;

    // 难度档子菜单：只列本章配置的档（四章均为 T1/T2/T3），门禁走 isGradeOpen
    const n = ch.tiers.length;
    const gw = (btnW - gap * (n - 1)) / n;
    ch.tiers.forEach((g: Grade, gi: number) => {
      const gr: Rect = { x: stackX + gi * (gw + gap), y, w: gw, h: gradeH };
      const gOpen = app.isGradeOpen(ch.id, g);
      drawButton(ctx, gr, `T${g} ${GRADE_NAMES[g]}`, {
        sub: ' ',
        fontSize: Math.max(11, Math.min(15, gradeH * 0.36)),
        shadow: true,
        bg: gOpen ? undefined : THEME.locked,
        fg: gOpen ? undefined : THEME.lockedInk,
      });
      if (gOpen) {
        drawTierSub(ctx, gr, app.meta.bestStarChapter(ch.id, g));
      } else {
        text(ctx, '尚未解锁', gr.x + gr.w / 2, gr.y + gr.h * 0.72, {
          align: 'center',
          baseline: 'middle',
          size: 11,
          color: THEME.lockedInk,
        });
      }
      // 开局；未解锁 → startChapter 内部弹轻提示（判定单一真源）
      hits.push({ rect: gr, action: () => app.startChapter(ch.id, g, app.selectedForm) });
    });
    y += gradeH + gap * 0.6;
  });

  const codexRect: Rect = { x: stackX, y, w: btnW, h: shelfH };
  drawButton(ctx, codexRect, '图鉴', { fontSize: Math.max(14, Math.min(20, shelfH * 0.38)), shadow: true });
  hits.push({ rect: codexRect, action: () => app.openCodex() });

  // deco_globe 右下角点缀（scene-backgrounds-spec §2.5；缺失则跳过）
  const deco = app.getDeco();
  if (deco) {
    const size = Math.min(vp.w, vp.h) * 0.18;
    ctx.save();
    ctx.globalAlpha = 0.52;
    ctx.drawImage(deco, vp.w - safe.right - 20 - size, vp.h - safe.bottom - 56 - size, size, size);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // §5.3 色弱 / 高对比 toggle（右上角 32×32 图标按钮，状态存 KVStore）
  const cbRect: Rect = { x: vp.w - safe.right - 12 - 32, y: safe.top + 8, w: 32, h: 32 };
  drawContrastIcon(ctx, cbRect, app.colorblind);
  hits.push({ rect: cbRect, action: () => app.toggleColorblind() });

  /* 「环游世界」重看入口（world-tour-reward §3.4「别省这个」）。
   * 门禁 = hasSeenWorldTour()：**看过之后**才常驻，所以它不会剧透 ——
   * 没全收集的玩家永远看不见它，第一次触发仍然是结算页那个唯一自动入口。
   * 位置取左上角，与右上角色弱 toggle 对称；标题光晕居中，此处是空的，不打架。
   * replay=true → 跳过开场 2s 主文案（§3.4）。 */
  if (app.meta.hasSeenWorldTour()) {
    const tourRect: Rect = { x: safe.left + 12, y: safe.top + 8, w: 32, h: 32 };
    drawPostcardIcon(ctx, tourRect);
    hits.push({ rect: tourRect, action: () => app.openWorldTour(true) });
  }

  // 合规提示（小字，fitText 约束窄屏不溢出，文案不变）
  fitText(
    ctx,
    '风格化几何识别，无真实钞币图 · 仅供文化学习',
    cx,
    vp.h - safe.bottom - 12,
    { align: 'center', size: 11, color: THEME.lockedInk, maxWidth: vp.w - 24 }
  );

  // toast 不在此绘制：已上提到 renderer.drawApp 末尾统一绘制（四视图通吃 + 永远最顶层）
}
