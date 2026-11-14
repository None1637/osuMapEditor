# v554: 检验固定候选时钟校正；留一曲选参、另一曲只作held-out验证。
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERIFIER = ROOT.parent
selection = json.loads((VERIFIER / "v550" / "selection.json").read_text(encoding="utf-8"))
by_id = {segment["segmentId"]: segment for segment in selection["segments"]}
rows: list[dict] = []
for version in ["v551", "v552", "v553"]:
    result = json.loads((VERIFIER / version / "analysis-results.json").read_text(encoding="utf-8"))
    for source in result["rows"]:
        row = dict(source)
        segment = by_id[row["segmentId"]]
        row["weight"] = segment["stratumWeight"]
        rows.append(row)
assert len(rows) == 90 and len({row["segmentId"] for row in rows}) == 90
SAMPLES = ["sample-003", "sample-042", "sample-095"]
SHIFTS = [index / 4 for index in range(-40, 41)]


def metrics(source_rows: list[dict], kind: str, shift: float) -> dict:
    population = sum(row["weight"] for row in source_rows)
    outputs = sum(row["weight"] for row in source_rows if row[f"{kind}ResidualMs"] is not None)
    clear = sum(row["weight"] for row in source_rows if row["confidence"] == "clear")
    broad = sum(row["weight"] for row in source_rows if row["confidence"] in {"clear", "approximate"})
    correct_clear = 0.0
    correct_broad = 0.0
    for row in source_rows:
        residual = row[f"{kind}ResidualMs"]
        actual = row["actualRelativeMs"]
        if residual is None or actual is None or row["confidence"] not in {"clear", "approximate"}:
            continue
        error = residual + shift - actual
        if abs(error) <= 5:
            if row["confidence"] == "clear":
                correct_clear += row["weight"]
            correct_broad += row["weight"]
    return {
        "shiftMs": shift, "populationWeight": population, "candidateOutputWeight": outputs,
        "correctClearWeight": correct_clear, "correctBroadWeight": correct_broad,
        "candidatePrecision": correct_broad / outputs if outputs else None,
        "candidateCoverage": outputs / population,
        "clearOnsetRecall": correct_clear / clear if clear else None,
        "clearAndApproximateOnsetRecall": correct_broad / broad if broad else None,
        "allObjectCorrectRate": correct_broad / population,
    }


def objective(item: dict) -> tuple:
    # 先优化广泛音头recall，再优化清晰音头recall；同分取绝对校正量更小者。
    return (item["clearAndApproximateOnsetRecall"], item["clearOnsetRecall"], item["candidatePrecision"], -abs(item["shiftMs"]))


def best_shift(source_rows: list[dict], kind: str) -> dict:
    return max((metrics(source_rows, kind, shift) for shift in SHIFTS), key=objective)


folds = []
crossfit_rows = []
for kind in ["current", "sup5"]:
    for held_out in SAMPLES:
        training = [row for row in rows if row["sampleId"] != held_out]
        testing = [row for row in rows if row["sampleId"] == held_out]
        chosen = best_shift(training, kind)
        test = metrics(testing, kind, chosen["shiftMs"])
        folds.append({"kind": kind, "heldOut": held_out, "trainingSampleIds": [item for item in SAMPLES if item != held_out], "chosenShiftMs": chosen["shiftMs"], "training": chosen, "heldOutMetrics": test})
        for row in testing:
            corrected = dict(row)
            corrected["fitKind"] = kind
            corrected["appliedShiftMs"] = chosen["shiftMs"]
            corrected["heldOut"] = held_out
            residual = row[f"{kind}ResidualMs"]
            actual = row["actualRelativeMs"]
            corrected["correctedErrorMs"] = None if residual is None or actual is None else residual + chosen["shiftMs"] - actual
            corrected["correctedWithin5"] = None if corrected["correctedErrorMs"] is None or row["confidence"] == "no_clear_onset" else abs(corrected["correctedErrorMs"]) <= 5
            crossfit_rows.append(corrected)

crossfit = {}
for kind in ["current", "sup5"]:
    # metrics只读取残差和shift；逐held-out校正需逐行计算，不能拿单一shift代替。
    fold_rows = [row for row in crossfit_rows if row["fitKind"] == kind]
    population = sum(row["weight"] for row in fold_rows)
    outputs = sum(row["weight"] for row in fold_rows if row[f"{kind}ResidualMs"] is not None)
    clear = sum(row["weight"] for row in fold_rows if row["confidence"] == "clear")
    broad = sum(row["weight"] for row in fold_rows if row["confidence"] in {"clear", "approximate"})
    correct_clear = sum(row["weight"] for row in fold_rows if row["confidence"] == "clear" and row["correctedWithin5"] is True)
    correct_broad = sum(row["weight"] for row in fold_rows if row["correctedWithin5"] is True)
    crossfit[kind] = {
        "populationWeight": population, "candidateOutputWeight": outputs,
        "correctClearWeight": correct_clear, "correctBroadWeight": correct_broad,
        "candidatePrecision": correct_broad / outputs, "candidateCoverage": outputs / population,
        "clearOnsetRecall": correct_clear / clear, "clearAndApproximateOnsetRecall": correct_broad / broad,
        "allObjectCorrectRate": correct_broad / population,
    }

