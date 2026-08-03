/**
 * __selftest__.mjs — 纯逻辑 Node 自测（无 cc 依赖，可直接 `node __selftest__.mjs`）
 *
 * 为什么是 .mjs 镜像而非直接 import .ts：Node 22 strip-types 要求 import 用显式 `.ts` 扩展名，
 * 而 Cocos 工程规范要求 extensionless import（见 PROJECT_NOTES.md）。为避免二义、保证单一可编译源，
 * 此处对 core/*.ts 的纯逻辑做 1:1 镜像实现并断言验证。
 * 验证项：发牌去重 / 解锁幂等 / 配对判定 / 输入锁 / 连击计分 / 胜利判定。
 */

/* ---------------- 镜像：types（仅本测所需子集） ---------------- */
const MISMATCH_FLIPBACK_MS = 800;

/* ---------------- 镜像：deck ---------------- */
function entityKey(iso, form) { return iso + '_' + form; }

function buildDeck(currencies, form) {
  const deck = [];
  currencies.forEach((c, i) => { deck.push(makeCard(c, form, deck.length)); deck.push(makeCard(c, form, deck.length)); });
  return shuffle(deck);
}
function makeCard(c, form, idx) {
  return { id: 'c' + idx, iso: c.iso, form, region: c.region, signature: c.signature, motif: c.motif,
    motifLabel: c.motifLabel, denom: c.denom, denomSymbol: c.denomSymbol, anchor: c.anchor, state: 'face_down' };
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function validateDeck(cards) {
  const perIso = {};
  for (const c of cards) perIso[c.iso] = (perIso[c.iso] || 0) + 1;
  const ok = cards.length === 16 && Object.values(perIso).every((n) => n === 2);
  return { ok, total: cards.length, perIso };
}

/* ---------------- 镜像：matchLogic ---------------- */
function scoreFor(comboBefore) { return Math.round(100 * (1 + 0.5 * comboBefore)); }
function createMatchState(cards) { return { cards, flipped: [], lock: false, matchedCount: 0, score: 0, combo: 0, sessionUnlocked: [] }; }
function flip(state, cardId) {
  if (state.lock) return state;
  const card = state.cards.find((c) => c.id === cardId);
  if (!card || card.state !== 'face_down') return state;
  const flipped = state.flipped.concat([card]);
  const cards = state.cards.map((c) => (c.id === cardId ? { ...c, state: 'face_up' } : c));
  return { ...state, cards, flipped, lock: flipped.length === 2 };
}
function evaluate(state) {
  if (state.flipped.length < 2) return { state, result: { matched: false, gained: 0, comboBefore: state.combo, comboAfter: state.combo, complete: false } };
  const [a, b] = state.flipped;
  const comboBefore = state.combo;
  if (a.iso === b.iso) {
    const gained = scoreFor(comboBefore);
    const cards = state.cards.map((c) => (c.id === a.id || c.id === b.id ? { ...c, state: 'matched' } : c));
    const next = { ...state, cards, flipped: [], lock: false, matchedCount: state.matchedCount + 1, score: state.score + gained, combo: comboBefore + 1 };
    return { state: next, result: { matched: true, gained, comboBefore, comboAfter: comboBefore + 1, complete: isWin(next) } };
  }
  const next = { ...state, lock: true, combo: 0 };
  return { state: next, result: { matched: false, gained: 0, comboBefore, comboAfter: 0, complete: false } };
}
function flipBack(state) {
  if (state.flipped.length === 0) return state;
  const ids = new Set(state.flipped.map((c) => c.id));
  const cards = state.cards.map((c) => (ids.has(c.id) ? { ...c, state: 'face_down' } : c));
  return { ...state, cards, flipped: [], lock: false };
}
function isWin(state) { const totalPairs = state.cards.length / 2; return totalPairs > 0 && state.matchedCount >= totalPairs; }

/* ---------------- 镜像：collectionStore（内存兜底） ---------------- */
const STORAGE_ENTITIES = 'currency-codex-entities-v1';
const mem = new Map();
class CollectionStore {
  constructor(totalCurrencyCount) { this.totalCount = totalCurrencyCount; }
  _read() { const raw = mem.get(STORAGE_ENTITIES) ?? null; if (raw == null) return []; try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  _write(arr) { mem.set(STORAGE_ENTITIES, JSON.stringify(arr)); }
  unlock(iso, form) { const key = entityKey(iso, form); const arr = this._read(); if (arr.indexOf(key) !== -1) return false; arr.push(key); this._write(arr); return true; }
  isUnlocked(iso, form) { return this._read().indexOf(entityKey(iso, form)) !== -1; }
  progress() { const unlocked = this._read().length; const total = this.totalCount * 2; return { unlocked, total, pct: total === 0 ? 0 : Math.round((unlocked / total) * 100) }; }
  isCollected(iso) { return this.isUnlocked(iso, 'coin') || this.isUnlocked(iso, 'note'); }
  isComplete(iso) { return this.isUnlocked(iso, 'coin') && this.isUnlocked(iso, 'note'); }
}

/* ---------------- 测试数据（已修正签名色/面值/母题） ---------------- */
const CURRENCIES = [
  { iso: 'USD', name: '美元',       region: 'amer',     signature: '#4E7A6B', motif: 'portrait',     motifLabel: '人像圆章',     denom: '100',  denomSymbol: '$',  anchor: 'a' },
  { iso: 'BRL', name: '巴西雷亚尔', region: 'amer',     signature: '#C77B7B', motif: 'animal',      motifLabel: '极简动物剪影', denom: '10',   denomSymbol: 'R$', anchor: 'a' },
  { iso: 'EUR', name: '欧元',       region: 'euro',     signature: '#4A6E8A', motif: 'architecture', motifLabel: '几何桥梁剪影', denom: '20',   denomSymbol: '€',  anchor: 'a' },
  { iso: 'GBP', name: '英镑',       region: 'euro',     signature: '#6A5B8A', motif: 'portrait',     motifLabel: '人像圆章',     denom: '20',   denomSymbol: '£',  anchor: 'a' },
  { iso: 'CNY', name: '人民币',     region: 'asia_afr', signature: '#C75D4F', motif: 'portrait',     motifLabel: '人像圆章',     denom: '100',  denomSymbol: '¥',  anchor: 'a' },
  { iso: 'JPY', name: '日元',       region: 'asia_afr', signature: '#6E97A3', motif: 'landscape',    motifLabel: '富士山三角',   denom: '1000', denomSymbol: '¥',  anchor: 'a' },
  { iso: 'INR', name: '印度卢比',   region: 'asia_afr', signature: '#B08FB5', motif: 'portrait',     motifLabel: '人像圆章',     denom: '100',  denomSymbol: '₹',  anchor: 'a' },
  { iso: 'ZAR', name: '南非兰特',   region: 'asia_afr', signature: '#6E9B7E', motif: 'animal',       motifLabel: '极简动物剪影', denom: '10',   denomSymbol: 'R',   anchor: 'a' },
];

/* ---------------- 断言运行器 ---------------- */
let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name); }
}
function eq(name, a, b) { ok(name + ' (=' + JSON.stringify(b) + ')', a === b); }

