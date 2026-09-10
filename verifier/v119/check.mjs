// v119 源码接线断言: 网格类型「无网格」— 显示与吸附全关, 贴近游玩表现
// 运行: node verifier/v119/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const gs = read('src/osu/gridSnap.ts');
const store = read('src/osu/store.ts');
const cv = read('src/components/EditorCanvas.tsx');
const app = read('src/App.tsx');

assert(/export type GridType = 'square' \| 'triangle' \| 'circle' \| 'none';/.test(gs), 'gridSnap.ts: GridType +none');
assert(/if \(!\(spacing > 0\) \|\| type === 'none'\) return p;/.test(gs), 'snapToGrid: none 直通 (不吸附不钳制)');
assert(/gridType: 'square' \| 'triangle' \| 'circle' \| 'none' = 'square';/.test(store), 'store: gridType 类型联合 +none');
assert(/if \(gs0 > 0 && store\.gridType !== 'none'\) \{/.test(cv), '渲染: 无网格时不画网格线 (v245: 网格并入静态层缓存, gs 改名 gs0)');
assert(/if \(store\.gridOriginCustom && store\.gridType !== 'none'\) \{/.test(cv), '渲染: 无网格时网格中心标记不显示');
assert(/if \(store\.gridOriginCustom && store\.gridType !== 'none' && Math\.hypot/.test(cv), '交互: 无网格时网格中心标记不可拖');
assert(/<option value="none">无网格<\/option>/.test(app), 'App: 网格类型下拉里加「无网格」');
assert(/as 'square' \| 'triangle' \| 'circle' \| 'none'/.test(app), 'App: onChange 类型联合 +none');
assert(/store\.gridType === 'circle' \|\| store\.gridType === 'none'/.test(app), 'App: 无网格时旋转输入禁用');

console.log(failures ? `\nV119_CHECK_FAILED: ${failures}` : '\nV119_CHECK_PASSED');
process.exit(failures ? 1 : 0);
