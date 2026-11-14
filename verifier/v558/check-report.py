from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
analysis = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
validation = json.loads((ROOT / "result-validation.json").read_text(encoding="utf-8"))
experiment = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))

assert validation["passed"] is True
assert validation["comparisonRows"] == 90
assert validation["populationWeight"] == analysis["methods"]["full"]["overall"]["populationWeight"] == 3468.0
assert set(validation["recomputedMethods"]) == set(analysis["methods"])
assert all(not achieved for achieved in analysis["targetAchieved"].values())
assert experiment["productionCodeChanged"] is False
assert "结果尚未运行" not in report
assert "待运行后填写" not in report


def pct(value: float) -> str:
    return f"{value * 100:.4f}%"


def table_row(section: str, first_cell: str) -> list[str]:
    prefix = f"| {first_cell} |"
    rows = [line for line in section.splitlines() if line.startswith(prefix)]
    assert len(rows) == 1, (first_cell, rows)
    return [cell.strip() for cell in rows[0].strip("|").split("|")]


overall_section = report.split("### 总体人口加权指标", 1)[1].split("### 主方法分曲结果", 1)[0]
overall_keys = [
    "candidatePrecision",
    "candidateCoverage",
    "clearOnsetRecall",
    "clearAndApproximateOnsetRecall",
    "allObjectCorrectRate",
    "noClearCandidateOutputRate",
]
for method, result in analysis["methods"].items():
    cells = table_row(overall_section, method)
    expected = [method, *(pct(result["overall"][key]) for key in overall_keys)]
    assert cells == expected, (method, cells, expected)

per_sample_section = report.split("### 主方法分曲结果", 1)[1].split("### 猜想判定", 1)[0]
for method in analysis["mainMethods"]:
    cells = table_row(per_sample_section, method)
    expected = [method]
    for sample in analysis["samples"]:
        result = analysis["methods"][method]["perSample"][sample]
        expected.append(f'{pct(result["allObjectCorrectRate"])} / {pct(result["clearAndApproximateOnsetRecall"])}')
    assert cells == expected, (method, cells, expected)

print("V558_REPORT_VALIDATION_PASSED")
