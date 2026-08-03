#!/usr/bin/env python3
"""copy_to_assets.py — 把 Seedream 出图产物落盘到小游戏运行时资产目录。

    tools/image_generator/output/cur_*.png  →  minigame/assets/

用法（在 tools/image_generator/ 下执行；路径全部相对本脚本解析，cd 到哪都能跑）：

    python3 copy_to_assets.py                 # 复制全部 cur_*.png
    python3 copy_to_assets.py --dry-run       # 只预览，不写任何文件
    python3 copy_to_assets.py --only CAD      # 只落盘某一 ISO（coin + note）

设计约束（工程口径）：
  * **幂等**：同名同内容 → 跳过不写；同名不同内容 → 覆盖并明确报告「覆盖更新」。
    重复执行结果一致，不会产生副本或递增文件。
  * **只增不删**：本脚本从不删除、不清空、不重命名任何既有文件。
    `minigame/assets/` 里的 16 张原母题图与 bg_*/deco_* 场景图一律不受影响。
  * **命名校验**：只搬运严格匹配 `cur_<ISO>_<denom>_<region>_<form>.png` 且
    region ∈ {amer,euro,asia_afr}、form ∈ {coin,note} 的文件。命名不合约定的文件
    会被跳过并给出原因 —— 因为 `app.ts:preloadImages` 按该命名精确请求，
    错名文件落盘后不会报错，只会「静默不生效」（永远显示几何占位），极难排查。
  * **覆盖率核对**：若能 import 同目录的 generate_currency_tokens，则以其 TOKENS
    （36 条 = 18 币 × 2 形态）为准，落盘后报告还差哪些图。

退出码：0 = 正常（含「无新图可复制」）；1 = 目录缺失等环境错误。
"""

import argparse
import hashlib
import re
import shutil
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent          # tools/image_generator
PROJECT_ROOT = SCRIPT_DIR.parents[1]                  # 仓库根
SRC_DIR = SCRIPT_DIR / "output"
DEST_DIR = PROJECT_ROOT / "minigame" / "assets"

# 与 app.ts:preloadImages 的 `assets/cur_${iso}_${denom}_${region}_${f}.png` 同构
VALID_REGIONS = {"amer", "euro", "asia_afr"}
VALID_FORMS = {"coin", "note"}
NAME_RE = re.compile(
    r"^cur_(?P<iso>[A-Z]{3})_(?P<denom>[0-9]+)_(?P<region>amer|euro|asia_afr)_(?P<form>coin|note)\.png$"
)

# 场景底图 / 装饰件：由 app.ts:preloadScenes 加载，命名合法但不属本脚本默认范围。
# 单列出来是为了避免把它们误报成「命名不合约定」造成用户误判。
SCENE_RE = re.compile(r"^(bg_[a-z]+|deco_[a-z]+)\.png$")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def expected_names() -> "set[str] | None":
    """从 generate_currency_tokens.TOKENS 推导应有的 36 个文件名；import 失败则返回 None。"""
    try:
        sys.path.insert(0, str(SCRIPT_DIR))
        import generate_currency_tokens as g  # noqa: WPS433
        return {
            f"cur_{t['iso']}_{t['denom']}_{t['region']}_{t['form']}.png"
            for t in g.TOKENS
        }
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(
        description="把 output/cur_*.png 幂等复制到 minigame/assets/（只增不删）"
    )
    ap.add_argument("--dry-run", action="store_true",
                    help="只打印将要执行的动作，不写任何文件")
    ap.add_argument("--only", default=None, metavar="ISO",
                    help="只落盘指定 ISO，如 --only CAD")
    ap.add_argument("--include-scenes", action="store_true",
                    help="同时搬运场景底图 bg_*.png / deco_*.png（默认只搬 cur_* 币种母题）")
    args = ap.parse_args()

    print(f"源目录  : {SRC_DIR}")
    print(f"目标目录: {DEST_DIR}")
    if args.dry_run:
        print("模式    : --dry-run（不写盘）")
    print("-" * 68)

    if not SRC_DIR.is_dir():
        print(f"❌ 源目录不存在：{SRC_DIR}")
        print("   请先出图：export ARK_API_KEY=... && python3 generate_currency_tokens.py --candidates 4")
        return 1
    if not DEST_DIR.is_dir():
        print(f"❌ 目标目录不存在：{DEST_DIR}")
        print("   本脚本不擅自创建运行时资产目录，请确认仓库结构是否完整。")
        return 1

    copied, updated, same, skipped = [], [], [], []

    for src in sorted(SRC_DIR.glob("*.png")):
        m = NAME_RE.match(src.name)
        if not m:
            if SCENE_RE.match(src.name):
                if not args.include_scenes:
                    skipped.append((src.name, "场景底图，不在默认范围（如需搬运加 --include-scenes）"))
                    continue
                # 场景图走同一套幂等复制逻辑，只是不参与 ISO 过滤与覆盖率统计
            else:
                skipped.append((src.name, "命名不符合 cur_<ISO>_<denom>_<region>_<form>.png 约定，app.ts 不会加载"))
                continue
        elif args.only and m.group("iso") != args.only.upper():
            skipped.append((src.name, f"--only {args.only.upper()} 过滤"))
            continue

        dest = DEST_DIR / src.name
        if dest.exists():
            if sha256(src) == sha256(dest):
                same.append(src.name)
                continue
            if not args.dry_run:
                shutil.copy2(src, dest)
            updated.append(src.name)
        else:
            if not args.dry_run:
                shutil.copy2(src, dest)
            copied.append(src.name)

    verb = "将复制" if args.dry_run else "已复制"
    for n in copied:
        print(f"  ✅ {verb}（新增）  {n}")
    for n in updated:
        print(f"  ♻️  {verb}（覆盖更新）{n}")
    for n in same:
        print(f"  ⏭  跳过（内容相同，幂等）{n}")
    for n, why in skipped:
        print(f"  ⚠  跳过 {n} —— {why}")

    print("-" * 68)
    print(f"新增 {len(copied)} · 覆盖 {len(updated)} · 相同跳过 {len(same)} · 忽略 {len(skipped)}")

    exp = expected_names()
    if exp is not None:
        have = {p.name for p in DEST_DIR.glob("cur_*.png")}
        missing = sorted(exp - have)
        print(f"资产覆盖率: {len(exp) - len(missing)}/{len(exp)} 张已就位")
        if missing:
            by_iso: dict[str, list[str]] = {}
            for n in missing:
                mm = NAME_RE.match(n)
                if mm:
                    by_iso.setdefault(mm.group("iso"), []).append(mm.group("form"))
            print(f"仍缺 {len(missing)} 张（这些币将继续显示几何占位）：")
            for iso in sorted(by_iso):
                print(f"    {iso}: {'+'.join(sorted(by_iso[iso]))}")
        else:
            print("🎉 36 张母题图全部就位。")

    if not args.dry_run and (copied or updated):
        print("\n下一步：cd ../../minigame && node build.mjs web && node serve.mjs")
        print("       （serve 必须从 minigame/ 目录起，见 design/art 文档「用户运行步骤」）")

    return 0


if __name__ == "__main__":
    sys.exit(main())
