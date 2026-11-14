# v567: 从v560/v563独立重建DDC绝对候选、反折校准和全部指标。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V560 = ROOT.parent / "v560"
V563 = ROOT.parent / "v563"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
METHODS = ["full", "e5Calibrated", "e8DdcParabolic"]
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
source = json.loads((V560 / "candidates.json").read_text(encoding="utf-8"))
metadata = json.loads((V563 / "calibrated-candidates.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "ddc-calibrated-candidates.json").read_text(encoding="utf-8"))
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


check(config["status"] == "frozen_before_candidate_evaluation", "E8配置状态改变")
check(config["productionCodeChanged"] is False, "生产代码标志改变")
check(json.loads((V560 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True, "v560结果复验未通过")
check(json.loads((V560 / "parity-results.json").read_text(encoding="utf-8"))["passed"] is True, "DDC官方parity未通过")
check(json.loads((V563 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True, "E5复验未通过")
source_by_id = {row["segmentId"]: row for row in source["rows"]}
rows = [dict(row) for row in metadata["rows"]]
check(len(rows) == len(payload["rows"]) == len(source_by_id) == 90, "输入输出必须为90行")
for row in rows:
    candidate = source_by_id[row["segmentId"]]
    close(candidate["targetMs"], row["targetMs"], f"{row['segmentId']}/目标中心")
    residual = candidate[config["candidateField"]]
    absolute = None if residual is None else row["targetMs"] + residual
    actual = row["actualOnsetMs"]
    row["e8RawResidualMs"] = residual
    row["e8RawCandidateAbsoluteMs"] = absolute
    row["e8RawErrorMs"] = None if absolute is None or actual is None else absolute - actual

records = []
for sample in SAMPLES:
    for fold in FOLDS:
        opposite = "even" if fold == "odd" else "odd"
        fit_rows = [row for row in rows if row["sampleId"] == sample and row["fold"] == opposite
                    and row["confidence"] in {"clear", "approximate"} and row["e8RawErrorMs"] is not None]
        correction = float(statistics.median(row["e8RawErrorMs"] for row in fit_rows)) if len(fit_rows) >= 3 else 0.0
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
    absolute = row["e8RawCandidateAbsoluteMs"]
    row["e8DdcParabolicCorrectionMs"] = correction
    row["e8DdcParabolicCandidateAbsoluteMs"] = None if absolute is None else absolute - correction
    row["e8DdcParabolicErrorMs"] = None if row["e8RawErrorMs"] is None else row["e8RawErrorMs"] - correction
payload_by_id = {row["segmentId"]: row for row in payload["rows"]}
for expected in rows:
    compare(payload_by_id.get(expected["segmentId"]), expected, f"候选行/{expected['segmentId']}")


def present(row: dict, method: str) -> bool:
    return row["e8RawCandidateAbsoluteMs"] is not None if method == "e8DdcParabolic" else row["fullCandidateAbsoluteMs"] is not None


def correct(row: dict, method: str) -> bool:
    error = row[f"{method}ErrorMs"]
    return error is not None and abs(error) <= 5.0


for old_method in ["e5Calibrated", "full"]:
    key = f"{old_method}Toe8DdcParabolicTransition"
    for row in rows:
        old, new = correct(row, old_method), correct(row, "e8DdcParabolic")
        row[key] = "bothCorrect" if old and new else ("fixed" if new else ("broken" if old else "bothIncorrect"))
with (ROOT / "ddc-calibrated-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
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
# 校准前后DDC候选存在性必须逐件一致。
for row in rows:
    check((row["e8RawCandidateAbsoluteMs"] is not None) == (row["e8DdcParabolicCandidateAbsoluteMs"] is not None),
          f"{row['segmentId']}/校准改变DDC候选存在性")
metric_keys = ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]
expected_deltas = {baseline: {key: expected_methods["e8DdcParabolic"]["overall"][key] - expected_methods[baseline]["overall"][key]
                              for key in metric_keys} for baseline in ["full", "e5Calibrated"]}
compare(result["baselineDeltas"], expected_deltas, "基线差值")
for old_method, result_key, sample_key in [("e5Calibrated", "transitionsE5ToE8", "perSampleTransitionsE5ToE8"),
                                           ("full", "transitionsFullToE8", "perSampleTransitionsFullToE8")]:
    transition_key = f"{old_method}Toe8DdcParabolicTransition"
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
expected_target = expected_methods["e8DdcParabolic"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8
expected_sample044 = expected_methods["e8DdcParabolic"]["perSample"]["sample-044"]["clearAndApproximateOnsetRecall"] >= 0.8
check(result["targetAchieved"] is expected_target, "80%目标标志错误")
check(result["sample044AtLeast80Preserved"] is expected_sample044, "sample-044保持标志错误")
h1 = expected_deltas["e5Calibrated"]["clearAndApproximateOnsetRecall"] > 0
h2 = result["transitionsE5ToE8"]["netFixedWeight"] > 0 and expected_sample044
check(not h1 and not h2, "H1/H2应被总体负结果拒绝")
validation = {
    "version": "v567-ddc-parabolic-independent-recheck-v1", "passed": not failures,
    "comparisonRows": len(comparison), "calibrationRecords": len(records), "frozenDdcCandidatesVerified": True,
    "officialParityVerified": True, "oppositeFoldIsolationVerified": True, "csvVerified": True,
    "groupsVerified": ["overall", "perSample", "perStratum", "perFold"], "candidateAvailabilityUnchangedByCalibration": True,
    "hypotheses": {"H1": h1, "H2": h2, "H3": not failures},
    "targetAchieved": expected_target, "sample044AtLeast80Preserved": expected_sample044,
    "audibleCorrectRate": expected_methods["e8DdcParabolic"]["overall"]["clearAndApproximateOnsetRecall"],
    "candidateCoverage": expected_methods["e8DdcParabolic"]["overall"]["candidateCoverage"],
    "deltaFromE5": expected_deltas["e5Calibrated"]["clearAndApproximateOnsetRecall"],
    "netFixedWeightFromE5": result["transitionsE5ToE8"]["netFixedWeight"], "failures": failures,
}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 90行DDC绝对候选、6组反折校准、候选存在性、CSV和全部指标独立一致")
print(f"ok: E8正确率={validation['audibleCorrectRate'] * 100:.4f}%，覆盖率={validation['candidateCoverage'] * 100:.4f}%；H1/H2被拒绝")
print("V567_RESULT_VALIDATION_PASSED")
