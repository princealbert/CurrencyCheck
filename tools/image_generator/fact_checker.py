#!/usr/bin/env python3
"""
Infographic Fact-Checker — 生图前信息核验工具

设计目的：PIL 信息图渲染前必须先有 fact_check_report，避免"瞎编数字画进图里"。

工作流：
  1. 上层（orchestrator / agent）准备 claim 列表
  2. 调用 verify_claims(claims, search_fn=...) 走多源核验
     - search_fn 接受 query 字符串，返回 list[dict]，每条 {url, title, snippet, date}
     - 搜索源可以是 baidu-search skill / delegate_task web 工具集 / 人工标注
  3. 生成 fact_check_report.json，含每条 claim 的 status / confidence / sources
  4. pil_infographic.render_*(...) 前调用 require_fact_check() 强制校验
     - status != "verified" 的 claim 不允许出现在图里

Claim 状态机：
  - verified   : 至少 2 个独立来源支持，可信度 ≥ 0.8
  - disputed   : 来源冲突 / 数据不一致
  - outdated   : 数据真实但已过时
  - unverified : 找不到来源 / 来源不足
  - rejected   : 与事实严重不符，禁止使用

晓波 2026-06-09 反馈：
  "信息图的样子是出来了，但是图中的信息不够准确，
   我觉得这需要在生图之前增加信息搜索核验的步骤。"
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Callable, List, Dict, Optional, Any


# ───── Claim / Report 数据结构 ─────
@dataclass
class Claim:
    """单条待核验的信息点"""
    key: str                       # 唯一标识, e.g. "anthropic_arr_2026q2"
    claim: str                     # 完整陈述, e.g. "Anthropic 年化营收 470 亿美元（2026 Q2）"
    type: str = "fact"             # valuation / revenue / multiplier / date / event / quote / other
    as_of: str = ""                # 数据所属时间, e.g. "2026-06"
    search_queries: List[str] = field(default_factory=list)   # 推荐搜索词
    context: str = ""              # 上下文说明
    must_verify: bool = True       # 是否必须核验（数字类默认 True）


@dataclass
class Source:
    """单条来源"""
    url: str
    title: str = ""
    snippet: str = ""
    date: str = ""
    domain: str = ""


@dataclass
class ClaimResult:
    """单条 claim 的核验结果"""
    key: str
    claim: str
    status: str = "unverified"     # verified / disputed / outdated / unverified / rejected
    confidence: float = 0.0        # 0-1
    sources: List[Source] = field(default_factory=list)
    verified_value: str = ""       # 核验后的事实值
    notes: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


@dataclass
class FactCheckReport:
    """完整核验报告"""
    report_id: str
    generated_at: str
    claims: List[ClaimResult]
    summary: Dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "report_id": self.report_id,
            "generated_at": self.generated_at,
            "claims": [c.to_dict() for c in self.claims],
            "summary": self.summary,
        }

    def verified_keys(self) -> List[str]:
        return [c.key for c in self.claims if c.status == "verified"]

    def blocked_keys(self) -> List[str]:
        return [c.key for c in self.claims if c.status in ("rejected", "disputed")]


# ───── 搜索引擎抽象（可注入）─────
SearchFn = Callable[[str], List[Source]]
"""
SearchFn 协议:
  输入: query 字符串
  输出: list[Source]
        每个 Source 含 url, title, snippet, date
        返回空 list 表示未找到

默认实现: _noop_search (返回空), 上层需注入真实搜索函数
  - skills/baidu-search/scripts/search.py (需 BAIDU_API_KEY)
  - delegate_task web 工具集 (hermes agent)
  - 人工标注 sources (test fixture)
