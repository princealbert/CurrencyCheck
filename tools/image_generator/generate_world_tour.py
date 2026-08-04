#!/usr/bin/env python3
"""
《货币图鉴·对对碰》「环游世界」全收集结算 · 8 帧名胜图出图驱动（Seedream / 火山方舟）
===============================================================================
依赖：同目录 volcano_ark.py / base.py；后处理需 Pillow；量化需 pngquant（缺失自动跳过）
前置：必须设置环境变量 ARK_API_KEY

用法：
    export ARK_API_KEY="ark-xxxx"
    python3 generate_world_tour.py --dry-run        # 不调 API，只打印 8 帧 prompt/参数/落盘名 + 模型选择 + 配额 + 水印参数
    python3 generate_world_tour.py                  # 出全部 8 帧，逐帧候选数按 §B.9；按配额/优先级选 5.0 模型
    python3 generate_world_tour.py --only moai      # 只出第 7 帧（也接受 07 / worldtour_07_moai）
    python3 generate_world_tour.py --only moai --candidates 8 --seed 12345
    python3 generate_world_tour.py --install        # 出完后复制到 minigame/assets/remote/worldtour/
    python3 generate_world_tour.py --clean-existing # 对已落盘 worldtour/*.png 重做去水印（零 API 成本）

模型与配额（2026-08-03 起）：
   4.5 当日免费已用满（落盘 8 帧），不再使用；扩展 5.0 两模型，优先级 5.0-pro → 5.0-lite → 4.5。
   每个模型每天 20 张免费额度，持久化到 .quota_state.json（原子落盘）；
   每次请求前选优先级最高且能放下本次 num_images 张的模型，请求成功 used += num_images（按「图」计，非按请求）；
   全部放不下则报错退出，绝不裸调付费额度。
   Seedream 出图右下角「AI生成」平台水印：出图管线与 --clean-existing 均按方案 A 柔边填充去除（先去水印再 pngquant）。

规格来源：design/art/world-tour-assets.md
    §B   逐帧中文 prompt + 禁止项（本文件内的字符串**由脚本从该文档逐字提取生成**，勿手改）
    §B.9 逐帧参数：candidates / detail_level / guidance_scale 三项**逐帧不同**
    §C.2 9:16 直出 1440×2560 → 等比 Lanczos 缩放到 1080×1920，**不裁切**
    §C.3 命名铁律 worldtour_<两位序号>_<slug>.png，序号即播放顺序
    §C.5 postprocess 只缩放；flatten 底色 #1A1614；pngquant --quality 70-90

与 generate_scene_backgrounds.py 的三处**刻意不同**（都不是疏漏）：
  1) 不调 cover_crop —— 9:16 直出与 1080×1920 比例完全一致，裁切纯属损失（§C.5）
  2) flatten 底色由奶油 #F8F5F0 换成暖黑 #1A1614 —— 本批是暗底影片帧（§A.2）
  3) 候选**全部落盘**而非只留第 1 张 —— 本批 3/6/7 帧要 6 候选正是为了人工挑，
     参考脚本 `results[0]` 的写法会把另外 5 张（已付费）直接扔掉。
     产物：worldtour_07_moai.png（= 候选 1，可直接用）+ candidates/worldtour_07_moai_c2..c6.png

合规（§F / world-tour-reward §6）：8 帧均为文化 / 自然地标，无真实钞币、无国旗国徽、
无人物人脸、无文字落款；帧 7 摩艾朝向按史实（背对海，仅一尊侧转面海）为硬约束。
"""
import os
import sys
import json
import shutil
import argparse
import subprocess
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from volcano_ark import (  # noqa: E402
    VolcanoArkGenerator,
    SEEDREAM_45,
    SEEDREAM_50_PRO,
    SEEDREAM_50_LITE,
    BATCH_CAPABLE,
)

# ============ Pillow（后处理 / 去水印必需）============
# 缺失时给出清晰安装指引，而不是让整个脚本在 import 阶段崩溃。
try:
    from PIL import Image, ImageFilter, ImageDraw
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False
    Image = ImageFilter = ImageDraw = None

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
# 本地预览目录（§C.4）。build.mjs 已把 assets/remote/ 从 wx 主包排除，上线走 CDN。
INSTALL_DIR = REPO_ROOT / "minigame" / "assets" / "remote" / "worldtour"

SIZE_MAP = {"wt": "9:16"}        # Seedream 直出 1440×2560
TARGET = {"wt": (1080, 1920)}    # 落盘尺寸（等比，零裁切）
STYLE_STRENGTH = 8               # §B.9 全批统一
FLATTEN_BG = (0x1A, 0x16, 0x14)  # §A.2 暖黑底
PNGQUANT_QUALITY = "70-90"       # §C.2
SIZE_BUDGET_KB = 450             # §C.2 单帧体积门槛
TOTAL_BUDGET_KB = 3277           # §C.2 8 帧合计 ≤ 3.2 MB

# ============ 模型优先级（先进优先）============
# 5.0-pro → 5.0-lite → 4.5。4.5 当日免费已用满（落盘 8 帧），自动跳过。
MODEL_PRIORITY = [SEEDREAM_50_PRO, SEEDREAM_50_LITE, SEEDREAM_45]

# ============ 每日配额（核心）============
# 每个模型每天 20 张免费额度；状态持久化到 .quota_state.json。
# 结构: { "YYYY-MM-DD": { "<model_id>": <used_int> } }（系统日期取本地时区）
QUOTA_STATE_PATH = SCRIPT_DIR / ".quota_state.json"
DAILY_LIMIT = 20
# 初始化「今日」计数时对各模型的播种值：
#   4.5 已用满 → 置 20（需求硬性要求，使其自动落到 5.0，绝不裸调 4.5 付费额度）；
#   5.0-pro / 5.0-lite 置 1 → 保守反映本次「轻量探测」各消耗 1 单位免费额度，
#   使管理器不误判剩余额度而越界触发付费（核心原则：绝不裸调付费额度）。
#   若今日某模型已存在记录（非首次运行），则保留其实测值，不覆盖。
QUOTA_SEED = {SEEDREAM_45: 20, SEEDREAM_50_PRO: 1, SEEDREAM_50_LITE: 1}

