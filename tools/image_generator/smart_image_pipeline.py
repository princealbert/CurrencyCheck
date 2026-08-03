#!/usr/bin/env python3
"""
花眼记 · 一键生图统一入口 v1.0
=============================

本模块是花眼记所有生图任务的统一入口,封装 6 种生图方法,把
``prompt_factory``(提示词工厂)+ ``volcano_ark``(Seedream HTTP 调用)+
``pil_infographic``(PIL 数据可视化)三件套串起来,业务脚本只需要调用
``SmartImagePipeline`` 即可,不需要关心 prompt 怎么拼、API 怎么调、图怎么存。

──────────────────────────────────────────────────────────────
6 种方法一览
──────────────────────────────────────────────────────────────
1. ``generate_cover(title, scene="cover_impact", size="2048x2048")``
   封面图 → 用 cover_impact 模板 + Seedream,自动保存到 content/media/generated。

2. ``generate_section_illustration(section_title, scene="", size="2048x2048")``
   段内插图 → 根据 ``section_title`` 关键词自动匹配 7 个场景模板之一
   (judgment_under_scrutiny / tidying_categories / decision_crossroad /
   split_scene_24h / learning_path / action_checklist / cover_impact),
   匹配不到则 fallback 到 ``judgment_under_scrutiny``。

3. ``generate_bar_chart(values, labels, title, subtitle, out_path)``
   柱状图 → 调用 ``pil_infographic.render_bar_chart``,文字 100% 可读。

4. ``generate_comparison(big_label, small_labels, title, out_path)``
   1-vs-N 对比图 → 调用 ``pil_infographic.render_comparison_1vn``。

5. ``generate_quote_card(quote, author, brand, out_path)``
   引用卡 → 调用 ``pil_infographic.render_quote_card``。

6. ``generate_section_header(art_path, section_num, section_title, out_path)``
   段头图 → 调用 ``pil_infographic.render_section_header``,
   在 Seedream 场景图上叠加 PIL 标题条(90% 场景 + 10% 标题)。

──────────────────────────────────────────────────────────────
典型用法
──────────────────────────────────────────────────────────────
.. code-block:: python

    from smart_image_pipeline import SmartImagePipeline

    pipe = SmartImagePipeline()

    # 封面图
    cover = pipe.generate_cover("装了 23 个 AI 工具只剩 6 个")

    # 段内插图(自动按标题匹配场景)
    art = pipe.generate_section_illustration("判断力 vs Prompt")

    # 柱状图
    pipe.generate_bar_chart(
        values=[1, 1.8, 2.7, 3.6, 4.5, 5.0],
        labels=["M1", "M2", "M3", "M4", "M5", "M6"],
        title="5 个月 · 营收 × 5",
        subtitle="Anthropic 年化营收 470 亿美元",
        out_path="/tmp/test_bar.jpg",
    )

    # 段头图(在 art 之上叠加标题)
    pipe.generate_section_header(
        art_path=art,
        section_num="段 2",
        section_title="判断力 vs Prompt",
        out_path="/tmp/test_section.jpg",
    )

──────────────────────────────────────────────────────────────
CLI 调试
──────────────────────────────────────────────────────────────
``python3 smart_image_pipeline.py cover``     → 生成一张封面图
``python3 smart_image_pipeline.py scene <title>`` → 按标题自动匹配场景
``python3 smart_image_pipeline.py bar``        → 生成一张柱状图
"""

from __future__ import annotations

import os
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import List, Optional

