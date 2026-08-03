/**
 * __audio_entry__.ts — audio-smoke.mjs 专用聚合入口（**仅测试用，不进游戏包**）
 *
 * 存在理由：audio-smoke 要测的是真实源码而非手抄镜像，故用 esbuild 现打一份 ESM。
 * 单一入口比逐模块打包省事，也保证测试跑的依赖图与线上完全一致。
 * game 入口（web-entry / wx-entry）不引用本文件 → 不会进主包，零包体成本。
 */

export * from './audioEvents';
export * from './audioManager';
export { MetaStore } from './metaStore';
