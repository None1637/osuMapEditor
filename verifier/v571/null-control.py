# v571: ±50ms移位空对照，审计密集full峰的oracle自由度，不生成候选。
from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "null-control.json").read_text(encoding="utf-8"))
main = json.loads((ROOT / "diagnostic-results.json").read_text(encoding="utf-8"))
baseline_rows = json.loads((ROOT.parent / "v569" / "gated-candidates.json").read_text(encoding="utf-8"))["rows"]
peaks_by_sample = {sample: np.asarray(json.loads((ROOT / "per-sample" / f"{sample}.json").read_text(encoding="utf-8"))["fullPeakMs"], dtype=np.float64)
                   for sample in ["sample-032", "sample-002"]}
rows = []
for baseline in baseline_rows:
    if baseline["sampleId"] not in peaks_by_sample or baseline["confidence"] not in {"clear", "approximate"}:
        continue
    error = baseline["e10GatedErrorMs"]
    for shift in config["shiftsMs"]:
        center = float(baseline["actualOnsetMs"]) + shift
        peaks = peaks_by_sample[baseline["sampleId"]]
        nearby = [float(peak) for peak in peaks if abs(float(peak) - center) <= config["searchRadiusMs"]]
        peak = min(nearby, key=lambda value: (abs(value - center), value)) if nearby else None
        rows.append({"segmentId": baseline["segmentId"], "sampleId": baseline["sampleId"], "shiftMs": shift,
                     "weight": baseline["weight"], "e10Within5": error is not None and abs(error) <= 5.0,
                     "shiftedCenterMs": center, "nearestFullPeakMs": peak, "nullPeakWithin5": peak is not None})
assert len(rows) == 58


def coverage(source: list[dict]) -> dict:
    total = sum(row["weight"] for row in source)
    incorrect = [row for row in source if not row["e10Within5"]]
    incorrect_total = sum(row["weight"] for row in incorrect)
    hits = [row for row in source if row["nullPeakWithin5"]]
    incorrect_hits = [row for row in incorrect if row["nullPeakWithin5"]]
    return {"count": len(source), "weight": total, "peakWithin5Weight": sum(row["weight"] for row in hits),
            "peakWithin5Rate": sum(row["weight"] for row in hits) / total,
            "e10IncorrectWeight": incorrect_total,
            "e10IncorrectPeakWithin5Weight": sum(row["weight"] for row in incorrect_hits),
            "e10IncorrectPeakWithin5Rate": sum(row["weight"] for row in incorrect_hits) / incorrect_total}


per_shift = {str(shift): coverage([row for row in rows if row["shiftMs"] == shift]) for shift in config["shiftsMs"]}
combined = coverage(rows)
actual_correct_weight = sum(main["combinedTwoSongs"]["categories"][category]["weight"]
                            for category in ["correctPeakSelectedByOldTarget", "correctPeakReachableButNotSelected", "correctPeakOutsideOldTargetWindow"])
actual_error_weight = sum(main["combinedTwoSongs"]["categories"][category]["e10IncorrectWeight"]
                          for category in ["correctPeakSelectedByOldTarget", "correctPeakReachableButNotSelected", "correctPeakOutsideOldTargetWindow"])
output = {"version": config["version"], "configuration": config, "perShift": per_shift, "combinedShifts": combined,
          "actualCenterReference": {"allCorrectPeakWeight": actual_correct_weight,
              "allCorrectPeakRate": actual_correct_weight / main["combinedTwoSongs"]["weight"],
              "e10IncorrectCorrectPeakWeight": actual_error_weight,
              "e10IncorrectCorrectPeakRate": actual_error_weight / main["combinedTwoSongs"]["e10IncorrectWeight"]},
          "interpretation": "High shifted-center coverage means the actual-centered oracle has substantial trivial selection freedom and is not evidence of deployable selectability"}
(ROOT / "null-control-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
with (ROOT / "null-control-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps(output, ensure_ascii=False))
print("V571_NULL_CONTROL_WRITTEN")
