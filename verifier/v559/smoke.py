from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor"))

import numpy as np
import onnxruntime as ort

MODEL = ROOT / "third_party" / "basic-pitch" / "nmp.onnx"
model_bytes = MODEL.read_bytes()
assert len(model_bytes) == 230444
session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
inputs = [{"name": item.name, "shape": item.shape, "type": item.type} for item in session.get_inputs()]
outputs = [{"name": item.name, "shape": item.shape, "type": item.type} for item in session.get_outputs()]
assert len(inputs) == 1
assert inputs[0]["name"] == "serving_default_input_2:0"
assert inputs[0]["shape"][1:] == [43844, 1]
assert inputs[0]["type"] == "tensor(float)"
output_names = ["StatefulPartitionedCall:1", "StatefulPartitionedCall:2", "StatefulPartitionedCall:0"]
assert {item["name"] for item in outputs} == set(output_names)


def predict(audio: np.ndarray) -> dict[str, np.ndarray]:
    values = session.run(output_names, {"serving_default_input_2:0": audio})
    return dict(zip(["note", "onset", "contour"], values))


zeros = np.zeros((1, 43844, 1), dtype=np.float32)
impulse = zeros.copy()
impulse[0, 10000, 0] = 1.0
zero_output = predict(zeros)
impulse_output = predict(impulse)
repeat_output = predict(impulse)
expected_shapes = {"note": (1, 172, 88), "onset": (1, 172, 88), "contour": (1, 172, 264)}
summary = {}
for name, expected_shape in expected_shapes.items():
    value = impulse_output[name]
    assert value.shape == expected_shape
    assert np.isfinite(value).all()
    assert np.array_equal(value, repeat_output[name])
    assert float(value.min()) >= 0.0 and float(value.max()) <= 1.0
    summary[name] = {
        "shape": list(value.shape),
        "impulseMin": float(value.min()),
        "impulseMax": float(value.max()),
        "zeroMax": float(zero_output[name].max()),
        "deterministicBitwise": True,
    }

result = {
    "version": "v559-basic-pitch-smoke-v1",
    "passed": True,
    "runtime": {"onnxruntime": ort.__version__, "providers": session.get_providers()},
    "model": {
        "bytes": len(model_bytes),
        "sha256": hashlib.sha256(model_bytes).hexdigest(),
        "inputs": inputs,
        "outputs": outputs,
    },
    "tensors": summary,
}
(ROOT / "smoke-results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
print("V559_BASIC_PITCH_SMOKE_PASSED")
