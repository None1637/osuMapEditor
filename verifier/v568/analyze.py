# v568: 评估唯一冻结的层级回退，不挑选歌曲或候选。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "hierarchical-candidates.json").read_text(encoding="utf-8"))
assert payload["configuration"] == config
rows = payload["rows"]
SAMPLES = config["sampleIds"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
METHODS = ["e5Calibrated", "e9Hierarchical"]


def div(a: float, b: float) -> float | None:
    return a / b if b else None


def percentile95(values: list[float]) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * 0.95
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def present(row: dict, method: str) -> bool:
    return row["e9HierarchicalCandidateAbsoluteMs"] is not None if method == "e9Hierarchical" else row["fullCandidateAbsoluteMs"] is not None


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
    old, new = correct(row, "e5Calibrated"), correct(row, "e9Hierarchical")
    row["e5CalibratedToe9HierarchicalTransition"] = "bothCorrect" if old and new else ("fixed" if new else ("broken" if old else "bothIncorrect"))
transitions, per_sample = {}, {sample: {} for sample in SAMPLES}
for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
    selected = [row for row in rows if row["e5CalibratedToe9HierarchicalTransition"] == category]
    transitions[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
    for sample in SAMPLES:
        subset = [row for row in selected if row["sampleId"] == sample]
        per_sample[sample][category] = {"count": len(subset), "weight": sum(row["weight"] for row in subset)}
transitions["netFixedWeight"] = transitions["fixed"]["weight"] - transitions["broken"]["weight"]
metric_keys = ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate", "candidateCoverage", "noClearCandidateOutputRate"]
deltas = {key: methods["e9Hierarchical"]["overall"][key] - methods["e5Calibrated"]["overall"][key] for key in metric_keys}
source_counts = {key: sum(row["e9CandidateSource"] == key for row in rows) for key in ["ddcParabolic", "e5Full"]}
correction_counts = dict(Counter(row["e9CorrectionSource"] for row in rows))
output = {
    "version": "v568-hierarchical-ddc-e5-fusion-e9-analysis-v1",
    "status": "development_crossfit_provisional_visual_blind_labels_not_independent_confirmation",
    "target": {"audibleCorrectRateMinimum": 0.8, "absoluteOnsetErrorMsAtMost": 5.0},
    "targetAchieved": methods["e9Hierarchical"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8,
    "sample044AtLeast80Preserved": methods["e9Hierarchical"]["perSample"]["sample-044"]["clearAndApproximateOnsetRecall"] >= 0.8,
    "noClearRateNotIncreased": methods["e9Hierarchical"]["overall"]["noClearCandidateOutputRate"] <= methods["e5Calibrated"]["overall"]["noClearCandidateOutputRate"],
    "methods": methods, "baselineDeltas": deltas, "transitionsE5ToE9": transitions, "perSampleTransitionsE5ToE9": per_sample,
    "candidateSourceCounts": source_counts, "correctionSourceCounts": correction_counts,
    "annotationSummary": {"labeledObjects": len(rows), "confidenceCounts": dict(Counter(row["confidence"] for row in rows))},
    "limitations": [
        "Development crossfit on ninety provisional visual blind labels; not independent confirmation",
        "DDC candidates remain restricted to the old frozen matching targets; E5 fallback preserves but does not expand that model's coverage",
        "The rule is deterministic but its design was informed by earlier development results",
    ],
}
(ROOT / "analysis-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
fields = ["segmentId", "sampleId", "stratum", "weight", "referenceMs", "actualOnsetMs", "confidence", "hitIndex", "redlineSegment", "fold",
          "e5CalibratedCandidateAbsoluteMs", "e5CalibratedErrorMs", "e8RawCandidateAbsoluteMs", "e8RawErrorMs",
          "e9CandidateSource", "e9CorrectionSource", "e9AppliedCorrectionMs", "e9HierarchicalCandidateAbsoluteMs",
          "e9HierarchicalErrorMs", "e5CalibratedToe9HierarchicalTransition"]
with (ROOT / "hierarchical-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps({method: methods[method]["overall"] for method in METHODS}, ensure_ascii=False))
print(json.dumps({"perSampleE9": methods["e9Hierarchical"]["perSample"], "transitions": transitions,
                  "perSampleTransitions": per_sample, "candidateSources": source_counts, "correctionSources": correction_counts}, ensure_ascii=False))
print("V568_ANALYSIS_WRITTEN")
