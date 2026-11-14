# v569: 评估冻结的无标签整曲门控，不做阈值扫描或单曲覆盖。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "gated-candidates.json").read_text(encoding="utf-8"))
assert payload["configuration"] == config
rows = payload["rows"]
SAMPLES = config["sampleIds"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
METHODS = ["e5Calibrated", "e10Gated"]


def div(a: float, b: float) -> float | None:
    return a / b if b else None


def percentile95(values: list[float]) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * 0.95
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def present(row: dict, method: str) -> bool:
    return row[f"{method}CandidateAbsoluteMs"] is not None


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
for row in rows:
    old, new = correct(row, "e5Calibrated"), correct(row, "e10Gated")
    row["e5CalibratedToe10GatedTransition"] = "bothCorrect" if old and new else ("fixed" if new else ("broken" if old else "bothIncorrect"))
transitions, per_sample = {}, {sample: {} for sample in SAMPLES}
for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
    selected = [row for row in rows if row["e5CalibratedToe10GatedTransition"] == category]
    transitions[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
    for sample in SAMPLES:
        subset = [row for row in selected if row["sampleId"] == sample]
        per_sample[sample][category] = {"count": len(subset), "weight": sum(row["weight"] for row in subset)}
transitions["netFixedWeight"] = transitions["fixed"]["weight"] - transitions["broken"]["weight"]
metric_keys = ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate", "candidateCoverage", "noClearCandidateOutputRate"]
deltas = {key: methods["e10Gated"]["overall"][key] - methods["e5Calibrated"]["overall"][key] for key in metric_keys}
source_counts = dict(Counter(row["e10CandidateSource"] for row in rows))
correction_counts = dict(Counter(row["e10CorrectionSource"] for row in rows))
output = {
    "version": "v569-label-free-song-gate-e10-analysis-v1",
    "status": "development_crossfit_provisional_visual_blind_labels_not_independent_confirmation",
    "target": {"audibleCorrectRateMinimum": 0.8, "absoluteOnsetErrorMsAtMost": 5.0},
    "targetAchieved": methods["e10Gated"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8,
    "sample044AtLeast80Preserved": methods["e10Gated"]["perSample"]["sample-044"]["clearAndApproximateOnsetRecall"] >= 0.8,
    "noClearRateNotIncreased": methods["e10Gated"]["overall"]["noClearCandidateOutputRate"] <= methods["e5Calibrated"]["overall"]["noClearCandidateOutputRate"],
    "methods": methods, "baselineDeltas": deltas, "transitionsE5ToE10": transitions, "perSampleTransitionsE5ToE10": per_sample,
    "gateRecords": payload["gateRecords"], "candidateSourceCounts": source_counts, "correctionSourceCounts": correction_counts,
    "annotationSummary": {"labeledObjects": len(rows), "confidenceCounts": dict(Counter(row["confidence"] for row in rows))},
    "limitations": [
        "Development crossfit on ninety provisional visual blind labels; not independent confirmation",
        "The whole-song gate is label-free but its minimum-10-per-fold threshold was designed on development songs",
        "Enabled songs still use opposite-fold calibration and frozen targets; no production generalization claim",
    ],
}
(ROOT / "analysis-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
fields = ["segmentId", "sampleId", "stratum", "weight", "referenceMs", "actualOnsetMs", "confidence", "hitIndex", "redlineSegment", "fold",
          "e5CalibratedCandidateAbsoluteMs", "e5CalibratedErrorMs", "e8RawCandidateAbsoluteMs", "e8RawErrorMs",
          "e10DdcEnabledForWholeSong", "e10CandidateSource", "e10CorrectionSource", "e10AppliedCorrectionMs",
          "e10GatedCandidateAbsoluteMs", "e10GatedErrorMs", "e5CalibratedToe10GatedTransition"]
with (ROOT / "gated-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps({method: methods[method]["overall"] for method in METHODS}, ensure_ascii=False))
print(json.dumps({"gateRecords": payload["gateRecords"], "perSampleE10": methods["e10Gated"]["perSample"],
                  "transitions": transitions, "candidateSources": source_counts, "correctionSources": correction_counts}, ensure_ascii=False))
print("V569_ANALYSIS_WRITTEN")
