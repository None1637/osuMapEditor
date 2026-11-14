# v561: 独立重读冻结候选和标签，复算融合主指标、转移及来源分层。
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
V557 = ROOT.parent / "v557"
V558 = ROOT.parent / "v558"
V560 = ROOT.parent / "v560"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
METHODS = {"full": "fullResidualMs", "ddcOfficial": "ddcOfficialResidualMs", "fusion": "fusionResidualMs"}
selection = json.loads((V557 / "selection.json").read_text(encoding="utf-8"))
candidates = json.loads((ROOT / "candidates.json").read_text(encoding="utf-8"))
source = json.loads((V560 / "candidates.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
baseline = {row["segmentId"]: row for row in json.loads((V558 / "candidates.json").read_text(encoding="utf-8"))["rows"]}
source_by_id = {row["segmentId"]: row for row in source["rows"]}
segments = selection["segments"]
by_id = {row["segmentId"]: row for row in segments}
candidate_by_id = {row["segmentId"]: row for row in candidates["rows"]}
failures = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual, expected, message: str) -> None:
    if actual is None or expected is None:
        check(actual is expected, message)
    else:
        check(math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-9), f"{message}: {actual} != {expected}")


check(config["status"] == "frozen_before_candidate_evaluation", "冻结状态改变")
check(config["productionCodeChanged"] is False, "生产代码标志改变")
check(json.loads((V560 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True, "v560源结果未通过复算")
check(source["configuration"] == json.loads((V560 / "experiment.json").read_text(encoding="utf-8")), "v560候选配置改变")
confirmation = json.loads((ROOT.parent / "v559" / "confirmation-selection.json").read_text(encoding="utf-8"))
check(not set(SAMPLES) & {item["id"] for item in confirmation["samples"]}, "开发集与确认集重叠")

annotations = {}
for sample_id in SAMPLES:
    with (V557 / f"annotations-{sample_id}.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            annotations[row["segmentId"]] = row
check(len(segments) == len(by_id) == len(candidate_by_id) == 90 and set(annotations) == set(by_id) == set(candidate_by_id) == set(source_by_id), "选件、标签、来源和候选必须同为90个ID")
raw_rows = []
for segment in segments:
    segment_id = segment["segmentId"]
    annotation = annotations[segment_id]
    candidate = candidate_by_id[segment_id]
    old = source_by_id[segment_id]
    confidence = annotation["confidence"]
    actual = None if confidence == "no_clear_onset" else int(annotation["actualRelativeMs"])
    check(candidate["baselineResidualAbsDifferenceMs"] == 0, f"{segment_id}基线自检失败")
    close(candidate["fullResidualMs"], baseline[segment_id]["fullResidualMs"], f"{segment_id} full残差改变")
    close(candidate["targetMs"], baseline[segment_id]["targetMs"], f"{segment_id}目标时间改变")
    for field in ["fullResidualMs", "ddcOfficialResidualMs"]:
        close(candidate[field], old[field], f"{segment_id}/{field}来源改变")
    expected_fusion = old["ddcOfficialResidualMs"] if old["ddcOfficialResidualMs"] is not None else old["fullResidualMs"]
    close(candidate["fusionResidualMs"], expected_fusion, f"{segment_id}融合规则错误")
    expected_source = "ddcOfficial" if old["ddcOfficialResidualMs"] is not None else ("full" if old["fullResidualMs"] is not None else "none")
    check(candidate["fusionSource"] == expected_source, f"{segment_id}融合来源错误")
    row = {"segmentId": segment_id, "sampleId": segment["sampleId"], "stratum": segment["stratum"],
           "weight": float(segment["stratumWeight"]), "confidence": confidence, "actualRelativeMs": actual,
           "fusionSource": expected_source}
    for method, field in METHODS.items():
        residual = candidate[field]
        error = None if residual is None or actual is None else residual - actual
        row[f"{method}ResidualMs"] = residual
        row[f"{method}CandidatePresent"] = residual is not None
        row[f"{method}ErrorMs"] = error
        row[f"{method}Within5Ms"] = None if error is None else abs(error) <= 5.0
        row[f"{method}Correct"] = error is not None and abs(error) <= 5.0
    if row["fullCorrect"] and row["fusionCorrect"]:
        transition = "bothCorrect"
    elif row["fusionCorrect"]:
        transition = "fixed"
    elif row["fullCorrect"]:
        transition = "broken"
    else:
        transition = "bothIncorrect"
    row["transition"] = transition
    raw_rows.append(row)

with (ROOT / "annotated-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    comparison = list(csv.DictReader(handle))
check(len(comparison) == 90, "CSV必须有90行")
comparison_by_id = {row["segmentId"]: row for row in comparison}
for expected in raw_rows:
    actual = comparison_by_id.get(expected["segmentId"])
    if actual is None:
        failures.append(f"缺{expected['segmentId']}")
        continue
    check(actual["confidence"] == expected["confidence"], f"{expected['segmentId']}标签复制错误")
    check(actual["fusionSource"] == expected["fusionSource"] and actual["transition"] == expected["transition"], f"{expected['segmentId']}来源或转移错误")
    close(float(actual["weight"]), expected["weight"], f"{expected['segmentId']}权重")
    for method in METHODS:
        for suffix in ["ResidualMs", "ErrorMs"]:
            key = f"{method}{suffix}"
            text = actual[key]
            close(None if text == "" else float(text), expected[key], f"{expected['segmentId']}/{key}")
        for suffix in ["CandidatePresent", "Within5Ms", "Correct"]:
            key = f"{method}{suffix}"
            text = actual[key]
            parsed = None if text == "" else text == "1"
            check(parsed == expected[key], f"{expected['segmentId']}/{key}布尔值错误")


def div(a: float, b: float) -> float | None:
    return a / b if b else None


def recompute(rows: list[dict], method: str) -> dict:
    population = sum(row["weight"] for row in rows)
    outputs = sum(row["weight"] for row in rows if row[f"{method}CandidatePresent"])
    clear = sum(row["weight"] for row in rows if row["confidence"] == "clear")
    broad = sum(row["weight"] for row in rows if row["confidence"] in {"clear", "approximate"})
    no_clear = sum(row["weight"] for row in rows if row["confidence"] == "no_clear_onset")
    no_clear_outputs = sum(row["weight"] for row in rows if row["confidence"] == "no_clear_onset" and row[f"{method}CandidatePresent"])
    correct_clear = sum(row["weight"] for row in rows if row["confidence"] == "clear" and row[f"{method}Correct"])
    correct_broad = sum(row["weight"] for row in rows if row[f"{method}Correct"])
    errors = [row[f"{method}ErrorMs"] for row in rows if row[f"{method}ErrorMs"] is not None]
    return {
        "sampleCount": len(rows), "candidateOutputCount": sum(row[f"{method}CandidatePresent"] for row in rows),
        "correctCount": sum(row[f"{method}Correct"] for row in rows), "populationWeight": population,
        "candidateOutputWeight": outputs, "clearWeight": clear, "broadWeight": broad,
        "noClearOnsetWeight": no_clear, "noClearCandidateOutputWeight": no_clear_outputs,
        "correctClearWeight": correct_clear, "correctBroadWeight": correct_broad,
        "candidatePrecision": div(correct_broad, outputs), "candidateCoverage": div(outputs, population),
        "clearOnsetRecall": div(correct_clear, clear), "clearAndApproximateOnsetRecall": div(correct_broad, broad),
        "allObjectCorrectRate": div(correct_broad, population), "noClearCandidateOutputRate": div(no_clear_outputs, no_clear),
        "pairedErrorDiagnosticsNotCalibration": {
            "count": len(errors), "medianSignedMs": None if not errors else float(np.median(errors)),
            "medianAbsoluteMs": None if not errors else float(np.median(np.abs(errors))),
            "p95AbsoluteMs": None if not errors else float(np.percentile(np.abs(errors), 95)),
        },
    }


def transitions(rows: list[dict]) -> dict:
    output = {"objectCount": len(rows), "populationWeight": sum(row["weight"] for row in rows)}
    for name in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
        selected = [row for row in rows if row["transition"] == name]
        output[f"{name}Count"] = len(selected)
        output[f"{name}Weight"] = sum(row["weight"] for row in selected)
    output["netFixedWeight"] = output["fixedWeight"] - output["brokenWeight"]
    output["netFixedAllObjectRatePoints"] = output["netFixedWeight"] / 3468.0 if len(rows) == 90 else None
    return output


def compare(actual, expected, label: str) -> None:
    check(set(actual) == set(expected), f"{label}字段不一致")
    for key, expected_value in expected.items():
        actual_value = actual.get(key)
        if isinstance(expected_value, dict):
            compare(actual_value, expected_value, f"{label}/{key}")
        elif isinstance(expected_value, (float, int)) and not isinstance(expected_value, bool):
            close(actual_value, expected_value, f"{label}/{key}")
        else:
            check(actual_value == expected_value, f"{label}/{key}")


for method in METHODS:
    report = result["methods"][method]
    compare(report["overall"], recompute(raw_rows, method), f"{method}/overall")
    for sample_id in SAMPLES:
        compare(report["perSample"][sample_id], recompute([row for row in raw_rows if row["sampleId"] == sample_id], method), f"{method}/{sample_id}")
    for stratum in STRATA:
        compare(report["perStratum"][stratum], recompute([row for row in raw_rows if row["stratum"] == stratum], method), f"{method}/{stratum}")
    check(result["targetAchieved"][method] == (report["overall"]["allObjectCorrectRate"] >= 0.8), f"{method} 80%标志错误")
for method, deltas in result["baselineDeltasVsFull"].items():
    for key, value in deltas.items():
        close(value, result["methods"][method]["overall"][key] - result["methods"]["full"]["overall"][key], f"delta/{method}/{key}")
compare(result["transitions"]["overall"], transitions(raw_rows), "transitions/overall")
for confidence in ["clear", "approximate", "no_clear_onset"]:
    compare(result["transitions"]["byConfidence"][confidence], transitions([row for row in raw_rows if row["confidence"] == confidence]), f"transitions/{confidence}")
for source_name in config["fusionSources"]:
    selected = [row for row in raw_rows if row["fusionSource"] == source_name]
    for method in ["full", "fusion"]:
        compare(result["fusionSourceMetrics"][source_name][method], recompute(selected, method), f"sources/{source_name}/{method}")
close(result["transitions"]["overall"]["netFixedAllObjectRatePoints"], result["methods"]["fusion"]["overall"]["allObjectCorrectRate"] - result["methods"]["full"]["overall"]["allObjectCorrectRate"], "净修正必须等于融合准确率差值")
upper_bound = result["methods"]["full"]["overall"]["broadWeight"] / 3468.0
close(result["knownDevelopmentLabelUpperBound"], upper_bound, "标签上限")
close(config["knownDevelopmentLabelUpperBound"], upper_bound, "冻结上限")
validation = {"version": "v561-independent-result-recheck-v1", "passed": not failures,
              "comparisonRows": len(comparison), "recomputedMethods": list(METHODS), "populationWeight": 3468.0,
              "netFixedWeight": transitions(raw_rows)["netFixedWeight"], "failures": failures}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 90行来源候选、融合规则、标签、CSV和确认集隔离一致")
print("ok: 三组主指标、修正/破坏转移、来源分层、净变化及80%标志均独立重算一致")
print("V561_RESULT_VALIDATION_PASSED")
