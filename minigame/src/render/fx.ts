/**
 * render/fx.ts — 配对清除动画 / burst 粒子池 / toast 绘制（Phase1 §1.3–1.4 / §3）
 *
 * 性能硬约束（§3.3，Canvas 2D 低端机）：
 *  - 粒子固定 48 槽对象池，模块加载时一次性创建；运行期**零 new / 零数组分配**；
 *    并行 burst 超出池容量时复用最老槽（bornAt 最小者）。
 *  - 绘制按「颜色 × alpha 档」分组批量 beginPath + 一次 fill（实测活动 burst ≤2 时 ≤4 次 fill）。
 *  - 粒子与光环绘制期间禁 shadow（不调 withElevation）。
 *  - 无离屏 canvas 需求。
 *
 * 时间基准：全部使用 app 的游戏时钟 gameTimeMs（§5.2），后台切回不跳段、零漂移。
 * 降级：本模块所有效果都是「纯附加」——不调用 spawnBurst / drawFx 时游戏完整可玩（§8 验收总则）。
 */

import { Ctx2DLike, Region } from '../platform/types';
import { THEME, REGION_COLORS, BAND_COLORS, roundRectPath, text, fitText, wrapText, withElevation, drawGoldDiamond } from './theme';
import { Rect } from './layout';

/* ================= 清除动画时间线（§3.1） ================= */

/** A 确认停留：两卡保持 face_up、描边加亮（认知节拍） */
export const CLEAR_A_END = 250;
/** B pop：scale 1.00 → 1.06（ease-out） */
export const CLEAR_B_END = 370;
/** C 收缩清除：scale 1.06 → 0，alpha 1 → 0（ease-in t^2）；之后为幽灵槽位 */
export const CLEAR_C_END = 650;
/** burst 起播时刻（= B 段结束、C 段开始） */
export const BURST_AT = 370;
/** 解锁 burst 起播后多久入队现实锚 toast（§3.2：爽感先行、知识跟上） */
export const UNLOCK_TOAST_DELAY = 200;

export interface ClearAnim {
  /** 绕卡心缩放 */
  scale: number;
  alpha: number;
  /** A 段：描边加亮为区域亮色 */
  highlight: boolean;
  /** true = 动画结束，应改画幽灵槽位 */
  done: boolean;
}

/** 按已过时长求清除动画插值（纯函数，可单测） */
export function clearAnimAt(elapsed: number): ClearAnim {
  if (elapsed < 0) return { scale: 1, alpha: 1, highlight: true, done: false };
  if (elapsed < CLEAR_A_END) return { scale: 1, alpha: 1, highlight: true, done: false };
  if (elapsed < CLEAR_B_END) {
    const t = (elapsed - CLEAR_A_END) / (CLEAR_B_END - CLEAR_A_END);
    const e = 1 - (1 - t) * (1 - t); // ease-out
    return { scale: 1 + 0.06 * e, alpha: 1, highlight: false, done: false };
  }
  if (elapsed < CLEAR_C_END) {
    const t = (elapsed - CLEAR_B_END) / (CLEAR_C_END - CLEAR_B_END);
    const e = t * t; // ease-in
    return { scale: 1.06 * (1 - e), alpha: 1 - e, highlight: false, done: false };
  }
  return { scale: 0, alpha: 0, highlight: false, done: true };
}

/** 幽灵槽位（§3.1 D 段）：1px 圆角虚线轮廓，区域深色带 @ alpha 0.10 */
export function drawGhostSlot(ctx: Ctx2DLike, rect: Rect, region: Region, form: string): void {
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = BAND_COLORS[region];
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  if (form === 'coin') {
    const r = Math.min(rect.w, rect.h) / 2 - 1;
    ctx.beginPath();
    ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(1, r), 0, Math.PI * 2);
    ctx.stroke();
  } else {
    roundRectPath(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, Math.max(2, rect.h * 0.1));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ================= 粒子池（§3.2 / §3.3） ================= */

const POOL_SIZE = 48;
const PARTICLE_LIFE = 450;
/** 每帧速度衰减（按 60fps 基准，dt 归一化后按幂次施加） */
const DECAY_PER_FRAME = 0.92;
const FRAME_MS = 1000 / 60;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  /** COLOR_TABLE 下标（批量绘制分组键的高位） */
  colorIdx: number;
  /** 0 = 圆，1 = 菱形 */
  shape: number;
  bornAt: number;
  life: number;
  active: boolean;
  /** 绘制分组用的 alpha 档（每帧更新，避免绘制期计算/分配） */
  level: number;
}

