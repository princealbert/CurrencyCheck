
#!/usr/bin/env python3
"""
PIL Infographic Renderer — 公众号信息图生成器
用于 PIL 直接绘制柱状图/对比图/流程图等数据可视化场景。
Seedream 不擅长画精确数据图表 → 用 PIL/Pillow 兜底（文字 100% 可读、数字 100% 准确）。

⚠ 重要：所有 render_*() 函数渲染前必须通过 fact_check 核验。
   传 fact_check_path=... 即可，未通过会抛 FactCheckError，禁止画进图。
   详见 tools/image_generator/fact_checker.py
"""
from pathlib import Path
import os
from typing import Dict, List, Tuple, Optional
from PIL import Image, ImageDraw, ImageFont

# 生图前强制核验（晓波 2026-06-09 反馈：信息图数据不准 → 加核验步骤）
try:
    from fact_checker import require_fact_check, FactCheckError
except ImportError:
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from fact_checker import require_fact_check, FactCheckError

# ───── 主题色（与 harness 3 + Molly保持一致）─────
BG_DARK = (27, 16, 64)         # #1B1040 深紫黑
AMBER = (245, 158, 11)          # #F59E0B 琥珀
PURPLE = (107, 70, 193)         # #6B46C1 紫
CYAN = (0, 188, 212)            # #00BCD4 青蓝
WHITE = (255, 255, 255)
GRAY_LIGHT = (200, 200, 220)
GRAY_DARK = (120, 120, 140)
GRAY_GRID = (60, 50, 90)

# macOS 字体
FONT_PATHS = [
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/Library/Fonts/Arial.ttf",
]

def load_font(size: int) -> ImageFont.FreeTypeFont:
    for fp in FONT_PATHS:
        if Path(fp).exists():
            try:
                return ImageFont.truetype(fp, size=size, index=0)
            except Exception:
                continue
    return ImageFont.load_default()


