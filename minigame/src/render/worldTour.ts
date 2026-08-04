/**
 * render/worldTour.ts — 「环游世界」全收集结算伪视频（纯 Canvas 2D，无 DOM）
 *
 * 签名与 drawDetail 完全一致，沿用现有渲染契约（world-tour-reward §3.2 第 8 项）。
 *
 * 图层顺序（§2.1，自底向上 z 递增）：
 *   L0 暖黑底  #1A1614 全屏          —— 必须先画，否则图未到时会炸一帧白闪
 *   L1 名胜图  cover + Ken Burns 推镜 + 交叉淡化（双缓冲 current/next 同帧 α 交叉）
 *   L2 调色叠层 区域签名色 source-over，α 逐帧读表（art §D.1，**不硬编码 0.12**）
 *   L3 ① 四角径向暗角 ② 底部 40% 线性压暗至 rgba(0,0,0,0.55)
 *   L4 字幕    ≥16px，最多 2 行，与 L1 交叉淡化**错开**节奏
 *   L5 标题    「周爷爷的礼物」，前 3s 后淡出
 *   L6 控件    进度点 ×8 + 跳过（常驻，不淡出）
 *
 * 三条 L2 实现纪律（art §D.3）：
 *   ① L2 在 L3 **之前** —— L2 的 source-over 染色会抬黑场，靠 L3 压回来，顺序反了字幕区发灰；
 *   ② 合成模式只用默认 source-over —— multiply/overlay 在低端机上支持不一致且**静默**画错；
 *   ③ L2 是全屏矩形 fill，不是图的一部分。本实现**根本不用 canvas 变换做推镜**
 *      （直接算目标矩形喂 5 参 drawImage），所以 L2 天然在推镜之外，无从跟着缩放。
 *
 * 弱网（§3.3 坑 3）：某帧未就绪 → L0 + 该区域签名色径向渐变兜底，**字幕照常走**，
 * 时间轴一秒不停。绝不转圈等待 —— 那会把「礼物」变成「加载」。
 */

import type { App } from '../app/app';
import { Ctx2DLike, SafeAreaInsets, ImageLike, Region } from '../platform/types';
import { text, wrapText, drawCover, roundRectPath } from './theme';
import { Rect } from './layout';
import {
  TOUR_FRAMES,
  TOUR_FRAME_COUNT,
  TOUR_FRAME_MS,
  TOUR_TITLE_HOLD_MS,
  TOUR_TITLE_FADE_MS,
  TOUR_KEN_SCALE,
  TOUR_BASE_INK,
  TOUR_FALLBACK_INNER,
  TOUR_TITLE,
  TOUR_OPENING_LINES,
  TOUR_CLOSING_LINE,
  TOUR_CLOSING_SIGN,
  TOUR_SKIP_LABEL,
  tourPhaseAt,
  captionAlpha,
  clamp01,
} from '../data/worldTour';

/** 字幕文本色（暖白；art §A.4「暖米白」族，用于压暗底上的正文） */
const SUB_COLOR = '#FBF7EE';

/* ================= L0 / L1 / 兜底 ================= */

/** L0 暖黑底：**永远第一笔**，兜住图未到 / 加载失败 / 交叉淡化间隙的所有露底场景 */
function drawInk(ctx: Ctx2DLike, vp: { w: number; h: number }): void {
  ctx.fillStyle = TOUR_BASE_INK;
  ctx.fillRect(0, 0, vp.w, vp.h);
}

/**
 * 弱网兜底渐变（art §A.3.1）：径向，圆心 (w/2, h*0.42)，内 r=min(w,h)*0.15，外 r=对角线*0.75。
 * 两个 stop 都是**预先算好的合成值**，运行时不叠两层 —— 少一次全屏 fill。
 */
function drawFallback(
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  region: Region,
  alpha: number
): void {
  if (alpha <= 0) return;
  const cx = vp.w / 2;
  const cy = vp.h * 0.42;
  const r0 = Math.min(vp.w, vp.h) * 0.15;
  const r1 = Math.sqrt(vp.w * vp.w + vp.h * vp.h) * 0.75;
  const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  g.addColorStop(0, TOUR_FALLBACK_INNER[region]);
  g.addColorStop(1, TOUR_BASE_INK);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, vp.w, vp.h);
  ctx.globalAlpha = prev;
}