baseline = {kind: metrics(rows, kind, 0) for kind in ["current", "sup5"]}
all_data_best = {kind: best_shift(rows, kind) for kind in ["current", "sup5"]}
output = {
    "version": "v554-fixed-clock-correction-loso-v1",
    "status": "exploratory_crossfit_not_production_and_not_final_independent_acceptance",
    "hypothesis": "a small fixed spectral-peak clock correction can reduce onset timing error without adding candidates",
    "validation": "for each held-out song, choose one shift on the other two songs only; apply unchanged to the held-out song",
    "shiftSearchMs": {"min": -10, "max": 10, "step": 0.25},
    "objective": "maximize clear+approx recall, then clear recall, then candidate precision, then smallest absolute shift",
    "baseline": baseline, "folds": folds, "leaveOneSongOutCrossfit": crossfit,
    "allDataBestPostHocDiagnostic": all_data_best,
    "limitations": [
        "only three songs; leave-one-song-out is internal cross-validation, not a new independent test set",
        "visual provisional labels; no owner listening confirmation",
        "clock correction cannot recover missing candidates or make no_clear_onset proposals valid",
        "allDataBestPostHocDiagnostic is tuned and scored on the same labels and must not be reported as validated accuracy",
    ],
    "crossfitRows": crossfit_rows,
}
(ROOT / "clock-correction-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")


def pct(value: float | None) -> str:
    return "—" if value is None else f"{100 * value:.2f}%"


lines = [
    "# v554：固定候选时钟校正的留一曲验证", "", "## 结论先行", "",
    "只调整已有候选的时间，不增加候选。每个折子的校正量只由另外两首确定，再应用于未参与选参的一首。", "",
    "| 候选 | 基线 clear recall | 交叉验证 clear recall | 基线 clear+approx recall | 交叉验证 clear+approx recall | 交叉验证 precision | 交叉验证全物件正确率 |",
    "|---|---:|---:|---:|---:|---:|---:|",
]
for kind, label in [("current", "20 ms 当前"), ("sup5", "5 ms 降低抑制")]:
    base = baseline[kind]
    fit = crossfit[kind]
    lines.append(f"| {label} | {pct(base['clearOnsetRecall'])} | {pct(fit['clearOnsetRecall'])} | {pct(base['clearAndApproximateOnsetRecall'])} | {pct(fit['clearAndApproximateOnsetRecall'])} | {pct(fit['candidatePrecision'])} | {pct(fit['allObjectCorrectRate'])} |")
lines += ["", "## 留一曲选参与held-out结果", "", "| 候选 | held-out | 训练选择校正 ms | held-out clear recall | held-out clear+approx recall | held-out precision |", "|---|---|---:|---:|---:|---:|"]
for fold in folds:
    test = fold["heldOutMetrics"]
    lines.append(f"| {fold['kind']} | {fold['heldOut']} | {fold['chosenShiftMs']:+.2f} | {pct(test['clearOnsetRecall'])} | {pct(test['clearAndApproximateOnsetRecall'])} | {pct(test['candidatePrecision'])} |")
lines += ["", "## 事后全标签最优（仅诊断，不是验证）", "", "| 候选 | 全标签最优校正 ms | clear recall | clear+approx recall |", "|---|---:|---:|---:|"]
for kind in ["current", "sup5"]:
    item = all_data_best[kind]
    lines.append(f"| {kind} | {item['shiftMs']:+.2f} | {pct(item['clearOnsetRecall'])} | {pct(item['clearAndApproximateOnsetRecall'])} |")
lines += [
    "", "## 限制与下一步", "",
    "留一曲只有三个折子，仍属于内部探索，不是新样本正式验收。固定校正不能恢复缺失候选，也不能把 no_clear_onset 的误输出变成正确。",
    "只有当交叉验证稳定改善且各折校正方向一致时，才值得进入新的盲标测试；全标签事后最优值不得作为精度结论。目标状态保持未完成。", "",
]
(ROOT / "RESEARCH.md").write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({"baseline": baseline, "crossfit": crossfit, "folds": [{"kind": fold["kind"], "heldOut": fold["heldOut"], "shift": fold["chosenShiftMs"], "broadRecall": fold["heldOutMetrics"]["clearAndApproximateOnsetRecall"]} for fold in folds], "allDataBest": all_data_best}, ensure_ascii=False))
print("V554_CLOCK_CORRECTION_ANALYSIS_WRITTEN")
