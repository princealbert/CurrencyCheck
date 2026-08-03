/**
 * render/glyph.ts — 币符绘制（四层识别码 ② 币符层，纯 path、零资产）
 *
 * 为什么存在：区域形状只有 3 种（分不开同区域的币）、签名色在占位美术/色弱下失效、
 * 文本需要「阅读」而非「一眼认」。glyph 给每币一个**唯一抽象几何轮廓**，
 * 让 CNY(十字) / INR(五瓣花) 这种「同区域 + 同母题 + 同面额 + 仅色不同」的最痛对
 * 在不依赖任何颜色的前提下也能瞬间分辨。
 *
 * 约束：
 *  - 只用 Ctx2DLike 暴露的 moveTo / lineTo / arc / closePath / fill / stroke / fillRect
 *    （不用 roundRect、不用贝塞尔、不用字符字形 —— 小游戏与浏览器行为一致）。
 *  - 全部以 (cx,cy) 为几何中心、名义半径 r 绘制，颜色由调用方传入。
 *  - 线宽带下限（小尺寸下不消失），细节数量固定，不随 r 变化 —— 缩放行为可预测。
 * 合规：纯抽象几何，非货币符号字形，不引用任何真实钞币 / 国旗 / 防伪元素。
 */

import { Ctx2DLike, GlyphKind } from '../platform/types';

/** 描边类 glyph 的线宽：随 r 等比，但带 1.2px 下限（微缩槽位不糊、不消失） */
function strokeW(r: number, k: number): number {
  return Math.max(1.2, r * k);
}

/**
 * 画一个币符。
 * @param kind  币符种类（每币唯一，见 data/currencies.ts 映射）
 * @param cx,cy 几何中心
 * @param r     名义半径（外接圆半径量级；实心形状略小于 r，描边形状贴近 r）
 * @param color 描边 / 填充色（普通模式=签名色，色弱模式=深墨）
 */
export function drawGlyph(
  ctx: Ctx2DLike,
  kind: GlyphKind,
  cx: number,
  cy: number,
  r: number,
  color: string
): void {
  if (!(r > 0)) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (kind === 'ring') {
    // 空心圆环：描边整圆（半径内缩半个线宽，保证外轮廓 = r）
    const lw = strokeW(r, 0.24);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.5, r - lw / 2), 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'triangle') {
    // 实心三角（顶点朝上）：视觉重心略下移，避免「头重」
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.92, cy + r * 0.72);
    ctx.lineTo(cx - r * 0.92, cy + r * 0.72);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'arch') {
    // 拱（桥）：顶半圆弧 + 左右两立柱，描边
    const lw = strokeW(r, 0.24);
    const ax = r * 0.70;   // 柱心水平距
    const ay = cy - r * 0.10; // 拱心
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(cx, ay, ax, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - ax, ay);
    ctx.lineTo(cx - ax, cy + r * 0.85);
    ctx.moveTo(cx + ax, ay);
    ctx.lineTo(cx + ax, cy + r * 0.85);
    ctx.stroke();
  } else if (kind === 'square') {
    // 实心正方（边长 2r*0.78，居中）
    const h = r * 0.78;
    ctx.beginPath();
    ctx.moveTo(cx - h, cy - h);
    ctx.lineTo(cx + h, cy - h);
    ctx.lineTo(cx + h, cy + h);
    ctx.lineTo(cx - h, cy + h);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'plus') {
    // 十字：横竖两 bar 中心交叉（厚度 0.34r，带像素下限）
    const t = Math.max(1.6, r * 0.34) / 2;
    const arm = r * 0.92;
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy - t);
    ctx.lineTo(cx + arm, cy - t);
    ctx.lineTo(cx + arm, cy + t);
    ctx.lineTo(cx - arm, cy + t);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - t, cy - arm);
    ctx.lineTo(cx + t, cy - arm);
    ctx.lineTo(cx + t, cy + arm);
    ctx.lineTo(cx - t, cy + arm);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'wave') {
    // 波浪：1.5 个周期的正弦，折线采样（无贝塞尔依赖），横跨 2r
    const lw = strokeW(r, 0.26);
    const amp = r * 0.40;
    const SEG = 24;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const x = cx - r + 2 * r * t;
      const y = cy + Math.sin(t * Math.PI * 3) * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (kind === 'flower') {
    // 五瓣花：中心圆点 + 5 个环绕小圆瓣
    const petal = r * 0.34;
    const dist = r * 0.62;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, petal, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'chevron') {
    // 山形 / V 描边（锐利单折，区别于 wave 的连续正弦）
    const lw = strokeW(r, 0.30);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.72, cy + r * 0.45);
    ctx.lineTo(cx, cy - r * 0.65);
    ctx.lineTo(cx + r * 0.72, cy + r * 0.45);
    ctx.stroke();
  } else if (kind === 'hexagon') {
    // 实心正六边形（顶点朝上），区别于 pentagon
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 6;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'star') {
    // 实心五角星（尖角），区别于 flower 的圆瓣
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'disc') {
    // 实心圆（区别于 ring 的空心圆环）
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'spiral') {
    // 螺旋（多段 lineTo 采样，无贝塞尔），由内向外逆时针
    const lw = strokeW(r, 0.22);
    ctx.lineWidth = lw;
    ctx.beginPath();
    const TURNS = 2.4;
    const SEG = 40;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const ang = -Math.PI / 2 + t * Math.PI * 2 * TURNS;
      const rad = r * 0.12 + t * r * 0.8;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (kind === 'mountain') {
    // 双峰山（两个三角并排），区别于单 triangle
    ctx.beginPath();
    ctx.moveTo(cx - r, cy + r * 0.7);
    ctx.lineTo(cx - r * 0.2, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.25, cy + r * 0.1);
    ctx.lineTo(cx + r * 0.55, cy - r * 0.7);
    ctx.lineTo(cx + r, cy + r * 0.7);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'sun') {
    // 太阳：实心圆心 + 8 道射线（区别于 disc 的纯圆）
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    const lw = strokeW(r, 0.18);
    ctx.lineWidth = lw;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6);
      ctx.lineTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95);
      ctx.stroke();
    }
  } else if (kind === 'bolt') {
    // 闪电（zigzag 多边形），实心
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.25, cy - r * 0.85);
    ctx.lineTo(cx - r * 0.45, cy + r * 0.15);
    ctx.lineTo(cx + r * 0.05, cy + r * 0.15);
    ctx.lineTo(cx - r * 0.25, cy + r * 0.85);
    ctx.lineTo(cx + r * 0.5, cy - r * 0.2);
    ctx.lineTo(cx, cy - r * 0.2);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'rhombus') {
    // 菱形（旋转 45° 方块），区别于 square 的轴对齐方块
    const h = r * 0.92;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + h * 0.78, cy);
    ctx.lineTo(cx, cy + h);
    ctx.lineTo(cx - h * 0.78, cy);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'arrow') {
    // 上箭头（实心：三角头 + 矩形杆），区别于 chevron 的无杆 V
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.92);
    ctx.lineTo(cx - r * 0.62, cy - r * 0.05);
    ctx.lineTo(cx - r * 0.22, cy - r * 0.05);
    ctx.lineTo(cx - r * 0.22, cy + r * 0.82);
    ctx.lineTo(cx + r * 0.22, cy + r * 0.82);
    ctx.lineTo(cx + r * 0.22, cy - r * 0.05);
    ctx.lineTo(cx + r * 0.62, cy - r * 0.05);
    ctx.closePath();
    ctx.fill();
  } else {
    // pentagon：实心正五边形（顶点朝上）
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}
