/**
 * phase1-test.mjs — Phase 1「玩法深度」纯逻辑单测（Node，零浏览器依赖）
 *
 * 与 src/core/__selftest__.mjs 的镜像式自测不同：本文件用 esbuild 直接打包**真实 TS 源**
 * 到临时 CJS，再对真实实现断言 —— 不存在「镜像与实现漂移」的风险。
 *
 *   node phase1-test.mjs
 *
 * 覆盖：starRating（无失败星评）/ tierConfig（档位表·加权抽·解锁双通道）/
 *       deck（计划发牌·validateDeck 参数化）/ metaStore（只升不降·局数·mastery·设置）/
 *       matchLogic（mismatches 计数）/ fx（清除时间线·toast 时间线·粒子池不越界）。
 */

import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const outDir = resolve(root, '.tmp-test');
const outFile = resolve(outDir, 'core-bundle.cjs');

mkdirSync(outDir, { recursive: true });

await build({
  stdin: {
    contents: `
      export * from './src/core/starRating';
      export * from './src/core/tierConfig';
      export * from './src/core/deck';
      export * from './src/core/metaStore';
      export * from './src/core/matchLogic';
      export { clearAnimAt, toastPhaseAt, spawnBurst, updateFx, hasActiveFx, resetFx,
               CLEAR_A_END, CLEAR_B_END, CLEAR_C_END, BURST_AT, TOAST_ENTER_MS,
               TOAST_EXIT_MS, toastTotal } from './src/render/fx';
      export { CURRENCIES } from './src/data/currencies';
    `,
    resolveDir: root,
    sourcefile: 'phase1-test-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  outfile: outFile,
  format: 'cjs',
  platform: 'node',
  target: ['node18'],
  logLevel: 'warning',
});

const require_ = createRequire(import.meta.url);
const M = require_(outFile);

/* ---------------- 断言器 ---------------- */
let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log('  ✗ ' + name);
  }
}
function eq(name, got, want) {
  ok(name + ` (got=${JSON.stringify(got)} want=${JSON.stringify(want)})`, got === want);
}
/** 固定序列 rng（可复现抽取） */
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

console.log('— 1. starRating（§2.2 无失败星评） —');
{
  const { starsFor, STAR_K3, STAR_K2 } = M;
  eq('常数 K3', STAR_K3, 0.5);
  eq('常数 K2', STAR_K2, 1.25);
  // P=8：3⭐ m≤4；2⭐ m≤10；否则 1⭐
  eq('P8 m0 → 3', starsFor(0, 8), 3);
  eq('P8 m4 → 3（边界含）', starsFor(4, 8), 3);
  eq('P8 m5 → 2', starsFor(5, 8), 2);
  eq('P8 m10 → 2（边界含）', starsFor(10, 8), 2);
  eq('P8 m11 → 1', starsFor(11, 8), 1);
  // P=3：ceil(1.5)=2 / ceil(3.75)=4
  eq('P3 m2 → 3', starsFor(2, 3), 3);
  eq('P3 m3 → 2', starsFor(3, 3), 2);
  eq('P3 m4 → 2', starsFor(4, 3), 2);
  eq('P3 m5 → 1', starsFor(5, 3), 1);
  // P=18：ceil(9)=9 / ceil(22.5)=23
  eq('P18 m9 → 3', starsFor(9, 18), 3);
  eq('P18 m23 → 2', starsFor(23, 18), 2);
  eq('P18 m24 → 1', starsFor(24, 18), 1);
  // 红线：永不 0 星 / 永不失败
  ok('极端 m=9999 仍 ≥1 星（no-fail）', starsFor(9999, 18) === 1);
  ok('负数/脏输入夹逼后仍 1–3', [starsFor(-5, 8), starsFor(0, 0)].every((s) => s >= 1 && s <= 3));
}

