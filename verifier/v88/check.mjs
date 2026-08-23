// 验证器 v88: 辅助点/线显示范围 — 面板两个互斥勾选项 (all / 选中+上次选中)
// 运行: cd app && node verifier/v88/check.mjs; node verifier/v88/cdp-v88.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v88/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v88/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('geometryHelpers.ts: geoHelperSources 纯函数');
{
  const src = readSrc('src/osu/geometryHelpers.ts');
  assert(/export function geoHelperSources/.test(src), '导出 geoHelperSources');
  assert(/scope === 'all'\) return objects\.filter\(o => o\.type === 'slider' && visible\(o\)\)/.test(src), 'all => 可见滑条');
  assert(/selected\.has\(o\.id\) \|\| prevIds\.has\(o\.id\)/.test(src), 'selection => 选中 ∪ 上次选中');
}

section('store.ts: geoScope + 上次选择集跟踪');
{
  const src = readSrc('src/osu/store.ts');
  assert(/geoScope: 'all' \| 'selection'( \| 'none')? = 'selection'/.test(src), 'geoScope 默认 selection');
  assert(/setGeoScope\(s: 'all' \| 'selection'( \| 'none')?\)/.test(src), 'setGeoScope');
  assert(/prevGeoIds = new Set<number>\(\)/.test(src), 'prevGeoIds');
  const remembers = (src.match(/rememberGeoSelection\(\)/g) ?? []).length;
  assert(remembers >= 4, `select/toggleSelect/clearSelection 都跟踪 (实际 ${remembers} 处含定义)`);
}

section('EditorCanvas.tsx: 渲染与吸附共用来源');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const geoSourceSliders = \(bm: Beatmap\)/.test(src), 'geoSourceSliders 定义');
  const n = (src.match(/geoSourceSliders\(bm\)/g) ?? []).length;
  assert(n === 2, `吸附 + 渲染共用 (实际 ${n})`);
  assert(/geoHelperSources\(store\.geoScope/.test(src), '委托纯函数');
}

section('GeoSnapPanel.tsx: 两个互斥勾选项');
{
  const panel = readSrc('src/components/GeoSnapPanel.tsx');
  assert(/data-geo-scope=\{o\.v\}/.test(panel), '范围勾选 testid');
  assert(/v: 'all' as const/.test(panel) && /v: 'selection' as const/.test(panel), '两个选项');
  assert(/checked=\{store\.geoScope === o\.v\}/.test(panel) && /setGeoScope\(o\.v\)/.test(panel), '互斥 (一个必开)');
}

if (failures) { console.error(`\nVERIFIER_V88_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V88_ALL_PASSED');
