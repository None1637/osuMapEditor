// 验证器 v86: pattern 库 — 收藏/分类/缩略图/拖拽落盘/对齐选项
// 运行: cd app && node verifier/v86/check.mjs; node verifier/v86/cdp-v86.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v86/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v86/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('patternLibrary.ts: 纯函数与语义');
{
  const src = readSrc('src/osu/patternLibrary.ts');
  for (const fn of ['beatTimeAt', 'msAtBeat', 'pxPerBeatAt', 'svAt', 'makePattern', 'instantiatePattern', 'patternBeats',
    'loadPatterns', 'savePatterns', 'loadPatternGroups', 'savePatternGroups', 'newPatternId']) {
    assert(new RegExp(`export function ${fn}`).test(src), `导出 ${fn}`);
  }
  assert(/export const DEFAULT_GROUP = '未分类'/.test(src), '默认分类 = 未分类');
  assert(/beatOffset: beatTimeAt\(tps, o\.time\) - startBeat/.test(src), '时序按节拍记录');
  assert(/dx: o\.x - first\.x, dy: o\.y - first\.y/.test(src), '位置相对首物件');
  assert(/scale = \(po\.beatsLen \* pxPerBeatAt/.test(src), '缩放对齐 = 占拍数 * 目标 px\/beat');
  assert(/greenlines\.push\(mkGreen\(Math\.round\(startMs\), svNeeded\), mkGreen\(endMs, svAt\(tps, endMs\)\)\)/.test(src), '绿线开头对齐 + 结尾还原');
  assert(/const clampSv/.test(src), 'sv 钳制');
}

section('store.ts: pattern 状态与落盘');
{
  const src = readSrc('src/osu/store.ts');
  for (const m of ['addPatternFromSelection', 'deletePattern', 'renamePattern', 'movePattern', 'addPatternGroup',
    'renamePatternGroup', 'deletePatternGroup', 'allPatternGroups', 'startPatternDrag', 'cancelPatternDrag', 'dropPattern', 'setPatternAlign']) {
    assert(src.includes(m), `store.${m}`);
  }
  assert(/patternAlign: 'none' \| 'greenline' \| 'scale' = 'none'/.test(src), '对齐默认都不勾');
  assert(/p\.group = DEFAULT_GROUP/.test(src), '删除分类 => pattern 移未分类');
  assert(/t\.uninherited \|\| !times\.has\(t\.time\)/.test(src), '同时间点绿线替换');
  assert(/this\.pushUndo\(\)/.test(src), '落盘一次 undo');
}

section('PatternPanel.tsx + App.tsx + patternThumb.ts: UI');
{
  const panel = readSrc('src/components/PatternPanel.tsx');
  assert(/data-pattern-input="collect"/.test(panel), '收藏按钮');
  assert(/data-pattern-align=\{v\}/.test(panel) && /alignBox\('greenline'/.test(panel) && /alignBox\('scale'/.test(panel), '两个对齐勾选框');
  assert(/align === v \? 'none' : v/.test(panel), '勾选互斥 (再点取消)');
  assert(/data-pattern-group=\{gn\}/.test(panel), '分类标签 (拖拽落点)');
  assert(/onPointerDown[\s\S]{0,120}startPatternDrag/.test(panel), '缩略图 pointerdown 起拖');
  assert(/data-pattern-delete/.test(panel) && /onDoubleClick/.test(panel), '删除 + 双击重命名');
  const thumb = readSrc('src/components/patternThumb.ts');
  assert(/renderPlayfield/.test(thumb), '缩略图复用游玩区渲染');
  assert(/fillStyle = '#000'/.test(thumb), '黑底');
  const app = readSrc('src/App.tsx');
  assert(/data-pattern-input="panel-toggle"/.test(app), '工具栏按钮');
  assert(/store\.patternPanelOpen && <PatternPanel/.test(app), '面板挂载');
}

section('EditorCanvas.tsx: 拖拽幻影与落盘');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/import \{ instantiatePattern \} from '@\/osu\/patternLibrary'/.test(src), '引入 instantiatePattern');
  assert(/store\.patternDrag && cur\.inside/.test(src), '拖拽幻影渲染');
  assert(/store\.dropPattern\(snapPlacement\(p\) \?\? p, snapTime\(store\.currentTime\)\)/.test(src), '落盘 = 吸附位置 + 吸附节拍时间');
  assert(/data-pattern-group/.test(src), '分类标签上松开 = 移动分类');
  assert(/Escape.*patternDrag|patternDrag.*Escape/.test(src), 'Esc 取消拖拽');
}

if (failures) { console.error(`\nVERIFIER_V86_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V86_ALL_PASSED');
