// 验证器 v261: 恢复播放防闪回。
// 需求: soulten「暫停後撥放的瞬間 會突然顯示更早時間軸的畫面」。
// 根因: play() 锚定 startW = ctx 现在 +20ms 启动 (v216 确定性锚定), positionMs 渲染取
//   heardNowMs = rawNow - outputLatency (~5-40ms) — 启动后最初几帧渲染位置比暂停点早几十 ms,
//   画面瞬间跳回更早内容。
// 修复: play() 记录 resumeFloorMs = 暂停点; positionMs 钳制渲染位置不低于该下限,
//   时钟自然超过后自清; pause() 清除。hitsound 排程走 rawNowMs/ctxTimeForMapTime 不受影响。
// 运行: node verifier/v261/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
assert(/resumeFloorMs: number \| null = null;/.test(src), 'resumeFloorMs 字段声明');
assert(/this\.resumeFloorMs = this\.currentTime; \/\/ v261/.test(src), 'play() 记录暂停点为下限');
const pos = src.match(/positionMs\(\): number \{[\s\S]{0,900}?\n  \}/)?.[0] ?? '';
assert(/v261: 恢复播放防闪回/.test(pos), 'positionMs 内 v261 注释');
assert(/if \(h < this\.resumeFloorMs\) return this\.resumeFloorMs;/.test(pos), '渲染位置钳制不低于暂停点');
assert(/this\.resumeFloorMs = null;/.test(pos), '时钟超过后自清');
const pause = src.match(/pause\(\) \{[\s\S]{0,400}?this\.playing = false;/)?.[0] ?? '';
assert(/this\.resumeFloorMs = null; \/\/ v261: 暂停即失效/.test(pause), 'pause() 清除下限');

if (failures) { console.error(`\nV261_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV261_ALL_PASSED');
