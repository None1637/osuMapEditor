// 验证器 v302: 用户反馈批 — F02 选中滑条锚点/连线被层裁剪 / F04 滑条尾不受游玩区限制 /
//   F09 包围框缩放锚点出界整组卡死 / F11 框选拖出画布中断
// 运行: node verifier/v302/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer.ts: F02 选中装饰层包围盒并入滑条控制点 (贝塞尔锚点可在路径包围盒外)');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/\.\.\.getSliderPath\(bm, o\)\.points, o, \.\.\.\(o\.curvePoints \?\? \[\]\)/.test(src),
    'selLayer 内容包围盒 = 路径点 + 头 + 全部控制点');
}

section('EditorCanvas.tsx: F04 拖拽共享位移钳制 (v352: 收窄为头/尾中心, 控制点不钳)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/v352: 钳制点集收窄为「头\/尾中心」/.test(src), 'F04 钳制块存在 (v352 语义注释)');
  assert(/const pts = \[\{ x: orig\.x, y: orig\.y \}\]; \/\/ v352: 只钳头 \(\+尾\), 控制点不参与/.test(src)
    && !/\.\.\.\(orig\.curve \?\? \[\]\)/.test(src.match(/v352: 钳制点集收窄[\s\S]*?yLo <= yHi\) dy = Math\.max/)?.[0] ?? ''),
    '钳制点集 = 头 (+尾), 不再含控制点 (用户反馈: 滑条点不该被限制)');
  assert(/d\.tails\.get\(id\)/.test(src) && /if \(tail\) pts\.push\(tail\);/.test(src)
    && /path\.positionAt\(\(o\.slides \?\? 1\) % 2 === 0 \? 0 : \(o\.length \?\? path\.totalLength\)\)/.test(src),
    '滑条尾 (路径终点) 纳入钳制点集 (v341: 尾点在拖拽起点预算进 tails)');
  assert(/if \(xLo <= xHi\) dx = Math\.max\(xLo, Math\.min\(xHi, dx\)\);/.test(src), '共享 delta 钳制应用');
}

section('selectionBox.ts: F09 单滑条缩放出界改钳制倍率 (不再整体回滚)');
{
  const src = readSrc('src/osu/selectionBox.ts');
  assert(/limitToPlayfield = true, \/\/ v302: F09/.test(src), 'applyScaleDrag 接收限制开关');
  assert(/已出界的点不纳入钳制/.test(src), '界内点钳制, 越界点不压回');
  assert(/路径长度非法 \(零长\) 仍回滚/.test(src) && !/inBounds && validLen/.test(src), '仅零长路径回滚');
  assert(/const s = limitToPlayfield \? clampScaleToPlayfield/.test(src), '多物件钳制随开关联动');
}
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/applyScaleDrag\(bm, selectedMovable\(bm\), sd\.states, raw, origin, anchorAxis\(sd\.anchor\), store\.beatSnap, sd\.quad, store\.limitToPlayfield\)/.test(src),
    '缩放拖拽传入 store.limitToPlayfield');
}

section('EditorCanvas.tsx: F11 框选拖出画布不中断 (window 接管 + onMouseLeave 不收尾)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/nodesMoveDragRef\.current \|\| marqueeRef\.current \|\| nodeMarqueeRef\.current\) onMouseUp\(\)/.test(src),
    'window mouseup 收尾覆盖框选');
  assert(/nodesMoveDragRef\.current \|\| marqueeRef\.current \|\| nodeMarqueeRef\.current[\s\S]{0,500}?&& e\.target !== canvasRef\.current\)/.test(src),
    'window mousemove 继续喂框选 (v313: 同分支追加标记类拖拽+中键平移)');
  assert(/!nodesMoveDragRef\.current\s*\n\s*&& !marqueeRef\.current && !nodeMarqueeRef\.current[\s\S]{0,500}?\) onMouseUp\(\)/.test(src),
    'onMouseLeave 不再终止框选 (v313: 同守卫追加节点手柄/中键/标记类拖拽)');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv302 全部通过');
process.exit(failures ? 1 : 0);
