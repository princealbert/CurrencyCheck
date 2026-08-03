/**
 * audio-smoke.mjs — 音频系统骨架自测（跑**真实** TS 源码，非镜像实现）
 *
 * 与 src/core/__selftest__.mjs 的镜像手法不同：那里为绕开 Node strip-types 的
 * 扩展名限制做了 1:1 手抄，代价是「测试与实现可能悄悄漂移」。音频层的核心风险
 * 恰恰在运行时行为（降级、引用计数、上限裁剪），手抄一份等于什么都没测。
 * 故这里用工程已有的 esbuild 把真实源码打成临时 ESM 再 import，测的就是上线那份。
 *
 * 覆盖：
 *   A. 零音频文件 / 无后端 → 全链路 no-op 且不抛异常（路径 A 的硬契约）
 *   B. 事件注册表自洽（文件路径唯一、语义变体齐备、优先级合法）
 *   C. 设置持久化（含 setColorblind 不吞音频字段的回归）
 *   D. 节流 / 同发上限 / 实例硬上限
 *   E. ducking 引用计数配对，绝不泄漏
 *   F. E1 抑制规则
 *   G. BGM 场景切换（同轨不重建）
 *
 * 用法：node audio-smoke.mjs
 */

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* ---------------- 断言器 ---------------- */

let passed = 0;
let failed = 0;
const fails = [];

function ok(name, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    fails.push(name);
    console.error('  ✗ ' + name);
  }
}
function eq(name, actual, expected) {
  ok(name + `（实得 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}）`, actual === expected);
}
function noThrow(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    fails.push(name);
    console.error('  ✗ ' + name + ' → 抛出：' + (e && e.stack ? e.stack : e));
  }
}
function section(t) {
  console.log('\n— ' + t + ' —');
}

/* ---------------- 打包真实源码 ---------------- */

const outDir = mkdtempSync(join(tmpdir(), 'audio-smoke-'));
const outFile = join(outDir, 'bundle.mjs');

