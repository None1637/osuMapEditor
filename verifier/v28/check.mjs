// 验证器 v28: stable 风格布局 — 页签(compose/timing/song setup) + 时间轴(大圆物件/彩色节拍 tick/红绿线旗标) + 游玩区上下留白
// 运行: cd app && node verifier/v28/check.mjs; node verifier/v28/cdp-layout.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v28/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v28/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// 纯函数测试 (tick 分级/生成/配色)
await import('file://' + out);
fs.unlinkSync(out);

// ---- 源码接线断言 ----
section('beatTicks.ts');
{
  const src = readSrc('src/osu/beatTicks.ts');
  for (const f of ['tickLevel', 'beatTicks', 'TICK_COLORS']) assert(src.includes(f), `导出 ${f}`);
  assert(/beatIndex % meter/.test(src), '小节线按 meter 判定');
}

section('Timelines.tsx: stable 双行时间轴');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(src.includes('beatTicks') && src.includes('TICK_COLORS'), '节拍 tick 行走 beatTicks/TICK_COLORS');
  assert(/const RAD = 24/.test(src), '物件大圆 RAD=24 (stable 尺寸)');
  assert(src.includes('rgba(235,71,71') && src.includes('rgba(178,255,102'), '红/绿 timing 竖线 (v61 起: lazer Red2/Lime1, 原三角旗移除)');
  assert(src.includes('h-[92px]'), '时间轴加高为双行');
  assert(/e\.clientY - r\.top > OBJ_H/.test(src), 'tick 行点击不选物件 (直接 seek)');
}

section('App.tsx: stable 页签');
{
  const src = readSrc('src/App.tsx');
  assert(src.includes("'compose'") && src.includes("setTab('setup')"), '页签 compose / timing / song setup (v184: song setup 单独渲染, 其左侧为谱面信息)');
}

section('EditorCanvas.tsx: 上下留白');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const PAD_Y = 40/.test(src), 'PAD_Y=40 上下留白');
  assert(/availH \/ \(PH \+ PAD_Y \* 2\)/.test(src), '缩放按 PH+2*PAD_Y 计算 (v129: 高度用扣除面板预留后的 availH)');
  assert(src.includes('__osuToClient') && src.includes('__osuToCanvas'), '暴露 __osuToClient/__osuToCanvas (CDP 统一坐标)');
  const toOsu = src.match(/const toOsu[\s\S]*?\}, \[\]\);/)?.[0] ?? '';
  assert(toOsu.includes('viewTransform'), 'toOsu 与渲染共用 viewTransform');
}

if (failures) { console.error(`\nVERIFIER_V28_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V28_ALL_TESTS_PASSED');
