# v546: 为独立声学 onset 标注生成音频片段、波形/谱通量图和空白复核表。
from __future__ import annotations

import csv
import json
import math
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
V545 = APP / "verifier" / "v545"
AUDIO_DIR = ROOT / "clips"
PLOT_DIR = ROOT / "plots"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
PLOT_DIR.mkdir(parents=True, exist_ok=True)

RESULTS = json.loads((V545 / "oracle-results.json").read_text(encoding="utf-8"))
MANIFEST = json.loads((V541 / "manifest.json").read_text(encoding="utf-8"))
with (V545 / "oracle-residuals.csv").open("r", encoding="utf-8", newline="") as handle:
    RESIDUAL_ROWS = list(csv.DictReader(handle))

PRE_MS = 500
POST_MS = 1500
HOP = 11
WINDOW = 256


def clock(ms: float) -> str:
    total_ms = int(round(ms))
    minutes, remainder = divmod(total_ms, 60000)
    seconds, millis = divmod(remainder, 1000)
    return f"{minutes:02d}:{seconds:02d}.{millis:03d}"


def fmt(value: float | None, digits: int = 3) -> str:
    return "" if value is None else f"{value:.{digits}f}"


def residual_row(sample_id: str, kind: str, reference_ms: int) -> dict | None:
    return next((row for row in RESIDUAL_ROWS if row["id"] == sample_id and row["feature"] == "spectral-flux"
                 and row["kind"] == kind and int(float(row["referenceMs"])) == reference_ms), None)


