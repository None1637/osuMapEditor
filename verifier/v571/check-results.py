# v571: 独立复验full峰parity、主诊断和±50ms空对照。
from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
null_config = json.loads((ROOT / "null-control.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "diagnostic-results.json").read_text(encoding="utf-8"))
null_result = json.loads((ROOT / "null-control-results.json").read_text(encoding="utf-8"))
parity = json.loads((ROOT / "peak-export-parity.json").read_text(encoding="utf-8"))
baseline_rows = json.loads((ROOT.parent / "v569" / "gated-candidates.json").read_text(encoding="utf-8"))["rows"]
raw_rows = json.loads((ROOT.parent / "v558" / "candidates.json").read_text(encoding="utf-8"))["rows"]
raw_by_id = {row["segmentId"]: row for row in raw_rows}
peaks_by_sample = {sample: json.loads((ROOT / "per-sample" / f"{sample}.json").read_text(encoding="utf-8"))["fullPeakMs"]
                   for sample in config["sampleIds"]}
CATEGORIES = ["correctPeakSelectedByOldTarget", "correctPeakReachableButNotSelected",
              "correctPeakOutsideOldTargetWindow", "nearbyPeakButOutside5ms", "noFullPeakWithin20ms"]
failures = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual, expected, label: str) -> None:
    if actual is None or expected is None:
        check(actual is expected, label)
    else:
        check(math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-9), f"{label}: {actual} != {expected}")


def compare(actual, expected, label: str) -> None:
    if isinstance(expected, dict):
        check(isinstance(actual, dict), f"{label}不是对象")
        if not isinstance(actual, dict):
            return
        check(set(actual) == set(expected), f"{label}字段不同")
        for key, value in expected.items():
            compare(actual.get(key), value, f"{label}/{key}")
    elif isinstance(expected, (float, int)) and not isinstance(expected, bool):
        close(actual, expected, label)
    else:
        check(actual == expected, f"{label}: {actual} != {expected}")


def brute_nearest(peaks: list[float], center: float, radius: float) -> float | None:
    choices = [peak for peak in peaks if abs(peak - center) <= radius]
    return min(choices, key=lambda value: (abs(value - center), value)) if choices else None


# 独立从导出峰复算90个旧目标最近候选，不能只相信导出脚本自报parity。
parity_by_id = {row["segmentId"]: row for row in parity["rows"]}
check(parity["passed"] is True and parity["comparisonRows"] == 90 and len(parity_by_id) == 90, "parity记录必须为90行")
for raw in raw_rows:
    peak = brute_nearest(peaks_by_sample[raw["sampleId"]], raw["targetMs"], 10.0)
    residual = None if peak is None else peak - raw["targetMs"]
    close(residual, raw["fullResidualMs"], f"独立parity/{raw['segmentId']}")
    record = parity_by_id.get(raw["segmentId"])
    check(record is not None, f"parity缺少{raw['segmentId']}")
    if record is not None:
        close(record["reproducedResidualMs"], residual, f"parity记录/{raw['segmentId']}")

rows = []
for baseline in baseline_rows:
    if baseline["sampleId"] not in config["diagnosticSampleIds"] or baseline["confidence"] not in {"clear", "approximate"}:
        continue
    raw = raw_by_id[baseline["segmentId"]]
    actual, target = float(baseline["actualOnsetMs"]), float(raw["targetMs"])
    peak = brute_nearest(peaks_by_sample[baseline["sampleId"]], actual, 20.0)
    residual = None if peak is None else peak - actual
    selected = None if raw["fullResidualMs"] is None else target + raw["fullResidualMs"]
    if peak is not None and abs(residual) <= 5.0:
        if selected is not None and abs(selected - peak) <= 1e-9:
            category = CATEGORIES[0]
        elif abs(peak - target) <= 10.0:
            category = CATEGORIES[1]
        else:
            category = CATEGORIES[2]
    elif peak is not None:
        category = CATEGORIES[3]
    else:
        category = CATEGORIES[4]
    error = baseline["e10GatedErrorMs"]
    rows.append({"segmentId": baseline["segmentId"], "sampleId": baseline["sampleId"], "fold": baseline["fold"],
        "stratum": baseline["stratum"], "weight": baseline["weight"], "confidence": baseline["confidence"],
        "referenceMs": baseline["referenceMs"], "targetMs": target, "actualOnsetMs": actual,
        "actualMinusTargetMs": actual - target, "nearestFullPeakMs": peak, "nearestFullPeakErrorMs": residual,
        "oldSelectedFullPeakMs": selected, "correctPeakMinusTargetMs": None if peak is None else peak - target,
        "e10GatedCandidateAbsoluteMs": baseline["e10GatedCandidateAbsoluteMs"], "e10GatedErrorMs": error,
        "e10Within5": error is not None and abs(error) <= 5.0, "failureCategory": category})
