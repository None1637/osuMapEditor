// 验证器 v97: 网格按钮文案 网格 -> 网格吸附 (纯 UI 文案, 无逻辑/纯函数改动)
// 运行: cd app && node verifier/v97/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

{
  const app = readSrc('src/App.tsx');
  assert(/Grid3x3 className[^>]*\/>网格吸附/.test(app), '按钮文案 = 网格吸附 (v181: ⊞ → lucide Grid3x3)');
  assert(!app.includes('⊞'), '旧文案 ⊞ 网格 已移除');
}

if (failures) { console.error(`\nVERIFIER_V97_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V97_ALL_PASSED');
