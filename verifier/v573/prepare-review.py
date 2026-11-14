# v573: 为六首保留歌曲生成180个物件的盲标WAV、图像和空白真值表。
from __future__ import annotations

import csv
import json
import sys
import wave
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
from matplotlib import pyplot as plt
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(sys.executable).parent.parent.parent))
from daimon_runtime import setup_plot
setup_plot()

ROOT = Path(__file__).resolve().parent
APP = ROOT.parent.parent
V541 = APP / "verifier" / "v541"
AUDIO_DIR = ROOT / "clips"
PLOT_DIR = ROOT / "plots"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
PLOT_DIR.mkdir(parents=True, exist_ok=True)
SELECTION_PATH = ROOT / "selection.json"
selection = json.loads(SELECTION_PATH.read_text(encoding="utf-8"))
segments = selection["segments"]
HOP = 11
WINDOW = 256
SAMPLES = ["sample-017", "sample-047", "sample-054", "sample-067", "sample-077", "sample-099"]
STRATA = ["both-within5", "only-high-within5", "neither-within5"]
STRATUM_CN = {
    "both-within5": "full 与 high 都在 ±5 ms",
    "only-high-within5": "仅 high 在 ±5 ms",
    "neither-within5": "两者都不在 ±5 ms",
}


def load_channels(sample_id: str) -> tuple[list[np.ndarray], dict]:
    directory = V541 / "decoded" / sample_id
    meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
    channels = [np.fromfile(directory / f"ch{channel}.f32", dtype="<f4") for channel in range(meta["numberOfChannels"])]
    return channels, meta


def all_hit_times(sample_id: str, beatmap_file: str) -> list[int]:
    text = (V541 / "samples" / sample_id / beatmap_file).read_text(encoding="utf-8")
    section = text.split("[HitObjects]", 1)[1].split("[", 1)[0]
    return sorted({round(float(row.split(",")[2])) for row in section.splitlines() if row.strip()})


