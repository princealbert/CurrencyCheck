/**
 * phase1-integration.mjs — Phase 1 端到端集成自验（Node，无浏览器）
 *
 * 与 smoke.mjs（只验「能启动不崩」）互补：本测**驱动真实 App 实例**走完整用户路径，
 * 每一步都执行真实的 drawApp 渲染管线（ctx 用记账桩），确保新增的
 * 档位阶梯 / 星评 / 清除+burst / toast / 色弱 全部在真实调用链上不抛错、状态正确。
 *
 *   node phase1-integration.mjs
 *
 * 路径：Hub → 点锁定档位(轻提示) → T1 满星通关 → T2 解锁 → T2 带错配通关(星评降档) →
 *       T3 解锁 → T3 36 张开局 → 色弱开关 → 图鉴 → 详情 → note 形态。
 */

import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const outDir = resolve(root, '.tmp-itest');
const outFile = resolve(outDir, 'app-bundle.cjs');
mkdirSync(outDir, { recursive: true });

await build({
  stdin: {
    contents: `
      export { App } from './src/app/app';
      export { CURRENCIES } from './src/data/currencies';
      export { TIERS } from './src/core/tierConfig';
      export { starsFor } from './src/core/starRating';
      export { gridFor } from './src/core/tierConfig';
      export { boardLayout } from './src/render/layout';
    `,
    resolveDir: root,
    sourcefile: 'phase1-itest-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  outfile: outFile,
  format: 'cjs',
  platform: 'node',
  target: ['node18'],
  logLevel: 'warning',
});

const { App, TIERS, gridFor, boardLayout } = createRequire(import.meta.url)(outFile);

/* ---------------- 断言器 ---------------- */
let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) passed++;
  else {
    failed++;
    console.log('  ✗ ' + name);
  }
}
function eq(name, got, want) {
  ok(name + ` (got=${JSON.stringify(got)} want=${JSON.stringify(want)})`, got === want);
}

