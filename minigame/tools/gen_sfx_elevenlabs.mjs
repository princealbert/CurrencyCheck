#!/usr/bin/env node
/**
 * gen_sfx_elevenlabs.mjs — 用 ElevenLabs Sound Effects (免费档) 生成 44 个游戏 SFX 并落盘
 *
 * 路径严格对齐 core/audioEvents.ts：
 *   AUDIO_ROOT=assets/audio/，SFX 文件 = sfx/{ui,card,reward,narrative}/{eventId}{suffix}.mp3
 *   变体后缀与注册表逐一对应（随机变体 _01/_02…、语义变体 combo/star 升调、region 区域音色）。
 *
 * 用法：
 *   ELEVENLABS_API_KEY=你的key node gen_sfx_elevenlabs.mjs                 # 全量 44 个
 *   ELEVENLABS_API_KEY=你的key SFX_ONLY=sfx_card_flip,sfx_combo_step node gen_sfx_elevenlabs.mjs
 *                                                                          # 仅重生成指定 eventId
 *
 * 计费（已核算）：音效按秒计费 ~40 积分/秒，免费档 1 万积分/月。
 * 合规：全部抽象材质（木/纸/玻璃/软槌/青铜钟琴/风铃），无金币碰撞、无收银机、无中奖号角、无真实货币采样。
 *
 * ── 2026-08 金属质感重设计 ─────────────────────────────────────────────────
 * 依据 design/audio/sfx-metallic-redesign.md §3，22 个 SFX 改为「温润青铜·展柜微光」：
 *   翻牌(5) / 配对(10) / 通关(7)。其余 21 个 SFX + 3 轨 BGM 保持不变。
 * 这 22 条的 text 按文档 §3 表格逐条显式落在 METALLIC_TEXT（按 id+suffix 精确命中），
 * 不再经 variantModifier() 拼接 —— 避免 ", slightly brighter" 拼到金属描述后语义漂移。
 * ⚠️ sfx_unlock_codex 必须保持木质盖章（§4.2）：它与 sfx_match_success_new 在 t=370ms 重叠，
 *    靠「金属上行 + 木质盖章」的材质对比做频谱分离。切勿顺手一起重生成。
 * ⚠️ 同样不动：sfx_match_miss / sfx_star_pip / ui_* / sfx_view_* / sfx_dialogue_pop / sfx_hub_first_open。
 *
 * 注意：若免费档有硬性的"音效生成次数"上限（传闻 8 个），脚本遇到 402/403 会停止并报错，不会浪费后续调用。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'audio', 'sfx');
const API = 'https://api.elevenlabs.io/v1/sound-generation';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('❌ 需设置环境变量 ELEVENLABS_API_KEY');
  process.exit(1);
}

const GEN_TIMEOUT_MS = 60000;
const BETWEEN_MS = 1500; // 错峰，避免触发免费档 RPM 限制

// 子集过滤：SFX_ONLY=逗号分隔的 eventId 列表。留空/未设置 = 全量生成。
// 用于「只重生成本轮改动的 22 个」，不重花那 21 个不变素材的积分。
const ONLY = new Set(
  (process.env.SFX_ONLY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const isSelected = (id) => ONLY.size === 0 || ONLY.has(id);

// 基 prompt + 时长（秒）+ prompt_influence。全部抽象材质、守合规红线。
// pi 省略时回落到 genOne() 的默认规则（combo/star 0.7，其余 0.6）。
// 🔩 = 本轮金属化（sfx-metallic-redesign.md §3）；⛔ = 明确保持不变（§4）。
const BASE = {
  // ⛔ 容器层（木/纸）—— 全部保持不变
  sfx_ui_tap:            { dir: 'ui', dur: 1.3, text: 'soft wooden button tap, gentle and short, no harsh click' },
  sfx_ui_back:           { dir: 'ui', dur: 1.3, text: 'soft descending wooden tap a step down, gentle retreat sound' },
  sfx_ui_toggle:         { dir: 'ui', dur: 1.2, text: 'soft wooden toggle click, gentle' },
  sfx_ui_locked:         { dir: 'ui', dur: 1.3, text: 'soft muffled wooden thud, dull, non-negative, no buzz' },
  sfx_view_codex_open:   { dir: 'ui', dur: 1.5, text: 'soft paper page turn, gentle book open' },
  sfx_view_detail_open:  { dir: 'ui', dur: 1.1, text: 'single soft paper page lift, short, close' },
  sfx_ui_scroll_tick:    { dir: 'ui', dur: 0.8, text: 'very soft tiny paper tick, whisper quiet' },

  // 🔩 L1 触碰：金属被摸到，几乎无泛音尾（damped）
  sfx_card_flip:         { dir: 'card', dur: 1.0, pi: 0.65, text: 'small bronze collectible token lifted and turned over on felt cloth, soft metallic touch with a faint glockenspiel overtone, very short and damped, no ring out, no sharp attack, warm muted high end' },
  sfx_card_flipback:     { dir: 'card', dur: 1.1, pi: 0.65, text: 'two small metal artifact plates laid back down onto felt, palm muted metallic touch, short gentle falling tone, fully damped, no ring out, no sharp attack' },

  // ⛔ 错配保持木质柔和下行（§4.1：金属=共鸣成立，错配不该响）
  sfx_match_miss:        { dir: 'card', dur: 1.3, text: 'soft descending two-note wooden tone, gentle, no buzz, no harsh' },

  // 🔩 L2 鸣响：金属被敲响，有 shimmer 短尾
  sfx_match_success_repeat:{ dir: 'card', dur: 1.4, pi: 0.6, text: 'two ascending notes on a small metal chime bar struck with a soft mallet, warm bronze overtone, brief gentle shimmer, calm and understated, no fanfare' },
  sfx_combo_step:        { dir: 'card', dur: 1.0, pi: 0.7, text: 'single glockenspiel note struck with a soft mallet, clean metallic shimmer with short decay, no harsh attack' },
  sfx_match_success_new: { dir: 'reward', dur: 1.7, pi: 0.6, text: 'three ascending notes on a small bronze glockenspiel struck with soft mallets, followed by a faint singing bowl shimmer tail, calm museum artifact discovery, warm and understated, no fanfare, no horns' },

  // ⛔ 木质盖章 —— 与上一行的金属上行做材质对比，绝不可金属化（§4.2）
  sfx_unlock_codex:      { dir: 'reward', dur: 1.3, text: 'soft wooden stamp press, gentle paper seal, satisfying' },

  // 🔩 L3 成套：金属共鸣成一片，长尾
  sfx_win_session:       { dir: 'reward', dur: 1.8, pi: 0.6, text: 'warm three note metal chime arpeggio played with soft mallets, then a paper folder closing softly, calm sense of a session completed, gentle and unhurried, no fanfare, no horns, no cheering' },
  sfx_chapter_complete:  { dir: 'reward', dur: 2.0, pi: 0.6, text: 'a single large bronze bell struck with a soft mallet, long warm decay, with a faint metal wind chime settling above it, solemn calm museum hall, no fanfare, no horns, no drums' },
  sfx_region_complete:   { dir: 'reward', dur: 1.8, pi: 0.65, text: 'soft mallet struck metal chime chord, warm bronze timbre, calm sense of a set completed, no fanfare, no horns' },
  sfx_streak_milestone:  { dir: 'reward', dur: 1.5, pi: 0.6, text: 'gentle ascending metal wind chime phrase, a few small bronze tubes touching each other, soft paper rustle underneath, calm and warm, no fanfare' },
  sfx_grade_unlock:      { dir: 'reward', dur: 1.3, pi: 0.6, text: 'a small metal latch on a display cabinet easing open, soft muted metallic movement followed by a faint glass marimba overtone, calm and satisfying, no sharp attack' },

  // ⛔ 本就是铃音，与新人格自洽；v2 观察项（§4.3）
  sfx_star_pip:          { dir: 'reward', dur: 0.8, text: 'tiny bright bell pip' },

  // ⛔ 册册的声音签名 + 容器层
  sfx_dialogue_pop:      { dir: 'narrative', dur: 1.1, text: 'soft rounded pop, breathy, very gentle' },
  sfx_hub_first_open:    { dir: 'narrative', dur: 1.9, text: 'warm gentle wooden opening chord, soft welcoming' },
};

// 变体后缀，与 audioEvents.ts 完全一致
const SUFFIXES = {
  sfx_ui_tap: ['_01', '_02'],
  sfx_ui_back: ['_01'],
  sfx_ui_toggle: ['_01', '_02'],
  sfx_ui_locked: ['_01'],
  sfx_view_codex_open: ['_01', '_02'],
  sfx_view_detail_open: ['_01', '_02'],
  sfx_ui_scroll_tick: ['_01', '_02', '_03'],
  sfx_card_flip: ['_01', '_02', '_03'],
  sfx_card_flipback: ['_01', '_02'],
  sfx_match_miss: ['_01', '_02'],
  sfx_match_success_repeat: ['_01', '_02', '_03'],
  sfx_combo_step: ['_01', '_02', '_03', '_04', '_05'],
  sfx_match_success_new: ['_01', '_02'],
  sfx_unlock_codex: ['_01'],
  sfx_win_session: ['_01'],
  sfx_star_pip: ['_01', '_02', '_03'],
  sfx_chapter_complete: ['_01'],
  sfx_region_complete: ['_amer', '_euro', '_asia_afr'],
  sfx_streak_milestone: ['_01'],
  sfx_grade_unlock: ['_01'],
  sfx_dialogue_pop: ['_01', '_02'],
  sfx_hub_first_open: ['_01'],
};

/**
 * 金属化 22 条的逐变体 prompt（sfx-metallic-redesign.md §3 表格原文照抄）。
 * key = `${eventId}${suffix}`，命中即整条返回，**不经 variantModifier() 拼接**。
 * 合规：全表零硬禁词（coin/cash/register/jackpot/win/money/treasure/prize…），
 *       零地理词（§2.4：区域差异只用音色形容词 + 混响时长承载）。
 *       注意 `wind chime` 含子串 "win"，自检须用 \bwin\b 词边界，勿用 includes('win')。
 */
