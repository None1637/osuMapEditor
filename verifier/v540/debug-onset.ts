// v540: 诊断 onset/ACF 数据路径，不作为算法验收。
import { acfCandidates, detectBpm, extractConstantTempo, mixDownResample, onsetEnvelope, tempoCurve, tempoPrior, trackScore } from '../../src/osu/bpmDetect';
import { loadRealBuffer, realFixtures } from './realFixtures';

const fixture = realFixtures.find(f => f.name === (process.argv[2] ?? 'Carnival'))!;
const buf = loadRealBuffer(fixture);
for (let ch = 0; ch < buf.numberOfChannels; ch++) {
  const mono = { sampleRate: buf.sampleRate, numberOfChannels: 1, length: buf.length, getChannelData: () => buf.getChannelData(ch) };
  const pcm = mixDownResample(mono);
  let pcmMin = Infinity, pcmMax = -Infinity;
  for (const x of pcm) { pcmMin = Math.min(pcmMin, x); pcmMax = Math.max(pcmMax, x); }
  const { env, hopMs } = onsetEnvelope(pcm, 11025);
  let max = 0, sum = 0, nonzero = 0;
  for (const x of env) { max = Math.max(max, x); sum += x; if (x > 0) nonzero++; }
  const minLag = Math.max(2, Math.round(60000 / 440 / hopMs));
  const maxLag = Math.ceil(60000 / 60 / hopMs) + 1;
  const center = Math.round(60000 / hopMs), half = Math.round(2000 / hopMs);
  const seg = env.subarray(center - half, center + half);
  const old = extractConstantTempo(detectBpm(mono));
  const curve = tempoCurve(env, hopMs);
  console.log(JSON.stringify({ ch, pcmMin, pcmMax, envMax: max, envMean: sum / env.length, nonzero, minLag, maxLag, segLength: seg.length,
    candidates: acfCandidates(seg, minLag, maxLag), score47: trackScore(seg, 47), prior: tempoPrior(env, hopMs), curveAt60: curve(center), old }));
}
