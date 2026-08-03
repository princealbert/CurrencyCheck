#!/usr/bin/env python3
"""
花眼记 · 生图提示词工厂 v2.0（含角色身份锁定）
============================================

来源：AI 学习路线图 Vol.001 配图 7 张从 v1.0→v4.0 迭代 4 版沉淀。
所有花眼记配图任务必须用本模块构造 prompt，禁止在业务脚本里裸写。

核心接口：
- CHARACTER / CHARACTER_3D：花眼小哥角色锚定词（2D吉卜力 / 3D中国动画）
- STYLE / STYLE_3D：花眼记品牌风格锚定词
- NEGATIVE / NEGATIVE_3D：通用负面词（含合规红线 + 风格专属禁词）
- build_prompt(scene, character_style='3d') → 完整 prompt（自动选锚定词）
- SCENE_TEMPLATES：8 种常见场景模板（含 cta_interaction）

角色身份锁定（v2.0 新增）：
- 基准图：assets/avatars/huayan-daoshi-3d-ref.png（从引导关注图裁剪的标准脸）
- 用法：SmartImagePipeline.generate_cover(..., ref_image=基准图路径)
- 效果：Seedream 图生图模式，所有产出角色五官/脸型与基准图一致
- 同一篇文章的所有配图必须使用同一张 ref_image，确保视觉统一
"""

from typing import List, Optional

# 统一视觉系统（文/图/视频共享的视觉语言单一真源）
try:
    from visual_system import VISUAL_SYSTEM_PROMPT as _VS_PROMPT
except Exception:  # 兜底：直接构造，避免导入失败阻断生图
    _VS_PROMPT = ""

# ════════════════════════════════════════════════════════════════
# 三大锚定词（每次必含）
# ════════════════════════════════════════════════════════════════

# ── 形象风格分叉（2D 吉卜力 / 3D 中国风）─────────────────────
# 同一角色身份（棕发+圆框眼镜+橙衫+向日葵商标），不同渲染维度。
# 默认用 3d（用户主要使用三维头像）；通过 character_style 参数切换。

CHARACTER = (
    "A young man in his 20s serving as the cartoon mascot host: "
    "messy brown hair with one curl sticking up, "
    "wearing round black-framed glasses, "
    "wearing an orange-yellow button-up shirt, "
    "cartoon semi-realistic Ghibli-style with expressive face and body language, "
    "a sunflower or two placed nearby in the scene as his trademark"
)

CHARACTER_3D = (
    "A young man in his 20s serving as the cartoon mascot host: "
    "stylish messy brown hair with soft volume and gentle highlights, "
    "wearing slim round black-framed glasses (thin elegant frames, NOT thick/chunky), "
    "wearing an orange-yellow polo shirt with a collar, blue backpack straps on shoulders, "
    "Chinese 3D CGI animation film character style like Chang'an (长安三万里) or Ne Zha, "
    "smooth glossy-satin skin material with subtle subsurface scattering for warmth, "
    "clean smooth surfaces, rounded geometric proportions with slightly large head, "
    "expressive 3D face with big bright eyes visible behind the glasses, "
    "friendly confident smile, dynamic natural body language, "
    "a sunflower or two placed nearby in the scene as his trademark"
)

STYLE = (
    "Ghibli-inspired warm cartoon illustration, "
    "warm orange dominant palette, "
    "sunlight yellow accents, "
    "gentle cream background tones, "
    "soft outlines, warm sunlight, gentle shadows, "
    "no text, no letters, no alphabet, no readable characters in any language, "
    "no watermark, no signature, no logo, no UI overlays"
)

STYLE_3D = (
    "Chinese 3D CGI animation film rendering style, like Chang'an (长安三万里) or "
    "Light Chaser Animation quality, "
    "warm orange dominant palette with sunlight yellow accents, "
    "gentle cream background tones, "
    "smooth glossy-satin material for characters, clean surfaces without texture grain, "
    "soft volumetric lighting, warm global illumination, gentle ambient occlusion in creases, "
    "subsurface scattering on skin and ears for natural warmth, "
    "no text, no letters, no alphabet, no readable characters in any language, "
    "no watermark, no signature, no logo, no UI overlays"
)

# 风格映射表（character_style → 对应锚定词元组）
CHARACTER_STYLES = {
    '2d': {'character': CHARACTER, 'style': STYLE},
    '3d': {'character': CHARACTER_3D, 'style': STYLE_3D},
}
_DEFAULT_STYLE = '3d'

STYLE_BRANDED_HYBRID = (
    "Ghibli-inspired warm illustration style for the character, "
    "with selective photorealistic rendering of brand elements and logos, "
    "soft golden-hour lighting, warm color palette with #F5A623 orange accents, "
    "sunflower background elements"
)