const METALLIC_TEXT = {
  // ── A. 翻牌（L1 触碰）· 三变体差异只在明暗，不在节奏 ──
  sfx_card_flip_01: 'small bronze collectible token lifted and turned over on felt cloth, soft metallic touch with a faint glockenspiel overtone, very short and damped, no ring out, no sharp attack, warm muted high end',
  sfx_card_flip_02: 'small bronze collectible token lifted and turned over on felt cloth, soft metallic touch with a faint glockenspiel overtone, slightly brighter and a little higher, very short and damped, no ring out, no sharp attack',
  sfx_card_flip_03: 'small bronze collectible token lifted and turned over on felt cloth, soft metallic touch, slightly duller and lower, very short and damped, no ring out, no sharp attack, warm muted high end',
  // 半金属：被按住的金属。下行幅度 ≤ 小三度（铁律 2）
  sfx_card_flipback_01: 'two small metal artifact plates laid back down onto felt, palm muted metallic touch, short gentle falling tone, fully damped, no ring out, no sharp attack',
  sfx_card_flipback_02: 'two small metal artifact plates laid back down onto felt, palm muted metallic touch, slightly softer and lower, short gentle falling tone, fully damped, no ring out',

  // ── B. 配对（L2 鸣响）──
  // combo 五级升调，目标音阶 C5 → D5 → E5 → G5 → A5（大调五声，避半音的紧张感）
  sfx_combo_step_01: 'single glockenspiel note struck with a soft mallet, low pitch, clean metallic shimmer with short decay, step one of a rising five step scale, no harsh attack',
  sfx_combo_step_02: 'single glockenspiel note struck with a soft mallet, mid low pitch, clean metallic shimmer with short decay, step two of a rising five step scale, no harsh attack',
  sfx_combo_step_03: 'single glockenspiel note struck with a soft mallet, middle pitch, clean metallic shimmer with short decay, step three of a rising five step scale, no harsh attack',
  sfx_combo_step_04: 'single glockenspiel note struck with a soft mallet, mid high pitch, clean metallic shimmer with short decay, step four of a rising five step scale, no harsh attack',
  sfx_combo_step_05: 'single glockenspiel note struck with a soft mallet, high pitch, bright but warm metallic shimmer, short decay, step five of a rising five step scale, no harsh attack',
  // P1 情绪最高点，素材须留 ≥6dB 头空（§5.2）
  sfx_match_success_new_01: 'three ascending notes on a small bronze glockenspiel struck with soft mallets, followed by a faint singing bowl shimmer tail, calm museum artifact discovery, warm and understated, no fanfare, no horns',
  sfx_match_success_new_02: 'three ascending notes on a small bronze glockenspiel struck with soft mallets, slightly brighter with a longer metallic shimmer tail, calm artifact discovery, warm and understated, no fanfare, no horns',
  // 必须明显弱于 _new，否则新币解锁失去落差
  sfx_match_success_repeat_01: 'two ascending notes on a small metal chime bar struck with a soft mallet, warm bronze overtone, brief gentle shimmer, calm and understated, no fanfare',
  sfx_match_success_repeat_02: 'two ascending notes on a small metal chime bar struck with a soft mallet, slightly brighter bronze overtone, brief gentle shimmer, calm and understated, no fanfare',
  sfx_match_success_repeat_03: 'two ascending notes on a small metal chime bar struck with a soft mallet, slightly softer and rounder, warm bronze overtone, brief shimmer, calm and understated, no fanfare',

  // ── C. 通关（L3 成套）──
  // 区域差异 = 音色形容词 + 混响时长，prompt 内零地理词（§2.4）
  sfx_region_complete_amer: 'soft mallet struck metal chime chord, warm and bright bronze timbre, short dry room reverb about one second, calm sense of a set completed, no fanfare, no horns',
  sfx_region_complete_euro: 'soft mallet struck metal chime chord, clear refined silvered timbre, larger hall reverb about two seconds, calm sense of a set completed, no fanfare, no horns',
  sfx_region_complete_asia_afr: 'soft mallet struck metal chime chord, airy singing bowl timbre with a low warm body, medium reverb about one and a half seconds, calm sense of a set completed, no fanfare, no horns',
  // 金属琶音 + 纸页收拢，把一局锚回手账语境
  sfx_win_session_01: 'warm three note metal chime arpeggio played with soft mallets, then a paper folder closing softly, calm sense of a session completed, gentle and unhurried, no fanfare, no horns, no cheering',
  // 全作唯一 P0。刻意弃用 temple bell（§2.3 反地域 cosplay），改用抽象 large bronze bell
  sfx_chapter_complete_01: 'a single large bronze bell struck with a soft mallet, long warm decay, with a faint metal wind chime settling above it, solemn calm museum hall, no fanfare, no horns, no drums',
  sfx_streak_milestone_01: 'gentle ascending metal wind chime phrase, a few small bronze tubes touching each other, soft paper rustle underneath, calm and warm, no fanfare',
  // 展柜门闩 —— 把「解锁」直接写进博物馆人格
  sfx_grade_unlock_01: 'a small metal latch on a display cabinet easing open, soft muted metallic movement followed by a faint glass marimba overtone, calm and satisfying, no sharp attack',
};

