from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8").replace("−", "-")
result = json.loads((ROOT / "residual-analysis.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
assert validation["passed"] is True and validation["audibleRows"] == 52 and validation["pairedRows"] == 49
assert validation["foldOppositionExplainedByE5Algebra"] is True
required = [
    f"{validation['maximumAbsoluteErrorMs']:.4f} ms",
    f"{result['overall']['within5RateIncludingMissing'] * 100:.4f}%",
    f"{validation['target80WeightGap']:.4f}",
    "leave-one-out 整曲中位数校准",
    "代数产物",
    "不能解释为“奇数物件和偶数物件真实延迟相反”",
    "没有提高 70.4738% 的正确率",
    "provisional 视觉盲标",
]
for sample in ["sample-044", "sample-032", "sample-002"]:
    metrics = result["perSample"][sample]
    required.append(f"{metrics['within5RateIncludingMissing'] * 100:.4f}%")
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V564_REPORT_VALIDATION_PASSED")