/** 模块加载时一次性预分配，运行期不再 new */
const POOL: Particle[] = [];
for (let i = 0; i < POOL_SIZE; i++) {
  POOL.push({ x: 0, y: 0, vx: 0, vy: 0, size: 0, colorIdx: 0, shape: 0, bornAt: 0, life: 0, active: false, level: 0 });
}

/** 颜色表（最多 8 种：3 区域色 + 金 + 余量），字符串复用避免每帧拼接 */
const COLOR_TABLE: string[] = ['', '', '', '', '', '', '', ''];
let colorCount = 0;

function colorIndexOf(color: string): number {
  for (let i = 0; i < colorCount; i++) if (COLOR_TABLE[i] === color) return i;
  if (colorCount < COLOR_TABLE.length) {
    COLOR_TABLE[colorCount] = color;
    return colorCount++;
  }
  return 0; // 表满（不会发生）→ 退化复用槽 0
}

/** 取一个可用槽：优先未激活；全满则复用最老（bornAt 最小） */
function acquire(nowMs: number): Particle {
  let oldest = POOL[0];
  for (let i = 0; i < POOL.length; i++) {
    const p = POOL[i];
    if (!p.active) return p;
    if (p.bornAt < oldest.bornAt) oldest = p;
  }
  return oldest;
}

/* ---------------- 光环（§3.2） ---------------- */

const RING_POOL_SIZE = 8;
const RING_LIFE = 350;

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  color: string;
  bornAt: number;
  delay: number;
  active: boolean;
}

const RINGS: Ring[] = [];
for (let i = 0; i < RING_POOL_SIZE; i++) {
  RINGS.push({ x: 0, y: 0, r0: 0, r1: 0, color: '', bornAt: 0, delay: 0, active: false });
}

function acquireRing(nowMs: number): Ring {
  let oldest = RINGS[0];
  for (let i = 0; i < RINGS.length; i++) {
    const r = RINGS[i];
    if (!r.active) return r;
    if (r.bornAt < oldest.bornAt) oldest = r;
  }
  return oldest;
}

/**
 * 发射一次 burst（§3.2）。原点 = 两卡矩形中点连线的中心。
 * @param nowMs   游戏时钟
 * @param cell    卡宽（决定速率与光环半径尺度）
 * @param unlock  true = 解锁档（20 粒子 + 双光环）；false = 标准档（12 粒子 + 单光环）
 * @param colorblind true = 粒子与光环全金（§5.3 ④：不依赖区域色传达信息）
 * @param rng     随机源（注入以便测试；缺省 Math.random）
 */