/* ---------------- 无头 Platform（不依赖 DOM / localStorage） ---------------- */
const drawCalls = { count: 0 };
const ctxStub = new Proxy(
  {},
  {
    get(_t, p) {
      if (p === 'canvas') return { width: 390, height: 844 };
      if (p === 'measureText') return (s) => ({ width: String(s ?? '').length * 6 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern')
        return () => ({ addColorStop() {} });
      if (typeof p === 'string') {
        return (...a) => {
          drawCalls.count++;
          void a;
        };
      }
      return undefined;
    },
    set: () => true,
  }
);

function makePlatform() {
  const kv = new Map();
  let rafCb = null;
  let clock = 0;
  const p = {
    _kv: kv,
    safeAreaInset: { top: 44, right: 0, bottom: 34, left: 0 },
    getCanvas: () => ({ width: 390, height: 844 }),
    getContext: () => ctxStub,
    getViewport: () => ({ w: 390, h: 844 }),
    loadImage: () => Promise.reject(new Error('headless: no images')),
    getStorage: (k) => (kv.has(k) ? kv.get(k) : null),
    setStorage: (k, v) => kv.set(k, String(v)),
    onPointer: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
    resetTransform: () => {},
    requestAnimationFrame: (cb) => {
      rafCb = cb;
      return 1;
    },
    now: () => clock,
    /* 测试驱动辅助 */
    _step(ms = 16) {
      clock += ms;
      const cb = rafCb;
      rafCb = null;
      if (cb) cb(clock);
    },
    _steps(n, ms = 16) {
      for (let i = 0; i < n; i++) this._step(ms);
    },
  };
  return p;
}

/* ---------------- 交互辅助 ---------------- */
/** 命中并触发某个 hitTarget（按渲染顺序逆序命中，与 App.handleTap 一致） */
function tapRect(app, rect) {
  app.handleTap(rect.x + rect.w / 2, rect.y + rect.h / 2);
}

/** 找到当前 face_down 的一对同 iso 卡 */
function findPair(app) {
  const byIso = new Map();
  for (const c of app.match.cards) {
    if (c.state !== 'face_down') continue;
    const arr = byIso.get(c.iso) ?? [];
    arr.push(c);
    byIso.set(c.iso, arr);
    if (arr.length === 2) return arr;
  }
  return null;
}

/** 找到两张不同 iso 的 face_down 卡（制造一次错配） */
function findMismatch(app) {
  const down = app.match.cards.filter((c) => c.state === 'face_down');
  for (let i = 1; i < down.length; i++) {
    if (down[i].iso !== down[0].iso) return [down[0], down[i]];
  }
  return null;
}

/** 通关当前局；wantMismatches = 先故意错配几次 */
function playThrough(app, plat, wantMismatches = 0) {
  for (let i = 0; i < wantMismatches; i++) {
    const mm = findMismatch(app);
    if (!mm) break;
    app.flipCard(mm[0].id);
    app.flipCard(mm[1].id);
    plat._steps(60); // > MISMATCH_FLIPBACK_MS(800) → 翻回、解锁输入
    if (app.match.lock) return false;
  }
  let guard = 0;
  while (!app.won && guard++ < 200) {
    const pr = findPair(app);
    if (!pr) break;
    app.flipCard(pr[0].id);
    app.flipCard(pr[1].id);
    plat._steps(8); // 推进清除动画 / burst / toast
  }
  return app.won;
}

console.log('— A. 启动与 Hub 首帧 —');
const plat = makePlatform();
let app;
{
  let threw = null;
  try {
    app = new App(plat);
    app.start();
    plat._steps(3);
  } catch (e) {
    threw = e;
  }
  ok('App 构造 + 首帧渲染无异常', threw === null);
  if (threw) {
    console.log(threw);
    process.exit(1);
  }
  eq('初始视图 = hub', app.view, 'hub');
  ok('Hub 有命中区（2 形态 + 4 按钮 + 色弱 toggle）', app.hitTargets.length >= 7);
  ok('首帧确有绘制调用', drawCalls.count > 50);
  eq('初始档位仅 T1 开放', [app.isTierOpen(1), app.isTierOpen(2), app.isTierOpen(3)].join(','), 'true,false,false');
}

console.log('— A2. Hub 点击接线（按真实几何命中，非索引假设） —');
{
  const vp = plat.getViewport();
  const safe = plat.safeAreaInset;

  // §5.3 色弱 toggle：右上角 32×32
  const cbRect = { x: vp.w - safe.right - 12 - 32, y: safe.top + 8, w: 32, h: 32 };
  const cbBefore = app.colorblind;
  tapRect(app, cbRect);
  ok('点击右上角图标 → 色弱开关翻转', app.colorblind === !cbBefore);
  tapRect(app, cbRect);
  ok('再点一次翻回', app.colorblind === cbBefore);

  // §4.5 档位按钮：vstack(4 × 56, gap 14)，中心 = max(vp.h*0.60, segBottom+12+stackH/2)
  const btnW = Math.min(vp.w * 0.8, 340);
  const btnH = 56;
  const btnGap = 14;
  const stackH = btnH * 4 + btnGap * 3;
  const centerY = Math.max(vp.h * 0.6, safe.top + 188 + 46 + 12 + stackH / 2);
  const btnX = vp.w / 2 - btnW / 2;
  const btnY = (i) => centerY - stackH / 2 + i * (btnH + btnGap);
  const btnRect = (i) => ({ x: btnX, y: btnY(i), w: btnW, h: btnH });

  ok('按钮组不与形态选择条重叠', btnY(0) >= safe.top + 188 + 46);
  ok('按钮组不越出底部安全区', btnY(3) + btnH <= vp.h - safe.bottom - 20);

  tapRect(app, btnRect(0)); // T1
  eq('点 T1 → 进入配对', app.view, 'pair');
  eq('档位 = 1', app.tier, 1);
  app.backToHub();
  plat._steps(2);

  tapRect(app, btnRect(1)); // T2（此时未解锁）
  eq('点未解锁 T2 → 停留 Hub', app.view, 'hub');
  eq('并给出轻提示', app.toasts.length, 1);
  app.toasts.length = 0;
  plat._steps(2);

  tapRect(app, btnRect(3)); // 图鉴
  eq('点图鉴 → 进入 codex', app.view, 'codex');
  app.backToHub();
  plat._steps(2);
}

console.log('— B. 游戏时钟夹逼（§5.2） —');
{
  const before = app.gameTimeMs;
  plat._step(5000); // 模拟后台切回的巨大 rawDt
  const delta = app.gameTimeMs - before;
  ok(`单帧推进 ≤ 100ms（got ${delta}）`, delta <= 100 && delta > 0);
}

console.log('— C. 点击锁定档位 → 轻提示 toast，不跳转（§4.5） —');
{
  app.startPair('coin', 3); // 直接走 API：T3 未解锁
  eq('未解锁档位不进入 pair', app.view, 'hub');
  eq('轻提示已入队', app.toasts.length, 1);
  ok('提示文案正确', app.toasts[0].line1.indexOf('先完成') === 0);
  ok('单行提示（line2 空）', app.toasts[0].line2 === '');
  plat._steps(5);
  ok('Hub 渲染 toast 无异常', app.view === 'hub');
  // 点按 toast → 立即进入 exit（回归：曾因回拨 startAt 变负 → 被误判「未起播」而重播）
  app.dismissToast();
  ok('dismiss 不把 startAt 打成负数', app.toasts[0].startAt >= 0);
  plat._steps(40);
  eq('点按后快速出队（不重播）', app.toasts.length, 0);

  // 不点按也应自然到期出队
  app.startPair('coin', 3);
  eq('再次入队', app.toasts.length, 1);
  plat._steps(140); // > 200+1200+300
  eq('自然到期出队', app.toasts.length, 0);
}

console.log('— D. T1 满星通关 → 星评落盘 + T2 解锁（§2.3/§4.4） —');
{
  app.startPair('coin', 1);
  eq('进入 pair', app.view, 'pair');
  eq('T1 卡数 = 6', app.match.cards.length, 6);
  ok('棋盘有可点卡命中区', app.hitTargets.length >= 6);

  const won = playThrough(app, plat, 0);
  ok('T1 通关', won === true);
  eq('零错配 → 3 星', app.earnedStars, 3);
  eq('落盘最佳星', app.meta.bestStar(1, 'coin'), 3);
  eq('局数 +1', app.meta.plays(1), 1);
  ok('本局有新解锁', app.sessionUnlocked.length > 0);
  ok('mastery 已累计', app.match.cards.some((c) => app.meta.mastery(c.iso) > 0));
  plat._steps(60); // 渲染胜利面板（含三星逐颗弹入）
  ok('胜利面板渲染无异常', app.won === true);
  ok('T2 已解锁', app.isTierOpen(2) === true);
}

console.log('— E. T2 带错配通关 → 星评降档但绝不失败（§2.2 no-fail） —');
{
  app.backToHub();
  eq('回 Hub 清空瞬态', app.toasts.length, 0);
  app.startPair('coin', 2);
  eq('T2 卡数 = 16', app.match.cards.length, 16);

  const won = playThrough(app, plat, 6); // 6 次错配：ceil(8*0.5)=4 < 6 ≤ ceil(8*1.25)=10 → 2 星
  ok('T2 通关（错配不致失败）', won === true);
  eq('记错次数', app.match.mismatches, 6);
  eq('6 次错配 → 2 星', app.earnedStars, 2);
  ok('永不出现 0 星', app.earnedStars >= 1);
  eq('T2 最佳星落盘', app.meta.bestStar(2, 'coin'), 2);
  ok('T3 解锁（星评通道 bestStar≥2）', app.isTierOpen(3) === true);
  plat._steps(60);
}

console.log('— F. 最佳星只升不降 —');
{
  app.backToHub();
  app.startPair('coin', 2);
  playThrough(app, plat, 20); // 大量错配 → 1 星
  eq('本局 1 星', app.earnedStars, 1);
  eq('历史最佳仍为 2（只升不降）', app.meta.bestStar(2, 'coin'), 2);
  eq('T2 局数累计', app.meta.plays(2), 2);
  plat._steps(30);
}

console.log('— G. T3 36 张 6×6 开局 + 双形态（§4.1/决策 Q1） —');
{
  app.backToHub();
  app.startPair('coin', 3);
  eq('T3 进入 pair', app.view, 'pair');
  eq('T3 卡数 = 36', app.match.cards.length, 36);
  const per = {};
  for (const c of app.match.cards) per[c.iso] = (per[c.iso] || 0) + 1;
  ok('每 iso 张数为偶且 ≥4（基础 2 对）', Object.values(per).every((n) => n % 2 === 0 && n >= 4));
  eq('参与 iso 数 = 8', Object.keys(per).length, 8);
  plat._steps(10);
  // 布局守卫：格位数必须刚好覆盖牌数（否则渲染会静默丢牌），且 cell 仍可点
  {
    const vp = plat.getViewport();
    for (const tier of [1, 2, 3]) {
      for (const form of ['coin', 'note']) {
        const g = gridFor(tier, form);
        const lay = boardLayout(vp, plat.safeAreaInset, form, g.cols, g.rows);
        eq(`T${tier} ${form} 格位数 = 牌数`, lay.cards.length, TIERS[tier].pairs * 2);
        ok(`T${tier} ${form} cell 宽 ≥ 40px（可点）`, lay.cards[0].w >= 40);
        ok(`T${tier} ${form} 棋盘不溢出视口`,
          lay.board.x >= 0 && lay.board.y >= 0 &&
          lay.board.x + lay.board.w <= vp.w + 0.5 &&
          lay.board.y + lay.board.h <= vp.h + 0.5);
      }
    }
  }
  // 棋盘命中区 = 36 张卡 + 顶栏返回/重开
  app.backToHub();
  app.startPair('coin', 3);
  plat._steps(2);
  eq('T3 命中区 = 36 卡 + 2 顶栏按钮', app.hitTargets.length, 38);

  app.backToHub();
  app.startPair('note', 3);
  eq('T3 note 同开 36 张', app.match.cards.length, 36);
  ok('note 卡形态正确', app.match.cards.every((c) => c.form === 'note'));
  plat._steps(10); // 竖屏 + note → 触发横屏提示遮罩绘制路径
  ok('note 竖屏提示路径渲染无异常', app.view === 'pair');
}

console.log('— H. 色弱 / 高对比 toggle（§5.3） —');
{
  ok('默认关闭', app.colorblind === false);
  app.toggleColorblind();
  ok('开启后生效', app.colorblind === true);
  app.backToHub();
  app.startPair('coin', 3);
  plat._steps(10); // 色弱卡面（纹理带 / ISO 放大 / 徽标描边）渲染
  ok('色弱棋盘渲染无异常', app.view === 'pair');
  // 色弱下打一对 → burst 走全金分支
  const pr = findPair(app);
  app.flipCard(pr[0].id);
  app.flipCard(pr[1].id);
  plat._steps(60);
  ok('色弱 burst 渲染无异常', app.match.matchedCount >= 1);
  app.toggleColorblind();
  ok('可关闭', app.colorblind === false);
  // 设置持久化（同一 KV）
  const app2 = new App(plat);
  ok('设置跨实例恢复', app2.colorblind === false);
  app2.toggleColorblind();
  const app3 = new App(plat);
  ok('开启态跨实例恢复', app3.colorblind === true);
}

console.log('— I. 图鉴 / 详情渲染（§2.5 pips + 总星） —');
{
  app.backToHub();
  app.openCodex();
  eq('进入图鉴', app.view, 'codex');
  plat._steps(5);
  ok('图鉴渲染无异常（含 pips / 总星）', app.view === 'codex');
  ok('总星数在 0–18 之间', app.meta.totalStars() >= 0 && app.meta.totalStars() <= 18);

  const collected = app.hitTargets.length > 0;
  ok('图鉴有已解锁条目可点', collected);
  // 找一个已收集币种进详情
  const iso = ['USD', 'EUR', 'JPY', 'BRL', 'GBP', 'INR', 'ZAR', 'AUD'].find((x) => app.store.isCollected(x));
  ok('存在已收集币种', !!iso);
  app.openDetail(iso);
  eq('进入详情', app.view, 'detail');
  plat._steps(5);
  ok('详情渲染无异常', app.view === 'detail');
  // 未解锁币种不可进详情
  app.backToHub();
  app.openDetail('__NOPE__');
  eq('未收集不可进详情', app.view, 'hub');
}

console.log('— J. 解锁幂等 → 首次才闪现（§1.1 红线） —');
{
  // 此时 8 币 coin 形态多数已解锁；再打一局，已解锁的配对不应再产生 sessionUnlocked
  app.backToHub();
  app.startPair('coin', 2);
  const before = app.store.progress().unlocked;
  playThrough(app, plat, 0);
  const after = app.store.progress().unlocked;
  eq('已全解锁则不再新增（幂等）', app.sessionUnlocked.length, after - before);
  ok('解锁数只增不减', after >= before);
  plat._steps(40);
}

console.log('— K. 长时间空转稳定性 —');
{
  app.backToHub();
  let threw = null;
  try {
    plat._steps(300, 33); // ~10s
  } catch (e) {
    threw = e;
  }
  ok('Hub 空转 300 帧无异常', threw === null);
  app.startPair('coin', 1);
  try {
    plat._steps(300, 33);
  } catch (e) {
    threw = e;
  }
  ok('棋盘空转 300 帧无异常', threw === null);
  ok('累计绘制调用充足', drawCalls.count > 5000);
}

console.log('\n— 汇总 —');
console.log(`PASS ${passed} / ${passed + failed}` + (failed ? `   FAIL ${failed} ✗` : '   ALL GREEN ✓'));
rmSync(outDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
