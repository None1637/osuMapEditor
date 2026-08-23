// 验证器 v191: 选择/单点/滑条/转盘 4 个工具按钮文本前加 Lucide 图标
// 运行: node verifier/v191/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const src = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

console.log('== App.tsx: 工具按钮图标');
assert(/MousePointer2, Circle, Spline, Disc/.test(src), '导入 4 个 lucide 图标');
assert(/\{ id: 'select', label: '选择', key: '1', icon: MousePointer2 \}/.test(src), '选择 → MousePointer2');
assert(/\{ id: 'circle', label: '单点', key: '2', icon: Circle \}/.test(src), '单点 → Circle');
assert(/\{ id: 'slider', label: '滑条', key: '3', icon: Spline \}/.test(src), '滑条 → Spline');
assert(/\{ id: 'spinner', label: '转盘', key: '4', icon: Disc \}/.test(src), '转盘 → Disc');
assert(/<t\.icon className="inline-block w-4 h-4 mr-1\.5 -mt-0\.5" \/>\{t\.label\}/.test(src), '按钮文本前渲染图标');
assert(!/['"](🖱|🔘|📏|🌀|⭕)['"]/.test(src), '无 emoji 图标 (AGENTS.md 规范)');

if (failures) { console.error(`V191 FAILED: ${failures}`); process.exit(1); }
console.log('V191 ALL PASSED');
