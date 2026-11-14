# v553: 复核90个盲标、时间关系、候选误差、人口权重与报告口径。
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V550 = ROOT.parent / "v550"
result = json.loads((ROOT / "analysis-results.json").read_text(encoding="utf-8"))
weighted = json.loads((ROOT / "weighted-results.json").read_text(encoding="utf-8"))
selection = json.loads((V550 / "selection.json").read_text(encoding="utf-8"))
by_id = {segment["segmentId"]: segment for segment in selection["segments"]}
with (ROOT / "annotations-neither.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    annotations = {row["segmentId"]: row for row in csv.DictReader(handle)}
with (ROOT / "annotated-comparison.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    comparison = {row["segmentId"]: row for row in csv.DictReader(handle)}
failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual: float, expected: float, message: str) -> None:
    check(abs(actual - expected) < 1e-9, f"{message}: {actual} != {expected}")


def clock_ms(value: str) -> int:
    minutes, seconds = value.split(":")
    return int(minutes) * 60000 + round(float(seconds) * 1000)


check(result["version"] == "v553-neither-within5-blind-visual-labels-v1", "结果版本错误")
check(result["status"] == "provisional_blind_visual_labels_not_owner_confirmed_and_not_full_80_percent_acceptance", "必须保持 provisional 且非80%验收")
check(result["labelCount"] == 30 and len(result["rows"]) == 30 and len(annotations) == 30 and len(comparison) == 30, "必须有30个盲标及30行对比")
check(result["confidenceCounts"] == {"clear": 14, "approximate": 6, "no_clear_onset": 10}, "标签数量必须为14/6/10")
check(set(annotations) == set(comparison) == {row["segmentId"] for row in result["rows"]}, "标注、对比和结果ID必须一致")
for row in result["rows"]:
    segment_id = row["segmentId"]
    segment = by_id[segment_id]
    annotation = annotations[segment_id]
    exported = comparison[segment_id]
    check(segment["stratum"] == "neither-within5", f"{segment_id} 分层错误")
    check(row["referenceMs"] == segment["referenceMs"], f"{segment_id} 参考时间错误")
    check(row["confidence"] == annotation["confidence"] and row["comment"] == annotation["comment"], f"{segment_id} 锁定标签被改动")
    check(row["currentResidualMs"] == segment["currentResidualMs"] and row["sup5ResidualMs"] == segment["sup5ResidualMs"], f"{segment_id} 候选残差被改动")
    check(row["originalAudioPath"] == segment["originalAudioPath"] == exported["originalAudioPath"], f"{segment_id} 原始路径错误")
    check(row["clipStartClock"] == segment["clipStartClock"] == exported["clipStartClock"], f"{segment_id} 开始时间错误")
    check(row["clipEndClock"] == segment["clipEndClock"] == exported["clipEndClock"], f"{segment_id} 结束时间错误")
    if row["confidence"] == "no_clear_onset":
        check(row["actualOnsetMs"] is None and row["actualRelativeMs"] is None, f"{segment_id} 无清晰音头不得强填时间")
    else:
        check(str(row["actualRelativeMs"]) == annotation["actualRelativeMs"], f"{segment_id} 相对标签被改动")
        check(row["actualOnsetMs"] == row["referenceMs"] + row["actualRelativeMs"], f"{segment_id} 绝对/相对时间不一致")
        check(clock_ms(annotation["actualOnsetClock"]) == row["actualOnsetMs"], f"{segment_id} 分秒/毫秒标签不一致")
        for kind in ["current", "sup5"]:
            residual = row[f"{kind}ResidualMs"]
            error = row[f"{kind}ErrorMs"]
            if residual is None:
                check(error is None and row[f"{kind}Within5"] is None, f"{segment_id}/{kind} 空候选处理错误")
            else:
                close(error, residual - row["actualRelativeMs"], f"{segment_id}/{kind} 误差")
                check(row[f"{kind}Within5"] == (abs(error) <= 5), f"{segment_id}/{kind} ±5ms判断错误")

check(result["summaries"]["current"]["clearOnly"]["within5"] == 0, "当前clear必须0/14")
check(result["summaries"]["current"]["clearAndApproximate"]["within5"] == 0, "当前clear+approx必须0/20")
check(result["summaries"]["sup5"]["clearOnly"]["within5"] == 2, "5ms clear必须2/14")
check(result["summaries"]["sup5"]["clearAndApproximate"]["within5"] == 2, "5ms clear+approx必须2/20")
check(result["summaries"]["current"]["all30CandidatePrecisionProxy"]["within5"] == 0, "当前全层代理必须0/30")
check(result["summaries"]["sup5"]["all30CandidatePrecisionProxy"]["within5"] == 2, "5ms全层代理必须2/30")

all_rows: list[dict] = []
for version in ["v551", "v552", "v553"]:
    prior = json.loads((ROOT.parent / version / "analysis-results.json").read_text(encoding="utf-8"))
    for source in prior["rows"]:
        row = dict(source)
        segment = by_id[row["segmentId"]]
        close(segment["stratumWeight"], segment["stratumPopulation"] / 10, f"{row['segmentId']} 权重")
        row["stratum"] = segment["stratum"]
        row["stratumWeight"] = segment["stratumWeight"]
        all_rows.append(row)
check(len(all_rows) == 90 and len({row["segmentId"] for row in all_rows}) == 90, "三层必须合计90个唯一物件")
close(sum(row["stratumWeight"] for row in all_rows), 4103, "总人口")


def verify_weighted(group_rows: list[dict], kind: str, actual: dict, label: str) -> None:
    population = sum(row["stratumWeight"] for row in group_rows)
    outputs = sum(row["stratumWeight"] for row in group_rows if row[f"{kind}ResidualMs"] is not None)
    correct = sum(row["stratumWeight"] for row in group_rows if row[f"{kind}Within5"] is True)
    clear = sum(row["stratumWeight"] for row in group_rows if row["confidence"] == "clear")
    broad = sum(row["stratumWeight"] for row in group_rows if row["confidence"] in {"clear", "approximate"})
    no_clear = sum(row["stratumWeight"] for row in group_rows if row["confidence"] == "no_clear_onset")
    correct_clear = sum(row["stratumWeight"] for row in group_rows if row["confidence"] == "clear" and row[f"{kind}Within5"] is True)
    correct_broad = sum(row["stratumWeight"] for row in group_rows if row["confidence"] in {"clear", "approximate"} and row[f"{kind}Within5"] is True)
    expected = {
        "populationWeight": population, "candidateOutputWeight": outputs, "correctWeight": correct,
        "clearOnsetWeight": clear, "clearAndApproximateOnsetWeight": broad, "noClearOnsetWeight": no_clear,
        "correctClearWeight": correct_clear, "correctBroadWeight": correct_broad,
        "candidatePrecision": correct / outputs if outputs else None, "candidateCoverage": outputs / population,
        "clearOnsetRecall": correct_clear / clear if clear else None,
        "clearAndApproximateOnsetRecall": correct_broad / broad if broad else None,
        "allObjectCorrectRate": correct / population,
    }
    for key, value in expected.items():
        if value is None:
            check(actual[key] is None, f"{label}/{kind}/{key} 应为空")
        else:
            close(actual[key], value, f"{label}/{kind}/{key}")


for kind in ["current", "sup5"]:
    verify_weighted(all_rows, kind, weighted["overall"][kind], "overall")
    for sample_id in ["sample-003", "sample-042", "sample-095"]:
        verify_weighted([row for row in all_rows if row["sampleId"] == sample_id], kind, weighted["perSample"][sample_id][kind], sample_id)
    for stratum in ["both-within5", "only-sup5-within5", "neither-within5"]:
        verify_weighted([row for row in all_rows if row["stratum"] == stratum], kind, weighted["perStratum"][stratum][kind], stratum)

expected_overall = {
    "current": {"candidateOutputWeight": 2756.0, "correctWeight": 1310.3, "candidatePrecision": 0.47543541364296077, "clearOnsetRecall": 0.4821533551692282, "clearAndApproximateOnsetRecall": 0.614817942942943, "allObjectCorrectRate": 0.319351693882525},
    "sup5": {"candidateOutputWeight": 3965.6, "correctWeight": 1581.4, "candidatePrecision": 0.3987795037320961, "clearOnsetRecall": 0.6853111615016376, "clearAndApproximateOnsetRecall": 0.7420232732732733, "allObjectCorrectRate": 0.3854252985620278},
}
for kind, values in expected_overall.items():
    for key, value in values.items():
        close(weighted["overall"][kind][key], value, f"锁定总体{kind}/{key}")
close(weighted["overall"]["sup5"]["candidateCoverage"], 0.9665123080672678, "5ms输出覆盖率")
check(weighted["status"] == "provisional_visual_estimate_not_80_percent_acceptance", "加权结果不得标为验收")
report = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
for text in ["clear 14、approximate 6、no_clear_onset 10", "47.54%", "39.88%", "68.53%", "74.20%", "38.54%", "目标状态保持未完成", "不能外推为 100 首", "输出覆盖率", "全部 4103 物件"]:
    check(text in report, f"报告缺关键内容：{text}")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    print(f"V553_VALIDATION_FAILED: {len(failures)}")
    raise SystemExit(1)
print("ok: 90个分层盲标完整，neither标签时间、路径、候选误差一致")
print("ok: 三层4103人口权重及overall/perSample/perStratum全部独立复算一致")
print("ok: 5ms候选precision 39.88%、clear recall 68.53%、clear+approx recall 74.20%，未宣称80%完成")
print("V553_VALIDATION_PASSED")