function semanticPrompt(id, suffix, idx) {
  // 金属化 22 条：按 (id, suffix) 显式命中，整条返回
  const metallic = METALLIC_TEXT[`${id}${suffix}`];
  if (metallic) return metallic;

  // ⛔ 未改动的语义变体：保持原逻辑
  if (id === 'sfx_star_pip') {
    const notes = ['low', 'middle', 'high'];
    return `tiny bright bell pip, ${notes[idx]} pitch, ascending star step ${idx + 1}`;
  }
  return null;
}

function variantModifier(suffix) {
  if (suffix === '_02') return ', slightly brighter';
  if (suffix === '_03') return ', slightly softer';
  return '';
}

// SFX_ONLY 里的 eventId 必须真实存在，否则直接失败 —— 避免拼错后「静默生成 0 个」还以为跑成功了
const unknown = [...ONLY].filter((id) => !SUFFIXES[id]);
if (unknown.length) {
  console.error(`❌ SFX_ONLY 含未知 eventId: ${unknown.join(', ')}`);
  console.error(`   可用 eventId: ${Object.keys(SUFFIXES).join(', ')}`);
  process.exit(1);
}

// 估算总积分（~40/秒），只算本次真正会生成的
let estCredits = 0;
let estFiles = 0;
for (const id of Object.keys(SUFFIXES)) {
  if (!isSelected(id)) continue;
  for (const _s of SUFFIXES[id]) {
    estCredits += BASE[id].dur * 40;
    estFiles++;
  }
}
if (ONLY.size) {
  console.log(`🎯 SFX_ONLY 生效，仅生成 ${ONLY.size} 个 eventId：${[...ONLY].join(', ')}`);
  const skipped = Object.keys(SUFFIXES).filter((id) => !isSelected(id));
  console.log(`   跳过 ${skipped.length} 个 eventId（不重花积分）：${skipped.join(', ')}`);
}
if (estFiles === 0) {
  console.error('❌ 本次没有任何文件会被生成，请检查 SFX_ONLY。');
  process.exit(1);
}
console.log(`计划生成 ${estFiles} 个 SFX，预估 ~${Math.round(estCredits)} 积分（免费档 1万/月）\n`);

