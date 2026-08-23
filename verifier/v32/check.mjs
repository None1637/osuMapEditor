// 验证器 v32: 时间轴物件拖拽改时间 (吸附节拍) + J/K 前移后移选中物件
// 运行: cd app && node verifier/v32/check.mjs; node verifier/v32/cdp-tl-drag.mjs (需 7100 dev server)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store.ts');
{
  const src = readSrc('src/osu/store.ts');
  assert(/nudgeSelected\(ms: number\)/.test(src), 'nudgeSelected (时间平移 + endTime 同步 + 排序 + undo)');
}

section('Timelines.tsx: 物件拖拽');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(src.includes('markerDragRef') && src.includes('snapMs'), 'markerDragRef + 节拍吸附 snapMs');
  assert(/store\.beginDrag\(\);[\s\S]*?store\.canvasDragging = true/.test(src), '拖拽开始: undo 快照 + 守卫标志');
  assert(/finishMarkerDrag[\s\S]*?store\.undo\(\)/.test(src), '未拖动 = 点击: 弹空快照 (v79 起不再 seek)');
  assert(/window\.addEventListener\('mouseup'/.test(src), 'window mouseup 兜底收尾');
}

section('App.tsx: J/K 快捷键');
{
  const src = readSrc('src/App.tsx');
  // v209: 吸附步长公式下沉 store.nudgeSelectedBySnap (编辑菜单 前移/后移 共用), App 只做路由
  assert(/k === 'j' \|\| k === 'k'[\s\S]*?nudgeSelectedBySnap\(k === 'j' \? -1 : 1\)/.test(src), 'J/K 路由到 store.nudgeSelectedBySnap');
  const store = readSrc('src/osu/store.ts');
  assert(/nudgeSelectedBySnap\(dir: -1 \| 1\)[\s\S]*?nudgeSelected\(Math\.round\(red\.beatLength \/ this\.beatSnap\) \* dir\)/.test(store), '吸附步长公式不变 (beatLength/beatSnap)');
}

if (failures) { console.error(`\nVERIFIER_V32_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V32_ALL_TESTS_PASSED');
