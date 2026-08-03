/**
 * render/card.ts — 卡牌绘制（纯 Canvas 2D，无 DOM）
 *
 * 四层识别码（对齐 GDD §6.3 / 美术策略 §2.9）：
 *   ① 区域徽标（白圆衬底 + 洲形状，coin 12 点 / note 右上角）
 *   ② 币符 glyph（每币唯一几何轮廓，角标；色弱模式下升为主识别通道，见 drawGlyphBadge）
 *   ③ 母题色块（签名色 fill，承载母题几何 / 母题 PNG）+ ISO 码（大字文本，权威身份）
 *   ④ 面额（数字 + 符号）
 * 物理形态（第 5 视觉轴）：coin=圆形裁剪；note=2:1 圆角矩形。
 * 合规：所有元素均为风格化几何 / 文本，绝不绘制或引用任何真实钞币图样、国旗、防伪元素。
 *       母题 PNG 仅作为「风格化母题质感层」可选叠加，缺失时退化几何占位。
 */

import { Ctx2DLike, Region, RegionShape, MotifCategory, GlyphKind, ImageLike } from '../platform/types';
import { REGION_STYLE } from '../data/currencies';
import { THEME, REGION_COLORS, BAND_COLORS, text, roundRectPath, fitText, withElevation, drawCover } from './theme';
import { drawGlyph } from './glyph';
import { Rect } from './layout';
import { CardVisual, CardDrawOpts } from './types';

/* ---------------- 重设计常量（coin-redesign-spec §A/§C/§D） ---------------- */

/** 母题全局微过扫：吃掉 alpha 裁切后残留的抗锯齿半透明边缘（§A2 路线 1 已完成裁切） */
const MOTIF_OVERSCAN = 1.02;
/** 硬币分档阈值（§C5）：R≥48 → T3 完整；30≤R<48 → T2 标准；R<30 → T1 微缩 */
const COIN_T3_R = 48;
const COIN_T2_R = 30;
/** 纸币分档阈值（§D7，按 faceH）：≥58 → T3；46–58 → T2；<46 → T1 */
const NOTE_T3_H = 58;
const NOTE_T2_H = 46;

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 浮雕文本：两遍 fitText（参数除 color/y 完全一致 → 字号必然相同，不错位）（§C3 ⑤ / §E6） */
function embossText(
  ctx: Ctx2DLike,
  label: string,
  x: number,
  y: number,
  size: number,
  maxWidth: number,
  minSize = 8
): void {
  const base = {
    size,
    weight: 'bold',
    align: 'center' as const,
    baseline: 'middle' as const,
    maxWidth,
    minSize,
  };
  fitText(ctx, label, x, y + 1, { ...base, color: 'rgba(0,0,0,0.42)' }); // 暗底遍
  fitText(ctx, label, x, y, { ...base, color: '#FDFAF3' });              // 主遍（奶油）
}

/** 币外名称行（§B3/§B4）：首选「ISO · 名称」，放不下退纯名称，fitText 兜底 */
function drawNameRow(ctx: Ctx2DLike, v: CardVisual, cx: number, nameY: number, nameH: number, maxW: number): void {
  const nameSz = Math.min(nameH * 0.8, 12);
  const full = `${v.iso} · ${v.name}`;
  ctx.font = `${nameSz}px ${FONT_FAMILY}`;
  const str = ctx.measureText(full).width <= maxW ? full : v.name;
  fitText(ctx, str, cx, nameY, {
    size: nameSz,
    color: THEME.ink,
    align: 'center',
    baseline: 'middle',
    maxWidth: maxW,
    minSize: 9,
  });
}

/* ---------------- 形状原语 ---------------- */

/** 区域形状（圆角矩形 / 六边形 / 菱形）路径，居中于 (cx,cy)，外接尺寸 size */
export function regionShapePath(
  ctx: Ctx2DLike,
  shape: RegionShape,
  cx: number,
  cy: number,
  size: number
): void {
  const h = size / 2;
  ctx.beginPath();
  if (shape === 'rounded_rect') {
    roundRectPath(ctx, cx - h, cy - h * 0.8, size, size * 0.8, size * 0.18);
  } else if (shape === 'hexagon') {
    const pts: [number, number][] = [
      [cx - h * 0.5, cy - h],
      [cx + h * 0.5, cy - h],
      [cx + h, cy],
      [cx + h * 0.5, cy + h],
      [cx - h * 0.5, cy + h],
      [cx - h, cy],
    ];
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  } else {
    // diamond
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + h, cy);
    ctx.lineTo(cx, cy + h);
    ctx.lineTo(cx - h, cy);
    ctx.closePath();
  }
}

/* ---------------- 色弱 / 高对比（Phase1 §5.3） ---------------- */

/** 色弱模式下 ISO 字号放大系数（§5.3 ①） */
const CB_ISO_SCALE = 1.25;

