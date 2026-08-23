// v140: 脏标记内容指纹 (纯函数, 可单测) — 与 store.snapshot() 同六段谱面数据;
// 选择集/播放时间/皮肤等非谱面数据不参与, 撤销回保存态或无实际改动时指纹不变 → 不显示未保存
import type { Beatmap } from './parser';

/** 谱面内容指纹: 六段数据 (hitObjects/timingPoints/difficulty/editor/general/metadata) 的 JSON 序列化 */
export function dirtyFingerprint(bm: Beatmap): string {
  return JSON.stringify([bm.hitObjects, bm.timingPoints, bm.difficulty, bm.editor, bm.general, bm.metadata]);
}
