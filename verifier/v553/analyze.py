# v553: 锁定 neither 标签后揭示残差，并按 v550 人口权重合并三层。
from __future__ import annotations

import csv
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V550 = ROOT.parent / "v550"
selection = json.loads((V550 / "selection.json").read_text(encoding="utf-8"))
by_id = {segment["segmentId"]: segment for segment in selection["segments"]}
with (ROOT / "annotations-neither.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    annotations = list(csv.DictReader(handle))
assert len(annotations) == 30
assert len({row["segmentId"] for row in annotations}) == 30

rows: list[dict] = []
for annotation in annotations:
    segment = by_id[annotation["segmentId"]]
    assert segment["stratum"] == "neither-within5"
    confidence = annotation["confidence"]
    assert confidence in {"clear", "approximate", "no_clear_onset"}
    relative = None if not annotation["actualRelativeMs"] else int(annotation["actualRelativeMs"])
    actual = None if not annotation["actualOnsetMs"] else int(annotation["actualOnsetMs"])
    if confidence == "no_clear_onset":
        assert relative is None and actual is None and not annotation["actualOnsetClock"]
    else:
        assert relative is not None and actual == segment["referenceMs"] + relative
    row = {
        "segmentId": segment["segmentId"], "sampleId": segment["sampleId"],
        "referenceMs": segment["referenceMs"], "referenceClock": segment["referenceClock"],
        "originalAudioPath": segment["originalAudioPath"], "clipStartClock": segment["clipStartClock"], "clipEndClock": segment["clipEndClock"],
        "confidence": confidence, "actualOnsetMs": actual, "actualRelativeMs": relative, "comment": annotation["comment"],
        "currentResidualMs": segment["currentResidualMs"], "sup5ResidualMs": segment["sup5ResidualMs"],
    }
    for kind in ["current", "sup5"]:
        residual = row[f"{kind}ResidualMs"]
        error = None if residual is None or relative is None else residual - relative
        row[f"{kind}ErrorMs"] = error
        row[f"{kind}Within5"] = None if error is None else abs(error) <= 5
    rows.append(row)
rows.sort(key=lambda row: (row["sampleId"], row["confidence"], row["segmentId"]))


def summarize(source_rows: list[dict], kind: str, confidence_set: set[str]) -> dict:
    selected = [row for row in source_rows if row["confidence"] in confidence_set]
    errors = [row[f"{kind}ErrorMs"] for row in selected if row[f"{kind}ErrorMs"] is not None]
    within = [row for row in selected if row[f"{kind}Within5"] is True]
    return {
        "labelCount": len(selected), "candidatePresent": sum(row[f"{kind}ResidualMs"] is not None for row in selected),
        "within5": len(within), "within5RateAmongLabels": len(within) / len(selected) if selected else None,
        "medianAbsErrorMs": statistics.median(abs(error) for error in errors) if errors else None,
    }


summaries = {}
for kind in ["current", "sup5"]:
    summaries[kind] = {
        "clearOnly": summarize(rows, kind, {"clear"}),
        "clearAndApproximate": summarize(rows, kind, {"clear", "approximate"}),
        "noClearOnset": {
            "labelCount": sum(row["confidence"] == "no_clear_onset" for row in rows),
            "candidatePresent": sum(row["confidence"] == "no_clear_onset" and row[f"{kind}ResidualMs"] is not None for row in rows),
        },
        "all30CandidatePrecisionProxy": {
            "within5": sum(row[f"{kind}Within5"] is True for row in rows), "denominator": 30,
            "definition": "clear/approximate labels with candidate error <=5 ms; all no_clear_onset candidates count as incorrect object-onset proposals",
        },
    }
confidence_counts = {confidence: sum(row["confidence"] == confidence for row in rows) for confidence in ["clear", "approximate", "no_clear_onset"]}
output = {
    "version": "v553-neither-within5-blind-visual-labels-v1",
    "status": "provisional_blind_visual_labels_not_owner_confirmed_and_not_full_80_percent_acceptance",
    "labelingOrder": "annotations-neither.csv was written from candidate-hidden plots before residual analysis",
    "labelCount": 30, "confidenceCounts": confidence_counts, "summaries": summaries,
    "limitations": [
        "visual waveform/spectral-flux review only; no independent listening confirmation",
        "no_clear_onset means no clearly separable onset near the object, not proof of silence",
        "three fixed songs are not a representative estimate for the original 100-song library",
    ],
    "rows": rows,
}
(ROOT / "analysis-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
with (ROOT / "annotated-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    fields = ["segmentId", "sampleId", "originalAudioPath", "clipStartClock", "clipEndClock", "referenceClock", "confidence", "actualRelativeMs", "currentResidualMs", "currentErrorMs", "currentWithin5", "sup5ResidualMs", "sup5ErrorMs", "sup5Within5", "comment"]
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key, "") for key in fields})

