# v562: 核对纠错报告中的关键数字、方法表和限制。
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8").replace("−", "-")
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
assert validation["passed"] is True and validation["comparisonRows"] == 90
assert all(value is False for value in result["targetAchieved"].values())
required = ["时间基准错误", "77.2226%", "5.7299%", "93.4727%", "只修正评估", "未修改生产 BPM 代码"]
for method in result["methodDefinitions"]:
    name = method["name"]
    old = result["legacyMethods"][name]["overall"]
    new = result["correctedMethods"][name]["overall"]
    row = (f"| {name} | {old['clearAndApproximateOnsetRecall']*100:.4f}% | {new['clearAndApproximateOnsetRecall']*100:.4f}% | "
           f"{new['candidatePrecision']*100:.4f}% | {new['pairedErrorDiagnosticsNotCalibration']['medianSignedMs']:+.4f} ms |")
    required.append(row)
for sample in result["samples"]:
    metrics = result["correctedMethods"]["e1Full"]["perSample"][sample]
    required.extend([f"{metrics['clearAndApproximateOnsetRecall']*100:.4f}%", f"{metrics['candidatePrecision']*100:.4f}%",
                     f"{metrics['pairedErrorDiagnosticsNotCalibration']['medianSignedMs']:+.4f} ms"])
transitions = result["e4FusionTransitionsCorrected"]
required.extend([f"修正 {transitions['fixed']['count']} 个、破坏 {transitions['broken']['count']} 个", f"{transitions['netFixedWeight']:+.4f}"])
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V562_REPORT_VALIDATION_PASSED")
