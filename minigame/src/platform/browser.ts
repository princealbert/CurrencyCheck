/**
 * platform/browser.ts — 浏览器平台后端（无 Cocos / 无 wx）
 *
 * 用 document.createElement('canvas') + localStorage + pointer 事件实现 Platform。
 * 仅在浏览器开发/测试时使用；微信小游戏不会打包进 wx 产物的运行路径（入口由 wx-entry 决定）。
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

/* ================= 浏览器音频后端（audio-implementation.md §2.1） ================= */
/*
 * SFX → WebAudio（fetch + decodeAudioData + BufferSource）：低延迟、可叠加。
 * BGM → HTMLAudioElement：流式，省内存。
 *
 * 全链路静默降级：无 AudioContext / 无 fetch / 无 Audio 构造器（如 Node 冒烟桩环境）、
 * 或文件 404 → 一律返回 no-op 句柄，绝不抛异常、绝不打断游戏逻辑。
 */

/** WebAudio 短音效句柄：懒加载 buffer，未就绪时 play() 静默丢弃（不排队补播） */
class WebAudioSfxHandle implements AudioHandle {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private volume = 1;
  private loop = false;
  private dead = false;
  playing = false;

  constructor(private ctx: AudioContext, src: string) {
    // fire-and-forget 加载，对齐 preloadImages 的 .catch() 静默契约
    try {
      fetch(src)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404'))))
        .then((buf) => this.ctx.decodeAudioData(buf))
        .then((decoded) => {
          this.buffer = decoded;
        })
        .catch(() => {
          this.dead = true; // 文件缺失 / 解码失败 → 本句柄永久静默
        });
    } catch {
      this.dead = true;
    }
  }

  play(): void {
    if (this.dead || !this.buffer) return; // 未就绪 → 静默丢弃
    try {
      this.stop();
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = this.loop;
      const gain = this.ctx.createGain();
      gain.gain.value = this.volume;
      src.connect(gain);
      gain.connect(this.ctx.destination);
      src.onended = () => {
        this.playing = false;
      };
      src.start(0);
      this.source = src;
      this.gain = gain;
      this.playing = true;
    } catch {
      this.playing = false;
    }
  }

  pause(): void {
    this.stop(); // WebAudio BufferSource 不支持 pause，短音效直接停
  }

  stop(): void {
    try {
      if (this.source) {
        this.source.onended = null;
        this.source.stop(0);
        this.source.disconnect();
      }
      if (this.gain) this.gain.disconnect();
    } catch {
      /* 已停止 / 已释放 */
    }
    this.source = null;
    this.gain = null;
    this.playing = false;
  }

  setVolume(v: number): void {
    this.volume = v;
    try {
      if (this.gain) this.gain.gain.value = v;
    } catch {
      /* ignore */
    }
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    try {
      if (this.source) this.source.loop = loop;
    } catch {
      /* ignore */
    }
  }

  destroy(): void {
    this.stop();
    this.buffer = null;
    this.dead = true;
  }
}

/** HTMLAudioElement 音乐句柄（流式，支持 pause/续播不重头） */
class HtmlAudioHandle implements AudioHandle {
  private el: HTMLAudioElement | null = null;
  playing = false;

  constructor(src: string, loop: boolean) {
    try {
      const el = new Audio();
      el.preload = 'auto';
      el.loop = loop;
      // 文件缺失 → onerror 置空，后续所有操作 no-op
      el.onerror = () => {
        this.el = null;
        this.playing = false;
      };
      el.src = src;
      this.el = el;
    } catch {
      this.el = null;
    }
  }

  play(): void {
    if (!this.el) return;
    try {
      const p = this.el.play();
      // 自动播放策略拒绝 → 静默（等下次用户手势后由 AudioManager 重试）
      if (p && typeof p.catch === 'function') p.catch(() => {});
      this.playing = true;
    } catch {
      this.playing = false;
    }
  }

  pause(): void {
    try {
      if (this.el) this.el.pause();
    } catch {
      /* ignore */
    }
    this.playing = false;
  }

  stop(): void {
    try {
      if (this.el) {
        this.el.pause();
        this.el.currentTime = 0;
      }
    } catch {
      /* ignore */
    }
    this.playing = false;
  }

  setVolume(v: number): void {
    try {
      if (this.el) this.el.volume = Math.max(0, Math.min(1, v));
    } catch {
      /* ignore */
    }
  }

  setLoop(loop: boolean): void {
    try {
      if (this.el) this.el.loop = loop;
    } catch {
      /* ignore */
    }
  }

  destroy(): void {
    this.stop();
    try {
      if (this.el) this.el.src = '';
    } catch {
      /* ignore */
    }
    this.el = null;
  }
}

class BrowserAudioBackend implements AudioBackend {
  private ctx: AudioContext | null = null;
  readonly available: boolean;

  constructor() {
    const g = globalThis as any;
    const Ctor = g.AudioContext || g.webkitAudioContext;
    // 需要 WebAudio（短音效）或至少 Audio 构造器（音乐）才算可用
    const hasHtmlAudio = typeof g.Audio === 'function';
    if (Ctor) {
      try {
        this.ctx = new Ctor();
      } catch {
        this.ctx = null;
      }
    }
    this.available = !!this.ctx || hasHtmlAudio;
  }

