# v555: 读取项目TypeScript DSP候选；留一曲选配置，另一首仅作held-out验证。
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERIFIER = ROOT.parent
SAMPLES = ["sample-003", "sample-042", "sample-095"]
selection = json.loads((VERIFIER / "v550" / "selection.json").read_text(encoding="utf-8"))
selection_by_id = {segment["segmentId"]: segment for segment in selection["segments"]}
candidates = json.loads((ROOT / "candidate-predictions.json").read_text(encoding="utf-8"))
assert candidates["version"] == "v555-typescript-dsp-candidates-v1"
assert candidates["baselineReproduction"]["count"] == 90
assert candidates["baselineReproduction"]["allPresenceMatches"] is True
assert candidates["baselineReproduction"]["maxAbsDifferenceMs"] == 0
CONFIGS = candidates["configurations"]
predictions = candidates["predictions"]
rows: list[dict] = []
for version in ["v551", "v552", "v553"]:
    result = json.loads((VERIFIER / version / "analysis-results.json").read_text(encoding="utf-8"))
    for source in result["rows"]:
        row = dict(source)
        row["weight"] = selection_by_id[row["segmentId"]]["stratumWeight"]
        rows.append(row)
assert len(rows) == 90 and len({row["segmentId"] for row in rows}) == 90
row_by_id = {row["segmentId"]: row for row in rows}


def attach_metrics(config_name: str, source_ids: list[str]) -> dict:
    source_rows = [row_by_id[segment_id] for segment_id in source_ids]
    prediction_by_id = {item["segmentId"]: item["residualMs"] for item in predictions[config_name]}
    population = sum(row["weight"] for row in source_rows)
    outputs = sum(row["weight"] for row in source_rows if prediction_by_id[row["segmentId"]] is not None)
    clear = sum(row["weight"] for row in source_rows if row["confidence"] == "clear")
    broad = sum(row["weight"] for row in source_rows if row["confidence"] in {"clear", "approximate"})
    correct_clear = 0.0
    correct_broad = 0.0
    for row in source_rows:
        residual = prediction_by_id[row["segmentId"]]
        actual = row["actualRelativeMs"]
        if residual is None or actual is None or row["confidence"] not in {"clear", "approximate"}:
            continue
        if abs(residual - actual) <= 5:
            correct_broad += row["weight"]
            if row["confidence"] == "clear":
                correct_clear += row["weight"]
    return {
        "config": config_name, "populationWeight": population, "candidateOutputWeight": outputs,
        "correctClearWeight": correct_clear, "correctBroadWeight": correct_broad,
        "candidatePrecision": correct_broad / outputs if outputs else None, "candidateCoverage": outputs / population,
        "clearOnsetRecall": correct_clear / clear if clear else None,
        "clearAndApproximateOnsetRecall": correct_broad / broad if broad else None,
        "allObjectCorrectRate": correct_broad / population,
    }


def objective(item: dict) -> tuple:
    return (item["clearAndApproximateOnsetRecall"], item["clearOnsetRecall"], item["candidatePrecision"], -next(index for index, config in enumerate(CONFIGS) if config["name"] == item["config"]))


folds = []
for held_out in SAMPLES:
    training_ids = [row["segmentId"] for row in rows if row["sampleId"] != held_out]
    testing_ids = [row["segmentId"] for row in rows if row["sampleId"] == held_out]
    training_metrics = [attach_metrics(config["name"], training_ids) for config in CONFIGS]
    chosen = max(training_metrics, key=objective)
    folds.append({
        "heldOut": held_out, "trainingSampleIds": [item for item in SAMPLES if item != held_out],
        "chosenConfig": chosen["config"], "training": chosen, "heldOutMetrics": attach_metrics(chosen["config"], testing_ids),
    })

crossfit_rows = []
for fold in folds:
    config_name = fold["chosenConfig"]
    prediction_by_id = {item["segmentId"]: item["residualMs"] for item in predictions[config_name]}
    for row in rows:
        if row["sampleId"] != fold["heldOut"]:
            continue
        residual = prediction_by_id[row["segmentId"]]
        actual = row["actualRelativeMs"]
        error = None if residual is None or actual is None else residual - actual
        crossfit_rows.append({
            "segmentId": row["segmentId"], "sampleId": row["sampleId"], "weight": row["weight"], "confidence": row["confidence"],
            "chosenConfig": config_name, "residualMs": residual, "actualRelativeMs": actual,
            "errorMs": error, "within5": None if error is None or row["confidence"] == "no_clear_onset" else abs(error) <= 5,
        })
