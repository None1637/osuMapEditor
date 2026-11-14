# v558: 独立重读选件、标注和候选，复算90行与全部汇总指标。
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V557 = ROOT.parent / "v557"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
METHODS = {
    "full": "fullResidualMs", "lag5": "lag5ResidualMs", "superflux": "superfluxResidualMs",
    "fullGlobal": "fullGlobalResidualMs", "lag5Global": "lag5GlobalResidualMs", "superfluxGlobal": "superfluxGlobalResidualMs",
}
selection = json.loads((V557 / "selection.json").read_text(encoding="utf-8"))
candidates = json.loads((ROOT / "candidates.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
segments = selection["segments"]
by_id = {row["segmentId"]: row for row in segments}
candidate_by_id = {row["segmentId"]: row for row in candidates["rows"]}
failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual: float | None, expected: float | None, message: str) -> None:
    if actual is None or expected is None:
        check(actual is expected, message)
    else:
        check(math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-9), f"{message}: {actual} != {expected}")


annotations = {}
for sample_id in SAMPLES:
    with (V557 / f"annotations-{sample_id}.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            annotations[row["segmentId"]] = row
check(len(segments) == 90 and len(by_id) == 90 and set(annotations) == set(by_id) == set(candidate_by_id), "选件、标注和候选必须同为90个ID")

raw_rows = []
for segment in segments:
    segment_id = segment["segmentId"]
    annotation = annotations[segment_id]
    candidate = candidate_by_id[segment_id]
    confidence = annotation["confidence"]
    actual = None if confidence == "no_clear_onset" else int(annotation["actualRelativeMs"])
    check(candidate["baselineResidualAbsDifferenceMs"] == 0, f"{segment_id} full基线未逐点复现")
    close(candidate["fullResidualMs"], segment["fullResidualMs"], f"{segment_id} full残差与v557不一致")
    row = {
        "segmentId": segment_id, "sampleId": segment["sampleId"], "stratum": segment["stratum"],
        "weight": float(segment["stratumWeight"]), "confidence": confidence, "actualRelativeMs": actual,
    }
    for method, field in METHODS.items():
        residual = candidate[field]
        error = None if residual is None or actual is None else residual - actual
        row[f"{method}ResidualMs"] = residual
        row[f"{method}CandidatePresent"] = residual is not None
        row[f"{method}ErrorMs"] = error
        row[f"{method}Within5Ms"] = None if error is None else abs(error) <= 5.0
        row[f"{method}Correct"] = error is not None and abs(error) <= 5.0
    raw_rows.append(row)

with (ROOT / "annotated-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    comparison = list(csv.DictReader(handle))
check(len(comparison) == 90, "对照表必须有90行")
comparison_by_id = {row["segmentId"]: row for row in comparison}
for expected in raw_rows:
    actual = comparison_by_id.get(expected["segmentId"])
    if actual is None:
        failures.append(f"缺{expected['segmentId']}")
        continue
    check(actual["confidence"] == expected["confidence"], f"{expected['segmentId']} 标签复制错误")
    close(float(actual["weight"]), expected["weight"], f"{expected['segmentId']} 权重")
    for method in METHODS:
        for suffix in ["ResidualMs", "ErrorMs"]:
            key = f"{method}{suffix}"
            text = actual[key]
            close(None if text == "" else float(text), expected[key], f"{expected['segmentId']}/{key}")
        for suffix in ["CandidatePresent", "Within5Ms", "Correct"]:
            key = f"{method}{suffix}"
            text = actual[key]
            parsed = None if text == "" else text == "1"
            check(parsed == expected[key], f"{expected['segmentId']}/{key} 布尔值错误")


def safe_div(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator else None


def recompute(rows: list[dict], method: str) -> dict:
    population = sum(row["weight"] for row in rows)
    outputs = sum(row["weight"] for row in rows if row[f"{method}CandidatePresent"])
    clear = sum(row["weight"] for row in rows if row["confidence"] == "clear")
    broad = sum(row["weight"] for row in rows if row["confidence"] in {"clear", "approximate"})
    no_clear = sum(row["weight"] for row in rows if row["confidence"] == "no_clear_onset")
    no_clear_outputs = sum(row["weight"] for row in rows if row["confidence"] == "no_clear_onset" and row[f"{method}CandidatePresent"])
    correct_clear = sum(row["weight"] for row in rows if row["confidence"] == "clear" and row[f"{method}Correct"])
    correct_broad = sum(row["weight"] for row in rows if row[f"{method}Correct"])
    return {
        "sampleCount": len(rows), "candidateOutputCount": sum(row[f"{method}CandidatePresent"] for row in rows),
        "correctCount": sum(row[f"{method}Correct"] for row in rows), "populationWeight": population,
        "candidateOutputWeight": outputs, "clearWeight": clear, "broadWeight": broad,
        "noClearOnsetWeight": no_clear, "noClearCandidateOutputWeight": no_clear_outputs,
        "correctClearWeight": correct_clear, "correctBroadWeight": correct_broad,
        "candidatePrecision": safe_div(correct_broad, outputs), "candidateCoverage": safe_div(outputs, population),
        "clearOnsetRecall": safe_div(correct_clear, clear),
        "clearAndApproximateOnsetRecall": safe_div(correct_broad, broad),
        "allObjectCorrectRate": safe_div(correct_broad, population),
        "noClearCandidateOutputRate": safe_div(no_clear_outputs, no_clear),
    }


def compare_metrics(actual: dict, expected: dict, label: str) -> None:
    check(set(actual) == set(expected), f"{label} 指标字段不一致")
    for key, expected_value in expected.items():
        actual_value = actual.get(key)
        if isinstance(expected_value, (float, int)) and not isinstance(expected_value, bool):
            close(actual_value, expected_value, f"{label}/{key}")
        else:
            check(actual_value == expected_value, f"{label}/{key}")


for method in METHODS:
    report = result["methods"][method]
    compare_metrics(report["overall"], recompute(raw_rows, method), f"{method}/overall")
    close(report["overall"]["populationWeight"], 3468.0, f"{method}/总权重")
    for sample_id in SAMPLES:
        subset = [row for row in raw_rows if row["sampleId"] == sample_id]
        compare_metrics(report["perSample"][sample_id], recompute(subset, method), f"{method}/{sample_id}")
    for stratum in STRATA:
        subset = [row for row in raw_rows if row["stratum"] == stratum]
        compare_metrics(report["perStratum"][stratum], recompute(subset, method), f"{method}/{stratum}")
    check(result["targetAchieved"][method] == (report["overall"]["allObjectCorrectRate"] >= 0.8), f"{method} 80%标志错误")

for method, deltas in result["baselineDeltasVsFull"].items():
    for key, value in deltas.items():
        close(value, result["methods"][method]["overall"][key] - result["methods"]["full"]["overall"][key], f"delta/{method}/{key}")

validation = {
    "version": "v558-independent-result-recheck-v1", "passed": not failures,
    "comparisonRows": len(comparison), "recomputedMethods": list(METHODS), "populationWeight": 3468.0,
    "failures": failures,
}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 90行候选、full基线、标签、权重和六组正确性均与原始数据一致")
print("ok: 六组总体/分曲/分层指标、全局对照差值与80%标志均独立重算一致")
print("V558_RESULT_VALIDATION_PASSED")
