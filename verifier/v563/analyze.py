# v563: 评估冻结的跨折延迟校准；不选择估计器或修正量。
from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "calibrated-candidates.json").read_text(encoding="utf-8"))
assert payload["configuration"] == config
rows = payload["rows"]
SAMPLES = config["sampleIds"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
METHODS = ["full", "e5Calibrated"]
TOLERANCE_MS = 5.0


def ratio(a: float, b: float) -> float | None:
    return a / b if b else None


def metrics(source: list[dict], method: str) -> dict:
    population = sum(row["weight"] for row in source)
    present = sum(row["weight"] for row in source if row["fullCandidateAbsoluteMs"] is not None)
    clear = sum(row["weight"] for row in source if row["confidence"] == "clear")
    broad = sum(row["weight"] for row in source if row["confidence"] in {"clear", "approximate"})
    no_clear = sum(row["weight"] for row in source if row["confidence"] == "no_clear_onset")
    no_clear_present = sum(row["weight"] for row in source if row["confidence"] == "no_clear_onset" and row["fullCandidateAbsoluteMs"] is not None)
    correct = sum(row["weight"] for row in source if row[f"{method}ErrorMs"] is not None and abs(row[f"{method}ErrorMs"]) <= TOLERANCE_MS)
    correct_clear = sum(row["weight"] for row in source if row["confidence"] == "clear" and row[f"{method}ErrorMs"] is not None and abs(row[f"{method}ErrorMs"]) <= TOLERANCE_MS)
    errors = [row[f"{method}ErrorMs"] for row in source if row[f"{method}ErrorMs"] is not None]
    return {
        "sampleCount": len(source), "candidateOutputCount": sum(row["fullCandidateAbsoluteMs"] is not None for row in source),
        "correctCount": sum(row[f"{method}ErrorMs"] is not None and abs(row[f"{method}ErrorMs"]) <= TOLERANCE_MS for row in source),
        "populationWeight": population, "candidateOutputWeight": present, "clearWeight": clear, "broadWeight": broad,
        "noClearOnsetWeight": no_clear, "noClearCandidateOutputWeight": no_clear_present,
        "correctClearWeight": correct_clear, "correctBroadWeight": correct,
        "candidatePrecision": ratio(correct, present), "candidateCoverage": ratio(present, population),
        "clearOnsetRecall": ratio(correct_clear, clear), "clearAndApproximateOnsetRecall": ratio(correct, broad),
        "allObjectCorrectRate": ratio(correct, population), "noClearCandidateOutputRate": ratio(no_clear_present, no_clear),
        "pairedErrorDiagnosticsNotCalibration": {
            "count": len(errors), "medianSignedMs": None if not errors else float(np.median(errors)),
            "medianAbsoluteMs": None if not errors else float(np.median(np.abs(errors))),
            "p95AbsoluteMs": None if not errors else float(np.percentile(np.abs(errors), 95)),
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
    assert methods["full"]["overall"][key] == methods["e5Calibrated"]["overall"][key]

transitions = {}
for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
    selected = []
    for row in rows:
        old = row["fullErrorMs"] is not None and abs(row["fullErrorMs"]) <= TOLERANCE_MS
        new = row["e5CalibratedErrorMs"] is not None and abs(row["e5CalibratedErrorMs"]) <= TOLERANCE_MS
        current = "bothCorrect" if old and new else ("fixed" if new else ("broken" if old else "bothIncorrect"))
        row["transition"] = current
        if current == category:
            selected.append(row)
    transitions[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
transitions["netFixedWeight"] = transitions["fixed"]["weight"] - transitions["broken"]["weight"]
per_sample_transitions = {}
for sample in SAMPLES:
    subset = [row for row in rows if row["sampleId"] == sample]
    per_sample_transitions[sample] = {}
    for category in ["fixed", "broken"]:
        selected = [row for row in subset if row["transition"] == category]
        per_sample_transitions[sample][category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}

metric_keys = ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]
output = {
    "version": "v563-crossfit-absolute-delay-e5-analysis-v1",
    "status": "development_crossfit_provisional_visual_blind_labels_not_independent_confirmation",
    "target": {"audibleCorrectRateMinimum": 0.8, "absoluteOnsetErrorMsAtMost": 5.0},
    "targetAchieved": methods["e5Calibrated"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8,
    "sample044AtLeast80Preserved": methods["e5Calibrated"]["perSample"]["sample-044"]["clearAndApproximateOnsetRecall"] >= 0.8,
    "methods": methods,
    "baselineDeltas": {key: methods["e5Calibrated"]["overall"][key] - methods["full"]["overall"][key] for key in metric_keys},
    "transitions": transitions, "perSampleTransitions": per_sample_transitions,
    "calibrationRecords": payload["calibrationRecords"],
    "annotationSummary": {"labeledObjects": len(rows), "confidenceCounts": dict(Counter(row["confidence"] for row in rows))},
    "limitations": [
        "Development crossfit on ninety provisional visual blind labels; estimator design was informed by v562 and is not independent confirmation.",
        "Calibration shifts existing candidates only and cannot recover missing or incorrectly selected peaks",
        "Opposite-fold fitting prevents same-object label leakage but does not make the three-song development set an independent test",
    ],
}
(ROOT / "analysis-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
fields = ["segmentId", "sampleId", "stratum", "weight", "referenceMs", "actualOnsetMs", "actualRelativeMs", "confidence",
          "hitIndex", "redlineSegment", "fold", "targetMs", "fullResidualMs", "fullCandidateAbsoluteMs", "fullErrorMs",
          "correctionMs", "e5CalibratedCandidateAbsoluteMs", "e5CalibratedErrorMs", "transition"]
with (ROOT / "calibrated-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps({method: methods[method]["overall"] for method in METHODS}, ensure_ascii=False))
print(json.dumps({"perSample": {sample: methods["e5Calibrated"]["perSample"][sample] for sample in SAMPLES},
                  "transitions": transitions, "perSampleTransitions": per_sample_transitions}, ensure_ascii=False))
print("V563_ANALYSIS_WRITTEN")
