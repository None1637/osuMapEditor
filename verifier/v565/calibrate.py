# v565: 每个物件仅用同曲其他物件的原始绝对误差估计 E6 延迟。
from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V563 = ROOT.parent / "v563"
V564 = ROOT.parent / "v564"
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
assert config["productionCodeChanged"] is False
assert json.loads((V563 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
assert json.loads((V564 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
source = json.loads((V563 / "calibrated-candidates.json").read_text(encoding="utf-8"))
rows = [dict(row) for row in source["rows"]]
records = []
for row in rows:
    fit_rows = [other for other in rows if other["sampleId"] == row["sampleId"]
                and other["segmentId"] != row["segmentId"]
                and other["confidence"] in {"clear", "approximate"}
                and other["fullErrorMs"] is not None and math.isfinite(other["fullErrorMs"])]
    correction = float(statistics.median(other["fullErrorMs"] for other in fit_rows)) \
        if len(fit_rows) >= config["minimumPairs"] else config["fallbackCorrectionMs"]
    absolute = row["fullCandidateAbsoluteMs"]
    row["e6LeaveOneOutCorrectionMs"] = correction
    row["e6LeaveOneOutCandidateAbsoluteMs"] = None if absolute is None else absolute - correction
    row["e6LeaveOneOutErrorMs"] = None if row["fullErrorMs"] is None else row["fullErrorMs"] - correction
    records.append({
        "segmentId": row["segmentId"], "sampleId": row["sampleId"], "fold": row["fold"],
        "pairCount": len(fit_rows), "correctionMs": correction,
        "usedFallback": len(fit_rows) < config["minimumPairs"],
        "fitSegmentIds": [other["segmentId"] for other in fit_rows],
    })
    assert row["segmentId"] not in records[-1]["fitSegmentIds"]

(ROOT / "leave-one-out-candidates.json").write_text(json.dumps({
    "version": "v565-leave-one-out-absolute-delay-e6-candidates-v1",
    "configuration": config,
    "calibrationRecords": records,
    "rows": rows,
}, ensure_ascii=False, indent=2), encoding="utf-8")
for sample in config["sampleIds"]:
    values = sorted({record["correctionMs"] for record in records if record["sampleId"] == sample})
    print(json.dumps({"sampleId": sample, "distinctCorrections": values}, ensure_ascii=False))
print("V565_LEAVE_ONE_OUT_CANDIDATES_WRITTEN objects=90")
