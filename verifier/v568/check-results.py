# v568: 独立重建层级候选/修正来源并复算全部指标。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V567 = ROOT.parent / "v567"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
METHODS = ["e5Calibrated", "e9Hierarchical"]
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
source = json.loads((V567 / "ddc-calibrated-candidates.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "hierarchical-candidates.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
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


check(config["status"] == "frozen_before_candidate_evaluation", "E9配置状态改变")
check(config["productionCodeChanged"] is False, "生产代码标志改变")
check(json.loads((V567 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True, "E8复验未通过")
rows = [dict(row) for row in source["rows"]]
record_by_key = {(record["sampleId"], record["fold"]): record for record in source["calibrationRecords"]}
check(len(rows) == len(payload["rows"]) == 90, "输入输出必须为90行")
for row in rows:
    raw, actual = row["e8RawCandidateAbsoluteMs"], row["actualOnsetMs"]
    if raw is not None:
        record = record_by_key[(row["sampleId"], row["fold"])]
        if record["usedFallback"]:
            correction, correction_source = row["correctionMs"], "e5CorrectionFallback"
        else:
            correction, correction_source = record["correctionMs"], "ddcOppositeFold"
        absolute = raw - correction
        error = None if actual is None else absolute - actual
        candidate_source = "ddcParabolic"
    else:
        absolute, error = row["e5CalibratedCandidateAbsoluteMs"], row["e5CalibratedErrorMs"]
        correction, correction_source, candidate_source = row["correctionMs"], "e5CandidateFallback", "e5Full"
    row["e9CandidateSource"] = candidate_source
    row["e9CorrectionSource"] = correction_source
    row["e9AppliedCorrectionMs"] = correction
    row["e9HierarchicalCandidateAbsoluteMs"] = absolute
    row["e9HierarchicalErrorMs"] = error
payload_by_id = {row["segmentId"]: row for row in payload["rows"]}
for expected in rows:
    compare(payload_by_id.get(expected["segmentId"]), expected, f"候选行/{expected['segmentId']}")


def present(row: dict, method: str) -> bool:
    return row["e9HierarchicalCandidateAbsoluteMs"] is not None if method == "e9Hierarchical" else row["fullCandidateAbsoluteMs"] is not None


def correct(row: dict, method: str) -> bool:
    error = row[f"{method}ErrorMs"]
    return error is not None and abs(error) <= 5.0


for row in rows:
    old, new = correct(row, "e5Calibrated"), correct(row, "e9Hierarchical")
    row["e5CalibratedToe9HierarchicalTransition"] = "bothCorrect" if old and new else ("fixed" if new else ("broken" if old else "bothIncorrect"))
with (ROOT / "hierarchical-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    comparison = list(csv.DictReader(handle))
check(len(comparison) == 90, "CSV必须为90行")
comparison_by_id = {row["segmentId"]: row for row in comparison}
for expected in rows:
    actual = comparison_by_id[expected["segmentId"]]
    for key, text in actual.items():
        value = expected[key]
        if isinstance(value, str):
            check(text == value, f"CSV/{expected['segmentId']}/{key}")
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
    return {
        "sampleCount": len(source_rows), "candidateOutputCount": len(outputs), "correctCount": len(correct_rows),
        "populationWeight": sum(row["weight"] for row in source_rows), "candidateOutputWeight": sum(row["weight"] for row in outputs),
        "clearWeight": sum(row["weight"] for row in clear), "broadWeight": sum(row["weight"] for row in broad),
        "noClearOnsetWeight": sum(row["weight"] for row in no_clear),
        "noClearCandidateOutputWeight": sum(row["weight"] for row in no_clear_outputs),
        "correctClearWeight": sum(row["weight"] for row in correct_clear), "correctBroadWeight": sum(row["weight"] for row in correct_rows),
        "candidatePrecision": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in outputs)),
        "candidateCoverage": div(sum(row["weight"] for row in outputs), sum(row["weight"] for row in source_rows)),
        "clearOnsetRecall": div(sum(row["weight"] for row in correct_clear), sum(row["weight"] for row in clear)),
        "clearAndApproximateOnsetRecall": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in broad)),
        "allObjectCorrectRate": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in source_rows)),
        "noClearCandidateOutputRate": div(sum(row["weight"] for row in no_clear_outputs), sum(row["weight"] for row in no_clear)),
        "pairedErrorDiagnosticsNotCalibration": {"count": len(errors),
            "medianSignedMs": statistics.median(errors) if errors else None,
            "medianAbsoluteMs": statistics.median(absolute) if absolute else None,
            "p95AbsoluteMs": percentile95(absolute) if absolute else None},
    }


