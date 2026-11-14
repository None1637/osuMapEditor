# v550: 校验90个分层精标物件、逐采样WAV、图像、人口权重和空白真值栏。
from __future__ import annotations

import csv
import hashlib
import json
import wave
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
APP = ROOT.parent.parent
V541 = APP / "verifier" / "v541"
selection = json.loads((ROOT / "selection.json").read_text(encoding="utf-8"))
segments = selection["segments"]
failures: list[str] = []
SAMPLES = ["sample-003", "sample-042", "sample-095"]
STRATA = ["both-within5", "only-sup5-within5", "neither-within5"]
EXPECTED_POPULATIONS = {
    "sample-003": [683, 255, 230],
    "sample-042": [1039, 292, 110],
    "sample-095": [647, 560, 287],
}


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


check(selection["version"] == "v550-stratified-independent-onset-review-v1", "选样版本错误")
check(selection["groundTruthStatus"] == "pending_independent_review", "精标尚未填写时必须保持 pending")
check("80%" in selection["target"] and "5 ms" in selection["target"], "必须保存80%/5ms目标")
check(len(segments) == 90, "必须有90个物件")
check(len({segment["segmentId"] for segment in segments}) == 90, "物件ID必须唯一")
for sample_id in SAMPLES:
    rows = [segment for segment in segments if segment["sampleId"] == sample_id]
    check(len(rows) == 30, f"{sample_id} 必须30个")
    ordered = sorted(row["referenceMs"] for row in rows)
    check(all(b - a >= 200 for a, b in zip(ordered, ordered[1:])), f"{sample_id} 选点间距小于200ms")
    for index, stratum in enumerate(STRATA):
        stratum_rows = [row for row in rows if row["stratum"] == stratum]
        check(len(stratum_rows) == 10, f"{sample_id}/{stratum} 必须10个")
        expected = EXPECTED_POPULATIONS[sample_id][index]
        check(all(row["stratumPopulation"] == expected for row in stratum_rows), f"{sample_id}/{stratum} 人口必须为{expected}")
        check(all(abs(row["stratumWeight"] - expected / 10) < 1e-12 for row in stratum_rows), f"{sample_id}/{stratum} 权重错误")
check(sum(item["population"] for item in selection["population"] if item["sampleId"] == "sample-003") == 1168, "003分层人口必须覆盖全曲1168个物件")
check(sum(item["population"] for item in selection["population"] if item["sampleId"] == "sample-042") == 1441, "042分层人口必须覆盖全曲1441个物件")
check(sum(item["population"] for item in selection["population"] if item["sampleId"] == "sample-095") == 1494, "095分层人口必须覆盖全曲1494个物件")

