# v560: 冻结 DDC 推理和候选提取；本脚本不读取人工标注或确认集音频。
from __future__ import annotations

from pathlib import Path
import hashlib
import json
import math
import sys
import time

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor"))
sys.path.insert(0, str(ROOT / "upstream-ddc-onset"))

import numpy as np
import torch
from ddc_onset.cnn import PlacementCNN, SpectrogramNormalizer
from ddc_onset.constants import DIFFICULTY_TO_THRESHOLD, Difficulty, FRAME_RATE, SAMPLE_RATE
from ddc_onset.spectral import SpectrogramExtractor
from ddc_onset.util import find_peaks, threshold_peaks

V541 = ROOT.parent / "v541"
V548 = ROOT.parent / "v548"
V557 = ROOT.parent / "v557"
V558 = ROOT.parent / "v558"
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
assert config["productionCodeChanged"] is False
for gate in ["smoke-results.json", "parity-results.json"]:
    assert json.loads((ROOT / gate).read_text(encoding="utf-8"))["passed"] is True
confirmation = json.loads((ROOT.parent / "v559" / "confirmation-selection.json").read_text(encoding="utf-8"))
assert not set(config["sampleIds"]) & {item["id"] for item in confirmation["samples"]}

selection = json.loads((V557 / "selection.json").read_text(encoding="utf-8"))
selected_beatmaps = json.loads((V548 / "selection.json").read_text(encoding="utf-8"))["samples"]
baseline = json.loads((V558 / "candidates.json").read_text(encoding="utf-8"))["rows"]
baseline_by_id = {row["segmentId"]: row for row in baseline}
assert len(baseline_by_id) == 90


def parse_hits(osu: str, redlines: list[dict]) -> list[dict]:
    section = osu.split("[HitObjects]", 1)[1].split("[", 1)[0]
    times = sorted({round(float(row.strip().split(",")[2])) for row in section.splitlines()
                    if row.strip() and len(row.strip().split(",")) > 2 and float(row.strip().split(",")[2]) >= 0})
    hits = []
    for index, time_ms in enumerate(times):
        segment = -1
        for i, redline in enumerate(redlines):
            if redline["timeMs"] <= time_ms < redline["endMs"]:
                segment = i
                break
        hits.append({"timeMs": time_ms, "index": index, "segment": segment})
    return hits


def nearest(peaks: np.ndarray, target: float) -> float | None:
    if len(peaks) == 0:
        return None
    position = int(np.searchsorted(peaks, target))
    candidates = []
    for index in [position - 1, position, position + 1]:
        if 0 <= index < len(peaks) and abs(float(peaks[index]) - target) <= 10.0:
            candidates.append(float(peaks[index]))
    if not candidates:
        return None
    return min(candidates, key=lambda peak: abs(peak - target)) - target


def parabolic_peak_times(smoothed: np.ndarray, peaks: list[int]) -> np.ndarray:
    times = []
    for index in peaks:
        delta = 0.0
        if 0 < index < len(smoothed) - 1:
            left, center, right = map(float, smoothed[index - 1:index + 2])
            denominator = left - 2.0 * center + right
            if abs(denominator) > 1e-20:
                delta = float(np.clip(0.5 * (left - right) / denominator, -1.0, 1.0))
        times.append((index + delta) * (1000.0 / FRAME_RATE))
    return np.asarray(sorted(times), dtype=np.float64)