# ─── 依赖注入:三件套 ──────────────────────────────────
# 注意:volcano_ark.py 用的是相对导入 `from .base import ...`,
# 必须把 huayanji/ 加进 sys.path,然后用包形式 `from image_generator import ...`
# 这样 image_generator 内部的相对导入才能解析;否则脚本直跑会报
# "attempted relative import with no known parent package"。
_THIS_DIR = Path(__file__).resolve().parent         # .../huayanji/image_generator
_HUAYANJI_DIR = _THIS_DIR.parent                     # .../huayanji
for p in (str(_HUAYANJI_DIR), str(_THIS_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from prompt_factory import (  # noqa: E402
    CHARACTER,
    STYLE,
    NEGATIVE,
    SCENE_TEMPLATES,
    build_prompt,
    get_negative,
)

from pil_infographic import (  # noqa: E402
    render_bar_chart,
    render_comparison_1vn,
    render_quote_card,
    render_section_header,
)

from image_generator.volcano_ark import VolcanoArkGenerator  # noqa: E402
from image_qa import qa_image  # noqa: E402


# ════════════════════════════════════════════════════════════════
# 段标题 → 场景模板 关键词映射
# ════════════════════════════════════════════════════════════════

SCENE_KEYWORDS: dict = {
    "judgment_under_scrutiny": ["判断", "审视", "怀疑", "质疑", "鉴别"],
    "tidying_categories":      ["整理", "分类", "归类", "划分", "分区"],
    "decision_crossroad":      ["选择", "岔路", "判断", "决策", "对比"],
    "split_scene_24h":         ["对比", "白天", "夜晚", "24", "飞轮"],
    "learning_path":           ["路径", "阶段", "学习", "成长", "进化"],
    "action_checklist":        ["行动", "清单", "执行", "todo", "立即做"],
    "cover_impact":            ["封面", "cover", "23", "6"],
}

DEFAULT_SCENE = "judgment_under_scrutiny"  # fallback,最安全的默认

# 关键词命中数相同时,按此优先级挑一个(覆盖 SCENE_KEYWORDS 插入顺序)
SCENE_PRIORITY = [
    "judgment_under_scrutiny",
    "tidying_categories",
    "decision_crossroad",
    "split_scene_24h",
    "learning_path",
    "action_checklist",
    "cover_impact",
]


# ════════════════════════════════════════════════════════════════
# 工具函数
# ════════════════════════════════════════════════════════════════

def _slugify(text: str, max_len: int = 40) -> str:
    """把中文/英文标题转成安全文件名片段(保留中文,只过滤文件系统非法字符)"""
    s = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", text).strip()
    s = re.sub(r"\s+", "_", s)
    return s[:max_len] if s else "image"


def _default_out_dir() -> Path:
    """默认输出目录:huayanji/content/media/generated/"""
    workspace = Path(os.environ.get("HUAYANJI_WORKSPACE", "/Users/albert/Documents/Molly"))
    return workspace / "huayanji" / "content" / "media" / "generated"


def _auto_filename(prefix: str, title: str, ext: str = ".jpg") -> str:
    """生成默认文件名:<prefix>_<slug>_<时间戳>.<ext>"""
    ts = int(time.time() * 1000) % 100_000_000
    return f"{prefix}_{_slugify(title)}_{ts}{ext}"


def _resolve_out_path(out_path: Optional[str], prefix: str, title: str, ext: str = ".jpg") -> Path:
    """如果 out_path 是 None,自动拼默认路径;否则原样返回。"""
    if out_path:
        return Path(out_path)
    out_dir = _default_out_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir / _auto_filename(prefix, title, ext)


def _download(url: str, dest: Path) -> Path:
    """下载远程图片到本地,带超时与目录创建。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        dest.write_bytes(r.read())
    return dest


def _match_scene_by_title(section_title: str) -> str:
    """
    根据段标题关键词匹配场景模板 key。
    规则:每个模板计算关键词命中数,选最高分(>0);并列按 SCENE_PRIORITY 取前者;
    全部不命中 → 返回 DEFAULT_SCENE。
    """
    title_lower = section_title.lower()
    scores: dict = {}
    for scene_key, kws in SCENE_KEYWORDS.items():
        hit = sum(1 for kw in kws if kw.lower() in title_lower or kw in section_title)
        if hit > 0:
            scores[scene_key] = hit

    if not scores:
        return DEFAULT_SCENE

    max_score = max(scores.values())
    candidates = [k for k, v in scores.items() if v == max_score]
    # 按 SCENE_PRIORITY 顺序取第一个
    for k in SCENE_PRIORITY:
        if k in candidates:
            return k
    return candidates[0]


# ════════════════════════════════════════════════════════════════
# 主类
# ════════════════════════════════════════════════════════════════

class SmartImagePipeline:
    """
    花眼记一键生图统一入口。

    用法::

        pipe = SmartImagePipeline()
        pipe.generate_cover("装了 23 个 AI 工具只剩 6 个")
        pipe.generate_section_illustration("判断力 vs Prompt")
        pipe.generate_bar_chart([1,2,3], ["a","b","c"], "title", "sub", None)
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        out_dir: Optional[str] = None,
        download_timeout: int = 120,
    ):
        self.generator = VolcanoArkGenerator(api_key=api_key)
        self.out_dir = Path(out_dir) if out_dir else _default_out_dir()
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.download_timeout = download_timeout

    # ──────────────────────────────────────────────────────────
    # 1. 封面图
    # ──────────────────────────────────────────────────────────
    def generate_cover(
        self,
        title: str,
        scene: str = "cover_impact",
        size: str = "2048x2048",
        out_path: Optional[str] = None,
        character_style: str = "3d",
        ref_image: Optional[str] = None,
    ) -> str:
        """
        封面图:自动用 cover_impact 模板拼 prompt → Seedream 生成 → 下载到本地。

        Args:
            title: 封面主题(用于拼 prompt + 文件名)
            scene: 场景模板 key,默认 ``cover_impact``
            size: Seedream 尺寸,默认 ``2048x2048``
            out_path: 输出路径,None 则自动存到默认目录
            character_style: 形象风格 '2d'(吉卜力二维) / '3d'(中国3D动画, 默认)
            ref_image: 角色基准图路径(图生图模式,锁定角色身份一致性)

        Returns:
            本地图片绝对路径
        """
        from prompt_factory import build_prompt, get_negative
        prompt = build_prompt(
            scene="", use_template=scene, character_style=character_style,
        )
        neg = get_negative(character_style=character_style)
        return self._call_seedream(
            prompt=prompt,
            negative_prompt=neg,
            title=title,
            prefix="cover",
            size=size,
            out_path=out_path,
            scene_label=scene,
            ref_image=ref_image,
        )

    # ──────────────────────────────────────────────────────────
    # 2. 段内插图(自动匹配场景)
    # ──────────────────────────────────────────────────────────
    def generate_section_illustration(
        self,
        section_title: str,
        scene: str = "",
        size: str = "2048x2048",
        out_path: Optional[str] = None,
        character_style: str = "3d",
        ref_image: Optional[str] = None,
    ) -> str:
        """
        段内插图:按 ``section_title`` 关键词自动匹配 7 个场景模板之一。

        匹配规则(详见模块顶部 SCENE_KEYWORDS):
          - 每个模板对 section_title 统计关键词命中数
          - 命中数最多且 >0 者胜出;并列时按 SCENE_PRIORITY 取前者
          - 全部不命中 → fallback 到 ``judgment_under_scrutiny``
          - 若显式传入 ``scene``(非空),则覆盖自动匹配结果

        Args:
            character_style: 形象风格 '2d'(吉卜力二维) / '3d'(中国3D动画, 默认)
            ref_image: 角色基准图路径(图生图模式,锁定角色身份一致性)

        Returns:
            本地图片绝对路径
        """
        from prompt_factory import build_prompt, get_negative

        if scene and scene in SCENE_TEMPLATES:
            chosen = scene
        else:
            chosen = _match_scene_by_title(section_title)

        prompt = build_prompt(scene="", use_template=chosen, character_style=character_style)
        neg = get_negative(character_style=character_style)
        return self._call_seedream(
            prompt=prompt,
            title=section_title,
            prefix="section",
            size=size,
            out_path=out_path,
            scene_label=chosen,
            ref_image=ref_image,
        )

    # ──────────────────────────────────────────────────────────
    # 3. 柱状图 (PIL,无 fact_check 强校验,方便测试)
    # ──────────────────────────────────────────────────────────
    def generate_bar_chart(
        self,
        values: List[float],
        labels: Optional[List[str]] = None,
        title: str = "",
        subtitle: str = "",
        out_path: Optional[str] = None,
        fact_check_path: Optional[str] = None,
        claim_keys: Optional[List[str]] = None,
    ) -> str:
        """柱状图:委托给 ``pil_infographic.render_bar_chart``。"""
        dest = _resolve_out_path(out_path, "bar", title or "chart")
        return render_bar_chart(
            values=values,
            labels=labels,
            title=title,
            subtitle=subtitle,
            out_path=str(dest),
            fact_check_path=fact_check_path,
            claim_keys=claim_keys,
        )

    # ──────────────────────────────────────────────────────────
    # 4. 1-vs-N 对比图
    # ──────────────────────────────────────────────────────────
    def generate_comparison(
        self,
        big_label: str,
        small_labels: List[str],
        title: str = "",
        out_path: Optional[str] = None,
        fact_check_path: Optional[str] = None,
        claim_keys: Optional[List[str]] = None,
    ) -> str:
        """
        1-vs-N 对比图:委托给 ``pil_infographic.render_comparison_1vn``。

        Args:
            big_label: 左侧大块标签, e.g. ``"1× Anthropic"``
            small_labels: 右侧 N 个小块标签列表, e.g. ``["1× 阿里", "1× 拼多多", "1× 美团"]``
                长度即 N;底层会用 ``small_label_template="<label> #{i}"`` 形式渲染
                (每块都展示完整标签,#i 仅作编号后缀,可读性更好)。
        """
        n = len(small_labels)
        if n == 0:
            raise ValueError("small_labels 不能为空")
        # 用 "<label> #{i}" 让底层按 i 渲染:label 自身已经不同,#{i} 只是冗余编号
        # 视觉上更清晰:每块显示自己的标签 + 编号
        template = "{label} #{i}"
        dest = _resolve_out_path(out_path, "cmp", title or big_label)
        # render_comparison_1vn 接受 small_label_template 直接 .format(i=...) 不带 label
        # 我们自己展开 labels,自定义 main_text 作为副标题
        small_template = " ".join(f"#{i+1} {lab}" for i, lab in enumerate(small_labels))
        return render_comparison_1vn(
            n=n,
            big_label=big_label,
            small_label_template=small_template,
            out_path=str(dest),
            fact_check_path=fact_check_path,
            claim_keys=claim_keys,
        )

    # ──────────────────────────────────────────────────────────
    # 5. 引用卡
    # ──────────────────────────────────────────────────────────
    def generate_quote_card(
        self,
        quote: str,
        author: str = "",
        brand: str = "晓波 AI 试错日记",
        out_path: Optional[str] = None,
    ) -> str:
        """引用卡:委托给 ``pil_infographic.render_quote_card``。"""
        dest = _resolve_out_path(out_path, "quote", quote)
        return render_quote_card(
            quote=quote,
            author=author,
            brand=brand,
            out_path=str(dest),
        )

    # ──────────────────────────────────────────────────────────
    # 6. 段头图(场景图 + PIL 标题叠加)
    # ──────────────────────────────────────────────────────────
    def generate_section_header(
        self,
        art_path: str,
        section_num: str,
        section_title: str,
        out_path: Optional[str] = None,
        section_subtitle: str = "",
        brand: str = "晓波 AI 试错日记",
    ) -> str:
        """
        段头图:在 Seedream 场景图上叠加 PIL 标题条(底部带状)。

        Args:
            art_path: 已生成的场景图路径(由 ``generate_section_illustration`` 返回)
            section_num: 段序号, e.g. ``"段 1"``
            section_title: 段标题, e.g. ``"先用人话翻译"``
        """
        dest = _resolve_out_path(out_path, "header", section_title)
        return render_section_header(
            art_path=art_path,
            out_path=str(dest),
            section_num=section_num,
            section_title=section_title,
            section_subtitle=section_subtitle,
            brand=brand,
        )

    # ──────────────────────────────────────────────────────────
    # 内部:统一调 Seedream + 下载
    # ──────────────────────────────────────────────────────────
    def _call_seedream(
        self,
        prompt: str,
        title: str,
        prefix: str,
        size: str,
        out_path: Optional[str],
        scene_label: str,
        negative_prompt: Optional[str] = None,
        ref_image: Optional[str] = None,
    ) -> str:
        dest = _resolve_out_path(out_path, prefix, title, ext=".jpg")
        neg = negative_prompt or NEGATIVE
        mode = "图生图(角色锁)" if ref_image else "文生图"
        print(f"🎨 [{prefix}] {mode}  scene={scene_label}  size={size}")
        print(f"   prompt 长度: {len(prompt)} 字符")
        if ref_image:
            print(f"   参考图: {ref_image}")
        print(f"   输出: {dest}")

        gen_kwargs = dict(
            prompt=prompt,
            negative_prompt=neg,
            size=size,
            style_strength=8.0,   # harness: 插画 8
            detail_level=8.0,     # 7-9
            guidance_scale=7.5,   # 7-8
            optimize_prompt_mode="standard",
            num_images=1,
        )
        if ref_image:
            gen_kwargs["ref_image"] = ref_image

        results = self.generator.generate(**gen_kwargs)

        if not results or not results[0].success:
            err = results[0].error_message if results else "no result"
            raise RuntimeError(f"Seedream 调用失败: {err}")

        url = results[0].image_url
        if not url:
            raise RuntimeError("Seedream 返回成功但无 image_url")

        print(f"   远端 URL: {url[:80]}...")
        _download(url, dest)
        print(f"✅ 已保存: {dest}")
        # 交付前基础 QA（空图/纯色/损坏/尺寸），warn 模式不阻断现有产线
        try:
            qa_image(dest, severity="warn")
        except Exception as e:
            print(f"   ⚠️ QA 自检异常(已忽略): {e}", file=sys.stderr)
        return str(dest)


# ════════════════════════════════════════════════════════════════
# CLI 入口
# ════════════════════════════════════════════════════════════════

def _main() -> int:
    pipe = SmartImagePipeline()
    arg1 = sys.argv[1] if len(sys.argv) > 1 else ""

    try:
        if arg1 == "cover":
            title = sys.argv[2] if len(sys.argv) > 2 else "装了 23 个 AI 工具只剩 6 个"
            pipe.generate_cover(title)
        elif arg1 == "scene":
            title = sys.argv[2] if len(sys.argv) > 2 else "判断力 vs Prompt"
            chosen = _match_scene_by_title(title)
            print(f"🔍 关键词匹配: '{title}' → 场景 '{chosen}'")
            pipe.generate_section_illustration(title, scene="")
        elif arg1 == "bar":
            pipe.generate_bar_chart(
                values=[1, 1.8, 2.7, 3.6, 4.5, 5.0],
                labels=["M1", "M2", "M3", "M4", "M5", "M6"],
                title="5 个月 · 营收 × 5",
                subtitle="Anthropic 年化营收 470 亿美元",
                out_path="/tmp/test_bar.jpg",
            )
        else:
            print("用法: python smart_image_pipeline.py [cover [title] | scene [title] | bar]")
            return 0
        return 0
    except Exception as e:
        print(f"❌ 执行失败: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(_main())
