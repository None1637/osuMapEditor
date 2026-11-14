# v557: 在揭示候选前校验每首已完成的盲标ID、时间关系与标签口径。
from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
selection = json.loads((ROOT / "selection.json").read_text(encoding="utf-8"))
by_id = {segment["segmentId"]: segment for segment in selection["segments"]}
files = sorted(ROOT.glob("annotations-sample-*.csv"))
failures: list[str] = []
reports = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def clock_ms(value: str) -> int:
    minutes, seconds = value.split(":")
    return int(minutes) * 60000 + round(float(seconds) * 1000)


for path in files:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    sample_id = path.stem.removeprefix("annotations-")
    expected_ids = {segment["segmentId"] for segment in selection["segments"] if segment["sampleId"] == sample_id}
    actual_ids = {row["segmentId"] for row in rows}
    check(len(rows) == 30 and actual_ids == expected_ids, f"{sample_id} 必须恰好包含本首30个盲标ID")
    for row in rows:
        segment = by_id.get(row["segmentId"])
        if segment is None:
            continue
        confidence = row["confidence"]
        check(confidence in {"clear", "approximate", "no_clear_onset"}, f"{row['segmentId']} 标签非法")
        check(bool(row["comment"]), f"{row['segmentId']} 缺标注依据")
        if confidence == "no_clear_onset":
            check(not row["actualOnsetClock"] and not row["actualOnsetMs"] and not row["actualRelativeMs"], f"{row['segmentId']} 无清晰音头不得强填时间")
        else:
            try:
                actual = int(row["actualOnsetMs"])
                relative = int(row["actualRelativeMs"])
                check(actual == segment["referenceMs"] + relative, f"{row['segmentId']} 绝对/相对时间不一致")
                check(clock_ms(row["actualOnsetClock"]) == actual, f"{row['segmentId']} 分秒/毫秒时间不一致")
                check(abs(relative) <= 80, f"{row['segmentId']} 标签超出盲标图范围")
            except (ValueError, TypeError):
                check(False, f"{row['segmentId']} 清晰或近似标签缺整数时间")
    reports.append({"sampleId": sample_id, "count": len(rows), "confidenceCounts": dict(Counter(row["confidence"] for row in rows))})

report = {
    "version": "v557-annotation-validation-v2",
    "passed": not failures,
    "status": "complete_provisional_blind_annotations_validated" if len(files) == 3 else "candidate_residuals_still_hidden",
    "completedSongs": len(files),
    "labeledObjects": sum(item["count"] for item in reports),
    "perSample": reports,
    "failures": failures,
}
(ROOT / "annotation-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print(json.dumps(report, ensure_ascii=False))
print("V557_ANNOTATION_VALIDATION_PASSED")
