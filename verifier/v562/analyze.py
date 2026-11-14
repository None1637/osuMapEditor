# v562: 用各方法自己的绝对目标中心修正历史误差；不改任何候选或算法参数。
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
TOLERANCE_MS = 5.0
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "evaluation_correction_before_metrics"
assert config["productionCodeChanged"] is False
method_definitions = config["methodDefinitions"]
method_names = [item["name"] for item in method_definitions]
assert len(method_names) == len(set(method_names))
source_rows = {}
for source in {item["source"] for item in method_definitions}:
    payload = json.loads((ROOT.parent / source / "candidates.json").read_text(encoding="utf-8"))
    assert payload["configuration"] == json.loads((ROOT.parent / source / "experiment.json").read_text(encoding="utf-8"))
    assert json.loads((ROOT.parent / source / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
    source_rows[source] = {row["segmentId"]: row for row in payload["rows"]}
selection = json.loads((V557 / "selection.json").read_text(encoding="utf-8"))
segments = selection["segments"]
assert len(segments) == 90
annotations = {}
for sample_id in SAMPLES:
    with (V557 / f"annotations-{sample_id}.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            assert row["segmentId"] not in annotations
            annotations[row["segmentId"]] = row
assert set(annotations) == {row["segmentId"] for row in segments}

rows = []
for segment in segments:
    segment_id = segment["segmentId"]
    annotation = annotations[segment_id]
    confidence = annotation["confidence"]
    actual = None if confidence == "no_clear_onset" else int(annotation["actualRelativeMs"])
    actual_onset = None if actual is None else int(annotation["actualOnsetMs"])
    if actual is not None:
        assert actual_onset == segment["referenceMs"] + actual
    row = {"segmentId": segment_id, "sampleId": segment["sampleId"], "stratum": segment["stratum"],
           "weight": float(segment["stratumWeight"]), "referenceMs": segment["referenceMs"],
           "actualOnsetMs": actual_onset, "actualRelativeMs": actual, "confidence": confidence}
    for definition in method_definitions:
        name, source, field = definition["name"], definition["source"], definition["field"]
        candidate = source_rows[source][segment_id]
        residual = candidate[field]
        if definition["targetRule"] == "crossFit":
            target_offset = candidate["targetMs"] - candidate["referenceMs"]
            assert math.isclose(target_offset, candidate["globalDelayMs"] + candidate["phaseMs"], abs_tol=1e-9)
        else:
            target_offset = candidate["globalDelayMs"]
        corrected_error = None if residual is None or actual is None else residual + target_offset - actual
        legacy_error = None if residual is None or actual is None else residual - actual
        row[f"{name}ResidualMs"] = residual
        row[f"{name}TargetOffsetMs"] = target_offset
        row[f"{name}CandidatePresent"] = residual is not None
        row[f"{name}ErrorMs"] = corrected_error
        row[f"{name}LegacyErrorMs"] = legacy_error
        row[f"{name}Correct"] = corrected_error is not None and abs(corrected_error) <= TOLERANCE_MS
        row[f"{name}LegacyCorrect"] = legacy_error is not None and abs(legacy_error) <= TOLERANCE_MS
    rows.append(row)


def ratio(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator else None


def metrics(source: list[dict], method: str, legacy: bool = False) -> dict:
    suffix = "LegacyCorrect" if legacy else "Correct"
    error_field = "LegacyErrorMs" if legacy else "ErrorMs"
    population = sum(row["weight"] for row in source)
    outputs = sum(row["weight"] for row in source if row[f"{method}CandidatePresent"])
    clear = sum(row["weight"] for row in source if row["confidence"] == "clear")
    broad = sum(row["weight"] for row in source if row["confidence"] in {"clear", "approximate"})
    no_clear = sum(row["weight"] for row in source if row["confidence"] == "no_clear_onset")
    no_clear_outputs = sum(row["weight"] for row in source if row["confidence"] == "no_clear_onset" and row[f"{method}CandidatePresent"])
    correct_clear = sum(row["weight"] for row in source if row["confidence"] == "clear" and row[f"{method}{suffix}"])
    correct_broad = sum(row["weight"] for row in source if row[f"{method}{suffix}"])
    errors = [row[f"{method}{error_field}"] for row in source if row[f"{method}{error_field}"] is not None]
    return {
        "sampleCount": len(source), "candidateOutputCount": sum(row[f"{method}CandidatePresent"] for row in source),
        "correctCount": sum(row[f"{method}{suffix}"] for row in source), "populationWeight": population,
        "candidateOutputWeight": outputs, "clearWeight": clear, "broadWeight": broad,
        "noClearOnsetWeight": no_clear, "noClearCandidateOutputWeight": no_clear_outputs,
        "correctClearWeight": correct_clear, "correctBroadWeight": correct_broad,
        "candidatePrecision": ratio(correct_broad, outputs), "candidateCoverage": ratio(outputs, population),
        "clearOnsetRecall": ratio(correct_clear, clear), "clearAndApproximateOnsetRecall": ratio(correct_broad, broad),
        "allObjectCorrectRate": ratio(correct_broad, population), "noClearCandidateOutputRate": ratio(no_clear_outputs, no_clear),
        "pairedErrorDiagnosticsNotCalibration": {
            "count": len(errors), "medianSignedMs": None if not errors else float(np.median(errors)),
            "medianAbsoluteMs": None if not errors else float(np.median(np.abs(errors))),
            "p95AbsoluteMs": None if not errors else float(np.percentile(np.abs(errors), 95)),
        },
    }


def grouped(source: list[dict], method: str, key: str, values: list[str]) -> dict:
    return {value: metrics([row for row in source if row[key] == value], method) for value in values}


corrected = {}
legacy = {}
for method in method_names:
    corrected[method] = {"overall": metrics(rows, method), "perSample": grouped(rows, method, "sampleId", SAMPLES),
                         "perStratum": grouped(rows, method, "stratum", STRATA)}
    legacy[method] = {"overall": metrics(rows, method, legacy=True)}
    assert math.isclose(corrected[method]["overall"]["populationWeight"], 3468.0, abs_tol=1e-9)

metric_keys = ["candidatePrecision", "candidateCoverage", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate", "noClearCandidateOutputRate"]
deltas = {method: {key: corrected[method]["overall"][key] - corrected["e1Full"]["overall"][key] for key in metric_keys}
          for method in method_names if method != "e1Full"}
correction_impact = {method: {key: corrected[method]["overall"][key] - legacy[method]["overall"][key]
                              for key in ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]}
                     for method in method_names}

full_rows = [row for row in rows if row["confidence"] in {"clear", "approximate"}]
def full_category(row: dict) -> str:
    error = row["e1FullErrorMs"]
    if error is None:
        return "missingOrNoPairedError"
    absolute = abs(error)
    if absolute <= 5:
        return "within5"
    if absolute <= 10:
        return "over5Through10"
    return "over10"
full_decomposition = {}
for category in ["within5", "over5Through10", "over10", "missingOrNoPairedError"]:
    selected = [row for row in full_rows if full_category(row) == category]
    full_decomposition[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
full_decomposition["broadWeight"] = sum(row["weight"] for row in full_rows)

fusion_transitions = {}
for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
    selected = []
    for row in rows:
        full_correct, fusion_correct = row["e1FullCorrect"], row["e4FusionCorrect"]
        current = "bothCorrect" if full_correct and fusion_correct else ("fixed" if fusion_correct else ("broken" if full_correct else "bothIncorrect"))
        if current == category:
            selected.append(row)
    fusion_transitions[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
fusion_transitions["netFixedWeight"] = fusion_transitions["fixed"]["weight"] - fusion_transitions["broken"]["weight"]

output = {
    "version": "v562-absolute-time-error-correction-analysis-v1",
    "status": "corrected_development_metrics_provisional_visual_blind_labels_not_owner_audited",
    "target": {"audibleCorrectRateMinimum": 0.8, "absoluteOnsetErrorMsAtMost": 5.0,
               "definition": config["primaryMetric"]},
    "targetAchieved": {method: corrected[method]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8 for method in method_names},
    "correctErrorFormula": config["correctErrorFormula"], "legacyErrorFormula": config["legacyErrorFormula"],
    "methodDefinitions": method_definitions, "samples": SAMPLES, "strata": STRATA,
    "annotationSummary": {"labeledObjects": len(rows), "confidenceCounts": dict(Counter(row["confidence"] for row in rows))},
    "correctedMethods": corrected, "legacyMethods": legacy, "correctionImpact": correction_impact,
    "baselineDeltasVsE1FullCorrected": deltas, "e1FullAudibleErrorDecomposition": full_decomposition,
    "e4FusionTransitionsCorrected": fusion_transitions,
    "limitations": [
        "Ninety provisional visual blind labels on three development songs; not an independent confirmation.",
        "Correcting the time-base formula changes evaluation only; no candidate or algorithm parameter changes.",
        "no_clear labels are excluded from the audible target denominator and retained as a false-output guardrail",
    ],
}
(ROOT / "analysis-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
fields = ["segmentId", "sampleId", "stratum", "weight", "referenceMs", "actualOnsetMs", "actualRelativeMs", "confidence"]
for method in method_names:
    fields += [f"{method}ResidualMs", f"{method}TargetOffsetMs", f"{method}ErrorMs", f"{method}LegacyErrorMs", f"{method}Correct", f"{method}LegacyCorrect"]
with (ROOT / "corrected-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        rendered = {field: row[field] for field in fields}
        for method in method_names:
            for suffix in ["Correct", "LegacyCorrect"]:
                rendered[f"{method}{suffix}"] = int(row[f"{method}{suffix}"])
        writer.writerow(rendered)
print(json.dumps({method: corrected[method]["overall"] for method in method_names}, ensure_ascii=False))
print(json.dumps({"correctionImpact": correction_impact, "fullDecomposition": full_decomposition,
                  "fusionTransitions": fusion_transitions}, ensure_ascii=False))
print("V562_CORRECTED_ANALYSIS_WRITTEN")