population = sum(row["weight"] for row in crossfit_rows)
outputs = sum(row["weight"] for row in crossfit_rows if row["residualMs"] is not None)
clear = sum(row["weight"] for row in crossfit_rows if row["confidence"] == "clear")
broad = sum(row["weight"] for row in crossfit_rows if row["confidence"] in {"clear", "approximate"})
correct_clear = sum(row["weight"] for row in crossfit_rows if row["confidence"] == "clear" and row["within5"] is True)
correct_broad = sum(row["weight"] for row in crossfit_rows if row["within5"] is True)
crossfit = {
    "populationWeight": population, "candidateOutputWeight": outputs,
    "correctClearWeight": correct_clear, "correctBroadWeight": correct_broad,
    "candidatePrecision": correct_broad / outputs, "candidateCoverage": outputs / population,
    "clearOnsetRecall": correct_clear / clear, "clearAndApproximateOnsetRecall": correct_broad / broad,
    "allObjectCorrectRate": correct_broad / population,
}
all_ids = [row["segmentId"] for row in rows]
all_data = [attach_metrics(config["name"], all_ids) for config in CONFIGS]
all_data_best = max(all_data, key=objective)
baseline = attach_metrics("full-peak", all_ids)
output = {
    "version": "v555-multiband-leading-edge-loso-v2-typescript-dsp",
    "status": "exploratory_crossfit_not_production_and_not_final_independent_acceptance",
    "validation": "choose one band/edge configuration on two songs only; apply unchanged to the held-out song",
    "validationCorrection": "initial NumPy reimplementation failed to reproduce 2/90 baseline objects and was discarded; final TypeScript DSP reproduces all 90 with max difference 0 ms",
    "configurations": CONFIGS, "baselineFullPeak": baseline,
    "baselineReproduction": candidates["baselineReproduction"],
    "folds": folds, "leaveOneSongOutCrossfit": crossfit,
    "allDataConfigurationsPostHoc": all_data, "allDataBestPostHocDiagnostic": all_data_best,
    "limitations": [
        "only three songs and 90 provisional visual labels; not a new independent acceptance set",
        "configuration search can overfit even with leave-one-song-out; all-data best is diagnostic only",
        "no_clear_onset candidates remain incorrect and missing candidates cannot count as correct",
    ],
    "predictions": predictions, "crossfitRows": crossfit_rows,
}
(ROOT / "leading-edge-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")


def pct(value: float | None) -> str:
    return "—" if value is None else f"{100 * value:.2f}%"


lines = [
    "# v555：多频带与上升沿候选的留一曲验证", "", "## 结论先行", "",
    f"固定全频带峰值基线：clear recall **{pct(baseline['clearOnsetRecall'])}**，clear+approx recall **{pct(baseline['clearAndApproximateOnsetRecall'])}**。",
    f"留一曲选配置后的交叉验证：clear recall **{pct(crossfit['clearOnsetRecall'])}**，clear+approx recall **{pct(crossfit['clearAndApproximateOnsetRecall'])}**，precision **{pct(crossfit['candidatePrecision'])}**。",
    "配置只在另外两首上选择；第三首不参与选参。全标签最优仅作诊断，不能作为验证精度。", "",
    f"虽然音头 recall 超过 80%，候选 precision 仍为 **{pct(crossfit['candidatePrecision'])}**，全物件正确率仅 **{pct(crossfit['allObjectCorrectRate'])}**；大量 no_clear_onset 误输出尚未解决，不能把本轮结果当作目标完成。", "",
    "## 验证方式纠错", "",
    "初轮 NumPy 重实现有 2/90 个物件未复现原候选，其中一个偏差约 8.27 ms，因此初轮数值全部作废。最终改用项目 TypeScript DSP 后，90/90 候选存在性一致，最大时间差为 0 ms，才重新计算下列结果。", "",
    "| held-out | 训练选择配置 | held-out clear recall | held-out clear+approx recall | held-out precision | 输出覆盖率 |",
    "|---|---|---:|---:|---:|---:|",
]
for fold in folds:
    item = fold["heldOutMetrics"]
    lines.append(f"| {fold['heldOut']} | {fold['chosenConfig']} | {pct(item['clearOnsetRecall'])} | {pct(item['clearAndApproximateOnsetRecall'])} | {pct(item['candidatePrecision'])} | {pct(item['candidateCoverage'])} |")
lines += ["", "## 全标签事后最优（仅诊断）", "", f"配置 `{all_data_best['config']}`：clear recall **{pct(all_data_best['clearOnsetRecall'])}**，clear+approx recall **{pct(all_data_best['clearAndApproximateOnsetRecall'])}**，precision **{pct(all_data_best['candidatePrecision'])}**。", "", "## 验证限制", "", "仅三首、90 个 provisional 视觉标签，留一曲仍是内部探索而非新样本验收。上升沿可能改善时间定位，也可能提前到前一纹理；必须看各折是否一致，不能只看全标签最优。目标状态保持未完成。", ""]
(ROOT / "RESEARCH.md").write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({"baseline": baseline, "crossfit": crossfit, "folds": [{"heldOut": fold["heldOut"], "config": fold["chosenConfig"], "broadRecall": fold["heldOutMetrics"]["clearAndApproximateOnsetRecall"]} for fold in folds], "allDataBest": all_data_best, "baselineReproduction": output["baselineReproduction"] | {"rows": None}}, ensure_ascii=False))
print("V555_LEADING_EDGE_ANALYSIS_WRITTEN")
