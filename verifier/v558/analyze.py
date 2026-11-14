# v558: 将冻结候选与v557标签连接，按原人口权重计算E1全部指标。
from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V557 = ROOT.parent / "v557"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
METHODS = {
    "full": "fullResidualMs",
    "lag5": "lag5ResidualMs",
    "superflux": "superfluxResidualMs",
    "fullGlobal": "fullGlobalResidualMs",
    "lag5Global": "lag5GlobalResidualMs",
    "superfluxGlobal": "superfluxGlobalResidualMs",
}
MAIN_METHODS = ["full", "lag5", "superflux"]
TOLERANCE_MS = 5.0
selection = json.loads((V557 / "selection.json").read_text(encoding="utf-8"))
candidates = json.loads((ROOT / "candidates.json").read_text(encoding="utf-8"))
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
annotation_validation = json.loads((V557 / "annotation-validation.json").read_text(encoding="utf-8"))
assert annotation_validation["passed"] is True
segments = selection["segments"]
assert len(segments) == 90
by_id = {segment["segmentId"]: segment for segment in segments}
candidate_by_id = {row["segmentId"]: row for row in candidates["rows"]}
assert len(candidate_by_id) == 90 and set(candidate_by_id) == set(by_id)
assert candidates["differenceFrames"] == config["expectedDifferenceFrames"] == 5

annotations: dict[str, dict] = {}
for sample_id in SAMPLES:
    with (V557 / f"annotations-{sample_id}.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            assert row["segmentId"] not in annotations
            annotations[row["segmentId"]] = row
assert set(annotations) == set(by_id)

rows: list[dict] = []
for segment in segments:
    segment_id = segment["segmentId"]
    annotation = annotations[segment_id]
    candidate = candidate_by_id[segment_id]
    assert candidate["baselineResidualAbsDifferenceMs"] == 0
    confidence = annotation["confidence"]
    assert confidence in {"clear", "approximate", "no_clear_onset"}
    actual = None if confidence == "no_clear_onset" else int(annotation["actualRelativeMs"])
    if actual is not None:
        assert int(annotation["actualOnsetMs"]) == segment["referenceMs"] + actual
    row = {
        "segmentId": segment_id,
        "sampleId": segment["sampleId"],
        "stratum": segment["stratum"],
        "weight": float(segment["stratumWeight"]),
        "referenceMs": segment["referenceMs"],
        "actualOnsetMs": None if actual is None else int(annotation["actualOnsetMs"]),
        "actualRelativeMs": actual,
        "confidence": confidence,
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
    }


def grouped_metrics(source_rows: list[dict], method: str, key: str, values: list[str]) -> dict:
    return {value: metrics([row for row in source_rows if row[key] == value], method) for value in values}


methods: dict[str, dict] = {}
for method in METHODS:
    methods[method] = {
        "overall": metrics(rows, method),
        "perSample": grouped_metrics(rows, method, "sampleId", SAMPLES),
        "perStratum": grouped_metrics(rows, method, "stratum", STRATA),
    }
    assert math.isclose(methods[method]["overall"]["populationWeight"], 3468.0, abs_tol=1e-9)

baseline_deltas = {}
for method in ["lag5", "superflux", "fullGlobal", "lag5Global", "superfluxGlobal"]:
    baseline_deltas[method] = {
        key: methods[method]["overall"][key] - methods["full"]["overall"][key]
        for key in ["candidatePrecision", "candidateCoverage", "clearOnsetRecall",
                    "clearAndApproximateOnsetRecall", "allObjectCorrectRate", "noClearCandidateOutputRate"]
    }

output = {
    "version": "v558-superflux-e1-analysis-v1",
    "status": "frozen_e1_candidates_provisional_visual_blind_labels_not_owner_audited",
    "target": {"allObjectCorrectRateMinimum": 0.8, "absoluteOnsetErrorMsAtMost": TOLERANCE_MS},
    "targetAchieved": {method: methods[method]["overall"]["allObjectCorrectRate"] >= 0.8 for method in METHODS},
    "candidateRule": "Frozen v557 targets and weights; error = candidate residual - independently annotated actual relative onset",
    "mainMethods": MAIN_METHODS,
    "globalOnlyControls": config["globalOnlyControls"],
    "samples": SAMPLES,
    "strata": STRATA,
    "annotationSummary": {
        "labeledObjects": len(rows),
        "confidenceCounts": dict(Counter(row["confidence"] for row in rows)),
    },
    "methods": methods,
    "baselineDeltasVsFull": baseline_deltas,
    "limitations": [
        "Ninety provisional visual blind labels on three songs; not owner-audited by listening.",
        "Weighted to the 3468-object population of these three songs, not all osu! songs.",
        "Any further tuning on these results turns this set into development data and requires a new confirmation set.",
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
print("V558_ANALYSIS_WRITTEN")
