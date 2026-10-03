// 验证器 v303: F01 曲库基础字号增大 (用户 1920x1080 仍嫌小 — 排除缩放因素, 直接上调基础字号/行高)
// 运行: node verifier/v303/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('SongLibrary.tsx: 字号/行高上调');
{
  const src = readSrc('src/components/SongLibrary.tsx');
  assert(/const ROW_H = 44;/.test(src), '行高 34→44 (容纳更大字号两行)');
  assert(!/text-\[10px\]/.test(src), '不再有 10px 文本 (最小 text-xs)');
  assert(/px-3 flex items-center gap-2 text-sm cursor-pointer/.test(src), '列表行主文本 text-sm (原 text-xs)');
  assert(/text-xs text-slate-500 truncate/.test(src), '行次级文本 text-xs (原 10px)');
  assert(/text-base text-slate-100/.test(src), '详情标题 text-base (原 text-sm)');
  assert(/搜索 \(支持 ar>8 bpm<180/.test(src) && /py-1\.5 text-sm outline-none/.test(src), '搜索框 text-sm');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv303 全部通过');
process.exit(failures ? 1 : 0);
