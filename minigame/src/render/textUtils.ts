/**
 * render/textUtils.ts — 文本截断工具（引擎 + app.ts 共用）
 *
 * 从 app.ts 提取，避免 core/dialogueEngine 反向依赖 app/。
 * 引擎用 NARRATIVE_LINE_MAX = 40（叙事行比标准 toast 宽松）。
 */

/** 标准 toast 行 2 的单行字数上限（Phase1 §1.4，全角字符） */
export const TOAST_LINE_MAX = 26;

/** 叙事 toast 单行字数上限（§2.6，比标准宽松，fitText 缩字号兜底） */
export const NARRATIVE_LINE_MAX = 40;

/**
 * 按中文句读优雅截断（无合适断点则硬截），末尾统一加省略号。
 *
 * @param s   原始文本
 * @param max 单行字数上限（默认 TOAST_LINE_MAX）
 */
export function clipLine(s: string, max = TOAST_LINE_MAX): string {
  const t = (s || '').trim();
  if (t.length <= max) return t;
  const cut = Math.max(t.lastIndexOf('。', max), t.lastIndexOf('，', max), t.lastIndexOf('；', max));
  return (cut >= max * 0.5 ? t.slice(0, cut) : t.slice(0, max)) + '…';
}
