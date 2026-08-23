// 验证器 v194: 参考 Bpm-Measurer 优化频谱显示 — SPECTRO_FRAME 2048→1024 + 分段式色带 (黑→紫→红→黄→白)
// 运行: node verifier/v194/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v194/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v194/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V194_TESTS_*)
fs.unlinkSync(out);

section('waveformData.ts: v194 改动落点');
{
  const wd = readSrc('src/osu/waveformData.ts');
  assert(/export const SPECTRO_FRAME = 1024/.test(wd), 'SPECTRO_FRAME=1024 (对齐 Bpm-Measurer FFT_SIZE)');
  assert(/v194/.test(wd), 'v194 注释存在');
  assert(/if \(x < 0\.25\)/.test(wd) && /else if \(x < 0\.5\)/.test(wd) && /else if \(x < 0\.75\)/.test(wd),
    'spectroColor 分段式色带 (0.25/0.5/0.75 锚点)');
  assert(!/const RAMP/.test(wd), '旧 RAMP 锚点数组已移除');
  assert(/center - SPECTRO_FRAME \/ 2/.test(wd), 'FFT 窗口仍以列中心为中心 (v106 保持)');
}

section('waveformDraw.ts: 波形绘制不变 (v105 Audition 风绿色保留)');
{
  const wd = readSrc('src/osu/waveformDraw.ts');
  assert(/WAVE_CORE = '#7fe07f'/.test(wd) && /WAVE_EDGE = '#1e6e2e'/.test(wd), '波形绿色配色未动');
  assert(/SPECTRO_BG_ALPHA = 140/.test(wd), '频谱半透明底保留 (v105)');
}

if (failures) { console.error(`V194 FAILED: ${failures}`); process.exit(1); }
console.log('V194 ALL PASSED');
