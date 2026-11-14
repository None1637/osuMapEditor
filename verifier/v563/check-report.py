# v563: 核对研究报告中的关键数字、假设结论和限制。
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8").replace("−", "-")
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
assert validation["passed"] is True and validation["comparisonRows"] == 90
assert validation["calibrationRecords"] == 6
assert validation["oppositeFoldIsolationVerified"] is True
assert validation["outputGuardrailsUnchanged"] is True
assert all(validation["hypotheses"][key] is True for key in ["H1", "H2", "H3"])
assert result["targetAchieved"] is False
assert result["sample044AtLeast80Preserved"] is True
full = result["methods"]["full"]["overall"]
calibrated = result["methods"]["e5Calibrated"]["overall"]
required = [
    "奇偶交叉拟合",
    f"{full['clearAndApproximateOnsetRecall'] * 100:.4f}%",
    f"{calibrated['clearAndApproximateOnsetRecall'] * 100:.4f}%",
    "80% 目标尚未达到",
    "provisional 视觉盲标",
    "未修改生产 BPM 代码",
    "不能视为独立确认",
    "V563_RESULT_VALIDATION_PASSED",
]
for sample in ["sample-044", "sample-032", "sample-002"]:
    metrics = result["methods"]["e5Calibrated"]["perSample"][sample]
    required.append(f"{metrics['clearAndApproximateOnsetRecall'] * 100:.4f}%")
transitions = result["transitions"]
required.extend([
    f"修正 {transitions['fixed']['count']} 个",
    f"破坏 {transitions['broken']['count']} 个",
    f"{transitions['netFixedWeight']:+.4f}",
])
for record in result["calibrationRecords"]:
    sign = "+" if record["correctionMs"] >= 0 else ""
    required.append(f"{sign}{record['correctionMs']:.4f} ms")
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V563_REPORT_VALIDATION_PASSED")
