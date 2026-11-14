# v566: 对局部上升沿候选重新执行冻结的 E5 反折中位数校准。
from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
assert config["productionCodeChanged"] is False
assert json.loads((ROOT.parent / "v563" / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
payload = json.loads((ROOT / "raw-candidates.json").read_text(encoding="utf-8"))
assert payload["configuration"] == config
rows = [dict(row) for row in payload["rows"]]
for row in rows:
    absolute = row["e7RawCandidateAbsoluteMs"]
    actual = row["actualOnsetMs"]
    row["e7RawErrorMs"] = None if absolute is None or actual is None else absolute - actual

records = []
for sample in config["sampleIds"]:
    for fold in ["odd", "even"]:
        opposite = "even" if fold == "odd" else "odd"
        fit_rows = [row for row in rows if row["sampleId"] == sample and row["fold"] == opposite
                    and row["confidence"] in {"clear", "approximate"} and row["e7RawErrorMs"] is not None
                    and math.isfinite(row["e7RawErrorMs"])]
        correction = float(statistics.median(row["e7RawErrorMs"] for row in fit_rows)) \
            if len(fit_rows) >= 3 else 0.0
        records.append({"sampleId": sample, "fold": fold, "fitFold": opposite, "pairCount": len(fit_rows),
                        "correctionMs": correction, "usedFallback": len(fit_rows) < 3,
                        "fitSegmentIds": [row["segmentId"] for row in fit_rows]})
record_by_key = {(record["sampleId"], record["fold"]): record for record in records}
for row in rows:
    record = record_by_key[(row["sampleId"], row["fold"])]
    correction = record["correctionMs"]
    absolute = row["e7RawCandidateAbsoluteMs"]
    row["e7SlopeCorrectionMs"] = correction
    row["e7SlopeCandidateAbsoluteMs"] = None if absolute is None else absolute - correction
    row["e7SlopeErrorMs"] = None if row["e7RawErrorMs"] is None else row["e7RawErrorMs"] - correction
    assert row["segmentId"] not in record["fitSegmentIds"]
(ROOT / "refined-candidates.json").write_text(json.dumps({
    "version": "v566-local-rising-edge-e7-candidates-v1", "configuration": config,
    "calibrationRecords": records, "rows": rows,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"calibrationRecords": [{key: value for key, value in record.items() if key != "fitSegmentIds"}
                                         for record in records]}, ensure_ascii=False))
print("V566_REFINED_CANDIDATES_WRITTEN objects=90")
