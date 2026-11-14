// v540: 真实 fixture 验收 — BPM/变速分类与 MP3 时间基准分开断言。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectBpmHypothesis } from '../../src/osu/bpmResearch';
import { loadRealBuffer, readRedLines, realFixtures, referenceGridError, type RealFixture } from './realFixtures';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (!condition) { failures++; console.error('FAIL:', message); }
  else console.log('ok:', message);
}
function fixtureDelayMs(fixture: RealFixture): number {
  const meta = JSON.parse(readFileSync(join(__dirname, 'decoded', fixture.decodedDir, 'meta.json'), 'utf8')) as { source: string };
  const head = readFileSync(meta.source).subarray(0, 4096);
  return ['Xing', 'Info', 'VBRI'].some(marker => head.includes(Buffer.from(marker, 'ascii'))) ? 25 : 0;
}

for (const fixture of realFixtures) {
  const result = detectBpmHypothesis(loadRealBuffer(fixture));
  assert(!!result, `${fixture.name}: 结果非空`);
  if (!result) continue;
  const bpmError = Math.abs(result.bpm - fixture.annotatedBpm) / fixture.annotatedBpm;
  assert(bpmError <= 0.002, `${fixture.name}: 主 BPM=${result.bpm}，标注=${fixture.annotatedBpm.toFixed(4)}`);
  const acousticVariable = fixture.name === 'Nare' || fixture.name === 'Carnival';
  assert(result.variable === acousticVariable, `${fixture.name}: variable=${result.variable}，声学期望=${acousticVariable}`);
  if (acousticVariable) assert(result.evidence.length > 0, `${fixture.name}: 有局部变速证据`);

  // 只检查主恒速区；Nare outro 与 Carnival 187s 后不能用一条线验收。
  const durationMs = fixture.name === 'Nare' ? 200000 : fixture.name === 'Carnival' ? 187000 : loadRealBuffer(fixture).length / 11025 * 1000;
  const reds = readRedLines(fixture).filter((_, i) => fixture.name !== 'Carnival' || i < 2);
  const delayMs = fixtureDelayMs(fixture);
  const grid = referenceGridError(reds, durationMs, result.bpm, result.offsetMs - delayMs);
  assert(grid.within15Ms >= 0.99, `${fixture.name}: 主恒速区网格=${(grid.within15Ms * 100).toFixed(1)}%，解码补偿=${delayMs}ms`);
  console.log(JSON.stringify({ name: fixture.name, bpm: result.bpm, variable: result.variable, evidence: result.evidence, delayMs, grid }));
}

console.log(failures ? `V540_REAL_FAILED: ${failures}` : 'V540_REAL_PASSED');
process.exit(failures ? 1 : 0);