with (ROOT / "review-template.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    template = list(csv.DictReader(handle))
check(len(template) == 90, "精标模板必须90行")
check(all(not row["actualOnsetClock"] and not row["actualOnsetMs"] and not row["confidence"] for row in template), "真实onset与置信度不得预填")
check({row["segmentId"] for row in template} == {segment["segmentId"] for segment in segments}, "模板与选件必须一致")

validated_files: list[dict] = []
for segment in segments:
    sample_id = segment["sampleId"]
    decoded = V541 / "decoded" / sample_id
    meta = json.loads((decoded / "meta.json").read_text(encoding="utf-8"))
    wav_path = ROOT / segment["audioClip"]
    plot_path = ROOT / segment["plot"]
    check(wav_path.exists(), f"缺少 {wav_path.name}")
    check(plot_path.exists(), f"缺少 {plot_path.name}")
    check(segment["clipEndMs"] - segment["clipStartMs"] == 1000, f"{segment['segmentId']} 区间不是1秒")
    check(segment["referenceMs"] - segment["clipStartMs"] == 500, f"{segment['segmentId']} 参考点不在中央")
    check(segment["originalAudioPath"].startswith("F:\\Backup\\D\\osu!\\Songs\\"), f"{segment['segmentId']} 缺原始完整路径")
    with wave.open(str(wav_path), "rb") as audio:
        check(audio.getnchannels() == meta["numberOfChannels"], f"{segment['segmentId']} 声道数错误")
        check(audio.getframerate() == meta["sampleRate"], f"{segment['segmentId']} 采样率错误")
        check(audio.getsampwidth() == 2, f"{segment['segmentId']} 不是16-bit")
        frames = audio.getnframes()
        check(abs(frames / meta["sampleRate"] - 1) <= 1 / meta["sampleRate"], f"{segment['segmentId']} WAV时长错误")
        pcm = np.frombuffer(audio.readframes(frames), dtype="<i2").reshape(-1, meta["numberOfChannels"])
    start = round(segment["clipStartMs"] / 1000 * meta["sampleRate"])
    end = round(segment["clipEndMs"] / 1000 * meta["sampleRate"])
    channels = [np.fromfile(decoded / f"ch{channel}.f32", dtype="<f4") for channel in range(meta["numberOfChannels"])]
    expected = (np.clip(np.stack([channel[start:end] for channel in channels], axis=1), -1, 1) * 32767).astype("<i2")
    check(np.array_equal(pcm, expected), f"{segment['segmentId']} WAV与PCM时间轴或采样值不一致")
    check(np.any(pcm != 0), f"{segment['segmentId']} WAV为静音")
    with Image.open(plot_path) as plot:
        check(plot.size == (2240, 1440), f"{segment['segmentId']} PNG尺寸错误")
        plot.verify()
    for artifact in [wav_path, plot_path]:
        validated_files.append({"path": str(artifact.relative_to(ROOT)), "bytes": artifact.stat().st_size,
                                "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest()})

check(len(selection.get("contactSheets", [])) == 9, "必须有9张分层总览")
for name in selection.get("contactSheets", []):
    contact = ROOT / name
    check(contact.exists(), f"缺少{name}")
    with Image.open(contact) as image:
        check(image.size == (1436, 2345), f"{name}总览尺寸错误")
        image.verify()
    validated_files.append({"path": name, "bytes": contact.stat().st_size, "sha256": hashlib.sha256(contact.read_bytes()).hexdigest()})

guide = (ROOT / "REVIEW.md").read_text(encoding="utf-8")
for segment in segments:
    check(segment["segmentId"] in guide and segment["clipStartClock"] in guide and segment["clipEndClock"] in guide,
          f"复核指南缺{segment['segmentId']}或分秒区间")
prepare_source = (ROOT / "prepare-review.py").read_text(encoding="utf-8")
check("currentResidualMs" not in prepare_source and "sup5ResidualMs" not in prepare_source, "绘图脚本不得使用算法残差或候选答案")

report = {
    "version": "v550-validation-v1",
    "passed": not failures,
    "segmentCount": len(segments),
    "perSample": {sample_id: sum(segment["sampleId"] == sample_id for segment in segments) for sample_id in SAMPLES},
    "perStratumPerSample": 10,
    "wavDurationSeconds": 1,
    "wavMatchesDecodedPcmSampleForSample": not any("WAV与PCM" in failure for failure in failures),
    "groundTruthFieldsBlank": not any("不得预填" in failure for failure in failures),
    "algorithmCandidatesHiddenFromPlots": not any("算法残差或候选答案" in failure for failure in failures),
    "failures": failures,
    "files": validated_files,
}
(ROOT / "validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    print(f"V550_VALIDATION_FAILED: {len(failures)}")
    raise SystemExit(1)
print("ok: 90个物件，003/042/095各30个，三种分层各10个")
print("ok: 90 WAV逐采样匹配工作区PCM，90 PNG与9总览完整")
print("ok: 真值栏全部留空，原始路径、分秒区间和人口权重完整")
print("V550_VALIDATION_PASSED")
