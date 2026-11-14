# v551: 标签锁定后再揭示候选残差，评估30个仅5ms命中的分歧物件。
from __future__ import annotations

import csv
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V550 = ROOT.parent / "v550"
selection = json.loads((V550 / "selection.json").read_text(encoding="utf-8"))
by_id = {segment["segmentId"]: segment for segment in selection["segments"]}
with (ROOT / "annotations-only-sup5.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    annotations = list(csv.DictReader(handle))
assert len(annotations) == 30
assert len({row["segmentId"] for row in annotations}) == 30

rows: list[dict] = []
for annotation in annotations:
    segment = by_id[annotation["segmentId"]]
    assert segment["stratum"] == "only-sup5-within5"
    confidence = annotation["confidence"]
    assert confidence in {"clear", "approximate", "no_clear_onset"}
    relative = None if not annotation["actualRelativeMs"] else int(annotation["actualRelativeMs"])
    actual = None if not annotation["actualOnsetMs"] else int(annotation["actualOnsetMs"])
    if confidence == "no_clear_onset":
        assert relative is None and actual is None and not annotation["actualOnsetClock"]
    else:
        assert relative is not None and actual == segment["referenceMs"] + relative
    row = {
        "segmentId": segment["segmentId"],
        "sampleId": segment["sampleId"],
        "referenceMs": segment["referenceMs"],
        "referenceClock": segment["referenceClock"],
        "originalAudioPath": segment["originalAudioPath"],
        "clipStartClock": segment["clipStartClock"],
        "clipEndClock": segment["clipEndClock"],
        "confidence": confidence,
        "actualOnsetMs": actual,
        "actualRelativeMs": relative,
        "comment": annotation["comment"],
        "currentResidualMs": segment["currentResidualMs"],
        "sup5ResidualMs": segment["sup5ResidualMs"],
    }
    for kind in ["current", "sup5"]:
        residual = row[f"{kind}ResidualMs"]
        error = None if residual is None or relative is None else residual - relative
        row[f"{kind}ErrorMs"] = error
        row[f"{kind}Within5"] = None if error is None else abs(error) <= 5
    rows.append(row)

rows.sort(key=lambda row: (row["sampleId"], row["confidence"], row["segmentId"]))


def summarize(kind: str, confidence_set: set[str]) -> dict:
    selected = [row for row in rows if row["confidence"] in confidence_set]
    errors = [row[f"{kind}ErrorMs"] for row in selected if row[f"{kind}ErrorMs"] is not None]
    within = [row for row in selected if row[f"{kind}Within5"] is True]
    return {
        "labelCount": len(selected),
        "candidatePresent": sum(row[f"{kind}ResidualMs"] is not None for row in selected),
        "within5": len(within),
        "within5RateAmongLabels": len(within) / len(selected) if selected else None,
        "medianAbsErrorMs": statistics.median(abs(error) for error in errors) if errors else None,
    }


summaries = {}
for kind in ["current", "sup5"]:
    summaries[kind] = {
        "clearOnly": summarize(kind, {"clear"}),
        "clearAndApproximate": summarize(kind, {"clear", "approximate"}),
        "noClearOnset": {
            "labelCount": sum(row["confidence"] == "no_clear_onset" for row in rows),
            "candidatePresent": sum(row["confidence"] == "no_clear_onset" and row[f"{kind}ResidualMs"] is not None for row in rows),
        },
        "all30CandidatePrecisionProxy": {
            "within5": sum(row[f"{kind}Within5"] is True for row in rows),
            "denominator": 30,
            "definition": "clear/approximate labels with candidate error <=5 ms; all no_clear_onset candidates count as incorrect object-onset proposals",
        },
    }

confidence_counts = {confidence: sum(row["confidence"] == confidence for row in rows) for confidence in ["clear", "approximate", "no_clear_onset"]}
output = {
    "version": "v551-only-sup5-blind-visual-labels-v1",
    "status": "provisional_blind_visual_labels_not_owner_confirmed_and_not_full_80_percent_acceptance",
    "labelingOrder": "annotations-only-sup5.csv was written from candidate-hidden plots before residual analysis",
    "labelCount": 30,
    "confidenceCounts": confidence_counts,
    "summaries": summaries,
    "limitations": [
        "visual waveform/spectral-flux review only; no independent listening confirmation",
        "no_clear_onset means no clearly separable onset near the object, not proof of silence",
        "only the only-sup5-within5 stratum is labeled; cannot estimate all-note accuracy without the other strata",
    ],
    "rows": rows,
}
(ROOT / "analysis-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

with (ROOT / "annotated-comparison.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    fields = ["segmentId", "sampleId", "originalAudioPath", "clipStartClock", "clipEndClock", "referenceClock", "confidence", "actualRelativeMs", "currentResidualMs", "currentErrorMs", "currentWithin5",
              "sup5ResidualMs", "sup5ErrorMs", "sup5Within5", "comment"]
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key, "") for key in fields})

