/**
 * render/settings.ts — 设置面板（音频四项）· 纯 Canvas 2D，无 DOM
 *
 * Hub 右上角齿轮图标 → 展开面板：
 *   ① 全局静音        （开关）
 *   ② 音乐音量        （5 档分段）
 *   ③ 音效音量        （5 档分段）
 *   ④ 减少动态音效    （开关，无障碍 / 低打扰）
 *
 * **为什么是「5 档分段」而不是连续滑块**：
 *   input.ts 只路由「点按」与「图鉴纵向滚动」两类手势，没有通用拖拽通道。
 *   为一个设置项引入拖拽状态机，需要改动输入层的核心分支，风险远大于收益。
 *   分段按钮用现成的 hitTargets 就能实现，且在小屏上比细滑块更好点中
 *   （每档 ≥40px，满足触控最小命中尺寸）。
 *   真实滑块留作后续「设置页独立视图」时再做。
 *
 * 音频缺席时（零音频文件 / 后端不可用）面板照常可用：
 *   设置值仍会写入存档，只是听不见效果 —— 见 AudioManager 的静默降级契约。
 */

import type { App } from '../app/app';
import { Ctx2DLike, SafeAreaInsets } from '../platform/types';
import { THEME, text, fitText, roundRectPath, drawPanelSeam, withElevation } from './theme';
import { Rect } from './layout';

type Hits = { rect: Rect; action: () => void }[];

/** 音量档位（0 = 关）。与 metaStore 的 0..100 口径一致。 */
const VOLUME_STEPS = [0, 25, 50, 75, 100];

/** 齿轮图标尺寸，与色弱图标一致，右上角并排 */
export const GEAR_SIZE = 32;

/** 面板圆角 */
const PANEL_R = 16;

function fillRound(ctx: Ctx2DLike, r: Rect, color: string, radius: number): void {
  roundRectPath(ctx, r.x, r.y, r.w, r.h, Math.min(radius, r.w / 2, r.h / 2));
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeRound(ctx: Ctx2DLike, r: Rect, color: string, radius: number, w: number): void {
  roundRectPath(ctx, r.x, r.y, r.w, r.h, Math.min(radius, r.w / 2, r.h / 2));
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

/**
 * 齿轮图标（纯 path，8 齿）。
 * muted=true 时中心画一道斜杠，让「已静音」在不展开面板时也一眼可见。
 */
export function drawGearIcon(ctx: Ctx2DLike, rect: Rect, muted: boolean, open: boolean): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = Math.min(rect.w, rect.h) / 2 - 4;

  // 圆底（暖白），保证在任何底图上都能看清（与 drawContrastIcon 同一策略）
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = THEME.panel;
  ctx.fill();

  // 齿：8 根短辐条
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r * 0.52), cy + Math.sin(a) * (r * 0.52));
    ctx.lineTo(cx + Math.cos(a) * (r * 0.86), cy + Math.sin(a) * (r * 0.86));
    ctx.stroke();
  }
  // 轴心
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 外环：展开中 = 青绿粗环（与色弱图标的「已生效」语言一致）
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = open ? THEME.teal : THEME.panelLine;
  ctx.lineWidth = open ? 2.5 : 1.5;
  ctx.stroke();

  // 静音斜杠（陶土红，语义为「关闭」而非「错误」）
  if (muted) {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.78, cy + r * 0.78);
    ctx.lineTo(cx + r * 0.78, cy - r * 0.78);
    ctx.strokeStyle = THEME.terracotta;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

/** 开关行：左标题 + 右侧胶囊开关 */
function drawToggleRow(
  ctx: Ctx2DLike,
  rect: Rect,
  label: string,
  on: boolean,
  hits: Hits,
  action: () => void
): void {
  text(ctx, label, rect.x, rect.y + rect.h / 2, {
    align: 'left',
    baseline: 'middle',
    size: 14,
    color: THEME.ink,
  });

  const kw = 46;
  const kh = 26;
  const knob: Rect = { x: rect.x + rect.w - kw, y: rect.y + (rect.h - kh) / 2, w: kw, h: kh };
  fillRound(ctx, knob, on ? THEME.teal : THEME.locked, kh / 2);
  const dotR = kh / 2 - 3;
  ctx.beginPath();
  ctx.arc(on ? knob.x + knob.w - dotR - 3 : knob.x + dotR + 3, knob.y + kh / 2, dotR, 0, Math.PI * 2);
  ctx.fillStyle = THEME.panel;
  ctx.fill();

  // 命中区放大到整行，小屏也好点（不只限胶囊本体）
  hits.push({ rect, action });
}

