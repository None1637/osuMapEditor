// 验证器 v256: 播放按钮配色改低调。
// 需求: soulten「右下角的播放按鈕怎麼特別紅...」— 亮粉色播放按钮在深色底栏刺眼。
// 实现: bg-pink-500/hover:bg-pink-400 → bg-white/10/hover:bg-white/20 (与回到开头按钮一致)。
// 运行: node verifier/v256/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const tl = fs.readFileSync(path.join(root, 'src/components/Timelines.tsx'), 'utf8');
const btn = tl.match(/store\.togglePlay\(\)\} className="[^"]*"/)?.[0] ?? '';
assert(btn.length > 0, '找到播放按钮');
assert(!/bg-pink-500/.test(btn), '播放按钮不再是亮粉色 (v256)');
assert(/bg-white\/10 hover:bg-white\/20/.test(btn), '播放按钮改为低调白底配色');
assert(/v256/.test(tl), 'v256 注释在');

if (failures) { console.error(`\nV256_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV256_ALL_PASSED');
