from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8").replace("−", "-")
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))

assert config["productionCodeChanged"] is False
assert config["confirmationSetPolicy"] == "Do not read confirmation audio, candidates or labels"
assert validation["passed"] is True and validation["comparisonRows"] == 90
assert validation["candidateAndCorrectionSourcesVerified"] is True
assert validation["csvVerified"] is True
assert validation["groupsVerified"] == ["overall", "perSample", "perStratum", "perFold"]
assert validation["hypotheses"] == {"H1": False, "H2": False, "H3": True}
assert result["targetAchieved"] is False
assert result["sample044AtLeast80Preserved"] is True
assert result["noClearRateNotIncreased"] is False
assert result["candidateSourceCounts"] == {"ddcParabolic": 48, "e5Full": 42}
assert result["correctionSourceCounts"] == {
    "ddcOppositeFold": 36,
    "e5CandidateFallback": 42,
    "e5CorrectionFallback": 12,
}

e5 = result["methods"]["e5Calibrated"]["overall"]
e9 = result["methods"]["e9Hierarchical"]["overall"]
transitions = result["transitionsE5ToE9"]
required = [
    "E9 被拒绝，保留 E5",
    f"{e5['clearAndApproximateOnsetRecall'] * 100:.4f}%",
    f"{e9['clearAndApproximateOnsetRecall'] * 100:.4f}%",
    f"{result['baselineDeltas']['clearAndApproximateOnsetRecall'] * 100:.4f}",
    f"{e9['candidateCoverage'] * 100:.4f}%",
    f"{e9['noClearCandidateOutputRate'] * 100:.4f}%",
    f"{transitions['fixed']['weight']:.4f}",
    f"{transitions['broken']['weight']:.4f}",
    f"{transitions['netFixedWeight']:.4f}",
    "H1=false、H2=false、H3=true",
    "未修改生产 BPM 代码",
    "provisional 视觉盲标",
    "V568_RESULT_VALIDATION_PASSED",
    "extrasaction=\"ignore\"",
]
for sample in ["sample-044", "sample-032", "sample-002"]:
    rate = result["methods"]["e9Hierarchical"]["perSample"][sample]["clearAndApproximateOnsetRecall"]
    required.append(f"{rate * 100:.4f}%")
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V568_REPORT_VALIDATION_PASSED")
