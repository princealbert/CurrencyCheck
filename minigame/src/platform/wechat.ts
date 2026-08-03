/**
 * platform/wechat.ts — 微信小游戏平台后端（无 DOM / 无 document）
 *
 * 用 wx.createCanvas() / wx.createImage() / wx.getStorageSync / wx.onTouchStart 实现 Platform。
 * 仅在微信小游戏运行时使用；浏览器开发不会打包进 web 产物运行路径（入口由 web-entry 决定）。
 *
 * 合规：不引用任何真实钞币图；本文件只做平台能力桥接。
 */

import {
  Platform,
  CanvasLike,
  Ctx2DLike,
  ImageLike,
  SafeAreaInsets,
  KVStore,
  AudioBackend,
  AudioCreateOptions,
  AudioHandle,
  silentAudioHandle,
} from './types';

// 微信小游戏全局对象（运行时由微信 SDK 注入；此处仅声明形状）
declare const wx: any;

/* ================= 微信音频后端（audio-implementation.md §2.1） ================= */
/*
 * SFX → wx.createInnerAudioContext({ useWebAudioImplement: true })：整段解码进内存，
 *        短音效延迟从 100ms+ 降到可用水平。**只允许用于 ≤2.4s 的短音效**。
 * BGM → wx.createInnerAudioContext()（默认流式）：绝不开 useWebAudioImplement，否则内存爆掉。
 *
 * 静默降级：onError（文件缺失 / 解码失败 / 网络不可达）→ 本句柄永久 no-op，不抛、不重试。
 */
class InnerAudioHandle implements AudioHandle {
  private inner: any = null;
  private dead = false;
  playing = false;

  constructor(src: string, opts: AudioCreateOptions) {
    try {
      // useWebAudioImplement 仅用于短音效；音乐走默认流式播放
      const inner = wx.createInnerAudioContext(
        opts.shortSfx ? { useWebAudioImplement: true } : undefined
      );
      inner.loop = !!opts.loop;
      inner.onError(() => {
        // 资源缺失 / 解码失败 → 静默，游戏逻辑不受影响
        this.dead = true;
        this.playing = false;
      });
      inner.onEnded(() => {
        this.playing = false;
      });
      inner.src = src;
      this.inner = inner;
    } catch {
      this.dead = true;
      this.inner = null;
    }
  }

  play(): void {
    if (this.dead || !this.inner) return;
    try {
      // 同实例重复 play 会从头重放，这正是 AudioManager 池化轮转要解决的问题
      this.inner.seek(0);
      this.inner.play();
      this.playing = true;
    } catch {
      this.playing = false;
    }
  }

  pause(): void {
    try {
      if (this.inner) this.inner.pause();
    } catch {
      /* ignore */
    }
    this.playing = false;
  }

  stop(): void {
    try {
      if (this.inner) this.inner.stop();
    } catch {
      /* ignore */
    }
    this.playing = false;
  }

  setVolume(v: number): void {
    try {
      if (this.inner) this.inner.volume = Math.max(0, Math.min(1, v));
    } catch {
      /* ignore */
    }
  }

  setLoop(loop: boolean): void {
    try {
      if (this.inner) this.inner.loop = loop;
    } catch {
      /* ignore */
    }
  }

  destroy(): void {
    try {
      if (this.inner) this.inner.destroy();
    } catch {
      /* ignore */
    }
    this.inner = null;
    this.dead = true;
    this.playing = false;
  }
}

class WechatAudioBackend implements AudioBackend {
  readonly available: boolean;

  constructor() {
    const ok = typeof wx !== 'undefined' && !!wx && typeof wx.createInnerAudioContext === 'function';
    if (ok) {
      try {
        // 可访问性（audio-implementation.md §8.2）：遵从系统物理静音键
        if (typeof wx.setInnerAudioOption === 'function') {
          wx.setInnerAudioOption({ obeyMuteSwitch: true });
        }
      } catch {
        /* 老基础库无此 API → 忽略，不影响播放 */
      }
    }
    this.available = ok;
  }

  create(src: string, opts: AudioCreateOptions): AudioHandle {
    if (!this.available) return silentAudioHandle();
    try {
      return new InnerAudioHandle(src, opts);
    } catch {
      return silentAudioHandle();
    }
  }

