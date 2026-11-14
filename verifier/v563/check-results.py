# v563: 不调用 calibrate/analyze，从原始候选、标签和谱面独立复验 E5。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V541 = ROOT.parent / "v541"
V548 = ROOT.parent / "v548"
V557 = ROOT.parent / "v557"
V558 = ROOT.parent / "v558"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
FOLDS = ["odd", "even"]
METHODS = ["full", "e5Calibrated"]
TOLERANCE_MS = 5.0

config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
payload = json.loads((ROOT / "calibrated-candidates.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
selection = json.loads((V557 / "selection.json").read_text(encoding="utf-8"))["segments"]
source = json.loads((V558 / "candidates.json").read_text(encoding="utf-8"))
source_by_id = {row["segmentId"]: row for row in source["rows"]}
selected_beatmaps = json.loads((V548 / "selection.json").read_text(encoding="utf-8"))["samples"]
failures = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual, expected, message: str) -> None:
    if actual is None or expected is None:
        check(actual is expected, message)
    else:
        check(math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-9),
              f"{message}: {actual} != {expected}")


def compare(actual, expected, label: str) -> None:
    check(isinstance(actual, dict), f"{label}不是对象")
    if not isinstance(actual, dict):
        return
    check(set(actual) == set(expected), f"{label}字段不一致: {set(actual) ^ set(expected)}")
    for key, expected_value in expected.items():
        actual_value = actual.get(key)
        if isinstance(expected_value, dict):
            compare(actual_value, expected_value, f"{label}/{key}")
        elif isinstance(expected_value, (float, int)) and not isinstance(expected_value, bool):
            close(actual_value, expected_value, f"{label}/{key}")
        else:
            check(actual_value == expected_value, f"{label}/{key}")


def percentile_95(values: list[float]) -> float:
    """NumPy 默认 linear 百分位的独立、纯标准库实现。"""
    ordered = sorted(values)
    position = (len(ordered) - 1) * 0.95
    lower = math.floor(position)
    upper = math.ceil(position)
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