check(len(rows) == 29 and abs(sum(row["weight"] for row in rows) - 1717.8) < 1e-9, "主诊断人口错误")


def check_csv(filename: str, expected_rows: list[dict]) -> None:
    with (ROOT / filename).open("r", encoding="utf-8-sig", newline="") as handle:
        csv_rows = list(csv.DictReader(handle))
    check(len(csv_rows) == len(expected_rows), f"{filename}行数错误")
    key_fields = ["segmentId"] if filename == "full-peak-recoverability.csv" else ["segmentId", "shiftMs"]
    csv_by_key = {tuple(row[key] for key in key_fields): row for row in csv_rows}
    for expected in expected_rows:
        key = tuple(str(expected[field]) for field in key_fields)
        actual = csv_by_key.get(key)
        check(actual is not None, f"{filename}缺少{key}")
        if actual is None:
            continue
        check(set(actual) == set(expected), f"{filename}字段不同/{key}")
        for field, value in expected.items():
            text = actual.get(field)
            if isinstance(value, (str, bool)):
                check(text == str(value), f"{filename}/{key}/{field}")
            else:
                close(None if text == "" else float(text), value, f"{filename}/{key}/{field}")


check_csv("full-peak-recoverability.csv", rows)


def summarize(source: list[dict]) -> dict:
    total = sum(row["weight"] for row in source)
    incorrect = [row for row in source if not row["e10Within5"]]
    incorrect_weight = sum(row["weight"] for row in incorrect)
    categories = {}
    for category in CATEGORIES:
        selected = [row for row in source if row["failureCategory"] == category]
        wrong = [row for row in selected if not row["e10Within5"]]
        weight, wrong_weight = sum(row["weight"] for row in selected), sum(row["weight"] for row in wrong)
        categories[category] = {"count": len(selected), "weight": weight, "e10IncorrectCount": len(wrong),
            "e10IncorrectWeight": wrong_weight, "shareOfAllWeight": weight / total if total else None,
            "shareOfE10IncorrectWeight": wrong_weight / incorrect_weight if incorrect_weight else None}
    return {"count": len(source), "weight": total, "e10IncorrectCount": len(incorrect),
            "e10IncorrectWeight": incorrect_weight, "categories": categories}


expected_per_sample = {sample: summarize([row for row in rows if row["sampleId"] == sample]) for sample in config["diagnosticSampleIds"]}
expected_combined = summarize(rows)
compare(result["perSample"], expected_per_sample, "分歌曲诊断")
compare(result["combinedTwoSongs"], expected_combined, "合并诊断")
all_broad = [row for row in baseline_rows if row["confidence"] in {"clear", "approximate"}]
broad_weight = sum(row["weight"] for row in all_broad)
current_correct = sum(row["weight"] for row in all_broad if row["e10GatedErrorMs"] is not None and abs(row["e10GatedErrorMs"]) <= 5.0)
outside = sum(row["weight"] for row in rows if not row["e10Within5"] and row["failureCategory"] == CATEGORIES[2])
all_correct = sum(row["weight"] for row in rows if not row["e10Within5"] and row["failureCategory"] in CATEGORIES[:3])
expected_bounds = {"overallBroadWeight": broad_weight, "currentE10CorrectWeight": current_correct,
    "currentE10Rate": current_correct / broad_weight, "outsideWindowRecoverableIncorrectWeight": outside,
    "outsideWindowOnlyRateUpperBound": (current_correct + outside) / broad_weight,
    "allCorrectPeakCategoriesRecoverableIncorrectWeight": all_correct,
    "allCorrectPeakCategoriesRateUpperBound": (current_correct + all_correct) / broad_weight,
    "warning": "Annotated centers choose peaks; no false-positive cost, deployable target predictor or new candidate system is measured"}
