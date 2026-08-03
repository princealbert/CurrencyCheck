/**
 * render/types.ts — 渲染层共享类型（无 DOM）
 */

import { FormFactor, Region, MotifCategory, GlyphKind } from '../platform/types';
import { ImageLike } from '../platform/types';
import { Rect } from './layout';

/** 卡面可视数据（配对卡 / 图鉴槽 / 详情均可由它绘制） */
export interface CardVisual {
  iso: string;
  /** 币种中文名（如「巴西雷亚尔」）；币外名称行 / 上下文标题用 */
  name: string;
  region: Region;
  signature: string;
  motif: MotifCategory;
  /**
   * 币符（四层识别码 ②）：每币唯一几何轮廓，卡面角标绘制。
   * 缺省（老调用点）时角标不画，其余通道不受影响 —— 纯增量、不破坏既有调用。
   */
  glyph?: GlyphKind;
  denom: string;
  denomSymbol: string;
  form: FormFactor;
}

export interface CardDrawOpts {
  rect: Rect;
  visual: CardVisual;
  /** true=显示面（四层识别码）；false=显示卡背 */
  faceUp: boolean;
  /** 未解锁（图鉴槽）：灰色剪影 + '?'，不显示真实内容 */
  locked?: boolean;
  /** 翻牌动画水平挤压系数：1=正常，0=侧边（切换正/背） */
  flipScaleX?: number;
  /** 母题 PNG（可选；缺失则画几何占位） */
  image?: ImageLike | null;
  /** 是否在卡片下方（币外）绘制币种名；缺省 false。上下文已有名称时应传 false */
  showName?: boolean;
  /** 名称行高（note 形态由 layout 计算传入；coin 形态内部自算可不传） */
  nameH?: number;
  /**
   * 色弱 / 高对比模式（Phase1 §5.3）。开启后卡面走非颜色通道强化：
   * ISO 字号 ×1.25、区域徽标描边 3px、卡面顶部加区域纹理带。
   */
  colorblind?: boolean;
}

/** 命中目标（渲染时收集，输入时回查） */
export interface HitTarget {
  rect: Rect;
  action: () => void;
}
