# v554: 独立复核留一曲时钟校正，不把事后最优当验证结果。
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERIFIER = ROOT.parent
result = json.loads((ROOT / "clock-correction-results.json").read_text(encoding="utf-8"))
previous = json.loads((VERIFIER / "v553" / "weighted-results.json").read_text(encoding="utf-8"))
failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual: float, expected: float, message: str) -> None:
    check(abs(actual - expected) < 1e-9, f"{message}: {actual} != {expected}")


check(result["version"] == "v554-fixed-clock-correction-loso-v1", "版本错误")
check(result["status"] == "exploratory_crossfit_not_production_and_not_final_independent_acceptance", "不得标记为生产或正式验收")
check(len(result["crossfitRows"]) == 180, "两种候选各90行，合计180行")
check(len(result["folds"]) == 6, "必须有6个留一曲折子")
for kind in ["current", "sup5"]:
    for key in ["candidatePrecision", "candidateCoverage", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]:
        close(result["baseline"][kind][key], previous["overall"][kind][key], f"基线必须复现v553/{kind}/{key}")

expected_folds = {
    ("current", "sample-003"): -3.0, ("current", "sample-042"): -0.5, ("current", "sample-095"): -1.5,
    ("sup5", "sample-003"): -2.0, ("sup5", "sample-042"): -2.0, ("sup5", "sample-095"): 2.5,
}
for fold in result["folds"]:
    key = (fold["kind"], fold["heldOut"])
    close(fold["chosenShiftMs"], expected_folds[key], f"折子校正量{key}")
    check(fold["heldOut"] not in fold["trainingSampleIds"] and len(fold["trainingSampleIds"]) == 2, f"{key} 训练集泄漏")
    close(fold["training"]["shiftMs"], fold["chosenShiftMs"], f"{key} 训练校正量")
    close(fold["heldOutMetrics"]["shiftMs"], fold["chosenShiftMs"], f"{key} heldout校正量")

for kind in ["current", "sup5"]:
    rows = [row for row in result["crossfitRows"] if row["fitKind"] == kind]
    check(len(rows) == 90 and len({row["segmentId"] for row in rows}) == 90, f"{kind} 必须90个唯一held-out物件")
    population = sum(row["weight"] for row in rows)
    outputs = sum(row["weight"] for row in rows if row[f"{kind}ResidualMs"] is not None)
    clear = sum(row["weight"] for row in rows if row["confidence"] == "clear")
    broad = sum(row["weight"] for row in rows if row["confidence"] in {"clear", "approximate"})
    correct_clear = 0.0
    correct_broad = 0.0
    for row in rows:
        fold = next(item for item in result["folds"] if item["kind"] == kind and item["heldOut"] == row["sampleId"])
        close(row["appliedShiftMs"], fold["chosenShiftMs"], f"{kind}/{row['segmentId']} 校正量")
        residual = row[f"{kind}ResidualMs"]
        actual = row["actualRelativeMs"]
        expected_error = None if residual is None or actual is None else residual + row["appliedShiftMs"] - actual
        if expected_error is None:
            check(row["correctedErrorMs"] is None, f"{kind}/{row['segmentId']} 空误差")
        else:
            close(row["correctedErrorMs"], expected_error, f"{kind}/{row['segmentId']} 校正误差")
        expected_within = None if expected_error is None or row["confidence"] == "no_clear_onset" else abs(expected_error) <= 5
        check(row["correctedWithin5"] == expected_within, f"{kind}/{row['segmentId']} 校正±5ms判断")
        if expected_within is True:
            correct_broad += row["weight"]
            if row["confidence"] == "clear":
                correct_clear += row["weight"]
    actual = result["leaveOneSongOutCrossfit"][kind]
    close(actual["correctClearWeight"], correct_clear, f"{kind} crossfit清晰正确权重")
    close(actual["correctBroadWeight"], correct_broad, f"{kind} crossfit广泛正确权重")
    close(actual["candidatePrecision"], correct_broad / outputs, f"{kind} crossfit precision")
    close(actual["candidateCoverage"], outputs / population, f"{kind} crossfit coverage")
    close(actual["clearOnsetRecall"], correct_clear / clear, f"{kind} crossfit clear recall")
    close(actual["clearAndApproximateOnsetRecall"], correct_broad / broad, f"{kind} crossfit broad recall")
    close(actual["allObjectCorrectRate"], correct_broad / population, f"{kind} crossfit全物件")

close(result["leaveOneSongOutCrossfit"]["sup5"]["clearAndApproximateOnsetRecall"], 0.7538945195195195, "5ms crossfit broad")
close(result["leaveOneSongOutCrossfit"]["sup5"]["clearOnsetRecall"], 0.6502897455278408, "5ms crossfit clear")
close(result["allDataBestPostHocDiagnostic"]["sup5"]["shiftMs"], -2.0, "事后最优校正")
close(result["allDataBestPostHocDiagnostic"]["sup5"]["clearAndApproximateOnsetRecall"], 0.7983765015015017, "事后最优broad")
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
for text in ["75.39%", "65.03%", "79.84%", "仅诊断，不是验证", "不是新样本正式验收", "目标状态保持未完成"]:
    check(text in report, f"报告缺关键限制：{text}")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    print(f"V554_VALIDATION_FAILED: {len(failures)}")
    raise SystemExit(1)
print("ok: 6个留一曲折子无训练泄漏，180行校正误差与±5ms判断一致")
print("ok: 5ms交叉验证clear+approx为75.39%，未达80%")
print("ok: 全标签79.84%仅保留为事后诊断，未冒充验证结果")
print("V554_VALIDATION_PASSED")
