# v565: 从 v563 独立重建每个留一法修正及所有评估指标。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V563 = ROOT.parent / "v563"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
METHODS = ["full", "e5Calibrated", "e6LeaveOneOut"]
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
source = json.loads((V563 / "calibrated-candidates.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "leave-one-out-candidates.json").read_text(encoding="utf-8"))
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


check(config["status"] == "frozen_before_candidate_evaluation", "E6配置状态改变")
check(config["productionCodeChanged"] is False, "生产代码标志改变")
check(payload["configuration"] == config, "候选配置与冻结配置不同")
check(json.loads((V563 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True, "E5复验未通过")
rows = [dict(row) for row in source["rows"]]
check(len(rows) == len(payload["rows"]) == len(payload["calibrationRecords"]) == 90, "输入输出必须为90行")
records = []
for row in rows:
    fit_rows = [other for other in rows if other["sampleId"] == row["sampleId"]
                and other["segmentId"] != row["segmentId"]
                and other["confidence"] in {"clear", "approximate"}
                and other["fullErrorMs"] is not None and math.isfinite(other["fullErrorMs"])]
    correction = float(statistics.median(other["fullErrorMs"] for other in fit_rows)) \
        if len(fit_rows) >= config["minimumPairs"] else config["fallbackCorrectionMs"]
    record = {"segmentId": row["segmentId"], "sampleId": row["sampleId"], "fold": row["fold"],
              "pairCount": len(fit_rows), "correctionMs": correction,
              "usedFallback": len(fit_rows) < config["minimumPairs"],
              "fitSegmentIds": [other["segmentId"] for other in fit_rows]}
    records.append(record)
    absolute = row["fullCandidateAbsoluteMs"]
    row["e6LeaveOneOutCorrectionMs"] = correction
    row["e6LeaveOneOutCandidateAbsoluteMs"] = None if absolute is None else absolute - correction
    row["e6LeaveOneOutErrorMs"] = None if row["fullErrorMs"] is None else row["fullErrorMs"] - correction

record_by_id = {record["segmentId"]: record for record in payload["calibrationRecords"]}
for expected in records:
    actual = record_by_id.get(expected["segmentId"])
    compare(actual, expected, f"校准记录/{expected['segmentId']}")
    check(expected["segmentId"] not in expected["fitSegmentIds"], f"{expected['segmentId']}使用自身标签")
    for segment_id in expected["fitSegmentIds"]:
        fit = next(row for row in rows if row["segmentId"] == segment_id)
        check(fit["sampleId"] == expected["sampleId"], f"{expected['segmentId']}跨歌曲拟合")
        check(fit["confidence"] in {"clear", "approximate"} and fit["fullErrorMs"] is not None,
              f"{expected['segmentId']}/{segment_id}拟合资格错误")

payload_by_id = {row["segmentId"]: row for row in payload["rows"]}
for expected in rows:
    compare(payload_by_id.get(expected["segmentId"]), expected, f"候选行/{expected['segmentId']}")


def correct(row: dict, method: str) -> bool:
    error = row[f"{method}ErrorMs"]
    return error is not None and abs(error) <= 5.0


for old_method, new_method in [("e5Calibrated", "e6LeaveOneOut"), ("full", "e6LeaveOneOut")]:
    key = f"{old_method}To{new_method}Transition"
    for row in rows:
        old, new = correct(row, old_method), correct(row, new_method)
        row[key] = "bothCorrect" if old and new else ("fixed" if new else ("broken" if old else "bothIncorrect"))

with (ROOT / "leave-one-out-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    comparison = list(csv.DictReader(handle))
check(len(comparison) == 90, "对比CSV必须为90行")
comparison_by_id = {row["segmentId"]: row for row in comparison}
for expected in rows:
    actual = comparison_by_id[expected["segmentId"]]
    for key, value in expected.items():
        if key.startswith("e5CalibratedTo") or key.startswith("fullTo"):
            # CSV列名由analyze.py定义为小写方法名拼接，单独核对见下。
            continue
        if isinstance(value, str):
            check(actual[key] == value, f"CSV/{expected['segmentId']}/{key}")
        else:
            close(None if actual[key] == "" else float(actual[key]), value, f"CSV/{expected['segmentId']}/{key}")
    check(actual["e5CalibratedToe6LeaveOneOutTransition"] == expected["e5CalibratedToe6LeaveOneOutTransition"],
          f"CSV/{expected['segmentId']}/E5转移")
    check(actual["fullToe6LeaveOneOutTransition"] == expected["fullToe6LeaveOneOutTransition"],
          f"CSV/{expected['segmentId']}/full转移")


def div(a: float, b: float) -> float | None:
    return a / b if b else None


def recompute(source_rows: list[dict], method: str) -> dict:
    present = [row for row in source_rows if row["fullCandidateAbsoluteMs"] is not None]
    correct_rows = [row for row in source_rows if correct(row, method)]
    correct_clear = [row for row in correct_rows if row["confidence"] == "clear"]
    clear = [row for row in source_rows if row["confidence"] == "clear"]
    broad = [row for row in source_rows if row["confidence"] in {"clear", "approximate"}]
    no_clear = [row for row in source_rows if row["confidence"] == "no_clear_onset"]
    no_clear_present = [row for row in no_clear if row["fullCandidateAbsoluteMs"] is not None]
    errors = [row[f"{method}ErrorMs"] for row in source_rows if row[f"{method}ErrorMs"] is not None]
    absolute = [abs(value) for value in errors]
    return {
        "sampleCount": len(source_rows), "candidateOutputCount": len(present), "correctCount": len(correct_rows),
        "populationWeight": sum(row["weight"] for row in source_rows),
        "candidateOutputWeight": sum(row["weight"] for row in present),
        "clearWeight": sum(row["weight"] for row in clear), "broadWeight": sum(row["weight"] for row in broad),
        "noClearOnsetWeight": sum(row["weight"] for row in no_clear),
        "noClearCandidateOutputWeight": sum(row["weight"] for row in no_clear_present),
        "correctClearWeight": sum(row["weight"] for row in correct_clear),
        "correctBroadWeight": sum(row["weight"] for row in correct_rows),
        "candidatePrecision": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in present)),
        "candidateCoverage": div(sum(row["weight"] for row in present), sum(row["weight"] for row in source_rows)),
        "clearOnsetRecall": div(sum(row["weight"] for row in correct_clear), sum(row["weight"] for row in clear)),
        "clearAndApproximateOnsetRecall": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in broad)),
        "allObjectCorrectRate": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in source_rows)),
        "noClearCandidateOutputRate": div(sum(row["weight"] for row in no_clear_present), sum(row["weight"] for row in no_clear)),
        "pairedErrorDiagnosticsNotCalibration": {
            "count": len(errors), "medianSignedMs": statistics.median(errors) if errors else None,
            "medianAbsoluteMs": statistics.median(absolute) if absolute else None,
            "p95AbsoluteMs": percentile95(absolute) if absolute else None,
        },
    }


