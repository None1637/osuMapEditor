# v562: 独立以绝对毫秒重建候选，验证纠错公式、历史复现和全部新指标。
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
V557 = ROOT.parent / "v557"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
definitions = config["methodDefinitions"]
methods = [item["name"] for item in definitions]
selection = json.loads((V557 / "selection.json").read_text(encoding="utf-8"))["segments"]
source_payloads = {source: json.loads((ROOT.parent / source / "candidates.json").read_text(encoding="utf-8"))
                   for source in {item["source"] for item in definitions}}
source_rows = {source: {row["segmentId"]: row for row in payload["rows"]} for source, payload in source_payloads.items()}
old_method_names = {
    "e1Full": "full", "e1Lag5": "lag5", "e1Superflux": "superflux",
    "e1FullGlobal": "fullGlobal", "e1Lag5Global": "lag5Global", "e1SuperfluxGlobal": "superfluxGlobal",
    "e2NeuralMax": "neuralMax", "e2NeuralPitch": "neuralPitch",
    "e3DdcOfficial": "ddcOfficial", "e3DdcParabolic": "ddcParabolic", "e4Fusion": "fusion",
}
failures = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual, expected, message: str) -> None:
    if actual is None or expected is None:
        check(actual is expected, message)
    else:
        check(math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-9), f"{message}: {actual} != {expected}")


