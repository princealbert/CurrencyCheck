/**
 * core/dialogueEngine.ts — 叙事对白引擎
 *
 * 职责（§6.3）：
 *  - 接收 trigger 调用，评估去重/冷却/轮转/优先级，决定是否播放及播放哪些行。
 *  - 管理内部 pendingLines 缓冲，逐行喂入 toast 队列（不溢出）。
 *  - 管理静默期（暂停 tick 喂入）和优先级打断（P0/P1 打断 P2/P3）。
 *  - 持久化 once-lifetime 状态到 metaStore。
 *
 * 不职责：
 *  - 不直接操作 Canvas / DOM（通过 host 接口间接入队 toast）。
 *  - 不处理 i18n（Phase 2）。
 *  - 不做 telemetry（Phase 2）。
 *  - 不处理 next 指令的导航（Phase 2）。
 *
 * 规格：design/narrative/dialogue-engine-spec.md
 */

import type { Region } from './types';
import type { MetaStore } from './metaStore';
import type { CollectionStore } from './collectionStore';
import type { ToastItem } from '../render/fx';
import { TOAST_HOLD_MS, TOAST_HOLD_SHORT_MS } from '../render/fx';
import {
  DIALOGUE_NODES,
  getRepeatCandidates,
  getMissCandidates,
  MATCH_MISS_MAX,
  MATCH_REPEAT_COOLDOWN,
  NARRATIVE_HOLD_MS,
  NARRATIVE_HOLD_SHORT_MS,
  type DialogueContext,
  type DialogueDeps,
  type DialogueNodeId,
  type DialogueNodeDef,
  type DialoguePriority,
  type HoldMode,
  type ResolvedLine,
} from './dialogueData';

/* ================= 宿主接口（§6.2） ================= */

/**
 * 引擎宿主接口——app.ts 实现此接口，引擎通过它操作 toast 队列。
 * 引擎不直接持有 toast 数组，保持解耦。
 */
export interface DialogueEngineHost {
  /** 入队一条 toast */
  enqueueToast(item: ToastItem): void;
  /** 打断当前正在播的 toast（跳到 exit 段）。仅在优先级打断时由引擎调用。 */
  dismissCurrentToast(): void;
  /** toast 队列是否已满（容量 TOAST_QUEUE_MAX = 3） */
  isToastQueueFull(): boolean;
  /** 当前游戏时钟（ms） */
  gameTimeMs(): number;
}

/* ================= 构造选项（§6.4） ================= */

export interface DialogueEngineOptions {
  host: DialogueEngineHost;
  meta: MetaStore;
  collection: CollectionStore;
  /** 币种查询（注入，避免 core/ 反向依赖 data/） */
  getCurrency: (iso: string) => {
    name: string;
    iso: string;
    region: Region;
    discoveryLine: string;
    grandpaNote: string;
  } | undefined;
  /** 区域显示名（REGION_COMPLETE 文案需要） */
  regionLabel: (region: Region) => string;
}

/* ================= 内部数据结构（§6.5） ================= */

/** 引擎内部叙事行（比 ResolvedLine 多优先级和 hold 模式） */
interface InternalLine {
  text: string;
  line1: string;
  region: Region;
  priority: DialoguePriority;
  holdMode: HoldMode;
}

/** 延迟触发项 */
interface DelayedTrigger {
  nodeId: DialogueNodeId;
  ctx: DialogueContext;
  fireAt: number; // 游戏时钟 ms
}

/* ================= 引擎实现 ================= */

export class DialogueEngine {
  private host: DialogueEngineHost;
  private meta: MetaStore;
  private collection: CollectionStore;
  private deps: DialogueDeps;

  // --- 引擎内部缓冲（§4.5） ---
  private pendingLines: InternalLine[] = [];
  private delayedTriggers: DelayedTrigger[] = [];
  private silenced = false;

  // --- App-session 级状态（§4.3） ---
  private appSessionPlayedNodes: Set<string> = new Set();
  private lastEnqueuedPriority: DialoguePriority | null = null;

  // --- Match-session 级状态（§4.4） ---
  private matchSessionFirstFlipPairFired = false;
  private matchSessionMissCount = 0;
  private matchSessionRepeatSkip = 0;
  private matchSessionPlayedNodes: Set<string> = new Set();

  // --- 引擎级持久状态（跨 match-session 保留） ---
  /* rotateIndex 跨局保留：让扩池台词全部轮到。
   * MATCH_MISS 每局受 cooldown 限制最多播 MATCH_MISS_MAX 次，若每局归零则池中
   * 第 3 条之后永远轮不到；REPEAT 同理。键为 node.id（固定值），跨局连续递增无副作用。 */
  private rotateIndex: Map<string, number> = new Map();

