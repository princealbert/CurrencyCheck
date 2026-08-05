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
import { copyFileSync, mkdirSync, existsSync, cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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
  // 清空目标 assets，避免旧构建残留（被排除资产 / 已删源文件）残留在包里顶穿体积上限
  rmSync(dest, { recursive: true, force: true });
  const remoteDir = resolve(src, 'remote');
  // 发布包资产排除规则（体积治理，微信总包硬上限 30MB，本地预览正常、上传才炸）：
  //  1) assets/remote/             → 走 CDN（环游世界 8 帧名胜图，见 world-tour-assets §C.4.1）
  //  2) 命名含 backup（不区分大小写）→ 回滚保留的旧音效（_backup_wooden / sfx_backup_prelevel）
  //  3) bgm 目录下含 'take' 的文件  → 出曲候选中间产物（bgm_tour_take1..5 / take4_keep），非发布资产
  const seg = (s) => s.split(sep).pop() || '';
  const isExcluded = (s) => /backup/i.test(seg(s)) || /bgm_tour_take/i.test(seg(s));
  cpSync(src, dest, {
    recursive: true,
    filter: (s) =>
      (!withRemote && (s === remoteDir || s.startsWith(remoteDir + sep))) || isExcluded(s)
        ? false
        : true,
  });
  console.log(
    '[build] assets →',
    destRel + '/assets',
    withRemote ? '' : '（已排除 assets/remote/，该批走 CDN）'
  );
}

/**
 * 清空产物里的 assets/ 目录（防止旧构建残留资产把发布包顶穿体积上限）。
 * 路线 A 下 wx 发布包不含任何资产（图像/音频全走 CDN），故 wx target 调本函数而非 copyAssets。
 */
function purgeAssets(destRel) {
  const dest = resolve(root, destRel, 'assets');
  rmSync(dest, { recursive: true, force: true });
  console.log('[build] 已清空', destRel + '/assets（wx 资产走 CDN，不进发布包）');
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
    // 本地预览：CDN base 为空 → 运行时走本地 assets/（localhost:8080 正常）
    define: { __CDN_BASE__: '""' },
  });
  copyIf('index.html', 'dist/index.html');
  // 部署修正：dist/ 会被当作静态站点根入口托管，脚本路径须相对 dist/ 自身（否则解析成 dist/dist/game.js → 404）
  const distHtml = resolve(root, 'dist/index.html');
  if (existsSync(distHtml)) {
    const html = readFileSync(distHtml, 'utf8').replace('src="dist/game.js"', 'src="game.js"');
    writeFileSync(distHtml, html);
  }
  // web demo 不打包 assets/remote/（环游世界 8 帧名胜图，仅满收集才用，缺失有兜底渐变），
  // 省 ~7.5MB 体积、避免与首屏图片抢带宽；wx 早已排除。
  copyAssets('dist', false);
  console.log('[build] web → dist/game.js (iife)');
}

async function buildWx() {
  mkdirSync(resolve(root, 'wx-dist'), { recursive: true });
  // 路线 A：资产全 CDN。wx 发布包只留 game.js + 配置，图像/音频运行时从 CDN 拉。
  // CDN base 由构建期环境变量 CDN_BASE_URL 注入（不硬编码域名）。
  // 缺省空串 → 仅用于体积验证；真机发布务必带 CDN_BASE_URL，否则运行时资产不在包内会静默降级。
  const cdnBase = process.env.CDN_BASE_URL || '';
  if (!cdnBase) {
    console.warn(
      '[build] ⚠ 未设置 CDN_BASE_URL：wx 包将不含任何资产，仅可用于体积验证。' +
        '真机发布请带 CDN_BASE_URL=https://your-cdn.example.com 重新构建。'
    );
  }
  await build({
    entryPoints: [resolve(root, 'src/wx-entry.ts')],
    bundle: true,
    outfile: resolve(root, 'wx-dist/game.js'),
    format: 'cjs',
    platform: 'browser',
    target: ['es2018'],
    logLevel: 'info',
    define: { __CDN_BASE__: JSON.stringify(cdnBase) },
  });
  copyIf('game.json', 'wx-dist/game.json');
  copyIf('project.config.json', 'wx-dist/project.config.json');
  // B1 修复：wx 主包不再打包任何资产（图像/音频全走 CDN），仅清掉旧资产残留防顶穿体积。
  purgeAssets('wx-dist');
  console.log('[build] wx → wx-dist/game.js (cjs) · 资产走 CDN（包内不含 assets/）');
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
