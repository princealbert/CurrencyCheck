#!/usr/bin/env node
/**
 * gen_bgm_minimax.mjs — 用 MiniMax 免费档 (music-2.6-free) 生成 BGM 纯音乐并落盘
 *
 * 对接 core/audioEvents.ts 的路径约定：
 *   AUDIO_ROOT = assets/audio/，bgm 文件 = bgm/bgm_{hub,match,codex,tour}.mp3
 *
 * 用法：
 *   MINIMAX_API_KEY=你的key node gen_bgm_minimax.mjs                  # 全部曲目
 *   MINIMAX_API_KEY=你的key node gen_bgm_minimax.mjs --only bgm_tour  # 只跑一条
 *   MINIMAX_API_KEY=你的key node gen_bgm_minimax.mjs --only bgm_tour --takes 5
 *   MINIMAX_API_KEY=你的key node gen_bgm_minimax.mjs --only bgm_hub --force  # 逃生口，见下
 *
 * 🔴 成品母带保护（默认开启，不需要记任何参数）
 *   未声明 takes 的曲目（bgm_hub / bgm_match / bgm_codex）= **已交付成品位**，
 *   目标文件已存在时**直接跳过、不发请求**。要重生成必须显式加 --force。
 *
 *   为什么做成硬拦截而不是打个 warning：
 *     1) 本项目**不在 git 下**（整棵目录树无 .git），这三条 mp3 共 11.7MB 是磁盘孤本，无任何版本备份；
 *     2) MiniMax 生成是**非确定性**的——同一条 prompt 重跑得到的是另一首曲子，不是同一首。
 *   两条叠加 ⇒ 覆盖 = 永久损失，且这三条是 clear-sfx-presence-fix.md 整套 SFX 电平地图的基准参照。
 *   warning 拦不住，因为打完就直接进循环了。
 *
 *   声明了 takes 的曲目（bgm_tour）**不受此保护**：挑片本来就要反复重跑覆盖候选。
 *
 * 候选留档：声明了 takes 的曲目输出为 name_takeN.mp3（如 bgm_tour_take1.mp3），
 *   绝不写成 bgm_tour.mp3 —— 后期（bgm-tour-spec.md §6 ffmpeg）是在候选之上做的。
 *   顺带：bgm_tour.mp3 一旦由后期产出，同样落在「无 takes = 成品位」的保护范围内。
 *
 * 合规：全部 is_instrumental:true（纯音乐无人声），prompt 不含金钱/硬币/收银机音色。
 * 注意：生成曲有头尾、非无缝循环；loop:true 直放会有接缝，发版前需用 ffmpeg/编辑器剪干净 loop 点。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'audio', 'bgm');
const API = 'https://api.minimaxi.com/v1/music_generation';

const KEY = process.env.MINIMAX_API_KEY;
if (!KEY) {
  console.error('❌ 需设置环境变量 MINIMAX_API_KEY（platform.minimaxi.com → 账户管理 → 接口密钥，免费档即可）');
  process.exit(1);
}

// 三条 BGM：纯音乐、无歌词、守合规（无金钱/硬币/收银机音色）
const TRACKS = [
  {
    name: 'bgm_hub',
    prompt:
      '温暖探索感环境音乐，像翻开一本旧旅行册，木质与纸质质感，轻快而不失沉稳，纯器乐循环背景',
  },
  {
    name: 'bgm_match',
    prompt:
      '轻度专注且俏皮的配对解谜感背景乐，节奏轻、不吵闹，木琴与软槌质感，纯器乐',
  },
  {
    name: 'bgm_codex',
    prompt:
      '安静空灵的知识陈列馆氛围，留白多，电子 pad 与微铃点缀，纯器乐舒缓循环',
  },
  {
    // 「环游世界」全收集结算伪视频专用曲 —— 规格见 design/audio/bgm-tour-spec.md
    // takes: N → 落盘 bgm_tour_take1..N.mp3。§5.3 明确要求原始输出留档、
    // 不得直接命名 bgm_tour.mp3：后期裁切/响度归一（§6）是在候选之上做的，
    // 覆盖了就没有母带可回退。挑片过 §7 验收清单后再手工产出 bgm_tour.mp3。
    name: 'bgm_tour',
    // 5 而非 spec §5.3 的下限 3：§7 A5（输出中存在可作裁切终点的收束点）是**唯一**
    // 后期无法弥补的验收项 —— 时长不对能裁、响度不对能归一，但曲子里没有终止式，
    // 后期造不出来，只能废片重跑。候选多一倍，A5 命中率高一倍，而免费档成本可忽略。
    // （阮和鸣 2026-08-03 决策；跑单条用 --takes N 覆盖）
    takes: 5,
    // §5.1 主 Prompt（完整版，479 字）—— 由脚本从规格文档程序化抽取，非手抄。
    // 时长「约33秒」写在 prompt 文本里：music_generation 接口按 §5.3 的参数表
    // **没有** duration 字段，不能靠请求参数钉时长（见交付报告的存疑项）。
    prompt:
      "一段约33秒的温柔旅行主题纯音乐，无人声。情绪是温润、怀念、带着文化好奇的启程感，像一位老人把一本旧旅行册轻轻推到你面前，然后退到一边——不是庆典、不是颁奖、不是获胜，没有号角、没有欢呼、没有掌声、没有进行曲。主导乐器：卡林巴拇指琴与八音盒的清澈短句作主旋律，暖调弦乐垫与毛毡钢琴铺底，尼龙弦吉他指腹轻拨给出缓慢的行走脉动，颤音琴与极轻的风铃做点缀。全曲自始至终统一这一套配器，不要为不同段落切换民族乐器，不要世界音乐拼盘，不要任何地域风格串烧。音色温暖，高频柔和不刺耳，起音柔软，无尖锐金属瞬态。结构：开头两秒从近乎无声中缓缓浮起，只有渐强的暖垫与一点木质气息，不要闪亮的金属敲击开场，不要铃声或钟琴起头，不要一上来就响；中段缓缓展开，旋律简洁、留白多、密度低，情绪从启程逐渐开阔，中途有一段极安静的悬停，之后回暖，再逐渐收敛到全曲最安静处；结尾以一个完整的终止式温柔收住，落在主和弦上，尾音自然衰减，不要突然切断。不要打击乐主导，不要鼓组，不要电子节拍，不要强律动，不要渐强爆发，不要电影预告片式的宏大编曲，不要循环感的电子loop。安静、克制、有呼吸。",
    // §5.2 备用 Prompt（精简版，179 字）：仅当 API 判定 prompt 超长时自动降级重试。
    // 精简版砍掉的主要是负面词覆盖度 → 一旦走了这条，挑片必须按 §7 A 组更严格地过。
    promptFallback:
      "约33秒温润旅行主题纯音乐，无人声。卡林巴与八音盒清澈短句为主旋律，暖弦垫与毛毡钢琴铺底，尼龙弦吉他轻拨，风铃极轻点缀，全曲统一配器。开头从近乎无声中缓缓浮起，不要金属敲击开场；中段留白多、逐渐开阔，中途一段安静悬停；结尾以完整终止式温柔收住，尾音自然衰减。温暖怀旧、安静克制。不要庆典号角、不要欢呼、不要鼓组、不要电子节拍、不要民族乐器拼盘、不要渐强爆发。",
  },
];

const GEN_TIMEOUT_MS = 180000; // 音乐生成为重活，服务端需 30–60s
const DL_TIMEOUT_MS = 60000;

/**
 * 输出文件名：声明了 takes 的曲目一律写成 name_takeN，避免覆盖已交付的母带。
 * 未声明 takes 的（hub/match/codex）行为与改动前完全一致 → name.mp3。
 */
