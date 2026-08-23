// 验证器 v47 纯函数测试: followpoint 序列帧动画帧序号 (lazer SkinnableTextureAnimation 语义)
import { followPointFrameIndex } from '../../src/osu/followPoints';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

section('followPointFrameIndex: PlaybackPosition = time - animStart, 循环');
{
  // 10 帧, frameMs=100 (无 skin.ini 时 1000/10): animStart=940
  assert(followPointFrameIndex(10, 100, 940, 940) === 0, 'animStart 时刻 = 帧 0');
  assert(followPointFrameIndex(10, 100, 1039, 940) === 0, '99ms 内仍是帧 0');
  assert(followPointFrameIndex(10, 100, 1040, 940) === 1, '100ms -> 帧 1');
  assert(followPointFrameIndex(10, 100, 1340, 940) === 4, '400ms -> 帧 4 (用户皮肤: 首个非空白帧)');
  assert(followPointFrameIndex(10, 100, 1640, 940) === 7, '700ms -> 帧 7 (回到空白帧)');
  assert(followPointFrameIndex(10, 100, 1940, 940) === 0, '1000ms 整圈 -> 帧 0 (循环)');
  assert(followPointFrameIndex(10, 100, 2340, 940) === 4, '1400ms -> 帧 4 (第二圈)');
  // skin.ini AnimationFramerate: 20 -> frameMs=50
  assert(followPointFrameIndex(10, 50, 1700, 940) === 5, 'frameMs=50: 760ms -> 帧 15%10=5');
  // 负 playback (理论兜底, 实际绘制时 time >= fadeInTime 不出现)
  assert(followPointFrameIndex(10, 100, 900, 940) === 9, '负 playback (-40ms -> 帧 -1) 取模回卷为帧 9');
}

if (failures) { console.error(`\nTESTS_V47_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V47_ALL_PASSED');
