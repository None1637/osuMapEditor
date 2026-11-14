# v560: DDC 权重、输出范围、确定性和直接帧时间自检；不读取歌曲候选或标注。
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor"))
sys.path.insert(0, str(ROOT / "upstream-ddc-onset"))

import numpy as np
import torch
from ddc_onset import FRAME_RATE, SAMPLE_RATE, compute_onset_salience

config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
assert config["status"] == "frozen_before_candidate_evaluation"
weights = ROOT / "upstream-ddc-onset" / "ddc_onset" / "weights"
weight_records = {}
for name, expected in config["model"]["weights"].items():
    data = (weights / name).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    assert len(data) == expected["bytes"] and digest == expected["sha256"]
    weight_records[name] = {"bytes": len(data), "sha256": digest}

zeros = np.zeros(SAMPLE_RATE * 2, dtype=np.float32)
impulse = zeros.copy()
impulse[SAMPLE_RATE // 2] = 1.0
zero_output = compute_onset_salience(zeros, SAMPLE_RATE)
impulse_output = compute_onset_salience(impulse, SAMPLE_RATE)
repeat_output = compute_onset_salience(impulse, SAMPLE_RATE)
# 上游前端在左侧补 512 samples，并按 441-sample hop 取帧；因此 2 秒输入产生 202 帧而非 200 帧。
expected_frames = (len(zeros) + 512 + 440) // 441
assert expected_frames == 202
for output in [zero_output, impulse_output, repeat_output]:
    assert output.shape == (expected_frames,)
    assert output.dtype == np.float32
    assert np.isfinite(output).all()
    assert float(output.min()) >= 0.0 and float(output.max()) <= 1.0
assert np.array_equal(impulse_output, repeat_output)
time_ms = np.arange(len(impulse_output), dtype=np.float64) * (1000.0 / FRAME_RATE)
np.testing.assert_allclose(np.diff(time_ms), 10.0, rtol=0, atol=1e-12)
result = {
    "version": "v560-ddc-onset-smoke-v1",
    "passed": True,
    "runtime": {"torch": torch.__version__, "device": "cpu", "cudaAvailable": torch.cuda.is_available()},
    "model": {"sourceCommit": config["model"]["sourceCommit"], "weights": weight_records},
    "output": {
        "shape": list(impulse_output.shape),
        "zeroMax": float(zero_output.max()),
        "impulseMin": float(impulse_output.min()),
        "impulseMax": float(impulse_output.max()),
        "deterministicBitwise": True,
        "frameHopMs": 10.0,
        "timeMapping": "frameIndex/100 seconds",
    },
}
(ROOT / "smoke-results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
print("V560_DDC_ONSET_SMOKE_PASSED")
