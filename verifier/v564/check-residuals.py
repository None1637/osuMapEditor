# v564: 从 E5 候选独立复算误差带、分组、秩相关和CSV。
from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V548 = ROOT.parent / "v548"
V563 = ROOT.parent / "v563"
SAMPLES = ["sample-044", "sample-032", "sample-002"]
BANDS = ["within5", "over5Through10", "over10Through20", "over20", "missingCandidate"]
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "residual-analysis.json").read_text(encoding="utf-8"))
payload = json.loads((V563 / "calibrated-candidates.json").read_text(encoding="utf-8"))
redlines = {sample: json.loads((V548 / "per-sample" / f"{sample}.json").read_text(encoding="utf-8"))["redlines"] for sample in SAMPLES}
failures = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual, expected, message: str) -> None:
    if actual is None or expected is None:
        check(actual is expected, message)
    else:
        check(math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-9), f"{message}: {actual} != {expected}")


def compare(actual, expected, label: str) -> None:
    if isinstance(expected, dict):
        check(isinstance(actual, dict), f"{label}不是对象")
        if not isinstance(actual, dict):
            return
        check(set(actual) == set(expected), f"{label}字段不同: {set(actual) ^ set(expected)}")
        for key, value in expected.items():
            compare(actual.get(key), value, f"{label}/{key}")
    elif isinstance(expected, list):
        check(isinstance(actual, list) and len(actual) == len(expected), f"{label}列表长度不同")
        if isinstance(actual, list) and len(actual) == len(expected):
            for index, value in enumerate(expected):
                compare(actual[index], value, f"{label}/{index}")
    elif isinstance(expected, (float, int)) and not isinstance(expected, bool):
        close(actual, expected, label)
    else:
        check(actual == expected, f"{label}: {actual} != {expected}")


def percentile95(values: list[float]) -> float:
    values = sorted(values)
    position = (len(values) - 1) * 0.95
    low, high = math.floor(position), math.ceil(position)
    return values[low] + (values[high] - values[low]) * (position - low)


def rank(values: list[float]) -> list[float]:
    ordered = sorted(range(len(values)), key=lambda index: values[index])
    output = [0.0] * len(values)
    start = 0
    while start < len(ordered):
        end = start + 1
        while end < len(ordered) and values[ordered[end]] == values[ordered[start]]:
            end += 1
        tied_rank = 1.0 + (start + end - 1) / 2.0
        for position in range(start, end):
            output[ordered[position]] = tied_rank
        start = end
    return output


def correlation(paired: list[dict]) -> float | None:
    if len(paired) < 3:
        return None
    x = rank([float(row["referenceMs"]) for row in paired])
    y = rank([float(row["e5CalibratedErrorMs"]) for row in paired])
    x_mean, y_mean = statistics.mean(x), statistics.mean(y)
    numerator = sum((a - x_mean) * (b - y_mean) for a, b in zip(x, y))
    denominator = math.sqrt(sum((a - x_mean) ** 2 for a in x) * sum((b - y_mean) ** 2 for b in y))
    return None if denominator == 0 else numerator / denominator


def band(error: float | None) -> str:
    if error is None:
        return "missingCandidate"
    if abs(error) <= 5:
        return "within5"
    if abs(error) <= 10:
        return "over5Through10"
    if abs(error) <= 20:
        return "over10Through20"
    return "over20"


check(config["status"] == "frozen_before_diagnostic_evaluation", "诊断配置未冻结")
check(config["candidateSelectionChanged"] is False and config["calibrationChanged"] is False, "诊断改变了候选或校准")
check(config["productionCodeChanged"] is False, "生产代码标志改变")
check(json.loads((V563 / "result-validation.json").read_text(encoding="utf-8"))["passed"] is True, "E5复验未通过")
rows = []
for source in payload["rows"]:
    if source["confidence"] not in {"clear", "approximate"}:
        continue
    row = dict(source)
    segment = row["redlineSegment"]
    metadata = redlines[row["sampleId"]][segment] if segment >= 0 else {"timeMs": None, "endMs": None, "bpm": None}
    row["redlineStartMs"], row["redlineEndMs"], row["redlineBpm"] = metadata["timeMs"], metadata["endMs"], metadata["bpm"]
    row["errorBand"] = band(row["e5CalibratedErrorMs"])
    rows.append(row)
check(len(rows) == 52, "有音物件必须为52")
check(sum(row["e5CalibratedErrorMs"] is not None for row in rows) == 49, "配对物件必须为49")


def summarize(source: list[dict]) -> dict:
    paired = [row for row in source if row["e5CalibratedErrorMs"] is not None]
    errors = [row["e5CalibratedErrorMs"] for row in paired]
    absolute = [abs(value) for value in errors]
    median = statistics.median(errors) if errors else None
    counts = Counter(row["errorBand"] for row in source)
    weights = {name: sum(row["weight"] for row in source if row["errorBand"] == name) for name in BANDS}
    total = sum(row["weight"] for row in source)
    return {
        "audibleCount": len(source), "pairedCount": len(paired), "missingCount": counts["missingCandidate"],
        "audibleWeight": total, "correctWeight": weights["within5"],
        "within5RateIncludingMissing": weights["within5"] / total if total else None,
        "bandCounts": {name: counts[name] for name in BANDS}, "bandWeights": weights,
        "medianSignedMs": median,
        "medianAbsoluteMs": statistics.median(absolute) if absolute else None,
        "medianAbsoluteDeviationMs": statistics.median([abs(value - median) for value in errors]) if errors else None,
        "p95AbsoluteMs": percentile95(absolute) if absolute else None,
        "maximumAbsoluteMs": max(absolute) if absolute else None,
        "spearmanSignedErrorVsTime": correlation(paired),
    }


