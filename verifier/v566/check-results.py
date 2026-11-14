# v566: 独立复算 E7 校准、指标、CSV和转移；原始音频候选由check-raw.ts复验。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
METHODS = ["full", "e5Calibrated", "e7Slope"]
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
raw = json.loads((ROOT / "raw-candidates.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "refined-candidates.json").read_text(encoding="utf-8"))
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


check(config["status"] == "frozen_before_candidate_evaluation", "E7配置状态改变")
check(config["productionCodeChanged"] is False, "生产代码标志改变")
check(json.loads((ROOT / "raw-validation.json").read_text(encoding="utf-8"))["passed"] is True, "原始音频候选复验未通过")
check(raw["configuration"] == payload["configuration"] == config, "候选配置不一致")
rows = [dict(row) for row in raw["rows"]]
check(len(rows) == len(payload["rows"]) == 90, "输入输出必须为90行")
for row in rows:
    absolute, actual = row["e7RawCandidateAbsoluteMs"], row["actualOnsetMs"]
    row["e7RawErrorMs"] = None if absolute is None or actual is None else absolute - actual

records = []
for sample in SAMPLES:
    for fold in FOLDS:
        opposite = "even" if fold == "odd" else "odd"
        fit_rows = [row for row in rows if row["sampleId"] == sample and row["fold"] == opposite
                    and row["confidence"] in {"clear", "approximate"} and row["e7RawErrorMs"] is not None]
        correction = float(statistics.median(row["e7RawErrorMs"] for row in fit_rows)) if len(fit_rows) >= 3 else 0.0
        records.append({"sampleId": sample, "fold": fold, "fitFold": opposite, "pairCount": len(fit_rows),
                        "correctionMs": correction, "usedFallback": len(fit_rows) < 3,
                        "fitSegmentIds": [row["segmentId"] for row in fit_rows]})
record_by_key = {(record["sampleId"], record["fold"]): record for record in records}
for actual, expected in zip(payload["calibrationRecords"], records):
    compare(actual, expected, f"校准记录/{expected['sampleId']}/{expected['fold']}")
    check(actual["fitFold"] != actual["fold"], "同折拟合")

for row in rows:
    record = record_by_key[(row["sampleId"], row["fold"])]
    check(row["segmentId"] not in record["fitSegmentIds"], f"{row['segmentId']}自身标签泄漏")
    correction = record["correctionMs"]
    absolute = row["e7RawCandidateAbsoluteMs"]
    row["e7SlopeCorrectionMs"] = correction
    row["e7SlopeCandidateAbsoluteMs"] = None if absolute is None else absolute - correction
    row["e7SlopeErrorMs"] = None if row["e7RawErrorMs"] is None else row["e7RawErrorMs"] - correction
payload_by_id = {row["segmentId"]: row for row in payload["rows"]}
for expected in rows:
    compare(payload_by_id.get(expected["segmentId"]), expected, f"候选行/{expected['segmentId']}")


def correct(row: dict, method: str) -> bool:
    error = row[f"{method}ErrorMs"]
    return error is not None and abs(error) <= 5.0


for old_method in ["e5Calibrated", "full"]:
    key = f"{old_method}Toe7SlopeTransition"
    for row in rows:
        old, new = correct(row, old_method), correct(row, "e7Slope")
        row[key] = "bothCorrect" if old and new else ("fixed" if new else ("broken" if old else "bothIncorrect"))

with (ROOT / "refined-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    comparison = list(csv.DictReader(handle))
check(len(comparison) == 90, "CSV必须为90行")
comparison_by_id = {row["segmentId"]: row for row in comparison}
for expected in rows:
    actual = comparison_by_id[expected["segmentId"]]
    for key, value in expected.items():
        if isinstance(value, str):
            check(actual[key] == value, f"CSV/{expected['segmentId']}/{key}")
        else:
            close(None if actual[key] == "" else float(actual[key]), value, f"CSV/{expected['segmentId']}/{key}")


def div(a: float, b: float) -> float | None:
    return a / b if b else None


def recompute(source: list[dict], method: str) -> dict:
    present = [row for row in source if row["fullCandidateAbsoluteMs"] is not None]
    correct_rows = [row for row in source if correct(row, method)]
    correct_clear = [row for row in correct_rows if row["confidence"] == "clear"]
    clear = [row for row in source if row["confidence"] == "clear"]
    broad = [row for row in source if row["confidence"] in {"clear", "approximate"}]
    no_clear = [row for row in source if row["confidence"] == "no_clear_onset"]
    no_clear_present = [row for row in no_clear if row["fullCandidateAbsoluteMs"] is not None]
    errors = [row[f"{method}ErrorMs"] for row in source if row[f"{method}ErrorMs"] is not None]
    absolute = [abs(value) for value in errors]
    return {
        "sampleCount": len(source), "candidateOutputCount": len(present), "correctCount": len(correct_rows),
        "populationWeight": sum(row["weight"] for row in source), "candidateOutputWeight": sum(row["weight"] for row in present),
        "clearWeight": sum(row["weight"] for row in clear), "broadWeight": sum(row["weight"] for row in broad),
        "noClearOnsetWeight": sum(row["weight"] for row in no_clear),
        "noClearCandidateOutputWeight": sum(row["weight"] for row in no_clear_present),
        "correctClearWeight": sum(row["weight"] for row in correct_clear), "correctBroadWeight": sum(row["weight"] for row in correct_rows),
        "candidatePrecision": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in present)),
        "candidateCoverage": div(sum(row["weight"] for row in present), sum(row["weight"] for row in source)),
        "clearOnsetRecall": div(sum(row["weight"] for row in correct_clear), sum(row["weight"] for row in clear)),
        "clearAndApproximateOnsetRecall": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in broad)),
        "allObjectCorrectRate": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in source)),
        "noClearCandidateOutputRate": div(sum(row["weight"] for row in no_clear_present), sum(row["weight"] for row in no_clear)),
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
    for key in ["candidateOutputWeight", "noClearCandidateOutputWeight", "candidateCoverage", "noClearCandidateOutputRate"]:
        close(expected_methods[method]["overall"][key], expected_methods["full"]["overall"][key], f"输出守卫/{method}/{key}")