# ============ 水印去除（方案 A：柔边填充覆盖）============
# Seedream 出图右下角带「AI生成」平台水印，游戏产物不能留。
# 固定比例定位右下角包围盒（基准 1080×1920 → 约 160×70），外扩余量确保完整包住；
# 用 L0 暖黑 #1A1614 + 底部采样均值做填充，高斯模糊 feather 柔边，避免硬矩形穿帮。
# 去水印在 pngquant 压缩之前执行（先去水印再压缩，避免压缩放大水印边缘）。
WM_RATIO_W = 160 / 1080.0     # 水印宽 / 图宽
WM_RATIO_H = 70 / 1920.0      # 水印高 / 图高
WM_MARGIN = 16 / 1080.0       # 额外外扩（图宽比例），避免漏包
WM_FEATHER_RATIO = 0.12       # feather 半径占水印宽比例

# ============ §B.0.2 负向基线（8 帧逐字复用）============
NEG_BASE_WT = (
            "写实照片，摄影，超写实，真实光影，3D 渲染，景深虚化，镜头光晕，光斑，"
            "真实钞票，硬币，钱币，货币符号，金钱元素，"
            "国旗，国徽，政治建筑，军事元素，武器，"
            "人物，人脸，人物特写，五官，人群，人手，"
            "文字，字母，数字，标题，落款，印章，签名，水印，logo，边框，"
            "杂乱细节，密集纹理，噪点，高饱和荧光色，纯白，纯黑，"
            "photorealistic, photograph, realistic, hyperrealistic, 3d render, depth of field, lens flare,"
            "banknote, coin, currency, money, flag, national emblem, human face, people, hands,"
            "text, letters, numbers, watermark, signature, stamp, logo, frame, border,"
            "busy clutter, noise grain, oversaturated"
)