/**
 * §5.3 ③ 区域纹理带：8×8 重复 path，作为**非颜色通道**的第 4 条识别线索。
 *   amer = 圆点 / euro = 斜线 / asia_afr = 交叉线
 * 调用方负责把它放在「卡面顶部」，本函数自带 rect clip（与调用方已有 clip 求交），
 * 并铺一层半透明深色衬底，保证在任意底色（纸白 / 区域深带）上纹理都可见。
 * 纯 path、零资产、绘制期不使用 shadow。
 */
function drawRegionTexture(
  ctx: Ctx2DLike,
  region: Region,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  if (w <= 2 || h <= 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(58,58,56,0.34)';
  ctx.fillRect(x, y, w, h);

  const S = 8; // 8×8 重复单元
  const fg = 'rgba(253,250,243,0.88)';
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1;
  if (region === 'amer') {
    for (let px = x + S / 2; px < x + w; px += S) {
      for (let py = y + S / 2; py < y + h; py += S) {
        ctx.beginPath();
        ctx.arc(px, py, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (region === 'euro') {
    ctx.beginPath();
    for (let px = x - h; px < x + w; px += S) {
      ctx.moveTo(px, y + h);
      ctx.lineTo(px + h, y);
    }
    ctx.stroke();
  } else {
    ctx.beginPath();
    for (let px = x - h; px < x + w; px += S) {
      ctx.moveTo(px, y + h);
      ctx.lineTo(px + h, y);
    }
    for (let px = x; px < x + w + h; px += S) {
      ctx.moveTo(px, y + h);
      ctx.lineTo(px - h, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 角落区域徽标：白圆衬底 + 洲形状（区域色）。
 * stamp=true 时走「印章质感」（美术 §5.6）：区域色 0.15 圆底 + 区域色圆环，洲形状实心不变。
 * cb=true（§5.3 ②）：洲形状额外描边至 3px（按徽标半径夹逼），提升形状轮廓的非颜色可辨性。
 */
function drawRegionBadge(
  ctx: Ctx2DLike,
  region: Region,
  cx: number,
  cy: number,
  r: number,
  stamp = false,
  cb = false
): void {
  const col = REGION_COLORS[region];
  if (stamp) {
    // 印章底：区域色低透明圆底
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = 1;
    // 印章外环
    const lw = Math.max(1, Math.min(1.5, r * 0.14));
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.5, r - lw / 2), 0, Math.PI * 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = THEME.panel; // §D5：暖白衬底（原 #FFFFFF），与整体色调一致
    ctx.fill();
  }
  regionShapePath(ctx, REGION_STYLE[region].shape, cx, cy, r * 1.1);
  ctx.fillStyle = col;
  ctx.fill();
  if (cb) {
    // §5.3 ②：形状层描边加粗至 3px（徽标过小时按半径夹逼，避免糊成一坨）
    ctx.strokeStyle = THEME.ink;
    ctx.lineWidth = Math.min(3, Math.max(1, r * 0.45));
    ctx.stroke();
  }
}

/** 色弱模式下币符放大系数（§5.3 ⑤）：角标 → 主识别通道 */
const CB_GLYPH_SCALE = 1.7;
/** 币符衬盘相对 glyph 名义半径的外扩（留白，避免贴边糊在母题上） */
const GLYPH_DISC_K = 1.3;

/**
 * 币符角标（四层识别码 ②）：奶白小圆盘 + 币符。
 *
 * 普通模式：盘半透明（0.82）、币符用签名色 —— 与区域色呼应，存在感克制不抢母题。
 *   注意盘不可省：母题底就是签名色，签名色币符直接画上去会自我隐形。
 * 色弱模式：盘不透明、币符放大 ×1.7 且改深墨 —— 此时**完全不依赖颜色**，纯靠形状分币。
 *
 * @param rBase 普通模式名义半径；色弱模式内部自动 ×CB_GLYPH_SCALE
 * @param maxDisc 衬盘半径上限（调用方按可用空间给，避免撞徽标/面值牌）
 * @returns 实际衬盘半径（调用方可用于定位校验）
 */
function drawGlyphBadge(
  ctx: Ctx2DLike,
  kind: GlyphKind,
  cx: number,
  cy: number,
  rBase: number,
  color: string,
  cb: boolean,
  maxDisc = Infinity
): number {
  const wanted = (cb ? rBase * CB_GLYPH_SCALE : rBase) * GLYPH_DISC_K;
  const disc = Math.min(wanted, maxDisc);
  if (disc < 2) return 0; // 空间不足：宁可不画，也不画成一团糊
  const r = disc / GLYPH_DISC_K;

  ctx.save();
  // 衬盘
  ctx.beginPath();
  ctx.arc(cx, cy, disc, 0, Math.PI * 2);
  ctx.globalAlpha = cb ? 1 : 0.82;
  ctx.fillStyle = THEME.panel;
  ctx.fill();
  ctx.globalAlpha = 1;
  // 盘缘细线：让盘在浅色母题上也有边界（色弱下加重）
  ctx.beginPath();
  ctx.arc(cx, cy, disc, 0, Math.PI * 2);
  ctx.strokeStyle = cb ? 'rgba(58,58,56,0.38)' : 'rgba(58,58,56,0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 币符本体
  if (!cb) ctx.globalAlpha = 0.92;
  drawGlyph(ctx, kind, cx, cy, r, cb ? THEME.ink : color);
  ctx.globalAlpha = 1;
  ctx.restore();
  return disc;
}

/** 母题几何（≤4 primitive，扁平单色白；对应真钞母题类别但纯符号） */
function drawMotifGeometry(
  ctx: Ctx2DLike,
  category: MotifCategory,
  cx: number,
  cy: number,
  size: number
): void {
  ctx.save();
  ctx.strokeStyle = '#FFFFFF';
  ctx.fillStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(1.5, size * 0.08);
  ctx.lineJoin = 'round';
  if (category === 'portrait') {
    // 同心圆章 + 中心圆点（不画脸）
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (category === 'architecture') {
    // 拱券 + 梯形（桥/窗）
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.6, Math.PI, 0);
    ctx.lineTo(cx + size * 0.6, cy + size * 0.5);
    ctx.lineTo(cx - size * 0.6, cy + size * 0.5);
    ctx.closePath();
    ctx.stroke();
  } else if (category === 'animal') {
    // 极简动物剪影（负空间 blob）
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 0.05, size * 0.7, size * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // landscape：三角山 + 几点花
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.7, cy + size * 0.5);
    ctx.lineTo(cx, cy - size * 0.5);
    ctx.lineTo(cx + size * 0.7, cy + size * 0.5);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + size * 0.45, cy - size * 0.2, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + size * 0.62, cy + size * 0.0, size * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 母题缺失兜底（扩池 18 币中 10 枚尚无 Seedream 母题 PNG）：
 *   区域形状半透明填充（洲身份）+ **居中放大的币符 glyph**（币身份）。
 *
 * 为什么不是只画母题几何：母题几何只有 4 类（portrait/architecture/animal/landscape），
 * 同区同类的新币会长得一模一样；glyph 每币唯一，放大到盘心后缺图的牌依然「一眼认出是谁」，
 * 且与右上角标同形不同尺，形状线索互相印证（色弱通道同样成立）。
 * 无 glyph 的防御分支退回母题几何，保证任何数据都能画出东西、不崩。
 */
function drawMotifPlaceholder(
  ctx: Ctx2DLike,
  region: Region,
  glyph: GlyphKind | undefined,
  motif: MotifCategory,
  cx: number,
  cy: number,
  size: number
): void {
  if (!(size > 0)) return;
  if (!glyph) {
    drawMotifGeometry(ctx, motif, cx, cy, size);
    return;
  }
  ctx.save();
  // ① 区域形状：半透明白压在签名色底上 —— 洲形状可读，但不与 glyph 抢主次
  regionShapePath(ctx, REGION_STYLE[region].shape, cx, cy, size * 1.5);
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // ② 居中放大币符（与母题几何同一「扁平单色白」视觉语言）
  drawGlyph(ctx, glyph, cx, cy, size * 0.6, '#FFFFFF');
  ctx.restore();
}

/* ---------------- 卡背 / 未解锁剪影 ---------------- */

function drawBack(ctx: Ctx2DLike, rect: Rect, form: string): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  // §6.4 卡背受光：中性灰绿底 + 135° 受光渐变（白 0.18 → 黑 0.08）+ 1px 内缘亮线，'?' 保留
  if (form === 'coin') {
    const r = Math.min(rect.w, rect.h) / 2;
    withElevation(ctx, 'E2', r * 2, () => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = THEME.cardBack;
      ctx.fill();
    });
    const lit = ctx.createLinearGradient(cx - r * 0.7, cy - r * 0.7, cx + r * 0.7, cy + r * 0.7);
    lit.addColorStop(0, 'rgba(255,255,255,0.18)');
    lit.addColorStop(0.55, 'rgba(255,255,255,0.00)');
    lit.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = lit;
    ctx.fill();
    // 内缘亮线
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.5, r - 1.5), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
    ctx.strokeStyle = THEME.cardBackInk;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    const rr = rect.h * 0.1;
    withElevation(ctx, 'E2', rect.h, () => {
      roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rr);
      ctx.fillStyle = THEME.cardBack;
      ctx.fill();
    });
    const lit = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w * 0.7, rect.y + rect.h);
    lit.addColorStop(0, 'rgba(255,255,255,0.18)');
    lit.addColorStop(0.55, 'rgba(255,255,255,0.00)');
    lit.addColorStop(1, 'rgba(0,0,0,0.08)');
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rr);
    ctx.fillStyle = lit;
    ctx.fill();
    roundRectPath(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, Math.max(1, rr - 1));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  text(ctx, '?', cx, cy, {
    size: Math.min(rect.w, rect.h) * 0.42,
    color: THEME.cardBackInk,
    weight: 'bold',
    align: 'center',
    baseline: 'middle',
  });
}

function drawLocked(ctx: Ctx2DLike, rect: Rect, form: string): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  if (form === 'coin') {
    const r = Math.min(rect.w, rect.h) / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = THEME.locked;
    ctx.fill();
  } else {
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, rect.h * 0.1);
    ctx.fillStyle = THEME.locked;
    ctx.fill();
  }
  text(ctx, '?', cx, cy, {
    size: Math.min(rect.w, rect.h) * 0.42,
    color: THEME.lockedInk,
    weight: 'bold',
    align: 'center',
    baseline: 'middle',
  });
}

/* ---------------- 卡面（四层识别码） ---------------- */

function drawFace(
  ctx: Ctx2DLike,
  rect: Rect,
  v: CardVisual,
  image: ImageLike | null | undefined,
  showName = false,
  nameHIn?: number,
  cb = false
): void {
  if (v.form === 'coin') drawFaceCoin(ctx, rect, v, image, showName, cb);
  else drawFaceNote(ctx, rect, v, image, showName, nameHIn, cb);
}

function drawFaceCoin(
  ctx: Ctx2DLike,
  rect: Rect,
  v: CardVisual,
  image: ImageLike | null | undefined,
  showName = false,
  cb = false
): void {
  const cx = rect.x + rect.w / 2;
  // §B3：showName 时名称行在 rect 内部消化（cell 尺寸/命中矩形不变），硬币贴 cell 上缘
  const nameH = showName ? clamp(Math.min(rect.w, rect.h) * 0.16, 12, 18) : 0;
  const R = showName
    ? Math.min(rect.w, rect.h - nameH) / 2 - 1
    : Math.min(rect.w, rect.h) / 2;
  const cy = showName ? rect.y + 1 + R : rect.y + rect.h / 2;
  const inset = Math.max(2, R * 0.04);
  const Rin = R - inset; // 奶油内盘半径 = 母题绘制半径（§A1）

  // ① 区域色外环（景深 E2；阴影在 clip 之外，先画阴影底再画内容）
  withElevation(ctx, 'E2', R * 2, () => {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = REGION_COLORS[v.region];
    ctx.fill();
  });

  /* —— 金属材质层（美术 §4.1–4.3）：全局光源 135°（左上亮 / 右下暗）——
   * 全部为抽象渐变与描边弧线，无齿边、年份、铭文环等任何真实硬币构图引用。 */
  ctx.save();
  // §4.1 外环金属受光渐变（叠在同一全圆上，内盘随后覆盖中心，仅环带露出）
  const metal = ctx.createLinearGradient(cx - R * 0.7, cy - R * 0.7, cx + R * 0.7, cy + R * 0.7);
  metal.addColorStop(0, 'rgba(255,255,255,0.40)');
  metal.addColorStop(0.3, 'rgba(255,255,255,0.10)');
  metal.addColorStop(0.55, 'rgba(0,0,0,0.00)');
  metal.addColorStop(1, 'rgba(0,0,0,0.20)');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = metal;
  ctx.fill();

  // §4.2a 币缘外阴影线（厚度）
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.5, R - 0.75), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = Math.max(1, R * 0.018);
  ctx.stroke();

  // §4.4 内盘微穹面（奶油内盘：平涂 → 径向渐变）
  const dish = ctx.createRadialGradient(cx - R * 0.15, cy - R * 0.18, R * 0.1, cx, cy, Math.max(0.6, R - inset));
  dish.addColorStop(0, '#FDFAF3');
  dish.addColorStop(0.7, '#F6F0E2');
  dish.addColorStop(1, '#EFE7D6');
  ctx.beginPath();
  ctx.arc(cx, cy, R - inset, 0, Math.PI * 2);
  ctx.fillStyle = dish;
  ctx.fill();

  // §4.2b 内缘高光线 + 第三道暗线（高光-暗线对 = 倒角成立）
  ctx.beginPath();
  ctx.arc(cx, cy, R - inset + 0.75, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.50)';
  ctx.lineWidth = Math.max(1, R * 0.015);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.5, R - inset - 1), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // §4.3 金属光泽双弧：主弧（左上受光）+ 副弧（右下回光）
  const arcR = R - inset * 0.5;
  const arcW = Math.max(1.5, R * 0.03);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, Math.PI * 1.08, Math.PI * 1.48);
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = arcW;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, Math.PI * 0.12, Math.PI * 0.38);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = arcW * 0.7;
  ctx.stroke();
  ctx.restore();

  // ② 母题满盘（§A1/§A3）：与内盘同心，cover 裁剪不拉伸，签名色兜底
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, Rin, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = v.signature;
  ctx.fillRect(cx - Rin, cy - Rin, Rin * 2, Rin * 2);
  if (image) {
    // 母题 PNG 仅在 loadImage 成功后才会被传进来（失败已在 app 层 catch 吞掉）
    const d = Rin * 2 * MOTIF_OVERSCAN;
    drawCover(ctx, image, cx - d / 2, cy - d / 2, d, d);
  } else {
    // 缺图 → 区域形状 + 放大币符占位（几何占位同步放大，§X9）
    drawMotifPlaceholder(ctx, v.region, v.glyph, v.motif, cx, cy, Rin * 0.78);
  }
  ctx.restore();

  // §4.5 母题盘「珐琅镶嵌」内阴影：暗线压内侧 + 下沿反光弧（半径 mr → Rin，线宽系数 0.05 → 0.035）
  ctx.save();
  const elw = Math.max(1.5, Rin * 0.035);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.5, Rin - elw / 2), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = elw;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.5, Rin - elw), Math.PI * 0.15, Math.PI * 0.85);
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = Math.max(1, Rin * 0.03);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

  /* —— 分档（§C5）：T3 完整（R≥48）/ T2 标准（30≤R<48）/ T1 微缩（R<30）—— */
  const tier = R >= COIN_T3_R ? 3 : R >= COIN_T2_R ? 2 : 1;

  // §5.3 ③ 色弱纹理带：T1/T2 无顶部身份带 → 直接铺在内盘顶部（T3 铺在身份带内，见下）
  if (cb && tier < 3) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, Rin, 0, Math.PI * 2);
    ctx.clip();
    drawRegionTexture(ctx, v.region, cx - Rin, cy - Rin, Rin * 2, Math.max(6, Rin * 0.22));
    ctx.restore();
  }

  if (tier >= 2) {
    // ④ 面值印压带（§C2/C3）：弦带 = clip(圆 Rin) ∩ clip(下缘矩形)，区域色压深 + 浮雕数字
    const t = Math.max(11, R * 0.32);
    const yTop = cy + Rin - t;
    const textY = yTop + t * 0.52;
    const dyBand = textY - cy;
    const maxW = 2 * Math.sqrt(Math.max(1, Rin * Rin - dyBand * dyBand)) * 0.86;
    const fontSz = clamp(t * 0.68, 8, 14);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, Rin, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(cx - Rin, yTop, Rin * 2, t + 2);
    ctx.clip();
    // 带底：区域色压深两档
    ctx.fillStyle = BAND_COLORS[v.region];
    ctx.fillRect(cx - Rin, yTop, Rin * 2, t + 2);
    // 带面受光（135° 全局光源）
    const bg = ctx.createLinearGradient(cx - Rin * 0.5, yTop, cx + Rin * 0.5, yTop + t);
    bg.addColorStop(0, 'rgba(255,255,255,0.18)');
    bg.addColorStop(0.5, 'rgba(255,255,255,0.00)');
    bg.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = bg;
    ctx.fillRect(cx - Rin, yTop, Rin * 2, t + 2);
    // 压印上唇：暗线 + 亮线
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(cx - Rin, yTop, Rin * 2, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillRect(cx - Rin, yTop + 1, Rin * 2, 1);
    ctx.restore();

    // 浮雕数字（两遍 fitText）
    embossText(ctx, v.denom + ' ' + v.denomSymbol, cx, textY, fontSz, maxW);
  }

  if (tier === 3) {
    // ③ 顶部身份带（§C5 T3）：底带镜像弦带，内容 = 区域徽标 + ISO 居中成组
    const tTop = Math.max(10, R * 0.27);
    const yBot = cy - Rin + tTop;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, Rin, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(cx - Rin, cy - Rin - 2, Rin * 2, tTop + 2);
    ctx.clip();
    ctx.fillStyle = BAND_COLORS[v.region];
    ctx.fillRect(cx - Rin, cy - Rin - 2, Rin * 2, tTop + 2);
    const tg = ctx.createLinearGradient(cx - Rin * 0.5, cy - Rin, cx + Rin * 0.5, yBot);
    tg.addColorStop(0, 'rgba(255,255,255,0.18)');
    tg.addColorStop(0.5, 'rgba(255,255,255,0.00)');
    tg.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = tg;
    ctx.fillRect(cx - Rin, cy - Rin - 2, Rin * 2, tTop + 2);
    // 压印下唇（镜像）：亮线 + 暗线
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillRect(cx - Rin, yBot - 2, Rin * 2, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(cx - Rin, yBot - 1, Rin * 2, 1);
    // §5.3 ③ 纹理带铺在身份带内（仍在 clip 内），徽标/ISO 随后绘制于其上，不损可读性
    if (cb) drawRegionTexture(ctx, v.region, cx - Rin, cy - Rin - 2, Rin * 2, tTop + 2);
    ctx.restore();

    // 徽标 + ISO 水平居中成组（徽标直径 tTop*0.66，间距 tTop*0.18）
    const badgeD = tTop * 0.66;
    const gap = tTop * 0.18;
    // §5.3 ① 色弱：ISO 字号 ×1.25（上限同步放宽，仍受 fitText 与弦宽兜底约束）
    const isoSz = cb ? clamp(tTop * 0.58 * CB_ISO_SCALE, 10, 16) : clamp(tTop * 0.58, 9, 13);
    const groupY = yBot - tTop * 0.52; // 弦带上窄，光学中心略靠下
    ctx.font = `bold ${isoSz}px ${FONT_FAMILY}`;
    const isoW = ctx.measureText(v.iso).width;
    const groupW = badgeD + gap + isoW;
    const startX = cx - groupW / 2;
    drawRegionBadge(ctx, v.region, startX + badgeD / 2, groupY, badgeD / 2, false, cb);
    embossText(ctx, v.iso, startX + badgeD + gap + isoW / 2, groupY, isoSz, Rin * 2 * 0.8, 8);
  } else if (tier === 2) {
    // ① 区域徽标：保留 12 点（§C5 T2）；ISO 走币外名称行
    const br = R * 0.15;
    drawRegionBadge(ctx, v.region, cx, cy - R + br * 0.9, br, false, cb);
  }
  // T1（Codex 槽）：币面无文本、无徽标——身份由上下文文本承担（§C5）

  /* ② 币符角标：内盘右上（-35°），落在顶部身份带下缘与面值弦带之间的净空区，
   *    不压母题中心。所有分档恒绘制（T1 微缩槽位下它就是唯一的图形身份线索）。 */
  if (v.glyph) {
    const gAng = -Math.PI * 0.195; // ≈ -35°：比 45° 更靠右下，避开 T3 顶部身份带
    const gDisc = (cb ? Rin * 0.17 * CB_GLYPH_SCALE : Rin * 0.17) * GLYPH_DISC_K;
    const gDist = Math.max(0, Rin - gDisc - Rin * 0.06); // 贴内盘边缘留一线呼吸
    drawGlyphBadge(
      ctx,
      v.glyph,
      cx + Math.cos(gAng) * gDist,
      cy + Math.sin(gAng) * gDist,
      Rin * 0.17,
      v.signature,
      cb
    );
  }

  // 币外名称行（§B3，仅 Board showName=true）
  if (showName && nameH > 0) {
    drawNameRow(ctx, v, cx, rect.y + rect.h - nameH * 0.5, nameH, rect.w * 0.96);
  }
}

function drawFaceNote(
  ctx: Ctx2DLike,
  rect: Rect,
  v: CardVisual,
  image: ImageLike | null | undefined,
  showName = false,
  nameHIn?: number,
  cb = false
): void {
  // §B4：note 2:1 是硬比例，名称行加在卡面之外（layout 已把 rect.h 扩为 faceH + nameH）
  const nameH = showName ? nameHIn ?? clamp(rect.w * 0.11, 11, 16) : 0;
  const faceH = rect.h - nameH;
  const inset = Math.max(3, faceH * 0.05);
  const radius = faceH * 0.1;

  // ① 区域色边框带（景深 E2 = §5.5 厚度投影加深一档：blur h*0.10 / dy h*0.035）
  //    注：§5.1「边框收窄」未采用——4×4 棋盘上三区域一眼区分度优先，保留现有边带宽度，
  //        角标印章（§5.6）作为识别性的第二保险（文档默认「双保险」方案）。
  withElevation(ctx, 'E2', faceH, () => {
    roundRectPath(ctx, rect.x, rect.y, rect.w, faceH, radius);
    ctx.fillStyle = REGION_COLORS[v.region];
    ctx.fill();
  });

  /* —— 纸张材质层（美术 §5.2 / §5.4）——
   * 合规：无水印、安全线、凹版底纹、缩微文字、团花等任何防伪语言；
   *      「印刷感」仅由暖纸渐变 + 双细线装饰内框构成。 */
  const ix = rect.x + inset;
  const iy = rect.y + inset;
  const iw = rect.w - inset * 2;
  const ih = faceH - inset * 2;

  // §5.2 暖白纸基渐变（165° 近垂直，左上亮右下暗，与全局 135° 光照一致）
  const paper = ctx.createLinearGradient(ix, iy, ix + iw * 0.15, iy + ih);
  paper.addColorStop(0, '#FBF7EE');
  paper.addColorStop(0.6, '#F6EEDD');
  paper.addColorStop(1, '#F0E8D6');
  roundRectPath(ctx, ix, iy, iw, ih, radius * 0.7);
  ctx.fillStyle = paper;
  ctx.fill();

  // §5.4 双细线印刷内框（外线区域色 0.45 / 内线墨 0.16，间隙即「印刷装订留白」；四角无花纹）
  const f1 = Math.min(4, ih * 0.1);
  const f2 = f1 + Math.min(2.5, ih * 0.06);
  if (iw - f2 * 2 > 6 && ih - f2 * 2 > 6) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = REGION_COLORS[v.region];
    roundRectPath(ctx, ix + f1, iy + f1, iw - f1 * 2, ih - f1 * 2, Math.max(1, radius * 0.7 - f1));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(58,58,56,0.16)';
    roundRectPath(ctx, ix + f2, iy + f2, iw - f2 * 2, ih - f2 * 2, Math.max(1, radius * 0.7 - f2));
    ctx.stroke();
    ctx.restore();
  }

  // ② 印刷视窗放大到整个双细线内框（§D1），母题 cover 满铺（§D2，修拉伸 bug）
  const bandX = ix + f2;
  const bandY = iy + f2;
  const bandW = iw - f2 * 2;
  const bandH = ih - f2 * 2;
  ctx.save();
  roundRectPath(ctx, bandX, bandY, bandW, bandH, bandH * 0.22);
  ctx.clip();
  ctx.fillStyle = v.signature;
  ctx.fillRect(bandX, bandY, bandW, bandH);
  if (image) {
    // 母题 PNG 仅在 loadImage 成功后才会被传进来（失败已在 app 层 catch 吞掉）
    drawCover(ctx, image, bandX, bandY, bandW, bandH);
  } else {
    // 缺图兜底与硬币形态同策略：区域形状 + 放大 glyph，双形态识别线索一致
    drawMotifPlaceholder(
      ctx,
      v.region,
      v.glyph,
      v.motif,
      bandX + bandW * 0.5,
      bandY + bandH * 0.5,
      Math.min(bandW, bandH) * 0.42
    );
  }
  ctx.restore();

  // §5.6 印刷视窗描边：暗线压内侧 + 外侧纸色亮线 =「凹进纸面的印刷图版」
  ctx.save();
  const wlw = Math.max(1, Math.min(1.5, bandH * 0.05));
  roundRectPath(ctx, bandX + wlw / 2, bandY + wlw / 2, bandW - wlw, bandH - wlw, bandH * 0.22);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = wlw;
  ctx.stroke();
  roundRectPath(ctx, bandX - 0.5, bandY - 0.5, bandW + 1, bandH + 1, bandH * 0.22 + 0.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.40)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // §5.3 ③ 色弱纹理带：铺在印刷视窗顶部（clip 到视窗圆角内），身份牌/徽标随后绘制其上
  if (cb) {
    ctx.save();
    roundRectPath(ctx, bandX, bandY, bandW, bandH, bandH * 0.22);
    ctx.clip();
    drawRegionTexture(ctx, v.region, bandX, bandY, bandW, Math.max(6, bandH * 0.22));
    ctx.restore();
  }

  /* —— 分档（§D7，按 faceH）：T3 ≥58 全要素 / T2 46–58 省 ISO 牌 / T1 <46 仅母题 —— */
  const tier = faceH >= NOTE_T3_H ? 3 : faceH >= NOTE_T2_H ? 2 : 1;

  if (tier >= 2) {
    // ① 区域徽标：移入视窗右上角，奶油实心衬底（§D5，stamp=false）
    const br = bandH * 0.17;
    drawRegionBadge(ctx, v.region, bandX + bandW - bandH * 0.12 - br, bandY + bandH * 0.12 + br, br, false, cb);

    // ④ 面额 →「印压面值牌」：视窗右下角（§D3）
    drawNoteChip(
      ctx,
      v.denom + ' ' + v.denomSymbol,
      v.region,
      clamp(bandH * 0.34, 11, 20),
      bandX,
      bandY,
      bandW,
      bandH,
      'br'
    );
  }
  if (tier === 3) {
    // ③ ISO →「印压身份牌」：视窗左上角，比面值牌小一档（§D4）
    // §5.3 ① 色弱：ISO 牌整体放大 ×1.25（牌高驱动字号，embossText 内部 fitText 兜底不溢出）
    const isoChipH = cb ? clamp(bandH * 0.28 * CB_ISO_SCALE, 11, 21) : clamp(bandH * 0.28, 10, 17);
    drawNoteChip(ctx, v.iso, v.region, isoChipH, bandX, bandY, bandW, bandH, 'tl');
  }
  /* ② 币符角标：视窗右上，紧靠区域徽标左侧 —— 区域形状与币种形状并排成组，
   *    「先看洲、再看币」两个纯形状通道一次读完。恒绘制（含 T1 微缩槽）。
   *    衬盘半径按可用空间夹逼：右界=徽标左缘，左界=视窗 40% 处（护住 ISO 牌）。 */
  if (v.glyph) {
    const gbr = bandH * 0.17;                                   // 徽标半径（与上方一致）
    const badgeCx = bandX + bandW - bandH * 0.12 - gbr;
    const rightLimit = tier >= 2 ? badgeCx - gbr - bandH * 0.05 // 徽标已画 → 让位
                                 : bandX + bandW - bandH * 0.10; // T1 无徽标 → 直接占角
    const leftLimit = bandX + bandW * 0.4;
    const maxDisc = Math.max(0, (rightLimit - leftLimit) / 2);
    const gBase = bandH * 0.14;
    const wantDisc = Math.min((cb ? gBase * CB_GLYPH_SCALE : gBase) * GLYPH_DISC_K, maxDisc);
    const gcx = rightLimit - wantDisc;
    // 垂直：与徽标同高；色弱放大后夹回视窗内，避免溢出圆角
    const gcy = Math.min(
      Math.max(bandY + bandH * 0.12 + gbr, bandY + wantDisc + 1),
      bandY + bandH - wantDisc - 1
    );
    drawGlyphBadge(ctx, v.glyph, gcx, gcy, gBase, v.signature, cb, maxDisc);
  }

  // T1（Codex 槽）：仅满铺母题 + 区域色边框带 + 双细线内框，无视窗内文本（§D7）

  // 币外名称行（§B4，仅 Board showName=true）：note cell 外下方
  if (showName && nameH > 0) {
    drawNameRow(ctx, v, rect.x + rect.w / 2, rect.y + rect.h - nameH * 0.5, nameH, rect.w * 0.96);
  }
}

