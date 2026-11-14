# v560: 核对报告关键数字、结论、确认集隔离和独立复算状态。
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
confirmation = json.loads((ROOT.parent / "v559" / "confirmation-selection.json").read_text(encoding="utf-8"))
assert validation["passed"] is True and validation["comparisonRows"] == 90
assert not set(config["sampleIds"]) & {item["id"] for item in confirmation["samples"]}
assert all(value is False for value in result["targetAchieved"].values())
required = [
    "H1 不成立，H2 不成立，H3 成立",
    "80% 目标未达成",
    "不是完整检测 precision",
    "52.7675%",
    "六首独立确认歌曲",
    "没有修改生产 BPM 代码",
]
for method in ["full", "ddcOfficial", "ddcParabolic"]:
    metrics = result["methods"][method]["overall"]
    row = (f"| {method} | {metrics['candidatePrecision']*100:.4f}% | {metrics['candidateCoverage']*100:.4f}% | "
           f"{metrics['clearOnsetRecall']*100:.4f}% | {metrics['clearAndApproximateOnsetRecall']*100:.4f}% | "
           f"{metrics['allObjectCorrectRate']*100:.4f}% | {metrics['noClearCandidateOutputRate']*100:.4f}% |")
    required.append(row)
for method in ["ddcOfficial", "ddcParabolic"]:
    metrics = result["oracleCenteredModelOnlyDiagnostics"][method]
    required.append(f"{metrics['coverageOfBroadLabels']*100:.4f}%")
    required.append(f"{metrics['within5RateOfBroadLabels']*100:.4f}%")
    required.append(f"{metrics['within5RateOfOutputs']*100:.4f}%")
    required.append(f"{metrics['medianAbsoluteMs']:.4f} ms")
for method in ["full", "ddcOfficial", "ddcParabolic"]:
    cells = []
    for sample in result["samples"]:
        metrics = result["methods"][method]["perSample"][sample]
        cells.append(f"{metrics['allObjectCorrectRate']*100:.4f}% / {metrics['clearAndApproximateOnsetRecall']*100:.4f}%")
    required.append(f"| {method} | " + " | ".join(cells) + " |")
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V560_REPORT_VALIDATION_PASSED")