export function spawnBurst(
  nowMs: number,
  x: number,
  y: number,
  cell: number,
  region: Region,
  unlock: boolean,
  colorblind = false,
  rng: () => number = Math.random
): void {
  const count = unlock ? 20 : 12;
  const regionCount = unlock ? 12 : 8;
  const regionColor = colorblind ? THEME.gold : REGION_COLORS[region];
  const regionIdx = colorIndexOf(regionColor);
  const goldIdx = colorIndexOf(THEME.gold);

  for (let i = 0; i < count; i++) {
    const p = acquire(nowMs);
    // 等分角度 ±15° 抖动
    const base = (i / count) * Math.PI * 2;
    const jitter = ((rng() * 2 - 1) * 15 * Math.PI) / 180;
    const a = base + jitter;
    const speed = cell * (1.2 + rng() * 0.6); // cell*1.2 ~ cell*1.8 px/s
    p.x = x;
    p.y = y;
    p.vx = Math.cos(a) * speed;
    p.vy = Math.sin(a) * speed;
    p.size = 3 + rng() * 2; // 3–5px
    p.colorIdx = i < regionCount ? regionIdx : goldIdx;
    p.shape = i < regionCount ? 0 : 1; // 区域色=圆，金=菱形
    p.bornAt = nowMs;
    p.life = PARTICLE_LIFE;
    p.active = true;
    p.level = 7;
  }

  // 光环：第一道区域色；解锁档追加第二道金色（延迟 120ms）
  const r1 = acquireRing(nowMs);
  r1.x = x;
  r1.y = y;
  r1.r0 = cell * 0.2;
  r1.r1 = cell * 0.7;
  r1.color = regionColor;
  r1.bornAt = nowMs;
  r1.delay = 0;
  r1.active = true;
  if (unlock) {
    const r2 = acquireRing(nowMs);
    r2.x = x;
    r2.y = y;
    r2.r0 = cell * 0.2;
    r2.r1 = cell * 0.7;
    r2.color = THEME.gold;
    r2.bornAt = nowMs;
    r2.delay = 120;
    r2.active = true;
  }
}

