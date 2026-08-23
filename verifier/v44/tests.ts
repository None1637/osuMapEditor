// 验证器 v44: 转换预览 combo 数字/颜色与转换应用后一致 纯函数测试
// 根因: 预览物件不在 bm.hitObjects 里, computeCombos(bm) 查不到 -> 时间轴全显示 1 + combo0 色;
//       游玩区第二趟 renderPlayfield 把预览当整张谱面 -> 数字从 1 重排, 不承接前文。
// 改法: mergedWithPreview 合并视图 (源隐藏 + 预览按时间并入), 渲染/时间轴/__osuComboAt 共用同一管线。
import { computeCombos, mergedWithPreview } from '../../src/osu/renderer';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const circle = (id: number, time: number, newCombo = false): HitObject =>
  ({ id, type: 'circle', x: 100, y: 100, time, hitSound: 0, newCombo, comboSkip: 0 });
const slider = (id: number, time: number, newCombo = false): HitObject => ({
  id, type: 'slider', x: 100, y: 100, time, hitSound: 0, newCombo, comboSkip: 0,
  curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200,
});

const bm = {
  hitObjects: [circle(1, 1000, true), circle(2, 1500), slider(3, 2000), circle(4, 4000, true)],
  colors: { combos: ['#ff0000', '#00ff00'] },
} as unknown as Beatmap;

// 预览: 滑条 (id 3) 转 5 圆 @2000..3000, 首圆 newCombo = 滑条 newCombo (非 nc 场景)
const preview = {
  hideIds: [3],
  objects: [0, 1, 2, 3, 4].map(i => circle(900 + i, 2000 + i * 250, i === 0 ? false : false)),
};

section('mergedWithPreview: 基本行为');
{
  assert(mergedWithPreview(bm, null) === bm, 'null 预览 -> 返回原 bm');
  assert(mergedWithPreview(bm, { hideIds: [], objects: [] }) === bm, '空预览 -> 返回原 bm');
  const v = mergedWithPreview(bm, preview);
  assert(v !== bm && v.hitObjects.length === 8, '合并后 4 - 1 + 5 = 8 个物件');
  assert(!v.hitObjects.some(o => o.id === 3), '源滑条 (id 3) 被隐藏');
  assert(v.hitObjects.every((o, i, a) => i === 0 || a[i - 1].time <= o.time), '合并列表按时间排序');
  assert(bm.hitObjects.length === 4, '原 bm 未被修改');
}

section('computeCombos(合并视图): 非 newCombo 滑条 -> 预览承接前文 combo');
{
  const m = computeCombos(mergedWithPreview(bm, preview));
  const first = m.get(900)!, last = m.get(904)!;
  assert(first.combo === 1 && first.index === 3, `预览首点承接前文: {combo:1, index:3} (v201 起 combo 1-based; 实际 ${JSON.stringify(first)})`);
  assert(last.combo === 1 && last.index === 7, `预览末点: {combo:1, index:7} (v201 1-based; 实际 ${JSON.stringify(last)})`);
  const after = m.get(4)!;
  assert(after.combo === 2 && after.index === 1, `后续物件不受影响: {combo:2, index:1} (v201 1-based; 实际 ${JSON.stringify(after)})`);
}

section('computeCombos(合并视图): newCombo 滑条 -> 预览开新 combo, 后续物件重编号');
{
  const bmNc = { ...bm, hitObjects: bm.hitObjects.map(o => o.id === 3 ? { ...o, newCombo: true } : o) } as Beatmap;
  const prevNc = { hideIds: [3], objects: preview.objects.map((o, i) => ({ ...o, newCombo: i === 0 })) };
  const m = computeCombos(mergedWithPreview(bmNc, prevNc));
  const first = m.get(900)!, last = m.get(904)!;
  assert(first.combo === 2 && first.index === 1, `预览首点开新 combo: {combo:2, index:1} (v201 1-based; 实际 ${JSON.stringify(first)})`);
  assert(last.combo === 2 && last.index === 5, `预览末点: {combo:2, index:5} (v201 1-based; 实际 ${JSON.stringify(last)})`);
  const after = m.get(4)!;
  assert(after.combo === 3 && after.index === 1, `后续物件重编号: {combo:3, index:1} (v201 1-based; 实际 ${JSON.stringify(after)})`);
}

section('与应用后一致: applyConversion 语义 = 隐藏源 + 插入结果 + 排序');
{
  // 模拟应用: 从原 bm 删 id 3, 插入 5 个预览圆 (应用后 id 重新分配, 但 newCombo/time 一致)
  const applied = {
    ...bm,
    hitObjects: bm.hitObjects.filter(o => o.id !== 3)
      .concat(preview.objects.map((o, i) => ({ ...o, id: 500 + i })))
      .sort((a, b) => a.time - b.time),
  } as Beatmap;
  const mApplied = computeCombos(applied);
  const mPrev = computeCombos(mergedWithPreview(bm, preview));
  // 同时间点物件的 combo/index 完全一致
  const byTime = (m: Map<number, { combo: number; comboWithOffset: number; index: number }>, objs: HitObject[]) =>
    objs.map(o => `${o.time}:${m.get(o.id)!.combo}:${m.get(o.id)!.index}`).join('|');
  assert(byTime(mApplied, applied.hitObjects) === byTime(mPrev, mergedWithPreview(bm, preview).hitObjects),
    '预览 combo 数字/颜色 == 应用后 combo 数字/颜色');
}

if (failures) { console.error(`\nTESTS_V44_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V44_ALL_PASSED');
