# v556: 复核单特征门控无泄漏、输出/误差和precision-recall联合结论。
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERIFIER = ROOT.parent
result = json.loads((ROOT / "gate-results.json").read_text(encoding="utf-8"))
source = json.loads((VERIFIER / "v555" / "candidate-predictions.json").read_text(encoding="utf-8"))
previous = json.loads((VERIFIER / "v555" / "leading-edge-results.json").read_text(encoding="utf-8"))
feature_by_id = {row["segmentId"]: row for row in source["features"]}
failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual: float, expected: float, message: str) -> None:
    check(abs(actual - expected) < 1e-9, f"{message}: {actual} != {expected}")


check(result["version"] == "v556-single-feature-gate-loso-v1", "版本错误")
check(result["status"] == "exploratory_crossfit_not_production_and_not_final_independent_acceptance", "不得标为生产或正式验收")
check(len(result["crossfitRows"]) == 90 and len({row["segmentId"] for row in result["crossfitRows"]}) == 90, "必须90个唯一crossfit物件")
check(len(result["folds"]) == 3 and len(result["features"]) >= 10, "必须3折且至少10个特征")
for key in ["candidatePrecision", "candidateCoverage", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]:
    close(result["baselineHighPeak"][key], previous["leaveOneSongOutCrossfit"][key], f"无门控基线/{key}")
expected_gates = {
    "sample-003": ("signedDistanceMs", ">=", -1.854349146655295),
    "sample-042": ("signedDistanceMs", ">=", -1.7486061209638137),
    "sample-095": ("peakToLocalMean", "<=", 4.8129028521134884),
}
for fold in result["folds"]:
    held_out = fold["heldOut"]
    gate = fold["training"]["gate"]
    feature, direction, threshold = expected_gates[held_out]
    check(gate["feature"] == feature and gate["direction"] == direction, f"{held_out} 门控特征或方向错误")
    close(gate["threshold"], threshold, f"{held_out} 门控阈值")
    check(fold["training"]["trainingRecallConstraintMet"] is True, f"{held_out} 训练recall约束")
    check(held_out not in fold["trainingSampleIds"] and len(fold["trainingSampleIds"]) == 2, f"{held_out} 训练泄漏")

population = sum(row["weight"] for row in result["crossfitRows"])
original_outputs = sum(row["weight"] for row in result["crossfitRows"] if row["originalCandidatePresent"])
outputs = sum(row["weight"] for row in result["crossfitRows"] if row["output"])
clear = sum(row["weight"] for row in result["crossfitRows"] if row["confidence"] == "clear")
broad = sum(row["weight"] for row in result["crossfitRows"] if row["confidence"] in {"clear", "approximate"})
no_clear_original = sum(row["weight"] for row in result["crossfitRows"] if row["confidence"] == "no_clear_onset" and row["originalCandidatePresent"])
no_clear_rejected = sum(row["weight"] for row in result["crossfitRows"] if row["confidence"] == "no_clear_onset" and row["originalCandidatePresent"] and not row["output"])
correct_clear = 0.0
correct_broad = 0.0
for row in result["crossfitRows"]:
    gate = row["gate"]
    feature_value = feature_by_id[row["segmentId"]].get(gate["feature"])
    expected_output = row["originalCandidatePresent"] and feature_value is not None and (feature_value >= gate["threshold"] if gate["direction"] == ">=" else feature_value <= gate["threshold"])
    check(row["output"] == expected_output, f"{row['segmentId']} 门控输出错误")
    if not expected_output:
        check(row["residualMs"] is None and row["errorMs"] is None and row["within5"] is None, f"{row['segmentId']} 拒绝后不得保留误差")
        continue
    actual = row["actualRelativeMs"]
    expected_error = None if actual is None else row["residualMs"] - actual
    if expected_error is not None:
        close(row["errorMs"], expected_error, f"{row['segmentId']} 门控误差")
    expected_within = None if expected_error is None or row["confidence"] == "no_clear_onset" else abs(expected_error) <= 5
    check(row["within5"] == expected_within, f"{row['segmentId']} 门控±5ms判断")
    if expected_within is True:
        correct_broad += row["weight"]
        if row["confidence"] == "clear":
            correct_clear += row["weight"]
actual = result["leaveOneSongOutCrossfit"]
close(actual["populationWeight"], population, "crossfit人口")
close(actual["originalCandidateOutputWeight"], original_outputs, "crossfit原输出")
close(actual["candidateOutputWeight"], outputs, "crossfit门控输出")
close(actual["correctClearWeight"], correct_clear, "crossfit清晰正确")
close(actual["correctBroadWeight"], correct_broad, "crossfit广泛正确")
close(actual["candidatePrecision"], correct_broad / outputs, "crossfit precision")
close(actual["candidateCoverage"], outputs / population, "crossfit coverage")
close(actual["clearOnsetRecall"], correct_clear / clear, "crossfit clear recall")
close(actual["clearAndApproximateOnsetRecall"], correct_broad / broad, "crossfit broad recall")
close(actual["allObjectCorrectRate"], correct_broad / population, "crossfit全物件")
close(actual["noClearCandidateRejectionRate"], no_clear_rejected / no_clear_original, "no_clear拒绝率")
close(actual["candidatePrecision"], 0.4492013345537217, "锁定precision")
close(actual["clearAndApproximateOnsetRecall"], 0.7138701201201202, "锁定broad recall")
close(actual["clearOnsetRecall"], 0.7493071302595112, "锁定clear recall")
check(actual["candidatePrecision"] < result["baselineHighPeak"]["candidatePrecision"], "门控precision必须如实下降")
check(actual["clearAndApproximateOnsetRecall"] < 0.8, "held-out recall未达80%")
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
for text in ["44.92%", "71.39%", "74.93%", "82.55%", "12.94%", "54.94%", "全标签结果不是验证精度", "目标状态保持未完成"]:
    check(text in report, f"报告缺关键内容：{text}")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    print(f"V556_VALIDATION_FAILED: {len(failures)}")
    raise SystemExit(1)
print("ok: 3折门控无训练泄漏，90行输出与误差独立复算一致")
print("ok: 门控precision 44.92%、broad recall 71.39%，均未支持采用")
print("ok: 全标签54.94%仅作诊断，未冒充交叉验证")
print("V556_VALIDATION_PASSED")
