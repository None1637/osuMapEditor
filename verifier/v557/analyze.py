# v557: 三首未调参歌曲的90个盲标完成后，复验冻结full/high候选。
from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
METHODS = {"full": "fullResidualMs", "high": "highResidualMs"}
TOLERANCE_MS = 5.0
selection = json.loads((ROOT / "selection.json").read_text(encoding="utf-8"))
annotation_validation = json.loads((ROOT / "annotation-validation.json").read_text(encoding="utf-8"))
assert annotation_validation["passed"] is True
assert annotation_validation["completedSongs"] == 3
assert annotation_validation["labeledObjects"] == 90
segments = selection["segments"]
assert len(segments) == 90
by_id = {segment["segmentId"]: segment for segment in segments}
assert len(by_id) == 90

annotations: dict[str, dict] = {}
for sample_id in SAMPLES:
    path = ROOT / f"annotations-{sample_id}.csv"
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            segment_id = row["segmentId"]
            assert segment_id not in annotations
            assert segment_id in by_id and by_id[segment_id]["sampleId"] == sample_id
            annotations[segment_id] = row
assert set(annotations) == set(by_id)

rows: list[dict] = []
for segment in segments:
    segment_id = segment["segmentId"]
    annotation = annotations[segment_id]
    confidence = annotation["confidence"]
    assert confidence in {"clear", "approximate", "no_clear_onset"}
    if confidence == "no_clear_onset":
        actual = None
        assert not annotation["actualOnsetMs"] and not annotation["actualRelativeMs"]
    else:
        actual = int(annotation["actualRelativeMs"])
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
        residual = segment[field]
        assert residual is None or math.isfinite(residual)
        error = None if residual is None or actual is None else residual - actual
        within5 = None if error is None else abs(error) <= TOLERANCE_MS
        row[f"{method}ResidualMs"] = residual
        row[f"{method}CandidatePresent"] = residual is not None
        row[f"{method}ErrorMs"] = error
        row[f"{method}Within5Ms"] = within5
        # no_clear、无候选、错误候选都不能成为全物件正确样本。
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
        "perSamplePerStratum": {
            sample_id: grouped_metrics([row for row in rows if row["sampleId"] == sample_id], method, "stratum", STRATA)
            for sample_id in SAMPLES
        },
    }

assert math.isclose(methods["full"]["overall"]["populationWeight"], 3468.0, abs_tol=1e-9)
assert math.isclose(methods["high"]["overall"]["populationWeight"], 3468.0, abs_tol=1e-9)
output = {
    "version": "v557-independent-full-high-onset-review-v1",
    "status": "independent_songs_frozen_candidates_provisional_visual_blind_labels_not_owner_audited",
    "target": {"allObjectCorrectRateMinimum": 0.8, "absoluteOnsetErrorMsAtMost": TOLERANCE_MS},
    "targetAchieved": {
        method: methods[method]["overall"]["allObjectCorrectRate"] >= 0.8
        for method in METHODS
    },
    "candidateRule": "error = candidate residual - independently annotated actual relative onset; no_clear outputs and missing candidates are not correct",
    "weightRule": "stratum population / actually sampled objects; all metrics use these frozen weights",
    "samples": SAMPLES,
    "strata": STRATA,
    "annotationSummary": {
        "labeledObjects": len(rows),
        "confidenceCounts": dict(Counter(row["confidence"] for row in rows)),
        "perSample": {
            sample_id: dict(Counter(row["confidence"] for row in rows if row["sampleId"] == sample_id))
            for sample_id in SAMPLES
        },
    },
    "methods": methods,
    "limitations": [
        "Only three songs and 90 provisional visual blind labels; labels have not been owner-audited by listening.",
        "Stratified estimates are weighted to the 3468-object population of these three songs, not to all osu! songs.",
        "The strata were defined using candidate agreement with map references, so per-stratum results are diagnostic; overall estimates use population weights.",
        "Real-onset recall at least 80% does not imply the all-object 80% target is achieved.",
    ],
}
(ROOT / "analysis-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

fields = [
    "segmentId", "sampleId", "stratum", "weight", "referenceMs", "actualOnsetMs", "actualRelativeMs", "confidence",
]
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
                value = row[key]
                rendered[key] = "" if value is None else int(value)
        writer.writerow(rendered)

print(json.dumps({
    "annotationSummary": output["annotationSummary"],
    "full": methods["full"]["overall"],
    "high": methods["high"]["overall"],
    "targetAchieved": output["targetAchieved"],
}, ensure_ascii=False))
print("V557_INDEPENDENT_ANALYSIS_WRITTEN")
