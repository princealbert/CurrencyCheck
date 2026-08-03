/**
 * render/theme.ts — 颜色常量与文本/绘制辅助（无 DOM，纯 ctx 原语）
 *
 * 调性：Soft Blur Pastel（奶油白 / 陶土红 / 青绿 / 金），对齐美术策略。
 * 合规：此处所有颜色均为风格化数据，无任何真实钞币色值引用。
 */

import { Ctx2DLike, ImageLike, Region } from '../platform/types';
import { Rect } from './layout';

export const THEME = {
  bg: '#F8F5F0',          // 奶油白
  ink: '#3A3A38',         // 深墨（文本 ≥ WCAG AA）
  cream: '#F8F5F0',
  terracotta: '#D89575',  // 陶土红
  teal: '#87A878',        // 青绿
  gold: '#E0B15E',        // 金
  panel: '#FDFBF6',       // 暖白面板（原 #FFFFFF，美术 §6.4：从「App 白」滑向「手账纸白」）
  panelLine: '#E3D9C6',   // 暖白面板描边（原 #E7E1D6）
  cardBack: '#D7DEDA',    // 卡背（中性，无币种身份）
  cardBackInk: '#5E6B63',
  locked: '#CFCBC2',      // 未解锁剪影
  lockedInk: '#928D83',
  shadow: 'rgba(58,58,56,0.14)',
  good: '#5E8C6A',
};

export const REGION_COLORS: Record<Region, string> = {
  amer: '#E0B15E',
  euro: '#5B8FB0',
  asia_afr: '#87A878',
};

/**
 * 面值印压带底色（coin-redesign-spec §C4）：REGION_COLORS 压深两档（×0.62），
 * 保证奶油浮雕字 #FDFAF3 对比度 ≥ 4.5:1（WCAG AA）。
 */
export const BAND_COLORS: Record<Region, string> = {
  amer: '#8B6E3A',
  euro: '#38596D',
  asia_afr: '#54684A',
};

export interface TextOpts {
  size?: number;
  color?: string;
  weight?: string;        // 'normal' | 'bold'
  align?: CanvasTextAlignLike;
  baseline?: CanvasTextBaselineLike;
  font?: string;          // 完整 font-family 覆盖
  maxWidth?: number;      // 新增：传入则约束不溢出（走 fitText 等比缩字号/省略）
}

export interface FitTextOpts extends TextOpts {
  /** 缩字号下限，默认 9px */
  minSize?: number;
  /** 缩到下限仍放不下时是否末尾省略号「…」截断，默认 true */
  ellipsis?: boolean;
}

// 小游戏 Canvas 2D 的 textAlign/textBaseline 类型与标准一致，这里用宽松别名
type CanvasTextAlignLike = 'left' | 'center' | 'right' | 'start' | 'end';
type CanvasTextBaselineLike = 'top' | 'middle' | 'bottom' | 'alphabetic' | 'hanging';

/** 文本绘制辅助：默认 Noto Sans SC 回退系统 sans，保证中英文一致 */
export function text(
  ctx: Ctx2DLike,
  str: string,
  x: number,
  y: number,
  opts: TextOpts = {}
): void {
  // 传入 maxWidth 时走「测量后绘制」约束逻辑，保证不溢出
  if (opts.maxWidth && opts.maxWidth > 0) {
    fitText(ctx, str, x, y, opts.maxWidth, opts);
    return;
  }
  const size = opts.size ?? 16;
  const weight = opts.weight ?? 'normal';
  const family = opts.font ?? '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = opts.color ?? THEME.ink;
  ctx.textAlign = (opts.align ?? 'left') as string;
  ctx.textBaseline = (opts.baseline ?? 'alphabetic') as string;
  ctx.fillText(str, x, y);
}

/**
 * fitText：先按给定 size 测量，超出 maxWidth 则等比缩字号到能放下（下限 minSize，默认 9px）；
 * 缩到下限仍放不下则末尾加省略号「…」截断。返回实际生效的字号（px）。
 * 覆盖所有自由文本（卡面 ISO/面额、Hub 标题、图鉴/详情币种名等），保证窄屏不溢出。
 */