/** 音量行：左标题 + 5 档分段 */
function drawVolumeRow(
  ctx: Ctx2DLike,
  rect: Rect,
  label: string,
  value: number,
  hits: Hits,
  onPick: (v: number) => void
): void {
  text(ctx, label, rect.x, rect.y + 10, {
    align: 'left',
    baseline: 'middle',
    size: 14,
    color: THEME.ink,
  });
  text(ctx, value === 0 ? '关' : String(value), rect.x + rect.w, rect.y + 10, {
    align: 'right',
    baseline: 'middle',
    size: 12,
    color: THEME.lockedInk,
  });

  const segY = rect.y + 22;
  const segH = rect.h - 24;
  const gap = 6;
  const segW = (rect.w - gap * (VOLUME_STEPS.length - 1)) / VOLUME_STEPS.length;
  // 「已达到」的档位全部点亮 → 读作音量条，而不是一组互斥单选
  for (let i = 0; i < VOLUME_STEPS.length; i++) {
    const step = VOLUME_STEPS[i];
    const seg: Rect = { x: rect.x + i * (segW + gap), y: segY, w: segW, h: segH };
    const reached = value > 0 && step > 0 && step <= value;
    const isOff = step === 0;
    fillRound(ctx, seg, reached ? THEME.teal : THEME.panel, 6);
    strokeRound(ctx, seg, value === step ? THEME.ink : THEME.panelLine, 6, value === step ? 2 : 1);
    text(ctx, isOff ? '关' : String(step), seg.x + seg.w / 2, seg.y + seg.h / 2, {
      align: 'center',
      baseline: 'middle',
      size: 11,
      color: reached ? THEME.panel : THEME.lockedInk,
    });
    hits.push({ rect: seg, action: () => onPick(step) });
  }
}

/**
 * 绘制设置入口 + 面板。
 * 由 renderer.drawApp 在视图之后、toast 之前调用（面板压住 Hub，但对白仍在最顶层）。
 */
export function drawSettings(
  app: App,
  ctx: Ctx2DLike,
  vp: { w: number; h: number },
  safe: SafeAreaInsets,
  hits: Hits
): void {
  // 齿轮入口：色弱图标（右上角第一个）左侧并排
  const gear: Rect = {
    x: vp.w - safe.right - 12 - GEAR_SIZE * 2 - 8,
    y: safe.top + 8,
    w: GEAR_SIZE,
    h: GEAR_SIZE,
  };
  drawGearIcon(ctx, gear, app.muted, app.settingsOpen);
  hits.push({ rect: gear, action: () => app.toggleSettings() });

  if (!app.settingsOpen) return;

  // 遮罩：点击面板外 = 关闭。先 push 全屏命中，面板内控件随后 push →
  // handleTap 逆序遍历，控件永远优先于遮罩命中。
  ctx.fillStyle = 'rgba(58,58,56,0.45)';
  ctx.fillRect(0, 0, vp.w, vp.h);
  hits.push({ rect: { x: 0, y: 0, w: vp.w, h: vp.h }, action: () => app.closeSettings() });

  const pw = Math.min(vp.w * 0.86, 340);
  const rowH = 40;
  const volH = 62;
  const padX = 18;
  const headerH = 52;
  const footerH = 56;
  const ph = headerH + rowH * 2 + volH * 2 + footerH;
  const panel: Rect = { x: (vp.w - pw) / 2, y: Math.max(safe.top + 48, (vp.h - ph) / 2), w: pw, h: ph };

  withElevation(ctx, 'E3', ph, () => fillRound(ctx, panel, THEME.panel, PANEL_R));
  drawPanelSeam(ctx, panel, PANEL_R, 6);
  // 吞掉落在面板上的空白点击，避免穿透到遮罩把面板关掉
  hits.push({ rect: panel, action: () => {} });

  text(ctx, '声音设置', panel.x + pw / 2, panel.y + 26, {
    align: 'center',
    baseline: 'middle',
    size: 17,
    weight: 'bold',
  });

  const innerX = panel.x + padX;
  const innerW = pw - padX * 2;
  let y = panel.y + headerH;

  drawToggleRow(
    ctx,
    { x: innerX, y, w: innerW, h: rowH },
    '全局静音',
    app.muted,
    hits,
    () => app.toggleMuted()
  );
  y += rowH;

  drawVolumeRow(
    ctx,
    { x: innerX, y, w: innerW, h: volH },
    '音乐音量',
    app.musicVolume,
    hits,
    (v) => app.setMusicVolume(v)
  );
  y += volH;

  drawVolumeRow(
    ctx,
    { x: innerX, y, w: innerW, h: volH },
    '音效音量',
    app.sfxVolume,
    hits,
    (v) => app.setSfxVolume(v)
  );
  y += volH;

  drawToggleRow(
    ctx,
    { x: innerX, y, w: innerW, h: rowH },
    '减少动态音效',
    app.reducedAudioFx,
    hits,
    () => app.toggleReducedAudioFx()
  );
  y += rowH;

  // 脚注：说明「减少动态音效」到底减了什么，避免玩家把它误读成总开关
  fitText(ctx, '减少动态音效：关闭翻牌、滚动等细碎反馈音', panel.x + pw / 2, y + 14, {
    align: 'center',
    size: 11,
    color: THEME.lockedInk,
    maxWidth: innerW,
  });

  const closeRect: Rect = { x: panel.x + pw / 2 - 44, y: panel.y + ph - 38, w: 88, h: 30 };
  fillRound(ctx, closeRect, THEME.panel, 10);
  strokeRound(ctx, closeRect, THEME.panelLine, 10, 1);
  text(ctx, '完成', closeRect.x + closeRect.w / 2, closeRect.y + closeRect.h / 2, {
    align: 'center',
    baseline: 'middle',
    size: 13,
    color: THEME.ink,
  });
  hits.push({ rect: closeRect, action: () => app.closeSettings() });
}