await build({
  entryPoints: [new URL('./src/core/__audio_entry__.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: ['es2020'],
  outfile: outFile,
  logLevel: 'error',
});

const M = await import(pathToFileURL(outFile).href);
const {
  AudioManager,
  AUDIO_EVENTS,
  MUSIC_SCENES,
  MAX_CONCURRENT_VOICES,
  MAX_AUDIO_INSTANCES,
  E1_SUPPRESS_WINDOW_MS,
  DIALOGUE_DUCK_FACTOR,
  allAudioFiles,
  audioManifestStats,
  MetaStore,
} = M;

/* ---------------- 测试替身 ---------------- */

/** 可观测的假后端：记录每次 create / play，模拟真实句柄生命周期 */
function makeFakeSink(available = true) {
  const created = [];
  const live = new Set();
  const sink = {
    available,
    unlockCalls: 0,
    create(src, opts) {
      const h = {
        src,
        opts,
        playing: false,
        volume: 1,
        loop: !!opts.loop,
        plays: 0,
        destroyed: false,
        play() {
          this.playing = true;
          this.plays++;
        },
        pause() {
          this.playing = false;
        },
        stop() {
          this.playing = false;
        },
        setVolume(v) {
          this.volume = v;
        },
        setLoop(l) {
          this.loop = l;
        },
        destroy() {
          this.destroyed = true;
          this.playing = false;
          live.delete(this);
        },
      };
      created.push(h);
      live.add(h);
      return h;
    },
    unlock() {
      sink.unlockCalls++;
    },
  };
  return { sink, created, live };
}

/** 会抛异常的恶意后端：验证 AudioManager 绝不让异常冒泡 */
const hostileSink = {
  available: true,
  create() {
    throw new Error('backend exploded');
  },
  unlock() {
    throw new Error('unlock exploded');
  },
};

/** 内存 KVStore（喂真实 MetaStore） */
function memKV() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

/** 可控时钟 */
function makeClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/* ================= A. 零文件 / 无后端降级 ================= */

section('A. 零音频文件与后端缺失 → 全链路 no-op（路径 A 硬契约）');

{
  // A1 完全不注入 sink（Node 单测最常见形态）
  const am = new AudioManager();
  noThrow('无 sink：init() 不抛', () => am.init());
  eq('无 sink：active = false', am.active, false);
  noThrow('无 sink：play() 不抛', () => am.play('sfx_card_flip'));
  eq('无 sink：play() 返回 false', am.play('sfx_card_flip'), false);
  noThrow('无 sink：playBgm() 不抛', () => am.playBgm('hub'));
  noThrow('无 sink：duck/unduck 不抛', () => {
    am.duck();
    am.unduck();
  });
  noThrow('无 sink：音量与静音设置不抛', () => {
    am.setMuted(true);
    am.setMusicVolume(0.5);
    am.setSfxVolume(0.5);
    am.setReducedAudioFx(true);
  });
  noThrow('无 sink：tick() 不抛', () => am.tick());
  noThrow('无 sink：dispose() 不抛', () => am.dispose());
  // 设置照常生效（零文件也要能存开关，这是路径 A 的意义）
  eq('无 sink：静音设置仍被记录', am.getSettings().muted, true);
  eq('无 sink：音乐音量仍被记录', am.getSettings().musicVolume, 0.5);
}

{
  // A2 后端存在但 available=false（旧机型 / 无音频权限）
  const { sink } = makeFakeSink(false);
  const am = new AudioManager({ sink });
  am.init();
  eq('available=false：active = false', am.active, false);
  eq('available=false：play() 返回 false', am.play('sfx_ui_tap'), false);
}

{
  // A3 后端每次调用都抛异常 → 必须被吞掉
  const am = new AudioManager({ sink: hostileSink });
  noThrow('恶意后端：init() 不抛', () => am.init());
  noThrow('恶意后端：notifyUserGesture() 不抛', () => am.notifyUserGesture());
  noThrow('恶意后端：play() 不抛', () => am.play('sfx_card_flip'));
  eq('恶意后端：play() 返回 false（create 抛错 → 无池位）', am.play('sfx_card_flip'), false);
  noThrow('恶意后端：playBgm() 不抛', () => am.playBgm('hub'));
}

{
  // A4 文件缺失由后端返回「哑句柄」表达（对齐 loadImage 的 .catch 降级）
  const { sink } = makeFakeSink(true);
  const silent = {
    available: true,
    create: () => ({
      playing: false,
      play() {},
      pause() {},
      stop() {},
      setVolume() {},
      setLoop() {},
      destroy() {},
    }),
    unlock() {},
  };
  const am = new AudioManager({ sink: silent });
  am.init();
  am.notifyUserGesture();
  eq('哑句柄：play() 仍报告已调度', am.play('sfx_card_flip'), true);
  noThrow('哑句柄：连续 200 次 play 不抛、不泄漏', () => {
    for (let i = 0; i < 200; i++) am.play('sfx_ui_tap', { force: true });
  });
  ok('哑句柄：实例数不超硬上限', am.debugState().instances <= MAX_AUDIO_INSTANCES);
  void sink;
}

/* ================= B. 事件注册表自洽 ================= */

section('B. 事件注册表自洽性');

{
  const files = allAudioFiles();
  const stats = audioManifestStats();
  eq('事件总数 = 25', stats.events, 25);
  eq('文件总数 = SFX + BGM', stats.files, stats.sfxFiles + stats.bgmFiles);
  eq('BGM 文件 = 3', stats.bgmFiles, 3);
  ok('文件清单非空', files.length > 0);
  eq('文件清单长度 = stats.files', files.length, stats.files);

  const seen = new Set();
  let dup = null;
  for (const f of files) {
    if (seen.has(f)) dup = f;
    seen.add(f);
  }
  ok('无重复文件路径' + (dup ? `（重复：${dup}）` : ''), dup === null);

  let badPri = null;
  let badPath = null;
  let emptySuffix = null;
  for (const id of Object.keys(AUDIO_EVENTS)) {
    const d = AUDIO_EVENTS[id];
    if (![0, 1, 2, 3].includes(d.priority)) badPri = id;
    if (d.eventId !== id) badPath = id;
    if (!Array.isArray(d.suffixes) || d.suffixes.length === 0) emptySuffix = id;
  }
  ok('所有事件优先级 ∈ P0..P3' + (badPri ? `（越界：${badPri}）` : ''), badPri === null);
  ok('所有事件 eventId 与键一致' + (badPath ? `（不一致：${badPath}）` : ''), badPath === null);
  ok('所有事件至少 1 个变体' + (emptySuffix ? `（空：${emptySuffix}）` : ''), emptySuffix === null);

  // 语义变体必须覆盖三大洲（app.ts 用 region 直接选变体，缺一个就会静默回落）
  const rc = AUDIO_EVENTS['sfx_region_complete'];
  ok('区域完成含 _amer 变体', rc.suffixes.includes('_amer'));
  ok('区域完成含 _euro 变体', rc.suffixes.includes('_euro'));
  ok('区域完成含 _asia_afr 变体', rc.suffixes.includes('_asia_afr'));
  eq('星级评定 3 个变体（逐颗音高递升）', AUDIO_EVENTS['sfx_star_pip'].suffixes.length, 3);

  // BGM 场景表必须与 View 联合一一对应
  ok('MUSIC_SCENES 覆盖 hub/pair/codex/detail',
    ['hub', 'pair', 'codex', 'detail'].every((s) => !!MUSIC_SCENES[s]));
  let badTrack = null;
  for (const s of Object.keys(MUSIC_SCENES)) {
    if (!AUDIO_EVENTS[MUSIC_SCENES[s].track]) badTrack = s;
  }
  ok('场景引用的 BGM 轨都在注册表内' + (badTrack ? `（缺：${badTrack}）` : ''), badTrack === null);
}

/* ================= C. 设置持久化（真实 MetaStore） ================= */

section('C. 设置持久化 · 单键零新增 · 合并式写入');

{
  const kv = memKV();
  const meta = new MetaStore(kv);

  eq('默认未静音', meta.muted, false);
  eq('默认音乐音量 55', meta.musicVolume, 55);
  eq('默认音效音量 85', meta.sfxVolume, 85);
  eq('默认不减少动态音效', meta.reducedAudioFx, false);

  meta.setMuted(true);
  meta.setMusicVolume(30);
  meta.setSfxVolume(70);
  meta.setReducedAudioFx(true);
  meta.setColorblind(true);

  // ★ 回归：setColorblind 曾整体替换缓存，会把音频字段全部吞掉
  eq('setColorblind 后 muted 仍在', meta.muted, true);
  eq('setColorblind 后 musicVolume 仍在', meta.musicVolume, 30);
  eq('setColorblind 后 sfxVolume 仍在', meta.sfxVolume, 70);
  eq('setColorblind 后 reducedAudioFx 仍在', meta.reducedAudioFx, true);

  // 零新增存储键
  const keys = [...kv._map.keys()].filter((k) => k.indexOf('settings') >= 0);
  eq('设置只占 1 个存储键', keys.length, 1);
  eq('存储键名未变', keys[0], 'currency-codex-settings-v1');

  // 重启恢复
  const meta2 = new MetaStore(kv);
  eq('重启后 muted 恢复', meta2.muted, true);
  eq('重启后 musicVolume 恢复', meta2.musicVolume, 30);
  eq('重启后 sfxVolume 恢复', meta2.sfxVolume, 70);
  eq('重启后 reducedAudioFx 恢复', meta2.reducedAudioFx, true);
  eq('重启后 colorblind 恢复', meta2.colorblind, true);

  // 老存档兼容：只有 colorblind 的旧 JSON
  const kvOld = memKV();
  kvOld.setItem('currency-codex-settings-v1', JSON.stringify({ colorblind: 1 }));
  const metaOld = new MetaStore(kvOld);
  eq('老存档：colorblind 读出 true', metaOld.colorblind, true);
  eq('老存档：muted 兜底 false', metaOld.muted, false);
  eq('老存档：musicVolume 兜底 55', metaOld.musicVolume, 55);
  eq('老存档：sfxVolume 兜底 85', metaOld.sfxVolume, 85);

  // 脏值夹紧
  const kvBad = memKV();
  kvBad.setItem('currency-codex-settings-v1', JSON.stringify({ musicVolume: 999, sfxVolume: -50 }));
  const metaBad = new MetaStore(kvBad);
  eq('脏值：超上限夹到 100', metaBad.musicVolume, 100);
  eq('脏值：负值夹到 0', metaBad.sfxVolume, 0);

  // settings() 返回副本，外部改不动内部
  const snap = metaBad.settings();
  snap.muted = true;
  eq('settings() 返回副本，不被外部污染', metaBad.muted, false);
}

{
  // AudioManager ↔ MetaStore 对接：0..1 ↔ 0..100 换算
  const meta = new MetaStore(memKV());
  const { sink } = makeFakeSink();
  const am = new AudioManager({ sink, settings: meta });
  am.init();
  am.setMusicVolume(0.4);
  eq('AudioManager 写入 → MetaStore 存 0..100', meta.musicVolume, 40);
  eq('AudioManager 读出 → 0..1', am.getSettings().musicVolume, 0.4);
  am.setMusicVolume(2); // 越界
  eq('音量入参越界被夹紧', meta.musicVolume, 100);
  eq('toggleMuted 返回新状态', am.toggleMuted(), true);
  eq('toggleMuted 已落到 MetaStore', meta.muted, true);
}

/* ================= D. 节流 / 同发上限 / 实例上限 ================= */

section('D. 节流 · 同发上限 · 实例硬上限');

{
  const clock = makeClock();
  const { sink } = makeFakeSink();
  const am = new AudioManager({ sink, now: clock.now });
  am.init();
  am.notifyUserGesture();

  const throttle = AUDIO_EVENTS['sfx_ui_tap'].throttleMs;
  ok('sfx_ui_tap 有节流窗口', throttle > 0);
  eq('第 1 次点按音起播', am.play('sfx_ui_tap'), true);
  eq('窗口内第 2 次被节流', am.play('sfx_ui_tap'), false);
  clock.advance(throttle + 1);
  eq('窗口外恢复起播', am.play('sfx_ui_tap'), true);
  clock.advance(throttle + 1);
  eq('force=true 绕过节流', am.play('sfx_ui_tap', { force: true }), true);
}

{
  // 同发上限：P3 先丢，P0/P1 抢占
  const clock = makeClock();
  const { sink } = makeFakeSink();
  const am = new AudioManager({ sink, now: clock.now });
  am.init();
  am.notifyUserGesture();

  // 灌满低优先级声部（force 绕过节流，但不绕过并发裁剪）
  const lowPri = [];
  for (const id of Object.keys(AUDIO_EVENTS)) {
    if (AUDIO_EVENTS[id].priority === 3 && AUDIO_EVENTS[id].bus !== 'MUSIC') lowPri.push(id);
  }
  ok('存在 P3 事件用于裁剪验证', lowPri.length > 0);

  let started = 0;
  for (let i = 0; i < 30; i++) {
    if (am.play(lowPri[i % lowPri.length], { force: false })) started++;
    clock.advance(1);
  }
  ok(`同发数不超上限（${am.debugState().voices} ≤ ${MAX_CONCURRENT_VOICES - 1}）`,
    am.debugState().voices <= MAX_CONCURRENT_VOICES - 1);
  ok('部分 P3 被裁剪（未全部起播）', started < 30);

  // P0 仪式音在拥挤状态下必须抢得到位
  eq('P0 章节完成音不被丢弃', am.play('sfx_chapter_complete'), true);
  ok('实例数不超硬上限', am.debugState().instances <= MAX_AUDIO_INSTANCES);
}

{
  // 实例硬上限：把所有事件各播一遍，实例数不得越界
  const clock = makeClock();
  const { sink, created } = makeFakeSink();
  const am = new AudioManager({ sink, now: clock.now });
  am.init();
  am.notifyUserGesture();
  for (const id of Object.keys(AUDIO_EVENTS)) {
    if (AUDIO_EVENTS[id].bus === 'MUSIC') continue;
    am.play(id, { force: true });
    clock.advance(50);
  }
  ok(`全事件遍历后实例 ${am.debugState().instances} ≤ ${MAX_AUDIO_INSTANCES}`,
    am.debugState().instances <= MAX_AUDIO_INSTANCES);
  ok('确有句柄被创建（不是整体空转）', created.length > 0);
  ok('超额句柄已被 destroy 回收',
    created.filter((h) => !h.destroyed).length <= MAX_AUDIO_INSTANCES);
}

{
  // 静音时不产生任何播放
  const { sink, created } = makeFakeSink();
  const meta = new MetaStore(memKV());
  const am = new AudioManager({ sink, settings: meta });
  am.init();
  am.notifyUserGesture();
  am.setMuted(true);
  const before = created.length;
  for (let i = 0; i < 20; i++) am.play('sfx_card_flip', { force: true });
  eq('静音时不创建新实例', created.length, before);
  eq('静音时 play 返回 false', am.play('sfx_match_success_new'), false);
}

{
  // reducedAudioFx：细碎层静默，语义层照常
  const meta = new MetaStore(memKV());
  const { sink } = makeFakeSink();
  const am = new AudioManager({ sink, settings: meta });
  am.init();
  am.notifyUserGesture();
  am.setReducedAudioFx(true);
  eq('减少动态音效：翻牌回落音静默', am.play('sfx_card_flipback'), false);
  eq('减少动态音效：滚动刻度音静默', am.play('sfx_ui_scroll_tick'), false);
  eq('减少动态音效：对白弹出音静默', am.play('sfx_dialogue_pop'), false);
  eq('减少动态音效：新发现音照常', am.play('sfx_match_success_new'), true);
  eq('减少动态音效：通关音照常', am.play('sfx_win_session'), true);
}

/* ================= E. ducking 引用计数 ================= */

section('E. ducking 引用计数配对');

{
  const clock = makeClock();
  const { sink } = makeFakeSink();
  const meta = new MetaStore(memKV());
  const am = new AudioManager({ sink, settings: meta, now: clock.now });
  am.init();
  am.notifyUserGesture();
  am.playBgm('hub');

  const bgm = sink.__lastBgm; // 无需依赖，改用 debugState 判定
  void bgm;

  eq('初始 duckDepth = 0', am.debugState().duckDepth, 0);
  am.duckPush();
  eq('push 后 duckDepth = 1', am.debugState().duckDepth, 1);
  am.duckPush();
  eq('二次 push 后 duckDepth = 2', am.debugState().duckDepth, 2);
  am.duckPop();
  eq('一次 pop 后仍处于压低（depth=1）', am.debugState().duckDepth, 1);
  am.duckPop();
  eq('配平后 duckDepth 归零', am.debugState().duckDepth, 0);

  // 多余 pop 无害，且不会把计数打成负数（负数会让后续 push 永远抬不回来）
  noThrow('多余 duckPop 不抛', () => {
    am.duckPop();
    am.duckPop();
  });
  eq('多余 pop 后 duckDepth 仍为 0（不为负）', am.debugState().duckDepth, 0);

  // resetDuck 硬归零（对应 app.resetTransient 清空 toast 队列的场景）
  am.duckPush();
  am.duckPush();
  am.duckPush();
  am.resetDuck();
  eq('resetDuck 后归零', am.debugState().duckDepth, 0);

  ok('默认 duck 系数取任务书口径 0.35', Math.abs(DIALOGUE_DUCK_FACTOR - 0.35) < 1e-9);
}

{
  // duck 真的压低了 BGM 音量
  const clock = makeClock();
  const { sink, created } = makeFakeSink();
  const meta = new MetaStore(memKV());
  const am = new AudioManager({ sink, settings: meta, now: clock.now });
  am.init();
  am.notifyUserGesture();
  am.playBgm('hub');
  const bgmHandle = created.find((h) => h.loop);
  ok('BGM 句柄已创建且 loop=true', !!bgmHandle);
  const before = bgmHandle.volume;
  am.duckPush();
  am.tick();
  clock.advance(1000);
  am.tick();
  ok(`duck 后 BGM 音量下降（${before.toFixed(3)} → ${bgmHandle.volume.toFixed(3)}）`,
    bgmHandle.volume < before);
  am.duckPop();
  clock.advance(1000);
  am.tick();
  ok(`unduck 后 BGM 音量回升（→ ${bgmHandle.volume.toFixed(3)}）`,
    Math.abs(bgmHandle.volume - before) < 1e-6);
}

/* ================= F. E1 抑制规则 ================= */

section('F. E1 对白弹出音抑制');

{
  const clock = makeClock();
  const { sink } = makeFakeSink();
  const am = new AudioManager({ sink, now: clock.now });
  am.init();
  am.notifyUserGesture();

  clock.advance(10000); // 拉开与初始时刻的距离
  eq('无干扰时对白弹出音正常', am.play('sfx_dialogue_pop'), true);

  // 规则①：400ms 内有非 UI 组音效 → 让位
  clock.advance(5000);
  am.play('sfx_match_success_new'); // SFX_REWARD 组
  clock.advance(E1_SUPPRESS_WINDOW_MS - 50);
  eq('奖励音后 400ms 内：对白弹出音被抑制', am.play('sfx_dialogue_pop'), false);
  clock.advance(100); // 越过窗口
  eq('越过 400ms 窗口后恢复', am.play('sfx_dialogue_pop'), true);

  // 规则②：已有 duck 在身（说明上一条对白还在显示）→ 让位
  clock.advance(5000);
  am.duckPush();
  eq('已有对白在显示时：后续弹出音被抑制', am.play('sfx_dialogue_pop'), false);
  am.duckPop();
  clock.advance(5000);
  eq('对白结束后恢复', am.play('sfx_dialogue_pop'), true);

  // 规则③：由 reducedFxSilent 承担（已在 D 段验证）
  ok('规则③ 由 reducedFxSilent 覆盖', AUDIO_EVENTS['sfx_dialogue_pop'].reducedFxSilent === true);

  // UI 音不应触发让位窗口（否则每次点按都会压掉对白音）
  clock.advance(5000);
  am.play('sfx_ui_tap');
  eq('UI 点按音不触发 E1 让位', am.play('sfx_dialogue_pop'), true);
}

/* ================= G. BGM 场景切换 ================= */

section('G. BGM 场景切换');

{
  const clock = makeClock();
  const { sink, created } = makeFakeSink();
  const am = new AudioManager({ sink, now: clock.now });
  am.init();

  // 未解锁前不得起播（Web 自动播放策略）
  eq('未获用户手势：playBgm 不起播', am.playBgm('hub'), false);
  eq('未获用户手势：未创建句柄', created.length, 0);

  am.notifyUserGesture();
  ok('手势后补播挂起场景', created.length > 0);
  eq('当前场景 = hub', am.currentScene, 'hub');

  const afterHub = created.length;
  eq('重复 playBgm 同场景 → no-op', am.playBgm('hub'), true);
  eq('重复同场景不新建句柄', created.length, afterHub);

  am.playBgm('pair');
  eq('切到 pair 场景', am.currentScene, 'pair');
  ok('换轨新建了句柄', created.length > afterHub);

  // codex → detail 复用同一轨，只改增益，不得重建（否则详情页音乐会从头开始）
  am.playBgm('codex');
  const afterCodex = created.length;
  const codexHandle = created[created.length - 1];
  const volCodex = codexHandle.volume;
  am.playBgm('detail');
  eq('detail 与 codex 同轨 → 不新建句柄', created.length, afterCodex);
  eq('场景已更新为 detail', am.currentScene, 'detail');
  clock.advance(1000);
  am.tick();
  ok(`同轨换场景只调增益（${volCodex.toFixed(3)} → ${codexHandle.volume.toFixed(3)}）`,
    Math.abs(codexHandle.volume - volCodex) > 1e-9);

  // 前后台
  noThrow('切后台不抛', () => am.setAppVisible(false));
  eq('切后台暂停 BGM', codexHandle.playing, false);
  noThrow('回前台不抛', () => am.setAppVisible(true));
  eq('回前台续播 BGM', codexHandle.playing, true);

  am.stopBgm();
  eq('stopBgm 后场景清空', am.currentScene, null);
  noThrow('重复 stopBgm 不抛', () => am.stopBgm());
}

/* ---------------- 收尾 ---------------- */

rmSync(outDir, { recursive: true, force: true });

console.log('\n— 汇总 —');
if (failed) {
  console.log(`AUDIO SMOKE FAIL ✗   PASS ${passed} / ${passed + failed}   FAIL ${failed}`);
  for (const f of fails) console.log('   · ' + f);
  process.exit(1);
}
console.log(`AUDIO SMOKE PASS ✓   ${passed} / ${passed} ALL GREEN`);
process.exit(0);