check(config["status"] == "evaluation_correction_before_metrics", "纠错配置状态改变")
check(config["productionCodeChanged"] is False, "生产代码标志改变")
annotations = {}
for sample in SAMPLES:
    with (V557 / f"annotations-{sample}.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            annotations[row["segmentId"]] = row
check(len(selection) == len(annotations) == 90, "选件与标签必须为90")
rows = []
for segment in selection:
    segment_id = segment["segmentId"]
    annotation = annotations[segment_id]
    confidence = annotation["confidence"]
    actual = None if confidence == "no_clear_onset" else int(annotation["actualRelativeMs"])
    actual_onset = None if actual is None else int(annotation["actualOnsetMs"])
    row = {"segmentId": segment_id, "sampleId": segment["sampleId"], "stratum": segment["stratum"],
           "weight": float(segment["stratumWeight"]), "confidence": confidence,
           "actualRelativeMs": actual, "actualOnsetMs": actual_onset}
    for definition in definitions:
        name, field = definition["name"], definition["field"]
        candidate = source_rows[definition["source"]][segment_id]
        residual = candidate[field]
        if definition["targetRule"] == "crossFit":
            target = candidate["targetMs"]
            close(target, candidate["referenceMs"] + candidate["globalDelayMs"] + candidate["phaseMs"], f"{segment_id}/{name}目标中心")
        else:
            target = candidate["referenceMs"] + candidate["globalDelayMs"]
        absolute_candidate = None if residual is None else target + residual
        corrected = None if absolute_candidate is None or actual_onset is None else absolute_candidate - actual_onset
        legacy = None if residual is None or actual is None else residual - actual
        row[f"{name}CandidatePresent"] = residual is not None
        row[f"{name}TargetOffsetMs"] = target - candidate["referenceMs"]
        row[f"{name}ResidualMs"] = residual
        row[f"{name}ErrorMs"] = corrected
        row[f"{name}LegacyErrorMs"] = legacy
        row[f"{name}Correct"] = corrected is not None and abs(corrected) <= 5.0
        row[f"{name}LegacyCorrect"] = legacy is not None and abs(legacy) <= 5.0
    rows.append(row)

# 用三个已手工核算的绝对时间样例锁定公式方向，防止再次漏加或反加偏移。
examples = {
    "sample-044_h24947": -1.0757676997127419,
    "sample-044_h5781": 4.345236495389145,
    "sample-044_h35281": 1.4232192113122437,
}
for segment_id, expected in examples.items():
    row = next(item for item in rows if item["segmentId"] == segment_id)
    close(row["e1FullErrorMs"], expected, f"{segment_id}绝对误差样例")

with (ROOT / "corrected-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    comparison = list(csv.DictReader(handle))
check(len(comparison) == 90, "纠错CSV必须为90行")
comparison_by_id = {row["segmentId"]: row for row in comparison}
for expected in rows:
    actual = comparison_by_id[expected["segmentId"]]
    for method in methods:
        for suffix in ["ResidualMs", "TargetOffsetMs", "ErrorMs", "LegacyErrorMs"]:
            key = f"{method}{suffix}"
            text = actual[key]
            close(None if text == "" else float(text), expected[key], f"{expected['segmentId']}/{key}")
        for suffix in ["Correct", "LegacyCorrect"]:
            key = f"{method}{suffix}"
            check((actual[key] == "1") == expected[key], f"{expected['segmentId']}/{key}")


def div(a: float, b: float) -> float | None:
    return a / b if b else None


def recompute(source: list[dict], method: str, legacy: bool = False) -> dict:
    suffix = "LegacyCorrect" if legacy else "Correct"
    error_suffix = "LegacyErrorMs" if legacy else "ErrorMs"
    population = sum(row["weight"] for row in source)
    outputs = sum(row["weight"] for row in source if row[f"{method}CandidatePresent"])
    clear = sum(row["weight"] for row in source if row["confidence"] == "clear")
    broad = sum(row["weight"] for row in source if row["confidence"] in {"clear", "approximate"})
    no_clear = sum(row["weight"] for row in source if row["confidence"] == "no_clear_onset")
    no_clear_outputs = sum(row["weight"] for row in source if row["confidence"] == "no_clear_onset" and row[f"{method}CandidatePresent"])
    correct_clear = sum(row["weight"] for row in source if row["confidence"] == "clear" and row[f"{method}{suffix}"])
    correct_broad = sum(row["weight"] for row in source if row[f"{method}{suffix}"])
    errors = [row[f"{method}{error_suffix}"] for row in source if row[f"{method}{error_suffix}"] is not None]
    return {
        "sampleCount": len(source), "candidateOutputCount": sum(row[f"{method}CandidatePresent"] for row in source),
        "correctCount": sum(row[f"{method}{suffix}"] for row in source), "populationWeight": population,
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


metric_keys = ["candidatePrecision", "candidateCoverage", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate", "noClearCandidateOutputRate"]
for definition in definitions:
    method = definition["name"]
    report = result["correctedMethods"][method]
    compare(report["overall"], recompute(rows, method), f"{method}/overall")
    for sample in SAMPLES:
        compare(report["perSample"][sample], recompute([row for row in rows if row["sampleId"] == sample], method), f"{method}/{sample}")
    for stratum in STRATA:
        compare(report["perStratum"][stratum], recompute([row for row in rows if row["stratum"] == stratum], method), f"{method}/{stratum}")
    compare(result["legacyMethods"][method]["overall"], recompute(rows, method, legacy=True), f"{method}/legacy")
    check(result["targetAchieved"][method] == (report["overall"]["clearAndApproximateOnsetRecall"] >= 0.8), f"{method} 80%目标标志")
    old_result = json.loads((ROOT.parent / definition["source"] / "analysis-results.json").read_text(encoding="utf-8"))
    old_metrics = old_result["methods"][old_method_names[method]]["overall"]
    for key in metric_keys + ["correctBroadWeight", "correctClearWeight", "correctCount"]:
        close(result["legacyMethods"][method]["overall"][key], old_metrics[key], f"历史复现/{method}/{key}")
    for key in ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]:
        close(result["correctionImpact"][method][key], report["overall"][key] - result["legacyMethods"][method]["overall"][key], f"纠错影响/{method}/{key}")
for method, deltas in result["baselineDeltasVsE1FullCorrected"].items():
    for key, value in deltas.items():
        close(value, result["correctedMethods"][method]["overall"][key] - result["correctedMethods"]["e1Full"]["overall"][key], f"基线差值/{method}/{key}")

broad = [row for row in rows if row["confidence"] in {"clear", "approximate"}]
decomposition = result["e1FullAudibleErrorDecomposition"]
close(sum(decomposition[key]["weight"] for key in ["within5", "over5Through10", "over10", "missingOrNoPairedError"]), sum(row["weight"] for row in broad), "full误差分解总和")
for category in ["within5", "over5Through10", "over10", "missingOrNoPairedError"]:
    selected = []
    for row in broad:
        error = row["e1FullErrorMs"]
        current = "missingOrNoPairedError" if error is None else ("within5" if abs(error) <= 5 else ("over5Through10" if abs(error) <= 10 else "over10"))
        if current == category:
            selected.append(row)
    check(decomposition[category]["count"] == len(selected), f"full分解/{category}数量")
    close(decomposition[category]["weight"], sum(row["weight"] for row in selected), f"full分解/{category}权重")
transition_weights = {}
for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
    selected = []
    for row in rows:
        full, fusion = row["e1FullCorrect"], row["e4FusionCorrect"]
        current = "bothCorrect" if full and fusion else ("fixed" if fusion else ("broken" if full else "bothIncorrect"))
        if current == category:
            selected.append(row)
    transition_weights[category] = sum(row["weight"] for row in selected)
    check(result["e4FusionTransitionsCorrected"][category]["count"] == len(selected), f"融合转移/{category}数量")
    close(result["e4FusionTransitionsCorrected"][category]["weight"], transition_weights[category], f"融合转移/{category}权重")
close(result["e4FusionTransitionsCorrected"]["netFixedWeight"], transition_weights["fixed"] - transition_weights["broken"], "融合净修正")

validation = {"version": "v562-absolute-time-independent-recheck-v1", "passed": not failures,
              "comparisonRows": len(comparison), "methods": methods,
              "absoluteExamplesVerified": list(examples), "historicalOverallMetricsReproduced": True,
              "failures": failures}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 90行绝对时间候选、三个手工样例、global-only目标中心和CSV均一致")
print("ok: 11种方法修正指标、旧指标、历史总体复现、误差分解及融合转移均独立重算一致")
print("V562_RESULT_VALIDATION_PASSED")
