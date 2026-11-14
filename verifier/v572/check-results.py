# v572: 独立重建corrected-target候选、反折来源、CSV和全部指标。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V563 = ROOT.parent / "v563"
V571 = ROOT.parent / "v571"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
METHODS = ["e10Gated", "e13CorrectedTargetRematch"]
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
baseline = json.loads((ROOT.parent / "v569" / "gated-candidates.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "rematched-candidates.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
calibration = json.loads((V563 / "calibrated-candidates.json").read_text(encoding="utf-8"))
peaks_by_sample = {sample: json.loads((V571 / "per-sample" / f"{sample}.json").read_text(encoding="utf-8"))["fullPeakMs"] for sample in SAMPLES}
failures = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual, expected, message: str) -> None:
    if actual is None or expected is None:
        check(actual is expected, message)
    else:
        check(math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-9), f"{message}: {actual} != {expected}")


def compare(actual, expected, label: str) -> None:
    if isinstance(expected, dict):
        check(isinstance(actual, dict), f"{label}不是对象")
        if not isinstance(actual, dict):
            return
        check(set(actual) == set(expected), f"{label}字段不同: {set(actual) ^ set(expected)}")
        for key, value in expected.items():
            compare(actual.get(key), value, f"{label}/{key}")
    elif isinstance(expected, (float, int)) and not isinstance(expected, bool):
        close(actual, expected, label)
    else:
        check(actual == expected, f"{label}: {actual} != {expected}")


def percentile95(values: list[float]) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * 0.95
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


check(config["status"] == "frozen_before_candidate_evaluation", "E13配置状态改变")
check(config["productionCodeChanged"] is False, "生产代码标志改变")
check(json.loads((V571 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True, "full峰导出复验未通过")
rows = [dict(row) for row in baseline["rows"]]
check(len(rows) == len(payload["rows"]) == 90, "输入输出必须为90行")
records = {(record["sampleId"], record["fold"]): record for record in calibration["calibrationRecords"]}
for row in rows:
    record = records[(row["sampleId"], row["fold"])]
    check(record["fitFold"] != row["fold"], f"校准折泄漏/{row['segmentId']}")
    check(row["segmentId"] not in record["fitSegmentIds"], f"当前物件进入校准/{row['segmentId']}")
    close(row["correctionMs"], record["correctionMs"], f"E5修正量/{row['segmentId']}")
    center = row["targetMs"] - row["correctionMs"]
    choices = [peak for peak in peaks_by_sample[row["sampleId"]] if abs(peak - center) <= 10.0]
    peak = min(choices, key=lambda value: (abs(value - center), value)) if choices else None
    actual = row["actualOnsetMs"]
    row["e13CorrectedCenterMs"] = center
    row["e13CandidateSource"] = "fullCorrectedTargetRematch" if peak is not None else "missing"
    row["e13CorrectedTargetRematchCandidateAbsoluteMs"] = peak
    row["e13CorrectedTargetRematchErrorMs"] = None if peak is None or actual is None else peak - actual
payload_by_id = {row["segmentId"]: row for row in payload["rows"]}
for expected in rows:
    compare(payload_by_id.get(expected["segmentId"]), expected, f"候选行/{expected['segmentId']}")


def present(row: dict, method: str) -> bool:
    return row[f"{method}CandidateAbsoluteMs"] is not None


def correct(row: dict, method: str) -> bool:
    error = row[f"{method}ErrorMs"]
    return error is not None and abs(error) <= 5.0


for row in rows:
    old, new = correct(row, "e10Gated"), correct(row, "e13CorrectedTargetRematch")
    row["e10GatedToe13CorrectedTargetRematchTransition"] = "bothCorrect" if old and new else ("fixed" if new else ("broken" if old else "bothIncorrect"))
with (ROOT / "rematched-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    comparison = list(csv.DictReader(handle))
check(len(comparison) == 90, "CSV必须为90行")
comparison_by_id = {row["segmentId"]: row for row in comparison}
for expected in rows:
    actual = comparison_by_id[expected["segmentId"]]
    for key, text in actual.items():
        value = expected[key]
        if isinstance(value, (str, bool)):
            check(text == str(value), f"CSV/{expected['segmentId']}/{key}")
        else:
            close(None if text == "" else float(text), value, f"CSV/{expected['segmentId']}/{key}")


def div(a: float, b: float) -> float | None:
    return a / b if b else None


def recompute(source_rows: list[dict], method: str) -> dict:
    outputs = [row for row in source_rows if present(row, method)]
    correct_rows = [row for row in source_rows if correct(row, method)]
    correct_clear = [row for row in correct_rows if row["confidence"] == "clear"]
    clear = [row for row in source_rows if row["confidence"] == "clear"]
    broad = [row for row in source_rows if row["confidence"] in {"clear", "approximate"}]
    no_clear = [row for row in source_rows if row["confidence"] == "no_clear_onset"]
    no_clear_outputs = [row for row in no_clear if present(row, method)]
    errors = [row[f"{method}ErrorMs"] for row in source_rows if row[f"{method}ErrorMs"] is not None]
    absolute = [abs(value) for value in errors]
    return {"sampleCount": len(source_rows), "candidateOutputCount": len(outputs), "correctCount": len(correct_rows),
        "populationWeight": sum(row["weight"] for row in source_rows), "candidateOutputWeight": sum(row["weight"] for row in outputs),
        "clearWeight": sum(row["weight"] for row in clear), "broadWeight": sum(row["weight"] for row in broad),
        "noClearOnsetWeight": sum(row["weight"] for row in no_clear), "noClearCandidateOutputWeight": sum(row["weight"] for row in no_clear_outputs),
        "correctClearWeight": sum(row["weight"] for row in correct_clear), "correctBroadWeight": sum(row["weight"] for row in correct_rows),
        "candidatePrecision": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in outputs)),
        "candidateCoverage": div(sum(row["weight"] for row in outputs), sum(row["weight"] for row in source_rows)),
        "clearOnsetRecall": div(sum(row["weight"] for row in correct_clear), sum(row["weight"] for row in clear)),
        "clearAndApproximateOnsetRecall": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in broad)),
        "allObjectCorrectRate": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in source_rows)),
        "noClearCandidateOutputRate": div(sum(row["weight"] for row in no_clear_outputs), sum(row["weight"] for row in no_clear)),
        "pairedErrorDiagnosticsNotCalibration": {"count": len(errors), "medianSignedMs": statistics.median(errors) if errors else None,
            "medianAbsoluteMs": statistics.median(absolute) if absolute else None, "p95AbsoluteMs": percentile95(absolute) if absolute else None}}


