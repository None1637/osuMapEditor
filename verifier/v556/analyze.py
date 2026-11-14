# v556: high-peak单特征置信门控；训练recall>=80%约束下优化precision，留一曲验证。
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERIFIER = ROOT.parent
SAMPLES = ["sample-003", "sample-042", "sample-095"]
source = json.loads((VERIFIER / "v555" / "candidate-predictions.json").read_text(encoding="utf-8"))
assert source["featureVersion"] == "v556-high-peak-gate-features-v1"
selection = json.loads((VERIFIER / "v550" / "selection.json").read_text(encoding="utf-8"))
selection_by_id = {segment["segmentId"]: segment for segment in selection["segments"]}
prediction_by_id = {row["segmentId"]: row["residualMs"] for row in source["predictions"]["high-peak"]}
feature_by_id = {row["segmentId"]: row for row in source["features"]}
rows: list[dict] = []
for version in ["v551", "v552", "v553"]:
    result = json.loads((VERIFIER / version / "analysis-results.json").read_text(encoding="utf-8"))
    for item in result["rows"]:
        row = dict(item)
        row["weight"] = selection_by_id[row["segmentId"]]["stratumWeight"]
        row["residualMs"] = prediction_by_id[row["segmentId"]]
        row["features"] = feature_by_id[row["segmentId"]]
        rows.append(row)
assert len(rows) == 90 and len({row["segmentId"] for row in rows}) == 90
FEATURES = [key for key, value in source["features"][0].items() if key not in {"segmentId", "sampleId", "candidatePresent"} and isinstance(value, (int, float))]
assert len(FEATURES) >= 10


def keep(row: dict, gate: dict | None) -> bool:
    if row["residualMs"] is None:
        return False
    if gate is None:
        return True
    value = row["features"].get(gate["feature"])
    if value is None:
        return False
    return value >= gate["threshold"] if gate["direction"] == ">=" else value <= gate["threshold"]


def metrics(source_rows: list[dict], gate: dict | None) -> dict:
    population = sum(row["weight"] for row in source_rows)
    original_outputs = sum(row["weight"] for row in source_rows if row["residualMs"] is not None)
    outputs = sum(row["weight"] for row in source_rows if keep(row, gate))
    clear = sum(row["weight"] for row in source_rows if row["confidence"] == "clear")
    broad = sum(row["weight"] for row in source_rows if row["confidence"] in {"clear", "approximate"})
    no_clear = sum(row["weight"] for row in source_rows if row["confidence"] == "no_clear_onset")
    no_clear_original_outputs = sum(row["weight"] for row in source_rows if row["confidence"] == "no_clear_onset" and row["residualMs"] is not None)
    no_clear_rejected = sum(row["weight"] for row in source_rows if row["confidence"] == "no_clear_onset" and row["residualMs"] is not None and not keep(row, gate))
    correct_clear = 0.0
    correct_broad = 0.0
    for row in source_rows:
        if not keep(row, gate) or row["actualRelativeMs"] is None or row["confidence"] not in {"clear", "approximate"}:
            continue
        if abs(row["residualMs"] - row["actualRelativeMs"]) <= 5:
            correct_broad += row["weight"]
            if row["confidence"] == "clear":
                correct_clear += row["weight"]
    return {
        "gate": gate, "populationWeight": population, "originalCandidateOutputWeight": original_outputs,
        "candidateOutputWeight": outputs, "correctClearWeight": correct_clear, "correctBroadWeight": correct_broad,
        "candidatePrecision": correct_broad / outputs if outputs else None, "candidateCoverage": outputs / population,
        "clearOnsetRecall": correct_clear / clear if clear else None,
        "clearAndApproximateOnsetRecall": correct_broad / broad if broad else None,
        "allObjectCorrectRate": correct_broad / population,
        "noClearOnsetWeight": no_clear, "noClearOriginalCandidateWeight": no_clear_original_outputs,
        "noClearRejectedWeight": no_clear_rejected,
        "noClearCandidateRejectionRate": no_clear_rejected / no_clear_original_outputs if no_clear_original_outputs else None,
    }


