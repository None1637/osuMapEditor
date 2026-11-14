# v542: 从项目内冻结 PCM 生成人工确认短片段，不读取外部歌曲库、不改原音频。
import json
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
V541 = ROOT.parent / "v541"
OUT = ROOT / "review-clips"
OUT.mkdir(exist_ok=True)
REVIEWS = [
    {
        "id": "sample-032",
        "evidenceIndexes": [2],
        "question": "162.771 BPM 约为 108 的 1.5 倍，疑似三连音；是否听成真实速度提升？",
    },
    {
        "id": "sample-034",
        "evidenceIndexes": [0, 1],
        "question": "202.665 BPM 约为 135 的 1.5 倍，对象网格符合三连音；是否真实变速？",
    },
    {
        "id": "sample-088",
        "evidenceIndexes": [0, 1, 2],
        "question": "局部 63.645/99.864 对主 175 BPM，独立指标不一致；是否存在真实慢段？",
    },
]

manifest = []
for review in REVIEWS:
    sid = review["id"]
    decoded = V541 / "decoded" / sid
    meta = json.loads((decoded / "meta.json").read_text(encoding="utf-8"))
    analysis = json.loads((ROOT / "evidence-independent-v2" / f"{sid}.json").read_text(encoding="utf-8"))
    selected = [analysis["evidence"][index] for index in review["evidenceIndexes"]]
    evidence_start = min(item["startMs"] for item in selected)
    evidence_end = max(item["endMs"] for item in selected)
    start_ms = max(0, evidence_start - 4000)
    end_ms = min(meta["durationMs"], evidence_end + 4000)
    start = round(start_ms / 1000 * meta["sampleRate"])
    end = round(end_ms / 1000 * meta["sampleRate"])
    channels = [np.fromfile(decoded / f"ch{channel}.f32", dtype="<f4") for channel in range(meta["numberOfChannels"])]
    mono = np.mean(np.stack([channel[start:end] for channel in channels]), axis=0)
    pcm = (np.clip(mono, -1, 1) * 32767).astype("<i2")
    filename = f"{sid}_{start_ms / 1000:.3f}-{end_ms / 1000:.3f}.wav"
    with wave.open(str(OUT / filename), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(meta["sampleRate"])
        output.writeframes(pcm.tobytes())
    manifest.append({
        **review,
        "directoryName": analysis["directoryName"],
        "beatmapFile": analysis["beatmapFile"],
        "file": filename,
        "clipStartMs": start_ms,
        "clipEndMs": end_ms,
        "evidence": selected,
        "sampleRate": meta["sampleRate"],
        "frames": len(pcm),
        "peak": int(np.max(np.abs(pcm))),
    })
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(manifest, ensure_ascii=False, indent=2))
