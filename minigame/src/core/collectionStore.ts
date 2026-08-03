/**
 * collectionStore.ts — 解锁实体集合 + 幂等 unlock + 持久化（纯逻辑，零 cc 依赖）
 *
 * 移植自 CurrencyCheck/collectionStore.ts，核心算法与 API 表面
 * （unlock / isUnlocked / isCollected / isComplete / progress / loadBest / saveBest）
 * 保持原样；唯一改动：移除 `cc.sys.localStorage` 依赖，改为「构造注入 KVStore」
 * （由 platform 适配层提供 getStorage/setStorage：browser=localStorage，wechat=wx.*），
 * 未注入时退化为内存 Map（保证 Node 单测 / 无后端时安全）。这样同一套 core 既可在浏览器
 * 开发、又能在微信小游戏跑，无需任何 cc 引用。
 *
 * 对齐 GDD §2：解锁实体 = (iso_code, form_factor)；幂等；进度按实体 N/(total*2)。
 */

import { FormFactor, UnlockKey } from './types';
import { entityKey } from './deck';

/** 沿用 MVP 键名，便于迁移 */
const STORAGE_ENTITIES = 'currency-codex-entities-v1';
const STORAGE_BEST = 'currency-codex-best-v1';

/** 极简 KV 接口，屏蔽平台差异（browser=localStorage；wechat=wx.getStorageSync/setStorageSync） */
export interface KVStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

let memoryFallback: Map<string, string> | null = null;

function getMemory(): Map<string, string> {
  if (!memoryFallback) memoryFallback = new Map<string, string>();
  return memoryFallback;
}

export interface Progress {
  unlocked: number;
  total: number;   // totalCurrencyCount * 2
  pct: number;     // 0–100
}

export class CollectionStore {
  private totalCount: number;
  private kv: KVStore | null;

  /** @param totalCurrencyCount 货币主数据总数（完成度分母）
   *  @param kv 可选 KVStore 后端（平台注入）；不传则退化为内存 Map */
  constructor(totalCurrencyCount: number, kv?: KVStore) {
    this.totalCount = totalCurrencyCount;
    this.kv = kv ?? null;
  }

  private readEntities(): UnlockKey[] {
    const raw = this.kv ? this.kv.getItem(STORAGE_ENTITIES) : getMemory().get(STORAGE_ENTITIES) ?? null;
    if (raw == null) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? (arr as UnlockKey[]) : [];
    } catch (e) {
      return [];
    }
  }

  private writeEntities(arr: UnlockKey[]): void {
    const s = JSON.stringify(arr);
    if (this.kv) this.kv.setItem(STORAGE_ENTITIES, s);
    else getMemory().set(STORAGE_ENTITIES, s);
  }

  /** 幂等解锁：首次 true（重复 false）。键 = (iso, form) */
  unlock(iso: string, form: FormFactor): boolean {
    const key = entityKey(iso, form);
    const arr = this.readEntities();
    if (arr.indexOf(key) !== -1) return false; // 重复 → 不增计数
    arr.push(key);
    this.writeEntities(arr);
    return true;
  }

  isUnlocked(iso: string, form: FormFactor): boolean {
    return this.readEntities().indexOf(entityKey(iso, form)) !== -1;
  }

  /** 完成度（按实体口径，GDD §2.③ completion_pct_single） */
  progress(): Progress {
    const unlocked = this.readEntities().length;
    const total = this.totalCount * 2; // 8 币种 × 2 形态
    return {
      unlocked,
      total,
      pct: total === 0 ? 0 : Math.round((unlocked / total) * 100),
    };
  }

  /**
   * 全收集判定（world-tour-reward §0 / §3.2 第 1 项）：18 币种 × 2 形态 = 36 个实体。
   *
   * `unlock()` 已按 `entityKey(iso, form)` 幂等去重，故 `unlocked === total` 足以判定，
   * **无需**遍历 18 个 iso。
   *
   * ⚠ 不要复用 `metaStore` 的 `TOTAL_STARS = 36`（星星总数）做这个判定 —— 那是另一个 36，
   * 任一侧调整都会静默串号（world-tour-reward §0 命名撞车警告）。
   * `total > 0` 是空目录守卫：totalCount=0 时 `0 >= 0` 会误判为「已全收集」。
   */
  isAllComplete(): boolean {
    const p = this.progress();
    return p.total > 0 && p.unlocked >= p.total;
  }

  /** 任一阵列已解锁即「已发现」（图鉴条目可点入 S5） */
  isCollected(iso: string): boolean {
    return this.isUnlocked(iso, 'coin') || this.isUnlocked(iso, 'note');
  }

  /** coin + note 均解锁 = 完整收集 */
  isComplete(iso: string): boolean {
    return this.isUnlocked(iso, 'coin') && this.isUnlocked(iso, 'note');
  }

  /* ---- 最高分（沿用 MVP best 键） ---- */
  loadBest(): number {
    const raw = this.kv ? this.kv.getItem(STORAGE_BEST) : getMemory().get(STORAGE_BEST) ?? null;
    if (raw == null) return 0;
    try {
      const n = JSON.parse(raw);
      return typeof n === 'number' ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  saveBest(score: number): void {
    const s = JSON.stringify(score);
    if (this.kv) this.kv.setItem(STORAGE_BEST, s);
    else getMemory().set(STORAGE_BEST, s);
  }
}
