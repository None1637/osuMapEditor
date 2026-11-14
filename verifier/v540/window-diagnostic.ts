// v540: 绕开 DP 跟拍，直接观察全局/局部 onset ACF 候选，定位变速信息在哪一层丢失。
import { acfCandidates, mixDownResample, onsetEnvelope } from '../../src/osu/bpmDetect';
import type { AudioBufferLike } from '../../src/osu/waveformData';
import { loadRealBuffer, realFixtures } from './realFixtures';

const times: Record<string, number[]> = {
  Yoko: [10, 40, 80, 120],
  Turupeta: [10, 40, 80, 120, 150],
  Nare: [10, 60, 120, 180, 205, 210, 215, 220],
  Carnival: [10, 60, 120, 180, 186, 188, 190, 192, 194, 196, 198, 200, 204, 208, 212, 216, 220, 224, 230, 250, 280],
};
const fold = (bpm: number) => {
  while (bpm > 240) bpm /= 2;
  while (bpm < 60) bpm *= 2;
  return bpm;
};
const monoAt = (buf: AudioBufferLike, ch: number): AudioBufferLike => ({
  sampleRate: buf.sampleRate,
  numberOfChannels: 1,
  length: buf.length,
  getChannelData: () => buf.getChannelData(ch),
});

for (const fixture of realFixtures) {
  if (process.argv[2] && process.argv[2] !== fixture.name) continue;
  const buf = loadRealBuffer(fixture);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const { env, hopMs } = onsetEnvelope(mixDownResample(monoAt(buf, ch)), 11025);
    const minLag = Math.max(2, Math.round(60000 / 440 / hopMs));
    const maxLag = Math.ceil(60000 / 60 / hopMs) + 1;
    const candidates = (segment: Float32Array) => acfCandidates(segment, minLag, Math.min(maxLag, (segment.length >> 1) - 2)).map(c => ({
      bpm: +(60000 / c.lag / hopMs).toFixed(2),
      folded: +fold(60000 / c.lag / hopMs).toFixed(2),
      score: +c.adj.toFixed(4),
    }));
    console.log(JSON.stringify({ name: fixture.name, ch, scope: 'global', candidates: candidates(env) }));
    for (const time of times[fixture.name]) {
      const center = Math.round(time * 1000 / hopMs);
      const half = Math.round(2000 / hopMs);
      const segment = env.subarray(Math.max(0, center - half), Math.min(env.length, center + half));
      console.log(JSON.stringify({ name: fixture.name, ch, scope: 'window', time, candidates: candidates(segment) }));
    }
  }
}