# 合并三层：每个物件使用 v550 的 stratumPopulation / 10 权重。
all_rows: list[dict] = []
for version, stratum in [("v551", "only-sup5-within5"), ("v552", "both-within5"), ("v553", "neither-within5")]:
    prior = json.loads((ROOT.parent / version / "analysis-results.json").read_text(encoding="utf-8"))
    for source in prior["rows"]:
        row = dict(source)
        segment = by_id[row["segmentId"]]
        assert segment["stratum"] == stratum
        row["stratum"] = stratum
        row["stratumWeight"] = segment["stratumWeight"]
        all_rows.append(row)
assert len(all_rows) == 90 and len({row["segmentId"] for row in all_rows}) == 90
assert abs(sum(row["stratumWeight"] for row in all_rows) - 4103) < 1e-9


def weighted_summary(source_rows: list[dict], kind: str) -> dict:
    population = sum(row["stratumWeight"] for row in source_rows)
    outputs = sum(row["stratumWeight"] for row in source_rows if row[f"{kind}ResidualMs"] is not None)
    correct = sum(row["stratumWeight"] for row in source_rows if row[f"{kind}Within5"] is True)
    clear = sum(row["stratumWeight"] for row in source_rows if row["confidence"] == "clear")
    broad = sum(row["stratumWeight"] for row in source_rows if row["confidence"] in {"clear", "approximate"})
    correct_clear = sum(row["stratumWeight"] for row in source_rows if row["confidence"] == "clear" and row[f"{kind}Within5"] is True)
    correct_broad = sum(row["stratumWeight"] for row in source_rows if row["confidence"] in {"clear", "approximate"} and row[f"{kind}Within5"] is True)
    no_clear = sum(row["stratumWeight"] for row in source_rows if row["confidence"] == "no_clear_onset")
    return {
        "populationWeight": population, "candidateOutputWeight": outputs, "correctWeight": correct,
        "clearOnsetWeight": clear, "clearAndApproximateOnsetWeight": broad, "noClearOnsetWeight": no_clear,
        "correctClearWeight": correct_clear, "correctBroadWeight": correct_broad,
        "candidatePrecision": correct / outputs if outputs else None,
        "candidateCoverage": outputs / population if population else None,
        "clearOnsetRecall": correct_clear / clear if clear else None,
        "clearAndApproximateOnsetRecall": correct_broad / broad if broad else None,
        "allObjectCorrectRate": correct / population if population else None,
    }


weighted = {
    "version": "v553-three-strata-population-weighted-provisional-v1",
    "status": "provisional_visual_estimate_not_80_percent_acceptance",
    "target": "object onset absolute error <=5 ms for at least 80% under an explicitly reported denominator",
    "weightRule": "each sampled object weight = its sample/stratum population / 10; total weight = 4103 objects",
    "definitions": {
        "correct": "candidate residual minus independently labeled actualRelativeMs has absolute value <=5 ms",
        "candidatePrecision": "weighted correct / weighted candidate outputs; no_clear_onset proposals are incorrect",
        "clearOnsetRecall": "weighted correct clear onsets / weighted clear onsets",
        "clearAndApproximateOnsetRecall": "weighted correct clear or approximate onsets / weighted clear or approximate onsets",
        "allObjectCorrectRate": "weighted correct / all 4103 objects; no_clear_onset and missing candidates cannot count as correct",
    },
    "overall": {kind: weighted_summary(all_rows, kind) for kind in ["current", "sup5"]},
    "perSample": {
        sample_id: {kind: weighted_summary([row for row in all_rows if row["sampleId"] == sample_id], kind) for kind in ["current", "sup5"]}
        for sample_id in ["sample-003", "sample-042", "sample-095"]
    },
    "perStratum": {
        stratum: {kind: weighted_summary([row for row in all_rows if row["stratum"] == stratum], kind) for kind in ["current", "sup5"]}
        for stratum in ["both-within5", "only-sup5-within5", "neither-within5"]
    },
    "limitations": output["limitations"] + ["weighted estimates describe only the 4103 objects in these three songs, not all 17149 objects or the 100-song sample"],
}
(ROOT / "weighted-results.json").write_text(json.dumps(weighted, ensure_ascii=False, indent=2), encoding="utf-8")


def pct(value: float | None) -> str:
    return "—" if value is None else f"{100 * value:.2f}%"


def fmt(value) -> str:
    return "" if value is None else f"{value:.3f}" if isinstance(value, float) else str(value)