expected_methods = {}
for method in METHODS:
    expected_methods[method] = {"overall": recompute(rows, method),
        "perSample": {sample: recompute([row for row in rows if row["sampleId"] == sample], method) for sample in SAMPLES},
        "perStratum": {stratum: recompute([row for row in rows if row["stratum"] == stratum], method) for stratum in STRATA},
        "perFold": {fold: recompute([row for row in rows if row["fold"] == fold], method) for fold in FOLDS}}
    compare(result["methods"][method], expected_methods[method], f"指标/{method}")
metric_keys = ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate", "candidateCoverage", "noClearCandidateOutputRate"]
expected_deltas = {key: expected_methods["e9Hierarchical"]["overall"][key] - expected_methods["e5Calibrated"]["overall"][key] for key in metric_keys}
compare(result["baselineDeltas"], expected_deltas, "基线差值")
expected_transitions, expected_per_sample = {}, {sample: {} for sample in SAMPLES}
for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
    selected = [row for row in rows if row["e5CalibratedToe9HierarchicalTransition"] == category]
    expected_transitions[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
    for sample in SAMPLES:
        subset = [row for row in selected if row["sampleId"] == sample]
        expected_per_sample[sample][category] = {"count": len(subset), "weight": sum(row["weight"] for row in subset)}
expected_transitions["netFixedWeight"] = expected_transitions["fixed"]["weight"] - expected_transitions["broken"]["weight"]
compare(result["transitionsE5ToE9"], expected_transitions, "转移")
compare(result["perSampleTransitionsE5ToE9"], expected_per_sample, "分歌曲转移")
compare(result["candidateSourceCounts"], {key: sum(row["e9CandidateSource"] == key for row in rows) for key in ["ddcParabolic", "e5Full"]}, "候选来源")
compare(result["correctionSourceCounts"], dict(Counter(row["e9CorrectionSource"] for row in rows)), "修正来源")
compare(result["annotationSummary"], {"labeledObjects": 90, "confidenceCounts": dict(Counter(row["confidence"] for row in rows))}, "标签汇总")
expected_target = expected_methods["e9Hierarchical"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8
expected_sample044 = expected_methods["e9Hierarchical"]["perSample"]["sample-044"]["clearAndApproximateOnsetRecall"] >= 0.8
expected_no_clear = expected_methods["e9Hierarchical"]["overall"]["noClearCandidateOutputRate"] <= expected_methods["e5Calibrated"]["overall"]["noClearCandidateOutputRate"]
check(result["targetAchieved"] is expected_target, "80%目标标志错误")
check(result["sample044AtLeast80Preserved"] is expected_sample044, "sample-044保持标志错误")
check(result["noClearRateNotIncreased"] is expected_no_clear, "no_clear守卫标志错误")
h1 = expected_deltas["clearAndApproximateOnsetRecall"] > 0
h2 = expected_transitions["netFixedWeight"] > 0 and expected_sample044 and expected_no_clear
check(not h1 and not h2, "H1/H2应被总体负结果拒绝")
validation = {
    "version": "v568-hierarchical-independent-recheck-v1", "passed": not failures,
    "comparisonRows": len(comparison), "candidateAndCorrectionSourcesVerified": True, "csvVerified": True,
    "groupsVerified": ["overall", "perSample", "perStratum", "perFold"],
    "hypotheses": {"H1": h1, "H2": h2, "H3": not failures},
    "targetAchieved": expected_target, "sample044AtLeast80Preserved": expected_sample044,
    "noClearRateNotIncreased": expected_no_clear,
    "audibleCorrectRate": expected_methods["e9Hierarchical"]["overall"]["clearAndApproximateOnsetRecall"],
    "deltaFromE5": expected_deltas["clearAndApproximateOnsetRecall"],
    "netFixedWeightFromE5": expected_transitions["netFixedWeight"], "failures": failures,
}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 90行候选来源、修正来源、CSV、全部指标和转移独立一致")
print(f"ok: E9正确率={validation['audibleCorrectRate'] * 100:.4f}%，相对E5={validation['deltaFromE5'] * 100:+.4f}pp；H1/H2被拒绝")
print("V568_RESULT_VALIDATION_PASSED")
