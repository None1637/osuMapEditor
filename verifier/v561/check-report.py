# v561: 核对报告关键数字、否定结论及确认集隔离。
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert validation["passed"] is True and validation["comparisonRows"] == 90
assert result["targetAchieved"]["fusion"] is False
assert result["transitions"]["overall"]["netFixedWeight"] < 0
required = ["H1、H2 不成立，H3 成立", "不进入独立确认集", "80% 目标未达成", "52.7675%", "未修改生产 BPM 代码"]
for method in ["full", "ddcOfficial", "fusion"]:
    metrics = result["methods"][method]["overall"]
    required.append(f"| {method} | {metrics['candidatePrecision']*100:.4f}% | {metrics['candidateCoverage']*100:.4f}% | "
                    f"{metrics['clearOnsetRecall']*100:.4f}% | {metrics['clearAndApproximateOnsetRecall']*100:.4f}% | "
                    f"{metrics['allObjectCorrectRate']*100:.4f}% | {metrics['noClearCandidateOutputRate']*100:.4f}% |")
transitions = result["transitions"]["overall"]
required.extend([f"修正 {transitions['fixedCount']} 个、破坏 {transitions['brokenCount']} 个",
                 f"{transitions['fixedWeight']:.4f}", f"{transitions['brokenWeight']:.4f}",
                 f"{abs(transitions['netFixedAllObjectRatePoints'])*100:.4f} 个百分点"])
for method in ["full", "fusion"]:
    metrics = result["fusionSourceMetrics"]["ddcOfficial"][method]
    required.extend([f"{metrics['clearAndApproximateOnsetRecall']*100:.4f}%", f"{metrics['allObjectCorrectRate']*100:.4f}%"])
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V561_REPORT_VALIDATION_PASSED")
