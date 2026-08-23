// 验证器 v90: 辅助线显示/隐藏改工具栏按钮切换 (none 勾选项撤销), 面板移至「辅助线配置」按钮
// 运行: cd app && node verifier/v90/check.mjs; node verifier/v90/cdp-v90.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v90/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v90/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('none 撤销: 类型与面板回到两范围');
{
  const geo = readSrc('src/osu/geometryHelpers.ts');
  assert(/scope: 'all' \| 'selection',/.test(geo), 'geoHelperSources 两范围');
  assert(!/'none'/.test(geo), 'geometryHelpers 无 none');
  const store = readSrc('src/osu/store.ts');
  assert(/geoScope: 'all' \| 'selection' = 'selection'/.test(store), 'store geoScope 两范围');
  const panel = readSrc('src/components/GeoSnapPanel.tsx');
  assert(!/'none'/.test(panel), '面板无 none 勾选项');
}

section('store.ts + EditorCanvas.tsx: 显示/隐藏总开关');
{
  const store = readSrc('src/osu/store.ts');
  assert(/geoEnabled = loadGeoEnabled\(\)/.test(store), 'geoEnabled = localStorage 记忆 (v96 默认关)');
  assert(/localStorage\.setItem\(LS_GEO_ENABLED, b \? '1' : '0'\)/.test(store), 'setGeoEnabled 持久化 (v96)');
  assert(/setGeoEnabled\(b: boolean\)/.test(store), 'setGeoEnabled');
  const ec = readSrc('src/components/EditorCanvas.tsx');
  assert(/if \(!store\.geoEnabled\) return \[\]/.test(ec), 'geoSourceSliders 总开关 (渲染+吸附同时停)');
}

section('App.tsx: 「辅助线」切换 + 「辅助线配置」开面板');
{
  const app = readSrc('src/App.tsx');
  assert(/data-geo-input="toggle"/.test(app) && /setGeoEnabled\(!store\.geoEnabled\)/.test(app), '辅助线按钮 = 切换显示/隐藏');
  assert(/Magnet className[^>]*\/>辅助线/.test(app), '按钮名 = 辅助线 (v181: 🧲 → lucide Magnet)');
  assert(/data-geo-input="panel-toggle"/.test(app) && /Settings2 className[^>]*\/>辅助线配置/.test(app), '辅助线配置按钮 = 开面板 (v181: ⚙ → lucide Settings2)');
}

if (failures) { console.error(`\nVERIFIER_V90_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V90_ALL_PASSED');
