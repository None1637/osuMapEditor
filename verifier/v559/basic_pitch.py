"""Minimal, source-faithful Basic Pitch ONNX inference for the frozen E2 experiment."""
from __future__ import annotations

from pathlib import Path
import sys
from typing import Iterator

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor"))
import onnxruntime as ort

SAMPLE_RATE = 22050
FFT_HOP = 256
AUDIO_N_SAMPLES = 43844
ANNOTATIONS_FPS = 86
N_OVERLAPPING_FRAMES = 30
OVERLAP_SAMPLES = N_OVERLAPPING_FRAMES * FFT_HOP
WINDOW_HOP_SAMPLES = AUDIO_N_SAMPLES - OVERLAP_SAMPLES
FRAMES_PER_WINDOW = 172
RETAINED_FRAMES_PER_WINDOW = 2 * ANNOTATIONS_FPS - N_OVERLAPPING_FRAMES
INPUT_NAME = "serving_default_input_2:0"
OUTPUT_NAMES = ["StatefulPartitionedCall:1", "StatefulPartitionedCall:2", "StatefulPartitionedCall:0"]
TENSOR_NAMES = ["note", "onset", "contour"]


def load_session() -> ort.InferenceSession:
    model = ROOT / "third_party" / "basic-pitch" / "nmp.onnx"
    return ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])


def audio_windows(audio: np.ndarray) -> Iterator[np.ndarray]:
    padded = np.concatenate([np.zeros(OVERLAP_SAMPLES // 2, dtype=np.float32), audio])
    for start in range(0, len(padded), WINDOW_HOP_SAMPLES):
        window = padded[start:start + AUDIO_N_SAMPLES]
        if len(window) < AUDIO_N_SAMPLES:
            window = np.pad(window, (0, AUDIO_N_SAMPLES - len(window)))
        yield window.reshape(1, AUDIO_N_SAMPLES, 1).astype(np.float32, copy=False)


def unwrap(output: np.ndarray, original_length: int) -> np.ndarray:
    assert output.ndim == 3
    assert output.shape[1:] in {(FRAMES_PER_WINDOW, 88), (FRAMES_PER_WINDOW, 264)}
    trimmed = output[:, N_OVERLAPPING_FRAMES // 2:-N_OVERLAPPING_FRAMES // 2, :]
    flattened = trimmed.reshape(trimmed.shape[0] * trimmed.shape[1], trimmed.shape[2])
    expected = int(original_length / WINDOW_HOP_SAMPLES * RETAINED_FRAMES_PER_WINDOW)
    return flattened[:expected, :]


def direct_frame_times_ms(frame_count: int) -> np.ndarray:
    """Map retained local frame j to window start + (j-15)*256 samples.

    Front padding is 15*256 samples, so retained frame zero is original sample zero.
    Across windows, the next retained frame advances by exactly FFT_HOP samples.
    """
    return np.arange(frame_count, dtype=np.float64) * (FFT_HOP / SAMPLE_RATE * 1000.0)


def run_inference(audio: np.ndarray, session: ort.InferenceSession | None = None) -> dict[str, np.ndarray]:
    assert audio.ndim == 1 and audio.dtype == np.float32
    assert np.isfinite(audio).all()
    session = session or load_session()
    original_length = len(audio)
    outputs: dict[str, list[np.ndarray]] = {name: [] for name in TENSOR_NAMES}
    for window in audio_windows(audio):
        values = session.run(OUTPUT_NAMES, {INPUT_NAME: window})
        for name, value in zip(TENSOR_NAMES, values):
            outputs[name].append(value)
    result = {name: unwrap(np.concatenate(outputs[name]), original_length) for name in TENSOR_NAMES}
    result["timeMs"] = direct_frame_times_ms(len(result["onset"]))
    return result
