# v567: 评估冻结的 DDC parabolic 校准结果，不添加 full 回退。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "ddc-calibrated-candidates.json").read_text(encoding="utf-8"))
assert payload["configuration"] == config
rows = payload["rows"]
SAMPLES = config["sampleIds"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
METHODS = ["full", "e5Calibrated", "e8DdcParabolic"]


def div(a: float, b: float) -> float | None:
    return a / b if b else None


def percentile95(values: list[float]) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * 0.95
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def present(row: dict, method: str) -> bool:
    return row["e8RawCandidateAbsoluteMs"] is not None if method == "e8DdcParabolic" else row["fullCandidateAbsoluteMs"] is not None


def correct(row: dict, method: str) -> bool:
    error = row[f"{method}ErrorMs"]
    return error is not None and abs(error) <= 5.0


def metrics(source: list[dict], method: str) -> dict:
    outputs = [row for row in source if present(row, method)]
    correct_rows = [row for row in source if correct(row, method)]
    correct_clear = [row for row in correct_rows if row["confidence"] == "clear"]
    clear = [row for row in source if row["confidence"] == "clear"]
    broad = [row for row in source if row["confidence"] in {"clear", "approximate"}]
    no_clear = [row for row in source if row["confidence"] == "no_clear_onset"]
    no_clear_outputs = [row for row in no_clear if present(row, method)]
    errors = [row[f"{method}ErrorMs"] for row in source if row[f"{method}ErrorMs"] is not None]
    absolute = [abs(value) for value in errors]
    return {
        "sampleCount": len(source), "candidateOutputCount": len(outputs), "correctCount": len(correct_rows),
        "populationWeight": sum(row["weight"] for row in source), "candidateOutputWeight": sum(row["weight"] for row in outputs),
        "clearWeight": sum(row["weight"] for row in clear), "broadWeight": sum(row["weight"] for row in broad),
        "noClearOnsetWeight": sum(row["weight"] for row in no_clear),
        "noClearCandidateOutputWeight": sum(row["weight"] for row in no_clear_outputs),
        "correctClearWeight": sum(row["weight"] for row in correct_clear), "correctBroadWeight": sum(row["weight"] for row in correct_rows),
        "candidatePrecision": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in outputs)),
        "candidateCoverage": div(sum(row["weight"] for row in outputs), sum(row["weight"] for row in source)),
        "clearOnsetRecall": div(sum(row["weight"] for row in correct_clear), sum(row["weight"] for row in clear)),
        "clearAndApproximateOnsetRecall": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in broad)),
        "allObjectCorrectRate": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in source)),
        "noClearCandidateOutputRate": div(sum(row["weight"] for row in no_clear_outputs), sum(row["weight"] for row in no_clear)),
        "pairedErrorDiagnosticsNotCalibration": {"count": len(errors),
            "medianSignedMs": statistics.median(errors) if errors else None,
            "medianAbsoluteMs": statistics.median(absolute) if absolute else None,
            "p95AbsoluteMs": percentile95(absolute) if absolute else None},
    }


def grouped(source: list[dict], method: str, key: str, values: list[str]) -> dict:
    return {value: metrics([row for row in source if row[key] == value], method) for value in values}


methods = {method: {"overall": metrics(rows, method), "perSample": grouped(rows, method, "sampleId", SAMPLES),
                    "perStratum": grouped(rows, method, "stratum", STRATA), "perFold": grouped(rows, method, "fold", FOLDS)}
           for method in METHODS}
for method in METHODS:
    assert math.isclose(methods[method]["overall"]["populationWeight"], 3468.0, abs_tol=1e-9)


def add_transitions(old_method: str, new_method: str) -> tuple[dict, dict]:
    key = f"{old_method}To{new_method}Transition"
    for row in rows:
        old, new = correct(row, old_method), correct(row, new_method)
        row[key] = "bothCorrect" if old and new else ("fixed" if new else ("broken" if old else "bothIncorrect"))
    output, per_sample = {}, {sample: {} for sample in SAMPLES}
    for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
        selected = [row for row in rows if row[key] == category]
        output[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
        for sample in SAMPLES:
            subset = [row for row in selected if row["sampleId"] == sample]
            per_sample[sample][category] = {"count": len(subset), "weight": sum(row["weight"] for row in subset)}
    output["netFixedWeight"] = output["fixed"]["weight"] - output["broken"]["weight"]
    return output, per_sample


e5_to_e8, e5_to_e8_samples = add_transitions("e5Calibrated", "e8DdcParabolic")
full_to_e8, full_to_e8_samples = add_transitions("full", "e8DdcParabolic")
metric_keys = ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]
deltas = {baseline: {key: methods["e8DdcParabolic"]["overall"][key] - methods[baseline]["overall"][key] for key in metric_keys}
          for baseline in ["full", "e5Calibrated"]}
output = {
    "version": "v567-ddc-parabolic-crossfit-e8-analysis-v1",
    "status": "development_crossfit_provisional_visual_blind_labels_not_independent_confirmation",
    "target": {"audibleCorrectRateMinimum": 0.8, "absoluteOnsetErrorMsAtMost": 5.0},
    "targetAchieved": methods["e8DdcParabolic"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8,
    "sample044AtLeast80Preserved": methods["e8DdcParabolic"]["perSample"]["sample-044"]["clearAndApproximateOnsetRecall"] >= 0.8,
    "methods": methods, "baselineDeltas": deltas,
    "transitionsE5ToE8": e5_to_e8, "perSampleTransitionsE5ToE8": e5_to_e8_samples,
    "transitionsFullToE8": full_to_e8, "perSampleTransitionsFullToE8": full_to_e8_samples,
    "calibrationRecords": payload["calibrationRecords"],
    "annotationSummary": {"labeledObjects": len(rows), "confidenceCounts": dict(Counter(row["confidence"] for row in rows))},
    "limitations": [
        "Development crossfit on ninety provisional visual blind labels; not independent confirmation",
        "Frozen DDC candidates were originally matched near the old target and have lower availability than full",
        "No full fallback is allowed; missing DDC candidates count as incorrect for audible recall",
    ],
}
(ROOT / "analysis-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
fields = ["segmentId", "sampleId", "stratum", "weight", "referenceMs", "actualOnsetMs", "actualRelativeMs", "confidence",
          "hitIndex", "redlineSegment", "fold", "targetMs", "fullResidualMs", "fullCandidateAbsoluteMs", "fullErrorMs",
          "correctionMs", "e5CalibratedCandidateAbsoluteMs", "e5CalibratedErrorMs", "e8RawResidualMs", "e8RawCandidateAbsoluteMs",
          "e8RawErrorMs", "e8DdcParabolicCorrectionMs", "e8DdcParabolicCandidateAbsoluteMs", "e8DdcParabolicErrorMs",
          "e5CalibratedToe8DdcParabolicTransition", "fullToe8DdcParabolicTransition"]
with (ROOT / "ddc-calibrated-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps({method: methods[method]["overall"] for method in METHODS}, ensure_ascii=False))
print(json.dumps({"perSampleE8": methods["e8DdcParabolic"]["perSample"], "transitionsE5ToE8": e5_to_e8,
                  "perSampleTransitionsE5ToE8": e5_to_e8_samples}, ensure_ascii=False))
print("V567_ANALYSIS_WRITTEN")