# ============ §B.1–B.8 八帧表（序号即播放顺序，勿按字母序重排）============
FRAMES = [
    dict(
        no=1, slug="fuji", region="asia_afr", title="日本·富士山",
        # §B.1 中文主 prompt（自 design/art/world-tour-assets.md 逐字提取，勿手改）
        prompt=(
            "浮世绘风格化平涂插画，三层剪影构图。前景是几何化的北斋式浪纹，浪头化为规整的弧形与卷曲纯色块，"
            "只取轮廓，不画水花与泡沫细节；中景是一两枝极简樱枝，从画面一侧斜伸入画，花朵化为均匀的圆点笔触；"
            "远景是单色平涂的富士山体，山顶用留白表示积雪，山体一整块平涂不做任何渐变；"
            "天空为一整块平涂色，可有一道极简的水平云带。"
            "整幅只用三个主色加一个点缀色：雾青（山体与远景）、暖米白（雪顶留白与天空）、深墨青（前景浪纹），"
            "点缀色为柔粉（樱花）。构图重心落在画面中上部，画面下方五分之二为浪纹的低对比度暗色延展区，"
            "安静、无高光斑、无高频细节。"
            "扁平平涂，几何化造型，矢量感干净边缘，大色块，单色平涂不做写实渐变，柔和环境光，"
            "旅行手账明信片质感，游戏美术资产，竖构图 9:16。"
        ),
        # 禁止项 = NEG_BASE_WT + 本帧增补（同上，逐字提取）
        neg_extra=(
            "，无写实海浪，无浪花泡沫，无真实富士山照片，无船只，无神社，无鸟居，无灯笼，"
            "无日文字符，无假名，无汉字，无红色落款印章，无浮世绘题跋，无人物"
        ),
        candidates=4, detail_level=6, guidance_scale=7.5,
        note="浪纹需结构层次",
    ),
    dict(
        no=2, slug="greatwall", region="asia_afr", title="中国·长城",
        # §B.2 中文主 prompt（自 design/art/world-tour-assets.md 逐字提取，勿手改）
        prompt=(
            "水墨风格化平涂插画。山脊用淡墨横扫的平涂色块表现，由近及远三到四层，层与层之间用留白雾气隔断，"
            "越远的一层越淡，最远一层淡到近乎留白；长城化为沿山脊起伏延伸的等距梯形序列，"
            "垛口为规整的阶梯状矩形错位，只取轮廓剪影，不画砖石纹理、不画瓦片、不画台阶细节；"
            "城墙线在画面中部形成一条清晰的横向走势。"
            "整幅只用三个主色加一个点缀色：淡墨灰（远山）、雾白（雾气与留白）、苔绿（近景山体），"
            "点缀色为暖赭（城墙线）。构图重心落在画面中部偏上，画面下方五分之二为最近一层山体的"
            "低对比度暗色延展区，安静、无高频细节。"
            "扁平平涂，几何化造型，矢量感干净边缘，大色块，单色平涂不做写实渐变，柔和环境光，"
            "旅行手账明信片质感，游戏美术资产，竖构图 9:16。"
        ),
        # 禁止项 = NEG_BASE_WT + 本帧增补（同上，逐字提取）
        neg_extra=(
            "，无砖石纹理，无瓦片，无写实城墙照片，无游客，无人物，无汉字，无书法，无红色印章落款，"
            "无国旗，无旗帜，无烽火台旗杆，无城楼牌匾，无现代建筑，无电线"
        ),
        candidates=4, detail_level=6, guidance_scale=7.5,
        note="水墨层次需细节余量",
    ),
    dict(
        no=3, slug="kilimanjaro", region="asia_afr", title="坦桑尼亚·乞力马扎罗",
        # §B.3 中文主 prompt（自 design/art/world-tour-assets.md 逐字提取，勿手改）
        prompt=(
            "水彩大色块风格化插画，横向三段式构图。底部是偏深的暖赭色平涂草原，整体压暗，"
            "不要明亮的金黄色，只用一两道更深的色带暗示地势起伏；中部是二到三棵金合欢树的伞形剪影，"
            "树冠化为扁平的半椭圆几何色块，树干为极细的直线，树与树之间拉开距离；"
            "顶部是乞力马扎罗宽缓的山体，山肩用一整块冷白平涂表示常年不化的雪冠，"
            "山体与天空之间留一道浅色雾带把远近隔开。画面中完全没有任何动物。"
            "整幅只用三个主色加一个点缀色：偏深暖赭（草原）、深橄榄（树冠剪影）、冷白（雪冠），"
            "点缀色为淡金（天光）。构图重心落在画面中上部的山体与树冠，"
            "画面下方五分之二为草原的低对比度延展区，安静、无高光斑、无高频细节、无草叶纹理。"
            "扁平平涂，几何化造型，矢量感干净边缘，大色块，水彩边缘柔和但不做写实渐变，柔和环境光，"
            "旅行手账明信片质感，游戏美术资产，竖构图 9:16。"
        ),
        # 禁止项 = NEG_BASE_WT + 本帧增补（同上，逐字提取）
        neg_extra=(
            "，无动物，无长颈鹿，无大象，无斑马，无狮子，无羚羊，无犀牛，无鸟，无兽群，无剪影动物，"
            "无人物，无部落，无吉普车，无帐篷，无写实草原照片，无草叶细节，无明亮金黄草原"
        ),
        candidates=6, detail_level=5, guidance_scale=8,
        note="零动物 = 强减法约束",
    ),
    dict(
        no=4, slug="santorini", region="euro", title="希腊·圣托里尼",
        # §B.4 中文主 prompt（自 design/art/world-tour-assets.md 逐字提取，勿手改）
        prompt=(
            "纯几何构成的风格化平涂插画。白色半圆穹顶、白色矩形墙体、深靛蓝色弧形屋顶，"
            "三种几何元素阶梯状错落排布在一条向画面一侧向下延伸的悬崖曲线上，"
            "只取体块与轮廓，不画窗格、不画门、不画栏杆、不画台阶扶手等任何细节；"
            "悬崖为一整块暖灰平涂；画面下方是单色平涂的深靛蓝海面，海天之间一条清晰干净的水平分界线；"
            "天空为一整块浅色平涂，天空中不放任何元素。"
            "整幅只用三个主色加一个点缀色：暖白（墙体与穹顶）、深靛蓝（弧顶与海面）、暖灰（悬崖），"
            "点缀色为浅赭（阶梯与错落处的暗面）。构图重心落在画面中部的建筑群，"
            "画面下方五分之二为海面的低对比度延展区，安静、无波光、无高光斑、无水纹。"
            "扁平平涂，几何化造型，矢量感干净边缘，大色块，单色平涂不做写实渐变，柔和环境光，"
            "旅行手账明信片质感，游戏美术资产，竖构图 9:16。"
        ),
        # 禁止项 = NEG_BASE_WT + 本帧增补（同上，逐字提取）
        neg_extra=(
            "，无人物，无游客，无写实建筑照片，无窗格，无门窗细节，无栏杆，无花草，无盆栽，无九重葛，"
            "无十字架，无宗教符号，无钟楼十字，无船只，无海浪泡沫，无水面反光，无希腊文字，无风车"
        ),
        candidates=4, detail_level=5, guidance_scale=7.5,
        note="纯白墙体，注意亮度门",
    ),
    dict(
        no=5, slug="landwasser", region="euro", title="瑞士·Landwasser 高架桥",
        # §B.5 中文主 prompt（自 design/art/world-tour-assets.md 逐字提取，勿手改）
        prompt=(
            "冷调几何构成的风格化平涂插画。画面主体是瑞士 Landwasser 高架桥：一座由多个等距石拱组成的浅灰青色铁路高架桥，"
            "从画面左侧山崖水平延伸至右侧，桥墩垂直落入深谷；一列极简的红色冰川列车正行驶在桥上，只取车厢轮廓，不画车窗细节。"
            "桥的后方与下方弥漫着冷调云雾，远处露出两到三座覆雪山峰的钝角剪影，山形浑圆、有积雪覆盖，不呈尖锐三角。"
            "天空为一整块冷调浅色平涂。"
            "整幅只用三个主色加一个点缀色：雾蓝灰（桥体与远山）、冷白（云雾与雪）、淡青（天空与深谷），"
            "点缀色为暖红（列车）。构图重心落在画面中部的桥与列车，画面下方五分之二为云雾与深谷的低对比度暗色延展区，"
            "安静、无高频细节、无岩石纹理。"
            "扁平平涂，几何化造型，矢量感干净边缘，大色块，单色平涂不做写实渐变，柔和环境光，"
            "旅行手账明信片质感，游戏美术资产，竖构图 9:16。"
        ),
        # 禁止项 = NEG_BASE_WT + 本帧增补（同上，逐字提取）
        neg_extra=(
            "，无金字塔，无埃及式三角几何体，无三角形纪念碑，无真实桥梁照片，无砖石纹理，"
            "无铁轨枕木，无车窗细节，无人物，无瑞士十字，无镜头光晕，无太阳光束"
        ),
        candidates=5, detail_level=5, guidance_scale=7.5,
        note="桥拱等距 + 红色列车醒目",
    ),
    dict(
        no=6, slug="xochimilco", region="amer", title="墨西哥·霍奇米尔科水乡",
        # §B.6 中文主 prompt（自 design/art/world-tour-assets.md 逐字提取，勿手改）
        prompt=(
            "俯视视角的几何构成风格化平涂插画，没有透视灭点，完全平面化。"
            "水道把画面切成规整的矩形网格，水面为单色平涂的深青绿；网格之间是一块块浮田，"
            "每块浮田为一整块比水道明度更高的草绿平涂，边缘用一道更深的绿线勾出；"
            "水道中散布四到五只细长的彩色长条，代表花船，只用纯色块表示，"
            "不画船身细节、不画顶棚、不画花朵、不画船夫；少量浮田上有极简的圆点排列表示植株。"
            "整幅只用三个主色加一个点缀色：深青绿（水道）、草绿（浮田）、暖赭（田埂），"
            "点缀色为陶土红与暖黄（花船，仅两三处小面积）。构图重心落在画面中部的网格交汇处，"
            "画面下方五分之二为水道网格的低对比度延展区，安静、无水面反光、无高光斑、无高频细节。"
            "扁平平涂，几何化造型，矢量感干净边缘，大色块，单色平涂不做写实渐变，柔和环境光，"
            "旅行手账明信片质感，游戏美术资产，竖构图 9:16。"
        ),
        # 禁止项 = NEG_BASE_WT + 本帧增补（同上，逐字提取）
        neg_extra=(
            "，无人物，无船夫，无游客，无写实航拍照片，无卫星图，无水面倒影，无波纹，无花卉细节，"
            "无建筑，无房屋，无墨西哥文字，无骷髅图案，无亡灵节元素，无万寿菊花环，无阿兹特克纹样，"
            "无高饱和荧光绿"
        ),
        candidates=6, detail_level=5, guidance_scale=7.5,
        note="三重减法约束",
    ),
    dict(
        no=7, slug="moai", region="amer", title="智利·复活节岛摩艾",
        # §B.7 中文主 prompt（自 design/art/world-tour-assets.md 逐字提取，勿手改）
        prompt=(
            "侧逆光剪影风格化平涂插画。画面中景偏下有一列四到五尊摩艾石像，立在一道低矮的长条石台上，"
            "所有石像都背对身后的海平线、正面朝向画面外的内陆方向，海平线在石像身后并被石像遮挡；"
            "只有最右侧的一尊侧转九十度，侧影望向身后的海。"
            "所有石像一律为一整块深色剪影，不刻五官、不画眼睛、不画嘴、不画表情、不画身体纹样，"
            "只保留头部与肩部轮廓的方正转折。海平线为一道清晰的水平线，海面为单色平涂。"
            "天空占据画面上半部，用二到三段暖橙色水平色带表示天光层次，段与段之间边界柔和，"
            "不做写实渐变，天空中不放太阳圆盘、不放云。"
            "整幅只用三个主色加一个点缀色：暖橙（天空）、深褐黑（石像与石台剪影）、暗蓝紫（海面），"
            "点缀色为淡金（天际线一线）。构图重心落在画面中部的石像队列，"
            "画面下方五分之二为石台与前景地面的低对比度暗色延展区，安静、无高频细节、无草地纹理。"
            "扁平平涂，几何化造型，矢量感干净边缘，大色块，单色平涂不做写实渐变，柔和环境光，"
            "旅行手账明信片质感，游戏美术资产，竖构图 9:16。"
        ),
        # 禁止项 = NEG_BASE_WT + 本帧增补（同上，逐字提取）
        neg_extra=(
            "，石像不得面朝海面，不得只见背影，不得背对观者，"
            "无五官，无眼睛，无嘴，无鼻孔，无表情，无面部高光，无雕刻纹路，"
            "无人物，无游客，无写实照片，无岩石纹理，无草地细节，无太阳圆盘，无光晕，无云，"
            "无写实渐变天空，无红帽子普卡奥细节"
        ),
        candidates=6, detail_level=4, guidance_scale=8,
        note="朝向为史实硬约束，最高废片率",
    ),
    dict(
        no=8, slug="whale", region="amer", title="阿根廷·瓦尔德斯半岛的鲸",
        # §B.8 中文主 prompt（自 design/art/world-tour-assets.md 逐字提取，勿手改）
        prompt=(
            "极简风格化平涂插画，整幅画面极度安静。画面大部分是一整块深蓝色平涂的海面，"
            "海平线位于画面上方三分之一处，海平线以上的天空为一整块比海面略浅的雾蓝平涂，"
            "天空中不放任何元素，没有云、没有太阳、没有鸟。"
            "海面中偏上的位置有一道弧形的鲸背破水而出，鲸背为一整条平滑的深色弧形色块，"
            "弧形的一侧接一片简化的三角形尾鳍；破水交界处的水花用五到八个大小不等的圆点组成的"
            "几何点阵表示，不画泡沫、不画水纹、不画飞溅。"
            "整幅画面严格只用三种颜色：深蓝（海面）、浅雾蓝（天空）、近黑的深蓝（鲸背与尾鳍剪影），"
            "不加任何第四种点缀色。构图重心落在画面中上部的鲸背，"
            "画面下方五分之二为空旷的海面，是完全留白式的低对比度延展区，"
            "安静、无波纹、无高光、无任何元素。"
            "扁平平涂，几何化造型，矢量感干净边缘，大色块，单色平涂不做写实渐变，柔和环境光，"
            "旅行手账明信片质感，游戏美术资产，竖构图 9:16。"
        ),
        # 禁止项 = NEG_BASE_WT + 本帧增补（同上，逐字提取）
        neg_extra=(
            "，无写实鲸鱼，无鲸鱼皮肤细节，无藤壶，无眼睛，无喷水柱，无水柱，无飞溅浪花，无泡沫，"
            "无船只，无小艇，无海鸥，无飞鸟，无人物，无观鲸者，无海岸线，无岩石，无水面反光，"
            "无云，无太阳，无第四种颜色，无点缀色"
        ),
        candidates=4, detail_level=4, guidance_scale=7.5,
        note="全片最安静，不可砍",
    ),
]


