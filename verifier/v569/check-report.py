from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8").replace("−", "-")
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
assert config["productionCodeChanged"] is False
assert config["gate"]["minimumRawCandidatesPerFold"] == 10
assert "targetsPerFold" not in config["gate"]
assert config["confirmationSetPolicy"] == "Do not read confirmation audio, candidates or labels"
assert validation["passed"] is True and validation["comparisonRows"] == 90
assert validation["labelFreeGateVerified"] is True
assert validation["gateFieldsUsed"] == ["segmentId", "sampleId", "fold", "ddcParabolicResidualMs"]
assert validation["candidateAndCorrectionSourcesVerified"] is True and validation["csvVerified"] is True
assert validation["groupsVerified"] == ["overall", "perSample", "perStratum", "perFold"]
assert validation["hypotheses"] == {"H1": True, "H2": True, "H3": True}
assert result["targetAchieved"] is False
assert result["sample044AtLeast80Preserved"] is True and result["noClearRateNotIncreased"] is True
assert result["candidateSourceCounts"] == {"ddcParabolic": 26, "e5FullWithinGate": 4, "e5FullSongGate": 60}
assert result["correctionSourceCounts"] == {"ddcOppositeFold": 26, "e5CandidateFallback": 4, "e5SongGate": 60}
e5 = result["methods"]["e5Calibrated"]["overall"]
e10 = result["methods"]["e10Gated"]["overall"]
transitions = result["transitionsE5ToE10"]
required = [
    "E10 取得有限正收益", f"{e5['clearAndApproximateOnsetRecall'] * 100:.4f}%",
    f"{e10['clearAndApproximateOnsetRecall'] * 100:.4f}%", "+0.4001", "9.1260",
    f"{e10['candidateCoverage'] * 100:.4f}%", f"{e10['noClearCandidateOutputRate'] * 100:.4f}%",
    f"{transitions['fixed']['weight']:.4f}", f"{transitions['netFixedWeight']:.4f}",
    "H1=true、H2=true、H3=true", "targetAchieved=false", "未修改生产 BPM 代码",
    "provisional 视觉盲标", "V569_RESULT_VALIDATION_PASSED", "12 / 15", "14 / 15",
    "2 / 15", "6 / 15", "8 / 18", "6 / 12",
]
for sample in ["sample-044", "sample-032", "sample-002"]:
    rate = result["methods"]["e10Gated"]["perSample"][sample]["clearAndApproximateOnsetRecall"]
    required.append(f"{rate * 100:.4f}%")
missing = [text for text in required if text not in report]
assert not missing, f"报告缺失或数字不一致: {missing}"
print("V569_REPORT_VALIDATION_PASSED")