  constructor(opts: DialogueEngineOptions) {
    this.host = opts.host;
    this.meta = opts.meta;
    this.collection = opts.collection;
    this.deps = {
      getCurrency: opts.getCurrency,
      regionLabel: opts.regionLabel,
    };
  }

  /* ---------------- trigger（§6.3 六步流程） ---------------- */

  /**
   * 触发对白节点。
   *
   * 内部流程：
   *  1. 若 ctx.delay > 0 → 存入延迟队列，等 tick() 到时再执行完整流程
   *  2. 检查去重（once-lifetime / once-per-session / once-per-match-session）
   *  3. 检查 cooldown（MATCH_MISS / MATCH_SUCCESS_REPEAT）
   *  4. 选取文案行（固定 / sub-state / rotate）
   *  5. 评估优先级打断（P0/P1 打断 P2/P3 → 清空 + dismiss）
   *  6. 将选中行存入 pendingLines
   *  7. 更新去重/冷却状态
   */
  trigger(nodeId: DialogueNodeId, ctx?: DialogueContext): void {
    const c = ctx ?? {};

    // 步骤 0：延迟处理
    if (c.delay && c.delay > 0) {
      this.delayedTriggers.push({
        nodeId,
        ctx: { ...c, delay: 0 }, // 到时执行时 delay 已消费
        fireAt: this.host.gameTimeMs() + c.delay,
      });
      return;
    }

    const node = DIALOGUE_NODES[nodeId];
    if (!node) return;

    // 步骤 1：去重检查
    if (!this.checkDedup(node, c)) return;

    // 步骤 2：cooldown 检查
    if (!this.checkCooldown(node, c)) return;

    // 步骤 3：选取文案行
    const resolved = this.resolveNodeLines(node, c);
    if (resolved.length === 0) return;

    // 步骤 4：优先级打断
    this.evaluateInterrupt(node.priority);

    // 步骤 5：存入 pendingLines
    const internalLines: InternalLine[] = resolved.map((r) => ({
      text: r.text,
      line1: r.line1,
      region: r.region,
      priority: node.priority,
      holdMode: node.holdMode,
    }));
    this.pendingLines.push(...internalLines);

    // 步骤 6：更新去重/冷却状态
    this.updateDedupAndCooldown(node, c);
  }

  /* ---------------- tick（每帧调用） ---------------- */

  /**
   * 每帧调用（由 app.ts 的 tick() 调用）。
   *
   * 1. 处理延迟触发（delay 到期的 trigger 开始评估）
   * 2. 若非静默期且 toast 队列未满且 pendingLines 非空：
   *    取 pendingLines 首行 → 转 ToastItem → host.enqueueToast()
   * 3. 更新 lastEnqueuedPriority
   */
  tick(): void {
    const now = this.host.gameTimeMs();

    // ① 处理延迟触发
    if (this.delayedTriggers.length > 0) {
      for (let i = this.delayedTriggers.length - 1; i >= 0; i--) {
        const dt = this.delayedTriggers[i];
        if (now >= dt.fireAt) {
          this.delayedTriggers.splice(i, 1);
          this.trigger(dt.nodeId, dt.ctx);
        }
      }
    }

    // ② 喂入 pendingLines（静默期暂停）
    if (!this.silenced && this.pendingLines.length > 0 && !this.host.isToastQueueFull()) {
      const line = this.pendingLines.shift()!;
      const isLast = this.pendingLines.length === 0;
      const hold = this.calculateHold(line.holdMode, isLast);
      /* 完整文本入队、**不截断**：换行交给 drawToast 的 wrapText（按实际像素宽断行，
       * 横幅高度自适应）。此前 clipLine(…, NARRATIVE_LINE_MAX=40) 会把 discoveryLine
       * 这类 50–70 字的叙事行砍成「…」，是玩家反馈"对白被吞"的直接原因。 */
      const toast: ToastItem = {
        line1: line.line1,
        line2: '',
        lines: [line.text],
        region: line.region,
        hold,
        startAt: -1,
      };
      this.host.enqueueToast(toast);
      this.lastEnqueuedPriority = line.priority;
    }
  }

  /* ---------------- resetMatchSession ---------------- */

