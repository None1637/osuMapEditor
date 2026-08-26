// 验证器 v193: 滚轮 seek 对齐 lazer — 刻度累积 (Editor.OnScroll) + 播放中不吸附大步长 +
// 播放中轻量重定位 (不 pause/play 整轨重启, lazer ChannelSetPosition 语义)
// 运行: node verifier/v193/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v193/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v193/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V193_TESTS_*)
fs.unlinkSync(out);

section('seekSnapping.ts: 累积器 + 播放中步长');
{
  const src = readSrc('src/osu/seekSnapping.ts');
  assert(/export const WHEEL_PRECISION = 120/.test(src), 'WHEEL_PRECISION = 120px (一刻度)');
  assert(/export function wheelSteps/.test(src), '导出 wheelSteps');
  assert(/export function playingWheelStepMs/.test(src), '导出 playingWheelStepMs');
  assert(/Math\.floor\(250 \/ Math\.floor\(bl\)\)/.test(src), '250/(int)BeatLength 整数除法语义');
}

section('store.ts: wheelSeek + seekWhilePlaying');
{
  const src = readSrc('src/osu/store.ts');
  assert(/wheelSeek\(deltaY: number, deltaMode: number\)/.test(src), 'wheelSeek 总入口');
  assert(/seekWhilePlaying\(t: number\)/.test(src), 'seekWhilePlaying 存在');
  // 播放中轻量重定位: 方法体内不 pause/play 整轨重启
  const body = src.slice(src.indexOf('seekWhilePlaying(t: number)'), src.indexOf('play() {'));
  assert(!/this\.pause\(\);\s*this\.currentTime = t;\s*this\.play\(\)/.test(body), '不走 pause+play 整轨重启');
  assert(!body.includes('this.play()'), '不重启播放引擎');
  assert(/now \+ 0\.00[34]/.test(body), '即时启动 (≤4ms 锚定, 非 20ms 延迟; v226 改 3ms 切换时刻)');
  assert(!/bus\.gain\.setTargetAtTime/.test(body), 'v216: 不再 dip 共享音乐总线 (滚轮连击全轨静音 → 听感破碎)');
  // v226: 交叉淡变已被硬切换 (2ms 防爆音斜坡) 取代 — 连击时多份"同曲不同进度"链式重叠 = 持续降质
  assert(/og\.linearRampToValueAtTime\(0, startW \+ 0\.002\)/.test(body), 'v226: 旧 source 2ms 斜降到 0 (硬切换)');
  assert(/sg\.gain\.linearRampToValueAtTime\(1, startW \+ 0\.002\)/.test(body), 'v226: 新 source 2ms 斜升到 1 (硬切换)');
  assert(/stopAllHitVoices\(\);[^\n]*\n[^\n]*scheduler\?\.resync/.test(body), 'v198 起: seek 停掉旧区间已排程 hitsound (对齐 lazer seek 静音, 原"不停 voice"行为被反转)');
  assert(/this\.clock\.onStartedAtCtxTime\(startW, t\)/.test(body), '时钟重锚定');
  assert(/this\.scheduler\?\.resync\(\)/.test(body), 'hitsound 排程器重同步 (seek 帧不触发旧位置采样)');
}

section('三处滚轮入口收敛');
{
  const canvas = readSrc('src/components/EditorCanvas.tsx');
  const tl = readSrc('src/components/Timelines.tsx');
  assert(/store\.wheelSeek\(e\.deltaY, e\.deltaMode\)/.test(canvas), '游玩区 onWheel → wheelSeek');
  assert((tl.match(/store\.wheelSeek\(e\.deltaY, e\.deltaMode\)/g) ?? []).length === 2, '上/下时间轴 onWheel → wheelSeek');
  assert(!/seekByBeats/.test(canvas), 'EditorCanvas 不再直接调 seekByBeats');
  assert(!/seekByBeats/.test(tl), 'Timelines 不再直接调 seekByBeats');
}

if (failures) { console.error(`V193 FAILED: ${failures}`); process.exit(1); }
console.log('V193 ALL PASSED');