console.log('— 2. tierConfig 档位表（§4.1/§4.3） —');
{
  const { TIERS, TIER_IDS, tierDef, gridFor } = M;
  eq('档位数 = 3', TIER_IDS.length, 3);
  eq('T1 对数', TIERS[1].pairs, 3);
  eq('T2 对数', TIERS[2].pairs, 8);
  eq('T3 对数', TIERS[3].pairs, 18);
  for (const t of TIER_IDS) {
    for (const f of ['coin', 'note']) {
      const g = gridFor(t, f);
      eq(`T${t} ${f} 格数 = 2P`, g.cols * g.rows, TIERS[t].pairs * 2);
    }
  }
  eq('T3 note 同开 6×6（决策 Q1）', gridFor(3, 'note').cols, 6);
  ok('越界档位夹到 T1', tierDef(99).id === 1);
}

console.log('— 3. pickWeighted 加权无放回（§4.1） —');
{
  const { pickWeighted } = M;
  const items = ['a', 'b', 'c', 'd'];
  const got = pickWeighted(seqRng([0, 0, 0, 0]), items, () => 1, 3);
  eq('抽 3 个', got.length, 3);
  eq('无重复', new Set(got).size, 3);
  ok('不修改入参', items.length === 4);
  eq('n > 长度 → 返回全部', pickWeighted(seqRng([0]), items, () => 1, 99).length, 4);
  eq('n = 0 → 空', pickWeighted(seqRng([0]), items, () => 1, 0).length, 0);
  // 权重生效：只有 'c' 有权重 → 必中 c
  eq('仅 c 有权重 → 必中 c', pickWeighted(seqRng([0.5]), items, (x) => (x === 'c' ? 10 : 0), 1)[0], 'c');
  // 全零权重 → 退化均匀，仍能凑够张数
  eq('全零权重仍凑够', pickWeighted(seqRng([0.99, 0.5, 0.1]), items, () => 0, 3).length, 3);
}

console.log('— 4. planFor 组牌计划（§4.1/§4.2） —');
{
  const { planFor, TIERS, CURRENCIES } = M;
  const isos = CURRENCIES.map((c) => c.iso);
  const ctxAllLocked = { rng: Math.random, isUnlocked: () => false, pips: () => 0 };
  const ctxAllKnown = { rng: Math.random, isUnlocked: () => true, pips: () => 3 };

  for (const tier of [1, 2, 3]) {
    for (const ctx of [ctxAllLocked, ctxAllKnown]) {
      const plan = planFor(tier, isos, ctx);
      const sum = plan.reduce((s, p) => s + p.pairs, 0);
      eq(`T${tier} 计划对数合计 = ${TIERS[tier].pairs}`, sum, TIERS[tier].pairs);
      ok(`T${tier} 每项 pairs ≥ 1`, plan.every((p) => p.pairs >= 1));
      ok(`T${tier} iso 不重复`, new Set(plan.map((p) => p.iso)).size === plan.length);
    }
  }
  eq('T1 只用 3 个 iso', planFor(1, isos, ctxAllLocked).length, 3);
  eq('T2 用全部 8 个 iso', planFor(2, isos, ctxAllLocked).length, 8);
  {
    const plan = planFor(3, isos, ctxAllLocked);
    eq('T3 用全部 8 个 iso', plan.length, 8);
    eq('T3 恰有 2 个 iso 被加抽到 3 对', plan.filter((p) => p.pairs === 3).length, 2);
    ok('T3 其余均为 2 对', plan.filter((p) => p.pairs === 2).length === 6);
  }
  /* T1 权重：未解锁 ×3。用固定种子 LCG 做频次统计（可复现，不依赖 Math.random）。
   * 8 选 3 的均匀入选率 = 37.5%；权重 3 应把未解锁项显著抬高（阈值取保守的 55%）。 */
  {
    let seed = 20240731;
    const lcg = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const ctx = { rng: lcg, isUnlocked: (iso) => iso !== 'JPY', pips: () => 0 };
    const N = 1000;
    let jpy = 0;
    let other = 0;
    const otherIso = isos.find((x) => x !== 'JPY');
    for (let i = 0; i < N; i++) {
      const plan = planFor(1, isos, ctx);
      if (plan.some((p) => p.iso === 'JPY')) jpy++;
      if (plan.some((p) => p.iso === otherIso)) other++;
    }
    ok(`T1 未解锁项入选率显著更高（JPY ${jpy}/${N} vs ${otherIso} ${other}/${N}）`,
      jpy / N > 0.55 && jpy > other);
  }
}