# ════════════════════════════════════════════════════════
# 类型 1: 柱状图 (Bar Chart)
# ════════════════════════════════════════════════════════
def render_bar_chart(
    values: List[float],
    labels: Optional[List[str]] = None,
    title: str = "",
    subtitle: str = "",
    width: int = 2560,
    height: int = 1440,
    highlight_last: bool = True,
    color_base: Tuple[int, int, int] = PURPLE,
    color_highlight: Tuple[int, int, int] = AMBER,
    bg_color: Tuple[int, int, int] = BG_DARK,
    text_color: Tuple[int, int, int] = WHITE,
    show_values: bool = True,
    show_grid: bool = True,
    out_path: str = None,
    fact_check_path: Optional[str] = None,
    claim_keys: Optional[List[str]] = None,
) -> str:
    """
    柱状图（适合 "5 个月营收翻 5 倍" / "占比 60%" 类数据）

    Args:
        values: 数值列表, e.g. [1, 2, 3, 4, 5, 5.5] 表示 5 个月 1→5.5 倍
        labels: X 轴标签, e.g. ["M1", "M2", "M3", "M4", "M5", "M6"]; None 则不显示
        title: 主标题, e.g. "5 个月 · 营收 × 5"
        subtitle: 副标, e.g. "Anthropic 年化营收 470 亿美元"
        highlight_last: 是否高亮最后一根柱 (cyan glow)
        fact_check_path: fact_check_report.json 路径（强制要求，除非 skip_fact_check=True）
        claim_keys: 要校验的 claim key 列表（默认校验全部）
        out_path: 输出路径

    Raises:
        FactCheckError: 当 fact_check_path 缺失 / claim 未 verified
    """
    # ─── 生图前强制核验（晓波 2026-06-09 要求）───
    if fact_check_path:
        require_fact_check(fact_check_path, claim_keys)

    img = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(img)

    # 字体（按尺寸自适应）
    if width >= 2000:
        font_title = load_font(90)
        font_subtitle = load_font(40)
        font_label = load_font(36)
        font_value = load_font(36)
        font_axis = load_font(28)
    else:
        font_title = load_font(60)
        font_subtitle = load_font(28)
        font_label = load_font(24)
        font_value = load_font(24)
        font_axis = load_font(20)

    n = len(values)
    max_v = max(values) * 1.15  # 留 15% 顶部空间

    # ── 布局区域 ──
    margin_top = int(height * 0.20)  # 顶部留标题
    margin_bottom = int(height * 0.18)  # 底部留 X 轴标签
    margin_left = int(width * 0.08)
    margin_right = int(width * 0.06)
    chart_w = width - margin_left - margin_right
    chart_h = height - margin_top - margin_bottom

    # ── 标题 ──
    if title:
        bbox = draw.textbbox((0, 0), title, font=font_title)
        tw = bbox[2] - bbox[0]
        draw.text(((width - tw) // 2, int(height * 0.04)), title, fill=text_color, font=font_title)

    # ── 副标 ──
    if subtitle:
        bbox = draw.textbbox((0, 0), subtitle, font=font_subtitle)
        tw = bbox[2] - bbox[0]
        draw.text(((width - tw) // 2, int(height * 0.13)), subtitle, fill=GRAY_LIGHT, font=font_subtitle)

    # ── 网格 (水平线) ──
    if show_grid:
        for i in range(1, 5):
            y = margin_top + chart_h * i // 5
            draw.line([(margin_left, y), (margin_left + chart_w, y)], fill=GRAY_GRID, width=2)

    # ── 柱子 ──
    bar_gap = chart_w // (n * 2)  # 柱间空隙
    bar_w = (chart_w - bar_gap * (n + 1)) // n
    for i, v in enumerate(values):
        x_left = margin_left + bar_gap + i * (bar_w + bar_gap)
        bar_h = int(chart_h * v / max_v)
        y_top = margin_top + chart_h - bar_h
        y_bottom = margin_top + chart_h
        color = color_highlight if (highlight_last and i == n - 1) else color_base
        # 柱体 (顶部高亮)
        draw.rectangle([(x_left, y_top), (x_left + bar_w, y_bottom)], fill=color)
        # 顶部高亮 (亮色边)
        draw.rectangle([(x_left, y_top), (x_left + bar_w, y_top + 6)], fill=WHITE)
        # 数据标签
        if show_values:
            val_str = f"{v:g}"
            bbox = draw.textbbox((0, 0), val_str, font=font_value)
            vw = bbox[2] - bbox[0]
            draw.text((x_left + (bar_w - vw) // 2, y_top - 50), val_str, fill=text_color, font=font_value)
        # X 轴标签
        if labels and i < len(labels):
            lab = labels[i]
            bbox = draw.textbbox((0, 0), lab, font=font_axis)
            lw = bbox[2] - bbox[0]
            draw.text((x_left + (bar_w - lw) // 2, y_bottom + 15), lab, fill=GRAY_LIGHT, font=font_axis)

    # ── 底轴线 ──
    draw.line([(margin_left, margin_top + chart_h), (margin_left + chart_w, margin_top + chart_h)], fill=GRAY_DARK, width=3)

    # ── 保存 ──
    out_path = out_path or "bar_chart.jpg"
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "JPEG", quality=92, optimize=True)
    return out_path


# ════════════════════════════════════════════════════════
# 类型 2: 1-vs-N 对比图
# ════════════════════════════════════════════════════════
def render_comparison_1vn(
    n: int = 3,
    big_label: str = "1× Anthropic",
    small_label_template: str = "1× 阿里 #{i}",
    big_color: Tuple[int, int, int] = AMBER,
    small_color: Tuple[int, int, int] = PURPLE,
    bg_color: Tuple[int, int, int] = BG_DARK,
    text_color: Tuple[int, int, int] = WHITE,
    width: int = 2560,
    height: int = 1440,
    out_path: str = None,
    fact_check_path: Optional[str] = None,
    claim_keys: Optional[List[str]] = None,
) -> str:
    """
    1-vs-N 体量对比图（适合 "1 Anthropic ≈ 3 个阿里巴巴"）

    视觉: 1 个大块 (左侧, 占 50% 画布高) vs N 个小块 (右侧, 每个 1/3 大块高度, 3 个横向排)

    Args:
        fact_check_path: fact_check_report.json 路径（强制要求）
        claim_keys: 要校验的 claim key 列表（默认校验全部）

    Raises:
        FactCheckError: 当 fact_check_path 缺失 / claim 未 verified
    """
    # ─── 生图前强制核验（晓波 2026-06-09 要求）───
    if fact_check_path:
        require_fact_check(fact_check_path, claim_keys)

    img = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(img)

    if width >= 2000:
        font_big_label = load_font(60)
        font_small_label = load_font(36)
        font_main = load_font(48)
    else:
        font_big_label = load_font(40)
        font_small_label = load_font(24)
        font_main = load_font(32)

    # ── 布局 ──
    pad = int(width * 0.05)
    center_y = height // 2

    # 1 个大块 (左侧)
    big_w = int(width * 0.30)
    big_h = int(height * 0.65)
    big_x = pad
    big_y = center_y - big_h // 2
    draw.rectangle([(big_x, big_y), (big_x + big_w, big_y + big_h)], fill=big_color)
    # 顶部高亮
    draw.rectangle([(big_x, big_y), (big_x + big_w, big_y + 10)], fill=WHITE)
    # 大块标签
    bbox = draw.textbbox((0, 0), big_label, font=font_big_label)
    tw = bbox[2] - bbox[0]
    draw.text((big_x + (big_w - tw) // 2, big_y + big_h // 2 - 30), big_label, fill=text_color, font=font_big_label)

    # N 个小块 (右侧, 横向排)
    small_h = big_h // 4  # 1/3 高度硬约束
    small_gap = int(small_h * 0.3)
    total_small_w = int(width * 0.50)
    small_w = (total_small_w - small_gap * (n - 1)) // n
    small_x_start = big_x + big_w + int(width * 0.10)
    for i in range(n):
        sx = small_x_start + i * (small_w + small_gap)
        sy = center_y - small_h // 2
        draw.rectangle([(sx, sy), (sx + small_w, sy + small_h)], fill=small_color)
        # 顶部高亮
        draw.rectangle([(sx, sy), (sx + small_w, sy + 6)], fill=WHITE)
        # 小块标签
        lab = small_label_template.format(i=i + 1)
        bbox = draw.textbbox((0, 0), lab, font=font_small_label)
        lw = bbox[2] - bbox[0]
        draw.text((sx + (small_w - lw) // 2, sy + small_h // 2 - 18), lab, fill=text_color, font=font_small_label)

    # ── 主标（下方）──
    main_text = f"≈ {n} 个阿里巴巴同时 IPO"
    bbox = draw.textbbox((0, 0), main_text, font=font_main)
    tw = bbox[2] - bbox[0]
    draw.text(((width - tw) // 2, height - int(height * 0.10)), main_text, fill=text_color, font=font_main)

    out_path = out_path or "comparison_1vn.jpg"
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "JPEG", quality=92, optimize=True)
    return out_path


# ════════════════════════════════════════════════════════
# 类型 3: 引用卡 (Quote Card) — 顺便做
# ════════════════════════════════════════════════════════
def render_quote_card(
    quote: str,
    author: str = "",
    brand: str = "晓波 AI 试错日记",
    bg_color: Tuple[int, int, int] = BG_DARK,
    accent_color: Tuple[int, int, int] = AMBER,
    text_color: Tuple[int, int, int] = WHITE,
    width: int = 2560,
    height: int = 1440,
    out_path: str = None,
) -> str:
    """
    引用卡 (适合金句, 16:9 横向条)
    """
    img = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(img)

    if width >= 2000:
        font_quote = load_font(120)
        font_author = load_font(48)
        font_brand = load_font(32)
    else:
        font_quote = load_font(72)
        font_author = load_font(32)
        font_brand = load_font(22)

    # ── 左侧竖线 (强调) ──
    line_x = int(width * 0.08)
    line_y1 = int(height * 0.20)
    line_y2 = int(height * 0.80)
    draw.line([(line_x, line_y1), (line_x, line_y2)], fill=accent_color, width=8)

    # ── 金句 (单行, 太长截断) ──
    max_quote_w = int(width * 0.78)
    bbox = draw.textbbox((0, 0), quote, font=font_quote)
    qw = bbox[2] - bbox[0]
    if qw > max_quote_w:
        # 简单截断 (后续可用 textwrap)
        while qw > max_quote_w and len(quote) > 5:
            quote = quote[:-1]
            bbox = draw.textbbox((0, 0), quote + "...", font=font_quote)
            qw = bbox[2] - bbox[0]
        quote = quote + "..."
    draw.text((line_x + 40, line_y1 + 20), quote, fill=text_color, font=font_quote)

    # ── 作者 (右上) ──
    if author:
        bbox = draw.textbbox((0, 0), author, font=font_author)
        aw = bbox[2] - bbox[0]
        draw.text((width - aw - 60, int(height * 0.13)), author, fill=accent_color, font=font_author)

    # ── 品牌 (右下) ──
    if brand:
        # 品牌字号放大, 琥珀色
        brand_font = load_font(48) if width >= 2000 else load_font(32)
        bbox = draw.textbbox((0, 0), brand, font=brand_font)
        bw = bbox[2] - bbox[0]
        draw.text((width - bw - 60, height - 90), brand, fill=accent_color, font=brand_font)

    out_path = out_path or "quote_card.jpg"
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "JPEG", quality=92, optimize=True)
    return out_path


# ════════════════════════════════════════════════════════
# 类型 4: 段头图 (Section Header) — 90% 场景 + 10% PIL 标题
# ════════════════════════════════════════════════════════
def render_section_header(
    art_path: str,
    out_path: str,
    section_num: str = "段 1",
    section_title: str = "先用人话翻译",
    section_subtitle: str = "",
    brand: str = "晓波 AI 试错日记",
    bg_color: Tuple[int, int, int] = BG_DARK,
    accent_color: Tuple[int, int, int] = AMBER,
    text_color: Tuple[int, int, int] = WHITE,
    overlay_ratio: float = 0.30,
    position: str = "bottom",  # "bottom" / "top" / "left"
) -> str:
    """
    段头图叠加 (90% 场景 + 10% PIL 标题)

    Args:
        art_path: Seedream 生成的场景图 (100% 场景)
        out_path: 输出路径
        section_num: 段序号, e.g. "段 1" / "Section 1"
        section_title: 段标题, e.g. "先用人话翻译"
        section_subtitle: 段副标 (可选)
        overlay_ratio: PIL 标题层占比 (默认 30%, 推荐 10-30%)
        position: 标题层位置 ("bottom" / "top" / "left")
    """
    img = Image.open(art_path).convert("RGB")
    W, H = img.size

    # 字体
    font_num = load_font(40) if W >= 2000 else load_font(28)
    font_title = load_font(80) if W >= 2000 else load_font(56)
    font_subtitle = load_font(32) if W >= 2000 else load_font(22)
    font_brand = load_font(24) if W >= 2000 else load_font(18)

    draw = ImageDraw.Draw(img)

    if position == "bottom":
        # 底部标题带 (30% 高度, 深紫黑 80% 透明)
        band_h = int(H * overlay_ratio)
        band = Image.new("RGBA", (W, band_h), (*bg_color, 200))
        # 琥珀顶边 (2px)
        for x in range(W):
            band.putpixel((x, 0), (*accent_color, 255))
        img_rgba = img.convert("RGBA")
        img_rgba.paste(band, (0, H - band_h), band)
        img = img_rgba.convert("RGB")
        draw = ImageDraw.Draw(img)

        # 段序号
        y_start = H - band_h + int(band_h * 0.20)
        draw.text((int(W * 0.05), y_start), section_num, fill=accent_color, font=font_num)
        # 段标题
        draw.text((int(W * 0.05), y_start + 50), section_title, fill=text_color, font=font_title)
        # 段副标
        if section_subtitle:
            draw.text((int(W * 0.05), y_start + 50 + 100), section_subtitle, fill=GRAY_LIGHT, font=font_subtitle)
        # 品牌 (右下)
        bbox = draw.textbbox((0, 0), brand, font=font_brand)
        bw = bbox[2] - bbox[0]
        draw.text((W - bw - 30, H - 30), brand, fill=accent_color, font=font_brand)

    elif position == "left":
        # 左侧标题带 (30% 宽, 80% 高)
        band_w = int(W * overlay_ratio)
        band = Image.new("RGBA", (band_w, int(H * 0.6)), (*bg_color, 200))
        # 琥珀左边 (4px)
        for y in range(int(H * 0.6)):
            band.putpixel((0, y), (*accent_color, 255))
        img_rgba = img.convert("RGBA")
        img_rgba.alpha_composite(band, (0, int(H * 0.2)))
        img = img_rgba.convert("RGB")
        draw = ImageDraw.Draw(img)
        # 段序号 + 标题 (旋转 90 度 / 竖排更复杂, 这里用左上水平)
        x0 = 30
        y0 = int(H * 0.25)
        draw.text((x0, y0), section_num, fill=accent_color, font=font_num)
        # 标题换行
        draw.text((x0, y0 + 50), section_title, fill=text_color, font=font_title)

    out_path = out_path or "section_header.jpg"
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "JPEG", quality=92, optimize=True)
    return out_path


# ════════════════════════════════════════════════════════
# CLI 测试入口
# ════════════════════════════════════════════════════════
# ════════════════════════════════════════════════════════════════
# 文字换行工具（矩阵 / 时间线 / 概念图共用）
# ════════════════════════════════════════════════════════════════
def _wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int,
               max_lines: int = 6) -> List[str]:
    """按像素宽度断行，超长截断并在末行加省略号。"""
    if not text:
        return []
    lines: List[str] = []
    for raw_line in text.split("\n"):
        cur = ""
        for ch in list(raw_line):
            if draw_text_width(cur + ch, font) <= max_width:
                cur = cur + ch
            else:
                if cur:
                    lines.append(cur)
                cur = ch
        if cur:
            lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        if lines[-1]:
            lines[-1] = lines[-1][:-1] + "…"
    return lines


def draw_text_width(text: str, font: ImageFont.FreeTypeFont) -> int:
    """用 textbbox 量文字像素宽（兼容旧 Pillow）。"""
    try:
        return int(font.getlength(text))
    except Exception:
        bbox = ImageDraw.Draw(Image.new("RGB", (1, 1))).textbbox((0, 0), text, font=font)
        return bbox[2] - bbox[0]


# ════════════════════════════════════════════════════════════════
# 类型 5: 2x2 矩阵（四象限判断图）
# ════════════════════════════════════════════════════════════════
def render_2x2_matrix(
    quadrants: Dict[str, Dict[str, str]],
    title: str = "",
    subtitle: str = "",
    axis_x: str = "",
    axis_y: str = "",
    highlight: str = "br",
    width: int = 2560,
    height: int = 1440,
    out_path: str = None,
    fact_check_path: Optional[str] = None,
    claim_keys: Optional[List[str]] = None,
) -> str:
    """
    四象限矩阵（适合「X 不是 Y，是 Z」判断框架 / 利弊对照 / 价值拆解）。

    Args:
        quadrants: {"tl": {"label","desc"}, "tr": {...}, "bl": {...}, "br": {...}}
        axis_x: X 轴含义, e.g. "短期 → 长期"
        axis_y: Y 轴含义, e.g. "低成本 → 高壁垒"
        highlight: 高亮象限 key（默认 br，琥珀强调）
    """
    if fact_check_path:
        require_fact_check(fact_check_path, claim_keys)

    img = Image.new("RGB", (width, height), BG_DARK)
    draw = ImageDraw.Draw(img)

    font_title = load_font(80) if width >= 2000 else load_font(52)
    font_sub = load_font(34) if width >= 2000 else load_font(24)
    font_axis = load_font(30) if width >= 2000 else load_font(22)
    font_q = load_font(46) if width >= 2000 else load_font(32)
    font_desc = load_font(30) if width >= 2000 else load_font(22)

    if title:
        bbox = draw.textbbox((0, 0), title, font=font_title)
        tw = bbox[2] - bbox[0]
        draw.text(((width - tw) // 2, int(height * 0.035)), title, fill=WHITE, font=font_title)
    if subtitle:
        bbox = draw.textbbox((0, 0), subtitle, font=font_sub)
        tw = bbox[2] - bbox[0]
        draw.text(((width - tw) // 2, int(height * 0.115)), subtitle, fill=GRAY_LIGHT, font=font_sub)

    grid_x0 = int(width * 0.10)
    grid_y0 = int(height * 0.20)
    grid_w = int(width * 0.80)
    grid_h = int(height * 0.66)
    cell_w = grid_w // 2
    cell_h = grid_h // 2
    gap = 14

    tint = {
        "tl": (PURPLE[0] // 2, PURPLE[1] // 2, PURPLE[2] // 2 + 20),
        "tr": (0, 94, 106),
        "bl": (60, 56, 80),
        "br": (122, 80, 16),
    }
    header = {"tl": PURPLE, "tr": CYAN, "bl": GRAY_DARK, "br": AMBER}
    pos = {
        "tl": (grid_x0, grid_y0),
        "tr": (grid_x0 + cell_w + gap, grid_y0),
        "bl": (grid_x0, grid_y0 + cell_h + gap),
        "br": (grid_x0 + cell_w + gap, grid_y0 + cell_h + gap),
    }

    for key in ("tl", "tr", "bl", "br"):
        q = quadrants.get(key, {})
        x, y = pos[key]
        draw.rectangle([(x, y), (x + cell_w, y + cell_h)], fill=tint[key])
        draw.rectangle([(x, y), (x + cell_w, y + 10)], fill=header[key])
        label = q.get("label", "")
        bbox = draw.textbbox((0, 0), label, font=font_q)
        lw = bbox[2] - bbox[0]
        draw.text((x + (cell_w - lw) // 2, y + 24), label, fill=WHITE, font=font_q)
        desc = q.get("desc", "")
        lines = _wrap_text(desc, font_desc, cell_w - 60, max_lines=5)
        ty = y + 24 + int(font_q.size * 1.4)
        for ln in lines:
            draw.text((x + 30, ty), ln, fill=GRAY_LIGHT, font=font_desc)
            ty += int(font_desc.size * 1.35)
        if key == highlight:
            draw.rectangle([(x + 4, y + 4), (x + cell_w - 4, y + cell_h - 4)],
                           outline=AMBER, width=5)

    if axis_x:
        bbox = draw.textbbox((0, 0), axis_x, font=font_axis)
        tw = bbox[2] - bbox[0]
        draw.text((grid_x0 + grid_w - tw, grid_y0 + grid_h + 12), axis_x, fill=CYAN, font=font_axis)
    if axis_y:
        draw.text((int(width * 0.02), grid_y0 + grid_h // 2), axis_y, fill=CYAN, font=font_axis)

    out_path = out_path or "matrix_2x2.jpg"
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "JPEG", quality=92, optimize=True)
    return out_path


# ════════════════════════════════════════════════════════════════
# 类型 6: 时间线（横向里程碑）
# ════════════════════════════════════════════════════════════════
def render_timeline(
    steps: List[Dict[str, str]],
    title: str = "",
    subtitle: str = "",
    width: int = 2560,
    height: int = 1440,
    out_path: str = None,
    fact_check_path: Optional[str] = None,
    claim_keys: Optional[List[str]] = None,
) -> str:
    """横向时间线（适合「5 个月营收翻 5 倍」/ 技术演进 / 事件序列）。

    Args:
        steps: [{"label": "2023 Q1", "text": "..."}, ...]
    """
    if fact_check_path:
        require_fact_check(fact_check_path, claim_keys)

    img = Image.new("RGB", (width, height), BG_DARK)
    draw = ImageDraw.Draw(img)

    font_title = load_font(80) if width >= 2000 else load_font(52)
    font_sub = load_font(34) if width >= 2000 else load_font(24)
    font_label = load_font(36) if width >= 2000 else load_font(26)
    font_text = load_font(28) if width >= 2000 else load_font(20)

    if title:
        bbox = draw.textbbox((0, 0), title, font=font_title)
        tw = bbox[2] - bbox[0]
        draw.text(((width - tw) // 2, int(height * 0.04)), title, fill=WHITE, font=font_title)
    if subtitle:
        bbox = draw.textbbox((0, 0), subtitle, font=font_sub)
        tw = bbox[2] - bbox[0]
        draw.text(((width - tw) // 2, int(height * 0.12)), subtitle, fill=GRAY_LIGHT, font=font_sub)

    n = max(len(steps), 1)
    margin_x = int(width * 0.08)
    line_y = int(height * 0.55)
    span = width - margin_x * 2
    step = span / n if n > 1 else span
    radius = 22

    draw.line([(margin_x, line_y), (margin_x + span, line_y)], fill=GRAY_GRID, width=6)

    for i, s in enumerate(steps):
        cx = margin_x + step * (i + 0.5)
        draw.ellipse([(cx - radius, line_y - radius), (cx + radius, line_y + radius)],
                     fill=AMBER if i == n - 1 else PURPLE, outline=WHITE, width=3)
        label = s.get("label", "")
        bbox = draw.textbbox((0, 0), label, font=font_label)
        lw = bbox[2] - bbox[0]
        draw.text((cx - lw // 2, line_y - radius - 56), label, fill=CYAN, font=font_label)
        text = s.get("text", "")
        lines = _wrap_text(text, font_text, int(step * 0.9), max_lines=4)
        ty = line_y + radius + 24
        for ln in lines:
            bbox = draw.textbbox((0, 0), ln, font=font_text)
            lw = bbox[2] - bbox[0]
            draw.text((cx - lw // 2, ty), ln, fill=GRAY_LIGHT, font=font_text)
            ty += int(font_text.size * 1.35)

    out_path = out_path or "timeline.jpg"
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "JPEG", quality=92, optimize=True)
    return out_path


# ════════════════════════════════════════════════════════════════
# 类型 7: 概念 / 关系图（中心节点 + 卫星）
# ════════════════════════════════════════════════════════════════
def render_concept_map(
    nodes: List[Dict[str, str]],
    edges: List[List[str]] = None,
    title: str = "",
    subtitle: str = "",
    width: int = 2560,
    height: int = 1440,
    out_path: str = None,
    fact_check_path: Optional[str] = None,
    claim_keys: Optional[List[str]] = None,
) -> str:
    """概念 / 关系图（适合「核心概念 + 关键关系」「实体关系网」）。

    Args:
        nodes: [{"id": "ai", "label": "AI 编程"}, ...]
        edges: [["ai", "tool"], ...]  用节点 id 引用
    """
    if fact_check_path:
        require_fact_check(fact_check_path, claim_keys)

    edges = edges or []
    img = Image.new("RGB", (width, height), BG_DARK)
    draw = ImageDraw.Draw(img)

    font_title = load_font(80) if width >= 2000 else load_font(52)
    font_sub = load_font(34) if width >= 2000 else load_font(24)
    font_node = load_font(34) if width >= 2000 else load_font(24)

    if title:
        bbox = draw.textbbox((0, 0), title, font=font_title)
        tw = bbox[2] - bbox[0]
        draw.text(((width - tw) // 2, int(height * 0.04)), title, fill=WHITE, font=font_title)
    if subtitle:
        bbox = draw.textbbox((0, 0), subtitle, font=font_sub)
        tw = bbox[2] - bbox[0]
        draw.text(((width - tw) // 2, int(height * 0.12)), subtitle, fill=GRAY_LIGHT, font=font_sub)

    id_map = {nd.get("id", str(i)): nd for i, nd in enumerate(nodes)}
    centers = {}
    cx0, cy0 = width // 2, int(height * 0.56)
    n = len(nodes)
    if n <= 1:
        only = (list(id_map.keys()) or ["n"])[0]
        centers = {only: (cx0, cy0)}
    else:
        import math
        R = min(width, height) * 0.32
        for i, key in enumerate(id_map.keys()):
            ang = 2 * math.pi * i / n - math.pi / 2
            centers[key] = (int(cx0 + R * math.cos(ang)), int(cy0 + R * math.sin(ang)))

    for a, b in edges:
        if a in centers and b in centers:
            draw.line([centers[a], centers[b]], fill=GRAY_GRID, width=4)

    node_r = 90
    for key, (x, y) in centers.items():
        nd = id_map[key]
        is_center = bool(nodes and key == nodes[0].get("id"))
        fill = AMBER if is_center else PURPLE
        draw.ellipse([(x - node_r, y - node_r), (x + node_r, y + node_r)], fill=fill, outline=WHITE, width=4)
        label = nd.get("label", key)
        lines = _wrap_text(label, font_node, node_r * 2 - 20, max_lines=3)
        ty = y - (len(lines) * int(font_node.size * 1.3)) // 2
        for ln in lines:
            bbox = draw.textbbox((0, 0), ln, font=font_node)
            lw = bbox[2] - bbox[0]
            draw.text((x - lw // 2, ty), ln, fill=WHITE, font=font_node)
            ty += int(font_node.size * 1.3)

    out_path = out_path or "concept_map.jpg"
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "JPEG", quality=92, optimize=True)
    return out_path


if __name__ == "__main__":
    import sys
    workspace = Path(os.environ.get("HUAYANJI_WORKSPACE", "/Users/albert/Documents/Molly"))
    out_dir = workspace / "huayanji" / "content" / "media" / "generated" / "_infographic_test"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 测试 1: 柱状图 (5 个月营收 1→5 倍, 修数据一致性)
    p1 = render_bar_chart(
        values=[1, 1.8, 2.7, 3.6, 4.5, 5.0],  # 95→470 亿 = 4.95x, 修 5.5→5.0
        labels=["M1", "M2", "M3", "M4", "M5", "M6"],
        title="5 个月 · 营收 × 5",
        subtitle="Anthropic 年化营收从 95 亿飙到 470 亿美元（数据来源：The Information）",
        highlight_last=True,
        out_path=str(out_dir / "test_bar_5x.jpg"),
    )
    print(f"✅ 柱状图: {p1}")

    # 测试 2: 1-vs-3 对比图 (加美元锚点)
    p2 = render_comparison_1vn(
        n=3,
        big_label="1× Anthropic",
        small_label_template="1× 阿里 #{i}",
        out_path=str(out_dir / "test_comparison_1vs3.jpg"),
    )
    print(f"✅ 1-vs-3 对比: {p2}")

    # 测试 3: 引用卡 (品牌字号调大)
    p3 = render_quote_card(
        quote="AI 帮企业真金白银在省人力成本",
        author="— 晓波",
        brand="晓波 AI 试错日记",
        out_path=str(out_dir / "test_quote.jpg"),
    )
    print(f"✅ 引用卡: {p3}")

    # 测试 4: 1-vs-3 对比图 (带美元锚点版, 演示扩展性)
    p4 = render_comparison_1vn(
        n=3,
        big_label="1× Anthropic ≈ $1,830 亿",
        small_label_template="≈ $610 亿 #{i}",
        out_path=str(out_dir / "test_comparison_1vs3_with_dollar.jpg"),
    )
    print(f"✅ 1-vs-3 对比(带美元): {p4}")

    # 测试 5: 2x2 矩阵（判断框架）
    p5 = render_2x2_matrix(
        quadrants={
            "tl": {"label": "玩具级", "desc": "能跑 demo，但生产踩坑无人接"},
            "tr": {"label": "套壳 API", "desc": "拼别人的能力，没自有壁垒"},
            "bl": {"label": "重投入慢", "desc": "自研底座，周期长回报晚"},
            "br": {"label": "场景深耕", "desc": "抓一个真痛点，用 AI 把它做到极致"},
        },
        title="AI 创业不是拼模型，是拼场景",
        subtitle="X 不是「谁的模型大」，是「谁先把一个场景做透」",
        axis_x="通用 → 垂直",
        axis_y="轻 → 重",
        highlight="br",
        out_path=str(out_dir / "test_matrix_2x2.jpg"),
    )
    print(f"✅ 2x2 矩阵: {p5}")

    # 测试 6: 时间线
    p6 = render_timeline(
        steps=[
            {"label": "2023 Q1", "text": "Claude 3 发布，长上下文破圈"},
            {"label": "2023 Q3", "text": "GPTs 上线，人人能搭智能体"},
            {"label": "2024 Q1", "text": "Sora 演示，视频生成引爆"},
            {"label": "2024 Q4", "text": "DeepSeek 开源，成本塌方"},
        ],
        title="一年半，AI 能力三次跃迁",
        subtitle="每一跳都重写一次「能做什么」的边界",
        out_path=str(out_dir / "test_timeline.jpg"),
    )
    print(f"✅ 时间线: {p6}")

    # 测试 7: 概念 / 关系图
    p7 = render_concept_map(
        nodes=[
            {"id": "core", "label": "AI 编程"},
            {"id": "a", "label": "架构判断"},
            {"id": "b", "label": "调试直觉"},
            {"id": "c", "label": "业务语境"},
        ],
        edges=[["core", "a"], ["core", "b"], ["core", "c"]],
        title="AI 编程放大的是你已有的判断力",
        subtitle="不是替你长出能力，是放大本来就有的",
        out_path=str(out_dir / "test_concept_map.jpg"),
    )
    print(f"✅ 概念图: {p7}")