NEGATIVE = (
    "any text, any letters, alphabet, "
    "Chinese characters, English words, numbers, digits, "
    "AI generated watermark, signature, logo, "
    "office, work badge, ID card, uniform, "
    "realistic photograph, 3D render, photorealistic skin, "
    "low quality, blurry, distorted, ugly, "
    "dark mood, horror, violent, scary"
)

NEGATIVE_3D = (
    "any text, any letters, alphabet, "
    "Chinese characters, English words, numbers, digits, "
    "AI generated watermark, signature, logo, "
    "office, work badge, ID card, uniform, "
    "realistic photograph, photorealistic skin, hyper-realistic, Unreal Engine render, "
    "flat 2D cartoon, anime cel-shading, toon-shaded hard edges, "
    "clay, claymation, clay-like, stop-motion, plasticine, play-doh, "
    "fingerprint texture, rough pitted surface, porous material, "
    "low-poly, voxel, geometric abstraction, "
    "low quality, blurry, distorted, ugly, "
    "dark mood, horror, violent, scary"
)

NEGATIVE_BRANDED = (
    "text, letters, alphabet, words, characters, writing, "
    "Chinese characters, English words, numbers, digits, labels, "
    "any text on screen, any text on hologram, any text overlay, "
    "watermark, AI generated watermark, signature, logo with text, "
    "brand name text, hashtag, code, serial number, "
    "office, work badge, ID card, uniform, "
    "realistic photograph, 3D render, photorealistic skin, "
    "low quality, blurry, distorted, ugly, "
    "dark mood, horror, violent, scary, "
    "no text on character clothing, no distorted logos, "
    "no low-res brand elements, no photorealistic face, no 3D rendering"
)

NEGATIVE_BRANDED_3D = (
    "text, letters, alphabet, words, characters, writing, "
    "Chinese characters, English words, numbers, digits, labels, "
    "any text on screen, any text on hologram, any text overlay, "
    "watermark, AI generated watermark, signature, logo with text, "
    "brand name text, hashtag, code, serial number, "
    "office, work badge, ID card, uniform, "
    "realistic photograph, photorealistic skin, hyper-realistic, "
    "flat 2D cartoon, anime cel-shading, toon-shaded hard edges, "
    "clay, claymation, clay-like, stop-motion, plasticine, fingerprint texture, "
    "low quality, blurry, distorted, ugly, "
    "dark mood, horror, violent, scary, "
    "no text on character clothing, no distorted logos, "
    "no low-res brand elements"
)


# ════════════════════════════════════════════════════════════════
# 配色锚定（用自然语言，不用 hex）
# ════════════════════════════════════════════════════════════════

PALETTE = {
    "主色": "warm orange",
    "强调色": "sunlight yellow",
    "背景色": "gentle cream",
    "次要色": "soft amber",
    "辅助色": "sage green",
    "警示色": "warm coral red",
}


# ════════════════════════════════════════════════════════════════
# 7 个场景模板（从 vol001 提炼）
# ════════════════════════════════════════════════════════════════

