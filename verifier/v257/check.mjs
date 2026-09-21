// 验证器 v257: stable 滑条控制点再缩小 (用户反馈仍偏肥)。
// 历史: 16 → 5/k (v231) → 10/k (边长翻倍对齐 stable ~8x8) → v257 改 7/k
//   (stable 实测 ~8x8 含描边; 7/k 填充 + 1/k 居中描边 ≈ 8px 总宽)。
// 运行: node verifier/v257/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const r = fs.readFileSync(path.join(root, 'src/osu/renderer.ts'), 'utf8');
const stable = r.match(/sliderPointStyle === 'stable'\) \{\n([\s\S]{0,600}?)\n  \} else/)?.[1] ?? '';
assert(stable.length > 0, '找到 stable 控制点分支');
assert(/const s = 7 \/ k;/.test(stable), 'stable 控制点边长 7/k (v257, 含 1px 描边 ≈ 8px)');
assert(!/const s = 10 \/ k;/.test(stable), '旧 10/k 边长已替换');
assert(/v257/.test(stable), 'v257 注释在');

if (failures) { console.error(`\nV257_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV257_ALL_PASSED');
