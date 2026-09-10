// 验证器 v248: exe 内嵌服务器固定端口 7100 → 7199。
// 背景: 7100 是 dev vite 端口 (启动编辑器.bat / 所有 CDP 验证器)。旧版 exe 优先绑 7100,
// 与 dev server 同开时 Windows SO_REUSEADDR 语义下出现双 listener 都 LISTENING 的混乱
// (exe 加载到 dev 代码或端口被劫持, 排查极费时)。7199 为 exe 专用, 被占仍回退随机端口。
// 运行: node verifier/v248/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
assert(/await listen\(server, 7199\)/.test(src), 'exe 优先绑 7199');
assert(!/await listen\(server, 7100\)/.test(src), '不再优先绑 7100 (dev vite 端口)');
assert(/catch \{ return await listen\(server, 0\) \}/.test(src), '被占用回退随机端口保留');

if (failures) { console.error(`\nV248_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV248_ALL_PASSED');
