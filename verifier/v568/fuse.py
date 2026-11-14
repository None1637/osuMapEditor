# v568: 唯一冻结的DDC优先、E5候选/修正层级回退。
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V567 = ROOT.parent / "v567"
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
assert config["productionCodeChanged"] is False
assert json.loads((V567 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
payload = json.loads((V567 / "ddc-calibrated-candidates.json").read_text(encoding="utf-8"))
rows = [dict(row) for row in payload["rows"]]
record_by_key = {(record["sampleId"], record["fold"]): record for record in payload["calibrationRecords"]}
for row in rows:
    raw = row["e8RawCandidateAbsoluteMs"]
    actual = row["actualOnsetMs"]
    if raw is not None:
        record = record_by_key[(row["sampleId"], row["fold"])]
        if record["usedFallback"]:
            correction = row["correctionMs"]
            correction_source = "e5CorrectionFallback"
        else:
            correction = record["correctionMs"]
            correction_source = "ddcOppositeFold"
        absolute = raw - correction
        error = None if actual is None else absolute - actual
        candidate_source = "ddcParabolic"
    else:
        absolute = row["e5CalibratedCandidateAbsoluteMs"]
        error = row["e5CalibratedErrorMs"]
        correction = row["correctionMs"]
        correction_source = "e5CandidateFallback"
        candidate_source = "e5Full"
    row["e9CandidateSource"] = candidate_source
    row["e9CorrectionSource"] = correction_source
    row["e9AppliedCorrectionMs"] = correction
    row["e9HierarchicalCandidateAbsoluteMs"] = absolute
    row["e9HierarchicalErrorMs"] = error
(ROOT / "hierarchical-candidates.json").write_text(json.dumps({
    "version": "v568-hierarchical-ddc-e5-fusion-e9-candidates-v1", "configuration": config, "rows": rows,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print("V568_HIERARCHICAL_CANDIDATES_WRITTEN objects=90")