expected_methods = {}
for method in METHODS:
    expected_methods[method] = {
        "overall": recompute(rows, method),
        "perSample": {sample: recompute([row for row in rows if row["sampleId"] == sample], method) for sample in SAMPLES},
        "perStratum": {stratum: recompute([row for row in rows if row["stratum"] == stratum], method) for stratum in STRATA},
        "perFold": {fold: recompute([row for row in rows if row["fold"] == fold], method) for fold in FOLDS},
    }
    compare(result["methods"][method], expected_methods[method], f"指标/{method}")
    for group in ["overall", "perSample", "perStratum", "perFold"]:
        old_group = expected_methods["full"][group]
        new_group = expected_methods[method][group]
        pairs = [(old_group, new_group)] if group == "overall" else [(old_group[key], new_group[key]) for key in old_group]
        for old, new in pairs:
            for metric in ["candidateOutputWeight", "noClearCandidateOutputWeight", "candidateCoverage", "noClearCandidateOutputRate"]:
                close(new[metric], old[metric], f"输出守卫/{method}/{group}/{metric}")

metric_keys = ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]
expected_deltas = {baseline: {key: expected_methods["e6LeaveOneOut"]["overall"][key] - expected_methods[baseline]["overall"][key]
                              for key in metric_keys} for baseline in ["full", "e5Calibrated"]}
