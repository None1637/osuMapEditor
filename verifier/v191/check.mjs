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
// v346 i18n 适配: 工具条目带 labelKey (词典键) + label (英文原文); 中文译文断言 dicts/zh-CN/app.ts
const dictApp = fs.readFileSync(path.join(root, 'src/i18n/dicts/zh-CN/app.ts'), 'utf8');
assert(/\{ id: 'select', labelKey: 'app\.tool_select', label: 'Select', action: 'tool-select', icon: MousePointer2 \}/.test(src) && /'app\.tool_select': '选择'/.test(dictApp), '选择 → MousePointer2 (v321: key→action 动态键位)');
assert(/\{ id: 'circle', labelKey: 'app\.tool_circle', label: 'Hit Circle', action: 'tool-circle', icon: Circle \}/.test(src) && /'app\.tool_circle': '单点'/.test(dictApp), '单点 → Circle (v321)');
assert(/\{ id: 'slider', labelKey: 'app\.tool_slider', label: 'Slider', action: 'tool-slider', icon: Spline \}/.test(src) && /'app\.tool_slider': '滑条'/.test(dictApp), '滑条 → Spline (v321)');
assert(/\{ id: 'spinner', labelKey: 'app\.tool_spinner', label: 'Spinner', action: 'tool-spinner', icon: Disc \}/.test(src) && /'app\.tool_spinner': '转盘'/.test(dictApp), '转盘 → Disc (v321)');
assert(/<tool\.icon className="inline-block w-4 h-4 mr-1\.5 -mt-0\.5" \/>\{t\(tool\.labelKey, tool\.label\)\}/.test(src), '按钮文本前渲染图标');
assert(!/['"](🖱|🔘|📏|🌀|⭕)['"]/.test(src), '无 emoji 图标 (AGENTS.md 规范)');

if (failures) { console.error(`V191 FAILED: ${failures}`); process.exit(1); }
console.log('V191 ALL PASSED');
