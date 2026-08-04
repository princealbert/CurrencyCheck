/**
 * config/cdn.ts — 资产基址解析（Phase 7 发布阻断 B1/B2 修复 · 路线 A：资产全 CDN）
 *
 * 设计目标：
 *   - wx 发布包只留 game.js + 配置（game.json / project.config.json）；图像 / 音频
 *     运行时从**可配置 CDN base URL** 拉取；缺失 / 失败降级几何占位或静默（既有契约保留）。
 *   - web / dev 模式（localhost:8080）走本地 assets/，不依赖 CDN，本地预览与验收照常。
 *   - **绝不硬编码任何域名**：CDN base 由构建期经 esbuild `define __CDN_BASE__` 注入。
 *
 * 4 个 base 常量（QA 定位的「4 个 base 常量 stub」统一在此启用）：
 *   IMAGES_BASE  · 母题 PNG（cur_*）
 *   SCENES_BASE  · 场景底图 / 装饰件（bg_* / deco_*）
 *   AUDIO_ROOT   · 音频根（sfx/ bgm/）
 *   WORLDTOUR_BASE · 环游世界帧图（worldtour_*）
 *
 * 当 CDN 激活（注入了非空 base）时，每个常量 = CDN_BASE + 本地相对前缀；
 * 否则 = 本地相对前缀（web 兜底）。本地与线上文件尾段（文件名）**完全一致**，
 * 故 CDN 上只需把 `assets/` 整目录原样上传到 CDN root（见 CDN_SETUP.md）。
 *
 * 注入方式（build.mjs）：
 *   - web target：__CDN_BASE__ = ''（空 → 本地 assets）
 *   - wx  target：__CDN_BASE__ = 环境变量 CDN_BASE_URL（如 https://cdn.example.com）
 *     未注入时（直接 `node build.mjs wx` 不带环境变量）退化为本地相对路径，
 *     运行时在 wx 下会因资产不在包内而静默降级 —— 仅用于体积验证，真机发布务必带 CDN_BASE_URL。
 */

/** 构建期注入的 CDN 根（结尾无斜杠）。web 下为空串。 */
declare const __CDN_BASE__: string;

/**
 * 解析后的 CDN 根。
 * 用 typeof 守护：即使未打 define（如音频冒烟测试用 esbuild 现打 ESM、未注入），
 * `__CDN_BASE__` 为 undefined → 视为主包本地模式，绝不抛异常。
 */
export const CDN_BASE: string = typeof __CDN_BASE__ === 'string' ? __CDN_BASE__ : '';

/** 是否走 CDN：仅当注入了非空 base（= wx 发布 target）为 true；web / 未注入均为 false。 */
export const USE_CDN: boolean = CDN_BASE.length > 0;

/** 把本地相对前缀拼上 CDN base（去重斜杠）；非 CDN 时原样返回。 */
function withCdn(localPrefix: string): string {
  if (!USE_CDN) return localPrefix;
  const base = CDN_BASE.replace(/\/+$/, '');
  return base + '/' + localPrefix;
}

/** 母题 PNG（cur_*）：本地 assets/ */
export const IMAGES_BASE: string = withCdn('assets/');

/** 场景底图 / 装饰件（bg_* / deco_*）：同 assets/ 层 */
export const SCENES_BASE: string = withCdn('assets/');

/** 音频根（sfx/ bgm/）：本地 assets/audio/ */
export const AUDIO_ROOT: string = withCdn('assets/audio/');

/** 环游世界帧图：本地 assets/remote/worldtour/ */
export const WORLDTOUR_BASE: string = withCdn('assets/remote/worldtour/');
