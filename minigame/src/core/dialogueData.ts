/**
 * core/dialogueData.ts — 12 对白节点的文案与逻辑数据（文案与引擎分离）
 *
 * 数据来源：design/narrative/dialogue-nodes.md（已定稿，不改文案）
 * 规格来源：design/narrative/dialogue-engine-spec.md §1 / §2 / §6
 *
 * 设计：
 *  - 每个节点定义为一个 DialogueNodeDef，含 id / priority / frequency / holdMode / resolveLines。
 *  - resolveLines(ctx, deps) 返回 ResolvedLine[] —— 已填入 line1 / region / text。
 *  - 引擎不关心文案内容，只按 frequency / priority / holdMode 调度。
 *
 * 合规：零投资/交易/预测措辞；discoveryLine / grandpaNote 均为文化/历史事实。
 */

import type { Region } from './types';

/* ================= 类型定义（§6.1） ================= */

/** 对白节点 ID（12 个状态触发式节点） */
export type DialogueNodeId =
  | 'S1_HUB_FIRST_OPEN'
  | 'S1_HUB_RETURN'
  | 'MATCH_FIRST_TUTORIAL'
  | 'MATCH_SUCCESS_NEW'
  | 'MATCH_SUCCESS_REPEAT'
  | 'MATCH_MISS'
  | 'MATCH_WIN_SESSION'
  | 'CODEX_OPEN'
  | 'PROFILE_OPEN'
  | 'PASSPORT_TEASER'
  | 'REGION_COMPLETE'
  | 'RATE_SNAPSHOT_NUDGE';

/** 优先级：P0 教学 > P1 解锁 > P2 日常 > P3 错配 */
export type DialoguePriority = 0 | 1 | 2 | 3;

/** hold 模式（决定每行 toast 的 hold 时长） */
export type HoldMode = 'narrative' | 'standard' | 'short';

/** 对白行（单条文本，来自 dialogue-nodes.md） */
export interface DialogueLine {
  speaker: 'CECE' | 'SYSTEM';
  text: string;
  stageDir?: string;
}

/** 触发上下文（§6.1） */
export interface DialogueContext {
  iso?: string;
  region?: Region;
  wasCollected?: boolean;
  consecutiveDays?: number;
  daysSinceLastVisit?: number;
  delay?: number;
}

/** 引擎解析后的单行（含 toast 元数据） */
export interface ResolvedLine {
  text: string;
  line1: string;
  region: Region;
}

/** 节点频率策略 */
export type DialogueFrequency =
  | 'once-lifetime'
  | 'once-per-session'
  | 'once-per-match-session'
  | 'cooldown'
  | 'rotate';

/** 注入依赖（避免 core/ 反向依赖 data/） */
export interface DialogueDeps {
  getCurrency: (iso: string) => {
    name: string;
    iso: string;
    region: Region;
    discoveryLine: string;
    grandpaNote: string;
  } | undefined;
  regionLabel: (region: Region) => string;
}

/* ================= 常量（§2.6） ================= */

export const MATCH_MISS_MAX = 2;
export const MATCH_REPEAT_COOLDOWN = 2;
export const NARRATIVE_HOLD_MS = 3600;
export const NARRATIVE_HOLD_SHORT_MS = 2200;

/* ================= 节点定义 ================= */

export interface DialogueNodeDef {
  id: DialogueNodeId;
  priority: DialoguePriority;
  frequency: DialogueFrequency;
  holdMode: HoldMode;
  /** 默认 region（无 iso 上下文时用） */
  defaultRegion: Region;
  /**
   * 解析文案行。
   * @returns ResolvedLine[] —— 已填入 line1 / region / text；空数组表示不播。
   */
  resolveLines(ctx: DialogueContext, deps: DialogueDeps): ResolvedLine[];
}

/* ---------------- 行 1 标题辅助（§6.6） ---------------- */

const TITLE_CECE = '册册';

