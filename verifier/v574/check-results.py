# v574: 独立从谱面副本、冻结相位和full峰重建24416行候选、误差、CSV与全部统计。
from __future__ import annotations

import csv
import hashlib
import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
manifest = json.loads((ROOT / "source-manifest.json").read_text(encoding="utf-8"))
result = json.loads((ROOT / "baseline-results.json").read_text(encoding="utf-8"))
METHODS = ["legacyResidual", "e5Calibrated", "e13CorrectedTargetRematch"]
failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual, expected, message: str) -> None:
    if actual is None or expected is None:
        check(actual is expected, message)
    else:
        check(math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-8), f"{message}: {actual} != {expected}")


def compare(actual, expected, label: str) -> None:
    if isinstance(expected, dict):
        check(isinstance(actual, dict), f"{label}不是对象")
        if not isinstance(actual, dict):
            return
        check(set(actual) == set(expected), f"{label}字段不同: {set(actual) ^ set(expected)}")
        for key, value in expected.items():
            compare(actual.get(key), value, f"{label}/{key}")
    elif isinstance(expected, (float, int)) and not isinstance(expected, bool):
        close(actual, expected, label)
    else:
        check(actual == expected, f"{label}: {actual} != {expected}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def hit_times(path: Path) -> list[int]:
    text = path.read_text(encoding="utf-8-sig")
    section = text.split("[HitObjects]", 1)[1].split("[", 1)[0]
    return sorted(round(float(row.split(",")[2])) for row in section.splitlines() if row.strip())


def nearest(peaks: list[float], center: float) -> float | None:
    eligible = [peak for peak in peaks if center - 10 <= peak <= center + 10]
    return min(eligible, key=lambda peak: (abs(peak - center), peak)) if eligible else None


def quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    position = (len(values) - 1) * q
    low, high = math.floor(position), math.ceil(position)
    return values[low] + (values[high] - values[low]) * (position - low)


def metrics(source: list[dict], method: str) -> dict:
    errors = [row[method] for row in source if row[method] is not None]
    absolute = [abs(error) for error in errors]
    correct = sum(error <= 5 for error in absolute)
    return {
        "count": len(source), "candidateCount": len(errors), "missingCount": len(source) - len(errors),
        "correctCount": correct, "correctRate": correct / len(source) if source else None,
        "candidateCoverage": len(errors) / len(source) if source else None,
        "medianAbsoluteErrorMs": quantile(absolute, 0.5), "p95AbsoluteErrorMs": quantile(absolute, 0.95),
    }


check(config["sampleCount"] == len(manifest["samples"]) == 18, "必须为18张谱面")
check(config["objectCount"] == 24416, "冻结物件数必须为24416")
expected_rows = []
baseline_correct = 0
per_sample_groups = []
for sample in manifest["samples"]:
    sample_id = sample["id"]
    beatmap = Path(sample["workspaceBeatmapPath"])
    audio = Path(sample["workspaceAudioPath"])
    check(sha256(beatmap) == sample["beatmapSha256"], f"谱面哈希改变/{sample_id}")
    check(sha256(audio) == sample["audioSha256"], f"音频哈希改变/{sample_id}")
    times = hit_times(beatmap)
    check(len(times) == sample["objectCountIncludingSimultaneousObjects"], f"物件数不一致/{sample_id}")
    check(len(set(times)) == sample["uniqueObjectTimeCount"], f"唯一时间数不一致/{sample_id}")
    data = json.loads((ROOT / "per-sample" / f"{sample_id}.json").read_text(encoding="utf-8"))
    check(times == data["hitTimesMs"], f"相位输入物件与谱面副本不一致/{sample_id}")
    meta = json.loads((ROOT / "decoded" / sample_id / "meta.json").read_text(encoding="utf-8"))
    check(meta["sampleRate"] == 11025 and meta["length"] > 0, f"解码元数据异常/{sample_id}")
    for channel in range(meta["numberOfChannels"]):
        check((ROOT / "decoded" / sample_id / f"ch{channel}.f32").stat().st_size == meta["length"] * 4, f"PCM长度异常/{sample_id}/ch{channel}")
    chosen = next(item for item in data["configurations"] if item["aggregate"] == "top2" and item["method"] == "dp")
    peaks = data["fullPeakMs"]
    check(all(peaks[i] < peaks[i + 1] for i in range(len(peaks) - 1)), f"full峰未严格排序/{sample_id}")
    delay = data["globalDelay"]["delayMs"]
    sample_rows = []
    for index, reference in enumerate(times):
        segment = next((i for i, line in enumerate(data["redlines"]) if line["timeMs"] <= reference < line["endMs"]), -1)
        fold = "odd" if index % 2 == 0 else "even"
        phase = chosen["phases"]["actual"][fold][segment] if segment >= 0 else 0
        old = nearest(peaks, reference + delay + phase)
        sample_rows.append({
            "segmentId": f"{sample_id}_h{reference}", "sampleId": sample_id, "tag": sample["tag"],
            "hitIndex": index, "fold": fold, "referenceMs": reference, "redlineSegment": segment,
            "globalDelayMs": delay, "phaseMs": phase, "targetMs": reference + delay + phase,
            "oldTargetFullCandidateAbsoluteMs": old,
        })
    for row in sample_rows:
        fit_fold = "even" if row["fold"] == "odd" else "odd"
        fit = [item for item in sample_rows if item["fold"] == fit_fold and item["oldTargetFullCandidateAbsoluteMs"] is not None]
        correction = statistics.median([item["oldTargetFullCandidateAbsoluteMs"] - item["referenceMs"] for item in fit]) if len(fit) >= 3 else 0.0
        old = row["oldTargetFullCandidateAbsoluteMs"]
        center = row["targetMs"] - correction
        candidates = {
            "legacyResidual": None if old is None else old - row["globalDelayMs"] - row["phaseMs"],
            "e5Calibrated": None if old is None else old - correction,
            "e13CorrectedTargetRematch": nearest(peaks, center),
        }
        row.update({"fitFold": fit_fold, "fitPairCount": len(fit), "correctionMs": correction, "e13CorrectedCenterMs": center})
        for method, candidate in candidates.items():
            row[f"{method}CandidateAbsoluteMs"] = candidate
            row[method] = None if candidate is None else candidate - row["referenceMs"]
        expected_rows.append(row)
    per_sample_groups.append((sample_id, sample_rows))
    baseline_correct += chosen["actualCrossFit"]["all"]["within5"]
check(len(expected_rows) == len({row["segmentId"] for row in expected_rows}) == 24416, "重建行数或segmentId唯一性异常")

with (ROOT / "onset-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    csv_rows = list(csv.DictReader(handle))
check(len(csv_rows) == 24416, "CSV必须为24416行")
csv_by_id = {row["segmentId"]: row for row in csv_rows}
check(len(csv_by_id) == len(csv_rows), "CSV segmentId不唯一")
fields = ["segmentId", "sampleId", "hitIndex", "fold", "referenceMs", "redlineSegment", "targetMs", "globalDelayMs", "phaseMs",
          "oldTargetFullCandidateAbsoluteMs", "fitFold", "fitPairCount", "correctionMs", "e13CorrectedCenterMs"]
for method in METHODS:
    fields += [f"{method}CandidateAbsoluteMs", f"{method}ErrorMs"]
for expected in expected_rows:
    actual = csv_by_id.get(expected["segmentId"])
    check(actual is not None, f"CSV缺行/{expected['segmentId']}")
    if actual is None:
        continue
    check(set(actual) == set(fields), f"CSV字段不同/{expected['segmentId']}")
    for field in fields:
        value = expected[field[:-7]] if field.endswith("ErrorMs") else expected[field]
        text = actual[field]
        if isinstance(value, str):
            check(text == value, f"CSV/{expected['segmentId']}/{field}")
        else:
            close(None if text == "" else float(text), value, f"CSV/{expected['segmentId']}/{field}")

expected_methods = {}
for method in METHODS:
    expected_methods[method] = {
        "overall": metrics(expected_rows, method),
        "perSample": {sample_id: metrics(source, method) for sample_id, source in per_sample_groups},
        "specialTags": {tag: metrics([row for row in expected_rows if row["tag"] == tag], method)
                        for tag in ["user_requested_low_bpm", "user_requested_extreme_high_and_low_bpm_variable"]},
    }
compare(result["methods"], expected_methods, "全部指标")
legacy_correct = expected_methods["legacyResidual"]["overall"]["correctCount"]
check(legacy_correct == baseline_correct == 21619, "legacy与TS基线正确数不一致")
compare(result["legacyBaselineCrosscheck"], {"recomputedCorrectCount": legacy_correct, "baselineTsCorrectCount": baseline_correct, "passed": True}, "legacy交叉核对")
expected_targets = {method: expected_methods[method]["overall"]["correctRate"] >= 0.8 for method in METHODS}
compare(result["targetAchieved"], expected_targets, "80%目标标志")
check(expected_targets == {"legacyResidual": True, "e5Calibrated": True, "e13CorrectedTargetRematch": False}, "目标结果与已复建数值不符")
validation = {
    "version": "v574-independent-onset-recheck-v1",
    "passed": not failures,
    "sampleCount": 18, "comparisonRows": len(csv_rows), "objectCount": len(expected_rows),
    "inputHashesVerified": True, "decodedPcmLengthsVerified": True, "beatmapReferencesVerified": True,
    "candidateRuleVerified": True, "missingCandidatesCountedIncorrect": True, "csvVerified": True,
    "groupsVerified": ["overall", "perSample", "specialTags"],
    "primaryMethod": "legacyResidual",
    "primaryCorrectCount": legacy_correct,
    "primaryCorrectRate": expected_methods["legacyResidual"]["overall"]["correctRate"],
    "targetCorrectRate": 0.8, "targetAchieved": expected_targets["legacyResidual"],
    "allMethodTargets": expected_targets,
    "perSampleAllAtLeast80": all(item["correctRate"] >= 0.8 for item in expected_methods["legacyResidual"]["perSample"].values()),
    "failures": failures,
}
(ROOT / "result-validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    raise SystemExit(1)
print(f"ok: 18张谱面、24416个物件、输入哈希、PCM、候选、CSV和全部分组独立一致")
print(f"ok: legacy总体={legacy_correct}/24416={validation['primaryCorrectRate'] * 100:.4f}%，达到80%；不要求每张都达到80%={validation['perSampleAllAtLeast80']}")
print("V574_RESULT_VALIDATION_PASSED")