clear = confidence_counts["clear"]
approx = confidence_counts["approximate"]
no_clear = confidence_counts["no_clear_onset"]
sup_clear = summaries["sup5"]["clearOnly"]
sup_both = summaries["sup5"]["clearAndApproximate"]
sup_proxy = summaries["sup5"]["all30CandidatePrecisionProxy"]
current_proxy = summaries["current"]["all30CandidatePrecisionProxy"]
lines = [
    "# v551：仅 5 ms 抑制命中层的盲看精标结果",
    "",
    "## 结论先行",
    "",
    f"30 个分歧物件已先按隐藏候选的波形/谱通量图标注，再揭示候选残差。结果为 **clear {clear}、approximate {approx}、no_clear_onset {no_clear}**。",
    "",
    f"- 5 ms 候选对 clear 音头达到 ±5 ms：**{sup_clear['within5']}/{clear}**。",
    f"- 把 approximate 也纳入：候选达到 ±5 ms：**{sup_both['within5']}/{clear + approx}**。",
    f"- 若算法对每个候选都输出物件音头，并将 no_clear_onset 的候选计为错误，则该层候选精度代理为 **{sup_proxy['within5']}/30**；当前 20 ms 设置为 {current_proxy['within5']}/30。",
    "- 该层不能支持‘降低峰抑制即可达到真实 80%’。多数新增候选附近没有可独立确认的物件音头。",
    "- 这些是 provisional 视觉精标，不是所有者听辨确认；且只覆盖一个分层，不能推算全曲 80% 是否完成。",
    "",
    "## 分层汇总",
    "",
    "| 候选 | clear ±5 ms | clear+approx ±5 ms | no_clear 中仍给候选 | 全30候选精度代理 |",
    "|---|---:|---:|---:|---:|",
]
for kind, label in [("current", "20 ms 当前"), ("sup5", "5 ms 降低抑制")]:
    summary = summaries[kind]
    lines.append(f"| {label} | {summary['clearOnly']['within5']}/{clear} | {summary['clearAndApproximate']['within5']}/{clear + approx} | {summary['noClearOnset']['candidatePresent']}/{no_clear} | {summary['all30CandidatePrecisionProxy']['within5']}/30 |")
lines += [
    "",
    "候选误差定义为 `候选相对谱面残差 − 盲看 actualRelativeMs`。no_clear_onset 表示参考物件附近没有清晰可分离音头，不等同于绝对静音。",
    "",
    "## 逐物件结果",
    "",
    "原音频路径和完整分秒区间见 `annotated-comparison.csv` 与 v550 `REVIEW.md`。",
    "",
    "| 物件 | 标签 | 实际相对 ms | 当前残差 | 当前误差 | 5 ms 残差 | 5 ms 误差 |",
    "|---|---|---:|---:|---:|---:|---:|",
]
for row in rows:
    def fmt(value) -> str:
        return "" if value is None else f"{value:.3f}" if isinstance(value, float) else str(value)
    lines.append(f"| {row['segmentId']} | {row['confidence']} | {fmt(row['actualRelativeMs'])} | {fmt(row['currentResidualMs'])} | {fmt(row['currentErrorMs'])} | {fmt(row['sup5ResidualMs'])} | {fmt(row['sup5ErrorMs'])} |")
lines += [
    "",
    "## 对 80% 目标的影响",
    "",
    "本轮证据否定的是‘把 5 ms 抑制下的弱标签 86.55% 直接当真实精度’，不是否定所有 5 ms 候选。清晰正例保留，后续应学习/规则化其波形攻击特征，并对持续音与噪声纹理显式 abstain。",
    "在计算总体精度前，还需标注 both 与 neither 两层，并按 v550 的人口权重还原；目标状态保持未完成。",
    "",
]
(ROOT / "RESEARCH.md").write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({"confidenceCounts": confidence_counts, "sup5": summaries["sup5"], "currentProxy": current_proxy}, ensure_ascii=False))
print("V551_BLIND_LABEL_ANALYSIS_WRITTEN")
