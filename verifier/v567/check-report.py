from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8").replace("−", "-")
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
assert validation["passed"] is True and validation["comparisonRows"] == 90
assert validation["frozenDdcCandidatesVerified"] is True and validation["officialParityVerified"] is True
assert validation["hypotheses"] == {"H1": False, "H2": False, "H3": True}
assert result["targetAchieved"] is False and result["sample044AtLeast80Preserved"] is True
e5 = result["methods"]["e5Calibrated"]["overall"]
e8 = result["methods"]["e8DdcParabolic"]["overall"]
required = [
    "E8 不能直接替换 E5", f"{e5['clearAndApproximateOnsetRecall'] * 100:.4f}%",
    f"{e8['clearAndApproximateOnsetRecall'] * 100:.4f}%",
    f"{e8['candidateCoverage'] * 100:.4f}%", "32.0374%",
    f"{result['transitionsE5ToE8']['netFixedWeight']:.4f}",
    "H1=false、H2=false、H3=true", "未修改生产 BPM 代码",
    "provisional 视觉盲标", "V567_RESULT_VALIDATION_PASSED",
]
for sample in ["sample-044", "sample-032", "sample-002"]:
    rate = result["methods"]["e8DdcParabolic"]["perSample"][sample]["clearAndApproximateOnsetRecall"]
    required.append(f"{rate * 100:.4f}%")
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V567_REPORT_VALIDATION_PASSED")
