// 验证器 v163: 左侧栏"限制物件在游玩区域内"开关 (默认开=旧行为; 关闭后可拖动/放置物件到游玩区外)
// 运行: node verifier/v163/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v163/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v163/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V163_TESTS_*)
fs.unlinkSync(out);

section('store.ts: limitToPlayfield 状态');
{
  const src = readSrc('src/osu/store.ts');
  assert(/limitToPlayfield = true;/.test(src), '默认 true (= 旧行为)');
  assert(/setLimitToPlayfield\(b: boolean\) \{ this\.limitToPlayfield = b; this\.emitSelection\(\); \}/.test(src), 'setLimitToPlayfield + 刷新');
}

section('gridSnap.ts: snapToGrid 可选 clampToPlayfield (默认 true 保持旧行为)');
{
  const src = readSrc('src/osu/gridSnap.ts');
  assert(/clampToPlayfield = true\): Pt/.test(src), '第 6 参可选, 默认 true');
  assert(/return clampToPlayfield \? \{ x: Math\.max\(0, Math\.min\(PW, r\.x\)\), y: Math\.max\(0, Math\.min\(PH, r\.y\)\) \} : r;/.test(src), 'false 时跳过钳制');
}

section('EditorCanvas.tsx: 四处接线');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/store\.gridRotation, store\.limitToPlayfield\)/.test(src), 'gridSnapAt 传开关 (网格吸附随之放开)');
  assert(/return gridSnapAt\(bm, store\.limitToPlayfield \? \{/.test(src), '放置锁定间距分支: 关闭后不钳制');
  assert(/const ax = \(store\.limitToPlayfield \? Math\.max\(0, Math\.min\(PW, orig\.x \+ dx\)\) : orig\.x \+ dx\) - orig\.x;/.test(src), '拖动钳制 x 随开关');
  assert(/const ay = \(store\.limitToPlayfield \? Math\.max\(0, Math\.min\(PH, orig\.y \+ dy\)\) : orig\.y \+ dy\) - orig\.y;/.test(src), '拖动钳制 y 随开关');
  assert(/cursorRef\.current\.inside \|\| !store\.limitToPlayfield\)/.test(src), '放置预览: 关闭限制后区外也显示');
}

section('App.tsx: 左侧栏开关 (网格中心下方)');
{
  const src = readSrc('src/App.tsx');
  assert(/data-grid-input="limit-playfield"/.test(src), '开关按钮存在');
  assert(/store\.setLimitToPlayfield\(!store\.limitToPlayfield\)/.test(src), '点击切换');
  assert(src.indexOf('data-grid-input="origin-toggle"') > -1
    && src.indexOf('data-grid-input="origin-toggle"') < src.indexOf('data-grid-input="limit-playfield"'),
    '位于"网格中心"按钮下方');
  assert(src.indexOf('data-grid-input="limit-playfield"') < src.indexOf('setGeoEnabled(!store.geoEnabled)'),
    '位于辅助线分隔线/按钮上方');
}

console.log(failures ? `\nV163 FAILED: ${failures}` : '\nV163 ALL PASSED');
process.exit(failures ? 1 : 0);
