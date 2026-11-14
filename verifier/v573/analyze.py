# v573: 一次性揭示冻结E13的保留歌曲确认结果；E5为冻结基线。
from __future__ import annotations

import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "rematched-candidates.json").read_text(encoding="utf-8"))
assert payload["configuration"] == config
rows = payload["rows"]
SAMPLES = config["sampleIds"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
GROUPS = ["constant-hash", "variable-dense-hash", "variable-other-hash"]
METHODS = ["e5Calibrated", "e13CorrectedTargetRematch"]


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
        "populationWeight": sum(row["weight"] for row in source),
        "candidateOutputWeight": sum(row["weight"] for row in outputs),
        "clearWeight": sum(row["weight"] for row in clear), "broadWeight": sum(row["weight"] for row in broad),
        "noClearOnsetWeight": sum(row["weight"] for row in no_clear),
        "noClearCandidateOutputWeight": sum(row["weight"] for row in no_clear_outputs),
        "correctClearWeight": sum(row["weight"] for row in correct_clear),
        "correctBroadWeight": sum(row["weight"] for row in correct_rows),
        "candidatePrecision": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in outputs)),
        "candidateCoverage": div(sum(row["weight"] for row in outputs), sum(row["weight"] for row in source)),
        "clearOnsetRecall": div(sum(row["weight"] for row in correct_clear), sum(row["weight"] for row in clear)),
        "clearAndApproximateOnsetRecall": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in broad)),
        "allObjectCorrectRate": div(sum(row["weight"] for row in correct_rows), sum(row["weight"] for row in source)),
        "noClearCandidateOutputRate": div(sum(row["weight"] for row in no_clear_outputs), sum(row["weight"] for row in no_clear)),
        "pairedErrorDiagnosticsNotCalibration": {
            "count": len(errors), "medianSignedMs": statistics.median(errors) if errors else None,
            "medianAbsoluteMs": statistics.median(absolute) if absolute else None,
            "p95AbsoluteMs": percentile95(absolute) if absolute else None,
        },
    }


def grouped(source: list[dict], method: str, key: str, values: list[str]) -> dict:
    return {value: metrics([row for row in source if row[key] == value], method) for value in values}


methods = {
    method: {
        "overall": metrics(rows, method), "perSample": grouped(rows, method, "sampleId", SAMPLES),
        "perStratum": grouped(rows, method, "stratum", STRATA), "perFold": grouped(rows, method, "fold", FOLDS),
        "perSelectionGroup": grouped(rows, method, "selectionGroup", GROUPS),
    }
    for method in METHODS
}
for method in METHODS:
    assert math.isclose(methods[method]["overall"]["populationWeight"], 5439.0, abs_tol=1e-9)
for row in rows:
    old, new = correct(row, "e5Calibrated"), correct(row, "e13CorrectedTargetRematch")
    row["e5CalibratedToe13CorrectedTargetRematchTransition"] = (
        "bothCorrect" if old and new else ("fixed" if new else ("broken" if old else "bothIncorrect"))
    )
transitions, per_sample = {}, {sample: {} for sample in SAMPLES}
for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
    selected = [row for row in rows if row["e5CalibratedToe13CorrectedTargetRematchTransition"] == category]
    transitions[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
    for sample in SAMPLES:
        subset = [row for row in selected if row["sampleId"] == sample]
        per_sample[sample][category] = {"count": len(subset), "weight": sum(row["weight"] for row in subset)}
transitions["netFixedWeight"] = transitions["fixed"]["weight"] - transitions["broken"]["weight"]
metric_keys = [
    "candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall",
    "allObjectCorrectRate", "candidateCoverage", "noClearCandidateOutputRate",
]
deltas = {
    key: methods["e13CorrectedTargetRematch"]["overall"][key] - methods["e5Calibrated"]["overall"][key]
    for key in metric_keys
}
h1 = methods["e13CorrectedTargetRematch"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8
no_clear_not_increased = (
    methods["e13CorrectedTargetRematch"]["overall"]["noClearCandidateOutputRate"]
    <= methods["e5Calibrated"]["overall"]["noClearCandidateOutputRate"]
)
h2 = transitions["netFixedWeight"] > 0 and no_clear_not_increased
output = {
    "version": "v573-independent-song-confirmation-analysis-v1",
    "status": "reserved_song_level_confirmation_revealed_once_after_frozen_labels_and_rule",
    "target": {"audibleCorrectRateMinimum": 0.8, "absoluteOnsetErrorMsAtMost": 5.0},
    "targetAchieved": h1,
    "hypothesesBeforeIndependentRecheck": {"H1": h1, "H2": h2, "H3": None},
    "noClearRateNotIncreased": no_clear_not_increased,
    "methods": methods, "baselineDeltas": deltas,
    "transitionsE5ToE13": transitions, "perSampleTransitionsE5ToE13": per_sample,
    "candidateSourceCounts": {
        "e5Calibrated": dict(Counter(row["e5CandidateSource"] for row in rows)),
        "e13CorrectedTargetRematch": dict(Counter(row["e13CandidateSource"] for row in rows)),
    },
    "annotationSummary": {"labeledObjects": len(rows), "confidenceCounts": dict(Counter(row["confidence"] for row in rows))},
    "limitations": [
        "Six reserved songs with 180 provisional visual blind labels; labels are not human auditory ground truth",
        "Opposite-fold calibration uses labels within each confirmation song; this is not a fully label-free deployment result",
        "Per-song and selection-group results are descriptive; the 80% threshold applies only to the weighted overall primary metric",
        "No production code was changed and this result alone does not establish deployment readiness",
    ],
}
(ROOT / "analysis-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
fields = [
    "segmentId", "sampleId", "selectionGroup", "stratum", "fold", "weight", "referenceMs", "actualOnsetMs", "confidence",
    "hitIndex", "targetMs", "fullResidualMs", "oldTargetFullCandidateAbsoluteMs", "fitFold", "fitPairCount", "correctionMs",
    "e5CalibratedCandidateAbsoluteMs", "e5CalibratedErrorMs", "e5CandidateSource", "e13CorrectedCenterMs",
    "e13CorrectedTargetRematchCandidateAbsoluteMs", "e13CorrectedTargetRematchErrorMs", "e13CandidateSource",
    "e5CalibratedToe13CorrectedTargetRematchTransition", "fitSegmentIds",
]
import csv
with (ROOT / "rematched-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps({method: methods[method]["overall"] for method in METHODS}, ensure_ascii=False))
print(json.dumps({
    "perSampleE13": methods["e13CorrectedTargetRematch"]["perSample"],
    "perSelectionGroupE13": methods["e13CorrectedTargetRematch"]["perSelectionGroup"],
    "transitions": transitions, "hypotheses": output["hypothesesBeforeIndependentRecheck"],
}, ensure_ascii=False))
print("V573_ANALYSIS_WRITTEN")
