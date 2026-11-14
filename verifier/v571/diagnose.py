# v571: full峰可恢复性oracle诊断，不生成新生产候选。
from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
parity = json.loads((ROOT / "peak-export-parity.json").read_text(encoding="utf-8"))
assert parity["passed"] is True and parity["comparisonRows"] == 90 and parity["exactResidualEquality"] is True
baseline_rows = json.loads((ROOT.parent / "v569" / "gated-candidates.json").read_text(encoding="utf-8"))["rows"]
raw_rows = json.loads((ROOT.parent / "v558" / "candidates.json").read_text(encoding="utf-8"))["rows"]
raw_by_id = {row["segmentId"]: row for row in raw_rows}
CATEGORIES = ["correctPeakSelectedByOldTarget", "correctPeakReachableButNotSelected",
              "correctPeakOutsideOldTargetWindow", "nearbyPeakButOutside5ms", "noFullPeakWithin20ms"]


def nearest(peaks: np.ndarray, target: float, radius: float) -> tuple[float | None, float | None]:
    position = int(np.searchsorted(peaks, target))
    choices = []
    for index in [position - 1, position, position + 1]:
        if 0 <= index < len(peaks):
            peak = float(peaks[index])
            if abs(peak - target) <= radius:
                choices.append(peak)
    if not choices:
        return None, None
    peak = min(choices, key=lambda value: (abs(value - target), value))
    return peak, peak - target


rows = []
for baseline in baseline_rows:
    if baseline["sampleId"] not in config["diagnosticSampleIds"] or baseline["confidence"] not in {"clear", "approximate"}:
        continue
    raw = raw_by_id[baseline["segmentId"]]
    peak_payload = json.loads((ROOT / "per-sample" / f"{baseline['sampleId']}.json").read_text(encoding="utf-8"))
    peaks = np.asarray(peak_payload["fullPeakMs"], dtype=np.float64)
    actual = float(baseline["actualOnsetMs"])
    target = float(raw["targetMs"])
    peak, residual = nearest(peaks, actual, config["actualPeakSearchRadiusMs"])
    selected = None if raw["fullResidualMs"] is None else target + raw["fullResidualMs"]
    if peak is not None and abs(residual) <= config["correctPeakToleranceMs"]:
        if selected is not None and abs(selected - peak) <= 1e-9:
            category = CATEGORIES[0]
        elif abs(peak - target) <= config["oldTargetWindowMs"]:
            category = CATEGORIES[1]
        else:
            category = CATEGORIES[2]
    elif peak is not None:
        category = CATEGORIES[3]
    else:
        category = CATEGORIES[4]
    error = baseline["e10GatedErrorMs"]
    rows.append({"segmentId": baseline["segmentId"], "sampleId": baseline["sampleId"], "fold": baseline["fold"],
        "stratum": baseline["stratum"], "weight": baseline["weight"], "confidence": baseline["confidence"],
        "referenceMs": baseline["referenceMs"], "targetMs": target, "actualOnsetMs": actual,
        "actualMinusTargetMs": actual - target, "nearestFullPeakMs": peak, "nearestFullPeakErrorMs": residual,
        "oldSelectedFullPeakMs": selected, "correctPeakMinusTargetMs": None if peak is None else peak - target,
        "e10GatedCandidateAbsoluteMs": baseline["e10GatedCandidateAbsoluteMs"], "e10GatedErrorMs": error,
        "e10Within5": error is not None and abs(error) <= 5.0, "failureCategory": category})
assert len(rows) == 29 and abs(sum(row["weight"] for row in rows) - 1717.8) < 1e-9


def summarize(source: list[dict]) -> dict:
    total = sum(row["weight"] for row in source)
    incorrect = [row for row in source if not row["e10Within5"]]
    incorrect_weight = sum(row["weight"] for row in incorrect)
    categories = {}
    for category in CATEGORIES:
        selected = [row for row in source if row["failureCategory"] == category]
        wrong = [row for row in selected if not row["e10Within5"]]
        weight, wrong_weight = sum(row["weight"] for row in selected), sum(row["weight"] for row in wrong)
        categories[category] = {"count": len(selected), "weight": weight, "e10IncorrectCount": len(wrong),
            "e10IncorrectWeight": wrong_weight, "shareOfAllWeight": weight / total if total else None,
            "shareOfE10IncorrectWeight": wrong_weight / incorrect_weight if incorrect_weight else None}
    return {"count": len(source), "weight": total, "e10IncorrectCount": len(incorrect),
            "e10IncorrectWeight": incorrect_weight, "categories": categories}


per_sample = {sample: summarize([row for row in rows if row["sampleId"] == sample]) for sample in config["diagnosticSampleIds"]}
combined = summarize(rows)
all_broad = [row for row in baseline_rows if row["confidence"] in {"clear", "approximate"}]
broad_weight = sum(row["weight"] for row in all_broad)
current_correct = sum(row["weight"] for row in all_broad if row["e10GatedErrorMs"] is not None and abs(row["e10GatedErrorMs"]) <= 5.0)
outside = sum(row["weight"] for row in rows if not row["e10Within5"] and row["failureCategory"] == CATEGORIES[2])
all_correct = sum(row["weight"] for row in rows if not row["e10Within5"] and row["failureCategory"] in CATEGORIES[:3])
correct_peak_error_weight = sum(combined["categories"][category]["e10IncorrectWeight"] for category in CATEGORIES[:3])
output = {"version": "v571-full-peak-recoverability-e12-diagnostic-results-v1", "status": config["datasetRole"],
    "configuration": config, "peakExportParity": {"passed": True, "comparisonRows": 90, "exactResidualEquality": True},
    "perSample": per_sample, "combinedTwoSongs": combined,
    "oracleUpperBoundsNotSystemScores": {"overallBroadWeight": broad_weight, "currentE10CorrectWeight": current_correct,
        "currentE10Rate": current_correct / broad_weight, "outsideWindowRecoverableIncorrectWeight": outside,
        "outsideWindowOnlyRateUpperBound": (current_correct + outside) / broad_weight,
        "allCorrectPeakCategoriesRecoverableIncorrectWeight": all_correct,
        "allCorrectPeakCategoriesRateUpperBound": (current_correct + all_correct) / broad_weight,
        "warning": "Annotated centers choose peaks; no false-positive cost, deployable target predictor or new candidate system is measured"},
    "hypotheses": {"H1": correct_peak_error_weight / combined["e10IncorrectWeight"] >= 0.5,
        "H2": (current_correct + all_correct) / broad_weight >= 0.8, "H3": True},
    "annotationSummary": {"audibleObjectsInTwoSongs": len(rows), "confidenceCounts": dict(Counter(row["confidence"] for row in rows))}}
(ROOT / "diagnostic-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
with (ROOT / "full-peak-recoverability.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps({"combinedTwoSongs": combined, "oracleUpperBounds": output["oracleUpperBoundsNotSystemScores"],
                  "hypotheses": output["hypotheses"]}, ensure_ascii=False))
print("V571_DIAGNOSTIC_WRITTEN")