clear = confidence_counts["clear"]
approx = confidence_counts["approximate"]
no_clear = confidence_counts["no_clear_onset"]
lines = [
    "# v553：neither 层与三层人口加权结果", "", "## 结论先行", "",
    f"neither 层 30 个物件的锁定盲标为 **clear {clear}、approximate {approx}、no_clear_onset {no_clear}**。",
    "90 个分层盲标现已全部完成；以下首次按 v550 人口权重还原到三首曲的 4103 个物件。", "",
    "| 候选 | 候选 precision | 输出覆盖率 | clear 音头 recall | clear+approx 音头 recall | 全物件正确率 |",
    "|---|---:|---:|---:|---:|---:|",
]
for kind, label in [("current", "20 ms 当前"), ("sup5", "5 ms 降低抑制")]:
    item = weighted["overall"][kind]
    lines.append(f"| {label} | {pct(item['candidatePrecision'])} | {pct(item['candidateCoverage'])} | {pct(item['clearOnsetRecall'])} | {pct(item['clearAndApproximateOnsetRecall'])} | {pct(item['allObjectCorrectRate'])} |")
lines += [
    "",
    "这些指标仍是 provisional 视觉精标估计，不是所有者听辨确认，也不能外推为 100 首或全部 17149 物件的验收结果。目标状态保持未完成。",
    "", "## neither 层汇总", "",
    "| 候选 | clear ±5 ms | clear+approx ±5 ms | no_clear 中仍给候选 | 全30候选精度代理 |", "|---|---:|---:|---:|---:|",
]
for kind, label in [("current", "20 ms 当前"), ("sup5", "5 ms 降低抑制")]:
    summary = summaries[kind]
    lines.append(f"| {label} | {summary['clearOnly']['within5']}/{clear} | {summary['clearAndApproximate']['within5']}/{clear + approx} | {summary['noClearOnset']['candidatePresent']}/{no_clear} | {summary['all30CandidatePrecisionProxy']['within5']}/30 |")
lines += ["", "## 三首曲分别的加权结果", "", "| 采样 | 候选 | precision | clear recall | clear+approx recall | 全物件正确率 |", "|---|---|---:|---:|---:|---:|"]
for sample_id in ["sample-003", "sample-042", "sample-095"]:
    for kind, label in [("current", "20 ms"), ("sup5", "5 ms")]:
        item = weighted["perSample"][sample_id][kind]
        lines.append(f"| {sample_id} | {label} | {pct(item['candidatePrecision'])} | {pct(item['clearOnsetRecall'])} | {pct(item['clearAndApproximateOnsetRecall'])} | {pct(item['allObjectCorrectRate'])} |")
lines += [
    "", "## 口径", "",
    "- 候选误差 = `候选相对谱面残差 − 盲看 actualRelativeMs`，绝对值 ≤5 ms 才计正确。",
    "- candidate precision 的分母仅为实际输出候选的物件，因此同时报告输出覆盖率，避免靠大量拒答刷高 precision。",
    "- recall 分别以 clear、clear+approx 为真实音头分母；全物件正确率以全部 4103 物件为分母。no_clear_onset 不等于绝对静音，但不能把其候选算作已验证正确音头。",
    "- 每个物件权重为所属采样/分层人口除以 10；三首各 30 个、三层各 10 个，合计 90 个盲标。",
    "", "## neither 逐物件结果", "",
    "原音频路径和完整分秒区间见 `annotated-comparison.csv` 与 v550 `REVIEW.md`。",
    "", "| 物件 | 标签 | 实际相对 ms | 当前残差 | 当前误差 | 5 ms 残差 | 5 ms 误差 |", "|---|---|---:|---:|---:|---:|---:|",
]
for row in rows:
    lines.append(f"| {row['segmentId']} | {row['confidence']} | {fmt(row['actualRelativeMs'])} | {fmt(row['currentResidualMs'])} | {fmt(row['currentErrorMs'])} | {fmt(row['sup5ResidualMs'])} | {fmt(row['sup5ErrorMs'])} |")
lines += ["", "## 下一步", "", "优先分析 neither 层中真实攻击相对谱面约 +4 至 +8 ms 的系统性偏差，以及 no_clear_onset 上的误输出；后续修改必须在独立盲标上复验，不能再用弱标签一致率代替真实精度。", ""]
(ROOT / "RESEARCH.md").write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({"confidenceCounts": confidence_counts, "neither": summaries, "weighted": weighted["overall"]}, ensure_ascii=False))
print("V553_BLIND_LABEL_AND_WEIGHTED_ANALYSIS_WRITTEN")
