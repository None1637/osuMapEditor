# v563: 每首/每折仅使用另一折标签估计延迟；输出校准前后绝对误差。
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
V541 = ROOT.parent / "v541"
V548 = ROOT.parent / "v548"
V557 = ROOT.parent / "v557"
V558 = ROOT.parent / "v558"
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
assert config["productionCodeChanged"] is False
assert json.loads((ROOT.parent / "v562" / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
selection = json.loads((V557 / "selection.json").read_text(encoding="utf-8"))["segments"]
candidates = json.loads((V558 / "candidates.json").read_text(encoding="utf-8"))
assert candidates["configuration"] == json.loads((V558 / "experiment.json").read_text(encoding="utf-8"))
candidate_by_id = {row["segmentId"]: row for row in candidates["rows"]}
selected_beatmaps = json.loads((V548 / "selection.json").read_text(encoding="utf-8"))["samples"]
annotations = {}
for sample in config["sampleIds"]:
    with (V557 / f"annotations-{sample}.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            annotations[row["segmentId"]] = row


def parse_hits(osu: str, redlines: list[dict]) -> list[dict]:
    section = osu.split("[HitObjects]", 1)[1].split("[", 1)[0]
    times = sorted({round(float(row.strip().split(",")[2])) for row in section.splitlines()
                    if row.strip() and len(row.strip().split(",")) > 2 and float(row.strip().split(",")[2]) >= 0})
    hits = []
    for index, time_ms in enumerate(times):
        segment = -1
        for i, redline in enumerate(redlines):
            if redline["timeMs"] <= time_ms < redline["endMs"]:
                segment = i
                break
        hits.append({"timeMs": time_ms, "index": index, "segment": segment})
    return hits


hit_by_id = {}
for sample in config["sampleIds"]:
    previous = json.loads((V548 / "per-sample" / f"{sample}.json").read_text(encoding="utf-8"))
    beatmap_file = next(item["beatmapFile"] for item in selected_beatmaps if item["id"] == sample)
    osu = (V541 / "samples" / sample / beatmap_file).read_text(encoding="utf-8")
    hits = parse_hits(osu, previous["redlines"])
    by_time = {hit["timeMs"]: hit for hit in hits}
    chosen = next(item for item in previous["configurations"] if item["aggregate"] == "top2" and item["method"] == "dp")
    for segment in selection:
        if segment["sampleId"] != sample:
            continue
        hit = by_time[segment["referenceMs"]]
        fold = "odd" if hit["index"] % 2 == 0 else "even"
        candidate = candidate_by_id[segment["segmentId"]]
        expected_phase = chosen["phases"]["actual"][fold][hit["segment"]] if hit["segment"] >= 0 else 0.0
        expected_phase = expected_phase or 0.0
        assert math.isclose(candidate["phaseMs"], expected_phase, abs_tol=1e-9)
        hit_by_id[segment["segmentId"]] = {**hit, "fold": fold}

rows = []
for segment in selection:
    segment_id = segment["segmentId"]
    annotation = annotations[segment_id]
    confidence = annotation["confidence"]
    actual_relative = None if confidence == "no_clear_onset" else int(annotation["actualRelativeMs"])
    actual_onset = None if actual_relative is None else int(annotation["actualOnsetMs"])
    candidate = candidate_by_id[segment_id]
    residual = candidate["fullResidualMs"]
    absolute = None if residual is None else candidate["targetMs"] + residual
    error = None if absolute is None or actual_onset is None else absolute - actual_onset
    hit = hit_by_id[segment_id]
    rows.append({"segmentId": segment_id, "sampleId": segment["sampleId"], "stratum": segment["stratum"],
                 "weight": float(segment["stratumWeight"]), "referenceMs": segment["referenceMs"],
                 "confidence": confidence, "actualOnsetMs": actual_onset, "actualRelativeMs": actual_relative,
                 "hitIndex": hit["index"], "redlineSegment": hit["segment"], "fold": hit["fold"],
                 "targetMs": candidate["targetMs"], "fullResidualMs": residual,
                 "fullCandidateAbsoluteMs": absolute, "fullErrorMs": error})

records = []
for sample in config["sampleIds"]:
    for fold in ["odd", "even"]:
        opposite = "even" if fold == "odd" else "odd"
        errors = [row["fullErrorMs"] for row in rows if row["sampleId"] == sample and row["fold"] == opposite
                  and row["confidence"] in {"clear", "approximate"} and row["fullErrorMs"] is not None]
        correction = float(np.median(errors)) if len(errors) >= config["minimumPairs"] else config["fallbackCorrectionMs"]
        records.append({"sampleId": sample, "fold": fold, "fitFold": opposite, "pairCount": len(errors),
                        "correctionMs": correction, "usedFallback": len(errors) < config["minimumPairs"],
                        "fitSegmentIds": [row["segmentId"] for row in rows if row["sampleId"] == sample and row["fold"] == opposite
                                         and row["confidence"] in {"clear", "approximate"} and row["fullErrorMs"] is not None]})
record_by_key = {(item["sampleId"], item["fold"]): item for item in records}
for row in rows:
    record = record_by_key[(row["sampleId"], row["fold"])]
    correction = record["correctionMs"]
    absolute = row["fullCandidateAbsoluteMs"]
    row["correctionMs"] = correction
    row["e5CalibratedCandidateAbsoluteMs"] = None if absolute is None else absolute - correction
    row["e5CalibratedErrorMs"] = None if row["fullErrorMs"] is None else row["fullErrorMs"] - correction
    assert row["segmentId"] not in record["fitSegmentIds"]

(ROOT / "calibrated-candidates.json").write_text(json.dumps({
    "version": "v563-crossfit-absolute-delay-e5-candidates-v1", "configuration": config,
    "calibrationRecords": records, "rows": rows,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"calibrationRecords": [{key: value for key, value in item.items() if key != "fitSegmentIds"} for item in records]}, ensure_ascii=False))
print("V563_CROSSFIT_CANDIDATES_WRITTEN objects=90")
