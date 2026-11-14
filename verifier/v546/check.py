# v546: 校验复核资产的数量、时间轴、逐采样 WAV 内容和空白真值栏。
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


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


check(selection["groundTruthStatus"] == "pending_optional_precision_review", "精标必须是可选复核而非阻塞条件")
check("80%" in selection.get("weakLabelPolicy", "") and "20%" in selection.get("weakLabelPolicy", ""), "必须保存所有者八成含音弱标签规则")
check(len(segments) == 16, "必须有 16 段")
for sample_id in ["sample-001", "sample-058"]:
    check(sum(segment["sampleId"] == sample_id for segment in segments) == 8, f"{sample_id} 必须 8 段")
check(len({segment["segmentId"] for segment in segments}) == 16, "段落 ID 必须唯一")

with (ROOT / "review-template.csv").open("r", encoding="utf-8-sig", newline="") as handle:
    template = list(csv.DictReader(handle))
check(len(template) == 16, "复核模板必须 16 行")
check(all(not row["actualOnsetClock"] and not row["actualOnsetMs"] and not row["confidence"] for row in template), "真实 onset 与置信度不得预填")
check({row["segmentId"] for row in template} == {segment["segmentId"] for segment in segments}, "模板与选段必须一致")

validated_files: list[dict] = []
for segment in segments:
    sample_id = segment["sampleId"]
    decoded = V541 / "decoded" / sample_id
    meta = json.loads((decoded / "meta.json").read_text(encoding="utf-8"))
    wav_path = ROOT / segment["audioClip"]
    plot_path = ROOT / segment["plot"]
    check(wav_path.exists(), f"缺少 {wav_path.name}")
    check(plot_path.exists(), f"缺少 {plot_path.name}")
    check(segment["clipEndMs"] - segment["clipStartMs"] == 2000, f"{segment['segmentId']} 区间不是 2 秒")
    check(segment["referenceMs"] - segment["clipStartMs"] == 500, f"{segment['segmentId']} 参考点前不是 0.5 秒")
    check(segment["originalAudioPath"].startswith("F:\\Backup\\D\\osu!\\Songs\\"), f"{segment['segmentId']} 缺原始完整路径")
    with wave.open(str(wav_path), "rb") as audio:
        check(audio.getnchannels() == meta["numberOfChannels"], f"{segment['segmentId']} 声道数错误")
        check(audio.getframerate() == meta["sampleRate"], f"{segment['segmentId']} 采样率错误")
        check(audio.getsampwidth() == 2, f"{segment['segmentId']} 不是 16-bit")
        frames = audio.getnframes()
        check(abs(frames / meta["sampleRate"] - 2) <= 1 / meta["sampleRate"], f"{segment['segmentId']} WAV 时长错误")
        pcm = np.frombuffer(audio.readframes(frames), dtype="<i2").reshape(-1, meta["numberOfChannels"])
    start = round(segment["clipStartMs"] / 1000 * meta["sampleRate"])
    end = round(segment["clipEndMs"] / 1000 * meta["sampleRate"])
    channels = [np.fromfile(decoded / f"ch{channel}.f32", dtype="<f4") for channel in range(meta["numberOfChannels"])]
    expected = (np.clip(np.stack([channel[start:end] for channel in channels], axis=1), -1, 1) * 32767).astype("<i2")
    check(np.array_equal(pcm, expected), f"{segment['segmentId']} WAV 与 PCM 时间轴或采样值不一致")
    check(np.any(pcm != 0), f"{segment['segmentId']} WAV 为静音")
    with Image.open(plot_path) as plot:
        check(plot.size == (2240, 960), f"{segment['segmentId']} PNG 尺寸错误")
        plot.verify()
    for artifact in [wav_path, plot_path]:
        validated_files.append({"path": str(artifact.relative_to(ROOT)), "bytes": artifact.stat().st_size,
                                "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest()})

for sample_id in ["sample-001", "sample-058"]:
    contact = ROOT / f"{sample_id}-contact.png"
    check(contact.exists(), f"缺少 {contact.name}")
    with Image.open(contact) as image:
        check(image.size[0] >= 1800 and image.size[1] >= 1600, f"{contact.name} 总览分辨率不足")
        image.verify()
    validated_files.append({"path": contact.name, "bytes": contact.stat().st_size,
                            "sha256": hashlib.sha256(contact.read_bytes()).hexdigest()})

guide = (ROOT / "REVIEW.md").read_text(encoding="utf-8")
for segment in segments:
    check(segment["segmentId"] in guide and segment["clipStartClock"] in guide and segment["clipEndClock"] in guide,
          f"复核指南缺 {segment['segmentId']} 或分秒区间")

report = {
    "version": "v546-validation-v1",
    "passed": not failures,
    "segmentCount": len(segments),
    "perSample": {sample_id: sum(segment["sampleId"] == sample_id for segment in segments) for sample_id in ["sample-001", "sample-058"]},
    "wavDurationSeconds": 2,
    "wavMatchesDecodedPcmSampleForSample": not any("WAV 与 PCM" in failure for failure in failures),
    "groundTruthFieldsBlank": not any("不得预填" in failure for failure in failures),
    "failures": failures,
    "files": validated_files,
}
(ROOT / "validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    print(f"V546_VALIDATION_FAILED: {len(failures)}")
    raise SystemExit(1)
print(f"ok: {len(segments)} 段，001/058 各 8 段，16 WAV + 16 PNG + 2 总览")
print("ok: WAV 均为 2 秒双声道，逐采样匹配工作区 PCM")
print("ok: 真值栏全部留空，原始路径与分秒区间完整")
print("V546_VALIDATION_PASSED")
