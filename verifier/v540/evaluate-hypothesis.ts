// v540: 评估“倍程归一 + 连续局部周期证据”假设。
import { detectBpmHypothesis } from '../../src/osu/bpmResearch';
import { loadRealBuffer, readRedLines, realFixtures, referenceGridError } from './realFixtures';

const only = process.argv[2];
for (const fixture of realFixtures) {
  if (only && only !== fixture.name) continue;
  const started = Date.now();
  const buf = loadRealBuffer(fixture);
  const result = detectBpmHypothesis(buf);
  if (!result) { console.log(JSON.stringify({ name: fixture.name, empty: true })); continue; }
  const durationMs = buf.length / buf.sampleRate * 1000;
  console.log(JSON.stringify({
    name: fixture.name,
    annotatedBpm: +fixture.annotatedBpm.toFixed(4),
    annotatedVariable: fixture.annotatedVariable,
    bpm: result.bpm,
    errorPct: +((result.bpm / fixture.annotatedBpm - 1) * 100).toFixed(3),
    variable: result.variable,
    evidence: result.evidence,
    localPoints: result.local.length,
    referenceGrid: referenceGridError(readRedLines(fixture), durationMs, result.bpm, result.offsetMs),
    elapsedMs: Date.now() - started,
  }));
  const diagnostic = result.local.filter((_, i) => i % 5 === 0 || result.evidence.some(e => result.local[i].timeMs >= e.startMs && result.local[i].timeMs <= e.endMs));
  console.log(JSON.stringify({ name: fixture.name, local: diagnostic }));
}
