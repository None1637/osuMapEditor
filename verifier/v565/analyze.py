# v565: 评估冻结的 E6，不选择修正量或其他变体。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "leave-one-out-candidates.json").read_text(encoding="utf-8"))
assert payload["configuration"] == config
rows = payload["rows"]
SAMPLES = config["sampleIds"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
METHODS = ["full", "e5Calibrated", "e6LeaveOneOut"]
TOLERANCE_MS = 5.0


def div(a: float, b: float) -> float | None:
    return a / b if b else None


def percentile95(values: list[float]) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * 0.95
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def metrics(source: list[dict], method: str) -> dict:
    error_key = f"{method}ErrorMs"
    present = [row for row in source if row["fullCandidateAbsoluteMs"] is not None]
    correct = [row for row in source if row[error_key] is not None and abs(row[error_key]) <= TOLERANCE_MS]
    correct_clear = [row for row in correct if row["confidence"] == "clear"]
    clear = [row for row in source if row["confidence"] == "clear"]
    broad = [row for row in source if row["confidence"] in {"clear", "approximate"}]
    no_clear = [row for row in source if row["confidence"] == "no_clear_onset"]
    no_clear_present = [row for row in no_clear if row["fullCandidateAbsoluteMs"] is not None]
    errors = [row[error_key] for row in source if row[error_key] is not None]
    absolute = [abs(value) for value in errors]
    return {
        "sampleCount": len(source), "candidateOutputCount": len(present), "correctCount": len(correct),
        "populationWeight": sum(row["weight"] for row in source),
        "candidateOutputWeight": sum(row["weight"] for row in present),
        "clearWeight": sum(row["weight"] for row in clear), "broadWeight": sum(row["weight"] for row in broad),
        "noClearOnsetWeight": sum(row["weight"] for row in no_clear),
        "noClearCandidateOutputWeight": sum(row["weight"] for row in no_clear_present),
        "correctClearWeight": sum(row["weight"] for row in correct_clear),
        "correctBroadWeight": sum(row["weight"] for row in correct),
        "candidatePrecision": div(sum(row["weight"] for row in correct), sum(row["weight"] for row in present)),
        "candidateCoverage": div(sum(row["weight"] for row in present), sum(row["weight"] for row in source)),
        "clearOnsetRecall": div(sum(row["weight"] for row in correct_clear), sum(row["weight"] for row in clear)),
        "clearAndApproximateOnsetRecall": div(sum(row["weight"] for row in correct), sum(row["weight"] for row in broad)),
        "allObjectCorrectRate": div(sum(row["weight"] for row in correct), sum(row["weight"] for row in source)),
        "noClearCandidateOutputRate": div(sum(row["weight"] for row in no_clear_present), sum(row["weight"] for row in no_clear)),
        "pairedErrorDiagnosticsNotCalibration": {
            "count": len(errors), "medianSignedMs": statistics.median(errors) if errors else None,
            "medianAbsoluteMs": statistics.median(absolute) if absolute else None,
            "p95AbsoluteMs": percentile95(absolute) if absolute else None,
        },
    }


def grouped(source: list[dict], method: str, key: str, values: list[str]) -> dict:
    return {value: metrics([row for row in source if row[key] == value], method) for value in values}


methods = {method: {"overall": metrics(rows, method), "perSample": grouped(rows, method, "sampleId", SAMPLES),
                    "perStratum": grouped(rows, method, "stratum", STRATA), "perFold": grouped(rows, method, "fold", FOLDS)}
           for method in METHODS}
for method in METHODS:
    assert math.isclose(methods[method]["overall"]["populationWeight"], 3468.0, abs_tol=1e-9)
    for key in ["candidateOutputWeight", "noClearCandidateOutputWeight", "candidateCoverage", "noClearCandidateOutputRate"]:
        assert methods["full"]["overall"][key] == methods[method]["overall"][key]


def transitions(old_method: str, new_method: str) -> tuple[dict, dict]:
    output = {}
    per_sample = {sample: {} for sample in SAMPLES}
    for row in rows:
        old = row[f"{old_method}ErrorMs"] is not None and abs(row[f"{old_method}ErrorMs"]) <= TOLERANCE_MS
        new = row[f"{new_method}ErrorMs"] is not None and abs(row[f"{new_method}ErrorMs"]) <= TOLERANCE_MS
        category = "bothCorrect" if old and new else ("fixed" if new else ("broken" if old else "bothIncorrect"))
        row[f"{old_method}To{new_method}Transition"] = category
    for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
        selected = [row for row in rows if row[f"{old_method}To{new_method}Transition"] == category]
        output[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
        for sample in SAMPLES:
            subset = [row for row in selected if row["sampleId"] == sample]
            per_sample[sample][category] = {"count": len(subset), "weight": sum(row["weight"] for row in subset)}
    output["netFixedWeight"] = output["fixed"]["weight"] - output["broken"]["weight"]
    return output, per_sample


e5_to_e6, e5_to_e6_samples = transitions("e5Calibrated", "e6LeaveOneOut")
full_to_e6, full_to_e6_samples = transitions("full", "e6LeaveOneOut")
metric_keys = ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]
deltas = {baseline: {key: methods["e6LeaveOneOut"]["overall"][key] - methods[baseline]["overall"][key] for key in metric_keys}
          for baseline in ["full", "e5Calibrated"]}
output = {
    "version": "v565-leave-one-out-absolute-delay-e6-analysis-v1",
    "status": "development_leave_one_out_provisional_visual_blind_labels_not_independent_confirmation",
    "target": {"audibleCorrectRateMinimum": 0.8, "absoluteOnsetErrorMsAtMost": 5.0},
    "targetAchieved": methods["e6LeaveOneOut"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8,
    "sample044AtLeast80Preserved": methods["e6LeaveOneOut"]["perSample"]["sample-044"]["clearAndApproximateOnsetRecall"] >= 0.8,
    "methods": methods, "baselineDeltas": deltas,
    "transitionsE5ToE6": e5_to_e6, "perSampleTransitionsE5ToE6": e5_to_e6_samples,
    "transitionsFullToE6": full_to_e6, "perSampleTransitionsFullToE6": full_to_e6_samples,
    "calibrationRecords": payload["calibrationRecords"],
    "annotationSummary": {"labeledObjects": len(rows), "confidenceCounts": dict(Counter(row["confidence"] for row in rows))},
    "limitations": [
        "Development leave-one-out on ninety provisional visual blind labels; not independent confirmation",
        "Leave-one-out prevents same-object label leakage but all other labels from the same song inform each correction",
        "Calibration shifts existing candidates only and cannot recover missing or incorrectly selected peaks",
    ],
}
(ROOT / "analysis-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
fields = ["segmentId", "sampleId", "stratum", "weight", "referenceMs", "actualOnsetMs", "actualRelativeMs", "confidence",
          "hitIndex", "redlineSegment", "fold", "targetMs", "fullResidualMs", "fullCandidateAbsoluteMs", "fullErrorMs",
          "correctionMs", "e5CalibratedCandidateAbsoluteMs", "e5CalibratedErrorMs", "e6LeaveOneOutCorrectionMs",
          "e6LeaveOneOutCandidateAbsoluteMs", "e6LeaveOneOutErrorMs", "e5CalibratedToe6LeaveOneOutTransition",
          "fullToe6LeaveOneOutTransition"]
with (ROOT / "leave-one-out-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps({method: methods[method]["overall"] for method in METHODS}, ensure_ascii=False))
print(json.dumps({"perSampleE6": methods["e6LeaveOneOut"]["perSample"], "transitionsE5ToE6": e5_to_e6,
                  "perSampleTransitionsE5ToE6": e5_to_e6_samples}, ensure_ascii=False))
print("V565_ANALYSIS_WRITTEN")