/**
 * L1 单帧：cover 铺满 + Ken Burns 推镜。
 *
 * 推镜实现用「直接算目标矩形」而非 save/scale/restore：
 *   ① Ctx2DLike 只暴露 5 参 drawImage，算矩形与用变换等价；
 *   ② 天然满足 art §D.3-③（L2 在推镜之外）—— 压根没有变换栈可以泄漏；
 *   ③ 少两次 save/restore，每帧省两次状态拷贝（33s × 60fps = 约 2000 帧的量级）。
 *
 * 平移方向按 `帧序 % 4` 轮换（左→右 / 右→左 / 上→下 / 下→上），避免 8 帧同向的机械感。
 */
function drawKenBurns(
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  img: ImageLike,
  fp: number,
  dir: number,
  alpha: number,
  motion: boolean
): void {
  if (alpha <= 0) return;
  const s = motion ? 1 + (TOUR_KEN_SCALE - 1) * clamp01(fp) : TOUR_KEN_SCALE;
  const w = vp.w * s;
  const h = vp.h * s;
  const ox = w - vp.w; // 横向可平移总量
  const oy = h - vp.h; // 纵向可平移总量
  let x = -ox / 2;
  let y = -oy / 2;
  if (motion) {
    switch (dir) {
      case 0: // 左 → 右
        x = -ox * fp;
        break;
      case 1: // 右 → 左
        x = -ox * (1 - fp);
        break;
      case 2: // 上 → 下
        y = -oy * fp;
        break;
      default: // 下 → 上
        y = -oy * (1 - fp);
        break;
    }
  }
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  drawCover(ctx, img, x, y, w, h);
  ctx.globalAlpha = prev;
}

/** L1 + 兜底二选一：有图走推镜，无图走该帧区域的签名色渐变，**时间轴不停** */
function drawFrameLayer(
  app: App,
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  index: number,
  fp: number,
  alpha: number,
  motion: boolean
): void {
  const f = TOUR_FRAMES[index];
  if (!f) return;
  const img = app.getTourFrame(index);
  if (img) drawKenBurns(ctx, vp, img, fp, index % 4, alpha, motion);
  else drawFallback(ctx, vp, f.region, alpha);
}

/* ================= L2 / L3 ================= */

/** L2 统一调色叠层：全屏矩形 fill，source-over + α，逐帧读表 */
function drawTint(
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  index: number,
  nextAlpha: number
): void {
  const cur = TOUR_FRAMES[index];
  if (!cur) return;
  // 交叉淡化期两帧的 L2 参数也一起插值，否则 α 会在切帧瞬间跳变（0.14 → 0.10 肉眼可见）
  const nxt = nextAlpha > 0 ? TOUR_FRAMES[index + 1] : undefined;
  if (nxt && nxt.tint === cur.tint) {
    ctx.globalAlpha = cur.tintAlpha + (nxt.tintAlpha - cur.tintAlpha) * nextAlpha;
    ctx.fillStyle = cur.tint;
    ctx.fillRect(0, 0, vp.w, vp.h);
  } else if (nxt) {
    // 跨区域切换（色相不同）：两层各自按交叉进度加权，避免 hex 插值算出脏色
    ctx.globalAlpha = cur.tintAlpha * (1 - nextAlpha);
    ctx.fillStyle = cur.tint;
    ctx.fillRect(0, 0, vp.w, vp.h);
    ctx.globalAlpha = nxt.tintAlpha * nextAlpha;
    ctx.fillStyle = nxt.tint;
    ctx.fillRect(0, 0, vp.w, vp.h);
  } else {
    ctx.globalAlpha = cur.tintAlpha;
    ctx.fillStyle = cur.tint;
    ctx.fillRect(0, 0, vp.w, vp.h);
  }
  ctx.globalAlpha = 1;
}

/** L3① 四角径向暗角；L3② 底部自 60%h 起线性压暗至 rgba(0,0,0,0.55) */
function drawVignette(ctx: Ctx2DLike, vp: { w: number; h: number }): void {
  const cx = vp.w / 2;
  const cy = vp.h * 0.44;
  const diag = Math.sqrt(vp.w * vp.w + vp.h * vp.h);
  const vg = ctx.createRadialGradient(cx, cy, diag * 0.26, cx, cy, diag * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, vp.w, vp.h);

  // ② 字幕可读性的**唯一保障** —— 不能依赖图本身够暗（§2.1 L3）
  const top = vp.h * 0.6;
  const lg = ctx.createLinearGradient(0, top, 0, vp.h);
  lg.addColorStop(0, 'rgba(0,0,0,0)');
  lg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, top, vp.w, vp.h - top);
}

/* ================= L4 / L5 / L6 ================= */

const SUB_FONT = '16px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

