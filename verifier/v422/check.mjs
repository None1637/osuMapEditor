// 验证器 v422: 测试游玩 — 被动掉血 (HP drain)
//  - 游玩中随时间缓慢掉血, 速率 = hpDrainRate × 0.018/s (需求给定参考量纲; EZ/HR 调过的 hp 直接用);
//  - 首物件前与 break 段内不掉血; 血量钳 [0,1], 永不失败规则不变 (掉空不判负);
//  - 取舍: lazer DrainingHealthProcessor 实为按谱面二元搜索自适应速率 (目标最低血 HP5≈90%),
//    此处按指定量纲实现, 偏激进但简单 (注释已注明)。
// 运行: node verifier/v422/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v422/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v422/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V422_TESTS_*)
fs.unlinkSync(out);

const hud = read('src/osu/gameplay/hud.ts');
assert(/export function hpDrainPerMs/.test(hud) && /hp \* 0\.018 \/ 1000/.test(hud), '速率 = hp × 0.018/s');
assert(/DrainingHealthProcessor/.test(hud), '注释注明 lazer 出处与取舍');

const judge = read('src/osu/gameplay/judgement.ts');
assert(/v422: 被动掉血/.test(judge) && /drain\(amount: number\)/.test(judge), 'TestScore.drain 方法');
assert(/this\.hp = Math\.min\(1, Math\.max\(0, this\.hp - amount\)\)/.test(judge), '血量钳 [0,1]');

const sess = read('src/osu/gameplay/testPlaySession.ts');
assert(/time >= this\.firstTime && !this\.inBreak\(time\)/.test(sess), '首物件前/break 段内不掉血');
assert(/time > this\.drainT/.test(sess), '时间倒退不掉血 (seek 防护)');
assert(/this\.score\.drain\(hpDrainPerMs\(this\.bm\.difficulty\.hp\)/.test(sess), '用调整后的 hp 值按帧差结算');

console.log(failures ? `\nVERIFIER_V422_FAILED: ${failures} 处失败` : '\nVERIFIER_V422_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