  /**
   * Match-session 重置。
   * 清空 match-session 级状态（missCount、repeatSkip、firstFlipPairFired、playedNodes）。
   * 注意：**不清 rotateIndex** —— rotateIndex 跨局保留：让扩池台词全部轮到
   * （MISS 7 条 / REPEAT 8 条，每局仍受 cooldown 限次，靠多局连续轮转覆盖全池）。
   */
  resetMatchSession(): void {
    this.matchSessionFirstFlipPairFired = false;
    this.matchSessionMissCount = 0;
    this.matchSessionRepeatSkip = 0;
    this.matchSessionPlayedNodes.clear();
  }

  /* ---------------- setSilenced ---------------- */

  /**
   * 设置静默期。
   * Phase 1 简化：静默期仅暂停 tick() 喂入，不缓存 deferred triggers。
   * 触发仍正常写入 pendingLines，等静默结束后逐行播放。
   */
  setSilenced(silenced: boolean): void {
    this.silenced = silenced;
  }

  /* ---------------- hasPending ---------------- */

  /**
   * 是否有待播叙事行（pendingLines 非空 或 有延迟触发待处理）。
   * 供 app.ts 判断是否需要持续重绘。
   */
  hasPending(): boolean {
    return this.pendingLines.length > 0 || this.delayedTriggers.length > 0;
  }

  /* ---------------- hasPlayed ---------------- */

  /**
   * 查询某 once-lifetime 节点是否已播过（主要用于测试验证）。
   */
  hasPlayed(nodeId: DialogueNodeId, iso?: string, region?: Region): boolean {
    switch (nodeId) {
      case 'S1_HUB_FIRST_OPEN':
        return this.meta.hasSeenDialogue('S1_HUB_FIRST_OPEN');
      case 'MATCH_FIRST_TUTORIAL':
        return this.meta.hasSeenFirstTutorial();
      case 'MATCH_SUCCESS_NEW':
        // 去重由 CollectionStore.isCollected 隐式保证
        return iso ? this.collection.isCollected(iso) : false;
      case 'CODEX_OPEN':
        return this.meta.hasSeenDialogue(`CODEX_OPEN:${iso ?? ''}`);
      case 'PROFILE_OPEN':
        return this.meta.hasSeenDialogue('PROFILE_OPEN');
      case 'PASSPORT_TEASER':
        return this.meta.hasSeenDialogue('PASSPORT_TEASER');
      case 'REGION_COMPLETE':
        return this.meta.hasSeenDialogue(`REGION_COMPLETE:${region ?? ''}`);
      case 'RATE_SNAPSHOT_NUDGE':
        return this.meta.hasSeenDialogue('RATE_SNAPSHOT_NUDGE');
      default:
        return false;
    }
  }

  /* ================= 内部方法 ================= */

  /* ----- 步骤 1：去重检查 ----- */

  private checkDedup(node: DialogueNodeDef, ctx: DialogueContext): boolean {
    const freq = node.frequency;

    switch (freq) {
      case 'once-lifetime': {
        // 特殊处理：MATCH_SUCCESS_NEW 由 isCollected 隐式去重
        if (node.id === 'MATCH_SUCCESS_NEW') {
          // wasCollected === true → 不应播 NEW（应由 app.ts 路由到 REPEAT）
          if (ctx.wasCollected) return false;
          // iso 已收集 → 不播（安全兜底）
          if (ctx.iso && this.collection.isCollected(ctx.iso)) return false;
          return true;
        }
        // MATCH_FIRST_TUTORIAL 用独立持久化键 + match-session 防重
        if (node.id === 'MATCH_FIRST_TUTORIAL') {
          if (this.matchSessionFirstFlipPairFired) return false;
          return !this.meta.hasSeenFirstTutorial();
        }
        // 其他 once-lifetime 节点用 seenDialogueNodes
        const key = this.dedupKey(node.id, ctx);
        return !this.meta.hasSeenDialogue(key);
      }

      case 'once-per-session': {
        const key = node.id;
        if (this.appSessionPlayedNodes.has(key)) return false;
        return true;
      }

      case 'once-per-match-session': {
        const key = node.id;
        if (this.matchSessionPlayedNodes.has(key)) return false;
        return true;
      }

      case 'cooldown':
      case 'rotate':
        // cooldown / rotate 的去重在 checkCooldown 中处理
        return true;

      default:
        return true;
    }
  }

  /* ----- 步骤 2：cooldown 检查 ----- */

  private checkCooldown(node: DialogueNodeDef, ctx: DialogueContext): boolean {
    switch (node.id) {
      case 'MATCH_MISS': {
        if (this.matchSessionMissCount >= MATCH_MISS_MAX) return false;
        return true;
      }

      case 'MATCH_SUCCESS_REPEAT': {
        // wasCollected === false → 不应播 REPEAT
        if (ctx.wasCollected === false) return false;
        if (this.matchSessionRepeatSkip > 0) {
          this.matchSessionRepeatSkip--;
          return false;
        }
        return true;
      }

      default:
        return true;
    }
  }

