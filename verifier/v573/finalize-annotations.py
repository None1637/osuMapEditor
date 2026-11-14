# v573: 候选揭示前校验180条盲标ID，并生成正式标注CSV；不改写标签内容。
from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
selection = json.loads((ROOT / "selection.json").read_text(encoding="utf-8"))
labels = json.loads((ROOT / "labels-work.json").read_text(encoding="utf-8"))
segments = selection["segments"]
by_id = {segment["segmentId"]: segment for segment in segments}
expected_ids = set(by_id)
actual_ids = set(labels)
failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def clock(ms: int) -> str:
    return f"{ms // 60000:02d}:{(ms % 60000) / 1000:06.3f}"


check(config["status"] == "frozen_before_confirmation_inference_and_labels", "确认配置状态改变")
check(config["productionCodeChanged"] is False, "生产代码标志改变")
check(len(segments) == len(expected_ids) == 180, "选择集必须恰好包含180个唯一物件")
check(len(labels) == 180, f"盲标必须为180条，实际{len(labels)}条")
check(actual_ids == expected_ids, f"盲标ID不一致：缺失={sorted(expected_ids - actual_ids)}，额外={sorted(actual_ids - expected_ids)}")
for sample_id in config["sampleIds"]:
    count = sum(segment["sampleId"] == sample_id for segment in segments)
    check(count == 30, f"{sample_id}必须选择30件，实际{count}件")
for segment_id, label in labels.items():
    check(set(label) == {"relativeMs", "confidence", "comment"}, f"{segment_id}盲标字段不完整")
    confidence = label.get("confidence")
    relative = label.get("relativeMs")
    check(confidence in {"clear", "approximate", "no_clear_onset"}, f"{segment_id}标签非法")
    check(bool(label.get("comment")), f"{segment_id}缺标注依据")
    if confidence == "no_clear_onset":
        check(relative is None, f"{segment_id}无清晰音头不得强填时间")
    else:
        check(type(relative) is int and abs(relative) <= 80, f"{segment_id}清晰或近似标签必须为±80ms内整数")

report = {
    "version": "v573-annotation-validation-v1",
    "passed": not failures,
    "status": "complete_provisional_blind_annotations_validated" if not failures else "invalid_labels_candidates_not_evaluated",
    "completedSongs": len(config["sampleIds"]) if not failures else 0,
    "labeledObjects": len(labels),
    "missingSegmentIds": sorted(expected_ids - actual_ids),
    "extraSegmentIds": sorted(actual_ids - expected_ids),
    "perSample": [],
    "failures": failures,
}
if not failures:
    fields = ["segmentId", "actualOnsetClock", "actualOnsetMs", "actualRelativeMs", "confidence", "comment"]
    for sample_id in config["sampleIds"]:
        sample_segments = [segment for segment in segments if segment["sampleId"] == sample_id]
        rows = []
        for segment in sample_segments:
            label = labels[segment["segmentId"]]
            relative = label["relativeMs"]
            actual = None if relative is None else segment["referenceMs"] + relative
            rows.append({
                "segmentId": segment["segmentId"],
                "actualOnsetClock": "" if actual is None else clock(actual),
                "actualOnsetMs": "" if actual is None else actual,
                "actualRelativeMs": "" if relative is None else relative,
                "confidence": label["confidence"],
                "comment": label["comment"],
            })
        with (ROOT / f"annotations-{sample_id}.csv").open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        report["perSample"].append({
            "sampleId": sample_id,
            "count": len(rows),
            "confidenceCounts": dict(Counter(row["confidence"] for row in rows)),
        })
(ROOT / "annotation-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print(json.dumps(report, ensure_ascii=False))
print("V573_ANNOTATIONS_FINALIZED")
