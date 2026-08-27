// 验证器 v148: 滑条 SV 修复 — ① 红线不再重置 SV (lazer ControlPointInfo: TimingPoint/DifficultyPoint
//   分表独立二分查询; 原 timingAt 遇红线 green=null, 红线后所有滑条 SV 错误回退 1.0)
//             ② 滑条路径末端延长到 expectedLength (lazer SliderPath.calculateLength: pixelLength >
//   几何全长时沿末端切线线性延长, 末两点重合例外; 原实现只截短不延长, 同一滑条比 stable 短)
// 运行: node verifier/v148/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v148/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v148/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V148_TESTS_*)
fs.unlinkSync(out);

section('parser.ts: svPointAt + SV 函数修复');
{
  const src = readSrc('src/osu/parser.ts');
  assert(/export function svPointAt\(points: TimingPoint\[\], time: number\): TimingPoint \| null/.test(src), 'svPointAt 导出');
  // v227: svPointAt 改回 stable 语义 — 红线清零 (用户反馈: 红线应重置 SV 为 1.0x)
  const fn = src.slice(src.indexOf('export function svPointAt'));
  assert(/if \(p\.uninherited\) green = null;/.test(fn) && /else green = p;/.test(fn), 'svPointAt 红线清零 (v227 stable 语义)');
  // timingAt 保持采样语义 (红线清零 green) — hitsound 采样依赖
  assert(/if \(p\.uninherited\) \{ red = p; green = null; \}/.test(src), 'timingAt 采样语义不变 (红线清零 green)');
  // sliderVelocityAt / svMultiplierAt 改用 svPointAt
  for (const f of ['sliderVelocityAt', 'svMultiplierAt']) {
    const body = src.slice(src.indexOf(`export function ${f}`), src.indexOf(`export function ${f}`) + 500);
    assert(/const green = svPointAt\(points, time\);/.test(body), `${f} 用 svPointAt (v227: SV 被红线重置)`);
  }
}

section('patternLibrary.ts / duplicate.ts: SV 查询同步修复');
{
  const pl = readSrc('src/osu/patternLibrary.ts');
  assert((pl.match(/svPointAt\(points, time\)/g) || []).length === 2, 'pxPerBeatAt/svAt 均用 svPointAt');
  const dup = readSrc('src/osu/duplicate.ts');
  assert(dup.includes('if (q.uninherited) sv = 1;'), 'duplicate svAt 红线重置 SV (v227)');
  assert(/else if \(q\.beatLength < 0\) sv = -100 \/ q\.beatLength;/.test(dup), 'duplicate svAt 绿线生效');
}

section('sliderPath.ts: 末端线性延长 (lazer calculateLength)');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/const rawEndDup = raw\.length >= 2/.test(src), '末两点重合例外 (raw 上判定, 重采样去重会抹掉)');
  assert(/if \(!rawEndDup && acc < expectedLength && this\.points\.length >= 2\)/.test(src), '仅在 expected > 几何全长且非重合端点时延长');
  assert(/this\.points\.push\(\{ x: p1\.x \+ dx \/ dl \* \(expectedLength - acc\), y: p1\.y \+ dy \/ dl \* \(expectedLength - acc\) \}\);/.test(src), '沿末端切线方向延长到 expectedLength');
  assert(/this\.cumulative\.push\(expectedLength\);/.test(src), '累计长度同步');
  assert(/this\.totalLength = Math\.min\(acc, expectedLength\);/.test(src), '截短逻辑不变');
}

if (failures) { console.error(`\nV148_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV148_ALL_PASSED');
