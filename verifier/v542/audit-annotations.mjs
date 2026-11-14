// v542: 只读 v541 冻结副本，用同歌曲其他难度交叉检查“恒速但报变速”的谱面标注。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const v541 = path.resolve(root, '../v541');
const results = fs.readFileSync(path.join(v541, 'results.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const cohort = results.filter(record => record.referenceVariable === false && record.prediction?.variable);

function audioFilename(text) {
  return text.match(/^\s*AudioFilename\s*:\s*(.*?)\s*$/mi)?.[1]?.trim() ?? '';
}
function redLines(text, durationMs) {
  const section = text.split('[TimingPoints]')[1]?.split('[')[0] ?? '';
  const lines = [];
  for (const row of section.split(/\r?\n/)) {
    const fields = row.trim().split(',');
    if (fields.length < 2) continue;
    const time = Number(fields[0]);
    const beatLength = Number(fields[1]);
    const uninherited = fields.length < 7 || Number(fields[6]) === 1;
    if (uninherited && Number.isFinite(time) && Number.isFinite(beatLength) && beatLength > 0) {
      lines.push({ time, beatLength, bpm: 60000 / beatLength });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines.map((line, index) => ({
    ...line,
    endMs: index + 1 < lines.length ? lines[index + 1].time : durationMs,
  }));
}
function normalize(bpm) {
  let value = bpm;
  while (value > 240) value /= 2;
  while (value < 60) value *= 2;
  return value;
}
function dominant(lines) {
  const coverage = new Map();
  for (let i = 0; i < lines.length; i++) {
    const duration = Math.max(0, lines[i].endMs - Math.max(0, lines[i].time));
    coverage.set(lines[i].bpm, (coverage.get(lines[i].bpm) ?? 0) + duration);
  }
  return [...coverage.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const audit = cohort.map(record => {
  const directory = path.join(v541, 'samples', record.id);
  const selectedText = fs.readFileSync(path.join(directory, record.beatmapFile), 'utf8');
  const selectedAudio = audioFilename(selectedText);
  const maps = fs.readdirSync(directory).filter(name => name.toLowerCase().endsWith('.osu')).sort().flatMap(name => {
    const text = fs.readFileSync(path.join(directory, name), 'utf8');
    if (audioFilename(text).toLowerCase() !== selectedAudio.toLowerCase()) return [];
    const lines = redLines(text, record.audioDurationMs);
    const main = dominant(lines);
    return [{
      name,
      selected: name === record.beatmapFile,
      redLineCount: lines.length,
      dominantBpm: main,
      variable: main !== null && lines.some(line => Math.abs(line.bpm / main - 1) > 0.02),
      lines,
    }];
  });
  const otherMaps = maps.filter(map => !map.selected);
  const evidence = record.prediction.evidence.map(item => {
    const matches = [];
    for (const map of otherMaps) {
      for (const line of map.lines) {
        const overlap = Math.max(0, Math.min(item.endMs, line.endMs) - Math.max(item.startMs, line.time));
        const samePrimary = map.dominantBpm !== null && Math.abs(map.dominantBpm / record.selectedBpm - 1) <= 0.01;
        const nonPrimaryLine = map.dominantBpm !== null && Math.abs(line.bpm / map.dominantBpm - 1) > 0.02;
        if (map.variable && samePrimary && nonPrimaryLine && overlap > 0
          && Math.abs(Math.log(normalize(line.bpm) / item.bpm)) <= Math.log(1.05)) {
          matches.push({ map: map.name, time: line.time, bpm: line.bpm, overlapMs: overlap });
        }
      }
    }
    return { ...item, siblingMatches: matches };
  });
  const matchedMaps = [...new Set(evidence.flatMap(item => item.siblingMatches.map(match => match.map)))];
  return {
    id: record.id,
    directoryName: record.directoryName,
    selectedBeatmap: record.beatmapFile,
    selectedBpm: record.referenceBpm,
    predictedBpm: record.prediction.bpm,
    sameAudioMapCount: maps.length,
    otherVariableMaps: otherMaps.filter(map => map.variable).map(map => ({ name: map.name, dominantBpm: map.dominantBpm, redLineCount: map.redLineCount })),
    matchedMaps,
    evidence,
    maps: maps.map(({ lines, ...map }) => map),
  };
});

fs.writeFileSync(path.join(root, 'annotation-audit.json'), JSON.stringify(audit, null, 2));
const summary = {
  cohort: audit.length,
  withOtherVariableMap: audit.filter(item => item.otherVariableMaps.length).length,
  withEvidenceMatchedMap: audit.filter(item => item.matchedMaps.length).length,
  singleDifficulty: audit.filter(item => item.sameAudioMapCount === 1).length,
  matched: audit.filter(item => item.matchedMaps.length).map(item => ({ id: item.id, directoryName: item.directoryName, matchedMaps: item.matchedMaps })),
  otherVariable: audit.filter(item => item.otherVariableMaps.length && !item.matchedMaps.length).map(item => ({ id: item.id, directoryName: item.directoryName, maps: item.otherVariableMaps })),
};
fs.writeFileSync(path.join(root, 'annotation-audit-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
