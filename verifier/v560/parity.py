# v560: 用上游短音频 fixture 复现特征、五档分数和精确峰数；不读取歌曲候选或标注。
from pathlib import Path
import json
import pickle
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor"))
sys.path.insert(0, str(ROOT / "upstream-ddc-onset"))

import numpy as np
import torch
from ddc_onset.cnn import PlacementCNN, SpectrogramNormalizer
from ddc_onset.constants import DIFFICULTY_TO_THRESHOLD, Difficulty, FRAME_RATE
from ddc_onset.spectral import SpectrogramExtractor
from ddc_onset.util import find_peaks, threshold_peaks

config = json.loads((ROOT / "experiment.json").read_text(encoding="utf-8"))
fixtures = ROOT / "upstream-ddc-onset" / "test"
audio = np.load(fixtures / "short_essentia_audio_ref.npy").astype(np.float32, copy=False)
expected_features = np.load(fixtures / "short_essentia_feats_ref.npy").astype(np.float32, copy=False)
with open(fixtures / "short_essentia_feats_ref_ddc_placement_scores.pkl", "rb") as handle:
    expected_by_difficulty = pickle.load(handle, encoding="latin1")
expected_scores = np.asarray([expected_by_difficulty[item.value] for item in Difficulty])

extractor = SpectrogramExtractor().eval()
normalizer = SpectrogramNormalizer().eval()
placement = PlacementCNN().eval()
with torch.no_grad():
    actual_features = extractor(torch.from_numpy(audio).view(1, -1))[0].numpy()
assert actual_features.shape[0] >= expected_features.shape[0]
actual_features = actual_features[:expected_features.shape[0]]
assert actual_features.shape == expected_features.shape
feature_difference = np.abs(actual_features - expected_features)
feature_mean = float(feature_difference.mean())
feature_max = float(feature_difference.max())
assert feature_mean < config["officialParityGate"]["featureMeanAbsoluteToleranceFromOfficialTest"]

score_checks = []
for chunk_size in config["officialParityGate"]["chunkSizes"]:
    with torch.no_grad():
        normalized = normalizer(torch.from_numpy(actual_features))
        difficulties = torch.tensor([item.value for item in Difficulty], dtype=torch.int64)
        actual_scores = placement(normalized, difficulties, conv_chunk_size=chunk_size, dense_chunk_size=chunk_size).numpy()
    assert actual_scores.shape == expected_scores.shape
    score_sum = float(np.abs(actual_scores - expected_scores).sum())
    score_max = float(np.abs(actual_scores - expected_scores).max())
    assert score_sum < config["officialParityGate"]["scoreSumAbsoluteToleranceFromOfficialTest"]
    counts = []
    for difficulty in Difficulty:
        peaks = find_peaks(actual_scores[difficulty.value])
        above = threshold_peaks(actual_scores[difficulty.value], peaks, DIFFICULTY_TO_THRESHOLD[difficulty])
        counts.append([len(peaks), len(above)])
    assert counts[Difficulty.CHALLENGE.value] == config["officialParityGate"]["requiredExactPeakCountsChallenge"]
    score_checks.append({"chunkSize": chunk_size, "scoreSumAbsoluteDifference": score_sum,
                         "scoreMaxAbsoluteDifference": score_max, "peakAndAboveThresholdCounts": counts})

frame_ms = np.arange(expected_scores.shape[1], dtype=np.float64) * (1000.0 / FRAME_RATE)
np.testing.assert_allclose(np.diff(frame_ms), 10.0, rtol=0, atol=1e-12)
result = {
    "version": "v560-ddc-onset-official-parity-v1",
    "passed": True,
    "fixtureSamples": len(audio),
    "featureFrames": len(actual_features),
    "scoreFrames": expected_scores.shape[1],
    "featureComparison": {"meanAbsoluteDifference": feature_mean, "maxAbsoluteDifference": feature_max},
    "scoreChecks": score_checks,
    "timeMapping": "frame i = i/100 seconds; no legacy spectral-flux bias",
}
(ROOT / "parity-results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
print("V560_OFFICIAL_PARITY_AND_TIME_MAPPING_PASSED")
