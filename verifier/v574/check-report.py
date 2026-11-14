from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "baseline-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
assert config["sampleCount"] == 18 and config["objectCount"] == 24416
assert validation["passed"] is True and validation["comparisonRows"] == 24416
assert validation["targetAchieved"] is True and validation["primaryMethod"] == "legacyResidual"
assert validation["primaryCorrectCount"] == 21619 and validation["perSampleAllAtLeast80"] is False
legacy = result["methods"]["legacyResidual"]["overall"]
required = [
    "88.5444%", "21,619 / 24,416", "173", f"{legacy['candidateCoverage'] * 100:.4f}%",
    f"{legacy['medianAbsoluteErrorMs']:.4f} ms", f"{legacy['p95AbsoluteErrorMs']:.4f} ms",
    "84.8460%", "64.1383%", "V574_RESULT_VALIDATION_PASSED", "不是“每张谱面都达到 80%”",
    "生产 BPM 代码未修改", "Yu Ai（用户指定低 BPM）", "75.8691%", "71.0216%",
    "用户提供的参考依据，不是重新听音标注得到的 100% 精确声学真值",
]
for sample, values in result["methods"]["legacyResidual"]["perSample"].items():
    required.append(f"{values['correctRate'] * 100:.4f}%")
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V574_REPORT_VALIDATION_PASSED")
