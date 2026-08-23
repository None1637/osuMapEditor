// 验证器 v214: 全局禁用 UI 文本选择 (框选/拖拽经过按钮/面板文字时不再误选文本)
// 运行: node verifier/v214/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
assert(/body\s*\{[^}]*user-select:\s*none/.test(css), 'body 全局 user-select: none');
assert(/input,\s*textarea,\s*\[contenteditable="true"\]\s*\{[^}]*user-select:\s*text/.test(css), '输入框/文本域保持可选');

if (failures) { console.error(`V214 FAILED: ${failures}`); process.exit(1); }
console.log('V214 ALL PASSED');
