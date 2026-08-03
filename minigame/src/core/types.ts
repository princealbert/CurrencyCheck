/**
 * types.ts — 纯数据类型定义（无 cc 依赖，可在 Node 单测）
 * 来源：cocos-port-plan.md §2 接口示意 + system-gdd.md §0.5 枚举
 * 合规：仅风格化数据，无真实钞币图。
 */

/** 物理形态轴（第 5 视觉轴，GDD §0.5）：coin=圆牌竖屏 / note=长方牌横屏 */
export type FormFactor = 'coin' | 'note';

/** 区域双编码（GDD §0.5）：amer/euro/asia_afr，绝不国旗 */
export type Region = 'amer' | 'euro' | 'asia_afr';

/** 区域形状（四层识别码 ① 形状层，色弱可辨） */
export type RegionShape = 'rounded_rect' | 'hexagon' | 'diamond';

/** 母题类别（风格化几何，对应真钞中央母题，game token↔真钞迁移锚点） */
export type MotifCategory = 'portrait' | 'architecture' | 'animal' | 'landscape';

/**
 * 币种 glyph（四层识别码 ② 币符层）：每币一个**独立抽象几何轮廓**，互不撞形。
 * 存在意义：区域形状只能分 3 组、签名色在占位美术/色弱下失效、文本需要阅读；
 * glyph 提供「同区域同母题同面额」也能一眼分辨的纯形状通道（如 CNY 十字 vs INR 五瓣花）。
 * 合规：纯抽象几何，不是货币符号字形、不引用任何真实钞币元素。
 */
export type GlyphKind =
  | 'ring'
  | 'triangle'
  | 'arch'
  | 'square'
  | 'plus'
  | 'wave'
  | 'flower'
  | 'pentagon'
  // —— 扩池新币符（每币唯一几何轮廓，纯 path、色弱可用，见 render/glyph.ts）——
  | 'chevron'
  | 'hexagon'
  | 'star'
  | 'disc'
  | 'spiral'
  | 'mountain'
  | 'sun'
  | 'bolt'
  | 'rhombus'
  | 'arrow';

export interface RegionStyle {
  shape: RegionShape;
  /** 区域 accent 色（粉彩信封内），仅作形状描边/边框带，非币种身份 */
  color: string;
}

/** 货币主数据（对齐 mvp/data.js，已应用签名色/面值/母题修正） */
export interface Currency {
  iso: string;          // ISO 4217，唯一身份（红线 2）
  name: string;         // 中文币种名
  region: Region;
  signature: string;    // 母题色（粉彩化真钞主色，锚定色相）
  motif: MotifCategory; // 母题类别
  motifLabel: string;   // 母题中文标签（图鉴现实辨认线索）
  glyph: GlyphKind;     // 币符（四层识别码 ②，每币唯一几何轮廓，色弱主通道）
  denom: string;        // 代表面额数字
  denomSymbol: string;  // 面额符号
  anchor: string;       // 现实锚（GDD §3 / 美术 §2.7）——保持「一行速览」职责，勿并入长文本
  /**
   * 正面母题的文化含义，一句话（Tier1 表层，isCollected 即可见）。
   * 来源：design/content/codex-copy-completion.md §3。纯文本，不引用真实钞币图像。
   */
  frontMotif: string;
  /** 反面母题的文化含义，一句话（Tier1 表层，isCollected 即可见） */
  backMotif: string;
  /**
   * 历史版本差异（Tier2 进阶层）。**门控在 isComplete —— coin + note 双形态齐全才可见**，
   * 给「集齐同一币的硬币与纸币」这个行为一份内容回报（lore-architecture.md §Tier2）。
   * 设为可选是为将来扩池时新币接入不被阻塞。
   */
  historyNote?: string;
  /** 现实锚闪现·首形态解锁文案（母题锚，Phase1 §1.5，≤24 全角字符） */
  flashPrimary: string;
  /** 现实锚闪现·次形态解锁文案（冷知识，Phase1 §1.5，≤24 全角字符） */
  flashSecondary: string;
  /** 配对新发现时册册讲解（Tier1 文化事实，来源 design/narrative/dialogue-nodes.md） */
  discoveryLine: string;
  /** 图鉴页周爷爷纸条（Tier2，来源 design/narrative/dialogue-nodes.md） */
  grandpaNote: string;
}

/** 解锁实体键 = `${iso}_${form}`（GDD §0.5 双形态独立实体） */
export type UnlockKey = string;

/** 单卡运行时状态（GDD §1.③ CardRuntime） */
export type CardState = 'face_down' | 'face_up' | 'matched';

/** 棋盘上的单卡（含渲染与判定所需全部字段，纯数据） */
export interface Card {
  id: string;
  iso: string;
  form: FormFactor;
  region: Region;
  signature: string;
  motif: MotifCategory;
  motifLabel: string;
  /** 币符（四层识别码 ②）；旧数据缺省时渲染层回落到 CURRENCIES 查表 */
  glyph?: GlyphKind;
  denom: string;
  denomSymbol: string;
  anchor: string;
  state: CardState;
}

/** 配对会话运行时状态（GDD §1.③ SessionRuntime，纯数据） */
export interface MatchState {
  cards: Card[];
  flipped: Card[];     // 已翻未判定卡（≤2）
  lock: boolean;       // 输入锁（判定期内屏蔽点击）
  matchedCount: number;
  score: number;
  combo: number;       // 当前连续成功数 = 下次配对前的 combo_before
  sessionUnlocked: UnlockKey[]; // 本局首次解锁实体键
  /** 本局错配次数（Phase1 §2.2 星评唯一输入；只增不减，no-fail） */
  mismatches: number;
}
