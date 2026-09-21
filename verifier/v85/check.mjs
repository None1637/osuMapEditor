// 验证器 v85: 按钮弹窗居中 — DraggableDialog 打开时按实测宽高居中一次, 拖拽后不复位
// 运行: cd app && node verifier/v85/check.mjs; node verifier/v85/cdp-v85.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v85/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v85/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('DraggableDialog.tsx: 初始居中');
{
  const src = readSrc('src/components/DraggableDialog.tsx');
  assert(/export function dialogCenterPos\(vw: number, vh: number, w: number, h: number\)/.test(src), '导出 dialogCenterPos 纯函数');
  assert(/Math\.max\(0, Math\.round\(\(vw - w\) \/ 2\)\)/.test(src), '水平居中 + 钳 0');
  assert(/Math\.max\(0, Math\.round\(\(vh - h\) \/ 2\)\)/.test(src), '垂直居中 + 钳 0');
  assert(/useLayoutEffect/.test(src) && /pos === null/.test(src), '挂载后实测宽高居中一次 (pos===null 才执行)');
  assert(/left: pos \? pos\.x \/ fit : -9999/.test(src), '测量前藏在屏外 (避免闪烁); v249: 视觉px定位 (left = pos/fit, 反缩放后 视觉=布局×fit)');
  assert(!/useState\(\{ x: 120, y: 100 \}\)/.test(src), '不再有固定 (120,100) 落点');
}

section('覆盖面: 所有按钮小窗都走 DraggableDialog');
{
  const users = ['convert/DuplicateDialog.tsx', 'convert/PolygonDialog.tsx', // v141: CurveDialog 已废弃
    'convert/SplitDialog.tsx', 'convert/StreamDialog.tsx', 'GeoSnapPanel.tsx', 'TimingPointDialog.tsx'];
  for (const u of users) {
    assert(/DraggableDialog/.test(readSrc('src/components/' + u)), `${u} 使用 DraggableDialog`);
  }
  // 全屏遮罩类窗口 (曲库/皮肤/向导) 本就 flex 居中
  for (const u of ['SongLibrary.tsx', 'SkinPicker.tsx', 'SkinListPanel.tsx', 'FirstRunWizard.tsx']) {
    assert(/flex items-center justify-center/.test(readSrc('src/components/' + u)), `${u} 全屏遮罩居中`);
  }
}

if (failures) { console.error(`\nVERIFIER_V85_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V85_ALL_PASSED');
