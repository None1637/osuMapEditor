// 验证器 v307/v596: 旧 x:y 比例固定已由「勾选轴共用同一倍率」取代
// 运行: node verifier/v307/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('TransformDialog.tsx: v596 统一倍率取代 x:y 比例固定');
{
  const src = readSrc('src/components/TransformDialog.tsx');
  const zhTransform = readSrc('src/i18n/dicts/zh-CN/transform.ts');
  assert(src.includes('axisScaleFactors(factor, factor, axisX, axisY)'), '所有勾选轴直接使用同一 factor');
  assert(!src.includes('data-tf="lock-ratio"') && !src.includes('changeFactorY'), '旧比例联动与独立 Y 输入已移除');
  assert(!zhTransform.includes("'transform.lock_ratio'"), '旧比例固定 i18n 文案已移除');
  assert(/<DraftNum value=\{factor\} set=\{changeFactor\}/.test(src), '顶部统一 DraftNum 仍支持拖动/滚轮调值');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv307 全部通过');
process.exit(failures ? 1 : 0);
