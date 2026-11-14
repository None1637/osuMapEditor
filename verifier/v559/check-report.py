from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
analysis = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
selection = json.loads((ROOT / "confirmation-selection.json").read_text(encoding="utf-8"))
assert validation["passed"] is True and validation["comparisonRows"] == 90
assert "待运行后填写" not in report and "尚未运行" not in report


def pct(value: float) -> str:
    return f"{value * 100:.4f}%"


def row(section: str, method: str) -> list[str]:
    matches = [line for line in section.splitlines() if line.startswith(f"| {method} |")]
    assert len(matches) == 1, (method, matches)
    return [cell.strip() for cell in matches[0].strip("|").split("|")]


overall = report.split("### 总体人口加权指标", 1)[1].split("### 分曲结果", 1)[0]
keys = ["candidatePrecision", "candidateCoverage", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate", "noClearCandidateOutputRate"]
for method in analysis["mainMethods"]:
    actual = row(overall, method)
    expected = [method, *(pct(analysis["methods"][method]["overall"][key]) for key in keys)]
    assert actual == expected, (method, actual, expected)

per_sample = report.split("### 分曲结果", 1)[1].split("### 猜想判定与解释", 1)[0]
for method in analysis["mainMethods"]:
    actual = row(per_sample, method)
    expected = [method]
    for sample in analysis["samples"]:
        result = analysis["methods"][method]["perSample"][sample]
        expected.append(f'{pct(result["allObjectCorrectRate"])} / {pct(result["clearAndApproximateOnsetRecall"])}')
    assert actual == expected, (method, actual, expected)
assert pct(analysis["knownDevelopmentLabelUpperBound"]) in report
assert analysis["configuredUpperBoundArithmeticWarning"]["configuredMinusRecomputed"] > 0

excluded = set(selection["excludedDevelopmentAndEvaluationSamples"])
selected = [item["id"] for item in selection["samples"]]
assert len(selected) == len(set(selected)) == 6
assert not excluded.intersection(selected)
assert sum(not item["referenceVariable"] for item in selection["samples"]) == 2
assert sum(item["referenceVariable"] and item["denseRedLineCount"] >= 2 for item in selection["samples"]) == 2
assert sum(item["referenceVariable"] and item["denseRedLineCount"] < 2 for item in selection["samples"]) == 2
assert selection["status"] == "reserved_not_decoded_by_v559_not_evaluated_not_labeled"
for sample in selected:
    assert not (ROOT / "decoded" / sample).exists()
    assert not (ROOT / "per-sample" / f"{sample}.json").exists()
    assert not (ROOT / "activations" / f"{sample}.npz").exists()
print("V559_REPORT_AND_CONFIRMATION_SELECTION_VALIDATION_PASSED")