compare(result["oracleUpperBoundsNotSystemScores"], expected_bounds, "oracle上限")
correct_error_weight = sum(expected_combined["categories"][category]["e10IncorrectWeight"] for category in CATEGORIES[:3])
h1 = correct_error_weight / expected_combined["e10IncorrectWeight"] >= 0.5
h2 = (current_correct + all_correct) / broad_weight >= 0.8
compare(result["hypotheses"], {"H1": h1, "H2": h2, "H3": True}, "猜想标志")
compare(result["annotationSummary"], {"audibleObjectsInTwoSongs": 29,
    "confidenceCounts": dict(Counter(row["confidence"] for row in rows))}, "标签汇总")

null_rows = []
for row in rows:
    for shift in null_config["shiftsMs"]:
        center = row["actualOnsetMs"] + shift
        peak = brute_nearest(peaks_by_sample[row["sampleId"]], center, null_config["searchRadiusMs"])
        null_rows.append({"segmentId": row["segmentId"], "sampleId": row["sampleId"], "shiftMs": shift,
            "weight": row["weight"], "e10Within5": row["e10Within5"], "shiftedCenterMs": center,
            "nearestFullPeakMs": peak, "nullPeakWithin5": peak is not None})
check(len(null_rows) == 58, "空对照必须为58行")
check_csv("null-control-comparison.csv", null_rows)


def coverage(source: list[dict]) -> dict:
    total = sum(row["weight"] for row in source)
    incorrect = [row for row in source if not row["e10Within5"]]
    incorrect_total = sum(row["weight"] for row in incorrect)
    hits = [row for row in source if row["nullPeakWithin5"]]
    incorrect_hits = [row for row in incorrect if row["nullPeakWithin5"]]
    return {"count": len(source), "weight": total, "peakWithin5Weight": sum(row["weight"] for row in hits),
        "peakWithin5Rate": sum(row["weight"] for row in hits) / total, "e10IncorrectWeight": incorrect_total,
        "e10IncorrectPeakWithin5Weight": sum(row["weight"] for row in incorrect_hits),
        "e10IncorrectPeakWithin5Rate": sum(row["weight"] for row in incorrect_hits) / incorrect_total}


expected_per_shift = {str(shift): coverage([row for row in null_rows if row["shiftMs"] == shift]) for shift in null_config["shiftsMs"]}
expected_null_combined = coverage(null_rows)
compare(null_result["perShift"], expected_per_shift, "空对照分移位")
compare(null_result["combinedShifts"], expected_null_combined, "空对照合并")
expected_actual = {"allCorrectPeakWeight": sum(expected_combined["categories"][category]["weight"] for category in CATEGORIES[:3]),
    "allCorrectPeakRate": sum(expected_combined["categories"][category]["weight"] for category in CATEGORIES[:3]) / expected_combined["weight"],
    "e10IncorrectCorrectPeakWeight": correct_error_weight,
    "e10IncorrectCorrectPeakRate": correct_error_weight / expected_combined["e10IncorrectWeight"]}
compare(null_result["actualCenterReference"], expected_actual, "实际中心参照")
validation = {"version": "v571-full-recoverability-independent-recheck-v1", "passed": not failures,
    "peakParityRows": 90, "mainRows": len(rows), "nullRows": len(null_rows),
    "completeMutuallyExclusivePartitionVerified": True, "nullControlVerified": True,
    "hypotheses": {"H1": h1, "H2": h2, "H3": not failures},
    "actualIncorrectCorrectPeakRate": expected_actual["e10IncorrectCorrectPeakRate"],
    "nullIncorrectPeakRate": expected_null_combined["e10IncorrectPeakWithin5Rate"],
    "oracleUpperBound": expected_bounds["allCorrectPeakCategoriesRateUpperBound"],
    "interpretation": "Oracle H1/H2 are arithmetically true but shifted-center null shows dense-peak selection freedom; not a deployable accuracy claim",
    "failures": failures}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 90行parity、29行主诊断、58行空对照和全部指标独立一致")
print(f"ok: 实际错误中心正确峰率={validation['actualIncorrectCorrectPeakRate'] * 100:.4f}%，空对照={validation['nullIncorrectPeakRate'] * 100:.4f}%")
print("V571_RESULT_VALIDATION_PASSED")