function outNameOf(track, takeNo) {
  return track.takes ? `${track.name}_take${takeNo}` : track.name;
}

/**
 * 是否为「prompt 过长 / 参数非法」类错误 —— 只有命中才降级到精简版。
 * 不做无差别重试：网络错误、鉴权失败、限流都应该原样报出来，
 * 用精简版去掩盖它们只会让人以为是文案问题，白排查一轮。
 */
function isPromptRejected(msg = '', code) {
  return code === 2013 || /too\s*long|length|exceed|超长|过长|字符数|invalid\s*param/i.test(msg);
}

async function requestMusic(prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEN_TIMEOUT_MS);
  try {
    const res = await fetch(API, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'music-2.6-free',
        prompt,
        is_instrumental: true,
        audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
        output_format: 'url',
      }),
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 成品母带保护：无 takes 的曲目一旦已存在就跳过。
 * 判据用 !track.takes 而不是「文件是否存在」—— bgm_tour_takeN 挑片时要反复重跑，
 * 不该被拦；只保护「成品位」那几条。返回 true 表示已跳过、未发请求。
 */
function guardExisting(track, outPath, outName) {
  if (track.takes || FORCE || !existsSync(outPath)) return false;
  console.log(`⏭ ${outName}.mp3 已存在，跳过（成品母带保护；确要重生成请显式加 --force）`);
  return true;
}