  /* ----- 步骤 3：选取文案行 ----- */

  private resolveNodeLines(node: DialogueNodeDef, ctx: DialogueContext): ResolvedLine[] {
    // rotate 模式特殊处理（MATCH_SUCCESS_REPEAT / MATCH_MISS 共用 rotateIndex）
    const candidates =
      node.id === 'MATCH_SUCCESS_REPEAT'
        ? getRepeatCandidates(this.deps, ctx.iso ?? '')
        : node.id === 'MATCH_MISS'
          ? getMissCandidates()
          : null;
    if (candidates) {
      if (candidates.length === 0) return [];
      const idx = (this.rotateIndex.get(node.id) ?? 0) % candidates.length;
      return [candidates[idx]];
    }
    return node.resolveLines(ctx, this.deps);
  }

  /* ----- 步骤 4：优先级打断（§3.2） ----- */

  private evaluateInterrupt(newPriority: DialoguePriority): void {
    // 检查 pendingLines 中是否有比新触发更低优先级的行（priority 值更大 = 更低）
    // P0=0, P1=1, P2=2, P3=3
    // 新触发 P0/P1 且 pendingLines 中有 P2/P3 → 清空 + dismiss
    if (newPriority <= 1 && this.pendingLines.length > 0) {
      const hasLowerPriority = this.pendingLines.some((l) => l.priority > newPriority);
      if (hasLowerPriority) {
        // ① 清空 pendingLines 中比新触发优先级低的行
        this.pendingLines = this.pendingLines.filter((l) => l.priority <= newPriority);
        // ② dismiss 当前 toast（若最近入队的是更低优先级）
        if (this.lastEnqueuedPriority !== null && this.lastEnqueuedPriority > newPriority) {
          this.host.dismissCurrentToast();
        }
      }
    }
  }

  /* ----- 步骤 6：更新去重/冷却状态 ----- */

  private updateDedupAndCooldown(node: DialogueNodeDef, ctx: DialogueContext): void {
    switch (node.frequency) {
      case 'once-lifetime': {
        if (node.id === 'MATCH_FIRST_TUTORIAL') {
          this.matchSessionFirstFlipPairFired = true;
          this.meta.markSeenFirstTutorial();
        } else if (node.id !== 'MATCH_SUCCESS_NEW') {
          // MATCH_SUCCESS_NEW 不写入 seenDialogueNodes（由 isCollected 隐式去重）
          const key = this.dedupKey(node.id, ctx);
          this.meta.markDialogueSeen(key);
        }
        // S1_HUB_FIRST_OPEN 播完后 markLaunchedBefore 由 app.ts 处理（构造函数中）
        break;
      }

      case 'once-per-session': {
        this.appSessionPlayedNodes.add(node.id);
        break;
      }

      case 'once-per-match-session': {
        this.matchSessionPlayedNodes.add(node.id);
        break;
      }

      case 'cooldown': {
        if (node.id === 'MATCH_MISS') {
          this.matchSessionMissCount++;
          this.rotateIndex.set(node.id, (this.rotateIndex.get(node.id) ?? 0) + 1);
        }
        break;
      }

      case 'rotate': {
        if (node.id === 'MATCH_SUCCESS_REPEAT') {
          const cur = this.rotateIndex.get(node.id) ?? 0;
          this.rotateIndex.set(node.id, cur + 1);
          this.matchSessionRepeatSkip = MATCH_REPEAT_COOLDOWN;
        }
        break;
      }
    }
  }

  /* ----- hold 时长计算（§3.1） ----- */

  private calculateHold(holdMode: HoldMode, isLast: boolean): number {
    switch (holdMode) {
      case 'narrative':
        return isLast ? NARRATIVE_HOLD_MS : NARRATIVE_HOLD_SHORT_MS;
      case 'standard':
        return TOAST_HOLD_MS;
      case 'short':
        return TOAST_HOLD_SHORT_MS;
    }
  }

  /* ----- 去重键生成（§2.2） ----- */

  private dedupKey(nodeId: DialogueNodeId, ctx: DialogueContext): string {
    switch (nodeId) {
      case 'CODEX_OPEN':
        return `CODEX_OPEN:${ctx.iso ?? ''}`;
      case 'REGION_COMPLETE':
        return `REGION_COMPLETE:${ctx.region ?? ''}`;
      default:
        return nodeId;
    }
  }
}
