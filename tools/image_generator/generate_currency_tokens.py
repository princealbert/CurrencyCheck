#!/usr/bin/env python3
"""
《货币图鉴》Seedream 母题批量出图驱动
====================================
依赖：本目录的 volcano_ark.py / base.py（火山方舟 Seedream HTTP 直连，无需 SDK）。
前置：必须设置环境变量 ARK_API_KEY（你自己的火山方舟密钥）。

用法：
    export ARK_API_KEY="ark-xxxx"
    python3 generate_currency_tokens.py            # 出 36 张（18 币 × coin/note，每图 1 张候选）
    python3 generate_currency_tokens.py --candidates 4   # 每图 4 张候选，人工挑 1
    python3 generate_currency_tokens.py --ref-dir my_refs   # 自定义参考图目录
    python3 generate_currency_tokens.py --no-ref            # 强制纯文生图（忽略参考图）
    python3 generate_currency_tokens.py --selfcheck         # 仅做参考图解析/分支自检，不消耗 key

图生图：在同目录 reference_subjects/<ISO>.png 放置主体参考图（coin 与 note 同 ISO 共用一张），
        脚本自动以图生图锁定主体；缺图或用 --no-ref 时自动降级为纯文生图（行为与原版一致）。
        --ref-dir 可整体换目录；--no-ref 便于对照/回退到纯文生图。

输出：./output/cur_<ISO>_<denom>_<region>_<form>.png
      coin → 1024x1024（Seedream 2K 方图缩放下采样）
      note → 2048x1024（Seedream 16:9 横图缩放到 2:1 横幅）

合规：所有提示词已含「no realistic banknote / no flag / no text」等护栏；
      区域徽标 / ISO / 面值由 Cocos 代码叠加，绝不烤进图。见 design/art/seedream-pipeline.md。
"""

import os
import sys
import argparse
import urllib.request
from pathlib import Path

# 让脚本可作为独立文件运行（同级 import base / volcano_ark）
sys.path.insert(0, str(Path(__file__).resolve().parent))
from base import ImageResult  # noqa: E402
from volcano_ark import VolcanoArkGenerator  # noqa: E402

SCRIPT_DIR = Path(__file__).resolve().parent

