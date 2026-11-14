# v561: 仅组合冻结候选；不读取标注、不重跑模型、不调整任何参数。
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
V560 = ROOT.parent / "v560"
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
assert config["productionCodeChanged"] is False
source_config = json.loads((V560 / "experiment.json").read_text(encoding="utf-8"))
source = json.loads((V560 / "candidates.json").read_text(encoding="utf-8"))
assert source["configuration"] == source_config
assert json.loads((V560 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True
confirmation = json.loads((ROOT.parent / "v559" / "confirmation-selection.json").read_text(encoding="utf-8"))
assert not set(config["sampleIds"]) & {item["id"] for item in confirmation["samples"]}
rows = []
for old in source["rows"]:
    ddc = old["ddcOfficialResidualMs"]
    full = old["fullResidualMs"]
    fusion = ddc if ddc is not None else full
    source_name = "ddcOfficial" if ddc is not None else ("full" if full is not None else "none")
    rows.append({
        "segmentId": old["segmentId"], "sampleId": old["sampleId"],
        "referenceMs": old["referenceMs"], "targetMs": old["targetMs"],
        "globalDelayMs": old["globalDelayMs"], "phaseMs": old["phaseMs"],
        "fullResidualMs": full, "ddcOfficialResidualMs": ddc,
        "fusionResidualMs": fusion, "fusionSource": source_name,
        "baselineResidualAbsDifferenceMs": old["baselineResidualAbsDifferenceMs"],
    })
assert len(rows) == 90 and len({row["segmentId"] for row in rows}) == 90
counts = {name: sum(row["fusionSource"] == name for row in rows) for name in config["fusionSources"]}
(ROOT / "candidates.json").write_text(json.dumps({
    "version": "v561-ddc-full-fusion-e4-candidates-v1",
    "configuration": config, "sourceCounts": counts, "rows": rows,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"sourceCounts": counts}, ensure_ascii=False))
print("V560_FUSION_CANDIDATES_WRITTEN objects=90".replace("V560", "V561"))
