#!/usr/bin/env python3
"""
《货币图鉴·对对碰》「环游世界」全收集结算 · 8 帧名胜图出图驱动（Seedream / 火山方舟）
===============================================================================
依赖：同目录 volcano_ark.py / base.py；后处理需 Pillow；量化需 pngquant（缺失自动跳过）
前置：必须设置环境变量 ARK_API_KEY

用法：
    export ARK_API_KEY="ark-xxxx"
    python3 generate_world_tour.py --dry-run        # 不调 API，只打印 8 帧 prompt/参数/落盘名（自检用）
    python3 generate_world_tour.py                  # 出全部 8 帧，逐帧候选数按 §B.9
    python3 generate_world_tour.py --only moai      # 只出第 7 帧（也接受 07 / worldtour_07_moai）
    python3 generate_world_tour.py --only moai --candidates 8 --seed 12345
    python3 generate_world_tour.py --install        # 出完后复制到 minigame/assets/remote/worldtour/

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
import shutil
import argparse
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from volcano_ark import VolcanoArkGenerator  # noqa: E402

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
        no=5, slug="jungfrau", region="euro", title="瑞士·少女峰",
        # §B.5 中文主 prompt（自 design/art/world-tour-assets.md 逐字提取，勿手改）
        prompt=(
            "冷调几何构成的风格化平涂插画。三到四座三角形山峰前后叠错排布，每座山峰为单色平涂，"
            "越远的越浅，山脊线干净利落，峰与峰之间有明确的前后遮挡关系；"
            "数块不规则的白色云团色块从画面中部水平横切过山体，把山体切断成上下两截，"
            "云块边缘柔和但内部为纯色平涂；山腰处有一条极细的水平线，暗示山间铁道，"
            "不画列车、不画车厢、不画桥墩、不画轨枕；天空为一整块冷调浅色平涂。"
            "整幅只用三个主色加一个点缀色：雾蓝灰（近山）、冷白（雪与云）、淡青（远山），"
            "点缀色为暖米（天际线一线天光）。构图重心落在画面中上部的峰群与云带，"
            "画面下方五分之二为近景山体的低对比度暗色延展区，安静、无高频细节、无岩石纹理。"
            "扁平平涂，几何化造型，矢量感干净边缘，大色块，单色平涂不做写实渐变，柔和环境光，"
            "旅行手账明信片质感，游戏美术资产，竖构图 9:16。"
        ),
        # 禁止项 = NEG_BASE_WT + 本帧增补（同上，逐字提取）
        neg_extra=(
            "，无写实山脉照片，无岩石纹理，无雪地颗粒，无人物，无滑雪者，无登山者，无缆车车厢，"
            "无索道支架，无小屋，无木屋，无树林，无针叶林细节，无瑞士十字，无镜头光晕，无太阳光束"
        ),
        candidates=4, detail_level=5, guidance_scale=7.5,
        note="云须真的切断山体",
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
    from PIL import Image
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
    from PIL import Image
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


def render_one(gen, f: dict, out_dir: Path, candidates: int, seed):
    """出一帧：候选全部落盘，候选 1 用主名，其余进 candidates/ 供人工换选。"""
    from PIL import Image
    key = frame_key(f)
    results = gen.generate(
        f["prompt"],
        negative_prompt=build_negative(f),
        size=SIZE_MAP["wt"],
        num_images=candidates,
        seed=seed,
        watermark=False,
        style_strength=STYLE_STRENGTH,
        detail_level=f["detail_level"],
        guidance_scale=f["guidance_scale"],
        # optimize_prompt_mode 刻意不传（§B.9）：平台改写会静默丢掉本批的高密度约束，
        # 尤其帧 7 的朝向与帧 3 的零动物 —— 丢了不报错，等于白出。
    )
    if not results or not results[0].success:
        msg = results[0].error_message if results else "无返回数据"
        print(f"  ❌ 失败：{msg}")
        return None

    saved = []
    for i, r in enumerate(results, start=1):
        if not r.success or not r.image_url:
            continue
        dest = out_dir / f"{key}.png" if i == 1 else out_dir / "candidates" / f"{key}_c{i}.png"
        tmp = out_dir / f".{key}_c{i}.raw"
        try:
            download(r.image_url, tmp)
            im = postprocess(Image.open(tmp).convert("RGBA"))
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.save(str(dest), "PNG")
        finally:
            tmp.unlink(missing_ok=True)
        q = quantize(dest)
        size = kb(dest)
        flag = "" if size <= SIZE_BUDGET_KB else f"  ⚠ 超单帧体积门槛 {SIZE_BUDGET_KB}KB"
        tag = "主选" if i == 1 else f"候选{i}"
        print(f"  ✅ {tag}  {dest.relative_to(out_dir)}  {im.size[0]}×{im.size[1]}  "
              f"{size}KB{'（已量化）' if q else ''}{flag}")
        saved.append(dest)
    return saved[0] if saved else None


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
                    help="不调 API：打印 8 帧的落盘名 / 参数 / prompt 与负向长度，用于自检")
    args = ap.parse_args()

    todo = FRAMES
    if args.only:
        f = resolve_only(args.only)
        if not f:
            print(f"❌ 未知帧：{args.only}\n   可选：" +
                  " ".join(f"{x['no']:02d}/{x['slug']}" for x in FRAMES))
            sys.exit(2)
        todo = [f]

    out_dir = Path(args.outdir)

    if args.dry_run:
        print(f"— DRY RUN：不调用 API，共 {len(todo)} 帧 —\n")
        total = 0
        for f in todo:
            c = args.candidates or f["candidates"]
            total += c
            neg = build_negative(f)
            print(f"[{f['no']:02d}] {frame_key(f)}.png   {f['title']}  ({f['region']})")
            print(f"     size={SIZE_MAP['wt']}→{TARGET['wt'][0]}×{TARGET['wt'][1]}  "
                  f"candidates={c}  style_strength={STYLE_STRENGTH}  "
                  f"detail_level={f['detail_level']}  guidance_scale={f['guidance_scale']}")
            print(f"     prompt {len(f['prompt'])} 字 / negative {len(neg)} 字   · {f['note']}")
            print(f"     {f['prompt'][:56]}…\n")
        print(f"合计将请求 {total} 张候选，落盘主选 {len(todo)} 张 → {out_dir}")
        return

    api_key = os.getenv("ARK_API_KEY", "")
    if not api_key:
        print("❌ 未设置 ARK_API_KEY。请先 export ARK_API_KEY=你的火山方舟密钥"
              "\n   （只想自检 prompt 与参数，用 --dry-run，无需密钥）")
        sys.exit(1)

    gen = VolcanoArkGenerator(api_key=api_key)
    out_dir.mkdir(parents=True, exist_ok=True)

    ok, fail, picks = 0, 0, []
    for f in todo:
        c = args.candidates or f["candidates"]
        print(f"▶ [{f['no']:02d}] {frame_key(f)}  {f['title']}  "
              f"(candidates={c} detail={f['detail_level']} gs={f['guidance_scale']}) · {f['note']}")
        try:
            pick = render_one(gen, f, out_dir, c, args.seed)
        except Exception as e:
            print(f"  ❌ 异常：{e}")
            pick = None
        if pick:
            ok += 1
            picks.append(pick)
        else:
            fail += 1

    if picks:
        total_kb = sum(kb(p) for p in picks)
        note = "" if total_kb <= TOTAL_BUDGET_KB else f"  ⚠ 超 8 帧合计门槛 {TOTAL_BUDGET_KB}KB"
        print(f"\n主选合计 {total_kb}KB / {len(picks)} 帧{note}")

    if args.install and picks:
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        for p in picks:
            shutil.copy2(p, INSTALL_DIR / p.name)
        print(f"已复制 {len(picks)} 张到 {INSTALL_DIR}")
        print("提示：assets/remote/ 只进 web 产物；wx 主包已在 build.mjs 排除，上线走 CDN。")

    print(f"\n完成：成功 {ok} / 失败 {fail}。输出目录：{out_dir}")
    if ok:
        print("回库前请过 design/art/world-tour-assets.md §E 三道 QA 门"
              "（合规 / 单帧质量 / 序列一致性）；帧 7 摩艾朝向须逐张人工确认。")


if __name__ == "__main__":
    main()
