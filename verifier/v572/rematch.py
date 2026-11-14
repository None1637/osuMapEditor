# v572: 唯一冻结的corrected-target full重匹配；不使用当前物件标签选峰。
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
assert config["productionCodeChanged"] is False
assert json.loads((ROOT.parent / "v571" / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
payload = json.loads((ROOT.parent / "v569" / "gated-candidates.json").read_text(encoding="utf-8"))
rows = [dict(row) for row in payload["rows"]]
peaks_by_sample = {sample: json.loads((ROOT.parent / "v571" / "per-sample" / f"{sample}.json").read_text(encoding="utf-8"))["fullPeakMs"]
                   for sample in config["sampleIds"]}
for row in rows:
    center = row["targetMs"] - row["correctionMs"]
    choices = [peak for peak in peaks_by_sample[row["sampleId"]] if abs(peak - center) <= 10.0]
    peak = min(choices, key=lambda value: (abs(value - center), value)) if choices else None
    actual = row["actualOnsetMs"]
    row["e13CorrectedCenterMs"] = center
    row["e13CandidateSource"] = "fullCorrectedTargetRematch" if peak is not None else "missing"
    row["e13CorrectedTargetRematchCandidateAbsoluteMs"] = peak
    row["e13CorrectedTargetRematchErrorMs"] = None if peak is None or actual is None else peak - actual
(ROOT / "rematched-candidates.json").write_text(json.dumps({
    "version": "v572-corrected-target-full-rematch-e13-candidates-v1", "configuration": config, "rows": rows,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"V572_REMATCHED_CANDIDATES_WRITTEN objects={len(rows)} candidates={sum(row['e13CorrectedTargetRematchCandidateAbsoluteMs'] is not None for row in rows)}")