  create(src: string, opts: AudioCreateOptions): AudioHandle {
    try {
      if (opts.shortSfx) {
        if (!this.ctx || typeof (globalThis as any).fetch !== 'function') return silentAudioHandle();
        return new WebAudioSfxHandle(this.ctx, src);
      }
      if (typeof (globalThis as any).Audio !== 'function') return silentAudioHandle();
      return new HtmlAudioHandle(src, !!opts.loop);
    } catch {
      return silentAudioHandle();
    }
  }

  unlock(): void {
    try {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      /* ignore */
    }
  }
}

export class BrowserPlatform implements Platform {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // 固定竖屏设计分辨率（逻辑坐标，与手机一致）；浏览器预览按 contain 缩放 + 信箱
  private readonly LOGICAL_W = 390;
  private readonly LOGICAL_H = 844;
  // 设计期锁定的 DPR：backing store 与绘制变换共用，保证逻辑坐标→设备像素一致、不拉伸
  private designDpr = 1;
  private audioBackend: BrowserAudioBackend | null = null;

  safeAreaInset: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

  constructor() {
    const existing = document.getElementById('game') as HTMLCanvasElement | null;
    this.canvas = existing ?? document.createElement('canvas');
    if (!existing) document.body.appendChild(this.canvas);
    const c = this.canvas.getContext('2d');
    if (!c) throw new Error('BrowserPlatform: 无法获取 2D context');
    this.ctx = c;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => this.resize());
  }

  private resize(): void {
    // 1) backing store：仅在尺寸（受 dpr 影响）变化时重设，避免每次 resize 清空画布导致闪白。
    //    正常窗口缩放只改 CSS 显示尺寸，不改变 backing store，故画布内容得以保留。
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.floor(this.LOGICAL_W * dpr);
    const bh = Math.floor(this.LOGICAL_H * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this.designDpr = dpr; // 与 backing store 同步，变换才正确
      this.applyDpr();
    }

    // 2) CSS 显示尺寸：contain 适配窗口、保持竖屏比例；居中由 index.html 的 body flex 完成。
    //    窗口留白即信箱黑边（body 背景），游戏内坐标体系恒为 390×844。
    const scale = Math.min(
      window.innerWidth / this.LOGICAL_W,
      window.innerHeight / this.LOGICAL_H
    );
    this.canvas.style.width = Math.round(this.LOGICAL_W * scale) + 'px';
    this.canvas.style.height = Math.round(this.LOGICAL_H * scale) + 'px';
  }

  private applyDpr(): void {
    // 让后续绘制以「逻辑像素」为单位（1 单位 = 1 设计像素，已按 designDpr 放大到设备像素）
    this.ctx.setTransform(this.designDpr, 0, 0, this.designDpr, 0, 0);
  }

  getCanvas(): CanvasLike {
    return this.canvas;
  }

  getContext(): Ctx2DLike {
    return this.ctx;
  }

  getViewport(): { w: number; h: number } {
    // 固定竖屏逻辑视口（与手机一致）；CSS contain 缩放只影响显示，不影响坐标体系
    return { w: this.LOGICAL_W, h: this.LOGICAL_H };
  }

  loadImage(src: string): Promise<ImageLike> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img as unknown as ImageLike);
      img.onerror = () => reject(new Error('loadImage failed: ' + src));
      img.src = src;
    });
  }

  getStorage(k: string): string | null {
    try {
      const v = localStorage.getItem(k);
      return v == null ? null : v;
    } catch {
      return null;
    }
  }

  setStorage(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 配额或隐私模式：忽略 */
    }
  }

  /** 客户端坐标 → 逻辑像素（0..LOGICAL_W / 0..LOGICAL_H），兼容 CSS contain 缩放 */
  private toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? this.LOGICAL_W / rect.width : 1;
    const sy = rect.height > 0 ? this.LOGICAL_H / rect.height : 1;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }

  onPointer(cb: (x: number, y: number) => void): void {
    this.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      const p = this.toLogical(e.clientX, e.clientY);
      cb(p.x, p.y);
    });
  }

  onPointerMove(cb: (x: number, y: number) => void): void {
    this.canvas.addEventListener('pointermove', (e: PointerEvent) => {
      const p = this.toLogical(e.clientX, e.clientY);
      cb(p.x, p.y);
    });
  }

  onPointerUp(cb: (x: number, y: number) => void): void {
    this.canvas.addEventListener('pointerup', (e: PointerEvent) => {
      const p = this.toLogical(e.clientX, e.clientY);
      cb(p.x, p.y);
    });
  }

  resetTransform(): void {
    this.applyDpr();
  }

  requestAnimationFrame(cb: (t: number) => void): number {
    return window.requestAnimationFrame(cb);
  }

  now(): number {
    return performance.now();
  }

  /** 音频后端（懒建单例）；无 WebAudio / 无 Audio 构造器时 available=false → 全局静默 */
  createAudioBackend(): AudioBackend | null {
    if (!this.audioBackend) {
      try {
        this.audioBackend = new BrowserAudioBackend();
      } catch {
        return null;
      }
    }
    return this.audioBackend;
  }

  onVisibilityChange(cb: (visible: boolean) => void): void {
    try {
      document.addEventListener('visibilitychange', () => {
        cb(!(document as any).hidden);
      });
    } catch {
      /* 无 document（桩环境）→ 不订阅，音频层照常工作 */
    }
  }
}
