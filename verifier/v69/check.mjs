// 验证器 v69: 批量复制预览滑条长度随"复制绿线"切换变化 (objEnd 用合并预览 timing)
// 运行: cd app && node verifier/v69/check.mjs; node verifier/v69/cdp-v69.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v69/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v69/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('renderer.ts: objectEndAt 纯函数');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/export function objectEndAt\(/.test(src), 'objectEndAt 导出');
  // v197 适配: 改走 sliderDurationMemo (内部同公式 sliderVelocityAt(points, o.time, sliderMultiplier), 帧级缓存)
  assert(/sliderDurationMemo\(points, sliderMultiplier, o\)/.test(src), '滑条时长按传入 timing 的头部 SV 推导 (v197: 经帧级 memo)');
  assert(/o\.type === 'spinner'\) return o\.endTime \?\? o\.time \+ 1000/.test(src), '转盘用 endTime');
}

section('Timelines.tsx: objEnd 用合并预览 timing');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/store\.conversionPreview\?\.timingPoints/.test(src), '读预览绿线');
  assert(/\[\.\.\.bm\.timingPoints, \.\.\.prevTp\]\.sort/.test(src), '合并 + 排序');
  assert(/objectEndAt\(tps, bm\.difficulty\.sliderMultiplier, o\)/.test(src), 'objEnd 委托 objectEndAt (合并 timing)');
}

if (failures) { console.error(`\nVERIFIER_V69_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V69_ALL_PASSED');