compare(result["baselineDeltas"], expected_deltas, "基线差值")


def expected_transitions(old_method: str, new_method: str) -> tuple[dict, dict]:
    key = f"{old_method}To{new_method}Transition"
    output, per_sample = {}, {sample: {} for sample in SAMPLES}
    for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
        selected = [row for row in rows if row[key] == category]
        output[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
        for sample in SAMPLES:
            subset = [row for row in selected if row["sampleId"] == sample]
            per_sample[sample][category] = {"count": len(subset), "weight": sum(row["weight"] for row in subset)}
    output["netFixedWeight"] = output["fixed"]["weight"] - output["broken"]["weight"]
    return output, per_sample


for old_method, result_key, sample_key in [("e5Calibrated", "transitionsE5ToE6", "perSampleTransitionsE5ToE6"),
                                           ("full", "transitionsFullToE6", "perSampleTransitionsFullToE6")]:
    expected, per_sample = expected_transitions(old_method, "e6LeaveOneOut")
    compare(result[result_key], expected, result_key)
    compare(result[sample_key], per_sample, sample_key)

compare(result["annotationSummary"], {"labeledObjects": 90, "confidenceCounts": dict(Counter(row["confidence"] for row in rows))}, "标签汇总")
expected_target = expected_methods["e6LeaveOneOut"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8
expected_sample044 = expected_methods["e6LeaveOneOut"]["perSample"]["sample-044"]["clearAndApproximateOnsetRecall"] >= 0.8
check(result["targetAchieved"] is expected_target, "80%目标标志错误")
check(result["sample044AtLeast80Preserved"] is expected_sample044, "sample-044保持标志错误")
h1 = expected_deltas["e5Calibrated"]["clearAndApproximateOnsetRecall"] > 0
h2 = result["transitionsE5ToE6"]["netFixedWeight"] > 0 and expected_sample044
h3 = not failures
check(not h1, "H1应被负结果拒绝")
check(not h2, "H2应被负结果拒绝")
validation = {
    "version": "v565-leave-one-out-independent-recheck-v1", "passed": not failures,
    "comparisonRows": len(comparison), "calibrationRecords": len(records),
    "selfLabelExclusionVerified": True, "fitPopulationVerified": True, "csvVerified": True,
    "groupsVerified": ["overall", "perSample", "perStratum", "perFold"],
    "outputGuardrailsUnchanged": True,
    "hypotheses": {"H1": h1, "H2": h2, "H3": h3},
    "targetAchieved": expected_target, "sample044AtLeast80Preserved": expected_sample044,
    "audibleCorrectRate": expected_methods["e6LeaveOneOut"]["overall"]["clearAndApproximateOnsetRecall"],
    "deltaFromE5": expected_deltas["e5Calibrated"]["clearAndApproximateOnsetRecall"],
    "netFixedWeightFromE5": result["transitionsE5ToE6"]["netFixedWeight"],
    "failures": failures,
}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 90个留一法修正均排除自身，拟合资格、候选、CSV和所有分组指标独立一致")
print(f"ok: E6有音正确率={validation['audibleCorrectRate'] * 100:.4f}%，相对E5={validation['deltaFromE5'] * 100:+.4f}pp；H1/H2被拒绝，H3成立")
print("V565_RESULT_VALIDATION_PASSED")