console.log('— 1. 发牌去重 (buildDeck) —');
{
  const deck = buildDeck(CURRENCIES, 'coin');
  const v = validateDeck(deck);
  eq('总卡数 = 16', v.total, 16);
  ok('每 ISO 恰好 2 张', v.ok);
  ok('全部 face_down', deck.every((c) => c.state === 'face_down'));
  ok('形态 = coin', deck.every((c) => c.form === 'coin'));
  // 再生成一局 note，数量仍正确
  const deck2 = buildDeck(CURRENCIES, 'note');
  ok('note 局仍 16 且每 ISO 2 张', validateDeck(deck2).ok && deck2.every((c) => c.form === 'note'));
}

console.log('— 2. 配对判定 (flip/evaluate) —');
{
  // 构造确定性牌：4 张（2 对：USD/USD, EUR/EUR），便于断言
  const cards = [
    { id: 'c0', iso: 'USD', form: 'coin', region: 'amer', signature: '#x', motif: 'portrait', motifLabel: 'l', denom: '100', denomSymbol: '$', anchor: 'a', state: 'face_down' },
    { id: 'c1', iso: 'USD', form: 'coin', region: 'amer', signature: '#x', motif: 'portrait', motifLabel: 'l', denom: '100', denomSymbol: '$', anchor: 'a', state: 'face_down' },
    { id: 'c2', iso: 'EUR', form: 'coin', region: 'euro', signature: '#y', motif: 'architecture', motifLabel: 'l', denom: '20', denomSymbol: '€', anchor: 'a', state: 'face_down' },
    { id: 'c3', iso: 'EUR', form: 'coin', region: 'euro', signature: '#y', motif: 'architecture', motifLabel: 'l', denom: '20', denomSymbol: '€', anchor: 'a', state: 'face_down' },
  ];
  // 同 ISO 配对
  let s = createMatchState(cards);
  s = flip(s, 'c0'); eq('翻第1张后未锁', s.lock, false);
  s = flip(s, 'c1'); eq('翻第2张后锁住', s.lock, true);
  const r1 = evaluate(s);
  ok('同 ISO 判定为 matched', r1.result.matched === true);
  eq('首对得分（combo0）= 100', r1.result.gained, 100);
  eq('combo 变 1', r1.result.comboAfter, 1);
  eq('matchedCount = 1', r1.state.matchedCount, 1);
  eq('判定后解锁', r1.state.lock, false);
  ok('两张均 matched 常驻', r1.state.cards.filter((c) => c.state === 'matched').length === 2);

  // 连击：第 2 对（combo_before=1）→ 得分 round(100*(1+0.5))=150
  s = r1.state;
  s = flip(s, 'c2'); s = flip(s, 'c3');
  const r2 = evaluate(s);
  eq('连击第2对得分 = 150', r2.result.gained, 150);
  eq('combo 变 2', r2.result.comboAfter, 2);

  // 错配：构造不同 ISO
  const cards2 = [
    { id: 'c0', iso: 'USD', form: 'coin', region: 'amer', signature: '#x', motif: 'portrait', motifLabel: 'l', denom: '100', denomSymbol: '$', anchor: 'a', state: 'face_down' },
    { id: 'c1', iso: 'EUR', form: 'coin', region: 'euro', signature: '#y', motif: 'architecture', motifLabel: 'l', denom: '20', denomSymbol: '€', anchor: 'a', state: 'face_down' },
  ];
  let s2 = createMatchState(cards2);
  s2 = flip(s2, 'c0'); s2 = flip(s2, 'c1');
  const r3 = evaluate(s2);
  ok('不同 ISO 判定为 mismatch', r3.result.matched === false);
  eq('错配 combo 清零', r3.result.comboAfter, 0);
  eq('错配保持 lock（待翻回）', r3.state.lock, true);
  eq('错配得分 0', r3.state.score, 0);
  // 计时器翻回
  const s3 = flipBack(r3.state);
  eq('翻回后解锁', s3.lock, false);
  ok('翻回后两张 face_down', s3.cards.every((c) => c.state === 'face_down'));

  // 输入锁：lock 时点击被忽略
  let s4 = createMatchState(cards2);
  s4 = flip(s4, 'c0'); s4 = flip(s4, 'c1'); // lock=true
  const before = s4.flipped.length;
  const s5 = flip(s4, 'c0'); // 应被忽略
  eq('锁定时翻牌被忽略', s5.flipped.length, before);
}

