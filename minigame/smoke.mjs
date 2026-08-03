// 无头冒烟测试：用桩模拟浏览器 canvas/DOM，加载打包后的 iife 产物，
// 确认 boot() 不抛错（验证 core 逻辑 + layout + renderer 首次绘制路径可运行）。
// 不验证视觉效果，仅验证「能启动、不崩溃」。
import { readFileSync } from 'node:fs';

const noop = () => {};
const canvasStub = {
  width: 800, height: 600, style: {},
  getContext: () => ctxProxy,
  addEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  parentNode: null,
};
const ctxProxy = new Proxy({}, {
  get: (_t, p) => {
    if (p === 'canvas') return canvasStub;
    if (p === 'measureText') return () => ({ width: 12 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern')
      return () => ({ addColorStop: noop });
    if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    return typeof p === 'string' ? noop : undefined;
  },
  set: () => true,
});
const elStub = () => ({ style: {}, appendChild: noop, addEventListener: noop, getContext: () => ctxProxy, width: 0, height: 0 });

globalThis.document = {
  createElement: (t) => (t === 'canvas' ? canvasStub : elStub()),
  getElementById: () => elStub(),
  querySelector: () => elStub(),
  body: { appendChild: noop, style: {} },
  addEventListener: noop,
};
globalThis.window = {
  innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: () => 0,
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const code = readFileSync(new URL('./dist/game.js', import.meta.url), 'utf8');
try {
  // iife 产物：执行即触发 boot（web-entry 顶层调用）。用 Function 在全局作用域执行。
  new Function(code)();
  console.log('SMOKE PASS ✓ boot() 执行无异常（浏览器桩环境下）');
  process.exit(0);
} catch (e) {
  console.error('SMOKE FAIL ✗ boot() 抛错：', e && e.stack ? e.stack : e);
  process.exit(1);
}
