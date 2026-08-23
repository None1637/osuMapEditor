// 验证器 v65: 批量复制 (次数/间隔拍/每份旋转角/每份平移向量, 锚点三模式)
// 运行: cd app && node verifier/v65/check.mjs; node verifier/v65/cdp-v65.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v65/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v65/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('duplicate.ts: 复制语义');
{
  const src = readSrc('src/osu/duplicate.ts');
  assert(/export function advanceByBeats/.test(src) && /rem -= avail; t = next\.time/.test(src), 'advanceByBeats 逐红线段换算 (跨 BPM 保拍位)');
  assert(/origin === 'playfield' \? \{ x: 256, y: 192 \}/.test(src) && /origin === 'selection' \? selectionCenter\(objs\)/.test(src), '锚点三模式 (与普通旋转相同)');
  assert(/p\.rotateDeg \* i \* Math\.PI/.test(src) && /p\.dx \* i, ty = p\.dy \* i/.test(src), '第 i 份 = i×角 / i×向量 (累积)');
  assert(/advanceByBeats\(bm\.timingPoints, o\.time, p\.intervalBeats \* i\)/.test(src), '时间 +i×间隔拍 (按各物件自身时间)');
  assert(/if \(o\.type !== 'spinner'\)/.test(src), '转盘位置固定 (transform.ts 同款规则)');
  assert(/return \{ \.\.\.pt, x: Math\.round\(q\.x\), y: Math\.round\(q\.y\) \}/.test(src), '滑条控制点变换保留红锚点标志');
}

section('DuplicateDialog.tsx: 参数窗口 + 实时预览 + 一次 undo');
{
  const src = readSrc('src/components/convert/DuplicateDialog.tsx');
  assert(/testid="count"/.test(src) && /testid="intervalBeats"/.test(src) && /testid="rotateDeg"/.test(src)
    && /testid="dx"/.test(src) && /testid="dy"/.test(src), '五个参数输入');
  // v166 适配: 批量复制锚点改用独立的 dupOriginMode/dupCustomOrigin, 不再复用左侧栏变换原点
  assert(/data-conv=\{`origin-\$\{m\}`\}/.test(src) && /store\.setDupOriginMode\(m\)/.test(src), '锚点三模式用独立 store.dupOriginMode (v166)');
  assert(/testid="originX"/.test(src) && /store\.setDupCustomOrigin/.test(src), '自定义锚点输入 (v166: 独立 dupCustomOrigin, 画布可拖拽)');
  // v116: 预览/应用绿线参数 timing -> allTiming (复制绿线 + 缩放补偿绿线合并)
  assert(/setConversionPreview\(result\.length \? \{ hideIds: \[\], objects: result(, timingPoints: allTiming)? \}/.test(src), '实时预览 (原物件保留)');
  assert(/saveParams\('duplicate', params\); store\.applyConversion\(\[\], result(, allTiming)?\)/.test(src), '应用 = 参数记忆 + applyConversion (一次 undo)');
}

section('接线: store/App/Inspector');
{
  const store = readSrc('src/osu/store.ts');
  assert(/'duplicate' \| null = null/.test(store), 'conversionDialog 含 duplicate');
  const app = readSrc('src/App.tsx');
  assert(/\{store\.conversionDialog === 'duplicate' && <DuplicateDialog \/>\}/.test(app), 'App 挂载 DuplicateDialog');
  const insp = readSrc('src/components/Inspector.tsx');
  assert((insp.match(/data-conv-open="duplicate"/g) || []).length === 2, 'Inspector 两分支均有 批量复制 按钮');
  assert(/disabled=\{!sel\.length\}/.test(insp), '未选中时禁用 (多选/未选分支)');
}

if (failures) { console.error(`\nVERIFIER_V65_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V65_ALL_PASSED');