/** 印压小牌（§D3/D4）：区域深色底 + 受光渐变 + 唇线 + 浮雕文本，pos='br' 右下 / 'tl' 左上 */
function drawNoteChip(
  ctx: Ctx2DLike,
  label: string,
  region: Region,
  chipH: number,
  bandX: number,
  bandY: number,
  bandW: number,
  bandH: number,
  pos: 'br' | 'tl'
): void {
  const chipFs = clamp(chipH * 0.62, 8, 13);
  ctx.font = `bold ${chipFs}px ${FONT_FAMILY}`;
  const chipW = ctx.measureText(label).width + chipH * 0.8; // 左右各 0.4*chipH 内边距
  const margin = bandH * 0.1;
  const chipX = pos === 'br' ? bandX + bandW - margin - chipW : bandX + margin;
  const chipY = pos === 'br' ? bandY + bandH - margin - chipH : bandY + margin;
  const r = chipH * 0.32;

  // 牌底 + 受光渐变（与硬币面值带同一套材质语言，135° 光源）
  roundRectPath(ctx, chipX, chipY, chipW, chipH, r);
  ctx.fillStyle = BAND_COLORS[region];
  ctx.fill();
  const g = ctx.createLinearGradient(chipX, chipY, chipX + chipW * 0.5, chipY + chipH);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.00)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  roundRectPath(ctx, chipX, chipY, chipW, chipH, r);
  ctx.fillStyle = g;
  ctx.fill();
  // 上唇暗线 + 下唇亮线（沿 chip 内缘，clip 到圆角内避免溢角）
  ctx.save();
  roundRectPath(ctx, chipX, chipY, chipW, chipH, r);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.fillRect(chipX, chipY, chipW, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(chipX, chipY + chipH - 1, chipW, 1);
  ctx.restore();
  // 浮雕文本（两遍 fitText）
  embossText(ctx, label, chipX + chipW / 2, chipY + chipH / 2, chipFs, chipW - chipH * 0.5);
}

/* ---------------- 对外入口 ---------------- */

export function drawCard(ctx: Ctx2DLike, opts: CardDrawOpts): void {
  const { rect, visual, faceUp } = opts;
  const flip = opts.flipScaleX;

  ctx.save();
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  // 翻牌动画：绕中心水平挤压（侧边临界时只画牌脊）
  if (flip !== undefined) {
    ctx.translate(cx, cy);
    ctx.scale(flip, 1);
    ctx.translate(-cx, -cy);
  }
  if (flip !== undefined && Math.abs(flip) < 0.05) {
    ctx.fillStyle = THEME.cardBackInk;
    ctx.fillRect(cx - 1, rect.y + 4, 2, rect.h - 8);
    ctx.restore();
    return;
  }

  if (opts.locked) {
    drawLocked(ctx, rect, visual.form);
  } else if (!faceUp) {
    drawBack(ctx, rect, visual.form);
  } else {
    drawFace(ctx, rect, visual, opts.image, opts.showName ?? false, opts.nameH, opts.colorblind ?? false);
  }
  ctx.restore();
}
