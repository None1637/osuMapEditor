# v569: 应用唯一冻结的无标签整曲门控，门控内完整复用E9规则。
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V567 = ROOT.parent / "v567"
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
gate_payload = json.loads((ROOT / "gate-records.json").read_text(encoding="utf-8"))
assert gate_payload["configuration"] == config
assert json.loads((V567 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
source = json.loads((V567 / "ddc-calibrated-candidates.json").read_text(encoding="utf-8"))
rows = [dict(row) for row in source["rows"]]
gate_by_sample = {record["sampleId"]: record for record in gate_payload["records"]}
record_by_key = {(record["sampleId"], record["fold"]): record for record in source["calibrationRecords"]}
for row in rows:
    gate = gate_by_sample[row["sampleId"]]
    row["e10DdcEnabledForWholeSong"] = gate["ddcEnabledForWholeSong"]
    if not gate["ddcEnabledForWholeSong"]:
        absolute = row["e5CalibratedCandidateAbsoluteMs"]
        error = row["e5CalibratedErrorMs"]
        correction = row["correctionMs"]
        candidate_source = "e5FullSongGate"
        correction_source = "e5SongGate"
    else:
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
            candidate_source = "e5FullWithinGate"
    row["e10CandidateSource"] = candidate_source
    row["e10CorrectionSource"] = correction_source
    row["e10AppliedCorrectionMs"] = correction
    row["e10GatedCandidateAbsoluteMs"] = absolute
    row["e10GatedErrorMs"] = error
(ROOT / "gated-candidates.json").write_text(json.dumps({
    "version": "v569-label-free-song-gate-e10-candidates-v1", "configuration": config,
    "gateRecords": gate_payload["records"], "rows": rows,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print("V569_GATED_CANDIDATES_WRITTEN objects=90")
