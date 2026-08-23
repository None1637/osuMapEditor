// 验证器 v195: 关「打击动画」时缩圈命中后反弹 (缩到圈边 → 向外扩大一点 → 停住)
// 运行: node verifier/v195/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v195/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v195/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V195_TESTS_*)
fs.unlinkSync(out);

section('lifecycle.ts: approachBounceScale 纯函数');
{
  const src = readSrc('src/osu/lifecycle.ts');
  assert(/export const APPROACH_BOUNCE = 0\.1/.test(src), 'APPROACH_BOUNCE=0.1');
  assert(/export function approachBounceScale\(dt: number, preempt: number\)/.test(src), 'approachBounceScale 导出');
  assert(/Math\.min\(1, dt \/ dur\)/.test(src), '反弹线性到位后 clamp 停住');
}

section('renderer.ts: 贴边分支用反弹系数');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/approachBounceScale/.test(src) && /import \{[^}]*approachBounceScale[^}]*\} from '.\/lifecycle'/.test(src), 'renderer 引入 approachBounceScale');
  assert(/const pin = size \* approachBounceScale\(dt, preempt\)/.test(src), '贴边大小 = size × 反弹系数');
  assert(/if \(!pinAfterHit\) return/.test(src), '非暂留模式命中后仍不画缩圈 (不变)');
}

section('DisplayPanel.tsx: 描述更新');
{
  const src = readSrc('src/components/DisplayPanel.tsx');
  assert(/缩圈缩到圈边后向外反弹一点再停住/.test(src), 'hitAnimation 描述提到缩圈反弹');
}

if (failures) { console.error(`V195 FAILED: ${failures}`); process.exit(1); }
console.log('V195 ALL PASSED');