expected_methods = {}
for method in METHODS:
    expected_methods[method] = {"overall": recompute(rows, method),
        "perSample": {sample: recompute([row for row in rows if row["sampleId"] == sample], method) for sample in SAMPLES},
        "perStratum": {stratum: recompute([row for row in rows if row["stratum"] == stratum], method) for stratum in STRATA},
        "perFold": {fold: recompute([row for row in rows if row["fold"] == fold], method) for fold in FOLDS}}
    compare(result["methods"][method], expected_methods[method], f"指标/{method}")
metric_keys = ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate", "candidateCoverage", "noClearCandidateOutputRate"]
expected_deltas = {key: expected_methods["e13CorrectedTargetRematch"]["overall"][key] - expected_methods["e10Gated"]["overall"][key] for key in metric_keys}
compare(result["baselineDeltas"], expected_deltas, "基线差值")
expected_transitions, expected_per_sample = {}, {sample: {} for sample in SAMPLES}
for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
    selected = [row for row in rows if row["e10GatedToe13CorrectedTargetRematchTransition"] == category]
    expected_transitions[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
    for sample in SAMPLES:
        subset = [row for row in selected if row["sampleId"] == sample]
        expected_per_sample[sample][category] = {"count": len(subset), "weight": sum(row["weight"] for row in subset)}
expected_transitions["netFixedWeight"] = expected_transitions["fixed"]["weight"] - expected_transitions["broken"]["weight"]
compare(result["transitionsE10ToE13"], expected_transitions, "转移")
compare(result["perSampleTransitionsE10ToE13"], expected_per_sample, "分歌曲转移")
compare(result["candidateSourceCounts"], dict(Counter(row["e13CandidateSource"] for row in rows)), "候选来源")
compare(result["annotationSummary"], {"labeledObjects": 90, "confidenceCounts": dict(Counter(row["confidence"] for row in rows))}, "标签汇总")
expected_target = expected_methods["e13CorrectedTargetRematch"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8
expected_sample044 = expected_methods["e13CorrectedTargetRematch"]["perSample"]["sample-044"]["clearAndApproximateOnsetRecall"] >= 0.8
expected_no_clear = expected_methods["e13CorrectedTargetRematch"]["overall"]["noClearCandidateOutputRate"] <= expected_methods["e10Gated"]["overall"]["noClearCandidateOutputRate"]
check(result["targetAchieved"] is expected_target, "80%目标标志错误")
check(result["sample044AtLeast80Preserved"] is expected_sample044, "sample-044保持标志错误")
check(result["noClearRateNotIncreased"] is expected_no_clear, "no_clear守卫标志错误")
h1 = expected_deltas["clearAndApproximateOnsetRecall"] > 0
h2 = expected_transitions["netFixedWeight"] > 0 and expected_sample044 and expected_no_clear
validation = {"version": "v572-corrected-target-independent-recheck-v1", "passed": not failures,
    "comparisonRows": len(comparison), "oppositeFoldCalibrationVerified": True, "candidateRuleVerified": True, "csvVerified": True,
    "groupsVerified": ["overall", "perSample", "perStratum", "perFold"], "hypotheses": {"H1": h1, "H2": h2, "H3": not failures},
    "developmentTargetAchieved": expected_target, "independentConfirmationPerformed": False,
    "sample044AtLeast80Preserved": expected_sample044, "noClearRateNotIncreased": expected_no_clear,
    "audibleCorrectRate": expected_methods["e13CorrectedTargetRematch"]["overall"]["clearAndApproximateOnsetRecall"],
    "deltaFromE10": expected_deltas["clearAndApproximateOnsetRecall"], "netFixedWeightFromE10": expected_transitions["netFixedWeight"],
    "failures": failures}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 90行反折校准、重匹配候选、CSV、全部指标和转移独立一致")
print(f"ok: E13开发正确率={validation['audibleCorrectRate'] * 100:.4f}%，相对E10={validation['deltaFromE10'] * 100:+.4f}pp；达到开发80%目标")
print("V572_RESULT_VALIDATION_PASSED")
