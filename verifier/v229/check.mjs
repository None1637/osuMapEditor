// 验证器 v229: 游玩区平移功能支持 Alt+滚轮缩放 (lazer 同款: 时间轴 Alt+滚轮 = 缩放, 见
//   ZoomableScrollContainer.OnScroll; 本编辑器游玩区纯 Alt+滚轮原本空闲)。
// 行为: 仅 playfieldPanEnabled 时生效; 每刻度 ×1.1 (Math.pow(1.1, -dy/100)), 钳 0.1..10
//   (同左侧栏缩放输入框); 以光标为焦点 — panX/panY 同步补偿 (s0-s1)*p, 光标下内容不动;
//   Alt+滚轮不再触发 wheelSeek。
// 运行: node verifier/v229/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const src = readSrc('src/components/EditorCanvas.tsx');
const wheelBody = src.slice(src.indexOf('onWheel={(e) => {'), src.indexOf('/>', src.indexOf('onWheel={(e) => {')));

section('EditorCanvas: Alt+滚轮缩放');
{
  assert(/if \(e\.altKey && store\.playfieldPanEnabled\)/.test(wheelBody), 'Alt+滚轮 + 平移开启时生效');
  assert(/e\.deltaMode === 1 \? e\.deltaY \* 33 : e\.deltaMode === 2 \? e\.deltaY \* 800 : e\.deltaY/.test(wheelBody), 'deltaMode 归一化 (与 wheelSteps 同款)');
  assert(/Math\.pow\(1\.1, -dy \/ 100\)/.test(wheelBody), '每刻度 ×1.1 (滚轮上 = 放大)');
  assert(/Math\.max\(0\.1, Math\.min\(10,/.test(wheelBody), '倍率钳 0.1..10 (同缩放输入框)');
  assert(/store\.playfieldPanX \+= \(s0 - s1\) \* p\.x;/.test(wheelBody) && /store\.playfieldPanY \+= \(s0 - s1\) \* p\.y;/.test(wheelBody), 'pan 同步补偿 (光标焦点缩放)');
  assert(/store\.playfieldScale = s1;/.test(wheelBody), '写回 playfieldScale');
  assert(/store\.emit\(\);/.test(wheelBody), 'emit 刷新左侧面板输入框');
  assert(/return;[\s\S]*?store\.wheelSeek\(e\.deltaY, e\.deltaMode\);/.test(wheelBody), 'Alt 分支 return, 不再 wheelSeek; 非 Alt 保持 v193 seek');
}

if (failures) { console.error(`V229 FAILED: ${failures}`); process.exit(1); }
console.log('V229 ALL PASSED');
