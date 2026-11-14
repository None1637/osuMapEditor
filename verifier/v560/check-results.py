# v560: 独立重读选件、标签、候选、激活和CSV，复算E3主指标及诊断。
from __future__ import annotations

import csv
import hashlib
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
V557 = ROOT.parent / "v557"
V558 = ROOT.parent / "v558"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
METHODS = {"full": "fullResidualMs", "ddcOfficial": "ddcOfficialResidualMs", "ddcParabolic": "ddcParabolicResidualMs"}
selection = json.loads((V557 / "selection.json").read_text(encoding="utf-8"))
candidates = json.loads((ROOT / "candidates.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
baseline = {row["segmentId"]: row for row in json.loads((V558 / "candidates.json").read_text(encoding="utf-8"))["rows"]}
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
for name, expected in config["model"]["weights"].items():
    data = (ROOT / "upstream-ddc-onset" / "ddc_onset" / "weights" / name).read_bytes()
    check(len(data) == expected["bytes"], f"{name}字节数改变")
    check(hashlib.sha256(data).hexdigest() == expected["sha256"], f"{name}哈希改变")
for gate in ["smoke-results.json", "parity-results.json"]:
    check(json.loads((ROOT / gate).read_text(encoding="utf-8"))["passed"] is True, f"{gate}未通过")
confirmation = json.loads((ROOT.parent / "v559" / "confirmation-selection.json").read_text(encoding="utf-8"))
reserved = {item["id"] for item in confirmation["samples"]}
check(not set(SAMPLES) & reserved, "开发集与确认集重叠")
check({item.name for item in (ROOT / "decoded").iterdir() if item.is_dir()} == set(SAMPLES), "E3解码目录包含额外歌曲")

annotations = {}
for sample_id in SAMPLES:
    with (V557 / f"annotations-{sample_id}.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            annotations[row["segmentId"]] = row
check(len(segments) == len(by_id) == len(candidate_by_id) == 90 and set(annotations) == set(by_id) == set(candidate_by_id), "选件、标签和候选必须同为90个ID")
raw_rows = []
for segment in segments:
    segment_id = segment["segmentId"]
    annotation = annotations[segment_id]
    candidate = candidate_by_id[segment_id]
    confidence = annotation["confidence"]
    actual = None if confidence == "no_clear_onset" else int(annotation["actualRelativeMs"])
    check(candidate["baselineResidualAbsDifferenceMs"] == 0, f"{segment_id}基线自检失败")
    close(candidate["fullResidualMs"], baseline[segment_id]["fullResidualMs"], f"{segment_id} full残差改变")
    close(candidate["targetMs"], baseline[segment_id]["targetMs"], f"{segment_id}目标时间改变")
    row = {"segmentId": segment_id, "sampleId": segment["sampleId"], "stratum": segment["stratum"],
           "weight": float(segment["stratumWeight"]), "confidence": confidence, "actualRelativeMs": actual,
           "actualOnsetMs": None if actual is None else int(annotation["actualOnsetMs"])}
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
check(len(comparison) == 90, "CSV必须有90行")
comparison_by_id = {row["segmentId"]: row for row in comparison}
for expected in raw_rows:
    actual = comparison_by_id.get(expected["segmentId"])
    if actual is None:
        failures.append(f"缺{expected['segmentId']}")
        continue
    check(actual["confidence"] == expected["confidence"], f"{expected['segmentId']}标签复制错误")
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
upper_bound = result["methods"]["full"]["overall"]["broadWeight"] / 3468.0
close(result["knownDevelopmentLabelUpperBound"], upper_bound, "标签上限")
close(config["knownDevelopmentLabelUpperBound"], upper_bound, "冻结上限")

shared = [row for row in raw_rows if row["ddcOfficialErrorMs"] is not None and row["ddcParabolicErrorMs"] is not None]
interpolation = {
    "count": len(shared),
    "officialMedianAbsoluteMs": float(np.median([abs(row["ddcOfficialErrorMs"]) for row in shared])) if shared else None,
    "parabolicMedianAbsoluteMs": float(np.median([abs(row["ddcParabolicErrorMs"]) for row in shared])) if shared else None,
    "officialP95AbsoluteMs": float(np.percentile([abs(row["ddcOfficialErrorMs"]) for row in shared], 95)) if shared else None,
    "parabolicP95AbsoluteMs": float(np.percentile([abs(row["ddcParabolicErrorMs"]) for row in shared], 95)) if shared else None,
    "officialWithin5Count": sum(abs(row["ddcOfficialErrorMs"]) <= 5.0 for row in shared),
    "parabolicWithin5Count": sum(abs(row["ddcParabolicErrorMs"]) <= 5.0 for row in shared),
}
compare(result["interpolationPairedDiagnosticsNotCalibration"], interpolation, "interpolation")

for method in ["ddcOfficial", "ddcParabolic"]:
    oracle_items = []
    for row in raw_rows:
        if row["actualOnsetMs"] is None:
            continue
        peaks = np.load(ROOT / "activations" / f"{row['sampleId']}.npz")[f"{method}PeakMs"]
        target = row["actualOnsetMs"]
        choices = [float(peak) for peak in peaks if abs(float(peak) - target) <= 20.0]
        residual = None if not choices else min(choices, key=lambda peak: abs(peak - target)) - target
        oracle_items.append((row["weight"], residual))
    broad = sum(weight for weight, _ in oracle_items)
    outputs = sum(weight for weight, residual in oracle_items if residual is not None)
    correct = sum(weight for weight, residual in oracle_items if residual is not None and abs(residual) <= 5.0)
    errors = [residual for _, residual in oracle_items if residual is not None]
    expected = result["oracleCenteredModelOnlyDiagnostics"][method]
    for key, value in {
        "broadLabelWeight": broad, "candidateOutputWeight": outputs, "correctWeight": correct,
        "coverageOfBroadLabels": div(outputs, broad), "within5RateOfBroadLabels": div(correct, broad),
        "within5RateOfOutputs": div(correct, outputs),
        "medianSignedMs": float(np.median(errors)) if errors else None,
        "medianAbsoluteMs": float(np.median(np.abs(errors))) if errors else None,
        "p95AbsoluteMs": float(np.percentile(np.abs(errors), 95)) if errors else None,
    }.items():
        close(expected[key], value, f"oracle/{method}/{key}")

validation = {"version": "v560-independent-result-recheck-v1", "passed": not failures,
              "comparisonRows": len(comparison), "recomputedMethods": list(METHODS),
              "populationWeight": 3468.0, "knownDevelopmentLabelUpperBound": upper_bound,
              "confirmationSetRemainsIsolated": not failures, "failures": failures}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 90行候选、标签、full基线、CSV、权重哈希和确认集隔离一致")
print("ok: 三组主指标、插值诊断、oracle中心诊断、标签上限及80%标志均独立重算一致")
print("V560_RESULT_VALIDATION_PASSED")
