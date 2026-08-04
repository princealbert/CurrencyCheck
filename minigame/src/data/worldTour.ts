/**
 * data/worldTour.ts — 「环游世界」全收集结算伪视频 · 数据表（纯数据，零运行时依赖）
 *
 * 唯一真源，同时被 app 层（预载 / 时间轴推进）与 render 层（合成 / 字幕）消费。
 *
 * 为什么单独开一个 data 文件而不是塞进 render/worldTour.ts：
 *   app.ts 需要「帧数 / slug / 区域」来做 CDN 预载与进度点，render 需要「色 / α / 字幕」。
 *   若表放在 render 层，app → render 会出现值依赖（当前 app 只对 renderer 有值依赖），
 *   与项目 core/data/render/app 的分层口径不符。数据表属 data 层，两侧只读，零环。
 *
 * 对齐文档：
 *   design/narrative/world-tour-reward.md §2.3（时间轴）/ §4.1–4.3（文案）
 *   design/art/world-tour-assets.md §A.3.1（弱网兜底）/ §C.3（命名）/ §D.1（L2 逐帧参数）
 *
 * 合规（world-tour-reward §1.4）：本文件内所有 player-facing 中文一律走
 * 「礼物 / 心意 / 一趟远路 / 周爷爷留下的」词表，禁用「奖励 / 奖品 / 领取 / 稀有 …」。
 */

import { Region } from '../core/types';
import { WORLDTOUR_BASE } from '../config/cdn';

/* ================= 帧表（8 帧，序号即播放顺序） ================= */

export interface TourFrame {
  /** 播放序号（1-based，= 文件名的两位序号段） */
  no: number;
  /** 地标 slug（= 文件名尾段，全小写无分隔） */
  slug: string;
  /** 所属区域：决定弱网兜底渐变取色（§A.3.1） */
  region: Region;
  /** L2 调色叠层色（§D.1，**逐帧不同，不要硬编码 0.12**） */
  tint: string;
  /** L2 调色叠层 α（§D.1，区间 0.09–0.14） */
  tintAlpha: number;
  /** L4 字幕：周爷爷视角文化注脚（§4.3） */
  caption: string;
}

/**
 * 8 帧总表。顺序 = 「自东向西、收在最南的海」的路线线（§4.3 选取原则 ④），
 * **不要按字母序重排**；序号段直接参与文件名拼接。
 */
export const TOUR_FRAMES: readonly TourFrame[] = [
  {
    no: 1,
    slug: 'fuji',
    region: 'asia_afr',
    tint: '#6B8A5F',
    tintAlpha: 0.12,
    caption: '「浪比山更懂海，北斋画了一辈子这两样。」',
  },
  {
    no: 2,
    slug: 'greatwall',
    region: 'asia_afr',
    tint: '#6B8A5F',
    tintAlpha: 0.1,
    caption: '「砖是一块块递上去的，路是一步步走出来的。」',
  },
  {
    no: 3,
    slug: 'kilimanjaro',
    region: 'asia_afr',
    tint: '#6B8A5F',
    tintAlpha: 0.14,
    caption: '「赤道上也会下雪，这座山顶着一顶不化的帽子。」',
  },
  {
    no: 4,
    slug: 'santorini',
    region: 'euro',
    tint: '#47738F',
    tintAlpha: 0.1,
    caption: '「白墙不是为了好看，是为了把毒太阳挡在外面。」',
  },
  {
    no: 5,
    slug: 'landwasser',
    region: 'euro',
    tint: '#47738F',
    tintAlpha: 0.12,
    caption: '「桥把云切成两半，火车从中间穿了过去。」',
  },
  {
    no: 6,
    slug: 'xochimilco',
    region: 'amer',
    tint: '#B8904A',
    tintAlpha: 0.12,
    caption: '「这片田浮在水上，是几百年前的人用手种出来的。」',
  },
  {
    no: 7,
    slug: 'moai',
    region: 'amer',
    tint: '#B8904A',
    tintAlpha: 0.09,
    caption: '「石头几乎都背着海，只有七尊，望着远方。」',
  },
  {
    no: 8,
    slug: 'whale',
    region: 'amer',
    tint: '#B8904A',
    tintAlpha: 0.1,
    caption: '「等了一整天它才浮上来，那一下，海先安静了。」',
  },
];

export const TOUR_FRAME_COUNT = TOUR_FRAMES.length;

