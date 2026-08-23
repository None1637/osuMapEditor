// 验证器 v78: 自定义网格中心 (gridOrigin) — 吸附/渲染同一原点 + 画布可拖标记 + App 开关与坐标输入
// 运行: cd app && node verifier/v78/check.mjs; node verifier/v78/cdp-v78.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v78/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v78/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('store.ts: 网格中心状态');
{
  const src = readSrc('src/osu/store.ts');
  assert(/gridOrigin: Pt = \{ x: 256, y: 192 \}/.test(src), 'gridOrigin 默认游玩区中心');
  assert(/gridOriginCustom = false/.test(src), 'gridOriginCustom 默认关');
  assert(/setGridOrigin\(p: Pt\)/.test(src) && /Math\.round\(p\.x\)/.test(src), 'setGridOrigin 取整');
  assert(/setGridOriginCustom\(b: boolean\)/.test(src), 'setGridOriginCustom');
  assert(/currentGridOrigin\(\): Pt \{ return this\.gridOriginCustom \? this\.gridOrigin : GRID_ORIGIN; \}/.test(src), 'currentGridOrigin: custom ? gridOrigin : GRID_ORIGIN');
}

section('EditorCanvas.tsx: 吸附/渲染/拖拽接线');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/snapToGrid\(p, store\.gridType, store\.currentGridOrigin\(\)/.test(src), 'gridSnapAt 用 currentGridOrigin');
  assert(/snapToGrid\(\{ x: orig\.x \+ dx, y: orig\.y \+ dy \}, store\.gridType, store\.currentGridOrigin\(\)/.test(src), '物件拖拽网格吸附用 currentGridOrigin');
  assert(/const O = store\.currentGridOrigin\(\)/.test(src), '网格线渲染与吸附同一原点');
  assert(/if \(store\.gridOriginCustom && store\.gridType !== 'none'\)/.test(src) && /'#4df3ff'/.test(src), '自定义中心标记渲染 (青色 #4df3ff; v119: 无网格时不显示)');
  assert(/gridOriginDragRef\.current = true/.test(src) && /store\.gridOriginCustom && store\.gridType !== 'none' && Math\.hypot\(store\.gridOrigin\.x - p\.x/.test(src), 'mousedown 标记命中 (全工具可拖; v119: 无网格时不可拖)');
  assert(/store\.setGridOrigin\(snapWithGeo\(bm, cp, snapToNearby\(cp, targets\)\) \?\? cp\)/.test(src), '拖拽做物件+辅助吸附, 不做网格吸附 (防自锁)');
  assert(/originDragRef\.current = false; gridOriginDragRef\.current = false/.test(src), 'mouseup 重置拖拽标记');
}

section('App.tsx: 网格中心 UI');
{
  const src = readSrc('src/App.tsx');
  assert(/data-grid-input="origin-toggle"/.test(src) && /setGridOriginCustom\(!store\.gridOriginCustom\)/.test(src), '◎ 中心开关按钮');
  assert(/data-grid-input="origin-x"/.test(src) && /data-grid-input="origin-y"/.test(src), '开启后显示 x/y 输入');
  assert(/store\.setGridOrigin\(\{ x: v, y: store\.gridOrigin\.y \}\)/.test(src), 'x 输入回写 setGridOrigin');
}

if (failures) { console.error(`\nVERIFIER_V78_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V78_ALL_PASSED');
