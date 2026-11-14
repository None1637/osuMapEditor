from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8").replace("−", "-")
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
assert validation["passed"] is True and validation["comparisonRows"] == 90
assert validation["selfLabelExclusionVerified"] is True
assert validation["hypotheses"] == {"H1": False, "H2": False, "H3": True}
assert result["targetAchieved"] is False and result["sample044AtLeast80Preserved"] is True
e5 = result["methods"]["e5Calibrated"]["overall"]
e6 = result["methods"]["e6LeaveOneOut"]["overall"]
transitions = result["transitionsE5ToE6"]
required = [
    "E6 被拒绝",
    f"{e5['clearAndApproximateOnsetRecall'] * 100:.4f}%",
    f"{e6['clearAndApproximateOnsetRecall'] * 100:.4f}%",
    f"{abs(result['baselineDeltas']['e5Calibrated']['clearAndApproximateOnsetRecall']) * 100:.4f} 个百分点",
    f"{transitions['netFixedWeight']:.4f}",
    "H1 = false、H2 = false、H3 = true",
    "误差中心改善不等于 ±5 ms 正确率改善",
    "未修改生产 BPM 代码",
    "provisional 视觉盲标",
    "V565_RESULT_VALIDATION_PASSED",
]
for sample in ["sample-044", "sample-032", "sample-002"]:
    rate = result["methods"]["e6LeaveOneOut"]["perSample"][sample]["clearAndApproximateOnsetRecall"]
    required.append(f"{rate * 100:.4f}%")
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V565_REPORT_VALIDATION_PASSED")
