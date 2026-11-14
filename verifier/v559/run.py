# v559: 冻结 Basic Pitch 推理和候选提取；本脚本不读取人工标注。
from __future__ import annotations

from pathlib import Path
import hashlib
import json
import math
import time

import numpy as np
from scipy.signal import argrelmax

from basic_pitch import FFT_HOP, SAMPLE_RATE, load_session, run_inference

ROOT = Path(__file__).resolve().parent
V541 = ROOT.parent / "v541"
V548 = ROOT.parent / "v548"
V557 = ROOT.parent / "v557"
V558 = ROOT.parent / "v558"
config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
assert config["productionCodeChanged"] is False
for gate in ["smoke-results.json", "parity-results.json"]:
    assert json.loads((ROOT / gate).read_text(encoding="utf-8"))["passed"] is True
model_path = ROOT / "third_party" / "basic-pitch" / "nmp.onnx"
assert hashlib.sha256(model_path.read_bytes()).hexdigest() == config["model"]["sha256"]

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


def max_peaks(onset: np.ndarray, time_ms: np.ndarray) -> np.ndarray:
    envelope = onset.max(axis=1)
    hop_ms = FFT_HOP / SAMPLE_RATE * 1000.0
    peaks = []
    for i in range(1, len(envelope) - 1):
        center = float(envelope[i])
        if center < 0.5 or not (center > envelope[i - 1] and center > envelope[i + 1]):
            continue
        left, right = float(envelope[i - 1]), float(envelope[i + 1])
        denominator = left - 2.0 * center + right
        delta = 0.0 if abs(denominator) <= 1e-12 else float(np.clip(0.5 * (left - right) / denominator, -1.0, 1.0))
        peaks.append(float(time_ms[i]) + delta * hop_ms)
    return np.asarray(peaks, dtype=np.float64)


def pitch_peaks(onset: np.ndarray, time_ms: np.ndarray) -> np.ndarray:
    locations = argrelmax(onset, axis=0)
    mask = onset[locations] >= 0.5
    frames = np.unique(locations[0][mask])
    return time_ms[frames].astype(np.float64, copy=False)


session = load_session()
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
    output = run_inference(audio, session)
    onset, time_ms = output["onset"], output["timeMs"]
    assert onset.shape == (len(time_ms), 88)
    assert np.isfinite(onset).all()
    # 长歌曲的大时间戳相减会放大浮点尾差；1e-9 ms 仍远低于测量精度。
    np.testing.assert_allclose(np.diff(time_ms), FFT_HOP / SAMPLE_RATE * 1000.0, rtol=0, atol=1e-9)
    np.savez_compressed(ROOT / "activations" / f"{sample_id}.npz", onset=onset, timeMs=time_ms)
    neural_max = max_peaks(onset, time_ms)
    neural_pitch = pitch_peaks(onset, time_ms)
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
        row = {
            "segmentId": segment_id,
            "sampleId": sample_id,
            "referenceMs": segment["referenceMs"],
            "targetMs": target,
            "globalDelayMs": previous["globalDelay"]["delayMs"],
            "phaseMs": phase,
            "fullResidualMs": old["fullResidualMs"],
            "neuralMaxResidualMs": nearest(neural_max, target),
            "neuralPitchResidualMs": nearest(neural_pitch, target),
            "baselineResidualAbsDifferenceMs": 0.0,
        }
        rows.append(row)
    all_rows.extend(rows)
    sample_result = {
        "id": sample_id,
        "sourceSha256": meta["sourceSha256"],
        "pcmSha256": meta["pcmSha256"],
        "audioSamples": len(audio),
        "outputFrames": len(time_ms),
        "lastFrameMs": float(time_ms[-1]),
        "activationMax": float(onset.max()),
        "peakCounts": {"neuralMax": len(neural_max), "neuralPitch": len(neural_pitch)},
        "inferenceAndCandidateSeconds": time.perf_counter() - started,
        "rows": rows,
    }
    (ROOT / "per-sample" / f"{sample_id}.json").write_text(json.dumps(sample_result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in sample_result.items() if key != "rows"}, ensure_ascii=False), flush=True)

assert len(all_rows) == 90 and len({row["segmentId"] for row in all_rows}) == 90
(ROOT / "candidates.json").write_text(json.dumps({
    "version": "v559-basic-pitch-e2-candidates-v1",
    "configuration": config,
    "rows": all_rows,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print("V559_CANDIDATES_WRITTEN objects=90")
