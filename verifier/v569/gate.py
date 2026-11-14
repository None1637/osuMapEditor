# v569: 仅用raw DDC候选存在性计算整曲门控；禁止读取标签、误差或校准记录。
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V560 = ROOT.parent / "v560"
V567 = ROOT.parent / "v567"
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
assert config["productionCodeChanged"] is False
raw_rows = json.loads((V560 / "candidates.json").read_text(encoding="utf-8"))["rows"]
metadata_rows = json.loads((V567 / "ddc-calibrated-candidates.json").read_text(encoding="utf-8"))["rows"]
# 只投影无标签的fold元数据；本脚本不读取同文件中的标注、误差、权重或校准字段。
fold_by_id = {row["segmentId"]: row["fold"] for row in metadata_rows}
raw_by_id = {row["segmentId"]: row for row in raw_rows}
assert set(fold_by_id) == set(raw_by_id) and len(raw_by_id) == 90
minimum = config["gate"]["minimumRawCandidatesPerFold"]
records = []
for sample in config["sampleIds"]:
    fold_counts = {}
    for fold in ["odd", "even"]:
        segment_ids = [segment_id for segment_id, row_fold in fold_by_id.items()
                       if segment_id.startswith(sample + "_") and row_fold == fold]
        assert segment_ids
        available = sum(raw_by_id[segment_id]["ddcParabolicResidualMs"] is not None for segment_id in segment_ids)
        fold_counts[fold] = {"targetCount": len(segment_ids), "rawDdcCandidateCount": available,
                             "passes": available >= minimum}
    assert sum(fold_counts[fold]["targetCount"] for fold in fold_counts) == config["gate"]["targetsPerSong"] == 30
    enabled = all(fold_counts[fold]["passes"] for fold in ["odd", "even"])
    records.append({"sampleId": sample, "folds": fold_counts, "ddcEnabledForWholeSong": enabled,
                    "selectedMethod": "e9Hierarchical" if enabled else "e5Calibrated"})
(ROOT / "gate-records.json").write_text(json.dumps({
    "version": "v569-label-free-song-gate-e10-records-v1", "configuration": config,
    "featureFieldsUsed": ["segmentId", "sampleId", "fold", "ddcParabolicResidualMs"], "records": records,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(records, ensure_ascii=False))
print(f"V569_GATE_WRITTEN enabled={sum(record['ddcEnabledForWholeSong'] for record in records)}")
