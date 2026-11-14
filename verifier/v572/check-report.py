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
assert validation["oppositeFoldCalibrationVerified"] is True and validation["candidateRuleVerified"] is True
assert validation["csvVerified"] is True and validation["groupsVerified"] == ["overall", "perSample", "perStratum", "perFold"]
assert validation["hypotheses"] == {"H1": True, "H2": True, "H3": True}
assert validation["developmentTargetAchieved"] is True and validation["independentConfirmationPerformed"] is False
assert result["targetAchieved"] is True and result["sample044AtLeast80Preserved"] is True and result["noClearRateNotIncreased"] is True
assert result["candidateSourceCounts"] == {"fullCorrectedTargetRematch": 87, "missing": 3}
e10 = result["methods"]["e10Gated"]["overall"]
e13 = result["methods"]["e13CorrectedTargetRematch"]["overall"]
transitions = result["transitionsE10ToE13"]
required = ["首次达到 80% 主目标", f"{e10['clearAndApproximateOnsetRecall'] * 100:.4f}%",
    f"{e13['clearAndApproximateOnsetRecall'] * 100:.4f}%", "+9.6285", "development crossfit 达标",
    f"{e13['candidateCoverage'] * 100:.4f}%", f"{e13['noClearCandidateOutputRate'] * 100:.4f}%",
    f"{transitions['fixed']['weight']:.1f}", f"{transitions['broken']['weight']:.1f}", "+176.2",
    "H1/H2/H3 均成立", "V572_RESULT_VALIDATION_PASSED", "independentConfirmationPerformed=false",
    "provisional 视觉盲标", "未修改", "不能表述为“每首歌曲都达到 80%”"]
for sample in ["sample-044", "sample-032", "sample-002"]:
    rate = result["methods"]["e13CorrectedTargetRematch"]["perSample"][sample]["clearAndApproximateOnsetRecall"]
    required.append(f"{rate * 100:.4f}%")
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V572_REPORT_VALIDATION_PASSED")