export function fitText(
  ctx: Ctx2DLike,
  str: string,
  x: number,
  y: number,
  maxWidthOrOpts: number | FitTextOpts,
  maybeOpts: FitTextOpts = {}
): number {
  // 兼容两种调用：fitText(ctx,s,x,y, maxWidth, opts) 与 fitText(ctx,s,x,y, { ...opts, maxWidth })
  const positional = typeof maxWidthOrOpts === 'number';
  const opts = positional ? maybeOpts : maxWidthOrOpts;
  const maxWidth = positional ? (maxWidthOrOpts as number) : opts.maxWidth ?? 0;
  const size = opts.size ?? 16;
  const weight = opts.weight ?? 'normal';
  const family = opts.font ?? '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  const minSize = Math.max(1, opts.minSize ?? 9);
  const align = (opts.align ?? 'left') as string;
  const baseline = (opts.baseline ?? 'alphabetic') as string;
  const color = opts.color ?? THEME.ink;
  const ellipsis = opts.ellipsis ?? true;

  ctx.font = `${weight} ${size}px ${family}`;
  let draw = str;

  // ① 超出则按宽度等比缩字号（线性近似），夹到下限
  if (maxWidth > 0 && ctx.measureText(draw).width > maxWidth) {
    const measured = ctx.measureText(draw).width;
    const fitted = Math.max(minSize, Math.floor(size * (maxWidth / measured)));
    ctx.font = `${weight} ${fitted}px ${family}`;
  }

  // ② 缩到最小仍放不下 → 末尾省略号「…」截断
  if (maxWidth > 0 && ellipsis && ctx.measureText(draw).width > maxWidth) {
    const tail = '…';
    let cut = draw;
    while (cut.length > 0 && ctx.measureText(cut + tail).width > maxWidth) {
      cut = cut.slice(0, -1);
    }
    draw = cut + tail;
  }

  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(draw, x, y);

  // 返回实际生效字号
  const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
  return m ? parseFloat(m[1]) : size;
}

/**
 * wrapText：按字符累加宽度换行（中文友好，无空格也能断行）。
 * 原位于 detail.ts，提为公共辅助供 detail / 胜利结算等复用。
 */