def frame_key(f: dict) -> str:
    """落盘主名（不含扩展名）。§C.3 铁律：两位补零 + 序号即播放顺序。"""
    return f"worldtour_{f['no']:02d}_{f['slug']}"


def build_negative(f: dict) -> str:
    """禁止项 = NEG_BASE_WT 逐字复用 + 本帧增补（增补串自带前导「，」）。"""
    return f"{NEG_BASE_WT}{f['neg_extra']}"


def resolve_only(token: str):
    """--only 宽松匹配：slug / 两位序号 / 序号 / 完整文件名，四种都认。"""
    t = token.strip().lower().removesuffix(".png")
    for f in FRAMES:
        if t in {f["slug"], f"{f['no']:02d}", str(f["no"]), frame_key(f)}:
            return f
    return None


def scale_only(im, tw: int, th: int):
    """
    等比 Lanczos 缩放到 (tw, th)，**不裁切**（§C.5）。
    直出 1440×2560 与 1080×1920 比例完全一致，正常路径下是纯等比缩放；
    万一模型给了别的比例（历史上出现过），这里退化为 contain + 暖黑补边，
    宁可留边也不裁 —— 本批构图重心贴着中央 70%，裁切会直接吃掉主体。
    """
    w, h = im.size
    if (w, h) == (tw, th):
        return im
    scale = min(tw / w, th / h)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    im = im.resize((nw, nh), Image.LANCZOS)
    if (nw, nh) == (tw, th):
        return im
    canvas = Image.new("RGB", (tw, th), FLATTEN_BG)
    canvas.paste(im, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def flatten_on_ink(im):
    """
    若有透明通道 → 合成到暖黑底 #1A1614（§C.5：底色换成本批的 L0 底，不是奶油底）。
    用 L0 同色而非黑：万一直出带了半透明边，合成结果与运行时 L0 底完全一致，不会显出接缝。
    """
    if im.mode != "RGBA":
        return im.convert("RGB")
    bg = Image.new("RGB", im.size, FLATTEN_BG)
    bg.paste(im, mask=im.split()[3])
    return bg


def postprocess(im):
    """§C.5：只做 flatten + 等比缩放，**不调 cover_crop**。落盘不透明 RGB。"""
    tw, th = TARGET["wt"]
    return scale_only(flatten_on_ink(im), tw, th)


def quantize(path: Path) -> bool:
    """
    pngquant --quality 70-90 就地量化（§C.2）。
    未安装 pngquant 时**跳过而不失败** —— 图本身已经可用，量化只影响体积；
    在没装工具的机器上因为这一步整批失败是不可接受的。
    """
    exe = shutil.which("pngquant")
    if not exe:
        return False
    try:
        subprocess.run(
            [exe, "--force", "--skip-if-larger", "--strip",
             "--quality", PNGQUANT_QUALITY, "--output", str(path), "--", str(path)],
            check=True, capture_output=True, timeout=120,
        )
        return True
    except subprocess.CalledProcessError as e:
        # 退出码 99 = 达不到质量下限，pngquant 保留原图，属正常跳过
        if e.returncode != 99:
            print(f"    ⚠ pngquant 失败（{e.returncode}），保留未量化 PNG")
        return False
    except Exception as e:
        print(f"    ⚠ pngquant 异常（{e}），保留未量化 PNG")
        return False


def download(url: str, path: Path):
    import urllib.request
    path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "worldtour-gen/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        path.write_bytes(r.read())


def kb(path: Path) -> int:
    return (path.stat().st_size + 512) // 1024


# ===================== 每日配额管理（核心）=====================
class QuotaExhausted(Exception):
    """当日所有模型免费额度已满，停止以避免触发付费额度。"""


def today_key() -> str:
    """系统日期（本地时区）YYYY-MM-DD。"""
    return date.today().isoformat()


def load_quota_state() -> dict:
    """读取配额状态；文件不存在或损坏则回落空 dict。"""
    if QUOTA_STATE_PATH.exists():
        try:
            return json.loads(QUOTA_STATE_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            print(f"  ⚠ 配额状态文件损坏，重建：{QUOTA_STATE_PATH}")
    return {}


def save_quota_state_atomic(state: dict):
    """
    原子落盘：先写同目录临时文件再 os.replace（rename 原子替换），
    防并发/中断损坏 —— 中途崩溃最多留下一个 .tmp，不会写坏主文件。
    """
    tmp = QUOTA_STATE_PATH.with_suffix(QUOTA_STATE_PATH.suffix + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, QUOTA_STATE_PATH)


def ensure_today_seed(state: dict) -> bool:
    """
    初始化「今日」计数：保证今日键存在，并对缺失的模型按 QUOTA_SEED 播种。
    返回是否发生了写入（调用方据此决定是否落盘）。
    已存在的模型计数一律保留，不覆盖实测值。
    """
    today = today_key()
    day = state.setdefault(today, {})
    changed = False
    for model, seed_val in QUOTA_SEED.items():
        if model not in day:
            day[model] = seed_val
            changed = True
    return changed


def select_model(state: dict, num_images: int = 1) -> str | None:
    """
    选「优先级最高且当日 used + num_images ≤ 20」的模型；全部放不下则返回 None。
    配额按「图」计（一次请求出 num_images 张），故需预留整批空间，避免越界触发付费。
    优先级：MODEL_PRIORITY（5.0-pro → 5.0-lite → 4.5）。
    """
    today = today_key()
    day = state.get(today, {})
    for model in MODEL_PRIORITY:
        if day.get(model, 0) + num_images <= DAILY_LIMIT:
            return model
    return None


def increment_used(state: dict, model: str, num_images: int):
    """请求成功：used += 本次图数(num_images)，并原子落盘。配额按「图」计。"""
    today = today_key()
    day = state.setdefault(today, {})
    day[model] = day.get(model, 0) + num_images
    save_quota_state_atomic(state)


def simulate_allocation(state: dict, frames, candidates_fn):
    """
    dry-run 用：在不改动真实状态的前提下，模拟按「图」配额走完 frames，
    返回 (每帧所选模型列表, 停止原因)。用于展示优先级与边界，不落盘。
    """
    today = today_key()
    sim = {today: dict(state.get(today, {}))}  # 复制今日计数，避免污染真实状态
    plan, stop = [], None
    for f in frames:
        c = candidates_fn(f)
        m = select_model(sim, c)
        if m is None:
            stop = (f, c)
            break
        sim[today][m] = sim[today].get(m, 0) + c
        plan.append((f, m, c))
    return plan, stop


# ===================== 水印去除（方案 A：柔边填充）=====================
def watermark_bbox(w: int, h: int):
    """右下角水印包围盒（含外扩余量）与 feather 半径。固定比例，基于 1080×1920。"""
    bw = int(round(w * WM_RATIO_W)) + int(round(w * WM_MARGIN))
    bh = int(round(h * WM_RATIO_H)) + int(round(h * WM_MARGIN))
    x0 = max(0, w - bw)
    y0 = max(0, h - bh)
    feather = max(3, int(round(bw * WM_FEATHER_RATIO)))
    return (x0, y0, w, h), feather


def _sample_fill_color(im) -> tuple:
    """
    取底部、且避开右下角水印的区域的均值作为填充基准色（≈ L0 暖黑延展区）。
    与本批「画面下方五分之二为低对比度暗色延展区」一致，填充后不穿帮。
    再与 L0 暖黑混合，保证偏暗、稳妥。
    """
    w, h = im.size
    region = im.crop((0, int(h * 0.86), int(w * 0.6), h)).convert("RGB")
    mean = tuple(int(c) for c in region.resize((1, 1)).getpixel((0, 0)))
    return tuple((a + b) // 2 for a, b in zip(FLATTEN_BG, mean))


def remove_watermark(im):
    """
    去除 Seedream 出图右下角「AI生成」平台水印（方案 A）。
    固定比例定位右下角包围盒 → 建硬 mask → 高斯模糊得到 feather 柔边 →
    用 L0 暖黑 + 底部采样均值做整块填充，按 feather mask 合成，避免硬矩形穿帮。
    """
    if not HAVE_PIL:
        raise RuntimeError(
            "去水印需要 Pillow，但本机未安装。\n"
            "请先安装：  pip install Pillow\n"
            "（仅去水印/后处理需要；出图主体逻辑不依赖它。）"
        )
    w, h = im.size
    (x0, y0, x1, y1), feather = watermark_bbox(w, h)
    fill = _sample_fill_color(im)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rectangle([x0, y0, x1, y1], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather))  # 柔边 feather
    layer = Image.new("RGB", (w, h), fill)
    out = Image.composite(layer, im.convert("RGB"), mask)
    return out


def clean_existing(install_dir: Path):
    """对已落盘 PNG 重做去水印（零 API 成本）。就地覆盖 + 重新 pngquant。"""
    if not HAVE_PIL:
        print("❌ 去水印需要 Pillow：pip install Pillow")
        sys.exit(1)
    if not install_dir.exists():
        print(f"❌ 目录不存在：{install_dir}")
        sys.exit(2)
    pngs = sorted(p for p in install_dir.glob("*.png") if p.name != ".keep")
    if not pngs:
        print(f"无 PNG 可处理：{install_dir}")
        return
    print(f"— --clean-existing：对 {len(pngs)} 张已落盘 PNG 重做去水印（零 API 成本）—\n")
    for p in pngs:
        im = remove_watermark(Image.open(p).convert("RGB"))
        im.save(str(p), "PNG")
        q = quantize(p)
        print(f"  ✅ 去水印 {p.name}  {im.size[0]}×{im.size[1]}  "
              f"{kb(p)}KB{'（已量化）' if q else ''}")


def render_one(gen, f: dict, out_dir: Path, candidates: int, seed, model: str, state: dict):
    """出一帧：候选全部落盘，候选 1 用主名，其余进 candidates/ 供人工换选。
    model：本次请求使用的模型 id（按配额/优先级选出）。
    state：配额状态 dict（用于「按图计」扣减，避免越界触发付费）。

    关于 candidates 与多图（Bug 1 修复点）：
        4.5 的 images 接口支持单次 n 张；但 5.0 端点实测「不遵守 n」——
        请求 num_images=5 只回 1 张（volcano_ark.py 不动，故在此补齐）。
        因此先按 candidates 请求一次，若返回不足，再继续以 num_images=1
        逐张补齐，直到拿满 candidates 张或 API 不再出图。
        每张成功图按「图」计扣减 1 单位配额（先按实际返回，绝不预扣/超扣）。
    """
    key = frame_key(f)
    urls: list = []
    first: list = []

    def _grab(batch):
        """把一批 ImageResult 中成功的图 URL 收进 urls，返回本次实际收到的张数。"""
        n = 0
        for r in batch:
            if getattr(r, "success", False) and getattr(r, "image_url", None):
                urls.append(r.image_url)
                n += 1
        return n

    # 首次：仅批处理模型（4.5）尽量一次拿全；5.0 不支持批处理且 n>1 易超时，
    # 直接走下方 while 循环逐张 n=1 请求。
    if model in BATCH_CAPABLE:
        first = gen.generate(
            f["prompt"],
            negative_prompt=build_negative(f),
            size=SIZE_MAP["wt"],
            num_images=candidates,
            seed=seed,
            watermark=False,
            style_strength=STYLE_STRENGTH,
            detail_level=f["detail_level"],
            guidance_scale=f["guidance_scale"],
            model=model,
            # optimize_prompt_mode 刻意不传（§B.9）：平台改写会静默丢掉本批的高密度约束，
            # 尤其帧 7 的朝向与帧 3 的零动物 —— 丢了不报错，等于白出。
        )
        _grab(first)
    # 补齐：5.0 不遵守 n 时，逐张请求直到拿满 candidates（或 API 不再出图）
    while len(urls) < candidates:
        more = gen.generate(
            f["prompt"],
            negative_prompt=build_negative(f),
            size=SIZE_MAP["wt"],
            num_images=1,
            seed=seed,
            watermark=False,
            style_strength=STYLE_STRENGTH,
            detail_level=f["detail_level"],
            guidance_scale=f["guidance_scale"],
            model=model,
        )
        if not more or not getattr(more[0], "success", False) or not getattr(more[0], "image_url", None):
            break
        if _grab(more) == 0:
            break

    if not urls:
        msg = (first[0].error_message
               if (first and not getattr(first[0], "success", True)) else "无返回数据")
        print(f"  ❌ 失败：{msg}")
        return None

    # 按图计扣减：实际拿到几张就记几张（main 已用 select_model(candidates) 预留额度，
    # 此处不会超扣；若 API 给不满则按实际数记，绝不为没拿到的图付费）
    increment_used(state, model, len(urls))

    saved = []
    for i, url in enumerate(urls, start=1):
        # 候选 1 用主名（可直接进游戏），其余进 candidates/ 供人工换选 —— 命名带序号，互不覆盖
        dest = out_dir / f"{key}.png" if i == 1 else out_dir / "candidates" / f"{key}_c{i}.png"
        tmp = out_dir / f".{key}_c{i}.raw"
        try:
            download(url, tmp)
            im = remove_watermark(postprocess(Image.open(tmp).convert("RGBA")))
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.save(str(dest), "PNG")
        finally:
            tmp.unlink(missing_ok=True)
        q = quantize(dest)  # pngquant 压缩（缺失则跳过，不失败）
        size = kb(dest)
        flag = "" if size <= SIZE_BUDGET_KB else f"  ⚠ 超单帧体积门槛 {SIZE_BUDGET_KB}KB"
        tag = "主选" if i == 1 else f"候选{i}"
        print(f"  ✅ {tag}  {dest.relative_to(out_dir)}  {im.size[0]}×{im.size[1]}  "
              f"{size}KB{'（已量化）' if q else ''}{flag}")
        saved.append(dest)

    if len(saved) < candidates:
        print(f"  ⚠ 仅拿到 {len(saved)}/{candidates} 张候选（API 未给满，已按实际落盘，未超扣配额）")
    return saved


def main():
    ap = argparse.ArgumentParser(
        description="「环游世界」8 帧名胜图出图（规格见 design/art/world-tour-assets.md）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="逐帧候选数/细节度/文本权重已按 §B.9 内置，--candidates 仅在需要覆盖时使用。",
    )
    ap.add_argument("--only", default=None,
                    help="只出指定帧：slug / 序号 / 两位序号 / 文件名，如 --only moai | 7 | 07 | worldtour_07_moai")
    ap.add_argument("--candidates", type=int, default=None,
                    help="覆盖逐帧候选数（默认按 §B.9：帧 3/6/7 为 6，其余 4）")
    ap.add_argument("--seed", type=int, default=None,
                    help="锁定随机种子做定向返工（依赖 volcano_ark.py 的 seed 修复）")
    ap.add_argument("--outdir", default=str(SCRIPT_DIR / "output"), help="产物目录")
    ap.add_argument("--install", action="store_true",
                    help=f"出图后复制主选到 {INSTALL_DIR.relative_to(REPO_ROOT)}（本地预览用）")
    ap.add_argument("--dry-run", action="store_true",
                    help="不调 API：打印 8 帧的落盘名 / 参数 / prompt、模型优先级与配额选择、水印参数，用于自检")
    ap.add_argument("--clean-existing", action="store_true",
                    help=f"对已落盘 {INSTALL_DIR.relative_to(REPO_ROOT)}/*.png 重做去水印（零 API 成本）")
    ap.add_argument("--force", action="store_true",
                    help="确认调 API 出图（消耗免费/付费额度）；默认不生成，避免误触重出。"
                         "安全模式 --dry-run / --clean-existing 无需此旗标")
    args = ap.parse_args()

    # 安全模式（零 API）无需 --force：--dry-run 自检参数、--clean-existing 本地去水印。
    # 真正调 API 出图必须显式 --force，避免误触重出消耗额度。
    if not (args.force or args.dry_run or args.clean_existing or args.install):
        print("⚠ 该脚本会调用图像生成 API（消耗免费/付费额度）出图。"
              "默认不生成；如确要出图请加 --force（自检参数用 --dry-run，本地去水印用 --clean-existing，"
              "本地安装用 --install，均无需 --force）。")
        sys.exit(2)

    # --clean-existing：纯本地后处理（零 API），不触碰未落盘的其它 PNG。
    if args.clean_existing:
        if args.dry_run:
            print(f"[dry-run] --clean-existing 将处理目录：{INSTALL_DIR}")
            for p in sorted(INSTALL_DIR.glob("*.png")):
                if p.name != ".keep":
                    print(f"    {p.name}")
            return
        clean_existing(INSTALL_DIR)
        return

    todo = FRAMES
    if args.only:
        f = resolve_only(args.only)
        if not f:
            print(f"❌ 未知帧：{args.only}\n   可选：" +
                  " ".join(f"{x['no']:02d}/{x['slug']}" for x in FRAMES))
            sys.exit(2)
        todo = [f]

    out_dir = Path(args.outdir)

    # 配额状态：今日初始化（seed 4.5=20、5.0=1），文件不存在则新建。
    state = load_quota_state()
    if ensure_today_seed(state):
        save_quota_state_atomic(state)

    if args.dry_run:
        today = today_key()
        first_c = (args.candidates or todo[0]["candidates"]) if todo else 1
        chosen = select_model(state, first_c)
        (wx0, wy0, wx1, wy1), wfeather = watermark_bbox(*TARGET["wt"])
        print(f"— DRY RUN：不调用 API，共 {len(todo)} 帧 —\n")
        print(f"[配额] 状态文件：{QUOTA_STATE_PATH}")
        print(f"[配额] 今日 {today}：{json.dumps(state.get(today, {}), ensure_ascii=False)}")
        print(f"[配额] 每日上限 {DAILY_LIMIT}（张/图）；优先级 {MODEL_PRIORITY}")
        print(f"[配额] 本次将选用模型（首帧 {first_c} 张）：{chosen}"
              f"  （4.5 已 {state.get(today, {}).get(SEEDREAM_45, 0)}/{DAILY_LIMIT} → 跳过）")
        print(f"[配额] 边界逻辑：每次请求前 select_model(num_images)，放不下则跳下一个；"
              f"全部放不下 sys.exit(3)；请求成功 used += num_images（按图计），绝不裸调付费额度")
        # 按图配额走完全部所选帧（不改动真实状态），演示边界
        plan, stop = simulate_allocation(state, todo, lambda f: args.candidates or f["candidates"])
        print(f"[配额·边界模拟] 按图配额走完所选 {len(todo)} 帧（不落盘）：")
        for f, m, c in plan:
            print(f"    [{f['no']:02d}] {f['slug']:12s} candidates={c:2d} → {m}")
        if stop:
            sf, sc = stop
            print(f"    ⏹ 帧 {sf['no']:02d} {sf['slug']} 需 {sc} 张，所有模型免费额度均放不下 → "
                  f"真实运行将 sys.exit(3) 停止（绝不付费）")
        else:
            print(f"    ✅ 所选帧均在免费额度内可分配")
        print(f"[水印] 方案 A 柔边填充：包围盒=({wx0},{wy0})-({wx1},{wy1}) px @1080×1920，"
              f"feather≈{wfeather}px，填充=L0{FLATTEN_BG}+底部采样均值")
        print()
        total = 0
        for f in todo:
            c = args.candidates or f["candidates"]
            total += c
            neg = build_negative(f)
            # 落盘候选命名（带序号，互不覆盖）：主选 {key}.png + candidates/{key}_c2..cN.png
            names = [f"{frame_key(f)}.png"] + \
                    [f"candidates/{frame_key(f)}_c{i}.png" for i in range(2, c + 1)]
            print(f"[{f['no']:02d}] {frame_key(f)}.png   {f['title']}  ({f['region']})")
            print(f"     size={SIZE_MAP['wt']}→{TARGET['wt'][0]}×{TARGET['wt'][1]}  "
                  f"candidates={c}  style_strength={STYLE_STRENGTH}  "
                  f"detail_level={f['detail_level']}  guidance_scale={f['guidance_scale']}")
            print(f"     prompt {len(f['prompt'])} 字 / negative {len(neg)} 字   · {f['note']}")
            print(f"     落盘候选({c})：{'  '.join(names)}")
            print(f"     {f['prompt'][:56]}…\n")
        print(f"合计将请求 {total} 张候选（{len(todo)} 帧），落盘 {total} 张候选"
              f"（主选 {len(todo)} 张 + 备选取 {total - len(todo)} 张）→ {out_dir}")
        return

    api_key = os.getenv("ARK_API_KEY", "")
    if not api_key:
        print("❌ 未设置 ARK_API_KEY。请先 export ARK_API_KEY=你的火山方舟密钥"
              "\n   （只想自检 prompt 与参数，用 --dry-run，无需密钥）")
        sys.exit(1)

    if not HAVE_PIL:
        print("❌ 后处理 / 去水印需要 Pillow，但本机未安装。请先：\n"
              "      pip install Pillow\n"
              "   （仅后处理与去水印依赖它；出图主体逻辑不依赖。）")
        sys.exit(1)

    gen = VolcanoArkGenerator(api_key=api_key)
    out_dir.mkdir(parents=True, exist_ok=True)

    ok, fail, picks = 0, 0, []
    for f in todo:
        c = args.candidates or f["candidates"]
        # 每次真正发起请求前：选优先级最高且能放下本次 c 张的模型（按图计）
        model = select_model(state, c)
        if model is None:
            print(f"❌ 今日所有模型免费额度均放不下本次 {c} 张（各上限 {DAILY_LIMIT}），"
                  f"停止以避免触发付费额度。")
            print(f"   配额状态：{json.dumps(state.get(today_key(), {}), ensure_ascii=False)}")
            sys.exit(3)
        print(f"▶ [{f['no']:02d}] {frame_key(f)}  {f['title']}  model={model}  "
              f"(candidates={c} detail={f['detail_level']} gs={f['guidance_scale']}) · {f['note']}")
        try:
            saved = render_one(gen, f, out_dir, c, args.seed, model=model, state=state)
        except Exception as e:
            print(f"  ❌ 异常：{e}")
            saved = None
        if saved:
            ok += 1
            picks.append(saved[0])  # 主选 = 候选 1
            print(f"    配额 {model} → {state[today_key()][model]}/{DAILY_LIMIT}")
        else:
            fail += 1

    if picks:
        total_kb = sum(kb(p) for p in picks)
        note = "" if total_kb <= TOTAL_BUDGET_KB else f"  ⚠ 超 8 帧合计门槛 {TOTAL_BUDGET_KB}KB"
        print(f"\n主选合计 {total_kb}KB / {len(picks)} 帧{note}")

    if args.install and picks:
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        for p in picks:
            dst = INSTALL_DIR / p.name
            # Bug 2 修复点：不再 shutil.copy2 原样复制。
            # 从 output 取主选，重新跑一遍 postprocess（去水印 + 量化），
            # 保证 game 目录产物一定是「去水印 + 压缩」（≤ ~1MB），与 output 当前状态无关，
            # 也能自愈 output 里残留的带水印/未压缩候选。幂等：已处理过的图再跑一次无副作用。
            im = remove_watermark(postprocess(Image.open(p).convert("RGBA")))
            im.save(str(dst), "PNG")
            q = quantize(dst)
            size = kb(dst)
            warn = "" if size <= 1024 else "  ⚠ 仍超 ~1MB（检查本机 pngquant）"
            print(f"  已安装 {dst.name}  {size}KB{'（已量化）' if q else '（未量化!）'}{warn}")
        print(f"已安装 {len(picks)} 张到 {INSTALL_DIR}")
        print("提示：assets/remote/ 只进 web 产物；wx 主包已在 build.mjs 排除，上线走 CDN。")

    print(f"\n完成：成功 {ok} / 失败 {fail}。输出目录：{out_dir}")
    if ok:
        print("回库前请过 design/art/world-tour-assets.md §E 三道 QA 门"
              "（合规 / 单帧质量 / 序列一致性）；帧 7 摩艾朝向须逐张人工确认。")


if __name__ == "__main__":
    main()
