# v570: 标注中心oracle诊断，分解旧target窗口与DDC缺峰，不生成生产候选。
from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_diagnostic_evaluation"
baseline_payload = json.loads((ROOT.parent / "v569" / "gated-candidates.json").read_text(encoding="utf-8"))
baseline_rows = baseline_payload["rows"]
raw_rows = json.loads((ROOT.parent / "v560" / "candidates.json").read_text(encoding="utf-8"))["rows"]
raw_by_id = {row["segmentId"]: row for row in raw_rows}
CATEGORIES = ["correctPeakSelectedByOldTarget", "correctPeakReachableButNotSelected",
              "correctPeakOutsideOldTargetWindow", "nearbyPeakButOutside5ms", "noOfficialPeakWithin20ms"]


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
    if baseline["sampleId"] not in config["sampleIds"] or baseline["confidence"] not in {"clear", "approximate"}:
        continue
    raw = raw_by_id[baseline["segmentId"]]
    activation = np.load(ROOT.parent / "v560" / "activations" / f"{baseline['sampleId']}.npz")
    peaks = activation[config["peakRepresentation"]]
    actual = float(baseline["actualOnsetMs"])
    target = float(raw["targetMs"])
    peak, residual = nearest(peaks, actual, config["actualPeakSearchRadiusMs"])
    selected = None if raw["ddcOfficialResidualMs"] is None else target + raw["ddcOfficialResidualMs"]
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
    rows.append({
        "segmentId": baseline["segmentId"], "sampleId": baseline["sampleId"], "fold": baseline["fold"],
        "stratum": baseline["stratum"], "weight": baseline["weight"], "confidence": baseline["confidence"],
        "referenceMs": baseline["referenceMs"], "targetMs": target, "actualOnsetMs": actual,
        "actualMinusTargetMs": actual - target, "nearestOfficialPeakMs": peak,
        "nearestOfficialPeakErrorMs": residual, "oldSelectedOfficialPeakMs": selected,
        "correctPeakMinusTargetMs": None if peak is None else peak - target,
        "e10GatedCandidateAbsoluteMs": baseline["e10GatedCandidateAbsoluteMs"], "e10GatedErrorMs": error,
        "e10Within5": error is not None and abs(error) <= 5.0, "failureCategory": category,
    })
assert len(rows) == 29
assert abs(sum(row["weight"] for row in rows) - 1717.8) < 1e-9


def summarize(source: list[dict]) -> dict:
    total = sum(row["weight"] for row in source)
    incorrect = [row for row in source if not row["e10Within5"]]
    by_category = {}
    for category in CATEGORIES:
        selected = [row for row in source if row["failureCategory"] == category]
        wrong = [row for row in selected if not row["e10Within5"]]
        by_category[category] = {
            "count": len(selected), "weight": sum(row["weight"] for row in selected),
            "e10IncorrectCount": len(wrong), "e10IncorrectWeight": sum(row["weight"] for row in wrong),
            "shareOfAllWeight": sum(row["weight"] for row in selected) / total if total else None,
            "shareOfE10IncorrectWeight": sum(row["weight"] for row in wrong) / sum(row["weight"] for row in incorrect) if incorrect else None,
        }
    return {"count": len(source), "weight": total, "e10IncorrectCount": len(incorrect),
            "e10IncorrectWeight": sum(row["weight"] for row in incorrect), "categories": by_category}


per_sample = {sample: summarize([row for row in rows if row["sampleId"] == sample]) for sample in config["sampleIds"]}
combined = summarize(rows)
all_broad = [row for row in baseline_rows if row["confidence"] in {"clear", "approximate"}]
broad_weight = sum(row["weight"] for row in all_broad)
current_correct = sum(row["weight"] for row in all_broad if row["e10GatedErrorMs"] is not None and abs(row["e10GatedErrorMs"]) <= 5.0)
outside_recoverable = sum(row["weight"] for row in rows if not row["e10Within5"] and row["failureCategory"] == CATEGORIES[2])
all_correct_peak_recoverable = sum(row["weight"] for row in rows if not row["e10Within5"] and row["failureCategory"] in CATEGORIES[:3])
output = {
    "version": "v570-ddc-target-window-failure-decomposition-e11-diagnostic-results-v1",
    "status": config["datasetRole"], "configuration": config, "perSample": per_sample, "combinedTwoSongs": combined,
    "oracleUpperBoundsNotSystemScores": {
        "overallBroadWeight": broad_weight, "currentE10CorrectWeight": current_correct,
        "currentE10Rate": current_correct / broad_weight,
        "outsideWindowRecoverableIncorrectWeight": outside_recoverable,
        "outsideWindowOnlyRateUpperBound": (current_correct + outside_recoverable) / broad_weight,
        "allCorrectPeakCategoriesRecoverableIncorrectWeight": all_correct_peak_recoverable,
        "allCorrectPeakCategoriesRateUpperBound": (current_correct + all_correct_peak_recoverable) / broad_weight,
        "warning": "Annotated centers choose peaks; no false-positive cost, deployable target predictor or new candidate system is measured",
    },
    "hypotheses": {
        "H1": combined["categories"][CATEGORIES[2]]["shareOfE10IncorrectWeight"] >= 0.2,
        "H2": (current_correct + outside_recoverable) / broad_weight < 0.8,
        "H3": True,
    },
    "annotationSummary": {"audibleObjectsInTwoSongs": len(rows), "confidenceCounts": dict(Counter(row["confidence"] for row in rows))},
}
(ROOT / "diagnostic-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
fields = list(rows[0])
with (ROOT / "window-failure-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps({"combinedTwoSongs": combined, "oracleUpperBounds": output["oracleUpperBoundsNotSystemScores"],
                  "hypotheses": output["hypotheses"]}, ensure_ascii=False))
print("V570_DIAGNOSTIC_WRITTEN")
