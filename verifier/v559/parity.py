from pathlib import Path
import json

import numpy as np

from basic_pitch import FFT_HOP, SAMPLE_RATE, direct_frame_times_ms, run_inference
import soundfile as sf
import soxr

ROOT = Path(__file__).resolve().parent
FIXTURE = ROOT / "third_party" / "basic-pitch"
audio, sample_rate = sf.read(FIXTURE / "vocadito_10.wav", dtype="float32", always_2d=False)
if audio.ndim == 2:
    audio = audio.mean(axis=1)
if sample_rate != SAMPLE_RATE:
    audio = soxr.resample(audio, sample_rate, SAMPLE_RATE, quality="HQ")
audio = audio.astype(np.float32, copy=False)
assert len(audio) == 200607
expected = np.load(FIXTURE / "vocadito_10-model-output.npz", allow_pickle=True)["arr_0"].item()
actual = run_inference(audio)
comparison = {}
for name in ["note", "onset", "contour"]:
    assert actual[name].shape == expected[name].shape, (name, actual[name].shape, expected[name].shape)
    difference = np.abs(actual[name] - expected[name])
    max_abs = float(difference.max())
    mean_abs = float(difference.mean())
    np.testing.assert_allclose(actual[name], expected[name], atol=1e-4, rtol=0)
    comparison[name] = {"shape": list(actual[name].shape), "maxAbsDifference": max_abs, "meanAbsDifference": mean_abs}

# The retained local-frame coordinates must remain continuous at each 142-frame window join.
time_ms = actual["timeMs"]
np.testing.assert_array_equal(time_ms, direct_frame_times_ms(len(time_ms)))
steps = np.diff(time_ms)
np.testing.assert_allclose(steps, FFT_HOP / SAMPLE_RATE * 1000.0, rtol=0, atol=1e-12)
for join in [142, 284, 426, 568]:
    if join < len(time_ms):
        np.testing.assert_allclose(steps[join - 1], steps[0], rtol=0, atol=1e-12)
result = {
    "version": "v559-basic-pitch-official-parity-v1",
    "passed": True,
    "fixtureSamples": len(audio),
    "fixtureDurationMs": len(audio) / SAMPLE_RATE * 1000.0,
    "outputFrames": len(time_ms),
    "frameHopMs": float(steps[0]),
    "windowJoinsChecked": [join for join in [142, 284, 426, 568] if join < len(time_ms)],
    "comparison": comparison,
    "timeMapping": "direct retained-frame coordinates; no accumulated window correction",
}
(ROOT / "parity-results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
print("V559_OFFICIAL_PARITY_AND_TIME_MAPPING_PASSED")
