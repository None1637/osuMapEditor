// v540: 真实 fixture 读取与谱面红线基准；所有输入均已复制到当前项目。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AudioBufferLike } from '../../src/osu/waveformData';

export interface RealFixture {
  name: string;
  decodedDir: string;
  osuFile: string;
  annotatedBpm: number;
  annotatedVariable: boolean;
}

const root = __dirname;
export const realFixtures: RealFixture[] = [
  {
    name: 'Yoko',
    decodedDir: '(14) - Drop it! Yoko!',
    osuFile: 'fixtures/(14) - Drop it! Yoko!/a - Drop it! Yoko! (a) [14].osu',
    annotatedBpm: 60000 / 426.136,
    annotatedVariable: false,
  },
  {
    name: 'Turupeta',
    decodedDir: '09 Turupeta',
    osuFile: 'fixtures/09 Turupeta/Silver Forest - Turupeta (None1637) [Lunatic].osu',
    annotatedBpm: 180,
    annotatedVariable: false,
  },
  {
    name: 'Nare',
    decodedDir: '1041086 YURRY CANON - Dareka no Shinzou ni Nareta Nara',
    osuFile: 'fixtures/1041086 YURRY CANON - Dareka no Shinzou ni Nareta Nara/YURRY CANON - Dareka no Shinzou ni Nareta Nara (BinFhone) [Heart].osu',
    annotatedBpm: 60000 / 413.793103448276,
    annotatedVariable: false, // 仅谱面如此；旧独立 ACF 研究提示 outro 可能真实加速。
  },
  {
    name: 'Carnival',
    decodedDir: 't+pazolite - Kick-ass Kung-fu Carnival',
    osuFile: 'fixtures/t+pazolite - Kick-ass Kung-fu Carnival/t+pazolite - Kick-ass Kung-fu Carnival (None1637) [Extra].osu',
    annotatedBpm: 220,
    annotatedVariable: true,
  },
];

export function loadRealBuffer(fixture: RealFixture): AudioBufferLike {
  const dir = join(root, 'decoded', fixture.decodedDir);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { sampleRate: number; length: number; numberOfChannels: number };
  const channels = Array.from({ length: meta.numberOfChannels }, (_, ch) => {
    const raw = readFileSync(join(dir, `ch${ch}.f32`));
    return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  });
  return {
    sampleRate: meta.sampleRate,
    length: meta.length,
    numberOfChannels: meta.numberOfChannels,
    getChannelData: ch => channels[ch],
  };
}

export interface RedLine { time: number; beatLength: number }

export function readRedLines(fixture: RealFixture): RedLine[] {
  const text = readFileSync(join(root, fixture.osuFile), 'utf8');
  const section = text.split('[TimingPoints]')[1]?.split('[')[0] ?? '';
  const lines: RedLine[] = [];
  for (const row of section.split(/\r?\n/)) {
    const fields = row.trim().split(',');
    if (fields.length >= 8 && Number(fields[6]) === 1 && Number(fields[1]) > 0) {
      lines.push({ time: Number(fields[0]), beatLength: Number(fields[1]) });
    }
  }
  return lines;
}

export function referenceGridError(lines: RedLine[], durationMs: number, bpm: number, offset: number): { medianMs: number; within15Ms: number; count: number } {
  const errors: number[] = [];
  const period = 60000 / bpm;
  for (let i = 0; i < lines.length; i++) {
    const end = i + 1 < lines.length ? lines[i + 1].time : durationMs;
    for (let t = lines[i].time; t < end; t += lines[i].beatLength / 2) {
      errors.push(Math.abs(t - offset - Math.round((t - offset) / (period / 2)) * (period / 2)));
    }
  }
  errors.sort((a, b) => a - b);
  return {
    medianMs: errors.length ? +errors[Math.floor(errors.length / 2)].toFixed(3) : NaN,
    within15Ms: errors.length ? +(errors.filter(e => e <= 15).length / errors.length).toFixed(4) : 0,
    count: errors.length,
  };
}