def choose_spaced(candidates: list[dict], count: int, selected: list[dict], mode: str) -> list[dict]:
    if mode == "bad":
        ordered = sorted(candidates, key=lambda row: -abs(float(row["residualMs"])))
    elif mode == "good":
        ordered = sorted(candidates, key=lambda row: abs(float(row["residualMs"])))
    else:
        ordered = sorted(candidates, key=lambda row: float(row["referenceMs"]))
        if len(ordered) > 2:
            ordered = [ordered[len(ordered) // 3], ordered[2 * len(ordered) // 3]] + ordered
    output: list[dict] = []
    for row in ordered:
        reference = int(float(row["referenceMs"]))
        if any(abs(reference - int(item["referenceMs"])) < 300 for item in selected + output):
            continue
        output.append(row)
        if len(output) == count:
            break
    if len(output) != count:
        raise RuntimeError(f"无法选择足够的 {mode} 对照：{len(output)}/{count}")
    return output


def select_segments() -> list[dict]:
    segments: list[dict] = []
    for sample in RESULTS["samples"]:
        sample_id = sample["id"]
        feature = sample["features"]["spectral-flux"]
        if sample_id == "sample-001":
            for index, phase in enumerate(record for record in feature["localPhase"]["records"] if record["inReview"]):
                reference = int(phase["timeMs"])
                row = residual_row(sample_id, "redline", reference)
                segments.append({
                    "sampleId": sample_id,
                    "segmentId": f"sample-001_r{reference}",
                    "anchorKind": "redline",
                    "referenceMs": reference,
                    "bpm": phase["bpm"],
                    "redlineDurationMs": phase["durationMs"],
                    "supportHitCount": phase["supportHitCount"],
                    "onsetMs": None if not row or not row["onsetMs"] else float(row["onsetMs"]),
                    "residualMs": None if not row or not row["residualMs"] else float(row["residualMs"]),
                    "localPhaseShiftMs": phase["actual"]["shiftMs"],
                    "selectionReason": f"人工复核红线 {index + 1}/8；段内支持音符 {phase['supportHitCount']}",
                })
        else:
            phase_records = [record for record in feature["localPhase"]["records"] if record["inReview"]]
            for phase in phase_records:
                reference = int(phase["timeMs"])
                row = residual_row(sample_id, "redline", reference)
                segments.append({
                    "sampleId": sample_id,
                    "segmentId": f"sample-058_r{reference}",
                    "anchorKind": "redline",
                    "referenceMs": reference,
                    "bpm": phase["bpm"],
                    "redlineDurationMs": phase["durationMs"],
                    "supportHitCount": phase["supportHitCount"],
                    "onsetMs": None if not row or not row["onsetMs"] else float(row["onsetMs"]),
                    "residualMs": None if not row or not row["residualMs"] else float(row["residualMs"]),
                    "localPhaseShiftMs": phase["actual"]["shiftMs"],
                    "selectionReason": f"人工复核红线；段内支持音符 {phase['supportHitCount']}",
                })
            review_start, review_end = sample["reviewRangeMs"]
            hit_rows = [row for row in RESIDUAL_ROWS if row["id"] == sample_id and row["feature"] == "spectral-flux"
                        and row["kind"] == "hitobject" and row["inReview"] == "true"
                        and all(abs(float(row["referenceMs"]) - phase["timeMs"]) >= 300 for phase in phase_records)]
            unmatched = [row for row in hit_rows if row["matched"] == "false"]
            bad = [row for row in hit_rows if row["matched"] == "true" and abs(float(row["residualMs"])) > 5]
            good = [row for row in hit_rows if row["matched"] == "true" and abs(float(row["residualMs"])) <= 5]
            chosen = choose_spaced(unmatched, 2, segments, "unmatched")
            chosen += choose_spaced(bad, 2, segments + chosen, "bad")
            chosen += choose_spaced(good, 2, segments + chosen, "good")
            for row in chosen:
                reference = int(float(row["referenceMs"]))
                residual = None if not row["residualMs"] else float(row["residualMs"])
                reason = "未匹配 onset" if residual is None else ("大残差 >5 ms" if abs(residual) > 5 else "≤5 ms 清晰对照")
                segments.append({
                    "sampleId": sample_id,
                    "segmentId": f"sample-058_h{reference}",
                    "anchorKind": "hitobject",
                    "referenceMs": reference,
                    "bpm": None,
                    "redlineDurationMs": None,
                    "supportHitCount": None,
                    "onsetMs": None if not row["onsetMs"] else float(row["onsetMs"]),
                    "residualMs": residual,
                    "localPhaseShiftMs": None,
                    "selectionReason": reason,
                })
    if len(segments) != 16 or any(sum(item["sampleId"] == sample_id for item in segments) != 8 for sample_id in ["sample-001", "sample-058"]):
        raise RuntimeError("复核段数量必须为 001/058 各 8 段")
    for segment in segments:
        segment["clipStartMs"] = segment["referenceMs"] - PRE_MS
        segment["clipEndMs"] = segment["referenceMs"] + POST_MS
        segment["reviewedActualOnsetMs"] = None
    return segments


def load_channels(sample_id: str) -> tuple[np.ndarray, dict]:
    directory = V541 / "decoded" / sample_id
    meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
    channels = [np.fromfile(directory / f"ch{channel}.f32", dtype="<f4") for channel in range(meta["numberOfChannels"])]
    return channels, meta


def spectral_envelope(samples: np.ndarray, sample_rate: int, clip_start_ms: int) -> tuple[np.ndarray, np.ndarray]:
    frame_count = max(0, (len(samples) - WINDOW) // HOP + 1)
    hann = 0.5 * (1 - np.cos(2 * np.pi * np.arange(WINDOW) / (WINDOW - 1)))
    frames = np.lib.stride_tricks.as_strided(samples, shape=(frame_count, WINDOW),
                                              strides=(samples.strides[0] * HOP, samples.strides[0])).copy()
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
    start = max(0, round(start_ms / 1000 * sample_rate))
    end = min(len(channels[0]), round(end_ms / 1000 * sample_rate))
    interleaved = np.stack([channel[start:end] for channel in channels], axis=1)
    pcm = (np.clip(interleaved, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(len(channels))
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm.tobytes())


def plot_segment(segment: dict, channels: list[np.ndarray], meta: dict, redlines: list[dict], hit_rows: list[dict], path: Path) -> None:
    sample_rate = meta["sampleRate"]
    mono = np.mean(np.stack(channels), axis=0)
    start = max(0, round(segment["clipStartMs"] / 1000 * sample_rate))
    end = min(len(mono), round(segment["clipEndMs"] / 1000 * sample_rate))
    clip = mono[start:end]
    times = segment["clipStartMs"] + np.arange(len(clip)) / sample_rate * 1000
    onset_times, onset = spectral_envelope(clip, sample_rate, segment["clipStartMs"])
    reference = segment["referenceMs"]

    fig, (wave_axis, onset_axis) = plt.subplots(2, 1, figsize=(14, 6), sharex=True, gridspec_kw={"height_ratios": [1, 1.35]})
    max_points = 5000
    if len(clip) > max_points:
        indices = np.linspace(0, len(clip) - 1, max_points).astype(int)
    else:
        indices = np.arange(len(clip))
    wave_axis.plot(times[indices] - reference, clip[indices], color="#59738c", linewidth=0.55)
    wave_axis.set_ylabel("波形振幅")
    wave_axis.grid(axis="x", alpha=0.16)
    onset_axis.plot(onset_times - reference, onset, color="#7357a6", linewidth=0.85, label="谱通量（片段归一化）")
    onset_axis.set_ylabel("onset 强度")
    onset_axis.set_xlabel(f"相对参考时间 (ms)；参考绝对时间 {clock(reference)}")
    onset_axis.grid(axis="x", alpha=0.16)

    for axis in (wave_axis, onset_axis):
        axis.axvspan(-5, 5, color="#5baa68", alpha=0.16, label="±5 ms" if axis == onset_axis else None)
        axis.axvline(0, color="#d34b4b", linewidth=1.6, label="谱面参考" if axis == onset_axis else None)
        if segment["onsetMs"] is not None:
            candidate = segment["onsetMs"] - reference
            axis.axvline(candidate, color="#16866d", linewidth=1.35, linestyle="--",
                         label="最近 onset 候选" if axis == onset_axis else None)
        if segment["localPhaseShiftMs"] is not None:
            axis.axvline(segment["localPhaseShiftMs"], color="#db8b23", linewidth=1.25, linestyle=":",
                         label="逐段相位候选" if axis == onset_axis else None)
    for line in redlines:
        if segment["clipStartMs"] <= line["timeMs"] <= segment["clipEndMs"] and line["timeMs"] != reference:
            wave_axis.axvline(line["timeMs"] - reference, color="#d34b4b", alpha=0.3, linewidth=0.8)
    for row in hit_rows:
        hit = float(row["referenceMs"])
        if segment["clipStartMs"] <= hit <= segment["clipEndMs"]:
            wave_axis.axvline(hit - reference, color="#3985c6", alpha=0.20, linewidth=0.65)
    wave_axis.set_xlim(-PRE_MS, POST_MS)
    wave_axis.set_ylim(-1.05, 1.05)
    onset_axis.set_ylim(bottom=0)
    onset_axis.set_xticks(np.arange(-500, 1501, 100))
    onset_axis.set_xticks(np.arange(-500, 1501, 20), minor=True)
    title = f"{segment['segmentId']} · {segment['anchorKind']} · {segment['selectionReason']}"
    if segment["bpm"] is not None:
        title += f" · {segment['bpm']:.3f} BPM"
    fig.suptitle(title, fontsize=12)
    onset_axis.legend(loc="upper right", ncol=4, fontsize=9)
    fig.text(0.01, 0.01, "蓝线=其他音符；红影=±5 ms。候选仅供定位，真实 onset 留待独立复核。", fontsize=9, color="#4c4c4c")
    fig.tight_layout(rect=[0, 0.035, 1, 0.95])
    fig.savefig(path, dpi=160)
    plt.close(fig)


def contact_sheet(sample_id: str, paths: list[Path], output: Path) -> None:
    thumbs = []
    for path in paths:
        image = Image.open(path).convert("RGB")
        image.thumbnail((900, 390), Image.Resampling.LANCZOS)
        thumbs.append(image.copy())
    width = max(image.width for image in thumbs)
    height = max(image.height for image in thumbs)
    sheet = Image.new("RGB", (width * 2 + 36, height * 4 + 90), "white")
    draw = ImageDraw.Draw(sheet)
    draw.text((12, 10), f"{sample_id}: 8 onset review segments (open individual PNG for 5 ms detail)", fill="black")
    for index, image in enumerate(thumbs):
        x = 12 + (index % 2) * (width + 12)
        y = 50 + (index // 2) * (height + 10)
        sheet.paste(image, (x, y))
    sheet.save(output, optimize=True)


segments = select_segments()
all_hit_rows = [row for row in RESIDUAL_ROWS if row["feature"] == "spectral-flux" and row["kind"] == "hitobject"]
for sample in RESULTS["samples"]:
    sample_id = sample["id"]
    channels, meta = load_channels(sample_id)
    manifest_item = next(item for item in MANIFEST["samples"] if item["id"] == sample_id)
    original_audio = str(Path(manifest_item["sourceDirectory"]) / manifest_item["originalAudioFilename"])
    selected = [segment for segment in segments if segment["sampleId"] == sample_id]
    plot_paths = []
    for segment in selected:
        stem = segment["segmentId"]
        audio_relative = f"clips/{stem}.wav"
        plot_relative = f"plots/{stem}.png"
        segment.update({
            "originalAudioPath": original_audio,
            "workspacePcmPath": str(V541 / "decoded" / sample_id),
            "audioClip": audio_relative,
            "plot": plot_relative,
            "clipStartClock": clock(segment["clipStartMs"]),
            "clipEndClock": clock(segment["clipEndMs"]),
            "referenceClock": clock(segment["referenceMs"]),
        })
        write_wav(ROOT / audio_relative, channels, meta["sampleRate"], segment["clipStartMs"], segment["clipEndMs"])
        plot_segment(segment, channels, meta, sample["redLines"], [row for row in all_hit_rows if row["id"] == sample_id], ROOT / plot_relative)
        plot_paths.append(ROOT / plot_relative)
    contact_sheet(sample_id, plot_paths, ROOT / f"{sample_id}-contact.png")

(ROOT / "selection.json").write_text(json.dumps({
    "version": "v546-independent-onset-review-v2",
    "groundTruthStatus": "pending_optional_precision_review",
    "weakLabelPolicy": "owner rule: hitobject times imply audible onsets in about 80% of cases; use robust consensus and allow about 20% outliers",
    "clipPolicy": "original copied PCM to 16-bit stereo WAV; no time stretching; reference-500 ms to reference+1500 ms",
    "plotPolicy": "mono waveform and locally normalized spectral flux; algorithm candidates are not ground truth",
    "segments": segments,
}, ensure_ascii=False, indent=2), encoding="utf-8")

with (ROOT / "review-template.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    fields = ["segmentId", "originalAudioPath", "clipStartClock", "clipEndClock", "referenceClock", "referenceMs",
              "anchorKind", "selectionReason", "actualOnsetClock", "actualOnsetMs", "confidence", "comment"]
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    for segment in segments:
        writer.writerow({key: segment.get(key, "") for key in fields})

lines = [
    "# v546：独立声学 onset 复核（可选精标）",
    "",
    "所有者规则：谱面物件时间点约 80% 对应真实音，因此算法可将物件时间当作含约 20% 离群值的弱标签，无需逐段人工判断有没有音。",
    "本表只用于少量毫秒级精度复核，不是继续研究的前置条件；可只填写算法分歧较大的段落。",
    "每段 WAV 均为参考前 0.5 秒至参考后 1.5 秒，保留双声道；单张 PNG 可查看 5 ms 细节，contact 图仅作总览。",
    "若属于约 20% 无清晰独立 onset 的物件，可填 `confidence=no_clear_onset`，不要勉强给毫秒值。",
    "",
]
for sample_id in ["sample-001", "sample-058"]:
    selected = [segment for segment in segments if segment["sampleId"] == sample_id]
    lines += [f"## {sample_id}", "", f"原音频：`{selected[0]['originalAudioPath']}`", "",
              "| 段落 | 原音频区间 | 参考点 | 类型 | 选择原因 | onset 残差 ms | 局部相位 ms | 音频 | 图像 |",
              "|---|---|---|---|---|---:|---:|---|---|"]
    for segment in selected:
        lines.append(f"| {segment['segmentId']} | {segment['clipStartClock']}–{segment['clipEndClock']} | {segment['referenceClock']} | {segment['anchorKind']} | {segment['selectionReason']} | {fmt(segment['residualMs'])} | {fmt(segment['localPhaseShiftMs'])} | [WAV]({segment['audioClip']}) | [PNG]({segment['plot']}) |")
    lines += ["", f"总览：`{sample_id}-contact.png`", ""]
lines += ["## 填写口径", "", "- `actualOnsetMs` 使用原音频的整数毫秒时间轴；`actualOnsetClock` 使用 mm:ss.mmm。", "- `confidence` 建议填 `clear` / `approximate` / `no_clear_onset`。", "- 需要区分‘这里没有独立音头’与‘音头存在但听不准’，后者可填 `approximate` 并注释估计范围。", "- 本轮标签确认前，不计算独立 onset 正确率，也不修改生产检测参数。", ""]
(ROOT / "REVIEW.md").write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({"segments": len(segments), "perSample": 8, "wav": len(list(AUDIO_DIR.glob('*.wav'))), "plots": len(list(PLOT_DIR.glob('*.png')))}, ensure_ascii=False))
print("V546_REVIEW_ASSETS_WRITTEN")
