# v574: 将全部候选统一为绝对音频毫秒，对18张谱面的24416个物件计算±5ms正确率。
from __future__ import annotations

import csv
import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
manifest = json.loads((ROOT / "source-manifest.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_baseline_evaluation"
assert config["productionCodeChanged"] is False
METHODS = ["legacyResidual", "e5Calibrated", "e13CorrectedTargetRematch"]
rows: list[dict] = []
per_sample_inputs = []


def nearest(peaks: list[float], center: float) -> float | None:
    choices = [peak for peak in peaks if abs(peak - center) <= 10.0]
    return min(choices, key=lambda value: (abs(value - center), value)) if choices else None


for sample in manifest["samples"]:
    sample_id = sample["id"]
    data = json.loads((ROOT / "per-sample" / f"{sample_id}.json").read_text(encoding="utf-8"))
    chosen = next(item for item in data["configurations"] if item["aggregate"] == "top2" and item["method"] == "dp")
    redlines = data["redlines"]
    peaks = data["fullPeakMs"]
    delay = data["globalDelay"]["delayMs"]
    sample_rows = []
    for index, hit_time in enumerate(data["hitTimesMs"]):
        segment = next((i for i, line in enumerate(redlines) if line["timeMs"] <= hit_time < line["endMs"]), -1)
        fold = "odd" if index % 2 == 0 else "even"
        phase = chosen["phases"]["actual"][fold][segment] if segment >= 0 else 0
        target = hit_time + delay + phase
        old_candidate = nearest(peaks, target)
        row = {
            "segmentId": f"{sample_id}_h{hit_time}", "sampleId": sample_id, "tag": sample["tag"],
            "hitIndex": index, "fold": fold, "referenceMs": hit_time, "redlineSegment": segment,
            "globalDelayMs": delay, "phaseMs": phase, "targetMs": target,
            "oldTargetFullCandidateAbsoluteMs": old_candidate,
        }
        sample_rows.append(row)
    for row in sample_rows:
        fit_fold = "even" if row["fold"] == "odd" else "odd"
        fit_rows = [candidate for candidate in sample_rows if candidate["fold"] == fit_fold and candidate["oldTargetFullCandidateAbsoluteMs"] is not None]
        signed_errors = [candidate["oldTargetFullCandidateAbsoluteMs"] - candidate["referenceMs"] for candidate in fit_rows]
        correction = statistics.median(signed_errors) if len(signed_errors) >= 3 else 0.0
        old_candidate = row["oldTargetFullCandidateAbsoluteMs"]
        center = row["targetMs"] - correction
        e13_candidate = nearest(peaks, center)
        legacy_candidate = None if old_candidate is None else old_candidate - row["globalDelayMs"] - row["phaseMs"]
        e5_candidate = None if old_candidate is None else old_candidate - correction
        candidates = {
            "legacyResidual": legacy_candidate,
            "e5Calibrated": e5_candidate,
            "e13CorrectedTargetRematch": e13_candidate,
        }
        row.update({
            "fitFold": fit_fold, "fitPairCount": len(fit_rows), "correctionMs": correction,
            "e13CorrectedCenterMs": center,
        })
        for method, candidate in candidates.items():
            row[f"{method}CandidateAbsoluteMs"] = candidate
            row[f"{method}ErrorMs"] = None if candidate is None else candidate - row["referenceMs"]
        rows.append(row)
    per_sample_inputs.append((sample, sample_rows))
assert len(rows) == config["objectCount"] == 24416


def quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def metrics(source: list[dict], method: str) -> dict:
    errors = [row[f"{method}ErrorMs"] for row in source if row[f"{method}ErrorMs"] is not None]
    correct = [error for error in errors if abs(error) <= config["toleranceMs"]]
    return {
        "count": len(source), "candidateCount": len(errors), "missingCount": len(source) - len(errors),
        "correctCount": len(correct), "correctRate": len(correct) / len(source) if source else None,
        "candidateCoverage": len(errors) / len(source) if source else None,
        "medianAbsoluteErrorMs": quantile([abs(error) for error in errors], 0.5),
        "p95AbsoluteErrorMs": quantile([abs(error) for error in errors], 0.95),
    }


methods = {}
for method in METHODS:
    per_sample = {sample["id"]: metrics(sample_rows, method) for sample, sample_rows in per_sample_inputs}
    methods[method] = {
        "overall": metrics(rows, method),
        "perSample": per_sample,
        "specialTags": {tag: metrics([row for row in rows if row["tag"] == tag], method) for tag in ["user_requested_low_bpm", "user_requested_extreme_high_and_low_bpm_variable"]},
    }
# 验证legacy口径确实复现baseline.ts的top2/DP actualCrossFit计数。
legacy_count = sum(metrics(sample_rows, "legacyResidual")["correctCount"] for _, sample_rows in per_sample_inputs)
baseline_count = 0
for sample in manifest["samples"]:
    data = json.loads((ROOT / "per-sample" / f"{sample['id']}.json").read_text(encoding="utf-8"))
    chosen = next(item for item in data["configurations"] if item["aggregate"] == "top2" and item["method"] == "dp")
    baseline_count += chosen["actualCrossFit"]["all"]["within5"]
assert legacy_count == baseline_count, (legacy_count, baseline_count)
output = {
    "version": "v574-absolute-onset-baseline-analysis-v1",
    "status": "frozen_current_pipeline_evaluated_on_18_owner_supplied_maps",
    "reference": manifest["referenceAssertion"],
    "primaryMetric": config["primaryMetric"],
    "objectCount": len(rows),
    "targetCorrectRate": config["targetCorrectRate"],
    "targetAchieved": {method: methods[method]["overall"]["correctRate"] >= config["targetCorrectRate"] for method in METHODS},
    "methods": methods,
    "legacyBaselineCrosscheck": {"recomputedCorrectCount": legacy_count, "baselineTsCorrectCount": baseline_count, "passed": True},
    "calibrationLimit": "E5/E13 opposite-fold correction uses beatmap reference times from the same song; legacyResidual is the label-free audio-estimated delay/phase baseline",
    "productionCodeChanged": False,
}
(ROOT / "baseline-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
fields = ["segmentId", "sampleId", "hitIndex", "fold", "referenceMs", "redlineSegment", "targetMs", "globalDelayMs", "phaseMs",
          "oldTargetFullCandidateAbsoluteMs", "fitFold", "fitPairCount", "correctionMs", "e13CorrectedCenterMs"]
for method in METHODS:
    fields += [f"{method}CandidateAbsoluteMs", f"{method}ErrorMs"]
with (ROOT / "onset-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
print(json.dumps({method: methods[method]["overall"] for method in METHODS}, ensure_ascii=False))
print(json.dumps({method: {sample: values["correctRate"] for sample, values in methods[method]["perSample"].items()} for method in METHODS}, ensure_ascii=False))
print("V574_BASELINE_ANALYSIS_WRITTEN")
