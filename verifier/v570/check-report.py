from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8").replace("−", "-")
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "diagnostic-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
assert config["productionCodeChanged"] is False
assert config["confirmationSetPolicy"] == "Do not read confirmation audio, candidates or labels"
assert validation["passed"] is True and validation["comparisonRows"] == 29
assert validation["completeMutuallyExclusivePartitionVerified"] is True
assert validation["hypotheses"] == {"H1": False, "H2": True, "H3": True}
assert result["hypotheses"] == {"H1": False, "H2": True, "H3": True}
combined = result["combinedTwoSongs"]
bounds = result["oracleUpperBoundsNotSystemScores"]
no_peak = combined["categories"]["noOfficialPeakWithin20ms"]
outside = combined["categories"]["correctPeakOutsideOldTargetWindow"]
required = [
    "主要瓶颈是 DDC 缺峰，不是旧目标窗口", f"{combined['e10IncorrectWeight']:.1f}",
    f"{no_peak['e10IncorrectWeight']:.1f}", f"{no_peak['shareOfE10IncorrectWeight'] * 100:.4f}%",
    f"{outside['e10IncorrectWeight']:.1f}", f"{bounds['currentE10Rate'] * 100:.4f}%",
    f"{bounds['outsideWindowOnlyRateUpperBound'] * 100:.4f}%", "0%",
    "H1=false、H2=true、H3=true", "V570_RESULT_VALIDATION_PASSED",
    "未修改生产 BPM 代码", "provisional 视觉盲标", "29 个", "1717.8",
    "100.0000%", "92.9954%", "不是新系统成绩",
]
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V570_REPORT_VALIDATION_PASSED")
