# v560: 将冻结 DDC 候选与开发标签连接；不选择阈值、偏移或难度。
from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
V557 = ROOT.parent / "v557"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
METHODS = {"full": "fullResidualMs", "ddcOfficial": "ddcOfficialResidualMs", "ddcParabolic": "ddcParabolicResidualMs"}
TOLERANCE_MS = 5.0
selection = json.loads((V557 / "selection.json").read_text(encoding="utf-8"))
candidates = json.loads((ROOT / "candidates.json").read_text(encoding="utf-8"))
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
assert json.loads((V557 / "annotation-validation.json").read_text(encoding="utf-8"))["passed"] is True
segments = selection["segments"]
by_id = {segment["segmentId"]: segment for segment in segments}
candidate_by_id = {row["segmentId"]: row for row in candidates["rows"]}
assert len(by_id) == len(candidate_by_id) == 90 and set(by_id) == set(candidate_by_id)

annotations = {}
for sample_id in SAMPLES:
    with (V557 / f"annotations-{sample_id}.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            assert row["segmentId"] not in annotations
            annotations[row["segmentId"]] = row
assert set(annotations) == set(by_id)

rows = []
for segment in segments:
    segment_id = segment["segmentId"]
    annotation = annotations[segment_id]
    candidate = candidate_by_id[segment_id]
    confidence = annotation["confidence"]
    assert confidence in {"clear", "approximate", "no_clear_onset"}
    actual = None if confidence == "no_clear_onset" else int(annotation["actualRelativeMs"])
    if actual is not None:
        assert int(annotation["actualOnsetMs"]) == segment["referenceMs"] + actual
    row = {
        "segmentId": segment_id, "sampleId": segment["sampleId"], "stratum": segment["stratum"],
        "weight": float(segment["stratumWeight"]), "referenceMs": segment["referenceMs"],
        "actualOnsetMs": None if actual is None else int(annotation["actualOnsetMs"]),
        "actualRelativeMs": actual, "confidence": confidence,
    }
    for method, field in METHODS.items():
        residual = candidate[field]
        assert residual is None or math.isfinite(residual)
        error = None if residual is None or actual is None else residual - actual
        within5 = None if error is None else abs(error) <= TOLERANCE_MS
        row[f"{method}ResidualMs"] = residual
        row[f"{method}CandidatePresent"] = residual is not None
        row[f"{method}ErrorMs"] = error
        row[f"{method}Within5Ms"] = within5
        row[f"{method}Correct"] = within5 is True
    rows.append(row)


def ratio(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator else None


def metrics(source_rows: list[dict], method: str) -> dict:
    population = sum(row["weight"] for row in source_rows)
    outputs = sum(row["weight"] for row in source_rows if row[f"{method}CandidatePresent"])
    clear = sum(row["weight"] for row in source_rows if row["confidence"] == "clear")
    broad = sum(row["weight"] for row in source_rows if row["confidence"] in {"clear", "approximate"})
    no_clear = sum(row["weight"] for row in source_rows if row["confidence"] == "no_clear_onset")
    no_clear_outputs = sum(row["weight"] for row in source_rows if row["confidence"] == "no_clear_onset" and row[f"{method}CandidatePresent"])
    correct_clear = sum(row["weight"] for row in source_rows if row["confidence"] == "clear" and row[f"{method}Correct"])
    correct_broad = sum(row["weight"] for row in source_rows if row[f"{method}Correct"])
    errors = [row[f"{method}ErrorMs"] for row in source_rows if row[f"{method}ErrorMs"] is not None]
    return {
        "sampleCount": len(source_rows),
        "candidateOutputCount": sum(row[f"{method}CandidatePresent"] for row in source_rows),
        "correctCount": sum(row[f"{method}Correct"] for row in source_rows),
        "populationWeight": population,
        "candidateOutputWeight": outputs,
        "clearWeight": clear,
        "broadWeight": broad,
        "noClearOnsetWeight": no_clear,
        "noClearCandidateOutputWeight": no_clear_outputs,
        "correctClearWeight": correct_clear,
        "correctBroadWeight": correct_broad,
        "candidatePrecision": ratio(correct_broad, outputs),
        "candidateCoverage": ratio(outputs, population),
        "clearOnsetRecall": ratio(correct_clear, clear),
        "clearAndApproximateOnsetRecall": ratio(correct_broad, broad),
        "allObjectCorrectRate": ratio(correct_broad, population),
        "noClearCandidateOutputRate": ratio(no_clear_outputs, no_clear),
        "pairedErrorDiagnosticsNotCalibration": {
            "count": len(errors),
            "medianSignedMs": None if not errors else float(np.median(errors)),
            "medianAbsoluteMs": None if not errors else float(np.median(np.abs(errors))),
            "p95AbsoluteMs": None if not errors else float(np.percentile(np.abs(errors), 95)),
        },
    }


def grouped(source_rows: list[dict], method: str, key: str, values: list[str]) -> dict:
    return {value: metrics([row for row in source_rows if row[key] == value], method) for value in values}


def nearest(peaks: np.ndarray, target: float, radius_ms: float) -> float | None:
    if len(peaks) == 0:
        return None
    position = int(np.searchsorted(peaks, target))
    choices = []
    for index in [position - 1, position, position + 1]:
        if 0 <= index < len(peaks) and abs(float(peaks[index]) - target) <= radius_ms:
            choices.append(float(peaks[index]))
    return None if not choices else min(choices, key=lambda peak: abs(peak - target)) - target


oracle_rows = []
for row in rows:
    if row["actualOnsetMs"] is None:
        continue
    activation = np.load(ROOT / "activations" / f"{row['sampleId']}.npz")
    for method in ["ddcOfficial", "ddcParabolic"]:
        residual = nearest(activation[f"{method}PeakMs"], row["actualOnsetMs"], 20.0)
        oracle_rows.append({"method": method, "weight": row["weight"], "residualMs": residual})

oracle = {}
for method in ["ddcOfficial", "ddcParabolic"]:
    selected = [item for item in oracle_rows if item["method"] == method]
    broad = sum(item["weight"] for item in selected)
    outputs = sum(item["weight"] for item in selected if item["residualMs"] is not None)
    correct = sum(item["weight"] for item in selected if item["residualMs"] is not None and abs(item["residualMs"]) <= TOLERANCE_MS)
    errors = [item["residualMs"] for item in selected if item["residualMs"] is not None]
    oracle[method] = {
        "role": "oracle-centered model-only diagnostic; not a system score and not full detection precision",
        "broadLabelWeight": broad,
        "candidateOutputWeight": outputs,
        "correctWeight": correct,
        "coverageOfBroadLabels": ratio(outputs, broad),
        "within5RateOfBroadLabels": ratio(correct, broad),
        "within5RateOfOutputs": ratio(correct, outputs),
        "medianSignedMs": None if not errors else float(np.median(errors)),
        "medianAbsoluteMs": None if not errors else float(np.median(np.abs(errors))),
        "p95AbsoluteMs": None if not errors else float(np.percentile(np.abs(errors), 95)),
        "warning": "One peak may serve multiple objects; false peaks away from annotated objects are not counted",
    }

methods = {}
for method in METHODS:
    methods[method] = {"overall": metrics(rows, method), "perSample": grouped(rows, method, "sampleId", SAMPLES),
                       "perStratum": grouped(rows, method, "stratum", STRATA)}
    assert math.isclose(methods[method]["overall"]["populationWeight"], 3468.0, abs_tol=1e-9)
label_upper_bound = methods["full"]["overall"]["broadWeight"] / methods["full"]["overall"]["populationWeight"]
assert math.isclose(label_upper_bound, config["knownDevelopmentLabelUpperBound"], rel_tol=0, abs_tol=1e-12)
baselines = {method: {key: methods[method]["overall"][key] - methods["full"]["overall"][key]
                      for key in ["candidatePrecision", "candidateCoverage", "clearOnsetRecall",
                                  "clearAndApproximateOnsetRecall", "allObjectCorrectRate", "noClearCandidateOutputRate"]}
             for method in ["ddcOfficial", "ddcParabolic"]}
shared = [row for row in rows if row["ddcOfficialErrorMs"] is not None and row["ddcParabolicErrorMs"] is not None]
interpolation = {
    "count": len(shared),
    "officialMedianAbsoluteMs": float(np.median([abs(row["ddcOfficialErrorMs"]) for row in shared])) if shared else None,
    "parabolicMedianAbsoluteMs": float(np.median([abs(row["ddcParabolicErrorMs"]) for row in shared])) if shared else None,
    "officialP95AbsoluteMs": float(np.percentile([abs(row["ddcOfficialErrorMs"]) for row in shared], 95)) if shared else None,
    "parabolicP95AbsoluteMs": float(np.percentile([abs(row["ddcParabolicErrorMs"]) for row in shared], 95)) if shared else None,
    "officialWithin5Count": sum(abs(row["ddcOfficialErrorMs"]) <= TOLERANCE_MS for row in shared),
    "parabolicWithin5Count": sum(abs(row["ddcParabolicErrorMs"]) <= TOLERANCE_MS for row in shared),
}
output = {
    "version": "v560-ddc-onset-e3-analysis-v1",
    "status": "development_diagnostic_provisional_visual_blind_labels_not_owner_audited",
    "target": {"allObjectCorrectRateMinimum": 0.8, "absoluteOnsetErrorMsAtMost": TOLERANCE_MS},
    "targetAchieved": {method: methods[method]["overall"]["allObjectCorrectRate"] >= 0.8 for method in METHODS},
    "knownDevelopmentLabelUpperBound": label_upper_bound,
    "candidateRule": config["candidateMatching"],
    "mainMethods": list(METHODS),
    "samples": SAMPLES,
    "strata": STRATA,
    "annotationSummary": {"labeledObjects": len(rows), "confidenceCounts": dict(Counter(row["confidence"] for row in rows))},
    "methods": methods,
    "baselineDeltasVsFull": baselines,
    "interpolationPairedDiagnosticsNotCalibration": interpolation,
    "oracleCenteredModelOnlyDiagnostics": oracle,
    "limitations": [
        "Development-only diagnostic on ninety provisional visual blind labels; not an independent confirmation.",
        "Weighted to the 3468-object population of three songs; no_clear labels impose a 52.7675% all-object upper bound.",
        "Frozen full-envelope delay and phase are reused; paired error statistics are diagnostics, not recalibration.",
        "Oracle-centered diagnostics isolate model timing but reuse annotated centers and cannot measure full-system false positives",
    ],
}
(ROOT / "analysis-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
fields = ["segmentId", "sampleId", "stratum", "weight", "referenceMs", "actualOnsetMs", "actualRelativeMs", "confidence"]
for method in METHODS:
    fields += [f"{method}ResidualMs", f"{method}CandidatePresent", f"{method}ErrorMs", f"{method}Within5Ms", f"{method}Correct"]
with (ROOT / "annotated-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        rendered = {field: row[field] for field in fields}
        for method in METHODS:
            for suffix in ["CandidatePresent", "Within5Ms", "Correct"]:
                key = f"{method}{suffix}"
                rendered[key] = "" if row[key] is None else int(row[key])
        writer.writerow(rendered)
print(json.dumps({method: methods[method]["overall"] for method in METHODS}, ensure_ascii=False))
print(json.dumps({"interpolation": interpolation, "oracle": oracle}, ensure_ascii=False))
print("V560_ANALYSIS_WRITTEN")