def training_objective(item: dict) -> tuple:
    precision = -1 if item["candidatePrecision"] is None else item["candidatePrecision"]
    gate = item["gate"]
    return (precision, item["clearAndApproximateOnsetRecall"], item["clearOnsetRecall"], -FEATURES.index(gate["feature"]), gate["direction"] == ">=", -gate["threshold"])


def select_gate(training_rows: list[dict]) -> dict:
    candidates = []
    for feature in FEATURES:
        values = sorted({row["features"][feature] for row in training_rows if row["features"].get(feature) is not None})
        if not values:
            continue
        thresholds = [values[0] - 1e-9] + [(left + right) / 2 for left, right in zip(values, values[1:])] + [values[-1] + 1e-9]
        for direction in [">=", "<="]:
            for threshold in thresholds:
                gate = {"feature": feature, "direction": direction, "threshold": threshold}
                candidates.append(metrics(training_rows, gate))
    feasible = [item for item in candidates if item["clearAndApproximateOnsetRecall"] >= 0.8]
    if feasible:
        chosen = max(feasible, key=training_objective)
        chosen["trainingRecallConstraintMet"] = True
        return chosen
    # 无可行门控时明确记录，不假装满足约束。
    chosen = max(candidates, key=lambda item: (item["clearAndApproximateOnsetRecall"], -1 if item["candidatePrecision"] is None else item["candidatePrecision"]))
    chosen["trainingRecallConstraintMet"] = False
    return chosen


folds = []
for held_out in SAMPLES:
    training_rows = [row for row in rows if row["sampleId"] != held_out]
    testing_rows = [row for row in rows if row["sampleId"] == held_out]
    chosen = select_gate(training_rows)
    folds.append({
        "heldOut": held_out, "trainingSampleIds": [sample for sample in SAMPLES if sample != held_out],
        "training": chosen, "heldOutMetrics": metrics(testing_rows, chosen["gate"]),
    })
crossfit_rows = []
for fold in folds:
    gate = fold["training"]["gate"]
    for row in rows:
        if row["sampleId"] != fold["heldOut"]:
            continue
        output = keep(row, gate)
        error = None if not output or row["actualRelativeMs"] is None else row["residualMs"] - row["actualRelativeMs"]
        crossfit_rows.append({
            "segmentId": row["segmentId"], "sampleId": row["sampleId"], "weight": row["weight"], "confidence": row["confidence"],
            "gate": gate, "originalCandidatePresent": row["residualMs"] is not None, "output": output,
            "residualMs": row["residualMs"] if output else None, "actualRelativeMs": row["actualRelativeMs"],
            "errorMs": error, "within5": None if error is None or row["confidence"] == "no_clear_onset" else abs(error) <= 5,
        })
crossfit = metrics(rows, None)
# 逐折门控不能用一个全局gate复算，显式汇总held-out行。
population = sum(row["weight"] for row in crossfit_rows)
original_outputs = sum(row["weight"] for row in crossfit_rows if row["originalCandidatePresent"])
outputs = sum(row["weight"] for row in crossfit_rows if row["output"])
clear = sum(row["weight"] for row in crossfit_rows if row["confidence"] == "clear")
broad = sum(row["weight"] for row in crossfit_rows if row["confidence"] in {"clear", "approximate"})
no_clear = sum(row["weight"] for row in crossfit_rows if row["confidence"] == "no_clear_onset")
no_clear_original = sum(row["weight"] for row in crossfit_rows if row["confidence"] == "no_clear_onset" and row["originalCandidatePresent"])
no_clear_rejected = sum(row["weight"] for row in crossfit_rows if row["confidence"] == "no_clear_onset" and row["originalCandidatePresent"] and not row["output"])
correct_clear = sum(row["weight"] for row in crossfit_rows if row["confidence"] == "clear" and row["within5"] is True)
correct_broad = sum(row["weight"] for row in crossfit_rows if row["within5"] is True)
crossfit = {
    "populationWeight": population, "originalCandidateOutputWeight": original_outputs, "candidateOutputWeight": outputs,
    "correctClearWeight": correct_clear, "correctBroadWeight": correct_broad,
    "candidatePrecision": correct_broad / outputs if outputs else None, "candidateCoverage": outputs / population,
    "clearOnsetRecall": correct_clear / clear, "clearAndApproximateOnsetRecall": correct_broad / broad,
    "allObjectCorrectRate": correct_broad / population, "noClearOnsetWeight": no_clear,
    "noClearOriginalCandidateWeight": no_clear_original, "noClearRejectedWeight": no_clear_rejected,
    "noClearCandidateRejectionRate": no_clear_rejected / no_clear_original if no_clear_original else None,
}
baseline = metrics(rows, None)
all_data_best = select_gate(rows)
output = {
    "version": "v556-single-feature-gate-loso-v1",
    "status": "exploratory_crossfit_not_production_and_not_final_independent_acceptance",
    "validation": "select one feature/direction/threshold on two songs with training clear+approx recall >=80%; apply unchanged to held-out song",
    "features": FEATURES, "baselineHighPeak": baseline, "folds": folds, "leaveOneSongOutCrossfit": crossfit,
    "allDataBestPostHocDiagnostic": all_data_best,
    "limitations": [
        "only three songs and 90 provisional visual labels; thresholds remain exploratory",
        "single-feature gating can overfit; all-data best is tuned and scored on the same labels",
        "precision, recall, coverage and no-clear rejection must be reported together; no overall 80% claim unless the chosen denominator is explicit",
    ],
    "crossfitRows": crossfit_rows,
}
(ROOT / "gate-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")


