#!/usr/bin/env python3
"""
花眼记 · 配图交付前 QA（image_qa）
====================================
借鉴歸藏 material-illustration skill「交付前 QA 审核（反模式纠正）」的精神，
落在花眼记 DNA 上：纯 PIL、零外部依赖、不引任何视觉模型 / 外部 API。

为什么这么做（与 huayanji 现状对齐）：
- 生图 prompt（prompt_factory.STYLE / NEGATIVE）已主动规避「图内文字 / 水印 / 乱码」，
  所以不需要 OCR 级检测；
- 真正会破坏产出的，是「空图 / 纯色 / 下载失败 / 裁切 / 极端偏色」这类结构性问题，
  纯 PIL 像素统计即可覆盖；
- PIL 信息图已有 fact_check 管「数据准确」，这里补「视觉层」自检。

反模式清单（对应歸藏的反模式，但用像素统计实现）：
1. 文件完整：存在、可读、PIL 能 open
2. 空图 / 纯色：像素标准差极低 → FAIL（对应「画面无内容 / 被裁切」）
3. 全黑 / 全白：极端偏色（mean 接近 0 或 255）→ FAIL（对应「渲染失败」）
4. 尺寸异常：单边过小或不符合 expected_size → FAIL / WARN（对应「裁切」）
5. 文件过小：字节数异常小 → FAIL（对应「空白 / 损坏 / 下载失败」）

severity:
- 'warn'  （默认）：打印警告，不阻断产线（向后兼容现有 pipeline）
- 'strict'：raise ImageQAError，阻断并要求重生成

用法：
    from image_qa import qa_image, qa_directory
    rep = qa_image(path)                    # 返回 QAReport
    qa_image(path, severity='strict')       # 失败则抛异常
    reps = qa_directory('content/media/generated')
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from PIL import Image


# ════════════════════════════════════════════════════════════════
# 阈值（保守设定，避免误判正常插画 / 信息图）
# ════════════════════════════════════════════════════════════════
_MIN_DIM = 100            # 单边像素小于此 → 尺寸异常
_PURE_COLOR_STD = 6.0     # 灰度标准差低于此 → 疑似纯色 / 空图
_BLACK_MEAN = 6.0         # 灰度均值低于此 → 疑似全黑
_WHITE_MEAN = 249.0       # 灰度均值高于此 → 疑似全白
_MIN_FILESIZE = 2048      # 字节数低于此 → 文件过小 / 疑似空白损坏


class ImageQAError(Exception):
    """strict 模式下 QA 不通过时抛出。"""


@dataclass
class QAReport:
    """单图 QA 结果。"""
    path: str
    passed: bool
    issues: List[str] = field(default_factory=list)
    metrics: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "path": self.path,
            "passed": self.passed,
            "issues": self.issues,
            "metrics": self.metrics,
        }


def _pixel_stats(path: str):
    """返回 (w, h, mean, std, filesize)；打不开则抛异常。"""
    img = Image.open(path)
    gray = img.convert("L")
    w, h = gray.size
    small = gray.resize((64, 64))
    px = list(small.getdata())
    n = len(px)
    mean = sum(px) / n
    var = sum((p - mean) ** 2 for p in px) / n
    std = var ** 0.5
    filesize = os.path.getsize(path)
    return w, h, mean, std, filesize


def qa_image(
    path: str,
    severity: str = "warn",
    expected_size: Optional[tuple] = None,
) -> QAReport:
    """对单张图片做交付前反模式自检。

    Args:
        path: 图片路径
        severity: 'warn'（默认，不阻断）/ 'strict'（失败抛 ImageQAError）
        expected_size: 可选 (w, h)，不符则报尺寸异常
    Returns:
        QAReport
    """
    issues: List[str] = []
    metrics: Dict = {}

    try:
        w, h, mean, std, filesize = _pixel_stats(path)
    except Exception as e:
        issues.append(f"无法打开图片: {e}")
        metrics = {"error": str(e)}
        rep = QAReport(str(path), False, issues, metrics)
        _emit(rep, severity)
        return rep

    metrics = {
        "width": w,
        "height": h,
        "mean_brightness": round(mean, 1),
        "stddev": round(std, 1),
        "filesize": filesize,
    }

    # 4. 尺寸异常
    if w < _MIN_DIM or h < _MIN_DIM:
        issues.append(f"尺寸异常过小: {w}x{h}")
    if expected_size and (w, h) != tuple(expected_size):
        issues.append(f"尺寸不符预期: 实际 {w}x{h} vs 预期 {expected_size}")

    # 2. 空图 / 纯色
    if std < _PURE_COLOR_STD:
        issues.append(f"疑似纯色/空图: stddev={std:.1f}")

    # 3. 全黑 / 全白
    if mean < _BLACK_MEAN:
        issues.append(f"疑似全黑图: mean={mean:.1f}")
    elif mean > _WHITE_MEAN:
        issues.append(f"疑似全白图: mean={mean:.1f}")

    # 5. 文件过小
    if filesize < _MIN_FILESIZE:
        issues.append(f"文件过小疑似空白/损坏: {filesize}B")

    passed = not issues
    rep = QAReport(str(path), passed, issues, metrics)
    _emit(rep, severity)
    return rep


def _emit(rep: QAReport, severity: str) -> None:
    if rep.passed:
        print(f"✅ QA 通过: {rep.path}  {rep.metrics}")
    else:
        msg = f"⚠️  QA 不通过: {rep.path}  issues={rep.issues}"
        if severity == "strict":
            raise ImageQAError(msg)
        print(msg, file=sys.stderr)


def qa_directory(dir_path: str, pattern: str = "*.jpg", severity: str = "warn") -> List[QAReport]:
    """对目录下所有匹配图片批量 QA，返回报告列表并打印汇总。"""
    from glob import glob

    paths = sorted(glob(os.path.join(dir_path, pattern)))
    reports = [qa_image(p, severity=severity) for p in paths]
    passed = sum(1 for r in reports if r.passed)
    print(f"📊 QA 目录 {dir_path}: {passed}/{len(reports)} 通过")
    return reports


if __name__ == "__main__":
    import sys as _sys
    if len(_sys.argv) > 1:
        target = _sys.argv[1]
        if os.path.isdir(target):
            qa_directory(target)
        else:
            rep = qa_image(target)
            _sys.exit(0 if rep.passed else 1)
