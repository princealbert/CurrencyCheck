/**
 * platform/types.ts — 平台抽象层接口（无 DOM 依赖，浏览器 / 微信小游戏共用）
 *
 * 设计：渲染与输入只通过本接口访问宿主能力，绝不直接引用 document / window / wx。
 * 这样同一套 src/ 既可在浏览器用 web-entry（BrowserPlatform）开发，
 * 又可在微信小游戏用 wx-entry（WechatPlatform）跑，只入口不同、逻辑共享。
 *
 * 注：为支持图鉴滚动与 dpr 变换，在原始 spec 的 onPointer 之外补充了
 * onPointerMove / onPointerUp / resetTransform（均为可选增强，不破坏原契约）。
 */

/**
 * core 领域类型再导出：渲染层历史上从本模块 import { Region, FormFactor, MotifCategory, RegionShape }，
 * 而定义在 core/types。此处 re-export 补齐，使 tsc 与运行时口径一致（单一定义源仍是 core/types）。
 */
export type { FormFactor, Region, RegionShape, MotifCategory, GlyphKind } from '../core/types';

/** 画布句柄（浏览器=HTMLCanvasElement，小游戏=wx.createCanvas() 返回对象） */
export interface CanvasLike {
  width: number;
  height: number;
}

/**
 * 2D 上下文子集：浏览器 CanvasRenderingContext2D 与小游戏 2D context 共有的方法/属性。
 * 不使用 roundRect（小游戏旧版可能不支持），改用自定义 roundRectPath 辅助。
 */
export interface Ctx2DLike {
  // 状态
  fillStyle: string | CanvasGradientLike;
  strokeStyle: string | CanvasGradientLike;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  // 路径
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  // 变换
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(a: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  // 绘制
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  clip(): void;
  drawImage(img: ImageLike, dx: number, dy: number, dw: number, dh: number): void;
  // 渐变 / 图案 / 虚线（浏览器 CanvasRenderingContext2D 与微信 Canvas 2D 均原生支持）
  // 返回值用 any：渐变对象只需 .addColorStop，不引入平台专有类型依赖。
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): any;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): any;
  createPattern(img: any, repeat: string): any;
  setLineDash(segments: number[]): void;
}

/** 渐变句柄（材质层使用：线性/径向渐变的色标） */
export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

/** 图像句柄（浏览器=HTMLImageElement，小游戏=wx.createImage() 返回对象） */
export interface ImageLike {
  width: number;
  height: number;
}

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Platform {
  /** 主画布 */
  getCanvas(): CanvasLike;
  /**
   * 音频后端工厂（可选能力）。
   * 未实现 / 返回 null → platformAudio() 退化为 NULL_AUDIO_BACKEND，AudioManager 全局静默。
   * 设计为可选，使既有的桩 Platform（smoke / phase1 测试）无需改动即可继续工作。
   */
  createAudioBackend?(): AudioBackend | null;
  /**
   * 前后台切换回调（可选能力）。visible=false 表示切后台。
   * 音频层用它做「切后台静音 / 回前台续播」，缺失则不影响任何其它逻辑。
   */
  onVisibilityChange?(cb: (visible: boolean) => void): void;
  /** 2D 上下文 */
  getContext(): Ctx2DLike;
  /** 异步加载图像（缺失/失败由调用方降级为占位，不抛断流程） */
  loadImage(src: string): Promise<ImageLike>;
  /** 持久化读（无则返回 null） */
  getStorage(k: string): string | null;
  /** 持久化写 */
  setStorage(k: string, v: string): void;
  /** 指针按下（坐标已转换为逻辑像素，相对画布左上角） */
  onPointer(cb: (x: number, y: number) => void): void;
  /** 指针移动（图鉴滚动用；可选增强） */
  onPointerMove(cb: (x: number, y: number) => void): void;
  /** 指针抬起（点按判定用；可选增强） */
  onPointerUp(cb: (x: number, y: number) => void): void;
  /** 逻辑像素视口（= 设计坐标，已含 dpr 变换；渲染用此维度布局） */
  getViewport(): { w: number; h: number };
  /** 安全区内边距（逻辑像素） */
  safeAreaInset: SafeAreaInsets;
  /** 重置为 dpr 基准变换（每帧渲染前调用，确保坐标统一） */
  resetTransform(): void;
  /** 下一帧回调，返回句柄 */
  requestAnimationFrame(cb: (t: number) => void): number;
  /** 当前时间（ms） */
  now(): number;
  /** 设备方向：web 端随旋转变化；wx 端受 game.json deviceOrientation 锁死，恒为 portrait */
  getOrientation(): 'portrait' | 'landscape';
  /** 设备实际显示尺寸（CSS 像素）：web 横屏时用于「请竖屏」引导页铺满全屏；wx 端=屏幕逻辑尺寸 */
  getDeviceSize(): { w: number; h: number };
}