/** 推进粒子（零分配）。dt 已由 app 夹逼（min(dt,100)） */
export function updateFx(nowMs: number, dtMs: number): void {
  const dt = dtMs / 1000;
  const decay = Math.pow(DECAY_PER_FRAME, dtMs / FRAME_MS);
  for (let i = 0; i < POOL.length; i++) {
    const p = POOL[i];
    if (!p.active) continue;
    if (nowMs - p.bornAt >= p.life) {
      p.active = false;
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= decay; // 重力 0，仅速度衰减
    p.vy *= decay;
  }
  for (let i = 0; i < RINGS.length; i++) {
    const r = RINGS[i];
    if (!r.active) continue;
    if (nowMs - r.bornAt - r.delay >= RING_LIFE) r.active = false;
  }
}

/** 是否还有活动特效（供 app 决定是否继续置 dirty） */
export function hasActiveFx(): boolean {
  for (let i = 0; i < POOL.length; i++) if (POOL[i].active) return true;
  for (let i = 0; i < RINGS.length; i++) if (RINGS[i].active) return true;
  return false;
}

/** 清空全部特效（换局 / 回 Hub 时调用，避免跨局残留） */
export function resetFx(): void {
  for (let i = 0; i < POOL.length; i++) POOL[i].active = false;
  for (let i = 0; i < RINGS.length; i++) RINGS[i].active = false;
}

/* ---------------- 批量绘制（颜色 × alpha 档 分组） ---------------- */

const ALPHA_LEVELS = 8;
/** 分组键存在位图：colorIdx * ALPHA_LEVELS + level */
const KEY_SEEN = new Uint8Array(COLOR_TABLE.length * ALPHA_LEVELS);

/** 绘制粒子与光环（禁 shadow；调用方保证不在 withElevation 内） */
export function drawFx(ctx: Ctx2DLike, nowMs: number): void {
  // ① 光环（描边，数量极少，逐个绘制）
  for (let i = 0; i < RINGS.length; i++) {
    const r = RINGS[i];
    if (!r.active) continue;
    const e = nowMs - r.bornAt - r.delay;
    if (e < 0) continue;
    const t = Math.min(1, e / RING_LIFE);
    const ease = 1 - (1 - t) * (1 - t); // ease-out
    const radius = r.r0 + (r.r1 - r.r0) * ease;
    if (radius <= 0.5) continue;
    ctx.save();
    ctx.globalAlpha = 0.8 * (1 - t);
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3 - 2 * t; // 3 → 1
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ② 粒子：先算每个的 alpha 档并标记分组键
  KEY_SEEN.fill(0);
  let any = false;
  for (let i = 0; i < POOL.length; i++) {
    const p = POOL[i];
    if (!p.active) continue;
    const t = (nowMs - p.bornAt) / p.life;
    if (t < 0 || t >= 1) continue;
    const a = 1 - t; // alpha 随寿命线性 1→0
    let lv = Math.floor(a * ALPHA_LEVELS);
    if (lv >= ALPHA_LEVELS) lv = ALPHA_LEVELS - 1;
    if (lv < 0) lv = 0;
    p.level = lv;
    KEY_SEEN[p.colorIdx * ALPHA_LEVELS + lv] = 1;
    any = true;
  }
  if (!any) return;

  ctx.save();
  for (let ci = 0; ci < colorCount; ci++) {
    for (let lv = 0; lv < ALPHA_LEVELS; lv++) {
      if (!KEY_SEEN[ci * ALPHA_LEVELS + lv]) continue;
      // 同色同档一次 beginPath + 一次 fill（圆与菱形可共存于同一 path）
      ctx.beginPath();
      for (let i = 0; i < POOL.length; i++) {
        const p = POOL[i];
        if (!p.active || p.colorIdx !== ci || p.level !== lv) continue;
        if (nowMs - p.bornAt >= p.life) continue;
        if (p.shape === 0) {
          ctx.moveTo(p.x + p.size, p.y);
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        } else {
          const s = p.size;
          ctx.moveTo(p.x, p.y - s);
          ctx.lineTo(p.x + s * 0.62, p.y);
          ctx.lineTo(p.x, p.y + s);
          ctx.lineTo(p.x - s * 0.62, p.y);
          ctx.closePath();
        }
      }
      ctx.globalAlpha = (lv + 0.5) / ALPHA_LEVELS;
      ctx.fillStyle = COLOR_TABLE[ci];
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ================= 现实锚闪现 toast（§1.3 / §1.4） ================= */

export const TOAST_ENTER_MS = 200;
export const TOAST_HOLD_MS = 2600;
/** 队列非空时缩短 hold */
export const TOAST_HOLD_SHORT_MS = 1600;
export const TOAST_EXIT_MS = 300;

export interface ToastItem {
  /** 行 1：`新发现 · {name} {iso}`；轻提示复用时为单行文案 */
  line1: string;
  /** 行 2：闪现文案（可空 → 只画标题行）。向后兼容字段，lines 为空时使用 */
  line2: string;
  /**
   * 多行正文（可选）。存在且非空时**优先于 line2**。
   * 入队方不需要预截断——drawToast 会用 wrapText 按实际像素宽二次换行。
   */
  lines?: string[];
  region: Region;
  hold: number;
  /** 起播时刻（游戏时钟）；-1 = 尚未起播（在队列中等待） */
  startAt: number;
}

export function toastTotal(hold: number): number {
  return TOAST_ENTER_MS + hold + TOAST_EXIT_MS;
}

export interface ToastPhase {
  alpha: number;
  /** 相对 topBar 底的 y 偏移 */
  yOff: number;
  done: boolean;
}

/** toast 时间线插值（纯函数，可单测）：enter 200 → hold → exit 300 */
export function toastPhaseAt(elapsed: number, hold: number): ToastPhase {
  if (elapsed < 0) return { alpha: 0, yOff: -20, done: false };
  if (elapsed < TOAST_ENTER_MS) {
    const t = elapsed / TOAST_ENTER_MS;
    const e = 1 - (1 - t) * (1 - t); // ease-out
    return { alpha: e, yOff: -20 + 28 * e, done: false };
  }
  const afterEnter = elapsed - TOAST_ENTER_MS;
  if (afterEnter < hold) return { alpha: 1, yOff: 8, done: false };
  const te = (afterEnter - hold) / TOAST_EXIT_MS;
  if (te >= 1) return { alpha: 0, yOff: -4, done: true };
  const e = te * te; // ease-in
  return { alpha: 1 - e, yOff: 8 - 12 * e, done: false };
}

/* ---------------- toast 视觉常量（册册对白横幅） ----------------
 * 设计意图：toast 是「册册在说话」，需要在彩色卡桌 / 图鉴网格之上被一眼看到，
 * 但**不锁输入、不弹模态、不整屏压暗**（项目哲学）。因此靠三件事拿注意力：
 *  ① 深墨棕高对比底（与全局奶油色调反差最大）；② 3px 区域色描边 + E2 浮起；
 *  ③ 左侧「册」字圆形角色锚点——让用户瞬间识别说话人。
 */
const TOAST_FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
/** 深墨棕半透明底（替代浅色 THEME.panel，视觉权重远高于下方卡片） */
const TOAST_BG = 'rgba(38,36,32,0.94)';
/** 标题暖金（品牌色） / 正文奶白 */
const TOAST_TITLE_COLOR = '#F5E9C8';
const TOAST_BODY_COLOR = '#F3EEE2';
/** 册册头像奶白底（与卡面浮雕字同色） */
const TOAST_AVATAR_BG = '#FDFAF3';

const TOAST_MIN_W = 220;
const TOAST_MAX_W = 460;
const TOAST_PAD = 14;
const TOAST_PAD_T = 16;
const TOAST_PAD_B = 14;
/** 标题行占高 / 正文行高 */
const TOAST_TITLE_H = 22;
const TOAST_BODY_LH = 18;
const TOAST_TITLE_SIZE = 14;
const TOAST_BODY_SIZE = 13;
/** 头像直径 + 与正文的水平间距 */
const TOAST_AVATAR_D = 28;
const TOAST_AVATAR_GAP = 10;
/** 标题行首金色菱形半径 + 其后间距 */
const TOAST_DIAMOND_R = 4;
const TOAST_DIAMOND_ADV = TOAST_DIAMOND_R * 2 + 6;
/** 换行安全上限（正常文案远达不到，仅防极端长文顶出屏幕） */
const TOAST_MAX_ROWS = 6;

/** 取 toast 正文行：lines 优先，回落 line2（向后兼容旧的 line1+line2 两行 toast） */
function toastRows(toast: ToastItem): string[] {
  if (toast.lines && toast.lines.length > 0) return toast.lines;
  return toast.line2 ? [toast.line2] : [];
}

/** 册册角色锚点：奶白圆底 + 区域色描边 + 居中「册」字 */
function drawCeceAvatar(ctx: Ctx2DLike, cx: number, cy: number, d: number, color: string): void {
  const r = d / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = TOAST_AVATAR_BG;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  fitText(ctx, '册', cx, cy + 1, {
    align: 'center',
    baseline: 'middle',
    size: 16,
    weight: 'bold',
    color,
    maxWidth: d - 6,
    minSize: 10,
  });
}

/**
 * 绘制 toast（顶栏下方横幅，不锁输入、不弹模态）。
 *
 * 尺寸**完全自适应**：宽按最长行测量夹在 [220, min(vp.w-32, 460)]；
 * 高按 wrapText 换行后的真实行数累加 —— 多行叙事不再被塞进固定 56px。
 * 由 drawApp 统一在所有视图的最后调用，保证永远画在最顶层。
 *
 * @param topBarBottom 横幅锚定基线（各视图返回键行下沿），实际 y = 该值 + ph.yOff
 * @returns 命中矩形（点按 = 立即跳到 exit 段）；已结束返回 null
 */
export function drawToast(
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  topBarBottom: number,
  toast: ToastItem,
  nowMs: number
): Rect | null {
  if (toast.startAt < 0) return null;
  const ph = toastPhaseAt(nowMs - toast.startAt, toast.hold);
  if (ph.done || ph.alpha <= 0.01) return null;

  const accent = BAND_COLORS[toast.region];
  const titleFont = `bold ${TOAST_TITLE_SIZE}px ${TOAST_FONT_FAMILY}`;
  const bodyFont = `normal ${TOAST_BODY_SIZE}px ${TOAST_FONT_FAMILY}`;
  const hasTitle = !!toast.line1;
  const rows = toastRows(toast);

  // 正文左边界（头像之后）—— 宽度计算与绘制共用
  const contentL = TOAST_PAD + TOAST_AVATAR_D + TOAST_AVATAR_GAP;

  /* ① 宽度自适应：测所有行（标题含行首菱形占位），取最长后夹逼 */
  const maxW = Math.max(TOAST_MIN_W, Math.min(vp.w - 32, TOAST_MAX_W));
  let measured = 0;
  if (hasTitle) {
    ctx.font = titleFont;
    measured = Math.max(measured, ctx.measureText(toast.line1).width + TOAST_DIAMOND_ADV);
  }
  ctx.font = bodyFont;
  for (let i = 0; i < rows.length; i++) {
    measured = Math.max(measured, ctx.measureText(rows[i]).width);
  }
  const w = Math.max(TOAST_MIN_W, Math.min(maxW, measured + contentL + TOAST_PAD));
  const innerW = w - contentL - TOAST_PAD;

  /* ② 自动换行：逐条正文过 wrapText（中文友好、按像素宽断），不依赖 clipLine 截断 */
  const wrapped: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const parts = wrapText(ctx, rows[i], innerW, bodyFont);
    for (let j = 0; j < parts.length; j++) wrapped.push(parts[j]);
  }
  if (wrapped.length > TOAST_MAX_ROWS) {
    wrapped.length = TOAST_MAX_ROWS;
    wrapped[TOAST_MAX_ROWS - 1] = wrapped[TOAST_MAX_ROWS - 1] + '…';
  }

  /* ③ 高度自适应：顶 pad + 标题行 + 正文行数 × 行高 + 底 pad */
  const h =
    TOAST_PAD_T + (hasTitle ? TOAST_TITLE_H : 0) + wrapped.length * TOAST_BODY_LH + TOAST_PAD_B;
  const x = (vp.w - w) / 2;
  const y = topBarBottom + ph.yOff;
  const rect: Rect = { x, y, w, h };

  ctx.save();
  ctx.globalAlpha = ph.alpha;
  // 深色底 + E2 浮起（比 E1 明显，让横幅"离开"背景平面）
  withElevation(ctx, 'E2', h, () => {
    roundRectPath(ctx, x, y, w, h, 12);
    ctx.fillStyle = TOAST_BG;
    ctx.fill();
  });
  roundRectPath(ctx, x, y, w, h, 12);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.stroke();

  // 册册角色锚点（垂直居中）
  drawCeceAvatar(ctx, x + TOAST_PAD + TOAST_AVATAR_D / 2, y + h / 2, TOAST_AVATAR_D, accent);

  // 标题行：行首金色菱形 + 暖金粗体
  let ty = y + TOAST_PAD_T;
  if (hasTitle) {
    const cy = ty + TOAST_TITLE_H / 2;
    drawGoldDiamond(ctx, x + contentL + TOAST_DIAMOND_R, cy, TOAST_DIAMOND_R);
    fitText(ctx, toast.line1, x + contentL + TOAST_DIAMOND_ADV, cy, {
      align: 'left',
      baseline: 'middle',
      size: TOAST_TITLE_SIZE,
      weight: 'bold',
      color: TOAST_TITLE_COLOR,
      maxWidth: innerW - TOAST_DIAMOND_ADV,
      minSize: 11,
    });
    ty += TOAST_TITLE_H;
  }

  // 正文行：已按 innerW 换行，逐行顶部对齐绘制（不再缩字号）
  for (let i = 0; i < wrapped.length; i++) {
    text(ctx, wrapped[i], x + contentL, ty + TOAST_BODY_LH / 2 + i * TOAST_BODY_LH, {
      align: 'left',
      baseline: 'middle',
      size: TOAST_BODY_SIZE,
      color: TOAST_BODY_COLOR,
    });
  }

  ctx.restore();
  ctx.globalAlpha = 1;
  return rect;
}
