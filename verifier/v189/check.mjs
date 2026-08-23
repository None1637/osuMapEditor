// 验证器 v189: ① 时间轴同刻堆叠回到精确 0ms (撤销 v188 ±2ms)
//             ② 上方时间轴按时间倒序渲染 (早物件压上层, 1ms 叠放的早物件可见)
//             ③ 同刻堆叠 ≥2 件不再缩小半径
// 运行: node verifier/v189/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v189/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v189/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V189_TESTS_*)
fs.unlinkSync(out);

section('timelineHit.ts: 精确同刻 + 不缩半径');
{
  const src = readSrc('src/osu/timelineHit.ts');
  assert(!/STACK_EPS/.test(src), '无 ±2ms 阈值 (撤销 v188)');
  assert(/counts\.get\(o\.time\)/.test(src), '按 time 精确分组');
  assert(/const rad = rad0;/.test(src), 'stackLayout: rad 恒为 rad0 (不缩小)');
  assert(!/Math\.max\(4, Math\.min\(rad0/.test(src), '旧缩小公式已移除');
}

section('Timelines.tsx: 时间倒序绘制 (早物件压上层)');
{
  const src = readSrc('src/components/Timelines.tsx');
  // v197 适配: drawList 本就按时间升序, 倒序索引遍历替代每帧 [...drawList].sort (语义不变: 晚物件先画)
  assert(/for \(let oi = drawList\.length - 1; oi >= 0; oi--\)/.test(src), '按时间倒序遍历 (晚物件先画, v197 去每帧排序)');
  assert(/const o = drawList\[oi\];/.test(src), '绘制循环走倒序索引');
}

if (failures) { console.error(`V189 FAILED: ${failures}`); process.exit(1); }
console.log('V189 ALL PASSED');