async function genOne(track, takeNo = 1) {
  const outName = outNameOf(track, takeNo);
  const outPath = join(OUT_DIR, `${outName}.mp3`);
  if (guardExisting(track, outPath, outName)) return null;

  let usedFallback = false;
  let json = await requestMusic(track.prompt);

  // 主 prompt 被判超长 → 降级到 §5.2 精简版重试一次（仅对声明了 promptFallback 的曲目）
  if (json.base_resp?.status_code !== 0) {
    const code = json.base_resp?.status_code;
    const msg = json.base_resp?.status_msg;
    if (track.promptFallback && isPromptRejected(msg, code)) {
      console.warn(`   ↩ ${outName}：主 prompt 被拒 (${code}: ${msg})，改用 §5.2 精简版重试`);
      console.warn('     ⚠ 精简版负面词覆盖度更低 → 该候选挑片须按 spec §7 A 组从严');
      usedFallback = true;
      json = await requestMusic(track.promptFallback);
    }
    if (json.base_resp?.status_code !== 0) {
      throw new Error(`API ${json.base_resp?.status_code}: ${json.base_resp?.status_msg}`);
    }
  }

  const audioField = json.data?.audio;
  if (!audioField) throw new Error('响应中无 audio 字段');

  let buf;
  if (audioField.startsWith('http')) {
    const dctrl = new AbortController();
    const dtimer = setTimeout(() => dctrl.abort(), DL_TIMEOUT_MS);
    const a = await fetch(audioField, { signal: dctrl.signal });
    clearTimeout(dtimer);
    if (!a.ok) throw new Error(`下载失败 ${a.status}`);
    buf = Buffer.from(await a.arrayBuffer());
  } else {
    buf = Buffer.from(audioField, 'hex'); // 兜底：部分返回为 hex
  }

  await writeFile(outPath, buf);
  console.log(
    `✅ ${outName}.mp3  (${(buf.length / 1024).toFixed(0)} KB)` + (usedFallback ? '  [精简 prompt]' : '')
  );
  return outPath;
}

// ── CLI 参数 ────────────────────────────────────────────────
// --only <name[,name]>  只跑指定曲目（不带则全跑）
// --takes <n>           覆盖候选条数（对声明了 takes 的曲目生效）
// --force               解除成品母带保护，允许覆盖已存在的 hub/match/codex（逃生口）
function argOf(flag) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const kv = process.argv.find((a) => a.startsWith(`${flag}=`));
  return kv ? kv.slice(flag.length + 1) : undefined;
}

const FORCE = process.argv.includes('--force');
const onlyArg = argOf('--only');
const takesArg = argOf('--takes');
const takesOverride = takesArg ? Number.parseInt(takesArg, 10) : undefined;
if (takesArg && (!Number.isInteger(takesOverride) || takesOverride < 1)) {
  console.error(`❌ --takes 需为 ≥1 的整数，收到：${takesArg}`);
  process.exit(2);
}

let queue = TRACKS;
if (onlyArg) {
  const want = new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean));
  queue = TRACKS.filter((t) => want.has(t.name));
  const unknown = [...want].filter((n) => !TRACKS.some((t) => t.name === n));
  if (unknown.length) {
    console.error(`❌ 未知曲目：${unknown.join(', ')}`);
    console.error(`   可选：${TRACKS.map((t) => t.name).join(', ')}`);
    process.exit(2);
  }
} else {
  console.warn('⚠ 未指定 --only：将遍历全部曲目（已存在的成品会被保护跳过）。');
  console.warn('  只想出巡礼曲请用：node gen_bgm_minimax.mjs --only bgm_tour');
}

if (FORCE) {
  console.warn('🔴 --force：成品母带保护已解除，已存在的 bgm_hub/bgm_match/bgm_codex.mp3 将被覆盖。');
  console.warn('   项目不在 git 下且生成非确定性 —— 覆盖不可撤销、也重跑不回来。请确认这是你要的。');
}

await mkdir(OUT_DIR, { recursive: true });
for (const t of queue) {
  const takes = takesOverride ?? t.takes ?? 1;
  for (let i = 1; i <= takes; i++) {
    let hitApi = true;
    try {
      hitApi = (await genOne(t, i)) !== null; // null = 被成品保护跳过，没打 API
    } catch (e) {
      console.error(`⚠️ ${outNameOf(t, i)} 失败: ${e.message}`);
    }
    // 免费档 RPM 6 / 并行 3，错峰保险。跳过的那条没发请求，不必陪着等 3 秒。
    if (hitApi) await new Promise((r) => setTimeout(r, 3000));
  }
}
console.log(
  '\n完成。提醒：生成曲有头尾、非无缝循环，AudioManager 设了 loop:true 直放会有接缝；' +
    '发版前用 ffmpeg 或编辑器剪干净 loop 点（或临时改成不循环长曲）。'
);
if (queue.some((t) => t.name === 'bgm_tour')) {
  console.log(
    'bgm_tour：产出的是 *_takeN.mp3 候选，不是成品。按 design/audio/bgm-tour-spec.md ' +
      '§7 挑片、§6 做裁切+响度归一（−20.5 LUFS / ≤−1.5 dBTP / 128kbps）后，' +
      '才手工产出 bgm_tour.mp3。候选请留档，不要删。'
  );
}