function titleDiscovery(deps: DialogueDeps, iso: string): string {
  const cur = deps.getCurrency(iso);
  return `新发现 · ${cur?.name ?? iso} ${iso}`;
}

function titleCodex(iso: string): string {
  return `周爷爷的纸条 · ${iso}`;
}

/* ---------------- 轮转文案池（镜像 dialogue-nodes.md） ---------------- */

/** MATCH_SUCCESS_REPEAT 轮转池（8 条，dialogue-nodes.md 第 76–83 行） */
const REPEAT_TEXTS: readonly string[] = [
  '又是这对——你认得它们了。',
  '老朋友了，是吧？（笑）',
  '这对你翻得越来越快了，记性真好。',
  '（书页轻响）这两张我都快背下来了，你倒比我还准。',
  '同一对，第二回见面。头回是陌生人，这回就是熟人了。',
  '你瞧，纹样一对上，手比脑子还快——这就叫记住了。',
  '周爷爷当年也这样，同一张翻来覆去看，说每回都能看出点新的。',
  '（书页舒展）又碰上了。世界这么大，还是这对先来找你。',
];

/** MATCH_MISS 轮转池（7 条，dialogue-nodes.md 第 94–100 行） */
const MISS_TEXTS: readonly string[] = [
  '（轻轻摇头）不是一对。再看看——它们差在哪儿？',
  '差一点儿。不急，它们又不会跑。',
  '（书页翻了半页又停住）这两张不熟。换一张试试？',
  '颜色像，纹样不一样——你再瞧瞧那个小符号。',
  '没对上也好，多看一眼，就多记一点。',
  '哎哟，这回我也看走眼了。（笑）咱们一块儿再来。',
  '翻错不要紧，周爷爷当年在集市上还认错过钱呢。',
];

/* ================= 12 节点注册表 ================= */

