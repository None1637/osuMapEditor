// 验证器 v197: 播放性能优化 — 滑条时长帧级 memo + 上时间轴去每帧全排序
// 运行: node verifier/v197/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v197/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v197/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V197_TESTS_*)
fs.unlinkSync(out);

section('lifecycle.ts: 帧级 memo');
{
  const src = readSrc('src/osu/lifecycle.ts');
  assert(/export function beginLifecycleFrame\(\) \{ lifecycleFrame\+\+; \}/.test(src), 'beginLifecycleFrame 导出');
  assert(/export function sliderDurationMemo\(/.test(src), 'sliderDurationMemo 导出');
  assert(/if \(c && c\.time === o\.time && c\.len === len && c\.slides === slides\) return c\.dur;/.test(src), 'memo 校验 time/len/slides');
  assert(/hitObjectDuration[\s\S]{0,200}sliderDurationMemo\(bm\.timingPoints/.test(src), 'hitObjectDuration 走 memo');
}

section('store.ts: tickClock 推进帧号');
{
  const src = readSrc('src/osu/store.ts');
  assert(/tickClock\(\) \{ beginLifecycleFrame\(\);/.test(src), 'tickClock 调 beginLifecycleFrame');
}

section('renderer.ts: objectEndAt 走 memo');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/return o\.time \+ sliderDurationMemo\(points, sliderMultiplier, o\);/.test(src), 'objectEndAt 滑条分支走 memo');
}

section('Timelines.tsx: 去掉每帧全表 sort');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(!/\[\.\.\.drawList\]\.sort/.test(src), '每帧 [...drawList].sort 已删');
  assert(/for \(let oi = drawList\.length - 1; oi >= 0; oi--\)/.test(src), '倒序索引遍历替代');
}

if (failures) { console.error(`V197 FAILED: ${failures}`); process.exit(1); }
console.log('V197 ALL PASSED');