/** 由平台构造注入 CollectionStore 的极简 KV 后端 */
export interface KVStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** 便捷：把平台 getStorage/setStorage 包成 KVStore */
export function platformKV(platform: Platform): KVStore {
  return {
    getItem: (k) => platform.getStorage(k),
    setItem: (k, v) => platform.setStorage(k, v),
  };
}

/* ================= 音频后端抽象（audio-implementation.md §2） ================= */
/*
 * 与 KVStore 同构的能力抽象：core/audioManager.ts 只依赖本接口，
 * 「当前是不是微信」的判断收敛在 browser.ts / wechat.ts 各自的实现里，
 * 不允许 typeof wx 散落到 core / app / render 任何一层。
 *
 * 契约（与 loadImage 的静默降级口径一致）：
 *   create() 永不抛异常。资源缺失 / 解码失败 / 权限异常 → 返回 no-op 句柄，
 *   调用方无需 try/catch，游戏逻辑完全不受影响。
 */

/** 单个音频实例句柄（浏览器=WebAudio / HTMLAudio，小游戏=InnerAudioContext） */
export interface AudioHandle {
  play(): void;
  pause(): void;
  stop(): void;
  /** 0..1；由 AudioManager 算好最终值后写入，后端不做任何换算 */
  setVolume(v: number): void;
  setLoop(loop: boolean): void;
  /** 释放底层资源（小游戏 InnerAudioContext 必须 destroy，否则泄漏） */
  destroy(): void;
  readonly playing: boolean;
}

export interface AudioCreateOptions {
  /** true=短音效，走低延迟内存解码；false=长音乐，走流式播放 */
  shortSfx: boolean;
  loop?: boolean;
}

export interface AudioBackend {
  /** 是否可用；旧机型 / 权限异常 / 无音频能力 → false，AudioManager 整体降级为 no-op */
  readonly available: boolean;
  /** 创建实例。**永不抛异常**；加载失败时返回的句柄所有方法均为 no-op */
  create(src: string, opts: AudioCreateOptions): AudioHandle;
  /** 解除自动播放限制（Web 端须在首次用户手势中调用；微信端为 no-op） */
  unlock(): void;
}

/** 静默句柄工厂：文件缺失 / 后端不可用时的统一兜底 */
export function silentAudioHandle(): AudioHandle {
  return {
    play: () => {},
    pause: () => {},
    stop: () => {},
    setVolume: () => {},
    setLoop: () => {},
    destroy: () => {},
    playing: false,
  };
}

/** 全局静默后端：Node 单测 / 无音频能力宿主 */
export const NULL_AUDIO_BACKEND: AudioBackend = {
  available: false,
  create: () => silentAudioHandle(),
  unlock: () => {},
};

/** 便捷包装，对标 platformKV(platform)；任何异常都退化为静默后端 */
export function platformAudio(platform: Platform): AudioBackend {
  try {
    if (typeof platform.createAudioBackend === 'function') {
      const backend = platform.createAudioBackend();
      if (backend) return backend;
    }
  } catch {
    /* 后端构造失败 → 静默降级 */
  }
  return NULL_AUDIO_BACKEND;
}
