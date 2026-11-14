# v570: 用全数组暴力最近峰独立复验窗口/缺峰分类、CSV和oracle上限。
from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "diagnostic-results.json").read_text(encoding="utf-8"))
baseline_rows = json.loads((ROOT.parent / "v569" / "gated-candidates.json").read_text(encoding="utf-8"))["rows"]
raw_rows = json.loads((ROOT.parent / "v560" / "candidates.json").read_text(encoding="utf-8"))["rows"]
raw_by_id = {row["segmentId"]: row for row in raw_rows}
CATEGORIES = ["correctPeakSelectedByOldTarget", "correctPeakReachableButNotSelected",
              "correctPeakOutsideOldTargetWindow", "nearbyPeakButOutside5ms", "noOfficialPeakWithin20ms"]
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


check(config["status"] == "frozen_before_diagnostic_evaluation", "诊断配置状态改变")
check(config["productionCodeChanged"] is False, "生产代码标志改变")
rows = []
for baseline in baseline_rows:
    if baseline["sampleId"] not in config["sampleIds"] or baseline["confidence"] not in {"clear", "approximate"}:
        continue
    raw = raw_by_id[baseline["segmentId"]]
    peaks = np.load(ROOT.parent / "v560" / "activations" / f"{baseline['sampleId']}.npz")["ddcOfficialPeakMs"]
    actual = float(baseline["actualOnsetMs"])
    target = float(raw["targetMs"])
    nearby = [float(peak) for peak in peaks if abs(float(peak) - actual) <= 20.0]
    peak = min(nearby, key=lambda value: (abs(value - actual), value)) if nearby else None
    residual = None if peak is None else peak - actual
    selected = None if raw["ddcOfficialResidualMs"] is None else target + raw["ddcOfficialResidualMs"]
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
        "actualMinusTargetMs": actual - target, "nearestOfficialPeakMs": peak, "nearestOfficialPeakErrorMs": residual,
        "oldSelectedOfficialPeakMs": selected, "correctPeakMinusTargetMs": None if peak is None else peak - target,
        "e10GatedCandidateAbsoluteMs": baseline["e10GatedCandidateAbsoluteMs"], "e10GatedErrorMs": error,
        "e10Within5": error is not None and abs(error) <= 5.0, "failureCategory": category})
check(len(rows) == 29, "两首歌曲必须有29个有音物件")
check(abs(sum(row["weight"] for row in rows) - 1717.8) < 1e-9, "两首有音权重必须为1717.8")
check(len({row["segmentId"] for row in rows}) == 29, "诊断物件必须唯一")
check(all(row["failureCategory"] in CATEGORIES for row in rows), "存在未分类物件")
with (ROOT / "window-failure-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    csv_rows = list(csv.DictReader(handle))
check(len(csv_rows) == 29, "CSV必须为29行")
csv_by_id = {row["segmentId"]: row for row in csv_rows}
for expected in rows:
    actual = csv_by_id.get(expected["segmentId"])
    check(actual is not None, f"CSV缺少{expected['segmentId']}")
    if actual is None:
        continue
    check(set(actual) == set(expected), f"CSV字段不同/{expected['segmentId']}")
    for key, value in expected.items():
        text = actual.get(key)
        if isinstance(value, (str, bool)):
            check(text == str(value), f"CSV/{expected['segmentId']}/{key}")
        else:
            close(None if text == "" else float(text), value, f"CSV/{expected['segmentId']}/{key}")


def summarize(source: list[dict]) -> dict:
    total = sum(row["weight"] for row in source)
    incorrect = [row for row in source if not row["e10Within5"]]
    incorrect_weight = sum(row["weight"] for row in incorrect)
    categories = {}
    for category in CATEGORIES:
        selected = [row for row in source if row["failureCategory"] == category]
        wrong = [row for row in selected if not row["e10Within5"]]
        weight = sum(row["weight"] for row in selected)
        wrong_weight = sum(row["weight"] for row in wrong)
        categories[category] = {"count": len(selected), "weight": weight, "e10IncorrectCount": len(wrong),
            "e10IncorrectWeight": wrong_weight, "shareOfAllWeight": weight / total if total else None,
            "shareOfE10IncorrectWeight": wrong_weight / incorrect_weight if incorrect_weight else None}
    check(sum(item["count"] for item in categories.values()) == len(source), "分类计数未完整覆盖")
    close(sum(item["weight"] for item in categories.values()), total, "分类权重未完整覆盖")
    return {"count": len(source), "weight": total, "e10IncorrectCount": len(incorrect),
            "e10IncorrectWeight": incorrect_weight, "categories": categories}


expected_per_sample = {sample: summarize([row for row in rows if row["sampleId"] == sample]) for sample in config["sampleIds"]}
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
h1 = expected_combined["categories"][CATEGORIES[2]]["shareOfE10IncorrectWeight"] >= 0.2
h2 = (current_correct + outside) / broad_weight < 0.8
compare(result["hypotheses"], {"H1": h1, "H2": h2, "H3": True}, "猜想标志")
compare(result["annotationSummary"], {"audibleObjectsInTwoSongs": 29,
    "confidenceCounts": dict(Counter(row["confidence"] for row in rows))}, "标签汇总")
validation = {"version": "v570-window-failure-independent-recheck-v1", "passed": not failures,
    "comparisonRows": len(csv_rows), "completeMutuallyExclusivePartitionVerified": True,
    "independentNearestPeakRule": "Brute-force nearest among all frozen official peaks within actual +/-20 ms",
    "hypotheses": {"H1": h1, "H2": h2, "H3": not failures},
    "e10IncorrectWeightTwoSongs": expected_combined["e10IncorrectWeight"],
    "noOfficialPeakIncorrectShare": expected_combined["categories"][CATEGORIES[4]]["shareOfE10IncorrectWeight"],
    "outsideWindowRecoverableIncorrectWeight": outside,
    "outsideWindowOnlyRateUpperBound": expected_bounds["outsideWindowOnlyRateUpperBound"], "failures": failures}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print("ok: 29行互斥分类、CSV、权重和oracle上限独立一致")
print(f"ok: 缺峰占E10错误权重={validation['noOfficialPeakIncorrectShare'] * 100:.4f}%；窗口外可修复权重={outside:.4f}")
print("V570_RESULT_VALIDATION_PASSED")
