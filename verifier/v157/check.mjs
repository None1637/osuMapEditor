// 验证器 v157: timing 窗口 All/红线/绿线页签 + 绿线多选批量编辑/批量删除
// 运行: node verifier/v157/check.mjs (纯源码断言, 无新增纯函数)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store.ts: 绿线多选支撑方法');
{
  const src = readSrc('src/osu/store.ts');
  assert(/toggleGreenLineSelected\(time: number\)/.test(src), 'toggleGreenLineSelected 存在');
  assert(/updateGreenLinesAt\(times: Iterable<number>, patch: Partial<TimingPoint>\)/.test(src), 'updateGreenLinesAt 存在');
  const blk = src.slice(src.indexOf('updateGreenLinesAt('), src.indexOf('updateGreenLinesAt(') + 600);
  assert(/pushUndo\(\)/.test(blk), '批量修改一次 undo');
  assert(/!tp\.uninherited && ts\.has\(tp\.time\)/.test(blk), '只改绿线 (uninherited=false)');
  assert(/deleteGreenLinesAt/.test(src), 'deleteGreenLinesAt (批量删除) 沿用');
}

section('TimingPanel.tsx: All/红线/绿线 页签');
{
  const src = readSrc('src/components/TimingPanel.tsx');
  assert(/data-tp-tabs/.test(src), '页签行 data-tp-tabs');
  for (const k of ['all', 'red', 'green']) {
    assert(new RegExp(`data-tp-tab=\\{k\\}|'${k}'`).test(src), `页签 ${k}`);
  }
  assert(/useState<'all' \| 'red' \| 'green'>\('all'\)/.test(src), 'filter state 默认 all');
  assert(/\.filter\(\(\{ tp \}\) => filter === 'all' \|\| \(filter === 'red'\) === tp\.uninherited\)/.test(src), '行渲染按页签过滤');
  assert(/\.map\(\(tp, i\) => \(\{ tp, i \}\)\)/.test(src), '过滤前绑定全局索引 i (updateTp/滚动定位不受影响)');
}

section('TimingPanel.tsx: 绿线行首勾选 + 批量编辑栏');
{
  const src = readSrc('src/components/TimingPanel.tsx');
  assert(/data-tp-select="green"/.test(src), '绿线行首 checkbox');
  assert(/store\.toggleGreenLineSelected\(tp\.time\)/.test(src), '勾选切换选中');
  assert(/store\.selectedGreenLines\.has\(tp\.time\)/.test(src), '与上时间轴药丸选区共享同一集合');
  assert(/data-tp-batch/.test(src), '批量编辑栏 data-tp-batch');
  assert(/已选 \{selGreens\.length\} 条绿线/.test(src), '显示已选数量');
  assert(/store\.updateGreenLinesAt\(selGreens\.map\(g => g\.time\), patch\)/.test(src), '修改即时应用到所有选中绿线');
  for (const f of ['sv', 'sampleSet', 'sampleIndex', 'volume', 'kiai']) {
    assert(new RegExp(`data-tp-batch-input="${f}"`).test(src), `批量字段 ${f}`);
  }
  assert(/data-tp-batch-delete/.test(src) && /store\.deleteGreenLinesAt\(selGreens/.test(src), '删除所选按钮');
}

console.log(failures ? `\nV157 FAILED: ${failures}` : '\nV157 ALL PASSED');
process.exit(failures ? 1 : 0);
