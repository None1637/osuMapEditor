# v573: 在六首保留歌曲上按冻结规则重建E5反折校准与E13候选；不按结果调参。
from __future__ import annotations

import csv
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_confirmation_inference_and_labels"
assert config["productionCodeChanged"] is False
assert json.loads((ROOT / "annotation-validation.json").read_text(encoding="utf-8"))["passed"] is True
selection = json.loads((ROOT / "selection.json").read_text(encoding="utf-8"))
confirmation = json.loads((ROOT.parent / "v559" / "confirmation-selection.json").read_text(encoding="utf-8"))
selection_groups = {sample["id"]: sample["selectionGroup"] for sample in confirmation["samples"]}
annotations = {}
for sample_id in config["sampleIds"]:
    with (ROOT / f"annotations-{sample_id}.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            assert row["segmentId"] not in annotations
            annotations[row["segmentId"]] = row
peaks_by_sample = {
    sample_id: json.loads((ROOT / "peaks" / f"{sample_id}.json").read_text(encoding="utf-8"))["fullPeakMs"]
    for sample_id in config["sampleIds"]
}
rows = []
for segment in selection["segments"]:
    annotation = annotations[segment["segmentId"]]
    actual = int(annotation["actualOnsetMs"]) if annotation["actualOnsetMs"] else None
    old_candidate = segment["targetMs"] + segment["fullResidualMs"] if segment["fullResidualMs"] is not None else None
    row = {
        "segmentId": segment["segmentId"],
        "sampleId": segment["sampleId"],
        "selectionGroup": selection_groups[segment["sampleId"]],
        "stratum": segment["stratum"],
        "weight": segment["stratumWeight"],
        "referenceMs": segment["referenceMs"],
        "actualOnsetMs": actual,
        "confidence": annotation["confidence"],
        "comment": annotation["comment"],
        "hitIndex": segment["hitIndex"],
        "fold": segment["fold"],
        "targetMs": segment["targetMs"],
        "globalDelayMs": segment["globalDelayMs"],
        "phaseMs": segment["phaseMs"],
        "fullResidualMs": segment["fullResidualMs"],
        "oldTargetFullCandidateAbsoluteMs": old_candidate,
        "oldTargetFullCandidateSource": "fullOldTarget" if old_candidate is not None else "missing",
    }
    rows.append(row)
assert len(rows) == 180
assert {row["segmentId"] for row in rows} == set(annotations)
calibration_records = []
for row in rows:
    fit_fold = "even" if row["fold"] == "odd" else "odd"
    fit_rows = [
        candidate for candidate in rows
        if candidate["sampleId"] == row["sampleId"]
        and candidate["fold"] == fit_fold
        and candidate["confidence"] in {"clear", "approximate"}
        and candidate["actualOnsetMs"] is not None
        and candidate["oldTargetFullCandidateAbsoluteMs"] is not None
    ]
    signed_errors = [candidate["oldTargetFullCandidateAbsoluteMs"] - candidate["actualOnsetMs"] for candidate in fit_rows]
    correction = statistics.median(signed_errors) if len(signed_errors) >= 3 else 0.0
    fit_ids = [candidate["segmentId"] for candidate in fit_rows]
    assert row["segmentId"] not in fit_ids
    assert fit_fold != row["fold"]
    old_candidate = row["oldTargetFullCandidateAbsoluteMs"]
    e5_candidate = None if old_candidate is None else old_candidate - correction
    center = row["targetMs"] - correction
    choices = [peak for peak in peaks_by_sample[row["sampleId"]] if abs(peak - center) <= 10.0]
    e13_candidate = min(choices, key=lambda value: (abs(value - center), value)) if choices else None
    actual = row["actualOnsetMs"]
    row.update({
        "fitFold": fit_fold,
        "fitPairCount": len(fit_rows),
        "fitSegmentIds": fit_ids,
        "correctionMs": correction,
        "e5CalibratedCandidateAbsoluteMs": e5_candidate,
        "e5CandidateSource": "fullCalibrated" if e5_candidate is not None else "missing",
        "e5CalibratedErrorMs": None if e5_candidate is None or actual is None else e5_candidate - actual,
        "e13CorrectedCenterMs": center,
        "e13CandidateSource": "fullCorrectedTargetRematch" if e13_candidate is not None else "missing",
        "e13CorrectedTargetRematchCandidateAbsoluteMs": e13_candidate,
        "e13CorrectedTargetRematchErrorMs": None if e13_candidate is None or actual is None else e13_candidate - actual,
    })
    calibration_records.append({
        "segmentId": row["segmentId"], "sampleId": row["sampleId"], "fold": row["fold"],
        "fitFold": fit_fold, "fitPairCount": len(fit_rows), "fitSegmentIds": fit_ids,
        "correctionMs": correction,
    })
(ROOT / "rematched-candidates.json").write_text(json.dumps({
    "version": "v573-independent-confirmation-e5-e13-candidates-v1",
    "configuration": config,
    "calibrationRecords": calibration_records,
    "rows": rows,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"V573_REMATCHED_CANDIDATES_WRITTEN objects={len(rows)} e5={sum(row['e5CalibratedCandidateAbsoluteMs'] is not None for row in rows)} e13={sum(row['e13CorrectedTargetRematchCandidateAbsoluteMs'] is not None for row in rows)}")