export function wrapText(ctx: Ctx2DLike, str: string, maxWidth: number, font: string): string[] {
  ctx.font = font;
  const lines: string[] = [];
  let line = '';
  for (const ch of str) {
    const test = line + ch;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 圆角矩形路径（小游戏兼容：不用 ctx.roundRect） */
export function roundRectPath(
  ctx: Ctx2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/* ---------------- 共享装饰原语（纯 path，零资产） ---------------- */

/** 金色菱形（标题装饰 / toast 行首标记，§6.1 降级方案；不使用字符） */
export function drawGoldDiamond(ctx: Ctx2DLike, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.62, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.62, cy);
  ctx.closePath();
  ctx.fillStyle = THEME.gold;
  ctx.fill();
}

/**
 * 五角星 10 点 path（Phase1 §2.5 星评绘制，纯 path、零资产）。
 * filled=true → 实心 THEME.gold；false → 空心描边（THEME.locked，1.5px）。
 */
export function drawStar(
  ctx: Ctx2DLike,
  cx: number,
  cy: number,
  r: number,
  filled: boolean,
  color?: string
): void {
  const inner = r * 0.42;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = color ?? THEME.gold;
    ctx.fill();
  } else {
    ctx.strokeStyle = color ?? THEME.locked;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** 一排星（已获实心 / 未获空心），返回占用总宽 */
export function drawStarRow(
  ctx: Ctx2DLike,
  cx: number,
  cy: number,
  r: number,
  earned: number,
  total = 3,
  gap = r * 0.6
): number {
  const step = r * 2 + gap;
  const totalW = step * total - gap;
  const startX = cx - totalW / 2 + r;
  for (let i = 0; i < total; i++) {
    drawStar(ctx, startX + i * step, cy, r, i < earned);
  }
  return totalW;
}

export interface ButtonOpts {
  bg?: string;
  fg?: string;
  active?: boolean;     // 选中态：青绿描边
  sub?: string;         // 副标题（小字）
  fontSize?: number;
  shadow?: boolean;     // 柔和投影（仅作用于背景，文字不带阴影）
}

/* ---------------- 柔和投影辅助 ----------------
 * 注意：Ctx2DLike 接口未暴露 shadow* 属性（为保持平台适配层不变），
 * 这里用本地类型增强 + 运行时 cast 访问真实 Canvas 2D 的 shadow 原语。
 * 任何启用阴影的绘制都必须 reset（shadowBlur=0），避免污染后续绘制。
 */
type CtxWithShadow = Ctx2DLike & {
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
};

function asShadowed(ctx: Ctx2DLike): CtxWithShadow {
  return ctx as CtxWithShadow;
}

export function setShadow(ctx: Ctx2DLike, color: string, blur: number, dx = 0, dy = 0): void {
  const c = asShadowed(ctx);
  c.shadowColor = color;
  c.shadowBlur = blur;
  c.shadowOffsetX = dx;
  c.shadowOffsetY = dy;
}

export function clearShadow(ctx: Ctx2DLike): void {
  const c = asShadowed(ctx);
  c.shadowColor = 'transparent';
  c.shadowBlur = 0;
  c.shadowOffsetX = 0;
  c.shadowOffsetY = 0;
}

/** 在 fn 绘制期间启用柔和投影，绘制后（finally）重置，避免污染后续绘制 */
export function withShadow<TRet>(
  ctx: Ctx2DLike,
  color: string,
  blur: number,
  dy: number,
  fn: () => TRet
): TRet {
  setShadow(ctx, color, blur, 0, dy);
  try {
    return fn();
  } finally {
    clearShadow(ctx);
  }
}

/* ---------------- 景深投影阶梯（美术 §6.3） ----------------
 * E1 静置：面板、按钮、书架卡 / E2 卡牌：Board 卡、Hub 入口大按钮 / E3 聚焦：Detail 大卡、胜利面板。
 * 规则：同一视图内最多出现两级。blur/dy 均按元素高度 h 取系数并夹下限。
 */
export const ELEVATION = {
  E1: { blurK: 0.08, blurMin: 3, dyK: 0.02, dyMin: 1.5, color: THEME.shadow },
  E2: { blurK: 0.1, blurMin: 4, dyK: 0.035, dyMin: 2.5, color: THEME.shadow },
  E3: { blurK: 0.14, blurMin: 8, dyK: 0.05, dyMin: 4, color: 'rgba(58,58,56,0.20)' },
} as const;

export type ElevationLevel = keyof typeof ELEVATION;

/** 按景深层级施加投影绘制（内部走 withShadow，绘制后自动重置） */
export function withElevation<TRet>(
  ctx: Ctx2DLike,
  level: ElevationLevel,
  h: number,
  fn: () => TRet
): TRet {
  const e = ELEVATION[level];
  return withShadow(ctx, e.color, Math.max(e.blurMin, h * e.blurK), Math.max(e.dyMin, h * e.dyK), fn);
}

/* ---------------- 场景底（美术 §3.1–3.4） ----------------
 * paper = 暖手账纸（Hub / Codex / Detail），table = 桌面绒底（Board）。
 * 仅渐变 + 暗角；颗粒瓦片需离屏 canvas（平台层能力），留二期。
 */
export type BackdropKind = 'paper' | 'table';

export function drawBackdrop(ctx: Ctx2DLike, vp: { w: number; h: number }, kind: BackdropKind): void {
  const base = ctx.createLinearGradient(0, 0, 0, vp.h);
  if (kind === 'table') {
    base.addColorStop(0, '#F0E9DB');
    base.addColorStop(0.5, '#EDE6D8');
    base.addColorStop(1, '#E6DCC9');
  } else {
    base.addColorStop(0, '#F3E9D8');
    base.addColorStop(0.55, '#EDE0C8');
    base.addColorStop(1, '#E8D9BE');
  }
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, vp.w, vp.h);

  // 暗角：Board 较重（收视线进牌桌），纸底极轻（封面聚光）
  const diag = Math.sqrt(vp.w * vp.w + vp.h * vp.h);
  let vg;
  if (kind === 'table') {
    const cx = vp.w / 2;
    const cy = vp.h / 2;
    vg = ctx.createRadialGradient(cx, cy, diag * 0.3, cx, cy, diag * 0.5);
    vg.addColorStop(0, 'rgba(58,58,56,0)');
    vg.addColorStop(1, 'rgba(58,58,56,0.10)');
  } else {
    const cx = vp.w / 2;
    const cy = vp.h * 0.42;
    vg = ctx.createRadialGradient(cx, cy, Math.min(vp.w, vp.h) * 0.45, cx, cy, diag * 0.75);
    vg.addColorStop(0, 'rgba(90,70,40,0)');
    vg.addColorStop(1, 'rgba(90,70,40,0.06)');
  }
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, vp.w, vp.h);
}

/**
 * drawCover：cover 铺满 + 居中（scene-backgrounds-spec §3.2 / coin-redesign-spec §A3）。
 * 只用 Ctx2DLike 的 5 参 drawImage；超出目标框的溢出由调用方的 clip（或画布边界）裁掉。
 * 供场景底图与卡面母题共用。
 */
export function drawCover(
  ctx: Ctx2DLike,
  img: ImageLike,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  if (!img.width || !img.height) return;
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** drawScene 选项（scene-backgrounds-spec §3.1/§3.3）：L1 底图 α / L2 奶油膜 / L3 暗角 */
export interface SceneOpts {
  alpha: number;
  veil: number;
  vignette: number;
  /** 暗角色（不带 alpha 的 rgba 前缀由此给出），默认深墨；Hub 用暖褐 */
  vignetteColor?: string;
  /** 暗角圆心/半径策略：'hub' = (w/2, h*0.42) 起 min(w,h)*0.45 → 对角线*0.75；默认屏幕中心 0.30–0.50 对角线 */
  vignetteKind?: 'hub' | 'center';
}

/**
 * drawScene：场景底图合成（L1 cover 底图 → L2 奶油统一膜 → L3 径向暗角）。
 * L0（drawBackdrop）由调用方先行绘制作兜底；img 缺失时调用方直接跳过本函数。
 */
export function drawScene(
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  img: ImageLike,
  opts: SceneOpts
): void {
  // L1 底图 cover 全屏
  ctx.save();
  ctx.globalAlpha = opts.alpha;
  drawCover(ctx, img, 0, 0, vp.w, vp.h);
  ctx.restore();
  ctx.globalAlpha = 1;

  // L2 奶油统一膜（拉回调色板）
  if (opts.veil > 0) {
    ctx.fillStyle = `rgba(248,245,240,${opts.veil})`;
    ctx.fillRect(0, 0, vp.w, vp.h);
  }

  // L3 视图暗角
  if (opts.vignette > 0) {
    const diag = Math.sqrt(vp.w * vp.w + vp.h * vp.h);
    let vg;
    if (opts.vignetteKind === 'hub') {
      const cx = vp.w / 2;
      const cy = vp.h * 0.42;
      vg = ctx.createRadialGradient(cx, cy, Math.min(vp.w, vp.h) * 0.45, cx, cy, diag * 0.75);
      const col = opts.vignetteColor ?? '90,70,40';
      vg.addColorStop(0, `rgba(${col},0)`);
      vg.addColorStop(1, `rgba(${col},${opts.vignette})`);
    } else {
      const cx = vp.w / 2;
      const cy = vp.h / 2;
      vg = ctx.createRadialGradient(cx, cy, diag * 0.3, cx, cy, diag * 0.5);
      const col = opts.vignetteColor ?? '58,58,56';
      vg.addColorStop(0, `rgba(${col},0)`);
      vg.addColorStop(1, `rgba(${col},${opts.vignette})`);
    }
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, vp.w, vp.h);
  }
}

/** 手账缝线：沿面板内缘画一圈虚线（美术 §6.4） */
export function drawPanelSeam(ctx: Ctx2DLike, r: Rect, radius: number, inset = 6): void {
  if (r.w <= inset * 2 + 4 || r.h <= inset * 2 + 4) return;
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(139,115,85,0.15)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2, Math.max(2, radius - inset * 0.5));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/** 通用按钮绘制 */
export function drawButton(
  ctx: Ctx2DLike,
  rect: Rect,
  label: string,
  opts: ButtonOpts = {}
): void {
  const r = Math.min(rect.h * 0.18, 14);
  const drawBg = () => {
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, r);
    ctx.fillStyle = opts.bg ?? THEME.panel;
    ctx.fill();
    if (opts.active) {
      ctx.lineWidth = 4;        // 选中态：略加粗的青绿描边
      ctx.strokeStyle = THEME.teal;
      ctx.stroke();
    } else {
      ctx.lineWidth = 1;
      ctx.strokeStyle = THEME.panelLine;
      ctx.stroke();
    }
  };
  if (opts.shadow) {
    withElevation(ctx, 'E1', rect.h, drawBg);   // 景深阶梯 E1（静置：按钮/面板）
  } else {
    drawBg();
  }
  const cx = rect.x + rect.w / 2;
  if (opts.sub) {
    text(ctx, label, cx, rect.y + rect.h * 0.38, {
      size: opts.fontSize ?? Math.min(rect.h * 0.32, 22),
      color: opts.fg ?? THEME.ink,
      weight: 'bold',
      align: 'center',
      baseline: 'middle',
    });
    text(ctx, opts.sub, cx, rect.y + rect.h * 0.7, {
      size: Math.min(rect.h * 0.2, 13),
      color: THEME.lockedInk,
      align: 'center',
      baseline: 'middle',
    });
  } else {
    text(ctx, label, cx, rect.y + rect.h / 2, {
      size: opts.fontSize ?? Math.min(rect.h * 0.4, 22),
      color: opts.fg ?? THEME.ink,
      weight: 'bold',
      align: 'center',
      baseline: 'middle',
    });
  }
}

