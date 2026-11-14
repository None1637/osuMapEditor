# v555: 复核TypeScript DSP基线、留一曲无泄漏、交叉验证指标与限制。
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERIFIER = ROOT.parent
result = json.loads((ROOT / "leading-edge-results.json").read_text(encoding="utf-8"))
previous = json.loads((VERIFIER / "v553" / "weighted-results.json").read_text(encoding="utf-8"))
failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual: float, expected: float, message: str) -> None:
    check(abs(actual - expected) < 1e-9, f"{message}: {actual} != {expected}")


check(result["version"] == "v555-multiband-leading-edge-loso-v2-typescript-dsp", "必须使用纠正后的TypeScript DSP版本")
check(result["status"] == "exploratory_crossfit_not_production_and_not_final_independent_acceptance", "不得标为生产或正式验收")
check(result["baselineReproduction"]["count"] == 90, "基线必须90个")
check(result["baselineReproduction"]["allPresenceMatches"] is True, "90个候选存在性必须全部复现")
close(result["baselineReproduction"]["maxAbsDifferenceMs"], 0, "TypeScript基线最大差")
check(len(result["configurations"]) == 18 and len(result["predictions"]) == 18, "必须有18组配置")
all_ids = {row["segmentId"] for row in result["crossfitRows"]}
check(len(all_ids) == 90 and len(result["crossfitRows"]) == 90, "crossfit必须90个唯一物件")
for config_name, predictions in result["predictions"].items():
    check(len(predictions) == 90 and {row["segmentId"] for row in predictions} == all_ids, f"{config_name} 必须90个唯一预测")
for key in ["candidatePrecision", "candidateCoverage", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]:
    close(result["baselineFullPeak"][key], previous["overall"]["sup5"][key], f"基线必须复现v553/{key}")
check(len(result["folds"]) == 3, "必须3个留一曲折子")
for fold in result["folds"]:
    check(fold["chosenConfig"] == "high-peak", f"{fold['heldOut']} 必须选择high-peak")
    check(fold["heldOut"] not in fold["trainingSampleIds"] and len(fold["trainingSampleIds"]) == 2, f"{fold['heldOut']} 训练泄漏")
    check(fold["training"]["config"] == fold["chosenConfig"] and fold["heldOutMetrics"]["config"] == fold["chosenConfig"], f"{fold['heldOut']} 配置不一致")

population = sum(row["weight"] for row in result["crossfitRows"])
outputs = sum(row["weight"] for row in result["crossfitRows"] if row["residualMs"] is not None)
clear = sum(row["weight"] for row in result["crossfitRows"] if row["confidence"] == "clear")
broad = sum(row["weight"] for row in result["crossfitRows"] if row["confidence"] in {"clear", "approximate"})
correct_clear = 0.0
correct_broad = 0.0
for row in result["crossfitRows"]:
    check(row["chosenConfig"] == "high-peak", f"{row['segmentId']} crossfit配置错误")
    prediction = next(item for item in result["predictions"]["high-peak"] if item["segmentId"] == row["segmentId"])
    residual = prediction["residualMs"]
    if residual is None:
        check(row["residualMs"] is None and row["errorMs"] is None and row["within5"] is None, f"{row['segmentId']} 空候选处理错误")
        continue
    close(row["residualMs"], residual, f"{row['segmentId']} 残差被改动")
    actual = row["actualRelativeMs"]
    expected_error = None if actual is None else residual - actual
    if expected_error is None:
        check(row["errorMs"] is None, f"{row['segmentId']} 空标签误差")
    else:
        close(row["errorMs"], expected_error, f"{row['segmentId']} 误差")
    expected_within = None if expected_error is None or row["confidence"] == "no_clear_onset" else abs(expected_error) <= 5
    check(row["within5"] == expected_within, f"{row['segmentId']} ±5ms判断")
    if expected_within is True:
        correct_broad += row["weight"]
        if row["confidence"] == "clear":
            correct_clear += row["weight"]
actual = result["leaveOneSongOutCrossfit"]
close(actual["populationWeight"], population, "crossfit人口")
close(actual["candidateOutputWeight"], outputs, "crossfit输出")
close(actual["correctClearWeight"], correct_clear, "crossfit清晰正确")
close(actual["correctBroadWeight"], correct_broad, "crossfit广泛正确")
close(actual["candidatePrecision"], correct_broad / outputs, "crossfit precision")
close(actual["candidateCoverage"], outputs / population, "crossfit coverage")
close(actual["clearOnsetRecall"], correct_clear / clear, "crossfit clear recall")
close(actual["clearAndApproximateOnsetRecall"], correct_broad / broad, "crossfit broad recall")
close(actual["allObjectCorrectRate"], correct_broad / population, "crossfit全物件")
close(actual["clearOnsetRecall"], 0.861090115058369, "锁定clear recall")
close(actual["clearAndApproximateOnsetRecall"], 0.8857920420420421, "锁定broad recall")
close(actual["candidatePrecision"], 0.46983573917371824, "锁定precision")
check(result["allDataBestPostHocDiagnostic"]["config"] == "high-peak", "全标签事后最优必须为high-peak")
check(actual["clearAndApproximateOnsetRecall"] >= 0.8 and actual["candidatePrecision"] < 0.8 and actual["allObjectCorrectRate"] < 0.8, "recall达标不得掩盖precision与全物件未达标")
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
for text in ["86.11%", "88.58%", "46.98%", "46.01%", "2/90", "8.27 ms", "90/90", "0 ms", "不能把本轮结果当作目标完成", "目标状态保持未完成"]:
    check(text in report, f"报告缺关键内容：{text}")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    print(f"V555_VALIDATION_FAILED: {len(failures)}")
    raise SystemExit(1)
print("ok: 项目TypeScript DSP复现90/90基线，最大差0ms")
print("ok: 三折均独立选择high-peak，crossfit clear 86.11%、clear+approx 88.58%")
print("ok: precision 46.98%、全物件46.01%，未把recall达标冒充整体目标完成")
print("V555_VALIDATION_PASSED")
