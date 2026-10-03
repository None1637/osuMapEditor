// 验证器 v304: 用户反馈批 — F06 数值框悬停滚轮调值 / F08 多选滑条锚点快捷键旋转缩放 / F10 框选 Alt 实时配色
// 运行: node verifier/v304/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store 纯函数单测 (tests.ts: F08 节点选区变换)');
{
  const out = path.join(root, 'verifier/v304/_bundle.mjs');
  execSync(`npx esbuild "${path.join(root, 'verifier/v304/tests.ts')}" --bundle --platform=node --outfile="${out}"`, { cwd: root, stdio: 'pipe' });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '    ' + l).join('\n'));
}

section('DraggableDialog.tsx: F06 DraftNum 悬停滚轮调值');
{
  const src = readSrc('src/components/DraggableDialog.tsx');
  assert(/el\.addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(src), '原生非 passive wheel 监听 (可 preventDefault)');
  assert(/e\.deltaY < 0 \? 1 : -1/.test(src), '上滚加下滚减');
  assert(/const mult = e\.shiftKey \? 10 : e\.altKey \? 0\.1 : 1;/.test(src), 'Shift ×10 / Alt ×0.1 (与拖动调值一致)');
  assert(/setDraft\(String\(v\)\);[^\n]*\n\s*set\(v\);/.test(src), '滚轮同步刷新 draft 显示与提交值');
}

section('store.ts: F08 节点选区变换 API');
{
  const src = readSrc('src/osu/store.ts');
  assert(/rotateSelectedNodes\(deg: number\)/.test(src), 'rotateSelectedNodes 存在');
  assert(/flipSelectedNodes\(axis: 'h' \| 'v'\)/.test(src), 'flipSelectedNodes 存在');
  assert(/原点 = 锚点包围盒中心/.test(src), '原点 = 锚点包围盒中心');
  assert(/transformNodesFromSnapshot\(bm, snap, p => fn\(p, c\)\)/.test(src), '变换走节点快照 (含红锚点成对)');
}
{
  const app = readSrc('src/App.tsx');
  assert(/store\.nodeSelectionCount \? store\.rotateSelectedNodes\(90\) : store\.rotateSelected\(90, 'playfield'\)/.test(app), '快捷键 rot-cw 节点优先');
  assert(/store\.nodeSelectionCount \? store\.flipSelectedNodes\('h'\) : store\.flipSelected\('h', 'playfield'\)/.test(app), '快捷键 flip-h 节点优先');
  const em = readSrc('src/osu/electronMenu.ts');
  assert(/store\.nodeSelectionCount \? store\.rotateSelectedNodes\(-90\)/.test(em), 'Electron 菜单同步节点优先');
}

section('EditorCanvas.tsx: F10 框选 Alt 实时配色');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const altHeldRef = useRef\(false\);/.test(src), 'altHeldRef 存在');
  assert(/altHeldRef\.current = e\.altKey;/.test(src), 'keydown/keyup/mousedown 同步 Alt 态');
  assert(/window\.addEventListener\('blur', blur\)/.test(src), '窗口失焦复位 Alt 态');
  const mqBlock = src.match(/框选矩形[\s\S]{0,700}?g\.setLineDash\(\[\]\);/);
  assert(!!mqBlock && /alt \? 'rgba\(242,181,68,0\.08\)' : 'rgba\(77,243,255,0\.08\)'/.test(mqBlock[0]), '物件框选: Alt=橙黄 / 普通=蓝');
  assert(/v304: F10 — 与物件框选同规则, 配色随 Alt 实时切换/.test(src), '节点框选同规则实时切换');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv304 全部通过');
process.exit(failures ? 1 : 0);