extractor = SpectrogramExtractor().eval()
normalizer = SpectrogramNormalizer().eval()
placement = PlacementCNN().eval()
difficulty = torch.tensor([Difficulty.CHALLENGE.value], dtype=torch.int64)
all_rows = []
(ROOT / "activations").mkdir(exist_ok=True)
(ROOT / "per-sample").mkdir(exist_ok=True)
for sample_id in config["sampleIds"]:
    started = time.perf_counter()
    decoded_dir = ROOT / "decoded" / sample_id
    meta = json.loads((decoded_dir / "meta.json").read_text(encoding="utf-8"))
    assert meta["sampleRate"] == SAMPLE_RATE and meta["numberOfChannels"] == 1
    audio = np.fromfile(decoded_dir / "mono.f32", dtype=np.float32)
    assert len(audio) == meta["length"]
    assert hashlib.sha256(audio.tobytes()).hexdigest() == meta["pcmSha256"]
    with torch.no_grad():
        features = extractor(torch.from_numpy(audio).view(1, -1), frame_chunk_size=256)
        salience = placement(normalizer(features[0]), difficulty, conv_chunk_size=256, dense_chunk_size=256)[0].numpy()
    expected_frames = (len(audio) + 512 + 440) // 441
    assert salience.shape == (expected_frames,)
    assert salience.dtype == np.float32 and np.isfinite(salience).all()
    smoothed = np.convolve(salience, np.hamming(5), "same")
    all_peaks = find_peaks(salience)
    peaks = list(threshold_peaks(salience, all_peaks, DIFFICULTY_TO_THRESHOLD[Difficulty.CHALLENGE]))
    official_times = np.asarray(peaks, dtype=np.float64) * (1000.0 / FRAME_RATE)
    parabolic_times = parabolic_peak_times(smoothed, peaks)
    np.savez_compressed(ROOT / "activations" / f"{sample_id}.npz", salience=salience,
                        smoothedSalience=smoothed, ddcOfficialPeakMs=official_times,
                        ddcParabolicPeakMs=parabolic_times)
    previous = json.loads((V548 / "per-sample" / f"{sample_id}.json").read_text(encoding="utf-8"))
    beatmap_file = next(item["beatmapFile"] for item in selected_beatmaps if item["id"] == sample_id)
    osu = (V541 / "samples" / sample_id / beatmap_file).read_text(encoding="utf-8")
    hits = parse_hits(osu, previous["redlines"])
    hit_by_time = {hit["timeMs"]: hit for hit in hits}
    chosen = next(item for item in previous["configurations"] if item["aggregate"] == "top2" and item["method"] == "dp")
    sample_segments = [segment for segment in selection["segments"] if segment["sampleId"] == sample_id]
    rows = []
    for segment in sample_segments:
        segment_id = segment["segmentId"]
        hit = hit_by_time[segment["referenceMs"]]
        fold = "odd" if hit["index"] % 2 == 0 else "even"
        phase = chosen["phases"]["actual"][fold][hit["segment"]] if hit["segment"] >= 0 else 0.0
        phase = phase or 0.0
        target = hit["timeMs"] + previous["globalDelay"]["delayMs"] + phase
        old = baseline_by_id[segment_id]
        assert old["baselineResidualAbsDifferenceMs"] == 0
        assert math.isclose(old["targetMs"], target, rel_tol=0, abs_tol=1e-9)
        rows.append({
            "segmentId": segment_id,
            "sampleId": sample_id,
            "referenceMs": segment["referenceMs"],
            "targetMs": target,
            "globalDelayMs": previous["globalDelay"]["delayMs"],
            "phaseMs": phase,
            "fullResidualMs": old["fullResidualMs"],
            "ddcOfficialResidualMs": nearest(official_times, target),
            "ddcParabolicResidualMs": nearest(parabolic_times, target),
            "baselineResidualAbsDifferenceMs": 0.0,
        })
    all_rows.extend(rows)
    sample_result = {
        "id": sample_id,
        "sourceSha256": meta["sourceSha256"],
        "pcmSha256": meta["pcmSha256"],
        "audioSamples": len(audio),
        "outputFrames": len(salience),
        "lastFrameMs": float((len(salience) - 1) * 1000.0 / FRAME_RATE),
        "activationMax": float(salience.max()),
        "allPeakCount": len(all_peaks),
        "peakCounts": {"ddcOfficial": len(official_times), "ddcParabolic": len(parabolic_times)},
        "inferenceAndCandidateSeconds": time.perf_counter() - started,
        "rows": rows,
    }
    (ROOT / "per-sample" / f"{sample_id}.json").write_text(json.dumps(sample_result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in sample_result.items() if key != "rows"}, ensure_ascii=False), flush=True)

assert len(all_rows) == 90 and len({row["segmentId"] for row in all_rows}) == 90
(ROOT / "candidates.json").write_text(json.dumps({
    "version": "v560-ddc-onset-e3-candidates-v1",
    "configuration": config,
    "rows": all_rows,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print("V560_CANDIDATES_WRITTEN objects=90")
