// 验证器 v220: 右下角帧数显示 — 悬浮于其他所有控件之上。
// FpsCounter: 独立 rAF 计帧, 每 500ms 刷新读数; fixed 右下角, z-[100] (高于 v120/v191 的 z-[60] 模态),
// pointer-events-none 不挡交互; 挂在 App 外层 (v217 zoom 容器之外), 不随 uiZoom 缩放。
// 运行: node verifier/v220/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('FpsCounter.tsx: 组件实现');
{
  const src = readSrc('src/components/FpsCounter.tsx');
  assert(/export function FpsCounter/.test(src), '导出 FpsCounter 组件');
  assert(/requestAnimationFrame\(loop\)/.test(src) && /cancelAnimationFrame\(raf\)/.test(src), 'rAF 计帧循环 + 卸载清理');
  assert(/t - last >= 500/.test(src) && /frames \* 1000 \/ \(t - last\)/.test(src), '每 500ms 按实际经过时间换算 FPS');
  assert(/fixed bottom-2 right-3/.test(src), 'fixed 定位右下角');
  assert(/z-\[100\]/.test(src), 'z-[100] 高于全部既有控件 (最高 z-[60])');
  assert(/pointer-events-none/.test(src), 'pointer-events-none 不拦截交互');
  assert(/select-none/.test(src), '文本不可选中');
}

section('App.tsx: 挂载在 zoom 容器之外');
{
  const src = readSrc('src/App.tsx');
  assert(/import \{ FpsCounter \} from '@\/components\/FpsCounter';/.test(src), '导入 FpsCounter');
  assert(src.includes('<FpsCounter />'), '已挂载');
  assert(src.indexOf('<FpsCounter />') > src.indexOf('<UnsavedDialog />'), '挂载点在 UnsavedDialog (z-[60] 模态) 之后');
  assert(src.indexOf('<FpsCounter />') > src.indexOf('zoom: uiZoom'), '挂载点在 v217 zoom 容器之后 (容器外, 不随界面缩放)');
}

if (failures) { console.error(`V220 FAILED: ${failures}`); process.exit(1); }
console.log('V220 ALL PASSED');