SCENE_TEMPLATES = {
    "cover_impact": {
        "name": "封面冲击力（23→6 类）",
        "scene": (
            "standing in the foreground, holding up a small number of "
            "brightly colored highlighted items (use small filled circular badges with numbers), "
            "with many dimmed gray items being pushed aside into a pile in the background"
        ),
        "visual_elements": (
            "circular numbered badges, highlighted items vs dimmed items, "
            "arrow or motion lines suggesting transition"
        ),
        "mood": "'decluttering triumph, clarity from chaos'",
        "background": "warm sunflower field under bright sky",
        "lighting": "warm sunlight, dramatic backlight",
    },

    "judgment_under_scrutiny": {
        "name": "判断/审视（质疑 AI 类）",
        "scene": (
            "frowning at a glowing screen, "
            "holding a magnifying glass close to the screen, "
            "the magnifying glass reveals a small question mark with a red X mark"
        ),
        "visual_elements": (
            "magnifying glass, glowing screen, question mark icon, "
            "red X mark, comparison between two answer panels"
        ),
        "mood": "'critical thinking, judgment under scrutiny'",
        "background": "warm wooden desk with notebook and coffee cup",
        "lighting": "top light focused on the screen, soft side light",
    },

    "tidying_categories": {
        "name": "分类整理（4 区分类类）",
        "scene": (
            "standing behind a long table, gesturing with both hands "
            "as if organizing tools into categories"
        ),
        "visual_elements": (
            "table divided into 4 equal rectangular zones side by side, "
            "each zone has a small visual icon at the top center: "
            "speech bubble icon, gear icon, angle brackets icon, brain icon. "
            "Within each zone, 1-2 small squares are bright and colorful, others are dimmed gray. "
            "On the right side of the table: a pile of dimmed gray squares being pushed aside"
        ),
        "mood": "'tidying up from chaos to clarity'",
        "background": "warm sunflower field, soft sunlight",
        "lighting": "natural soft light from above",
    },

    "decision_crossroad": {
        "name": "选择岔路（判断 vs AI 类）",
        "scene": (
            "standing at a crossroads, one hand pointing confidently to one side, "
            "the other hand slightly hesitant, body language showing internal conflict"
        ),
        "visual_elements": (
            "two diverging paths: one leads to a glowing screen in the distance, "
            "the other leads to a warm sunflower field. "
            "No signposts, no text labels on the paths. "
            "Use visual contrast: cool tones for one path, warm tones for the other"
        ),
        "mood": "'decision moment, choice between delegation and judgment'",
        "background": "dusk sky with warm sunset gradient",
        "lighting": "45-degree side light, dramatic shadows",
    },

    "split_scene_24h": {
        "name": "双场景对比（白天 vs 夜晚类）",
        "scene": (
            "split screen composition — left half: outside under a tree using a phone, "
            "right half: at a desk with multiple glowing screens at night. "
            "The same character appears in both halves, showing different activities"
        ),
        "visual_elements": (
            "left side: phone, tree, sunny day. "
            "right side: laptop, desk lamp, night window. "
            "in the middle: a flowing yellow thread or gear connecting the two scenes, "
            "no text labels"
        ),
        "mood": "'24-hour continuous flow, work-life in harmony'",
        "background": "left: blue sky with white clouds. right: warm amber indoor night",
        "lighting": "left: natural sunlight. right: warm desk lamp glow",
    },

    "learning_path": {
        "name": "学习路径（4 阶段类）",
        "scene": (
            "walking with a small backpack on a winding path through "
            "a colorful landscape divided into 4 zones by color gradient"
        ),
        "visual_elements": (
            "4 zones with progressing color palette: pale to vivid, shallow to deep. "
            "Each zone marked by a visual icon (NOT text): question mark, "
            "small tool icons, gear, sunflower. "
            "Path winds from bottom-left to top-right"
        ),
        "mood": "'learning journey, progressive mastery'",
        "background": "gradient landscape with soft hills and sky",
        "lighting": "top light guiding the eye forward along the path",
    },

    "action_checklist": {
        "name": "行动清单（3 步行动类）",
        "scene": (
            "sitting at a tidy wooden desk, pen in hand, "
            "looking at an open spiral notebook with a gentle smile"
        ),
        "visual_elements": (
            "the notebook displays 3 small visual items in a row, "
            "each marked with a small filled circle with a number inside "
            "(1, 2, 3 as small glyphs on circular badges). "
            "Each item has a small green checkmark beside. "
            "On the desk: a steaming coffee cup on the right, "
            "a small sunflower in a vase on the left"
        ),
        "mood": "'ready to start, calm and clear'",
        "background": "blurred sunflower field through a window, soft indoor warmth",
        "lighting": "top light beam streaming in from window, casting soft shadows",
    },

    "character_with_real_brand": {
        "name": "角色+真实品牌组合（花眼小哥 × 品牌 Logo）",
        "scene": (
            "A cartoon character (花眼小哥: brown messy hair with one cowlick, "
            "round black-framed glasses, orange-yellow shirt, young male) stands "
            "in the foreground, pointing or presenting. Behind him, a photorealistic "
            "rendering of a corporate logo appears on a digital screen or floating "
            "hologram. The composition creates a bridge between the cartoon world "
            "and real-world technology. The brand logo is clearly visible and "
            "recognizable but rendered as if seen through a slightly stylized, "
            "warm-tinted lens."
        ),
        "visual_elements": (
            "digital screen or floating hologram displaying a purely graphical brand symbol "
            "with no text, no letters, no words, no numbers, just abstract shapes and colors, "
            "cartoon character pointing or presenting, warm glow around the screen, "
            "sunflower elements near the character, bridge-like visual flow "
            "between cartoon foreground and brand background, "
            "clean visual style, free of text overlay or numbering"
        ),
        "mood": "'curiosity and discovery, bridging two worlds'",
        "background": "warm sunflower field with golden-hour sky, "
                      "soft gradient from cartoon to photorealism",
        "lighting": "soft golden-hour lighting, warm glow from the hologram/screen",
    },

    "cta_interaction": {
        "name": "CTA 互动收尾（文末三连/关注引导）",
        "scene": (
            "popping out from a torn-paper hole in a warm cream background, "
            "waving one hand cheerfully toward the viewer, "
            "friendly open body language with a welcoming smile"
        ),
        "visual_elements": (
            "torn paper hole with ragged edges around the character, "
            "warm cream/beige background, character leaning forward slightly "
            "as if breaking through the fourth wall to engage directly with viewer"
        ),
        "mood": "'warm, friendly, engaging call-to-action moment'",
        "background": "solid warm cream color (#FDF6EC), torn-paper edge framing",
        "lighting": "soft even lighting from front, no harsh shadows",
    },
}


