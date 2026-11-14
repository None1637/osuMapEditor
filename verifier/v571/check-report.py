from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8").replace("−", "-")
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "diagnostic-results.json").read_text(encoding="utf-8"))
null_result = json.loads((ROOT / "null-control-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
assert config["productionCodeChanged"] is False
assert config["confirmationSetPolicy"] == "Do not read confirmation audio, candidates or labels"
assert validation["passed"] is True and validation["peakParityRows"] == 90
assert validation["mainRows"] == 29 and validation["nullRows"] == 58
assert validation["completeMutuallyExclusivePartitionVerified"] is True and validation["nullControlVerified"] is True
assert validation["hypotheses"] == {"H1": True, "H2": True, "H3": True}
assert result["peakExportParity"] == {"passed": True, "comparisonRows": 90, "exactResidualEquality": True}
required = [
    "oracle 上限存在严重选择自由度", "92.9699%", "97.9016%", "90.5451%", "2.4248",
    "H1=true、H2=true、H3=true", "V571_RESULT_VALIDATION_PASSED", "未修改生产 BPM 代码",
    "provisional 视觉盲标", "11,499", "30,982", "21,145", "494.6", "1680.4",
    "corrected-target 重匹配", "不是候选算法成绩", "79.2584%", "65.9157%", "72.5870%",
]
for shift in ["-50.0", "50.0"]:
    rate = null_result["perShift"][shift]["e10IncorrectPeakWithin5Rate"] * 100
    required.append(f"{rate:.4f}%")
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V571_REPORT_VALIDATION_PASSED")