console.log('— 5. deck 计划发牌 + validateDeck 参数化（§4.2/§5.1） —');
{
  const { buildDeckPlan, buildDeck, validateDeck, CURRENCIES, entityKey } = M;
  eq('entityKey', entityKey('USD', 'coin'), 'USD_coin');

  const plan3 = [
    { iso: 'USD', pairs: 3 },
    { iso: 'EUR', pairs: 2 },
    { iso: 'JPY', pairs: 1 },
  ];
  const cards = buildDeckPlan(plan3, CURRENCIES, 'coin');
  eq('总张数 = 2 × Σpairs', cards.length, 12);
  const per = {};
  for (const c of cards) per[c.iso] = (per[c.iso] || 0) + 1;
  eq('USD 6 张', per.USD, 6);
  eq('EUR 4 张', per.EUR, 4);
  eq('JPY 2 张', per.JPY, 2);
  ok('每 iso 偶数且 ≥2', Object.values(per).every((n) => n % 2 === 0 && n >= 2));
  ok('卡 id 唯一', new Set(cards.map((c) => c.id)).size === cards.length);
  ok('全部 face_down 起手', cards.every((c) => c.state === 'face_down'));
  ok('形态一致', cards.every((c) => c.form === 'coin'));

  const v = validateDeck(cards, 6);
  ok('validateDeck(cards, 6) 通过', v.ok === true);
  ok('validateDeck 期望对数不符 → 不通过', validateDeck(cards, 8).ok === false);

  // 兼容：buildDeck 仍是「每币 1 对」的全量特例
  const full = buildDeck(CURRENCIES, 'note');
  eq('buildDeck 张数 = 2 × 币种数', full.length, CURRENCIES.length * 2);
  ok('buildDeck 默认校验通过', validateDeck(full, CURRENCIES.length).ok === true);
  ok('buildDeck 不传期望对数也通过', validateDeck(full).ok === true);
  // 破坏性用例：单张奇数 → 必须判 false
  ok('奇数张 iso → 校验失败', validateDeck(full.slice(1), CURRENCIES.length).ok === false);
}

console.log('— 6. matchLogic mismatches 计数（§2.1） —');
{
  const { createMatchState, flip, evaluate, flipBack, buildDeckPlan, CURRENCIES } = M;
  const cards = buildDeckPlan([{ iso: 'USD', pairs: 1 }, { iso: 'EUR', pairs: 1 }], CURRENCIES, 'coin');
  let s = createMatchState(cards);
  eq('初始 mismatches = 0', s.mismatches, 0);

  const usd = cards.filter((c) => c.iso === 'USD');
  const eur = cards.filter((c) => c.iso === 'EUR');
  // 一次错配
  s = flip(s, usd[0].id);
  s = flip(s, eur[0].id);
  let r = evaluate(s);
  s = r.state;
  ok('错配 matched=false', r.result.matched === false);
  eq('错配后 mismatches = 1', s.mismatches, 1);
  s = flipBack(s);
  eq('翻回后 mismatches 保持 1（纯增不减）', s.mismatches, 1);
  // 一次正确
  s = flip(s, usd[0].id);
  s = flip(s, usd[1].id);
  r = evaluate(s);
  s = r.state;
  ok('配对成功', r.result.matched === true);
  eq('成功不改 mismatches', s.mismatches, 1);
  // 收尾
  s = flip(s, eur[0].id);
  s = flip(s, eur[1].id);
  r = evaluate(s);
  s = r.state;
  ok('全清 complete=true', r.result.complete === true);
  eq('终局 mismatches = 1', s.mismatches, 1);
}