# ════════════════════════════════════════════════════════════════
# 核心：组装 prompt
# ════════════════════════════════════════════════════════════════

def _resolve_style(style_key: str) -> dict:
    """根据 character_style key 返回对应的 character / style 锚定词。

    Args:
        style_key: '2d' 或 '3d'（默认 '3d'）

    Returns:
        dict with keys: character (str), style (str)
    """
    key = style_key if style_key in CHARACTER_STYLES else _DEFAULT_STYLE
    return CHARACTER_STYLES[key]


def _resolve_negative(style_key: str = None) -> str:
    """根据形象风格返回对应负面词（3D 模式允许 3D render，禁止 2D flat）。"""
    if style_key == '3d':
        return NEGATIVE_3D
    return NEGATIVE


def build_prompt(
    scene: str,
    character_desc: str = None,
    visual_elements: Optional[str] = None,
    mood: Optional[str] = None,
    background: Optional[str] = None,
    lighting: Optional[str] = None,
    style: str = None,
    use_template: Optional[str] = None,
    character_style: str = _DEFAULT_STYLE,
) -> str:
    """组装完整的 Seedream prompt。

    使用方式 1（推荐）：use_template="cover_impact"，scene 参数会被模板的 scene 覆盖
    使用方式 2（自定义）：直接传 scene + visual_elements + mood + background + lighting
    使用方式 3（混搭）：use_template="cover_impact" 但 scene 自定义

    新增：character_style='2d'|'3d' 控制角色渲染维度。
      - '2d': 吉卜力二维插画风格（CHARACTER + STYLE）
      - '3d': 中国 3D 动画风格（CHARACTER_3D + STYLE_3D，默认）
    当 character_desc 或 style 显式传入时，优先使用显式值（不覆盖）。

    返回的 prompt 已包含 CHARACTER + 7 层结构 + STYLE，可以直接传给 Seedream。
    """
    template = SCENE_TEMPLATES.get(use_template) if use_template else None

    if template and not visual_elements:
        scene = template["scene"]
        visual_elements = template["visual_elements"]
        mood = template["mood"]
        background = template["background"]
        lighting = template["lighting"]

    # 解析形象风格锚定词（仅在未显式传入时使用默认值）
    style_cfg = _resolve_style(character_style)
    cd = character_desc or style_cfg['character']
    st = style or style_cfg['style']

    parts = [cd + "."]

    if scene:
        parts.append(f"Scene: {scene}.")

    if visual_elements:
        parts.append(f"Visual elements: {visual_elements}.")

    if mood:
        parts.append(f"Mood: {mood}.")

    if background:
        parts.append(f"Background: {background}.")

    if lighting:
        parts.append(f"Lighting: {lighting}.")

    parts.append(st)
    if _VS_PROMPT:
        parts.append(_VS_PROMPT)

    return " ".join(parts)


def get_negative(character_style: str = None) -> str:
    """返回通用负面词（根据形象风格自动切换）"""
    return _resolve_negative(character_style)


def get_negative_branded(character_style: str = None) -> str:
    """返回品牌混合场景专用负面词"""
    if character_style == '3d':
        return NEGATIVE_BRANDED_3D
    return NEGATIVE_BRANDED


def list_templates() -> List[str]:
    """列出所有可用场景模板的 key"""
    return list(SCENE_TEMPLATES.keys())


def get_template_meta(key: str) -> dict:
    """获取某个场景模板的元信息（用于文档/调试）"""
    return SCENE_TEMPLATES.get(key)


# ════════════════════════════════════════════════════════════════
# 工具函数
# ════════════════════════════════════════════════════════════════

def estimate_cost(num_images: int, cost_per_image: float = 0.5) -> float:
    """估算生图成本（元）"""
    return round(num_images * cost_per_image, 2)


# ════════════════════════════════════════════════════════════════
# CLI 调试
# ════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("🎨 花眼记提示词工厂 v1.0")
    print(f"\n可用场景模板 ({len(SCENE_TEMPLATES)} 个):")
    for key, tpl in SCENE_TEMPLATES.items():
        print(f"  - {key}: {tpl['name']}")

    print("\n示例：cover_impact 模板生成的 prompt：")
    print("─" * 60)
    print(build_prompt(scene="", use_template="cover_impact"))
    print("─" * 60)

    print("\n示例：自定义场景 prompt：")
    print("─" * 60)
    custom = build_prompt(
        scene="typing on a laptop in a cozy home office at golden hour",
        visual_elements="laptop with glowing screen, coffee mug, notebook, small potted succulent",
        mood="'focused flow state'",
        background="warm home office with wooden desk and bookshelf",
        lighting="warm golden hour light streaming through window",
    )
    print(custom)
    print("─" * 60)