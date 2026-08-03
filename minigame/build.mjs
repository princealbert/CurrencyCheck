/**
 * build.mjs — esbuild 无头打包（双 target）
 *
 *   node build.mjs web   → dist/game.js   (format: iife，浏览器开发)
 *   node build.mjs wx    → wx-dist/game.js (format: cjs，微信小游戏)
 *   node build.mjs all   → 两者都打
 *
 * 说明：
 *  - web 产物用 iife（兼容性最好），并把 index.html 复制到 dist/。
 *  - wx 产物用 cjs（微信小游戏运行时要求 CommonJS module），并复制 game.json / project.config.json 到 wx-dist/。
 *  - 平台探测在运行时（main.boot）完成，因此同一份 src 只打两份入口不同的包。
 *
 * 注意：本文件依赖 esbuild（devDependency）。未 npm install 时无法直接运行，
 *       交给主理人统一装包验证（见 README）。逻辑代码本身不依赖构建即可被 IDE / 类型检查阅读。
 */

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const root = process.cwd();
const target = process.argv[2] || 'web';

function copyIf(srcRel, destRel) {
  const src = resolve(root, srcRel);
  const dest = resolve(root, destRel);
  if (!existsSync(src)) {
    console.warn('[build] 跳过缺失文件:', srcRel);
    return;
  }
  copyFileSync(src, dest);
}

/**
 * 把资产目录（Seedream 母题 PNG）递归复制到产物包，使 web / wx 两份包自包含。
 *
 * @param destRel     产物目录（'dist' | 'wx-dist'）
 * @param withRemote  是否连 assets/remote/ 一起复制
 *
 * ⚠ assets/remote/ 的特殊处理（world-tour-assets §C.4.1）：
 *   该目录放「环游世界」8 张 1080×1920 名胜帧图，**上线走 CDN**。
 *   微信小游戏主包硬上限 4MB，8 张图即便 pngquant 压过也在 2–3MB，
 *   一进主包就会把整包顶穿 —— 且报错发生在**开发者工具上传那一刻**，
 *   本地预览一切正常，属于典型的"最后一公里才炸"。故 wx target 一律排除。
 *   web target 保留：本地 `npm run serve` 要能直接看到真图，不然连验收都没法做。
 *
 *   排除只做**顶层 remote/ 这一层**，用 cpSync 的 filter 回调实现；filter 对
 *   每个条目调用一次，返回 false 即整棵子树跳过（Node ≥16.7 的既定语义）。
 */
function copyAssets(destRel, withRemote) {
  const src = resolve(root, 'assets');
  const dest = resolve(root, destRel, 'assets');
  if (!existsSync(src)) {
    console.warn('[build] 无 assets/ 目录，跳过资产复制');
    return;
  }
  const remoteDir = resolve(src, 'remote');
  cpSync(src, dest, {
    recursive: true,
    filter: (s) => withRemote || (s !== remoteDir && !s.startsWith(remoteDir + sep)),
  });
  console.log(
    '[build] assets →',
    destRel + '/assets',
    withRemote ? '' : '（已排除 assets/remote/，该批走 CDN）'
  );
}

async function buildWeb() {
  mkdirSync(resolve(root, 'dist'), { recursive: true });
  await build({
    entryPoints: [resolve(root, 'src/web-entry.ts')],
    bundle: true,
    outfile: resolve(root, 'dist/game.js'),
    format: 'iife',
    platform: 'browser',
    target: ['es2018'],
    sourcemap: true,
    logLevel: 'info',
  });
  copyIf('index.html', 'dist/index.html');
  copyAssets('dist', true);
  console.log('[build] web → dist/game.js (iife)');
}

async function buildWx() {
  mkdirSync(resolve(root, 'wx-dist'), { recursive: true });
  await build({
    entryPoints: [resolve(root, 'src/wx-entry.ts')],
    bundle: true,
    outfile: resolve(root, 'wx-dist/game.js'),
    format: 'cjs',
    platform: 'browser',
    target: ['es2018'],
    logLevel: 'info',
  });
  copyIf('game.json', 'wx-dist/game.json');
  copyIf('project.config.json', 'wx-dist/project.config.json');
  copyAssets('wx-dist', false);
  console.log('[build] wx → wx-dist/game.js (cjs)');
}

(async () => {
  try {
    if (target === 'web' || target === 'all') await buildWeb();
    if (target === 'wx' || target === 'all') await buildWx();
    if (target !== 'web' && target !== 'wx' && target !== 'all') {
      console.error('[build] 未知 target:', target, '（用 web / wx / all）');
      process.exit(1);
    }
  } catch (e) {
    console.error('[build] 失败:', e);
    process.exit(1);
  }
})();