# —— 36 个母题规格（原 8 币 16 张提取自 design/art/seedream-pipeline.md §3；
#    扩池 10 币 20 张提取自 design/art/new-currency-motif-prompts.md）——
# motif = 中央母题几何实例（符号化）；sig = 修正签名 hex；neg_extra = 币种专属负向项
TOKENS = [
    dict(iso="USD", denom="100", region="amer", form="coin", sig="#4E7A6B",
         motif="concentric medallion emblem with radial star geometry and an abstract initial-letter negative space, evoking a historic portrait without showing a face",
         neg_extra="no human face, no realistic portrait, no detailed engraving"),
    dict(iso="BRL", denom="10", region="amer", form="coin", sig="#C77B7B",
         motif="scarlet macaw parrot rendered as a minimal negative-space silhouette with two or three essential curves",
         neg_extra="no detailed feathers, no realistic animal, no toucan"),
    dict(iso="EUR", denom="20", region="euro", form="coin", sig="#4A6E8A",
         motif="Renaissance-style window-arch and bridge geometric silhouette built from semicircle and trapezoid primitives",
         neg_extra="no real building photo, no euro symbol"),
    dict(iso="GBP", denom="20", region="euro", form="coin", sig="#6A5B8A",
         motif="concentric medallion emblem with abstract painterly radial geometry evoking a historic portrait without showing a face",
         neg_extra="no human face, no realistic portrait, no royal crown emblem"),
    dict(iso="CNY", denom="100", region="asia_afr", form="coin", sig="#C75D4F",
         motif="concentric medallion emblem with radial star geometry and an abstract initial-letter negative space, evoking a historic portrait without showing a face",
         neg_extra="no human face, no realistic portrait, no detailed engraving"),
    dict(iso="JPY", denom="1000", region="asia_afr", form="coin", sig="#6E97A3",
         motif="Mount Fuji as a flat triangular mountain silhouette with a few cherry-blossom dot accents in negative space",
         neg_extra="no realistic landscape photo, no real portrait"),
    dict(iso="INR", denom="100", region="asia_afr", form="coin", sig="#B08FB5",
         motif="concentric medallion emblem with radial lotus geometry and an abstract initial-letter negative space, evoking a historic portrait without showing a face",
         neg_extra="no human face, no realistic portrait, no rupee symbol, no detailed engraving"),
    dict(iso="ZAR", denom="10", region="asia_afr", form="coin", sig="#6E9B7E",
         motif="white rhinoceros rendered as a minimal negative-space silhouette with two or three essential curves",
         neg_extra="no detailed hide texture, no realistic animal, no springbok"),
    # —— note 形态：共享同一母题几何与签名色，仅构图改 horizontal banner ——
    dict(iso="USD", denom="100", region="amer", form="note", sig="#4E7A6B",
         motif="concentric medallion emblem with radial star geometry and an abstract initial-letter negative space, evoking a historic portrait without showing a face",
         neg_extra="no human face, no realistic portrait, no detailed engraving"),
    dict(iso="BRL", denom="10", region="amer", form="note", sig="#C77B7B",
         motif="scarlet macaw parrot rendered as a minimal negative-space silhouette with two or three essential curves",
         neg_extra="no detailed feathers, no realistic animal, no toucan"),
    dict(iso="EUR", denom="20", region="euro", form="note", sig="#4A6E8A",
         motif="Renaissance-style window-arch and bridge geometric silhouette built from semicircle and trapezoid primitives",
         neg_extra="no real building photo, no euro symbol"),
    dict(iso="GBP", denom="20", region="euro", form="note", sig="#6A5B8A",
         motif="concentric medallion emblem with abstract painterly radial geometry evoking a historic portrait without showing a face",
         neg_extra="no human face, no realistic portrait, no royal crown emblem"),
    dict(iso="CNY", denom="100", region="asia_afr", form="note", sig="#C75D4F",
         motif="concentric medallion emblem with radial star geometry and an abstract initial-letter negative space, evoking a historic portrait without showing a face",
         neg_extra="no human face, no realistic portrait, no detailed engraving"),
    dict(iso="JPY", denom="1000", region="asia_afr", form="note", sig="#6E97A3",
         motif="Mount Fuji as a flat triangular mountain silhouette with a few cherry-blossom dot accents in negative space",
         neg_extra="no realistic landscape photo, no real portrait"),
    dict(iso="INR", denom="100", region="asia_afr", form="note", sig="#B08FB5",
         motif="concentric medallion emblem with radial lotus geometry and an abstract initial-letter negative space, evoking a historic portrait without showing a face",
         neg_extra="no human face, no realistic portrait, no rupee symbol, no detailed engraving"),
    dict(iso="ZAR", denom="10", region="asia_afr", form="note", sig="#6E9B7E",
         motif="white rhinoceros rendered as a minimal negative-space silhouette with two or three essential curves",
         neg_extra="no detailed hide texture, no realistic animal, no springbok"),

    # ================= 扩池新增 10 币种 × 2 形态 = 20 张 =================
    # 规格来源：design/art/new-currency-motif-prompts.md（母题实例 / sig / neg_extra 逐条对齐）
    # 字段口径同上：motif = 符号化几何母题实例；sig = 粉彩签名 hex（锚定真钞主色相）
    # ⚠ KRW 数据不一致：currencies.ts 中 motifLabel='极简虎鲸剪影'(animal/orca)，
    #   但 discoveryLine 文案讲「朝鲜时代学者」。视觉按 motifLabel(orca) 出图，
    #   文案冲突归属「④ R4 事实核查」处理，此处不擅改数据。
    # —— coin 形态 ——
    dict(iso="CAD", denom="5", region="amer", form="coin", sig="#B5894E",
         motif="minimal negative-space silhouette of a loon bird reduced to two or three essential curves",
         neg_extra="no detailed feathers, no detailed scales, no realistic animal, no photograph, no duck"),
    dict(iso="MXN", denom="20", region="amer", form="coin", sig="#5FA88A",
         motif="minimal negative-space silhouette of a salamander-like axolotl reduced to two or three essential curves",
         neg_extra="no detailed feathers, no detailed scales, no realistic animal, no photograph, no fish"),
    dict(iso="ARS", denom="200", region="amer", form="coin", sig="#6FA3C7",
         motif="minimal ice-cliff glacier silhouette built from a few faceted angular planes",
         neg_extra="no realistic landscape photo, no real photograph"),
    dict(iso="CLP", denom="1000", region="amer", form="coin", sig="#9A7BC0",
         motif="minimal monolithic stone-head silhouette reduced to two or three blocky primitives",
         neg_extra="no realistic landscape photo, no real photograph"),
    dict(iso="CHF", denom="10", region="euro", form="coin", sig="#7A8FB0",
         motif="minimal triangular mountain-peak silhouette with two or three overlapping peaks",
         neg_extra="no realistic landscape photo, no real photograph"),
    dict(iso="SEK", denom="100", region="euro", form="coin", sig="#5B9AA0",
         motif="minimal negative-space silhouette of a moose reduced to two or three essential curves",
         neg_extra="no detailed feathers, no detailed scales, no realistic animal, no photograph, no deer with antlers"),
    dict(iso="RUB", denom="100", region="euro", form="coin", sig="#8C6FB0",
         motif="minimal negative-space silhouette of a bear reduced to two or three essential curves",
         neg_extra="no detailed feathers, no detailed scales, no realistic animal, no photograph, no panda"),
    dict(iso="PLN", denom="20", region="euro", form="coin", sig="#4F8AA8",
         motif="geometric silhouette of a tower bridge built from two rectangular towers and one connecting arch primitive",
         neg_extra="no real building photo, no euro symbol"),
    dict(iso="KRW", denom="1000", region="asia_afr", form="coin", sig="#C99A3E",
         motif="minimal negative-space silhouette of an orca whale reduced to two or three essential curves",
         neg_extra="no detailed feathers, no detailed scales, no realistic animal, no photograph, no dolphin"),
    dict(iso="NGN", denom="100", region="asia_afr", form="coin", sig="#5E8C6A",
         motif="minimal rounded monolith rock silhouette built from two or three smooth primitives",
         neg_extra="no realistic landscape photo, no real photograph"),
    # —— note 形态：共享同一母题几何与签名色，仅构图改 horizontal banner ——
    dict(iso="CAD", denom="5", region="amer", form="note", sig="#B5894E",
         motif="minimal negative-space silhouette of a loon bird reduced to two or three essential curves",
         neg_extra="no detailed feathers, no detailed scales, no realistic animal, no photograph, no duck"),
    dict(iso="MXN", denom="20", region="amer", form="note", sig="#5FA88A",
         motif="minimal negative-space silhouette of a salamander-like axolotl reduced to two or three essential curves",
         neg_extra="no detailed feathers, no detailed scales, no realistic animal, no photograph, no fish"),
    dict(iso="ARS", denom="200", region="amer", form="note", sig="#6FA3C7",
         motif="minimal ice-cliff glacier silhouette built from a few faceted angular planes",
         neg_extra="no realistic landscape photo, no real photograph"),
    dict(iso="CLP", denom="1000", region="amer", form="note", sig="#9A7BC0",
         motif="minimal monolithic stone-head silhouette reduced to two or three blocky primitives",
         neg_extra="no realistic landscape photo, no real photograph"),
    dict(iso="CHF", denom="10", region="euro", form="note", sig="#7A8FB0",
         motif="minimal triangular mountain-peak silhouette with two or three overlapping peaks",
         neg_extra="no realistic landscape photo, no real photograph"),
    dict(iso="SEK", denom="100", region="euro", form="note", sig="#5B9AA0",
         motif="minimal negative-space silhouette of a moose reduced to two or three essential curves",
         neg_extra="no detailed feathers, no detailed scales, no realistic animal, no photograph, no deer with antlers"),
    dict(iso="RUB", denom="100", region="euro", form="note", sig="#8C6FB0",
         motif="minimal negative-space silhouette of a bear reduced to two or three essential curves",
         neg_extra="no detailed feathers, no detailed scales, no realistic animal, no photograph, no panda"),
    dict(iso="PLN", denom="20", region="euro", form="note", sig="#4F8AA8",
         motif="geometric silhouette of a tower bridge built from two rectangular towers and one connecting arch primitive",
         neg_extra="no real building photo, no euro symbol"),
    dict(iso="KRW", denom="1000", region="asia_afr", form="note", sig="#C99A3E",
         motif="minimal negative-space silhouette of an orca whale reduced to two or three essential curves",
         neg_extra="no detailed feathers, no detailed scales, no realistic animal, no photograph, no dolphin"),
    dict(iso="NGN", denom="100", region="asia_afr", form="note", sig="#5E8C6A",
         motif="minimal rounded monolith rock silhouette built from two or three smooth primitives",
         neg_extra="no realistic landscape photo, no real photograph"),
]