def grouped(key_function) -> dict:
    keys = sorted({key_function(row) for row in rows}, key=str)
    return {str(key): summarize([row for row in rows if key_function(row) == key]) for key in keys}


compare(result["overall"], summarize(rows), "overall")
compare(result["perSample"], {sample: summarize([row for row in rows if row["sampleId"] == sample]) for sample in SAMPLES}, "perSample")
compare(result["perSampleFold"], grouped(lambda row: (row["sampleId"], row["fold"])), "perSampleFold")
compare(result["perSampleRedline"], grouped(lambda row: (row["sampleId"], row["redlineSegment"])), "perSampleRedline")
compare(result["perSampleRedlineFold"], grouped(lambda row: (row["sampleId"], row["redlineSegment"], row["fold"])), "perSampleRedlineFold")

contrasts = []
for sample in SAMPLES:
    for segment in sorted({row["redlineSegment"] for row in rows if row["sampleId"] == sample}):
        subset = [row for row in rows if row["sampleId"] == sample and row["redlineSegment"] == segment]
        odd = [row for row in subset if row["fold"] == "odd" and row["e5CalibratedErrorMs"] is not None]
        even = [row for row in subset if row["fold"] == "even" and row["e5CalibratedErrorMs"] is not None]
        if len(odd) < 2 or len(even) < 2:
            continue
        odd_median = statistics.median(row["e5CalibratedErrorMs"] for row in odd)
        even_median = statistics.median(row["e5CalibratedErrorMs"] for row in even)
        contrasts.append({"sampleId": sample, "redlineSegment": segment, "oddPairs": len(odd), "evenPairs": len(even),
                          "oddMedianMs": odd_median, "evenMedianMs": even_median, "oddMinusEvenMs": odd_median - even_median})
compare(result["foldContrasts"], contrasts, "foldContrasts")

histogram = {}
for sample in SAMPLES:
    errors = [row["e5CalibratedErrorMs"] for row in rows if row["sampleId"] == sample and row["e5CalibratedErrorMs"] is not None]
    counts = Counter(math.floor((value + 2.5) / 5.0) * 5 for value in errors)
    histogram[sample] = {str(int(center)): counts[center] for center in sorted(counts)}
compare(result["signedErrorHistogramMs"], histogram, "histogram")
ordered = [{key: row[key] for key in ["segmentId", "sampleId", "referenceMs", "fold", "redlineSegment", "e5CalibratedErrorMs", "errorBand"]}
           for row in sorted(rows, key=lambda row: (row["sampleId"], row["referenceMs"]))]
compare(result["orderedResiduals"], ordered, "orderedResiduals")

with (ROOT / "residual-details.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    csv_rows = list(csv.DictReader(handle))
check(len(csv_rows) == 52, "残差CSV必须为52行")
csv_by_id = {row["segmentId"]: row for row in csv_rows}
check(len(csv_by_id) == 52, "残差CSV segmentId必须唯一")
for row in rows:
    actual = csv_by_id[row["segmentId"]]
    for key in ["sampleId", "confidence", "fold", "errorBand"]:
        check(actual[key] == row[key], f"CSV/{row['segmentId']}/{key}")
    for key in ["referenceMs", "weight", "hitIndex", "redlineSegment", "correctionMs", "e5CalibratedErrorMs"]:
        close(None if actual[key] == "" else float(actual[key]), row[key], f"CSV/{row['segmentId']}/{key}")

# 完全反对称必须由原始折中位数和E5反折修正量解释。
record_by_key = {(record["sampleId"], record["fold"]): record for record in payload["calibrationRecords"]}
for contrast in contrasts:
    sample = contrast["sampleId"]
    original_odd = statistics.median(row["fullErrorMs"] for row in rows if row["sampleId"] == sample and row["fold"] == "odd" and row["fullErrorMs"] is not None)
    original_even = statistics.median(row["fullErrorMs"] for row in rows if row["sampleId"] == sample and row["fold"] == "even" and row["fullErrorMs"] is not None)
    close(record_by_key[(sample, "odd")]["correctionMs"], original_even, f"{sample}/odd修正来源")
    close(record_by_key[(sample, "even")]["correctionMs"], original_odd, f"{sample}/even修正来源")
    close(contrast["oddMedianMs"], original_odd - original_even, f"{sample}/odd反对称")
    close(contrast["evenMedianMs"], original_even - original_odd, f"{sample}/even反对称")

correct_weight = sum(row["weight"] for row in rows if row["errorBand"] == "within5")
total_weight = sum(row["weight"] for row in rows)
target_gap = 0.8 * total_weight - correct_weight
validation = {
    "version": "v564-residual-independent-recheck-v1", "passed": not failures,
    "audibleRows": len(rows), "pairedRows": sum(row["e5CalibratedErrorMs"] is not None for row in rows),
    "csvRows": len(csv_rows), "allGroupsAndOrderedResidualsVerified": True,
    "foldOppositionExplainedByE5Algebra": True,
    "maximumAbsoluteErrorMs": max(abs(row["e5CalibratedErrorMs"]) for row in rows if row["e5CalibratedErrorMs"] is not None),
    "target80WeightGap": target_gap,
    "recommendedE6": "same-song leave-one-out unweighted median absolute-error correction",
    "failures": failures,
}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print(f"ok: 52个有音物件、49个配对、全部分组/时间顺序/CSV一致；最大绝对误差={validation['maximumAbsoluteErrorMs']:.4f}ms")
print(f"ok: 奇偶折反对称由E5代数解释；达到80%仍需权重={target_gap:.4f}")
print("V564_RESIDUAL_VALIDATION_PASSED")