check(config["status"] == "frozen_before_candidate_evaluation", "冻结配置状态改变")
check(config["productionCodeChanged"] is False, "生产代码标志改变")
check(payload["configuration"] == config, "候选内嵌配置与冻结配置不同")
check(json.loads((ROOT.parent / "v562" / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True,
      "v562绝对时间纠错复验未通过")
annotations = {}
for sample in SAMPLES:
    with (V557 / f"annotations-{sample}.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            annotations[row["segmentId"]] = row
check(len(selection) == len(annotations) == len(source_by_id) == 90, "选件、标签、原始候选必须各为90")

# 从 .osu 的 HitObjects 和 v548 红线独立重建物件序号、奇偶折和红线段。
hit_by_time = {}
for sample in SAMPLES:
    previous = json.loads((V548 / "per-sample" / f"{sample}.json").read_text(encoding="utf-8"))
    beatmap_file = next(item["beatmapFile"] for item in selected_beatmaps if item["id"] == sample)
    osu = (V541 / "samples" / sample / beatmap_file).read_text(encoding="utf-8")
    section = osu.split("[HitObjects]", 1)[1].split("[", 1)[0]
    times = sorted({round(float(line.strip().split(",")[2])) for line in section.splitlines()
                    if line.strip() and len(line.strip().split(",")) > 2 and float(line.strip().split(",")[2]) >= 0})
    sample_hits = {}
    for index, time_ms in enumerate(times):
        redline_segment = next((i for i, redline in enumerate(previous["redlines"])
                                if redline["timeMs"] <= time_ms < redline["endMs"]), -1)
        sample_hits[time_ms] = {
            "hitIndex": index,
            "redlineSegment": redline_segment,
            "fold": "odd" if index % 2 == 0 else "even",
        }
    hit_by_time[sample] = sample_hits

rows = []
for segment in selection:
    segment_id = segment["segmentId"]
    annotation = annotations[segment_id]
    candidate = source_by_id[segment_id]
    confidence = annotation["confidence"]
    actual_relative = None if confidence == "no_clear_onset" else int(annotation["actualRelativeMs"])
    actual_onset = None if actual_relative is None else int(annotation["actualOnsetMs"])
    if actual_onset is not None:
        close(actual_onset, segment["referenceMs"] + actual_relative, f"{segment_id}/标签绝对时间")
    close(candidate["referenceMs"], segment["referenceMs"], f"{segment_id}/候选参考时间")
    close(candidate["targetMs"], candidate["referenceMs"] + candidate["globalDelayMs"] + candidate["phaseMs"],
          f"{segment_id}/目标中心")
    residual = candidate["fullResidualMs"]
    absolute = None if residual is None else candidate["targetMs"] + residual
    error = None if absolute is None or actual_onset is None else absolute - actual_onset
    hit = hit_by_time[segment["sampleId"]][segment["referenceMs"]]
    rows.append({
        "segmentId": segment_id,
        "sampleId": segment["sampleId"],
        "stratum": segment["stratum"],
        "weight": float(segment["stratumWeight"]),
        "referenceMs": segment["referenceMs"],
        "confidence": confidence,
        "actualOnsetMs": actual_onset,
        "actualRelativeMs": actual_relative,
        **hit,
        "targetMs": candidate["targetMs"],
        "fullResidualMs": residual,
        "fullCandidateAbsoluteMs": absolute,
        "fullErrorMs": error,
    })

# 只用另一折重新估计修正量，并显式检查拟合集隔离。
expected_records = []
for sample in SAMPLES:
    for fold in FOLDS:
        opposite = "even" if fold == "odd" else "odd"
        fit_rows = [row for row in rows if row["sampleId"] == sample and row["fold"] == opposite
                    and row["confidence"] in {"clear", "approximate"} and row["fullErrorMs"] is not None
                    and math.isfinite(row["fullErrorMs"])]
        correction = float(statistics.median(row["fullErrorMs"] for row in fit_rows)) \
            if len(fit_rows) >= config["minimumPairs"] else config["fallbackCorrectionMs"]
        expected_records.append({
            "sampleId": sample,
            "fold": fold,
            "fitFold": opposite,
            "pairCount": len(fit_rows),
            "correctionMs": correction,
            "usedFallback": len(fit_rows) < config["minimumPairs"],
            "fitSegmentIds": [row["segmentId"] for row in fit_rows],
        })
check(len(payload["calibrationRecords"]) == len(expected_records) == 6, "校准记录必须为6组")
record_by_key = {}
for actual_record, expected_record in zip(payload["calibrationRecords"], expected_records):
    key = (expected_record["sampleId"], expected_record["fold"])
    record_by_key[key] = expected_record
    compare(actual_record, expected_record, f"校准记录/{key[0]}/{key[1]}")
    check(actual_record["fitFold"] != actual_record["fold"], f"{key}使用同折拟合")
    for segment_id in actual_record["fitSegmentIds"]:
        fit_row = next(row for row in rows if row["segmentId"] == segment_id)
        check(fit_row["sampleId"] == actual_record["sampleId"], f"{key}/{segment_id}跨歌曲拟合")
        check(fit_row["fold"] == actual_record["fitFold"], f"{key}/{segment_id}拟合折错误")

for row in rows:
    record = record_by_key[(row["sampleId"], row["fold"])]
    check(row["segmentId"] not in record["fitSegmentIds"], f"{row['segmentId']}泄漏进自己的拟合集")
    correction = record["correctionMs"]
    absolute = row["fullCandidateAbsoluteMs"]
    row["correctionMs"] = correction
    row["e5CalibratedCandidateAbsoluteMs"] = None if absolute is None else absolute - correction
    row["e5CalibratedErrorMs"] = None if row["fullErrorMs"] is None else row["fullErrorMs"] - correction
    old_correct = row["fullErrorMs"] is not None and abs(row["fullErrorMs"]) <= TOLERANCE_MS
    new_correct = row["e5CalibratedErrorMs"] is not None and abs(row["e5CalibratedErrorMs"]) <= TOLERANCE_MS
    row["transition"] = "bothCorrect" if old_correct and new_correct else \
        ("fixed" if new_correct else ("broken" if old_correct else "bothIncorrect"))

payload_by_id = {row["segmentId"]: row for row in payload["rows"]}
check(len(payload_by_id) == 90, "校准候选必须为90行")
for expected in rows:
    # transition 是 analyze.py 派生到 CSV 的评估字段，不属于校准候选文件。
    candidate_fields = {key: value for key, value in expected.items() if key != "transition"}
    compare(payload_by_id.get(expected["segmentId"]), candidate_fields, f"候选行/{expected['segmentId']}")

with (ROOT / "calibrated-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    comparison = list(csv.DictReader(handle))
check(len(comparison) == 90, "对比CSV必须为90行")
comparison_by_id = {row["segmentId"]: row for row in comparison}
for expected in rows:
    actual = comparison_by_id[expected["segmentId"]]
    for key, expected_value in expected.items():
        if isinstance(expected_value, str):
            check(actual[key] == expected_value, f"CSV/{expected['segmentId']}/{key}")
        else:
            close(None if actual[key] == "" else float(actual[key]), expected_value,
                  f"CSV/{expected['segmentId']}/{key}")


def div(a: float, b: float) -> float | None:
    return a / b if b else None


def recompute(source_rows: list[dict], method: str) -> dict:
    error_key = f"{method}ErrorMs"
    present = [row for row in source_rows if row["fullCandidateAbsoluteMs"] is not None]
    correct = [row for row in source_rows if row[error_key] is not None and abs(row[error_key]) <= TOLERANCE_MS]
    correct_clear = [row for row in correct if row["confidence"] == "clear"]
    clear = [row for row in source_rows if row["confidence"] == "clear"]
    broad = [row for row in source_rows if row["confidence"] in {"clear", "approximate"}]
    no_clear = [row for row in source_rows if row["confidence"] == "no_clear_onset"]
    no_clear_present = [row for row in no_clear if row["fullCandidateAbsoluteMs"] is not None]
    errors = [row[error_key] for row in source_rows if row[error_key] is not None]
    absolute_errors = [abs(value) for value in errors]
    return {
        "sampleCount": len(source_rows),
        "candidateOutputCount": len(present),
        "correctCount": len(correct),
        "populationWeight": sum(row["weight"] for row in source_rows),
        "candidateOutputWeight": sum(row["weight"] for row in present),
        "clearWeight": sum(row["weight"] for row in clear),
        "broadWeight": sum(row["weight"] for row in broad),
        "noClearOnsetWeight": sum(row["weight"] for row in no_clear),
        "noClearCandidateOutputWeight": sum(row["weight"] for row in no_clear_present),
        "correctClearWeight": sum(row["weight"] for row in correct_clear),
        "correctBroadWeight": sum(row["weight"] for row in correct),
        "candidatePrecision": div(sum(row["weight"] for row in correct), sum(row["weight"] for row in present)),
        "candidateCoverage": div(sum(row["weight"] for row in present), sum(row["weight"] for row in source_rows)),
        "clearOnsetRecall": div(sum(row["weight"] for row in correct_clear), sum(row["weight"] for row in clear)),
        "clearAndApproximateOnsetRecall": div(sum(row["weight"] for row in correct), sum(row["weight"] for row in broad)),
        "allObjectCorrectRate": div(sum(row["weight"] for row in correct), sum(row["weight"] for row in source_rows)),
        "noClearCandidateOutputRate": div(sum(row["weight"] for row in no_clear_present), sum(row["weight"] for row in no_clear)),
        "pairedErrorDiagnosticsNotCalibration": {
            "count": len(errors),
            "medianSignedMs": None if not errors else float(statistics.median(errors)),
            "medianAbsoluteMs": None if not errors else float(statistics.median(absolute_errors)),
            "p95AbsoluteMs": None if not errors else percentile_95(absolute_errors),
        },
    }


expected_methods = {}
for method in METHODS:
    expected_methods[method] = {
        "overall": recompute(rows, method),
        "perSample": {sample: recompute([row for row in rows if row["sampleId"] == sample], method) for sample in SAMPLES},
        "perStratum": {stratum: recompute([row for row in rows if row["stratum"] == stratum], method) for stratum in STRATA},
        "perFold": {fold: recompute([row for row in rows if row["fold"] == fold], method) for fold in FOLDS},
    }
    compare(result["methods"][method], expected_methods[method], f"指标/{method}")

for group_name in ["overall", "perSample", "perStratum", "perFold"]:
    full_group = expected_methods["full"][group_name]
    calibrated_group = expected_methods["e5Calibrated"][group_name]
    pairs = [(full_group, calibrated_group)] if group_name == "overall" else \
        [(full_group[key], calibrated_group[key]) for key in full_group]
    for old, new in pairs:
        for metric in ["candidateOutputWeight", "noClearCandidateOutputWeight", "candidateCoverage", "noClearCandidateOutputRate"]:
            close(new[metric], old[metric], f"输出守卫/{group_name}/{metric}")

metric_keys = ["candidatePrecision", "clearOnsetRecall", "clearAndApproximateOnsetRecall", "allObjectCorrectRate"]
expected_deltas = {key: expected_methods["e5Calibrated"]["overall"][key] - expected_methods["full"]["overall"][key]
                   for key in metric_keys}
compare(result["baselineDeltas"], expected_deltas, "基线差值")
expected_transitions = {}
for category in ["fixed", "broken", "bothCorrect", "bothIncorrect"]:
    selected = [row for row in rows if row["transition"] == category]
    expected_transitions[category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
expected_transitions["netFixedWeight"] = expected_transitions["fixed"]["weight"] - expected_transitions["broken"]["weight"]
compare(result["transitions"], expected_transitions, "转移")
expected_sample_transitions = {}
for sample in SAMPLES:
    expected_sample_transitions[sample] = {}
    for category in ["fixed", "broken"]:
        selected = [row for row in rows if row["sampleId"] == sample and row["transition"] == category]
        expected_sample_transitions[sample][category] = {"count": len(selected), "weight": sum(row["weight"] for row in selected)}
compare(result["perSampleTransitions"], expected_sample_transitions, "分歌曲转移")

expected_annotation_summary = {"labeledObjects": 90, "confidenceCounts": dict(Counter(row["confidence"] for row in rows))}
compare(result["annotationSummary"], expected_annotation_summary, "标签汇总")
expected_target = expected_methods["e5Calibrated"]["overall"]["clearAndApproximateOnsetRecall"] >= 0.8
expected_sample044 = expected_methods["e5Calibrated"]["perSample"]["sample-044"]["clearAndApproximateOnsetRecall"] >= 0.8
check(result["targetAchieved"] is expected_target, "80%目标标志错误")
check(result["sample044AtLeast80Preserved"] is expected_sample044, "sample-044保持标志错误")
hypotheses = {
    "H1": expected_deltas["clearAndApproximateOnsetRecall"] > 0.0,
    "H2": expected_transitions["netFixedWeight"] > 0.0 and expected_sample044,
    "H3": not failures,
}
check(hypotheses["H1"], "H1未成立：校准没有提升总体正确率")
check(hypotheses["H2"], "H2未成立：净收益或sample-044保持条件失败")

validation = {
    "version": "v563-crossfit-independent-recheck-v1",
    "passed": not failures,
    "comparisonRows": len(comparison),
    "calibrationRecords": len(expected_records),
    "independentAbsoluteTimeReconstruction": True,
    "oppositeFoldIsolationVerified": True,
    "csvVerified": True,
    "groupsVerified": ["overall", "perSample", "perStratum", "perFold"],
    "outputGuardrailsUnchanged": True,
    "hypotheses": hypotheses,
    "targetAchieved": expected_target,
    "sample044AtLeast80Preserved": expected_sample044,
    "audibleCorrectRate": expected_methods["e5Calibrated"]["overall"]["clearAndApproximateOnsetRecall"],
    "failures": failures,
}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 90行绝对时间、谱面奇偶折、6组反折中位数、拟合集隔离及CSV均独立一致")
print("ok: 总体/分歌曲/分层/分折指标、输出守卫、基线差值和修正转移均独立重算一致")
print(f"ok: E5有音物件±5ms正确率={validation['audibleCorrectRate'] * 100:.4f}%，80%目标未达到")
print("V563_RESULT_VALIDATION_PASSED")