def spectral_envelope(samples: np.ndarray, sample_rate: int, clip_start_ms: int) -> tuple[np.ndarray, np.ndarray]:
    frame_count = max(0, (len(samples) - WINDOW) // HOP + 1)
    hann = 0.5 * (1 - np.cos(2 * np.pi * np.arange(WINDOW) / (WINDOW - 1)))
    frames = np.lib.stride_tricks.as_strided(samples, shape=(frame_count, WINDOW),
                                              strides=(samples.strides[0] * HOP, samples.strides[0]))
    spectrum = np.abs(np.fft.rfft(frames * hann[None, :], axis=1))
    bins = spectrum.shape[1]
    magnitude = np.log1p(100 * spectrum / (1 + np.arange(bins)[None, :] / 24))
    flux = np.zeros(frame_count, dtype=np.float64)
    flux[1:] = np.maximum(0, np.diff(magnitude, axis=0)).sum(axis=1)
    hop_ms = HOP / sample_rate * 1000
    width = max(1, round(1000 / hop_ms))
    cumulative = np.concatenate([[0.0], np.cumsum(flux)])
    indices = np.arange(frame_count)
    starts = np.maximum(0, indices - width + 1)
    means = (cumulative[indices + 1] - cumulative[starts]) / (indices - starts + 1)
    normalized = np.maximum(0, flux - 0.7 * means)
    if normalized.max(initial=0) > 0:
        normalized /= normalized.max()
    times = clip_start_ms + indices * hop_ms + 3 * WINDOW / 4 / sample_rate * 1000
    return times, normalized


def write_wav(path: Path, channels: list[np.ndarray], sample_rate: int, start_ms: int, end_ms: int) -> None:
    requested_start = round(start_ms / 1000 * sample_rate)
    requested_end = round(end_ms / 1000 * sample_rate)
    start = max(0, requested_start)
    end = min(len(channels[0]), requested_end)
    interleaved = np.stack([channel[start:end] for channel in channels], axis=1)
    # 曲尾不足1秒时在末尾补零，保持原时间轴且不替换已选物件。
    if len(interleaved) < requested_end - requested_start:
        padding = np.zeros((requested_end - requested_start - len(interleaved), len(channels)), dtype=interleaved.dtype)
        interleaved = np.concatenate([interleaved, padding], axis=0)
    pcm = (np.clip(interleaved, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(len(channels))
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm.tobytes())


def plot_segment(segment: dict, channels: list[np.ndarray], meta: dict, hit_times: list[int], path: Path) -> None:
    sample_rate = meta["sampleRate"]
    mono = np.mean(np.stack(channels), axis=0)
    start = max(0, round(segment["clipStartMs"] / 1000 * sample_rate))
    end = min(len(mono), round(segment["clipEndMs"] / 1000 * sample_rate))
    clip = mono[start:end]
    times = segment["clipStartMs"] + np.arange(len(clip)) / sample_rate * 1000
    onset_times, onset = spectral_envelope(clip, sample_rate, segment["clipStartMs"])
    reference = segment["referenceMs"]
    relative = times - reference

    fig, (context_axis, wave_axis, onset_axis) = plt.subplots(3, 1, figsize=(14, 9), gridspec_kw={"height_ratios": [0.8, 1.1, 1.25]})
    indices = np.linspace(0, len(clip) - 1, min(6000, len(clip))).astype(int)
    context_axis.plot(relative[indices], clip[indices], color="#59738c", linewidth=0.55)
    context_axis.set_ylabel("1 秒上下文\n振幅")
    context_axis.set_xlim(-500, 500)
    context_axis.set_xticks(np.arange(-500, 501, 100))
    context_axis.grid(axis="x", alpha=0.16)

    zoom = np.abs(relative) <= 80
    wave_axis.plot(relative[zoom], clip[zoom], color="#385f7d", linewidth=0.8)
    wave_axis.set_ylabel("±80 ms 波形")
    wave_axis.set_xlim(-80, 80)
    wave_axis.set_ylim(-1.05, 1.05)
    wave_axis.set_xticks(np.arange(-80, 81, 10))
    wave_axis.set_xticks(np.arange(-80, 81, 5), minor=True)
    wave_axis.grid(axis="x", which="major", alpha=0.18)
    wave_axis.grid(axis="x", which="minor", alpha=0.09)

    onset_zoom = np.abs(onset_times - reference) <= 80
    onset_axis.plot(onset_times[onset_zoom] - reference, onset[onset_zoom], color="#7357a6", linewidth=1.0)
    onset_axis.set_ylabel("谱通量（片段归一化）")
    onset_axis.set_xlabel(f"相对谱面物件时间 (ms)；参考绝对时间 {segment['referenceClock']}")
    onset_axis.set_xlim(-80, 80)
    onset_axis.set_ylim(bottom=0)
    onset_axis.set_xticks(np.arange(-80, 81, 10))
    onset_axis.set_xticks(np.arange(-80, 81, 5), minor=True)
    onset_axis.grid(axis="x", which="major", alpha=0.18)
    onset_axis.grid(axis="x", which="minor", alpha=0.09)

    for axis in (context_axis, wave_axis, onset_axis):
        axis.axvspan(-5, 5, color="#5baa68", alpha=0.16)
        axis.axvline(0, color="#d34b4b", linewidth=1.5)
    for hit in hit_times:
        if segment["clipStartMs"] <= hit <= segment["clipEndMs"] and hit != reference:
            context_axis.axvline(hit - reference, color="#3985c6", alpha=0.22, linewidth=0.65)
            if abs(hit - reference) <= 80:
                wave_axis.axvline(hit - reference, color="#3985c6", alpha=0.25, linewidth=0.65)
                onset_axis.axvline(hit - reference, color="#3985c6", alpha=0.18, linewidth=0.65)
    fig.suptitle(f"{segment['segmentId']} · 独立 onset 精标 · 红线=谱面物件，绿影=±5 ms", fontsize=12)
    fig.text(0.01, 0.01, "蓝线=其他物件。不显示算法候选 onset 或相位；请按实际音头独立填写，无清晰音头不要强填。", fontsize=9, color="#4c4c4c")
    fig.tight_layout(rect=[0, 0.035, 1, 0.95])
    fig.savefig(path, dpi=160)
    plt.close(fig)


def contact_sheet(sample_id: str, stratum: str, paths: list[Path], output: Path) -> None:
    thumbs = []
    for path in paths:
        image = Image.open(path).convert("RGB")
        image.thumbnail((700, 450), Image.Resampling.LANCZOS)
        thumbs.append(image.copy())
    width = max(image.width for image in thumbs)
    height = max(image.height for image in thumbs)
    rows = (len(thumbs) + 1) // 2
    sheet = Image.new("RGB", (width * 2 + 36, height * rows + 50 + (rows - 1) * 8 + 45), "white")
    draw = ImageDraw.Draw(sheet)
    draw.text((12, 10), f"{sample_id} / {stratum}: independent onset labels; open individual PNG for 5 ms detail", fill="black")
    for index, image in enumerate(thumbs):
        x = 12 + (index % 2) * (width + 12)
        y = 50 + (index // 2) * (height + 8)
        sheet.paste(image, (x, y))
    sheet.save(output, optimize=True)


for sample_id in SAMPLES:
    selected = [segment for segment in segments if segment["sampleId"] == sample_id]
    channels, meta = load_channels(sample_id)
    hit_times = all_hit_times(sample_id, selected[0]["beatmapFile"])
    for stratum in STRATA:
        plot_paths = []
        contact_name = f"{sample_id}-{stratum}-contact.png"
        for segment in [item for item in selected if item["stratum"] == stratum]:
            stem = segment["segmentId"]
            audio_relative = f"clips/{stem}.wav"
            plot_relative = f"plots/{stem}.png"
            segment.update({
                "workspacePcmPath": str(V541 / "decoded" / sample_id),
                "audioClip": audio_relative,
                "plot": plot_relative,
                "contactSheet": contact_name,
            })
            write_wav(ROOT / audio_relative, channels, meta["sampleRate"], segment["clipStartMs"], segment["clipEndMs"])
            plot_segment(segment, channels, meta, hit_times, ROOT / plot_relative)
            plot_paths.append(ROOT / plot_relative)
        contact_sheet(sample_id, stratum, plot_paths, ROOT / contact_name)

selection["plotPolicy"] = "1 s context waveform plus +/-80 ms waveform and spectral-flux zoom; 5 ms minor ticks; no algorithm onset or phase candidates shown"
selection["contactSheets"] = [f"{sample_id}-{stratum}-contact.png" for sample_id in SAMPLES for stratum in STRATA]
SELECTION_PATH.write_text(json.dumps(selection, ensure_ascii=False, indent=2), encoding="utf-8")

with (ROOT / "review-template.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    fields = ["segmentId", "originalAudioPath", "clipStartClock", "clipEndClock", "referenceClock", "referenceMs",
              "actualOnsetClock", "actualOnsetMs", "confidence", "comment"]
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    for segment in segments:
        writer.writerow({key: segment.get(key, "") for key in fields})

lines = [
    "# v573：六首保留歌曲的独立 onset 盲标",
    "",
    "共 180 个物件：017、047、054、067、077、099 各 30 个。这些歌曲未参与 v559–v572 的开发推理、候选评估或标注；其 PCM 与旧预测已在最初 v541 冻结。",
    "图中不显示算法候选 onset、修正目标或相位。每段 WAV 为参考前 0.5 秒至后 0.5 秒，保留原声道；单张 PNG 提供 ±80 ms 和 5 ms 刻度。",
    "若物件没有清晰独立 onset，请填 `confidence=no_clear_onset`，不要强填毫秒值。算法分层只用于加权估计，不是真值。",
    "每层按人口/实际抽样数加权；缺候选在主指标中计为不正确。",
    "",
]
for sample_id in SAMPLES:
    selected = [segment for segment in segments if segment["sampleId"] == sample_id]
    lines += [f"## {sample_id}", "", f"原音频：`{selected[0]['originalAudioPath']}`", ""]
    for stratum in STRATA:
        rows = [segment for segment in selected if segment["stratum"] == stratum]
        lines += [f"### {STRATUM_CN[stratum]}（人口 {rows[0]['stratumPopulation']}，抽样 {len(rows)}，权重 {rows[0]['stratumWeight']:.6f}）", "",
                  "| 段落 | 原音频区间 | 参考点 | 区域 | 音频 | 图像 |",
                  "|---|---|---|---|---|---|"]
        for segment in rows:
            lines.append(f"| {segment['segmentId']} | {segment['clipStartClock']}–{segment['clipEndClock']} | {segment['referenceClock']} | {segment['region']} | [WAV]({segment['audioClip']}) | [PNG]({segment['plot']}) |")
        lines += ["", f"总览：`{sample_id}-{stratum}-contact.png`", ""]
lines += ["## 填写口径", "", "- `actualOnsetMs` 使用原音频整数毫秒时间轴；`actualOnsetClock` 使用 mm:ss.mmm。", "- `confidence` 填 `clear` / `approximate` / `no_clear_onset`。", "- 完成后分别计算 precision、输出覆盖率、真实音头 recall 和全部物件 ≤5 ms 正确率，并按各层人口/实际抽样数加权。", "- 当前真值栏为空，不能据此宣称 80% 已达成。", ""]
(ROOT / "REVIEW.md").write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({"segments": len(segments), "wav": len(list(AUDIO_DIR.glob("*.wav"))), "plots": len(list(PLOT_DIR.glob("*.png"))), "contacts": len(selection["contactSheets"])}, ensure_ascii=False))
print("V573_REVIEW_ASSETS_WRITTEN")
