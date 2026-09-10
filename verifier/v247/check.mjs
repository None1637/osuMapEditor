// 验证器 v247: exe (Electron) 大窗口掉帧修复 — 强制 ANGLE OpenGL 后端。
// 现象: 打包 exe / npx electron 在 2560x1511 最大化窗口下任意谱面仅 ~88fps (frameP95=12.6ms ≈ 3 个
//   240Hz vsync), JS 帧忙仅 0.3ms — 与页面内容无关, 是 Chromium 150 默认 D3D11 呈现路径在大窗口下
//   每帧合成/呈现 ~11ms 的容器级问题。同机 headed Edge 同尺寸窗口 240fps 满帧。
// 诊断过程 (verifier/v246/electron-npx-probe.mjs, 实测同机 RTX 4090):
//   - 基线 (默认 d3d11): 静止 88.2 / 播放 88.7
//   - 800x600 小窗口: 240 满帧 → 窗口尺寸相关的呈现/合成成本, 非 JS/光栅
//   - --force-color-profile=srgb: 无效 (88) → 排除 HDR
//   - --use-angle=vulkan: 34fps 且帧忙 28ms → 软件光栅, 不可用
//   - --use-angle=d3d11on12: 83 → 同默认
//   - --use-angle=gl: 静止/播放均 240 满帧 ✓
// 修复: electron/main.cjs 顶层 app.commandLine.appendSwitch("use-angle", "gl") (须在 app ready 前)。
// GPU feature 对比 (verifier/v246/gpu-compare.mjs): Electron 2d_canvas/gpu_compositing/rasterization
//   均 enabled, 与 Edge 无关键差异 — 差异在呈现路径而非光栅特性开关。
// 运行: node verifier/v247/check.mjs; 实测: node verifier/v246/electron-npx-probe.mjs (免打包快速迭代)
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
assert(/app\.commandLine\.appendSwitch\("use-angle", "gl"\)/.test(src), 'main.cjs 强制 use-angle=gl');
assert(src.indexOf('appendSwitch("use-angle"') < src.indexOf('app.whenReady()'), '开关在 app ready 之前');
assert(/v247:/.test(src), 'v247 注释记录原因');

if (failures) { console.error(`\nV247_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV247_ALL_PASSED');
