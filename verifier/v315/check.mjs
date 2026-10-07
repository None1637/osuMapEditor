// 验证器 v315: F16+F17 缩放/旋转窗口修正 —
//   F16: xy固定 重开窗口保持上次状态 (localStorage 'tf-scale'); 倍率默认 1 (原 1.1)
//   F17a: 旋转角度默认 0 (原 90)
//   F17b: 旋转窗口补「应用旋转」按钮 (按带符号角度, 正=顺时针; 原只有 逆/顺时针 两个按钮, 用户找不到应用入口)
//   F17c: 窗口开着时切换选区 → 回滚旧选区未提交预览 + 以新选区重开预览会话 (原新选物件不在 tfBackup, 预览叠加)
// 运行: node verifier/v315/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const src = readSrc('src/components/TransformDialog.tsx');

section('F16: 缩放窗口默认值与 xy固定 持久化');
{
  assert(/useState\(1\)(;| )/.test(src) && !/useState\(1\.1\)/.test(src), '倍率 x/y 默认 1 (原 1.1 已移除)');
  assert(/loadParams\('tf-scale', \{ lockRatio: false \}\)/.test(src), 'xy固定 初值读 localStorage (默认关)');
  assert(/useSaveParamsOnClose\('tf-scale', \{ lockRatio \}\)/.test(src), 'xy固定 关窗落盘 (重开保持)');
}

section('F17a/b: 旋转默认 0° + 应用旋转按钮');
{
  assert(/useState\(0\); \/\/ v315: F17a/.test(src) && !/useState\(90\)/.test(src), '角度默认 0 (原 90 已移除)');
  assert(/commit\(\(objs, c\) => rotateObjects\(objs, c, angle\)\)/.test(src), '「应用旋转」按带符号角度提交 (正=顺时针)');
  assert(/data-tf="apply-rotate"/.test(src), '应用旋转按钮 testid');
  assert(/-Math\.abs\(angle\)/.test(src) && /c, Math\.abs\(angle\)\)/.test(src), '原逆/顺时针按钮保留');
}

section('F17c: 选区切换跟随');
{
  assert(/const selKey = nodeMode[\s\S]{0,200}?: \[\.\.\.store\.selected\]/.test(src), '监听选区成员签名 (v360: 节点模式监听节点选区)');
  const eff = src.match(/v315: F17c[\s\S]{0,1100}?\}, \[selKey, mode, nodeMode\]\);/);
  assert(!!eff, '选区切换 effect 存在');
  assert(!!eff && /endTransformPreview\(\)/.test(eff[0]) && /beginTransformPreview\(\)/.test(eff[0]), '切换时回滚旧预览并以新选区重开');
  assert(!!eff && /prevSelKey\.current === selKey\) return/.test(eff[0]), '签名未变不动 (挂载时不重复 begin)');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv315 全部通过');
process.exit(failures ? 1 : 0);
