// 验证器 v400: 右键删除滑条头节点 (参考 lazer: 删头 = 下一个控制点变新头)
// 运行: cd app && node verifier/v400/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v400/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v400/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('sliderPath.ts: deleteSliderPoint 头部可删');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/v400: 头部 \(index 0\) 可删/.test(src), 'v400 版本注释 (lazer 删头语义)');
  assert(/if \(index === 0\) \{\s*if \(pts\.length - 1 < 2\) return null;\s*return pts\.slice\(1\);/.test(src),
    '删头 = 去掉首点 (下一点变新头), 删后不足 2 点返回 null');
  assert(/if \(index < 0 \|\| index >= pts\.length\) return null;/.test(src), '下标越界保护保留');
  assert(/pts\.length - count < 2/.test(src), '非头部两点下限保护保留');
}

section('EditorCanvas.tsx: 右键头部删除接线');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/if \(i === 0\) \{[\s\S]*?deleteSliderPoint\(ctrl, 0\)[\s\S]*?applySliderPoints\(so, next\)[\s\S]*?resnapSliderLength\(bm, so, store\.beatSnap\)[\s\S]*?invalidatePath\(so\.id\)[\s\S]*?return true;/.test(src),
    '右键头部: 删头 + 写回 + 重吸附长度 + 缓存失效, 吞掉不落到通用删除');
  assert(/v400/.test(src), 'v400 版本注释');
  assert(!/i === 0\) return true; \/\/ 头部手柄: 不可删/.test(src), '旧的头部吞掉直接返回已移除');
}

section('验证器适配标注');
{
  assert(/v400/.test(readSrc('verifier/v25/tests.ts')), 'v25 tests 已适配 (删头断言)');
  assert(/v400/.test(readSrc('verifier/v25/cdp-nodes.mjs')), 'v25 cdp 已适配 (右键头部删除)');
}

if (failures) { console.error(`V400 FAILED (${failures})`); process.exit(1); }
console.log('V400 ALL PASSED');