  /** 微信无自动播放限制 */
  unlock(): void {}
}

function getWindowInfo(): any {
  if (typeof wx !== 'undefined' && wx && typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo();
  }
  // 老基础库兜底
  return typeof wx !== 'undefined' && wx && typeof wx.getSystemInfoSync === 'function'
    ? wx.getSystemInfoSync()
    : { screenWidth: 375, screenHeight: 667, pixelRatio: 1, safeArea: null };
}

export class WechatPlatform implements Platform {
  private canvas: any; // wx.createCanvas() 返回
  private ctx: any;    // canvas.getContext('2d')
  private dpr = 1;
  private audioBackend: WechatAudioBackend | null = null;
  safeAreaInset: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

  constructor() {
    if (typeof wx === 'undefined' || !wx || !wx.createCanvas) {
      throw new Error('WechatPlatform: 当前环境没有 wx.createCanvas（非微信小游戏运行时）');
    }
    this.canvas = wx.createCanvas();
    this.ctx = this.canvas.getContext('2d');
    this.resize();
  }

  private resize(): void {
    const info = getWindowInfo();
    this.dpr = info.pixelRatio || 1;
    const w = info.screenWidth;
    const h = info.screenHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.applyDpr();
    if (info.safeArea) {
      this.safeAreaInset = {
        top: info.safeArea.top,
        right: w - info.safeArea.right,
        bottom: h - info.safeArea.bottom,
        left: info.safeArea.left,
      };
    }
  }

  private applyDpr(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  getCanvas(): CanvasLike {
    return this.canvas;
  }

  getContext(): Ctx2DLike {
    return this.ctx;
  }

  getViewport(): { w: number; h: number } {
    const info = getWindowInfo();
    return { w: info.screenWidth, h: info.screenHeight };
  }

  loadImage(src: string): Promise<ImageLike> {
    return new Promise((resolve, reject) => {
      const img = wx.createImage();
      img.onload = () => resolve(img as ImageLike);
      img.onerror = () => reject(new Error('loadImage failed: ' + src));
      img.src = src;
    });
  }

  getStorage(k: string): string | null {
    try {
      const v = wx.getStorageSync(k);
      if (v == null) return null;
      // wx 直接存取对象；我们统一存 JSON 字符串，故这里已是字符串
      return typeof v === 'string' ? v : String(v);
    } catch {
      return null;
    }
  }

  setStorage(k: string, v: string): void {
    try {
      wx.setStorageSync(k, v);
    } catch {
      /* 忽略 */
    }
  }

  onPointer(cb: (x: number, y: number) => void): void {
    wx.onTouchStart((e: any) => {
      const t = e && e.touches && e.touches[0];
      if (t) cb(t.clientX, t.clientY);
    });
  }

  onPointerMove(cb: (x: number, y: number) => void): void {
    wx.onTouchMove((e: any) => {
      const t = e && e.touches && e.touches[0];
      if (t) cb(t.clientX, t.clientY);
    });
  }

  onPointerUp(cb: (x: number, y: number) => void): void {
    wx.onTouchEnd((e: any) => {
      const t = e && e.changedTouches && e.changedTouches[0];
      if (t) cb(t.clientX, t.clientY);
    });
  }

  resetTransform(): void {
    this.applyDpr();
  }

  requestAnimationFrame(cb: (t: number) => void): number {
    return (globalThis as any).requestAnimationFrame(cb);
  }

  now(): number {
    if (typeof wx !== 'undefined' && wx && wx.getPerformance && typeof wx.getPerformance === 'function') {
      return wx.getPerformance().now();
    }
    return Date.now();
  }

  /** 音频后端（懒建单例）；无 createInnerAudioContext 时 available=false → 全局静默 */
  createAudioBackend(): AudioBackend | null {
    if (!this.audioBackend) {
      try {
        this.audioBackend = new WechatAudioBackend();
      } catch {
        return null;
      }
    }
    return this.audioBackend;
  }

  onVisibilityChange(cb: (visible: boolean) => void): void {
    try {
      if (typeof wx.onHide === 'function') wx.onHide(() => cb(false));
      if (typeof wx.onShow === 'function') wx.onShow(() => cb(true));
    } catch {
      /* 老基础库缺失 → 不订阅 */
    }
  }
}
