// v521: 新建空谱面 — 参考 lazer BeatmapManager.CreateNew / Editor Song Setup 流程
import { parseOsu, type Beatmap } from './parser';
import { serverDir } from './serverFs';
import type { MapSource } from './saveMap';

/** lazer 默认值: 空 metadata/物件、PreviewTime=-1、全难度 5; 本编辑器补一条 60 BPM 红线便于直接作图 */
export function createEmptyBeatmap(): Beatmap {
  const bm = parseOsu('');
  bm.difficulty = { hp: 5, cs: 5, od: 5, ar: 5, sliderMultiplier: 1.4, sliderTickRate: 1 };
  bm.general.previewTime = -1;
  bm.timingPoints = [{ time: 0, beatLength: 1000, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 }];
  return bm;
}

/** 每次新建使用独立目录, 首次 Ctrl+S 不覆盖任何已有谱面; now 可注入便于验证 */
export function createNewBeatmapSource(now = Date.now()): MapSource {
  const folder = `New Beatmap-${now}`;
  return { dir: serverDir('songs', folder, folder), fileName: 'New Beatmap.osu' };
}
