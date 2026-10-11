// 验证器 v394: 手动改过曲线类型的滑条不再强制切模式 (soulten: L/C 放红点、红点下放白点不强切贝塞尔)
// 运行: cd app && node verifier/v394/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v394/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v394/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('store.ts: manualCurveType 会话记录');
{
  const src = readSrc('src/osu/store.ts');
  assert(/manualCurveType = new Set<number>\(\)/.test(src), 'manualCurveType 集合字段');
  assert(/markManualCurveType\(id: number\)/.test(src), 'store.markManualCurveType');
  assert(/this\.manualCurveType\.clear\(\)/.test(src), '换谱清空 (load)');
}

section('Inspector.tsx: 下拉改型记录手动');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert(/markManualCurveType\(o\.id\); upd\(\{ curveType/.test(src), '曲线类型下拉改型 => 记录手动');
}

section('EditorCanvas.tsx: 节点编辑守卫');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/if \(!store\.manualCurveType\.has\(o\.id\)\) o\.curveType = resolveSliderCurveType/.test(src),
    'applySliderPoints: 手动改型的跳过 resolveSliderCurveType (不强切贝塞尔)');
  assert(/newPts\.length === 3 && !store\.manualCurveType\.has\(so\.id\)\) so\.curveType = 'P'/.test(src),
    'Ctrl 插点 L→P 升级同样跳过手动改型的滑条');
}

if (failures) { console.error(`V394 FAILED (${failures})`); process.exit(1); }
console.log('V394 ALL PASSED');