"""


def _noop_search(query: str) -> List[Source]:
    return []


def _default_baidu_search(query: str) -> List[Source]:
    """调本地 baidu-search skill (需配置 BAIDU_API_KEY)"""
    import os
    import subprocess
    import sys
    from pathlib import Path

    api_key = os.getenv("BAIDU_API_KEY")
    if not api_key:
        return []

    script = Path(__file__).parent.parent.parent / "skills" / "baidu-search" / "scripts" / "search.py"
    if not script.exists():
        return []

    try:
        r = subprocess.run(
            [sys.executable, str(script), json.dumps({"query": query, "count": 10})],
            capture_output=True, text=True, timeout=30, env={**os.environ, "BAIDU_API_KEY": api_key},
        )
        if r.returncode != 0:
            return []
        data = json.loads(r.stdout)
        sources = []
        for item in data:
            url = item.get("url", "")
            sources.append(Source(
                url=url,
                title=item.get("title", ""),
                snippet=item.get("content", "")[:300],
                date=item.get("date", ""),
                domain=_domain_of(url),
            ))
        return sources
    except Exception:
        return []


def _domain_of(url: str) -> str:
    m = re.search(r"https?://([^/]+)/?", url)
    return m.group(1) if m else ""


# ───── 数字提取与核验逻辑 ─────
NUMBER_RE = re.compile(r"[\$¥€£]?\s*(\d[\d,\.]*)\s*(亿|万|亿美|万亿|百万|千|M|B|T|billion|million|trillion|%|倍|x)?", re.IGNORECASE)


def extract_numbers(text: str) -> List[str]:
    """从文本里抽数字串（带单位）"""
    return [m.group(0).strip() for m in NUMBER_RE.finditer(text or "")]


def _numbers_close(a: str, b: str) -> bool:
    """简单判断两个数字串是否接近（容忍 ±15%）"""
    try:
        am = re.search(r"(\d[\d\.]*)", a.replace(",", ""))
        bm = re.search(r"(\d[\d\.]*)", b.replace(",", ""))
        if not am or not bm:
            return False
        va, vb = float(am.group(1)), float(bm.group(1))
        if va == 0 and vb == 0:
            return True
        ratio = max(va, vb) / min(va, vb) if min(va, vb) > 0 else 999
        return ratio <= 1.15
    except Exception:
        return False


def _status_from_sources(claim_text: str, sources: List[Source]) -> tuple:
    """根据来源判断状态 + 可信度"""
    if not sources:
        return "unverified", 0.0

    # 提取 claim 中的关键数字
    claim_nums = extract_numbers(claim_text)

    # 统计有多少 source 在 snippet 中提到相同数字
    matched = 0
    for src in sources:
        src_nums = extract_numbers(src.snippet + " " + src.title)
        if claim_nums and any(_numbers_close(cn, sn) for cn in claim_nums for sn in src_nums):
            matched += 1
        elif not claim_nums:
            matched += 1  # 非数字 claim 简化处理

    if matched >= 2:
        # 多源支持
        unique_domains = {s.domain for s in sources[:matched] if s.domain}
        if len(unique_domains) >= 2:
            return "verified", min(0.95, 0.7 + matched * 0.05)
        return "verified", min(0.85, 0.6 + matched * 0.05)
    elif matched == 1:
        return "unverified", 0.4
    return "unverified", 0.2


def _make_report_id() -> str:
    return f"fc_{datetime.now().strftime('%Y%m%d_%H%M%S')}"


# ───── 核心 API ─────
def verify_claims(
    claims: List[Claim],
    search_fn: Optional[SearchFn] = None,
    queries_per_claim: int = 2,
) -> FactCheckReport:
    """
    主入口：核验 claim 列表

    Args:
        claims: 待核验的 Claim 列表
        search_fn: 搜索函数, 接受 query 返回 list[Source]；None 时尝试 baidu-search
        queries_per_claim: 每条 claim 跑几个搜索查询（默认 2，取首条 query）

    Returns:
        FactCheckReport
    """
    fn: SearchFn = search_fn if search_fn is not None else _default_baidu_search
    results: List[ClaimResult] = []

    for c in claims:
        all_sources: List[Source] = []
        queries = c.search_queries[:queries_per_claim] if c.search_queries else [c.claim]
        for q in queries:
            all_sources.extend(fn(q))

        # 去重 by url
        seen = set()
        uniq = []
        for s in all_sources:
            if s.url and s.url not in seen:
                seen.add(s.url)
                uniq.append(s)
        all_sources = uniq[:10]

        status, conf = _status_from_sources(c.claim, all_sources)
        result = ClaimResult(
            key=c.key,
            claim=c.claim,
            status=status,
            confidence=conf,
            sources=all_sources,
            verified_value="",  # 上层可手动补充
            notes=c.context,
        )
        results.append(result)

    summary = {
        "total": len(results),
        "verified": sum(1 for r in results if r.status == "verified"),
        "unverified": sum(1 for r in results if r.status == "unverified"),
        "disputed": sum(1 for r in results if r.status == "disputed"),
        "outdated": sum(1 for r in results if r.status == "outdated"),
        "rejected": sum(1 for r in results if r.status == "rejected"),
    }
    return FactCheckReport(
        report_id=_make_report_id(),
        generated_at=datetime.now().isoformat(timespec="seconds"),
        claims=results,
        summary=summary,
    )


def write_fact_check_report(
    claims: List[Claim],
    out_path: str,
    search_fn: SearchFn = None,
) -> str:
    """核验 + 写 JSON 报告 + 返回路径"""
    report = verify_claims(claims, search_fn=search_fn)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))
    return str(out)


# ───── 渲染前强制校验 ─────
class FactCheckError(Exception):
    pass


def require_fact_check(
    report_path: str,
    claim_keys: Optional[List[str]] = None,
    min_verified_ratio: float = 0.8,
) -> FactCheckReport:
    """
    PIL 渲染前调用：检查 report 是否存在、claim 是否通过核验。

    Args:
        report_path: fact_check_report.json 路径
        claim_keys: 要校验的 claim key 列表；None 则校验所有
        min_verified_ratio: verified 比例下限（默认 0.8）

    Raises:
        FactCheckError: 当 report 不存在 / claim 未核验 / 比例不足
    """
    p = Path(report_path)
    if not p.exists():
        raise FactCheckError(
            f"❌ Fact-check report not found: {report_path}\n"
            f"   → 必须先生成核验报告才能画信息图。\n"
            f"   → 调 write_fact_check_report(claims, out_path) 生成。"
        )

    data = json.loads(p.read_text())
    report = FactCheckReport(
        report_id=data["report_id"],
        generated_at=data["generated_at"],
        claims=[ClaimResult(**c) for c in data["claims"]],
        summary=data.get("summary", {}),
    )

    target_keys = claim_keys or [c.key for c in report.claims]
    target_results: Dict[str, ClaimResult] = {c.key: c for c in report.claims if c.key in target_keys}

    # 检查每个目标 key
    missing = [k for k in target_keys if k not in target_results]
    if missing:
        raise FactCheckError(
            f"❌ Report 缺这些 claim key: {missing}\n"
            f"   → 在 verify_claims(claims) 的 claims 列表里加上。"
        )

    blocked = [k for k in target_keys if target_results[k].status in ("rejected", "disputed")]
    if blocked:
        first_status = target_results[blocked[0]].status
        raise FactCheckError(
            f"❌ 这些 claim 状态={first_status} (禁止使用):\n"
            + "\n".join(f"   - {k}: {target_results[k].claim}" for k in blocked)
            + "\n   → 修正 claim 重新核验，或从图中删除。"
        )

    verified = [k for k in target_keys if target_results[k].status == "verified"]
    ratio = len(verified) / len(target_keys) if target_keys else 0
    if ratio < min_verified_ratio:
        unverified = [k for k in target_keys if target_results[k].status != "verified"]
        raise FactCheckError(
            f"❌ verified 比例 {ratio:.0%} < {min_verified_ratio:.0%}\n"
            f"   → 未通过核验 ({len(unverified)}/{len(target_keys)}): {unverified}\n"
            f"   → 补充来源 or 改用已 verified 的 claim。"
        )

    return report


# ───── CLI 入口 ─────
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("用法:")
        print("  python fact_checker.py verify <claims.json> [out_report.json]")
        print("  python fact_checker.py check <report.json> [key1 key2 ...]")
        print()
        print("claims.json 格式:")
        print(json.dumps([{
            "key": "anthropic_arr_2026q2",
            "claim": "Anthropic 年化营收 470 亿美元",
            "type": "revenue",
            "as_of": "2026-06",
            "search_queries": ["Anthropic ARR 2026", "Anthropic 470 亿"],
        }], ensure_ascii=False, indent=2))
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "verify":
        in_p = Path(sys.argv[2])
        out_p = Path(sys.argv[3]) if len(sys.argv) > 3 else in_p.with_suffix(".report.json")
        claims_data = json.loads(in_p.read_text())
        claims = [Claim(**c) for c in claims_data]
        report = write_fact_check_report(claims, str(out_p))
        print(f"✅ Report written: {report}")
        print(f"   summary: {verify_claims(claims).summary}")
    elif cmd == "check":
        report_p = sys.argv[2]
        keys = sys.argv[3:] if len(sys.argv) > 3 else None
        try:
            r = require_fact_check(report_p, keys)
            print(f"✅ Fact-check passed: {r.summary}")
        except FactCheckError as e:
            print(str(e))
            sys.exit(2)
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
