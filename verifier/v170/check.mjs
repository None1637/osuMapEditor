// 验证器 v170: 皮肤 skin.ini [Fonts] HitCirclePrefix/HitCircleOverlap 支持
// 修复 Saraune Leaves (HitCirclePrefix: blank, default-N.png 为 1x1 透明占位) 圈内数字不显示
// 运行: node verifier/v170/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v170/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v170/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V170_TESTS_*)
fs.unlinkSync(out);

section('skin.ts: [Fonts] 解析 + 前缀加载');
{
  const src = readSrc('src/osu/skin.ts');
  assert(/export function parseSkinIniFonts\(ini: string\)/.test(src), 'parseSkinIniFonts 导出');
  assert(/hitCircleOverlap: number \| null;/.test(src), 'Skin 含 hitCircleOverlap 字段');
  assert(/const fonts = parseSkinIniFonts\(await iniTextP\);/.test(src), '加载时解析 [Fonts]');
  assert(/skin\.hitCircleOverlap = fonts\.hitCircleOverlap;/.test(src), 'overlap 写入 skin');
  assert(/const prefix = fonts\.hitCirclePrefix \?\? 'default';/.test(src), '前缀回退 default');
  assert(/`\$\{prefix\}-\$\{i\}\.png`, `default-\$\{i\}\.png`/.test(src), '前缀文件缺失回退 default-N');
}

section('renderer.ts: drawNumber 支持 HitCircleOverlap');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/if \(skin\.hitCircleOverlap !== null\)/.test(src), 'overlap 分支存在');
  assert(/skinScaleAdjust\.get\(gl\)/.test(src), '@2x 贴图按 ScaleAdjust 折算 overlap');
  assert(/const spacing = 33 \/ 35;/.test(src), '未定义 overlap 时保持旧 33/35 字距');
}

console.log(failures ? `\nV170 FAILED: ${failures}` : '\nV170 ALL PASSED');
process.exit(failures ? 1 : 0);