export const DIALOGUE_NODES: Record<DialogueNodeId, DialogueNodeDef> = {

  /* 1. S1_HUB_FIRST_OPEN — 首次开启 Hub（4 行） */
  S1_HUB_FIRST_OPEN: {
    id: 'S1_HUB_FIRST_OPEN',
    priority: 0,
    frequency: 'once-lifetime',
    holdMode: 'narrative',
    defaultRegion: 'amer',
    resolveLines: () => [
      { text: '（书页轻轻翻动）哎哟，终于有人翻开我了。', line1: TITLE_CECE, region: 'amer' },
      { text: '你是周爷爷说的「那个会有缘分的年轻人」吧？', line1: TITLE_CECE, region: 'amer' },
      { text: '这行囊里原先装满了他走遍世界带回的钱币名片。可年头久了，好多都散成了单张——', line1: TITLE_CECE, region: 'amer' },
      { text: '得靠你，一双一双，把它们配回来。', line1: TITLE_CECE, region: 'amer' },
    ],
  },

  /* 2. S1_HUB_RETURN — 日常回访（1 行，sub-state 选取） */
  S1_HUB_RETURN: {
    id: 'S1_HUB_RETURN',
    priority: 2,
    frequency: 'once-per-session',
    holdMode: 'standard',
    defaultRegion: 'amer',
    resolveLines: (ctx) => {
      // sub-state 选取（§2.3）：高优先级先判
      const daysSince = ctx.daysSinceLastVisit ?? 0;
      const streak = ctx.consecutiveDays ?? 1;
      if (daysSince >= 7) {
        return [{ text: '（书页舒展）哟，去远门了？没事，世界又不会跑。', line1: TITLE_CECE, region: 'amer' }];
      }
      if (streak >= 3) {
        return [{ text: '（书页雀跃）连续好几天都来了——周爷爷当年也是这样，走到哪儿都舍不得停。', line1: TITLE_CECE, region: 'amer' }];
      }
      return [{ text: '回来啦。今天也挺好，咱们慢慢来。', line1: TITLE_CECE, region: 'amer' }];
    },
  },

  /* 3. MATCH_FIRST_TUTORIAL — 首次配对教学（3 行） */
  MATCH_FIRST_TUTORIAL: {
    id: 'MATCH_FIRST_TUTORIAL',
    priority: 0,
    frequency: 'once-lifetime',
    holdMode: 'narrative',
    defaultRegion: 'amer',
    resolveLines: () => [
      { text: '来，翻两张看看。要是它们是一对——', line1: TITLE_CECE, region: 'amer' },
      { text: '（翻出一对）看，纹样对上了！这就是「配回来」的意思。', line1: TITLE_CECE, region: 'amer' },
      { text: '不用急，翻错也不要紧，它们又不会跑。', line1: TITLE_CECE, region: 'amer' },
    ],
  },

  /* 4. MATCH_SUCCESS_NEW — 配对成功·新发现（3 行，含 discoveryLine） */
  MATCH_SUCCESS_NEW: {
    id: 'MATCH_SUCCESS_NEW',
    priority: 1,
    frequency: 'once-lifetime',
    holdMode: 'narrative',
    defaultRegion: 'amer',
    resolveLines: (ctx, deps) => {
      const iso = ctx.iso ?? '';
      const cur = deps.getCurrency(iso);
      const name = cur?.name ?? iso;
      const region = cur?.region ?? 'amer';
      const discoveryLine = cur?.discoveryLine ?? '';
      const line1 = `新发现 · ${name} ${iso}`;
      return [
        { text: `好眼力！这两张是一对【${iso} ${name}】。`, line1, region },
        { text: discoveryLine, line1, region },
        { text: '（发现动画）它进册子了——翻到图鉴那页，我给你讲讲背后的故事。', line1, region },
      ];
    },
  },

  /* 5. MATCH_SUCCESS_REPEAT — 配对成功·已见过（1 行，rotate 8 选 1） */
  MATCH_SUCCESS_REPEAT: {
    id: 'MATCH_SUCCESS_REPEAT',
    priority: 2,
    frequency: 'rotate',
    holdMode: 'short',
    defaultRegion: 'amer',
    // 引擎在 rotate 模式下改走 getRepeatCandidates() + rotateIndex 选取；
    // 此处只做兜底，返回池中第 0 条。
    resolveLines: (ctx, deps) => {
      const region = deps.getCurrency(ctx.iso ?? '')?.region ?? 'amer';
      return [{ text: REPEAT_TEXTS[0], line1: TITLE_CECE, region }];
    },
  },

  /* 6. MATCH_MISS — 错配（1 行，rotate 7 选 1；引擎 cooldown 每局≤2 次） */
  MATCH_MISS: {
    id: 'MATCH_MISS',
    priority: 3,
    frequency: 'cooldown',
    holdMode: 'short',
    defaultRegion: 'amer',
    // 同上：引擎按 rotateIndex 从 getMissCandidates() 取一条，此处兜底第 0 条。
    resolveLines: () => [
      { text: MISS_TEXTS[0], line1: TITLE_CECE, region: 'amer' },
    ],
  },

  /* 7. MATCH_WIN_SESSION — 一局配对完成（2 行） */
  MATCH_WIN_SESSION: {
    id: 'MATCH_WIN_SESSION',
    priority: 1,
    frequency: 'once-per-match-session',
    holdMode: 'narrative',
    defaultRegion: 'amer',
    resolveLines: () => [
      { text: '这一架钱币，都归位了。', line1: TITLE_CECE, region: 'amer' },
      { text: '你看，世界是不是比想象的小一点？', line1: TITLE_CECE, region: 'amer' },
    ],
  },

  /* 8. CODEX_OPEN — 翻开图鉴某币种（2 行，含 grandpaNote） */
  CODEX_OPEN: {
    id: 'CODEX_OPEN',
    priority: 2,
    frequency: 'once-lifetime',
    holdMode: 'narrative',
    defaultRegion: 'amer',
    resolveLines: (ctx, deps) => {
      const iso = ctx.iso ?? '';
      const cur = deps.getCurrency(iso);
      const region = cur?.region ?? 'amer';
      const grandpaNote = cur?.grandpaNote ?? '';
      const line1 = titleCodex(iso);
      return [
        { text: `翻开这一页——${iso}。`, line1, region },
        { text: `周爷爷在这儿夹了张纸条：「${grandpaNote}」`, line1, region },
      ];
    },
  },

  /* 9. PROFILE_OPEN — 收藏家档案（1 行） */
  PROFILE_OPEN: {
    id: 'PROFILE_OPEN',
    priority: 2,
    frequency: 'once-lifetime',
    holdMode: 'standard',
    defaultRegion: 'amer',
    resolveLines: () => [
      { text: '你的收藏家档案。周爷爷当年可没这种东西——他全靠脑子里记，记了一辈子。', line1: TITLE_CECE, region: 'amer' },
    ],
  },

  /* 10. PASSPORT_TEASER — 旅行护照 teaser（3 行） */
  PASSPORT_TEASER: {
    id: 'PASSPORT_TEASER',
    priority: 2,
    frequency: 'once-lifetime',
    holdMode: 'narrative',
    defaultRegion: 'amer',
    resolveLines: () => [
      { text: '（翻到册子最后一页，有个空着的小本子图案）周爷爷还留了本「旅行护照」的位子。', line1: TITLE_CECE, region: 'amer' },
      { text: '他说，等这册子填得差不多了，自然就给你开了。', line1: TITLE_CECE, region: 'amer' },
      { text: '现在嘛——先不急，咱们先把眼前这些配对好。', line1: TITLE_CECE, region: 'amer' },
    ],
  },

  /* 11. REGION_COMPLETE — 某区域书架集满（2 行，含 region 名） */
  REGION_COMPLETE: {
    id: 'REGION_COMPLETE',
    priority: 1,
    frequency: 'once-lifetime',
    holdMode: 'narrative',
    defaultRegion: 'amer',
    resolveLines: (ctx, deps) => {
      const region = ctx.region ?? 'amer';
      const label = deps.regionLabel(region);
      return [
        { text: `（书页合拢又展开）这一架——${label}——齐了。`, line1: TITLE_CECE, region },
        { text: '周爷爷要是看见，准得给你泡杯茶。（停顿）对了，有段「旅行见闻」你想瞧瞧吗？', line1: TITLE_CECE, region },
      ];
    },
  },

  /* 12. RATE_SNAPSHOT_NUDGE — 汇率快照提示（1 行，含免责口径） */
  RATE_SNAPSHOT_NUDGE: {
    id: 'RATE_SNAPSHOT_NUDGE',
    priority: 2,
    frequency: 'once-lifetime',
    holdMode: 'standard',
    defaultRegion: 'amer',
    resolveLines: () => [
      { text: '今天的汇率快照，只是随手记的小知识——记得，仅供参考，不是建议。咱们是看故事，不是看盘。', line1: TITLE_CECE, region: 'amer' },
    ],
  },
};

/* ================= 轮转候选行 ================= */

/**
 * MATCH_SUCCESS_REPEAT 的 rotate 候选池（§2.4，8 条）。
 * 引擎在 trigger('MATCH_SUCCESS_REPEAT') 时按 rotateIndex 选取，
 * 然后 rotateIndex = (idx + 1) % candidates.length。
 */
export function getRepeatCandidates(
  deps: DialogueDeps,
  iso: string
): ResolvedLine[] {
  const cur = deps.getCurrency(iso);
  const region = cur?.region ?? 'amer';
  return REPEAT_TEXTS.map((text) => ({ text, line1: TITLE_CECE, region }));
}

/**
 * MATCH_MISS 的 rotate 候选池（7 条）。
 * 错配无币种上下文，统一用 defaultRegion；播放次数仍受 MATCH_MISS_MAX 冷却约束。
 */
export function getMissCandidates(): ResolvedLine[] {
  return MISS_TEXTS.map((text) => ({ text, line1: TITLE_CECE, region: 'amer' as Region }));
}