NEG_BASE = ("no realistic banknote, no coin replica, no flag, no text, no numbers, "
            "no letters, no watermark, no security thread, no hologram, no photorealistic, "
            "no photograph, no detailed texture")

SIZE_MAP = {"coin": "2k", "note": "16:9"}  # Seedream 直出尺寸（满足最低像素约束）
TARGET = {"coin": (1024, 1024), "note": (2048, 1024)}  # 资产规范 @2x 最终尺寸


def build_prompt(t: dict) -> str:
    comp = "centered circular composition" if t["form"] == "coin" else "horizontal banner composition"
    return (f"Stylized symbolic motif of a {t['motif']}, flat geometric, "
            f"{t['sig']} dominant palette, minimal, clean vector-like, single flat color "
            f"with one accent stroke, game asset, transparent background, {comp}.")


def build_negative(t: dict) -> str:
    return f"{NEG_BASE}, {t['neg_extra']}"


def resolve_ref_path(iso: str, ref_dir: Path) -> "Path | None":
    """按 ISO 解析主体参考图（coin 与 note 同 ISO 共用一张）。

    默认 reference_subjects/<ISO>.png；文件存在则返回该 Path，
    否则返回 None（调用方据此降级为纯文生图）。不触碰 TOKENS / 合规内容。
    """
    p = ref_dir / f"{iso}.png"
    return p if p.is_file() else None