/* ================= 资源路径（§C.3 / §C.4） ================= */

/**
 * 帧图前缀（路线 A：资产全 CDN，Phase 7 B1 修复）。
 * 真源在 src/config/cdn.ts：CDN 激活时 = <CDN_BASE>/assets/remote/worldtour/，否则本地
 * assets/remote/worldtour/（web 预览）。尾段（文件名）本地与线上完全一致，CDN 上只需把
 * `assets/` 整目录原样上传到 CDN root（见 CDN_SETUP.md）。
 * ⚠ 该域名须进小程序后台 **downloadFile 合法域名**白名单（§C.4.1 陷阱 2，开发者工具不校验）。
 */
// WORLDTOUR_BASE 已自 '../config/cdn' 导入，不再本地声明（避免硬编码域名）。

/** images Map 的 key（与 preloadScenes 的 'scene_*' 同族命名，避免与母题 PNG key 撞车） */
export function tourFrameKey(i: number): string {
  const f = TOUR_FRAMES[i];
  return f ? 'tour_' + String(f.no).padStart(2, '0') + '_' + f.slug : '';
}

/** 帧图相对路径：worldtour_0N_<slug>.png（§C.3 铁律：两位补零 + 序号即播放顺序） */
export function tourFrameSrc(i: number): string {
  const f = TOUR_FRAMES[i];
  if (!f) return '';
  return WORLDTOUR_BASE + 'worldtour_' + String(f.no).padStart(2, '0') + '_' + f.slug + '.png';
}

/* ================= 弱网兜底渐变（§A.3.1，预算好的合成值） ================= */

/**
 * 「签名色 22% over #1A1614」的**预合成结果**——运行时直接当 stop 用，
 * 不要在运行时叠两层（少一次全屏 fill）。§3.3 坑 3：绝不能转圈等待。
 */
export const TOUR_FALLBACK_INNER: Record<Region, string> = {
  amer: '#3D3120',
  euro: '#242A2F',
  asia_afr: '#2C3024',
};

/** L0 暖黑底 = 兜底渐变外环色（§A.2） */
export const TOUR_BASE_INK = '#1A1614';

/* ================= 时间轴（§2.3，总计 ≈ 32.7s） ================= */

/** 开场：黑场渐亮 + 主文案（重看时跳过，§3.4） */
export const TOUR_INTRO_MS = 2000;
/** 每帧时长（含尾部交叉淡化） */
export const TOUR_FRAME_MS = 3400;
/** 相邻帧交叉淡化时长（落在每帧尾部） */
export const TOUR_XFADE_MS = 700;
/** 收束：渐暗 + 落款 */
export const TOUR_OUTRO_MS = 3500;
/** 字幕相对该帧起点的淡入延迟（§2.3：与图的交叉淡化**错开**，减轻幻灯片感） */
export const TOUR_SUB_IN_DELAY = 400;
/** 字幕相对该帧终点的淡出提前量 */
export const TOUR_SUB_OUT_LEAD = 500;
/** 字幕淡入 / 淡出本身的时长 */
export const TOUR_SUB_FADE_MS = 320;
/** L5 标题「周爷爷的礼物」可见时长（自影片起点计），之后淡出 */
export const TOUR_TITLE_HOLD_MS = 3000;
export const TOUR_TITLE_FADE_MS = 600;
/** Ken Burns 推镜终点缩放（1.00 → 1.06 线性，§2.3） */
export const TOUR_KEN_SCALE = 1.06;

/** 8 帧段总长 */
export const TOUR_FRAMES_MS = TOUR_FRAME_MS * TOUR_FRAME_COUNT;

/** 全片总长；replay 也走满开场 2s（§3.4 方案 A：保留开场黑场，仅隐藏主文案） */
export function tourTotalMs(replay: boolean): number {
  return TOUR_INTRO_MS + TOUR_FRAMES_MS + TOUR_OUTRO_MS;
}

/* ================= 时间轴求值（纯函数，零副作用，可单测） =================
 * 放在 data 层而不是 render 层：app.tick 要用它推进帧序与判定播完，
 * render 要用它决定画什么。两边共用同一份求值，杜绝"两处各算一遍然后算不一样"。
 */

