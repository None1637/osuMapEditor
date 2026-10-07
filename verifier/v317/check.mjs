// 验证器 v317: F19 — Alt+Shift 框选作用于已选锚点
//   mousedown: Alt+空白起手时 subtract = Shift && !Ctrl && !Meta (Shift 单独);
//   v343: mousemove subtract 分支 = 对称差 toggle (框内已选剔除 + 框内未选加入; 原纯减选只能减不能加);
//   加选分支不变
// 运行: node verifier/v317/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const ec = readSrc('src/components/EditorCanvas.tsx');

section('F19: Alt+Shift 框选 toggle (v343)');
{
  assert(/subtract\?: boolean/.test(ec), 'nodeMarqueeRef 带 subtract 标记');
  const altLayer = ec.match(/const nodeAltPress = \(p: Pt[\s\S]{0,2600}?\n  \};/);
  assert(!!altLayer && /subtract: mods\.shiftKey && !mods\.ctrlKey && !mods\.metaKey/.test(altLayer[0]), '起手: 仅 Shift = toggle (Ctrl/Meta 仍加选)');
  const mm = ec.match(/const inRect = nodesInRect[\s\S]{0,900}?\n      \}/);
  assert(!!mm, 'mousemove 框选应用分支存在');
  assert(!!mm && /if \(nmq\.subtract\)/.test(mm[0]), 'toggle 分支存在');
  assert(!!mm && /kept = baseArr\.filter\(\(\[a, b\]\) => !inKeys\.has/.test(mm[0]), '框内已选 → 剔除');
  assert(!!mm && /added = inRect\.filter\(\(\[a, b\]\) => !baseKeys\.has/.test(mm[0]), '框内未选 → 加入');
  assert(/\} else \{\n\s*store\.setSelectedNodes\(\[\.\.\.nmq\.base, \.\.\.keepNodes, \.\.\.inRect\]\);/.test(ec), '加选分支不变 (v117/v277)');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv317 全部通过');
process.exit(failures ? 1 : 0);
