// 验证器 v143: followpoint 序列帧默认帧时长修正 — 1000/帧数 (皮肤 a(No hitsound) 连线断裂修复)
// 背景: 该皮肤 followpoint-0..9.png 共 10 帧, 仅 4-6 为箭头 (其余 1x1 空白占位), 靠帧节奏控制亮灭。
//   lazer LegacySkinExtensions.getFrameLength: applyConfigFrameRate=true (followpoint) 且 skin.ini
//   无 AnimationFramerate 时, 默认帧时长 = 1000/textures.Length (整组 1 秒一轮);
//   SIXTY_FRAME_TIME (1000/60) 只用于 applyConfigFrameRate=false 的路径。
//   v131 误取 SIXTY_FRAME_TIME → 亮灭快 6 倍, 相邻点帧相位错开, 静态时刻只剩零星可见点 → 连线看似断裂。
// 运行: node verifier/v143/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('skin.ts: followpoint 帧时长 = 1000/rate 或 1000/帧数 (lazer getFrameLength)');
{
  const src = readSrc('src/osu/skin.ts');
  assert(/skin\.followpointFrameMs = iniRate > 0 \? 1000 \/ iniRate : 1000 \/ frames\.length/.test(src), '无 skin.ini 时默认 1000/帧数 (整组 1 秒一轮)');
  assert(!/1000 \/ iniRate : 1000 \/ 60/.test(src), 'v131 误取的 SIXTY_FRAME_TIME (1000/60) 默认已移除');
  assert(/getFrameLength/.test(src), '注释标明 lazer getFrameLength 依据');
  assert(/applyConfigFrameRate/.test(src), '注释标明 applyConfigFrameRate 语义');
  // 10 帧皮肤语义: 整圈 1000ms, 箭头帧 4-6 可见 300ms/轮 — 相邻点相位差 (32/间距*间隔) 远小于可见窗, 连线连续
  assert(/followpointFrames = frames/.test(src) && /followpoint = frames\[0\]/.test(src), '序列帧优先通道不变 (v131)');
}

section('渲染/点位逻辑不变');
{
  const rn = readSrc('src/osu/renderer.ts');
  assert(/followPointFrameIndex\(frames\.length, skin\.followpointFrameMs, time, p\.animStart\)/.test(rn), '按帧选图逻辑不变');
  const fp = readSrc('src/osu/followPoints.ts');
  assert(/export function followPointFrameIndex/.test(fp) && /animStart: fadeInTime/.test(fp), '帧序号/animStart 语义不变 (v47)');
}

console.log(failures ? `\nV143_CHECK_FAILED: ${failures}` : '\nV143_CHECK_PASSED');
process.exit(failures ? 1 : 0);
