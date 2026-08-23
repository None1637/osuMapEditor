// 验证器 v200: 暂留模式 (点击特效开 + 打击动画关) 命中后 hitcircle 本体变白 (stable 同款)
// 运行: node verifier/v200/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer.ts: drawCircle 暂留命中变白');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/v200: 暂留模式 \(点击特效开 \+ 打击动画关\) 命中后本体变白/.test(src), 'v200 注释存在');
  assert(/const linger = displaySettings\.hitExplosion && !displaySettings\.hitAnimation;/.test(src), 'linger 条件');
  assert(/const bodyColor = linger && dt >= 0 \? '#ffffff' : color;/.test(src), '命中后本体白, 未命中保持 combo 色');
  assert(/tintedSprite\(skin\.hitcircle, bodyColor\)/.test(src), 'hitcircle 用 bodyColor 染色');
  assert(/drawApproach\(g, skin, color, x, y, size, dt, preempt, linger\);/.test(src), 'drawApproach 复用同一 linger 条件');
}

if (failures) { console.error(`V200 FAILED: ${failures}`); process.exit(1); }
console.log('V200 ALL PASSED');
