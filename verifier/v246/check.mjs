// 验证器 v246: 普通谱面跑不满帧率修复 (用户反馈: v245 后全选/播放场景达标, 但打开任意谱面 <240fps)。
// 根因 1 (波形面板, 最大头): drawWave 逐列 fillRect (3757 列/帧 × 240fps ≈ 90 万次/秒, CDP 探针实测
//   fillRect self 占全部画布操作第一位, 分辨率越高列越多越慢; 波形面板默认开启 → 任意谱面都受害)。
//   修复: 列汇成单 Path 一次 fill (waveformDraw.ts)。
// 根因 2 (backing 分数尺寸): 三处画布 `c.width !== r.width * dpr` — c.width 整数 vs r.width*dpr 几乎恒为
//   分数 (uiZoom/devicePixelRatio 分数, Windows 125%/150% 缩放或非 2560×1440 窗口必中) → 每帧重设 canvas
//   宽高 (位图重建 + 上下文状态重置 + GPU 纹理重传)。
//   修复: uiZoom.ts fitCanvas (round 到整数像素, 返回 sx/sy = backing/布局 作精确变换系数), 三处统一改走。
// 根因 3: v245 的静态层/选中装饰层用整画布尺寸离屏位图, 大窗口高 dpr 下每帧全幅 drawImage 带宽浪费。
//   修复: 静态层裁剪到游玩区设备矩形 (+8px 边距), 选中层裁剪到选中物件内容包围盒 (路径点 ± 2r+16 osu px,
//   变换四角求外接矩形再裁剪到画布; 选区完全在画布外时空层不贴图)。BottomTimeline 层内容横跨全宽, 保持全尺寸。
// 附带: 上时间轴物件数字 fillText 位图缓存 fillTextCached (密集谱面 6s 窗口 600+ 次/帧, 字形光栅热点)。
// 实测 (verifier/v245/profile.mjs, 无头 Edge RTX4090 硬件加速):
//   2K 窗口 dsf1.5: C 静止 203.6→239.3fps, D 播放 216.5→237.7fps, A/B 顶满 240;
//   场景E 密集播放 (PROFILE_E_INTERVAL): 20/s (300BPM 1/4 连打级) = 239.5fps, 40/s = 217fps,
//   100/s ≈ 113fps — 同屏 ~220 物件缩圈 overdraw 的光栅面积上限 (draw call 合成缓存实测无效已回退),
//   超真实谱面密度 5 倍以上, 判定为 canvas2d 物理上限。
// 运行: node verifier/v246/check.mjs; 探针: fillrect-probe.mjs / area-probe.mjs / gpu-probe.mjs / shot.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('uiZoom.ts: fitCanvas backing 取整');
{
  const src = readSrc('src/osu/uiZoom.ts');
  assert(/export function fitCanvas\(c: HTMLCanvasElement, r: LayoutRect\)/.test(src), 'fitCanvas 导出');
  assert(/Math\.round\(r\.width \* dpr\)/.test(src) && /Math\.round\(r\.height \* dpr\)/.test(src), 'backing 宽高 round 到整数像素');
  assert(/if \(c\.width !== bw \|\| c\.height !== bh\) \{ c\.width = bw; c\.height = bh; \}/.test(src), '仅尺寸变化时才重设 (不再每帧重建)');
  assert(/return \{ sx: bw \/ r\.width, sy: bh \/ r\.height \}/.test(src), '返回精确变换系数 sx/sy');
}

section('三处画布统一走 fitCanvas (旧分数比较模式已移除)');
{
  const ec = readSrc('src/components/EditorCanvas.tsx');
  const tl = readSrc('src/components/Timelines.tsx');
  assert(/const \{ sx, sy \} = fitCanvas\(c, r\);/.test(ec) && /g\.setTransform\(sx, 0, 0, sy, 0, 0\);/.test(ec),
    'EditorCanvas 主画布 fitCanvas');
  assert((tl.match(/fitCanvas\(c, r\)/g) ?? []).length === 2, 'Timelines 上/下时间轴两处 fitCanvas');
  const oldPattern = /c\.width !== r\.width \* dpr/;
  assert(!oldPattern.test(ec) && !oldPattern.test(tl), '旧分数比较 (每帧重建位图) 已全部移除');
}

section('EditorCanvas.tsx: 静态层裁剪到游玩区设备矩形');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const M = 8;/.test(src) && /PW \* m0\.a/.test(src) && /PH \* m0\.d/.test(src), '游玩区设备矩形 + 8px 边距');
  assert(/Math\.min\(c\.width,/.test(src) && /Math\.min\(c\.height,/.test(src), '矩形裁剪到画布内');
  assert(/lg\.setTransform\(m0\.a, m0\.b, m0\.c, m0\.d, m0\.e - rx, m0\.f - ry\)/.test(src), '层内变换平移减掉层原点');
  assert(/if \(rw > 0 && rh > 0\)/.test(src), '游玩区完全在画布外时不贴');
}

section('renderer.ts: 选中装饰层裁剪到内容包围盒');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/const pad = radius \* 2 \+ 16;/.test(src), '包围盒边距 = 2r+16 osu px');
  assert(/o\.type === 'slider' \? getSliderPath\(bm, o\)\.points/.test(src), '滑条取路径点 (含弧鼓出) 求包围盒');
  assert(/selLayer\.empty = rw <= 0 \|\| rh <= 0/.test(src) && /if \(selLayer\.empty\) return;/.test(src),
    '选区完全在画布外 → 空层不贴图');
  assert(/lg\.setTransform\(m\.a, m\.b, m\.c, m\.d, m\.e - rx, m\.f - ry\)/.test(src), '层内变换平移减掉层原点');
}

section('waveformDraw.ts: 波形逐列 fillRect 合批 (探针实测头号热点)');
{
  const src = readSrc('src/osu/waveformDraw.ts');
  assert(/g\.beginPath\(\);[\s\S]*?g\.rect\(cx, yTop, 1, Math\.max\(1, yBot - yTop\)\);[\s\S]*?g\.fill\(\);/.test(src),
    '波形列汇成单路径一次 fill');
  assert(!/g\.fillRect\(cx, yTop/.test(src), '逐列 fillRect 已移除');
}

section('Timelines.tsx: 时间轴物件数字 fillText 位图缓存');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/const textSpriteCache = new Map<string, HTMLCanvasElement>\(\)/.test(src), 'textSpriteCache 存在');
  assert(/fillTextCached\(g, st\.number, sx, cy \+ 1\)/.test(src), 'drawTimelineObject 数字走位图缓存');
}

if (failures) { console.error(`\nV246_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV246_ALL_PASSED');