def download(url: str, path: str):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "currency-token-gen/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        Path(path).write_bytes(r.read())


def maybe_resize(path: str, target: tuple):
    """若 Pillow 可用则缩放到目标尺寸；否则保留 Seedream 原生尺寸并提示。"""
    try:
        from PIL import Image
    except ImportError:
        print(f"  ⚠ 未安装 Pillow，保留原生尺寸（{path}）。如需精确 {target}，请 pip install Pillow。")
        return
    im = Image.open(path).convert("RGBA")
    im = im.resize(target, Image.LANCZOS)
    im.save(path, "PNG")


def selfcheck():
    """不依赖 ARK_API_KEY 的逻辑自检：验证参考图解析与 ref_image 分支。

    制造一个存在的参考图与一个不存在的 ISO，复用与主流程完全相同的
    resolve_ref_path + kwargs 构造逻辑，证明：存在则带 ref_image（图生图），
    不存在则不带（纯文生图）。验证完即退出，决不发起真实请求。
    """
    import shutil
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix="ref_selfcheck_"))
    ref_dir = tmp
    # 写入一张最小合法 PNG（仅用于存在性判断，不发起请求）
    (ref_dir / "USD.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    def build_kwargs(iso: str, no_ref: bool = False) -> dict:
        kwargs: dict = {"size": "2k"}  # 仅取 size 占位，焦点在 ref_image 分支
        if not no_ref:
            rp = resolve_ref_path(iso, ref_dir)
            if rp is not None:
                kwargs["ref_image"] = str(rp)
        return kwargs

    cases = [
        ("USD", False, True),    # 参考图存在 → 应带 ref_image（图生图）
        ("ZZZ", False, False),   # 参考图不存在 → 不带（纯文生图）
        ("USD", True, False),    # 强制 --no-ref → 不带（纯文生图）
    ]
    ok = True
    print("▶ --selfcheck 参考图分支自检（不消耗 key）：")
    for iso, no_ref, expect_ref in cases:
        kwargs = build_kwargs(iso, no_ref=no_ref)
        has = "ref_image" in kwargs
        passed = has == expect_ref
        ok = ok and passed
        flag = "PASS" if passed else "FAIL"
        print(f"  [{flag}] ISO={iso!r:6} no_ref={no_ref!s:5} → "
              f"传给 gen.generate 的参数含 ref_image={has}（期望 {expect_ref}）")

    # 额外验证默认目录解析：脚本同目录 reference_subjects/ 尚不存在时降级为 None
    default_dir = SCRIPT_DIR / "reference_subjects"
    degraded = resolve_ref_path("USD", default_dir) is None
    ok = ok and degraded
    print(f"  [{'PASS' if degraded else 'FAIL'}] 默认目录 {default_dir} 不存在时 "
          f"resolve_ref_path 返回 None（纯文生图降级）")

    shutil.rmtree(tmp, ignore_errors=True)
    print("自检结果：", "全部通过 ✅" if ok else "存在失败 ❌")
    sys.exit(0 if ok else 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", type=int, default=1, help="每图候选数（建议 4，人工挑 1）")
    ap.add_argument("--only", default=None, help="只出指定 ISO，如 --only USD")
    ap.add_argument("--ref-dir", default="reference_subjects",
                    help="参考图目录（默认脚本同目录下的 reference_subjects），内含 <ISO>.png")
    ap.add_argument("--no-ref", action="store_true",
                    help="强制纯文生图（即使有参考图也不传 ref_image），用于对照/回退")
    ap.add_argument("--selfcheck", action="store_true",
                    help="仅做参考图解析/分支自检，不消耗 key，也不检查 ARK_API_KEY")
    ap.add_argument("--force", action="store_true",
                    help="确认重新出图（调用付费图像 API）；默认不生成，避免误触重出")
    args = ap.parse_args()

    if args.selfcheck:
        selfcheck()
        return 0

    if not args.force:
        print("⚠ 该脚本会调用付费图像 API 重新出图。默认不生成；如确要重出请加 --force。"
              "（仅做本地自检用 --selfcheck，不消耗 key。）")
        sys.exit(2)

    # 参考图目录：绝对路径直接用；相对路径相对脚本目录解析（与默认 reference_subjects 一致）
    ref_dir = Path(args.ref_dir)
    if not ref_dir.is_absolute():
        ref_dir = SCRIPT_DIR / ref_dir

    api_key = os.getenv("ARK_API_KEY", "")
    if not api_key:
        print("❌ 未设置 ARK_API_KEY。请先 export ARK_API_KEY=你的火山方舟密钥")
        sys.exit(1)

    gen = VolcanoArkGenerator(api_key=api_key)
    out_dir = SCRIPT_DIR / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    ok, fail = 0, 0
    for t in TOKENS:
        if args.only and t["iso"] != args.only:
            continue
        fname = f"cur_{t['iso']}_{t['denom']}_{t['region']}_{t['form']}.png"
        fpath = out_dir / fname
        prompt = build_prompt(t)
        neg = build_negative(t)

        # 解析主体参考图（coin / note 同 ISO 共用一张）；无图或 --no-ref 则纯文生图
        ref_path = None
        if args.no_ref:
            print(f"▶ {fname}  [{t['sig']} / {t['motif'][:40]}…]  [纯文生图 --no-ref]")
        else:
            ref_path = resolve_ref_path(t["iso"], ref_dir)
            mode = "图生图" if ref_path is not None else "纯文生图"
            if ref_path is None:
                print(f"  ⚠ 未找到 {t['iso']} 参考图，使用纯文生图")
            print(f"▶ {fname}  [{t['sig']} / {t['motif'][:40]}…]  [{mode}]")

        gen_kwargs = dict(negative_prompt=neg,
                          size=SIZE_MAP[t["form"]], num_images=args.candidates)
        if ref_path is not None:
            gen_kwargs["ref_image"] = str(ref_path)

        try:
            results = gen.generate(prompt, **gen_kwargs)
            if not results or not results[0].success:
                print(f"  ❌ 失败：{results[0].error_message if results else '无返回'}")
                fail += 1
                continue
            # 只取第 1 张候选落盘（candidates>1 时其余忽略，建议人工在控制台挑）
            download(results[0].image_url, str(fpath))
            maybe_resize(str(fpath), TARGET[t["form"]])
            print(f"  ✅ 已保存 {fpath}")
            ok += 1
        except Exception as e:
            print(f"  ❌ 异常：{e}")
            fail += 1

    print(f"\n完成：成功 {ok} / 失败 {fail}。输出目录：{out_dir}")


if __name__ == "__main__":
    main()
