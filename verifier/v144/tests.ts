// 验证器 v144: 音量增益纯函数 (localStorage 在 node 不存在 — 模块加载已 try/catch 兜底)
import { volumeSettings, setVolume, musicGain, effectsGain } from '@/osu/volumeSettings';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

section('增益计算 (主 × 歌曲/音效)');
{
  assert(volumeSettings.master === 100 && volumeSettings.music === 100 && volumeSettings.effects === 100, '默认全 100');
  assert(musicGain() === 1 && effectsGain() === 1, '默认增益 1');
  setVolume('master', 50);
  assert(musicGain() === 0.5 && effectsGain() === 0.5, '主 50% → 两路各 0.5');
  setVolume('music', 50);
  assert(musicGain() === 0.25 && effectsGain() === 0.5, '歌曲 50% → 音乐 0.25, 音效不变');
  setVolume('effects', 20);
  assert(Math.abs(effectsGain() - 0.1) < 1e-9 && musicGain() === 0.25, '音效 20% → 音效 0.1, 音乐不变');
  setVolume('music', 0);
  assert(musicGain() === 0, '歌曲 0 → 静音');
  setVolume('music', 150);
  assert(volumeSettings.music === 100, '钳制上限 100');
  setVolume('music', -5);
  assert(volumeSettings.music === 0, '钳制下限 0');
  setVolume('music', 33.7);
  assert(volumeSettings.music === 34, '取整');
}

if (failures) { console.error(`\nV144_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV144_TESTS_ALL_PASSED');