/** L4 字幕：16px / 行高 26 / 居中 / 最多 2 行，锚在进度点上方 */
function drawCaption(
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  safe: SafeAreaInsets,
  caption: string,
  alpha: number,
  baselineY: number
): void {
  if (alpha <= 0 || !caption) return;
  const maxW = vp.w - safe.left - safe.right - 48;
  const lines = wrapText(ctx, caption, maxW, SUB_FONT).slice(0, 2);
  const lineH = 26;
  const y0 = baselineY - (lines.length - 1) * lineH;
  ctx.globalAlpha = alpha;
  lines.forEach((ln, i) => {
    text(ctx, ln, vp.w / 2, y0 + i * lineH, {
      align: 'center',
      baseline: 'middle',
      size: 16,
      color: SUB_COLOR,
    });
  });
  ctx.globalAlpha = 1;
}

/** L5 标题「周爷爷的礼物」：前 3s 常显后淡出，长期挂顶会一直遮住天空区并削弱沉浸 */
function drawTitle(
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  safe: SafeAreaInsets,
  elapsed: number
): void {
  let a = 1;
  if (elapsed >= TOUR_TITLE_HOLD_MS) {
    a = clamp01(1 - (elapsed - TOUR_TITLE_HOLD_MS) / TOUR_TITLE_FADE_MS);
  } else if (elapsed < 400) {
    a = clamp01(elapsed / 400); // 与开场黑场渐亮同步，不要硬切进来
  }
  if (a <= 0) return;
  ctx.globalAlpha = a;
  text(ctx, TOUR_TITLE, vp.w / 2, safe.top + 46, {
    align: 'center',
    baseline: 'middle',
    size: 20,
    weight: 'bold',
    color: SUB_COLOR,
  });
  ctx.globalAlpha = 1;
}

