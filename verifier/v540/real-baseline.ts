// v540: 真实歌曲旧算法基线，严格输出 BPM 数值、唯一线、变速标记与谱面网格残差。
import { detectBpm, extractConstantTempo } from '../../src/osu/bpmDetect';
import { loadRealBuffer, readRedLines, realFixtures, referenceGridError } from './realFixtures';

const only = process.argv[2];
for (const fixture of realFixtures) {
  if (only && only !== fixture.name) continue;
  const started = Date.now();
  const buf = loadRealBuffer(fixture);
  const result = detectBpm(buf);
  const constant = extractConstantTempo(result);
  const reds = readRedLines(fixture);
  const durationMs = buf.length / buf.sampleRate * 1000;
  console.log(JSON.stringify({
    name: fixture.name,
    annotatedBpm: +fixture.annotatedBpm.toFixed(4),
    annotatedRedLines: reds.length,
    bpm: constant?.bpm,
    errorPct: constant ? +((constant.bpm / fixture.annotatedBpm - 1) * 100).toFixed(3) : null,
    offsetMs: constant?.offsetMs,
    lines: constant?.lines.length,
    variableSections: constant?.variableSections,
    rawSegments: result.segments.length,
    beats: result.beats.length,
    coverage: constant?.coverage,
    referenceGrid: constant ? referenceGridError(reds, durationMs, constant.bpm, constant.offsetMs) : null,
    elapsedMs: Date.now() - started,
  }));
}