export type TourPhase =
  /** 开场主文案（replay 时不出现） */
  | { kind: 'intro'; p: number }
  /** 名胜帧段；index = 当前帧，fp = 帧内进度 0–1，nextAlpha>0 表示正在交叉淡入下一帧 */
  | { kind: 'frames'; index: number; fp: number; nextAlpha: number }
  /** 收束落款 */
  | { kind: 'outro'; p: number }
  /** 播完（app.tick 据此关闭） */
  | { kind: 'done' };

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 由「已播毫秒」求当前阶段。
 * @param e      已播毫秒（已扣除暂停累计，见 App.tourElapsedMs）
 * @param replay 重看：跳过开场 2s 主文案（§3.4），其余不变
 */
export function tourPhaseAt(e: number, replay: boolean): TourPhase {
  // 开场恒为 2s（replay 也走满）；replay 的主文案由渲染层按 !tourReplay 隐藏（§3.4 方案 A）
  const intro = TOUR_INTRO_MS;
  if (e < intro) return { kind: 'intro', p: clamp01(e / TOUR_INTRO_MS) };

  const fe = e - intro;
  if (fe < TOUR_FRAMES_MS) {
    const index = Math.min(TOUR_FRAME_COUNT - 1, Math.floor(fe / TOUR_FRAME_MS));
    const local = fe - index * TOUR_FRAME_MS;
    const fp = clamp01(local / TOUR_FRAME_MS);
    // 交叉淡化只发生在每帧尾部 TOUR_XFADE_MS 内；最后一帧不再往后交叉（后面是收束段）
    const xStart = TOUR_FRAME_MS - TOUR_XFADE_MS;
    const nextAlpha =
      index < TOUR_FRAME_COUNT - 1 && local > xStart
        ? clamp01((local - xStart) / TOUR_XFADE_MS)
        : 0;
    return { kind: 'frames', index, fp, nextAlpha };
  }

  const oe = fe - TOUR_FRAMES_MS;
  if (oe < TOUR_OUTRO_MS) return { kind: 'outro', p: clamp01(oe / TOUR_OUTRO_MS) };
  return { kind: 'done' };
}

/**
 * 字幕透明度：该帧起 +0.4s 淡入、该帧末 -0.5s 淡出。
 * **刻意不与 L1 的交叉淡化同步** —— 错开能明显减轻幻灯片感（§2.3）。
 */
export function captionAlpha(localMs: number): number {
  const inEnd = TOUR_SUB_IN_DELAY + TOUR_SUB_FADE_MS;
  const outStart = TOUR_FRAME_MS - TOUR_SUB_OUT_LEAD - TOUR_SUB_FADE_MS;
  const outEnd = TOUR_FRAME_MS - TOUR_SUB_OUT_LEAD;
  if (localMs <= TOUR_SUB_IN_DELAY) return 0;
  if (localMs < inEnd) return clamp01((localMs - TOUR_SUB_IN_DELAY) / TOUR_SUB_FADE_MS);
  if (localMs <= outStart) return 1;
  if (localMs < outEnd) return clamp01((outEnd - localMs) / TOUR_SUB_FADE_MS);
  return 0;
}

/* ================= 文案（§4.1 / §4.2，已过 §1.4 禁用词表） ================= */

/** L5 顶部标题（前 3s 显示后淡出） */
export const TOUR_TITLE = '周爷爷的礼物';

/**
 * 开场主文案（§4.1 主选；§8 B-2 建议项）。
 * TODO(待主理人拍板 B-2)：如改用备选 A / B，只改此常量，不动任何逻辑。
 */
export const TOUR_OPENING_LINES: readonly string[] = [
  '把这些钱币都认全的孩子，',
  '该去看看它们来的地方了。',
];

/** 收束落款正文（§4.2） */
export const TOUR_CLOSING_LINE = '「册子合上了，路还长。剩下的，你自己去看。」';

/**
 * 收束署名（§4.2）。
 * ⚠ 合规锚点：「写在册子最后一页」**必须逐字保留** —— 它把周爷爷的话钉死在
 * 「生前预先写下」，杜绝任何显灵解读（§6 第 7 条）。改这行前先过合规。
 */
export const TOUR_CLOSING_SIGN = '—— 周爷爷，写在册子最后一页';

/** L6 跳过按钮文案（§2.4：自第 0 秒起常驻，不做「3 秒后才能跳过」） */
export const TOUR_SKIP_LABEL = '跳过';

/** Hub 重看入口文案（§3.4；全收集达成后常驻） */
export const TOUR_REPLAY_LABEL = '周爷爷的礼物 · 再看一次';