metric_keys = ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]
expected_deltas = {baseline: {key: expected_methods["e7Slope"]["overall"][key] - expected_methods[baseline]["overall"][key]
                              for key in metric_keys} for baseline in ["full", "e5Calibrated"]}
compare(result["baselineDeltas"], expected_deltas, "基线差值")
for old_method, result_key, sample_key in [("e5Calibrated", "transitionsE5ToE7", "perSampleTransitionsE5ToE7"),
                                           ("full", "transitionsFullToE7", "perSampleTransitionsFullToE7")]:
    transition_key = f"{old_method}Toe7SlopeTransition"
    expected, per_sample = {}, {sample: {} for sample in SAMPLES}
    for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
        selected = [row for row in rows if row[transition_key] == category]
        expected[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
        for sample in SAMPLES:
            subset = [row for row in selected if row["sampleId"] == sample]
            per_sample[sample][category] = {"count": len(subset), "weight": sum(row["weight"] for row in subset)}
    expected["netFixedWeight"] = expected["fixed"]["weight"] - expected["broken"]["weight"]
    compare(result[result_key], expected, result_key)
    compare(result[sample_key], per_sample, sample_key)
compare(result["annotationSummary"], {"labeledObjects": 90, "confidenceCounts": dict(Counter(row["confidence"] for row in rows))}, "标签汇总")
expected_target = expected_methods["e7Slope"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8
expected_sample044 = expected_methods["e7Slope"]["perSample"]["sample-044"]["clearAndApproximateOnsetRecall"] >= 0.8
check(result["targetAchieved"] is expected_target, "80%目标标志错误")
check(result["sample044AtLeast80Preserved"] is expected_sample044, "sample-044保持标志错误")
h1 = expected_deltas["e5Calibrated"]["clearAndApproximateOnsetRecall"] > 0
h2 = result["transitionsE5ToE7"]["netFixedWeight"] > 0 and expected_sample044
check(not h1 and not h2, "H1/H2应被负结果拒绝")
validation = {
    "version": "v566-local-rising-edge-independent-recheck-v1", "passed": not failures,
    "comparisonRows": len(comparison), "calibrationRecords": len(records), "rawAudioCandidatesVerified": True,
    "oppositeFoldIsolationVerified": True, "csvVerified": True,
    "groupsVerified": ["overall", "perSample", "perStratum", "perFold"], "outputGuardrailsUnchanged": True,
    "hypotheses": {"H1": h1, "H2": h2, "H3": not failures},
    "targetAchieved": expected_target, "sample044AtLeast80Preserved": expected_sample044,
    "audibleCorrectRate": expected_methods["e7Slope"]["overall"]["clearAndApproximateOnsetRecall"],
    "deltaFromE5": expected_deltas["e5Calibrated"]["clearAndApproximateOnsetRecall"],
    "netFixedWeightFromE5": result["transitionsE5ToE7"]["netFixedWeight"], "failures": failures,
}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 原始音频候选、90行反折校准、CSV、全部指标和转移独立一致")
print(f"ok: E7有音正确率={validation['audibleCorrectRate'] * 100:.4f}%，相对E5={validation['deltaFromE5'] * 100:+.4f}pp；H1/H2被拒绝")
print("V566_RESULT_VALIDATION_PASSED")
