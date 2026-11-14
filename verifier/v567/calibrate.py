# v567: 冻结 DDC parabolic 候选 + E5 反折绝对误差校准。
from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V560 = ROOT.parent / "v560"
V563 = ROOT.parent / "v563"
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
assert config["productionCodeChanged"] is False
assert json.loads((V560 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
assert json.loads((V560 / "parity-results.json").read_text(encoding="utf-8"))["passed"] is True
assert json.loads((V563 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
source = json.loads((V560 / "candidates.json").read_text(encoding="utf-8"))
source_by_id = {row["segmentId"]: row for row in source["rows"]}
metadata = json.loads((V563 / "calibrated-candidates.json").read_text(encoding="utf-8"))
rows = [dict(row) for row in metadata["rows"]]
for row in rows:
    candidate = source_by_id[row["segmentId"]]
    assert candidate["targetMs"] == row["targetMs"]
    residual = candidate[config["candidateField"]]
    absolute = None if residual is None else row["targetMs"] + residual
    actual = row["actualOnsetMs"]
    row["e8RawResidualMs"] = residual
    row["e8RawCandidateAbsoluteMs"] = absolute
    row["e8RawErrorMs"] = None if absolute is None or actual is None else absolute - actual

records = []
for sample in config["sampleIds"]:
    for fold in ["odd", "even"]:
        opposite = "even" if fold == "odd" else "odd"
        fit_rows = [row for row in rows if row["sampleId"] == sample and row["fold"] == opposite
                    and row["confidence"] in {"clear", "approximate"} and row["e8RawErrorMs"] is not None
                    and math.isfinite(row["e8RawErrorMs"])]
        correction = float(statistics.median(row["e8RawErrorMs"] for row in fit_rows)) if len(fit_rows) >= 3 else 0.0
        records.append({"sampleId": sample, "fold": fold, "fitFold": opposite, "pairCount": len(fit_rows),
                        "correctionMs": correction, "usedFallback": len(fit_rows) < 3,
                        "fitSegmentIds": [row["segmentId"] for row in fit_rows]})
record_by_key = {(record["sampleId"], record["fold"]): record for record in records}
for row in rows:
    record = record_by_key[(row["sampleId"], row["fold"])]
    correction = record["correctionMs"]
    absolute = row["e8RawCandidateAbsoluteMs"]
    row["e8DdcParabolicCorrectionMs"] = correction
    row["e8DdcParabolicCandidateAbsoluteMs"] = None if absolute is None else absolute - correction
    row["e8DdcParabolicErrorMs"] = None if row["e8RawErrorMs"] is None else row["e8RawErrorMs"] - correction
    assert row["segmentId"] not in record["fitSegmentIds"]
(ROOT / "ddc-calibrated-candidates.json").write_text(json.dumps({
    "version": "v567-ddc-parabolic-crossfit-e8-candidates-v1", "configuration": config,
    "calibrationRecords": records, "rows": rows,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"calibrationRecords": [{key: value for key, value in record.items() if key != "fitSegmentIds"}
                                         for record in records]}, ensure_ascii=False))
print(f"V567_DDC_CANDIDATES_WRITTEN objects={len(rows)} rawCandidates={sum(row['e8RawCandidateAbsoluteMs'] is not None for row in rows)}")
