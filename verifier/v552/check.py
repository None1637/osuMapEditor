# v552: 复核盲标行、时间关系、候选误差、来源区间和关键限制。
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V550 = ROOT.parent / "v550"
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
selection = json.loads((V550 / "selection.json").read_text(encoding="utf-8"))
by_id = {segment["segmentId"]: segment for segment in selection["segments"]}
with (ROOT / "annotations-both.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    annotations = {row["segmentId"]: row for row in csv.DictReader(handle)}
with (ROOT / "annotated-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    comparison = {row["segmentId"]: row for row in csv.DictReader(handle)}
failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


check(result["version"] == "v552-both-within5-blind-visual-labels-v1", "结果版本错误")
check(result["status"] == "provisional_blind_visual_labels_not_owner_confirmed_and_not_full_80_percent_acceptance", "必须保持 provisional 且非80%验收")
check(result["labelCount"] == 30 and len(result["rows"]) == 30 and len(annotations) == 30 and len(comparison) == 30, "必须有30个盲标及30行对比")
check(result["confidenceCounts"] == {"clear": 7, "approximate": 10, "no_clear_onset": 13}, "标签数量必须为7/10/13")
check(len({row["segmentId"] for row in result["rows"]}) == 30, "盲标ID必须唯一")
check(set(annotations) == set(comparison) == {row["segmentId"] for row in result["rows"]}, "标注、对比和结果ID必须一致")
for row in result["rows"]:
    segment_id = row["segmentId"]
    segment = by_id[segment_id]
    annotation = annotations[segment_id]
    exported = comparison[segment_id]
    check(segment["stratum"] == "both-within5", f"{segment_id} 分层错误")
    check(row["referenceMs"] == segment["referenceMs"], f"{segment_id} 参考时间错误")
    check(row["confidence"] == annotation["confidence"], f"{segment_id} 锁定标签被改动")
    check(row["comment"] == annotation["comment"], f"{segment_id} 锁定注释被改动")
    check(row["currentResidualMs"] == segment["currentResidualMs"] and row["sup5ResidualMs"] == segment["sup5ResidualMs"], f"{segment_id} 候选残差被改动")
    check(row["originalAudioPath"] == segment["originalAudioPath"] == exported["originalAudioPath"], f"{segment_id} 原始路径缺失或被改动")
    check(row["clipStartClock"] == segment["clipStartClock"] == exported["clipStartClock"], f"{segment_id} 开始时间错误")
    check(row["clipEndClock"] == segment["clipEndClock"] == exported["clipEndClock"], f"{segment_id} 结束时间错误")
    if row["confidence"] == "no_clear_onset":
        check(row["actualOnsetMs"] is None and row["actualRelativeMs"] is None, f"{segment_id} 无清晰音头不得强填时间")
    else:
        check(str(row["actualRelativeMs"]) == annotation["actualRelativeMs"], f"{segment_id} 相对标签被改动")
        check(row["actualOnsetMs"] == row["referenceMs"] + row["actualRelativeMs"], f"{segment_id} 绝对/相对时间不一致")
        for kind in ["current", "sup5"]:
            residual = row[f"{kind}ResidualMs"]
            error = row[f"{kind}ErrorMs"]
            if residual is None:
                check(error is None and row[f"{kind}Within5"] is None, f"{segment_id}/{kind} 空候选处理错误")
            else:
                check(abs(error - (residual - row["actualRelativeMs"])) < 1e-12, f"{segment_id}/{kind} 误差计算错误")
                check(row[f"{kind}Within5"] == (abs(error) <= 5), f"{segment_id}/{kind} ±5ms判断错误")

for kind in ["current", "sup5"]:
    summary = result["summaries"][kind]
    check(summary["clearOnly"]["within5"] == 7 and summary["clearOnly"]["labelCount"] == 7, f"{kind} 清晰音头必须7/7")
    check(summary["clearAndApproximate"]["within5"] == 17 and summary["clearAndApproximate"]["labelCount"] == 17, f"{kind} 清晰+近似必须17/17")
    check(summary["noClearOnset"]["candidatePresent"] == 13 and summary["noClearOnset"]["labelCount"] == 13, f"{kind} 13个无清晰音头均出现候选")
    check(summary["all30CandidatePrecisionProxy"]["within5"] == 17, f"{kind} 全层代理必须17/30")

report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
for text in ["clear 7、approximate 10、no_clear_onset 13", "17/30", "7/7", "17/17", "不能推算全曲 80%", "目标状态保持未完成", "弱标签一致不能替代独立精标"]:
    check(text in report, f"报告缺关键限制：{text}")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    print(f"V552_VALIDATION_FAILED: {len(failures)}")
    raise SystemExit(1)
print("ok: 30个锁定盲标、来源路径、分秒区间及绝对/相对时间一致")
print("ok: 两种候选清晰7/7、清晰+近似17/17、全层代理17/30")
print("ok: 13个无清晰音头候选保留为反例，未宣称80%完成")
print("V552_VALIDATION_PASSED")
