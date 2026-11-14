# v564: 只诊断冻结的 E5 残差，不平移、不选峰、不搜索新参数。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V548 = ROOT.parent / "v548"
V563 = ROOT.parent / "v563"
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_diagnostic_evaluation"
assert config["productionCodeChanged"] is False
assert config["candidateSelectionChanged"] is False
assert config["calibrationChanged"] is False
assert json.loads((V563 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
payload = json.loads((V563 / "calibrated-candidates.json").read_text(encoding="utf-8"))
redlines = {sample: json.loads((V548 / "per-sample" / f"{sample}.json").read_text(encoding="utf-8"))["redlines"]
            for sample in config["sampleIds"]}


def percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def spearman(rows: list[dict]) -> float | None:
    """带并列秩的 Pearson 秩相关；仅用于诊断时间漂移。"""
    if len(rows) < 3:
        return None

    def ranks(values: list[float]) -> list[float]:
        order = sorted(range(len(values)), key=values.__getitem__)
        result = [0.0] * len(values)
        start = 0
        while start < len(order):
            end = start + 1
            while end < len(order) and values[order[end]] == values[order[start]]:
                end += 1
            rank = (start + end - 1) / 2.0 + 1.0
            for position in range(start, end):
                result[order[position]] = rank
            start = end
        return result

    x = ranks([float(row["referenceMs"]) for row in rows])
    y = ranks([float(row["e5CalibratedErrorMs"]) for row in rows])
    mean_x, mean_y = statistics.mean(x), statistics.mean(y)
    covariance = sum((a - mean_x) * (b - mean_y) for a, b in zip(x, y))
    variance_x = sum((a - mean_x) ** 2 for a in x)
    variance_y = sum((b - mean_y) ** 2 for b in y)
    return None if variance_x == 0 or variance_y == 0 else covariance / math.sqrt(variance_x * variance_y)


def error_band(error: float | None) -> str:
    if error is None:
        return "missingCandidate"
    absolute = abs(error)
    if absolute <= 5.0:
        return "within5"
    if absolute <= 10.0:
        return "over5Through10"
    if absolute <= 20.0:
        return "over10Through20"
    return "over20"


rows = []
for source in payload["rows"]:
    if source["confidence"] not in {"clear", "approximate"}:
        continue
    row = dict(source)
    segment = row["redlineSegment"]
    if segment >= 0:
        redline = redlines[row["sampleId"]][segment]
        row["redlineStartMs"] = redline["timeMs"]
        row["redlineEndMs"] = redline["endMs"]
        row["redlineBpm"] = redline["bpm"]
    else:
        row["redlineStartMs"] = None
        row["redlineEndMs"] = None
        row["redlineBpm"] = None
    row["errorBand"] = error_band(row["e5CalibratedErrorMs"])
    rows.append(row)

fields = ["segmentId", "sampleId", "referenceMs", "confidence", "weight", "hitIndex", "fold",
          "redlineSegment", "redlineStartMs", "redlineEndMs", "redlineBpm", "correctionMs",
          "targetMs", "fullResidualMs", "fullCandidateAbsoluteMs", "actualOnsetMs",
          "e5CalibratedCandidateAbsoluteMs", "e5CalibratedErrorMs", "errorBand"]
with (ROOT / "residual-details.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)


def summarize(source: list[dict]) -> dict:
    paired = [row for row in source if row["e5CalibratedErrorMs"] is not None]
    errors = [float(row["e5CalibratedErrorMs"]) for row in paired]
    absolute = [abs(value) for value in errors]
    median = statistics.median(errors) if errors else None
    counts = Counter(row["errorBand"] for row in source)
    weights = {band: sum(row["weight"] for row in source if row["errorBand"] == band) for band in config["errorBands"]}
    total_weight = sum(row["weight"] for row in source)
    return {
        "audibleCount": len(source),
        "pairedCount": len(paired),
        "missingCount": counts["missingCandidate"],
        "audibleWeight": total_weight,
        "correctWeight": weights["within5"],
        "within5RateIncludingMissing": weights["within5"] / total_weight if total_weight else None,
        "bandCounts": {band: counts[band] for band in config["errorBands"]},
        "bandWeights": weights,
        "medianSignedMs": median,
        "medianAbsoluteMs": statistics.median(absolute) if absolute else None,
        "medianAbsoluteDeviationMs": statistics.median([abs(value - median) for value in errors]) if errors else None,
        "p95AbsoluteMs": percentile(absolute, 0.95) if absolute else None,
        "maximumAbsoluteMs": max(absolute) if absolute else None,
        "spearmanSignedErrorVsTime": spearman(paired),
    }


def grouped(key_function) -> dict:
    keys = sorted({key_function(row) for row in rows}, key=str)
    return {str(key): summarize([row for row in rows if key_function(row) == key]) for key in keys}


per_sample = {sample: summarize([row for row in rows if row["sampleId"] == sample]) for sample in config["sampleIds"]}
per_fold = grouped(lambda row: (row["sampleId"], row["fold"]))
per_redline = grouped(lambda row: (row["sampleId"], row["redlineSegment"]))
per_redline_fold = grouped(lambda row: (row["sampleId"], row["redlineSegment"], row["fold"]))
fold_contrasts = []
for sample in config["sampleIds"]:
    segments = sorted({row["redlineSegment"] for row in rows if row["sampleId"] == sample})
    for segment in segments:
        subset = [row for row in rows if row["sampleId"] == sample and row["redlineSegment"] == segment]
        odd = [row for row in subset if row["fold"] == "odd" and row["e5CalibratedErrorMs"] is not None]
        even = [row for row in subset if row["fold"] == "even" and row["e5CalibratedErrorMs"] is not None]
        if len(odd) < 2 or len(even) < 2:
            continue
        odd_median = statistics.median(row["e5CalibratedErrorMs"] for row in odd)
        even_median = statistics.median(row["e5CalibratedErrorMs"] for row in even)
        fold_contrasts.append({
            "sampleId": sample, "redlineSegment": segment,
            "oddPairs": len(odd), "evenPairs": len(even),
            "oddMedianMs": odd_median, "evenMedianMs": even_median,
            "oddMinusEvenMs": odd_median - even_median,
        })

histogram = {}
for sample in config["sampleIds"]:
    errors = [row["e5CalibratedErrorMs"] for row in rows
              if row["sampleId"] == sample and row["e5CalibratedErrorMs"] is not None]
    bins = Counter(math.floor((error + 2.5) / 5.0) * 5 for error in errors)
    histogram[sample] = {str(int(center)): bins[center] for center in sorted(bins)}

output = {
    "version": config["version"],
    "status": "development_residual_diagnostic_not_a_new_estimator",
    "configuration": config,
    "overall": summarize(rows),
    "perSample": per_sample,
    "perSampleFold": per_fold,
    "perSampleRedline": per_redline,
    "perSampleRedlineFold": per_redline_fold,
    "foldContrasts": fold_contrasts,
    "signedErrorHistogramMs": histogram,
    "orderedResiduals": [
        {key: row[key] for key in ["segmentId", "sampleId", "referenceMs", "fold", "redlineSegment", "e5CalibratedErrorMs", "errorBand"]}
        for row in sorted(rows, key=lambda row: (row["sampleId"], row["referenceMs"]))
    ],
    "limitations": [
        "Diagnostic uses the same three-song provisional development labels as E5 and is not independent confirmation",
        "Residual size alone cannot distinguish wrong peak selection from local timing variation or label error",
        "No new correction, candidate, threshold or production behavior is introduced",
    ],
}
(ROOT / "residual-analysis.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"overall": output["overall"], "perSample": per_sample, "foldContrasts": fold_contrasts}, ensure_ascii=False))
print(f"V564_RESIDUAL_ANALYSIS_WRITTEN audible={len(rows)}")