console.log('— 7. metaStore 元进度（§2.3/§2.4/§4.4/§6.4） —');
{
  const { MetaStore, MASTERY_TIERS, TOTAL_STARS, isTierUnlocked } = M;
  // 内存 KV 桩（等价 localStorage / wx storage 契约）
  function memKV() {
    const m = new Map();
    return {
      map: m,
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  }
  const kv = memKV();
  const meta = new MetaStore(kv);

  eq('初始 bestStar = 0', meta.bestStar(1, 'coin'), 0);
  ok('写入 2 星 = 刷新', meta.setBestStar(1, 'coin', 2) === true);
  ok('写入更低 1 星 = 不刷新', meta.setBestStar(1, 'coin', 1) === false);
  eq('只升不降', meta.bestStar(1, 'coin'), 2);
  ok('写入 3 星 = 刷新', meta.setBestStar(1, 'coin', 3) === true);
  eq('bestStarOfTier 取两形态最高', meta.bestStarOfTier(1), 3);
  meta.setBestStar(1, 'note', 1);
  eq('note 独立记账', meta.bestStar(1, 'note'), 1);
  eq('totalStars 求和', meta.totalStars(), 4);
  eq('TOTAL_STARS = 18', TOTAL_STARS, 18);

  eq('初始 plays = 0', meta.plays(1), 0);
  meta.addPlay(1);
  meta.addPlay(1);
  eq('addPlay 累计', meta.plays(1), 2);

  eq('初始 mastery = 0', meta.mastery('USD'), 0);
  eq('初始 pips = 0', meta.pips('USD'), 0);
  meta.addMastery('USD');
  eq('1 次 → pips 1', meta.pips('USD'), 1);
  for (let i = 0; i < 4; i++) meta.addMastery('USD');
  eq('5 次 → pips 2', meta.pips('USD'), 2);
  for (let i = 0; i < 10; i++) meta.addMastery('USD');
  eq('15 次 → pips 3', meta.pips('USD'), 3);
  for (let i = 0; i < 50; i++) meta.addMastery('USD');
  eq('pips 上限 3', meta.pips('USD'), 3);
  eq('里程碑门槛', MASTERY_TIERS.join(','), '1,5,15');

  ok('默认色弱关', meta.colorblind === false);
  meta.setColorblind(true);
  ok('开启色弱', meta.colorblind === true);

  // 跨实例（模拟重启）：全部字段从 KV 恢复
  const meta2 = new MetaStore(kv);
  eq('重启后 bestStar 恢复', meta2.bestStar(1, 'coin'), 3);
  eq('重启后 plays 恢复', meta2.plays(1), 2);
  eq('重启后 pips 恢复', meta2.pips('USD'), 3);
  ok('重启后色弱设置恢复', meta2.colorblind === true);
  ok('存储键符合 §6.4', ['currency-codex-stars-v1', 'currency-codex-plays-v1',
    'currency-codex-mastery-v1', 'currency-codex-settings-v1'].every((k) => kv.map.has(k)));

  // 老玩家迁移：有解锁记录但无局数 → 补 T1 一局，且幂等
  const kv2 = memKV();
  const legacy = new MetaStore(kv2);
  legacy.migrateLegacy(true);
  eq('迁移后 T1 plays = 1', legacy.plays(1), 1);
  legacy.migrateLegacy(true);
  eq('迁移幂等', legacy.plays(1), 1);
  const fresh = new MetaStore(memKV());
  fresh.migrateLegacy(false);
  eq('全新玩家不迁移', fresh.plays(1), 0);

  /* 解锁双通道（§4.4）：T1 恒开 / T2 需 T1≥1 局 / T3 需 T2 最佳≥2 星 或 T2≥3 局 */
  const prog = (plays, stars) => ({ plays: (t) => plays[t] || 0, bestStar: (t) => stars[t] || 0 });
  ok('T1 恒开', isTierUnlocked(1, prog({}, {})));
  ok('T2 初始锁', isTierUnlocked(2, prog({}, {})) === false);
  ok('T1 完成 1 局 → T2 开', isTierUnlocked(2, prog({ 1: 1 }, {})));
  ok('T3 初始锁', isTierUnlocked(3, prog({ 1: 9 }, {})) === false);
  ok('T2 得 2 星 → T3 开（星评通道）', isTierUnlocked(3, prog({}, { 2: 2 })));
  ok('T2 打 3 局 → T3 开（保底通道）', isTierUnlocked(3, prog({ 2: 3 }, { 2: 1 })));
  ok('T2 打 2 局 + 1 星 → T3 仍锁', isTierUnlocked(3, prog({ 2: 2 }, { 2: 1 })) === false);
}

console.log('— 8. fx 时间线与粒子池（§3.1/§1.3/§3.3） —');
{
  const {
    clearAnimAt, CLEAR_A_END, CLEAR_B_END, CLEAR_C_END,
    toastPhaseAt, TOAST_ENTER_MS, TOAST_EXIT_MS, toastTotal,
    spawnBurst, updateFx, hasActiveFx, resetFx,
  } = M;

  eq('清除时间线关键点', `${CLEAR_A_END}/${CLEAR_B_END}/${CLEAR_C_END}`, '250/370/650');
  ok('t=0 全不透明', clearAnimAt(0).alpha > 0.99 && clearAnimAt(0).done === false);
  ok('A 段高亮', clearAnimAt(100).highlight === true);
  ok('C 段末 done', clearAnimAt(CLEAR_C_END + 1).done === true);
  ok('结束后 alpha 归 0', clearAnimAt(CLEAR_C_END + 1).alpha <= 0.001);
  {
    // 单调性：alpha 不回升
    let prev = 2;
    let mono = true;
    for (let t = 0; t <= CLEAR_C_END + 50; t += 10) {
      const a = clearAnimAt(t).alpha;
      if (a > prev + 1e-6) mono = false;
      prev = a;
    }
    ok('alpha 单调不增', mono);
  }

  eq('toast 总时长', toastTotal(1000), TOAST_ENTER_MS + 1000 + TOAST_EXIT_MS);
  ok('enter 段渐入', toastPhaseAt(0, 1000).alpha < toastPhaseAt(TOAST_ENTER_MS - 1, 1000).alpha);
  ok('hold 段全不透明', Math.abs(toastPhaseAt(TOAST_ENTER_MS + 500, 1000).alpha - 1) < 1e-6);
  ok('exit 结束 done', toastPhaseAt(toastTotal(1000) + 1, 1000).done === true);

  resetFx();
  ok('重置后无活动粒子', hasActiveFx() === false);
  // 连喷 20 次解锁 burst（远超 48 槽）→ 池不越界、不抛错
  let threw = false;
  try {
    for (let i = 0; i < 20; i++) spawnBurst(i * 10, 100, 100, 60, 'amer', true, false, () => 0.5);
  } catch (e) {
    threw = true;
  }
  ok('超量 spawn 不抛错（对象池复用）', threw === false);
  ok('spawn 后有活动粒子', hasActiveFx() === true);
  // 推进足够长时间 → 全部回收
  for (let t = 200; t <= 4000; t += 100) updateFx(t, 100);
  ok('生命周期结束后自动回收', hasActiveFx() === false);
  resetFx();
  ok('resetFx 幂等', hasActiveFx() === false);
}

console.log('\n— 汇总 —');
console.log(`PASS ${passed} / ${passed + failed}` + (failed ? `   FAIL ${failed} ✗` : '   ALL GREEN ✓'));
rmSync(outDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
