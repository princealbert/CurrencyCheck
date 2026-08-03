/**
 * app/input.ts — 指针 → UI 元素命中
 *
 * 把 pointer 坐标 + 视口转换为「命中了哪个 UI 元素」：
 *  - 按下记录起点；移动（codex/detail）驱动滚动；抬起且位移很小 → 视为点按，回查本帧 hitTargets。
 *  - 仅依赖 platform 的 onPointer/onPointerMove/onPointerUp，不直接碰 DOM/wx 事件。
 */

import type { App } from './app';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 图鉴滚动每前进多少像素发一次阻尼刻度音（A7） */
const SCROLL_TICK_PX = 56;

export function attachInput(app: App): void {
  let downX = 0;
  let downY = 0;
  let moved = false;
  let scrollRef = 0;
  let scrollStartY = 0;

  /** 上次发出滚动刻度音时的 codexScroll，用于按位移节拍触发（A7） */
  let scrollTickRef = 0;

  app.platform.onPointer((x, y) => {
    // Web 自动播放策略要求音频在**用户手势内**解锁；pointerdown 是全局最早的手势。
    // 幂等，之后每次按下都调也没有副作用。
    app.notifyUserGesture();
    downX = x;
    downY = y;
    moved = false;
    if (app.view === 'codex' || app.view === 'detail') {
      scrollStartY = y;
      scrollRef = app.codexScroll;
      scrollTickRef = app.codexScroll;
    }
  });

  app.platform.onPointerMove((x, y) => {
    if (app.view === 'codex' || app.view === 'detail') {
      const dy = y - scrollStartY;
      if (Math.abs(y - downY) > 6) moved = true;
      const next = clamp(scrollRef + dy, app.codexScrollMin, 0);
      if (next !== app.codexScroll) {
        app.codexScroll = next;
        app.dirty = true;
        // 每滚过 SCROLL_TICK_PX 发一次刻度音；事件自身还有 throttleMs 兜底，
        // 双保险防止快速甩动时刷屏。
        if (Math.abs(next - scrollTickRef) >= SCROLL_TICK_PX) {
          scrollTickRef = next;
          app.notifyScrollTick();
        }
      }
    } else if (Math.abs(x - downX) > 8 || Math.abs(y - downY) > 8) {
      moved = true;
    }
  });

  app.platform.onPointerUp((x, y) => {
    if (!moved && Math.abs(x - downX) <= 10 && Math.abs(y - downY) <= 10) {
      app.handleTap(x, y);
    }
  });
}