let ok = 0;
let failed = 0;
let stopped = false;

async function genOne(id, suffix, idx) {
  const sem = semanticPrompt(id, suffix, idx);
  const prompt = sem ?? BASE[id].text + variantModifier(suffix);
  const dur = BASE[id].dur;
  // 优先用 BASE[id].pi（金属化 22 条按文档 §3 逐条钉死），否则回落原默认规则
  const influence = BASE[id].pi ?? (id === 'sfx_combo_step' || id === 'sfx_star_pip' ? 0.7 : 0.6);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEN_TIMEOUT_MS);
  const res = await fetch(API, {
    method: 'POST',
    signal: ctrl.signal,
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: prompt, duration_seconds: dur, prompt_influence: influence }),
  });
  clearTimeout(timer);

  if (res.status === 200) {
    const buf = Buffer.from(await res.arrayBuffer());
    const out = join(OUT_DIR, BASE[id].dir, `${id}${suffix}.mp3`);
    await mkdir(join(OUT_DIR, BASE[id].dir), { recursive: true });
    await writeFile(out, buf);
    console.log(`✅ ${id}${suffix}.mp3  (${(buf.length / 1024).toFixed(1)}KB)`);
    return true;
  }

  const ct = res.headers.get('content-type') || '';
  const detail = ct.includes('json') ? JSON.stringify(await res.json()).slice(0, 200) : (await res.text()).slice(0, 200);
  if (res.status === 402 || res.status === 403) {
    console.error(`⛔ ${id}${suffix} 被拒 (${res.status}): ${detail} —— 疑似免费档音效次数/额度上限，停止。`);
    return 'stop';
  }
  if (res.status === 429) {
    console.error(`⏳ ${id}${suffix} 限流 (429)，稍后重试`);
    return 'retry';
  }
  console.error(`⚠️ ${id}${suffix} 失败 (${res.status}): ${detail}`);
  return false;
}

for (const id of Object.keys(SUFFIXES)) {
  if (stopped) break;
  if (!isSelected(id)) continue; // SFX_ONLY 子集过滤
  const suffixes = SUFFIXES[id];
  for (let i = 0; i < suffixes.length; i++) {
    if (stopped) break;
    const suffix = suffixes[i];
    let attempt = 0;
    let done = false;
    while (!done && attempt < 3) {
      const r = await genOne(id, suffix, i);
      if (r === 'stop') { stopped = true; break; }
      if (r === 'retry') { attempt++; await new Promise((r) => setTimeout(r, 5000)); continue; }
      if (r === true) { ok++; done = true; }
      else { failed++; done = true; }
    }
    if (!stopped) await new Promise((r) => setTimeout(r, BETWEEN_MS));
  }
}

console.log(`\n完成：成功 ${ok}，失败 ${failed}${stopped ? '（触顶停止）' : ''}。`);
console.log('提示：响应无剩余积分头，请到 ElevenLabs 后台确认本月扣减；SFX 文件已落盘 assets/audio/sfx/，与 audioEvents.ts 对齐。');
