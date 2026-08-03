/**
 * star-t3-check.mjs — starRating T3 收紧自检（纯断言，无渲染依赖）
 * 用法：node tools/star-t3-check.mjs
 * 注意：starsFor 的真实签名是 (mismatches, pairs, tier?)。
 */
import { build } from 'esbuild';

const out = await build({
  entryPoints: ['src/core/starRating.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const src = out.outputFiles[0].text;
const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const { starsFor, STAR_K3, STAR_K3_T3, STAR_K2 } = mod;

let fail = 0;
function t(name, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  got=' + got + ' want=' + want);
}

t('T3 pairs=18 m=7  -> 3 stars (收紧后仍达标)', starsFor(7, 18, 'T3'), 3);
t('T3 pairs=18 m=8  -> 2 stars (原 K3=0.5 下为 3 stars，已收紧)', starsFor(8, 18, 'T3'), 2);
t('T3 pairs=18 m=9  -> 2 stars', starsFor(9, 18, 'T3'), 2);
t('T3 数字档位 3 == 字符串 T3', starsFor(8, 18, 3), 2);
t('旧调用(无 tier) pairs=18 m=7 -> 3 stars 向后兼容', starsFor(7, 18), 3);
t('旧调用(无 tier) pairs=18 m=9 -> 3 stars 旧阈值未变', starsFor(9, 18), 3);
t('T1 pairs=6  m=3 -> 3 stars 未受影响', starsFor(3, 6, 'T1'), 3);
t('T2 pairs=10 m=5 -> 3 stars 未受影响', starsFor(5, 10, 2), 3);
t('no-fail: T3 m=999 -> 1 star 永不 0 star', starsFor(999, 18, 'T3'), 1);
t('无效局 pairs=0 -> 1 star 保底', starsFor(0, 0, 'T3'), 1);
t('T3 2 stars 阈值 1.25 未变: m=23 -> 2 stars', starsFor(23, 18, 'T3'), 2);
t('T3 2 stars 边界: m=24 -> 1 star', starsFor(24, 18, 'T3'), 1);
t('常量 STAR_K3', STAR_K3, 0.5);
t('常量 STAR_K3_T3', STAR_K3_T3, 0.35);
t('常量 STAR_K2', STAR_K2, 1.25);

console.log(fail === 0 ? '\nSTAR T3 SELFTEST PASS' : '\nSTAR T3 SELFTEST FAIL (' + fail + ')');
process.exit(fail ? 1 : 0);
