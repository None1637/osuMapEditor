// v59 接线断言: 底部右侧倍速 UI (lazer PlaybackControl.PlaybackTabControl)
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(t) { console.log('== ' + t); }
const readSrc = (rel) => fs.readFileSync(path.join(appRoot, rel), 'utf8');

section('Timelines.tsx: 底栏右侧倍速页签 (lazer PlaybackControl: BottomBarContainer 右侧)');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/\[0\.25, 0\.5, 0\.75, 1\]\.map/.test(src), '四档 0.25/0.5/0.75/1.00 (lazer tempo_values)');
  assert(/data-speed-input=\{v\}/.test(src), 'data-speed-input 可测');
  assert(/\{v \* 100\}%/.test(src), '百分比显示 (lazer value:0% -> 25%/50%/75%/100%)');
  assert(/store\.setRate\(v\)/.test(src), '点击调 store.setRate');
  assert(/store\.playbackRate === v/.test(src) && /font-bold/.test(src), '激活页签加粗高亮 (lazer textBold FadeTo)');
  const iBar = src.indexOf('export function BottomTimeline');
  const iSpeed = src.indexOf('data-speed-input={v}');
  assert(iBar > 0 && iSpeed > iBar, '页签在 BottomTimeline 内 (底栏)');
}

section('store.ts: setRate 已就绪 (播放中切换重启 source 重锚定)');
{
  const src = readSrc('src/osu/store.ts');
  assert(/setRate\(rate: number\)/.test(src), 'setRate 存在');
  assert(/src\.playbackRate\.value = this\.playbackRate/.test(src), 'WebAudio source playbackRate 接线');
  assert(/clock\.rate = this\.playbackRate/.test(src), 'AudioClock.rate 接线 (位置推算随倍速)');
}

section('tsc -b 通过');
{
  try { execSync('npx tsc -b', { cwd: appRoot, stdio: 'pipe' }); assert(true, 'npx tsc -b'); }
  catch (e) { assert(false, 'npx tsc -b: ' + String(e.stdout ?? e).slice(0, 400)); }
}

if (failures) { console.error(`\nVERIFIER_V59_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V59_ALL_PASSED');
