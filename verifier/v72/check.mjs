// 验证器 v72: timing 表头行固定在窗口内不滚动 (sticky thead)
// 纯样式改动, 无纯函数; check = 源码断言, cdp = 滚动后表头仍贴容器顶
// 运行: cd app && node verifier/v72/check.mjs; node verifier/v72/cdp-v72.mjs (需 7100 dev server)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('TimingPanel.tsx: 表头 sticky 固定');
{
  const src = readSrc('src/components/TimingPanel.tsx');
  assert(/<thead className="sticky top-0 z-10" data-tp-thead>/.test(src), 'thead sticky top-0 + 测试挂钩');
  assert(/bg-\[#16161d\]/.test(src), '表头底色遮挡滚动内容');
}

if (failures) { console.error(`\nVERIFIER_V72_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V72_ALL_PASSED');
