// 验证器 v192: 快捷键 Ctrl+,/. 旋转90° 与 Ctrl+H/J 镜像始终围绕游玩区中心 (对齐 osu!stable)
// 运行: node verifier/v192/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v192/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v192/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V192_TESTS_*)
fs.unlinkSync(out);

section('App.tsx: 快捷键传 playfield 原点');
{
  const src = readSrc('src/App.tsx');
  assert(/store\.rotateSelected\(-90, 'playfield'\)/.test(src), 'Ctrl+, 逆转90° → playfield');
  assert(/store\.rotateSelected\(90, 'playfield'\)/.test(src), 'Ctrl+. 顺转90° → playfield');
  assert(/store\.flipSelected\('h', 'playfield'\)/.test(src), 'Ctrl+H 水平镜像 → playfield');
  assert(/store\.flipSelected\('v', 'playfield'\)/.test(src), 'Ctrl+J 垂直镜像 → playfield');
  assert(/游玩区中心\)/.test(src), '帮助文本标注游玩区中心');
}

section('Inspector.tsx: 面板按钮仍用界面原点, 提示文本更新');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert(/store\.flipSelected\('h', origin\)/.test(src), '面板水平镜像按钮仍用界面原点');
  assert(/围绕游玩区中心 \(stable 同款\)/.test(src), '提示文本已更新');
  assert(!/均围绕选区中心/.test(src), '旧提示文本已移除');
}

if (failures) { console.error(`V192 FAILED: ${failures}`); process.exit(1); }
console.log('V192 ALL PASSED');
