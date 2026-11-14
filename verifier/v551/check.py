# v551: 复核盲标行、时间关系、候选误差和关键否定结论。
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V550 = ROOT.parent / "v550"
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
selection = json.loads((V550 / "selection.json").read_text(encoding="utf-8"))
by_id = {segment["segmentId"]: segment for segment in selection["segments"]}
failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


check(result["version"] == "v551-only-sup5-blind-visual-labels-v1", "结果版本错误")
check(result["status"] == "provisional_blind_visual_labels_not_owner_confirmed_and_not_full_80_percent_acceptance", "必须保持 provisional 且非80%验收")
check(result["labelCount"] == 30 and len(result["rows"]) == 30, "必须有30个盲标")
check(result["confidenceCounts"] == {"clear": 8, "approximate": 2, "no_clear_onset": 20}, "标签数量必须为8/2/20")
check(len({row["segmentId"] for row in result["rows"]}) == 30, "盲标ID必须唯一")
for row in result["rows"]:
    segment = by_id[row["segmentId"]]
    check(segment["stratum"] == "only-sup5-within5", f"{row['segmentId']} 分层错误")
    check(row["referenceMs"] == segment["referenceMs"], f"{row['segmentId']} 参考时间错误")
    check(row["currentResidualMs"] == segment["currentResidualMs"] and row["sup5ResidualMs"] == segment["sup5ResidualMs"], f"{row['segmentId']} 候选残差被改动")
    if row["confidence"] == "no_clear_onset":
        check(row["actualOnsetMs"] is None and row["actualRelativeMs"] is None, f"{row['segmentId']} 无清晰音头不得强填时间")
    else:
        check(row["actualOnsetMs"] == row["referenceMs"] + row["actualRelativeMs"], f"{row['segmentId']} 绝对/相对时间不一致")
        for kind in ["current", "sup5"]:
            residual = row[f"{kind}ResidualMs"]
            error = row[f"{kind}ErrorMs"]
            if residual is None:
                check(error is None and row[f"{kind}Within5"] is None, f"{row['segmentId']}/{kind} 空候选处理错误")
            else:
                check(abs(error - (residual - row["actualRelativeMs"])) < 1e-12, f"{row['segmentId']}/{kind} 误差计算错误")
                check(row[f"{kind}Within5"] == (abs(error) <= 5), f"{row['segmentId']}/{kind} ±5ms判断错误")

sup5 = result["summaries"]["sup5"]
current = result["summaries"]["current"]
check(sup5["clearOnly"]["within5"] == 5 and sup5["clearOnly"]["labelCount"] == 8, "5ms清晰音头必须5/8")
check(sup5["clearAndApproximate"]["within5"] == 6 and sup5["clearAndApproximate"]["labelCount"] == 10, "5ms清晰+近似必须6/10")
check(sup5["noClearOnset"]["candidatePresent"] == 20 and sup5["noClearOnset"]["labelCount"] == 20, "20个无清晰音头均出现5ms候选")
check(sup5["all30CandidatePrecisionProxy"]["within5"] == 6 and current["all30CandidatePrecisionProxy"]["within5"] == 0, "候选精度代理必须6/30与0/30")
expected_clear_errors = {
    "sample-003_h183140": False,
    "sample-003_h265989": False,
    "sample-003_h280117": True,
    "sample-003_h311774": False,
    "sample-042_h27328": True,
    "sample-042_h42864": True,
    "sample-095_h267550": True,
    "sample-095_h39373": True,
}
for segment_id, within5 in expected_clear_errors.items():
    row = next(row for row in result["rows"] if row["segmentId"] == segment_id)
    check(row["confidence"] == "clear" and row["sup5Within5"] is within5, f"{segment_id} 清晰标签结果错误")
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
for text in ["clear 8、approximate 2、no_clear_onset 20", "6/30", "5/8", "不能推算全曲 80%", "目标状态保持未完成"]:
    check(text in report, f"报告缺关键限制：{text}")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    print(f"V551_VALIDATION_FAILED: {len(failures)}")
    raise SystemExit(1)
print("ok: 30个盲标及绝对/相对时间、候选误差全部一致")
print("ok: 5ms候选清晰5/8、清晰+近似6/10、全层代理6/30")
print("ok: 20个无清晰音头候选保留为反例，未宣称80%完成")
print("V551_VALIDATION_PASSED")