def pct(value: float | None) -> str:
    return "—" if value is None else f"{100 * value:.2f}%"


def gate_text(gate: dict) -> str:
    return f"{gate['feature']} {gate['direction']} {gate['threshold']:.6g}"


lines = [
    "# v556：high-peak 单特征置信门控", "", "## 结论先行", "",
    f"无门控基线：precision **{pct(baseline['candidatePrecision'])}**，clear+approx recall **{pct(baseline['clearAndApproximateOnsetRecall'])}**。",
    f"留一曲门控：precision **{pct(crossfit['candidatePrecision'])}**，clear+approx recall **{pct(crossfit['clearAndApproximateOnsetRecall'])}**，clear recall **{pct(crossfit['clearOnsetRecall'])}**，输出覆盖率 **{pct(crossfit['candidateCoverage'])}**。",
    f"no_clear 原候选拒绝率 **{pct(crossfit['noClearCandidateRejectionRate'])}**。门控同时报告 precision、recall 和覆盖率，不靠拒答隐藏损失。", "",
    "| held-out | 训练门控 | 训练recall约束 | held-out precision | held-out clear+approx recall | no_clear拒绝率 |",
    "|---|---|---|---:|---:|---:|",
]
for fold in folds:
    item = fold["heldOutMetrics"]
    lines.append(f"| {fold['heldOut']} | `{gate_text(fold['training']['gate'])}` | {fold['training']['trainingRecallConstraintMet']} | {pct(item['candidatePrecision'])} | {pct(item['clearAndApproximateOnsetRecall'])} | {pct(item['noClearCandidateRejectionRate'])} |")
post = all_data_best
lines += ["", "## 全标签事后最优（仅诊断）", "", f"`{gate_text(post['gate'])}`：precision **{pct(post['candidatePrecision'])}**，clear+approx recall **{pct(post['clearAndApproximateOnsetRecall'])}**，no_clear拒绝率 **{pct(post['noClearCandidateRejectionRate'])}**。", "", "## 限制", "", "仅三首、90 个 provisional 视觉标签；单特征阈值也可能过拟合。全标签结果不是验证精度，目标状态保持未完成。", ""]
(ROOT / "RESEARCH.md").write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({"baseline": baseline, "crossfit": crossfit, "folds": [{"heldOut": fold["heldOut"], "gate": fold["training"]["gate"], "constraint": fold["training"]["trainingRecallConstraintMet"], "precision": fold["heldOutMetrics"]["candidatePrecision"], "broadRecall": fold["heldOutMetrics"]["clearAndApproximateOnsetRecall"]} for fold in folds], "allDataBest": all_data_best}, ensure_ascii=False))
print("V556_GATE_ANALYSIS_WRITTEN")
