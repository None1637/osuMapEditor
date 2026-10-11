// 验证器 v395: 多边形生成不限制顶点超出游玩区 (soulten: 「這就不用限制了」)
// 运行: cd app && node verifier/v395/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v395/_bundle.mjs');

// 纯函数用例直接复用 v64 tests 中的出界段 (那里已改为断言照常生成); 本验证器做源码断言
buildSync({
  entryPoints: [path.join(root, 'verifier/v64/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('polygon.ts: 无出界拦截');
{
  const src = readSrc('src/osu/convert/polygon.ts');
  assert(!/x < 0 \|\| y < 0 \|\| x > 512 \|\| y > 384/.test(src), '顶点出游玩区不再提前返回');
  assert(/outOfBounds: false/.test(src), 'outOfBounds 恒 false (字段保留兼容签名)');
  assert(/v395/.test(src), '改动带 v395 注释');
}

section('PolygonDialog.tsx: 红色拦截提示移除');
{
  const src = readSrc('src/components/convert/PolygonDialog.tsx');
  assert(!/polygon_out_of_bounds/.test(src), '不再渲染出界警告');
  assert(/disabled=\{!result\.objects\.length\}/.test(src), '空结果仍禁用创建');
}

section('zh-CN 词典: 出界文案移除');
{
  const dict = readSrc('src/i18n/dicts/zh-CN/convert.ts');
  assert(!/'convert\.polygon_out_of_bounds':/.test(dict), 'convert.polygon_out_of_bounds 键已删');
}

if (failures) { console.error(`V395 FAILED (${failures})`); process.exit(1); }
console.log('V395 ALL PASSED');