console.log('— 3. 胜利判定 (isWin) —');
{
  const cards = Array.from({ length: 4 }, (_, i) => ({ id: 'c' + i, iso: i < 2 ? 'USD' : 'EUR', form: 'coin', region: 'amer', signature: '#x', motif: 'portrait', motifLabel: 'l', denom: '1', denomSymbol: '$', anchor: 'a', state: 'matched' }));
  const s = { ...createMatchState(cards), matchedCount: 2 };
  ok('全部配对 → isWin true', isWin(s) === true);
  ok('未配对完 → isWin false', isWin({ ...s, matchedCount: 1 }) === false);
}

console.log('— 4. 解锁幂等 (CollectionStore) —');
{
  const store = new CollectionStore(CURRENCIES.length); // 8
  eq('初始进度 0/16', store.progress().unlocked, 0);
  ok('首次解锁 USD_coin = true', store.unlock('USD', 'coin') === true);
  ok('重复解锁 USD_coin = false', store.unlock('USD', 'coin') === false);
  ok('同 ISO 不同形态 = 独立实体', store.unlock('USD', 'note') === true);
  ok('重复 note = false', store.unlock('USD', 'note') === false);
  eq('解锁计数 = 2（幂等不重复增）', store.progress().unlocked, 2);
  eq('总实体 = 16', store.progress().total, 16);
  ok('isUnlocked 正确', store.isUnlocked('USD', 'coin') && store.isUnlocked('USD', 'note'));
  ok('isCollected USD = true', store.isCollected('USD') === true);
  ok('isComplete USD = true', store.isComplete('USD') === true);
  ok('isCollected EUR = false（未解锁）', store.isCollected('EUR') === false);
  // 跨实例（模拟重启）从持久层恢复 → 仍幂等
  const store2 = new CollectionStore(CURRENCIES.length);
  ok('重启后 USD_coin 已解锁', store2.isUnlocked('USD', 'coin') === true);
  ok('重启后重复解锁 = false', store2.unlock('USD', 'coin') === false);
}

console.log('\n— 汇总 —');
console.log(`PASS ${passed} / ${passed + failed}` + (failed ? `   FAIL ${failed}` : '   ALL GREEN ✓'));
process.exit(failed ? 1 : 0);