/** L6 进度点：8 个，直径 6，间距 12，当前帧实心 */
function drawDots(
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  cy: number,
  active: number
): void {
  const r = 3;
  const step = 12 + r * 2;
  const totalW = step * (TOUR_FRAME_COUNT - 1);
  const x0 = vp.w / 2 - totalW / 2;
  for (let i = 0; i < TOUR_FRAME_COUNT; i++) {
    ctx.beginPath();
    ctx.arc(x0 + i * step, cy, r, 0, Math.PI * 2);
    if (i === active) {
      ctx.fillStyle = SUB_COLOR;
      ctx.globalAlpha = 0.92;
      ctx.fill();
    } else {
      ctx.strokeStyle = SUB_COLOR;
      ctx.globalAlpha = 0.42;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** L6 跳过按钮：自第 0 秒起常驻（§2.4，不做「3 秒后才能跳过」——那是广告的做法） */
function drawSkip(ctx: Ctx2DLike, r: Rect): void {
  ctx.globalAlpha = 0.9;
  roundRectPath(ctx, r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fillStyle = 'rgba(26,22,20,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(251,247,238,0.42)';
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, TOUR_SKIP_LABEL, r.x + r.w / 2, r.y + r.h / 2, {
    align: 'center',
    baseline: 'middle',
    size: 13,
    color: SUB_COLOR,
  });
  ctx.globalAlpha = 1;
}

/** 暂停指示：两条竖杠 + 一行提示。单击画面任意处 = 暂停/继续（§2.4） */
function drawPaused(ctx: Ctx2DLike, vp: { w: number; h: number }): void {
  const cx = vp.w / 2;
  const cy = vp.h * 0.44;
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = SUB_COLOR;
  ctx.fillRect(cx - 11, cy - 16, 7, 32);
  ctx.fillRect(cx + 4, cy - 16, 7, 32);
  text(ctx, '轻触继续', cx, cy + 40, {
    align: 'center',
    baseline: 'middle',
    size: 13,
    color: SUB_COLOR,
  });
  ctx.globalAlpha = 1;
}

/* ================= 主入口 ================= */

export function drawWorldTour(
  app: App,
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  safe: SafeAreaInsets,
  hits: { rect: Rect; action: () => void }[]
): void {
  const elapsed = app.tourElapsedMs();
  const phase = tourPhaseAt(elapsed, app.tourReplay);
  // TODO(可访问性 · §2.4)：settings 目前只有 reducedAudioFx，尚无「减弱动效」开关。
  //   该开关落地后，此处改为 `!app.meta.reducedMotion` 即可关闭推镜（仅保留淡入淡出，
  //   帧时长不变）。在此之前保持推镜常开，不擅自复用音频开关代管视觉动效。
  const motion = true;

  /* —— L0：永远第一笔 —— */
  drawInk(ctx, vp);

  /* —— 全屏「暂停 / 继续」命中区：**最先 push** ——
   * handleTap 逆序遍历（后 push 者优先），故跳过按钮必须在它之后 push 才抢得到点击。 */
  hits.push({
    rect: { x: 0, y: 0, w: vp.w, h: vp.h },
    action: () => app.toggleTourPause(),
  });

  if (phase.kind === 'intro') {
    /* —— 开场（2.0s）：黑场渐亮；首看显示主文案，replay 重看隐藏（§3.4 方案 A）—— */
    if (!app.tourReplay) {
      // 0–35% 淡入、35–70% 保持、70–100% 淡出
      const p = phase.p;
      const a = p < 0.35 ? p / 0.35 : p > 0.7 ? clamp01((1 - p) / 0.3) : 1;
      ctx.globalAlpha = a;
      const lineH = 30;
      const y0 = vp.h * 0.46 - ((TOUR_OPENING_LINES.length - 1) * lineH) / 2;
      TOUR_OPENING_LINES.forEach((ln, i) => {
        text(ctx, ln, vp.w / 2, y0 + i * lineH, {
          align: 'center',
          baseline: 'middle',
          size: 19,
          color: SUB_COLOR,
        });
      });
      ctx.globalAlpha = 1;
    }
  } else if (phase.kind === 'frames') {
    const { index, fp, nextAlpha } = phase;

    /* —— L1 双缓冲：current 与 next 同帧绘制，靠 globalAlpha 交叉 —— */
    drawFrameLayer(app, ctx, vp, index, fp, 1, motion);
    if (nextAlpha > 0) {
      // 下一帧从推镜起点（fp≈0）淡入，与它自己那 3.4s 的推镜首尾相接
      drawFrameLayer(app, ctx, vp, index + 1, 0, nextAlpha, motion);
    }

    /* —— L2 → L3（顺序不可颠倒，art §D.3-①） —— */
    drawTint(ctx, vp, index, nextAlpha);
    drawVignette(ctx, vp);

    /* —— L4 字幕 —— */
    const local = fp * TOUR_FRAME_MS;
    const dotsY = vp.h - safe.bottom - 26;
    drawCaption(
      ctx,
      vp,
      safe,
      TOUR_FRAMES[index].caption,
      captionAlpha(local),
      dotsY - 30
    );

    /* —— L5 标题 —— */
    drawTitle(ctx, vp, safe, elapsed);

    /* —— L6 进度点 —— */
    drawDots(ctx, vp, dotsY, index);
  } else if (phase.kind === 'outro') {
    /* —— 收束（3.5s）：末帧渐暗至 #1A1614，落款正文 + 署名淡入 —— */
    const p = phase.p;
    const fade = clamp01(1 - p / 0.45); // 前 45% 把末帧压掉
    if (fade > 0) {
      drawFrameLayer(app, ctx, vp, TOUR_FRAME_COUNT - 1, 1, fade, motion);
      drawTint(ctx, vp, TOUR_FRAME_COUNT - 1, 0);
      ctx.globalAlpha = 1 - fade;
      drawInk(ctx, vp);
      ctx.globalAlpha = 1;
    }
    // 落款在 30% 后淡入并保持到底（不再淡出，让最后一句话停在屏幕上）
    const a = clamp01((p - 0.3) / 0.25);
    if (a > 0) {
      ctx.globalAlpha = a;
      const maxW = vp.w - safe.left - safe.right - 48;
      const lines = wrapText(ctx, TOUR_CLOSING_LINE, maxW, SUB_FONT).slice(0, 2);
      const lineH = 28;
      const y0 = vp.h * 0.44 - ((lines.length - 1) * lineH) / 2;
      lines.forEach((ln, i) => {
        text(ctx, ln, vp.w / 2, y0 + i * lineH, {
          align: 'center',
          baseline: 'middle',
          size: 17,
          color: SUB_COLOR,
        });
      });
      // ⚠ 合规锚点：署名行「写在册子最后一页」必须保留（§4.2 / §6 第 7 条）
      text(ctx, TOUR_CLOSING_SIGN, vp.w / 2, y0 + lines.length * lineH + 22, {
        align: 'center',
        baseline: 'middle',
        size: 13,
        color: SUB_COLOR,
      });
      ctx.globalAlpha = 1;
    }
  }
  // phase.kind === 'done'：只留 L0，App.tick 会在同一帧把 view 切回 hub

  /* —— L6 跳过按钮：常驻，不淡出，最后 push 保证抢得到点击 —— */
  const skipRect: Rect = {
    x: vp.w - safe.right - 12 - 64,
    y: safe.top + 8,
    w: 64,
    h: 30,
  };
  drawSkip(ctx, skipRect);
  hits.push({ rect: skipRect, action: () => app.closeWorldTour() });

  if (app.tourPaused) drawPaused(ctx, vp);
}
