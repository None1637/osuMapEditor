// v122 源码接线断言: hitsound 修复 — 密集段消音 (预排程不占名额 + 淡出让位) + 暂停时音效一起停
// 运行: node verifier/v122/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const limiter = read('src/osu/clock/voiceLimiter.ts');
const store = read('src/osu/store.ts');

// 消音修复: register 只数与新 voice 同时发声的旧 voice
assert(/const sounding = q\.filter\(e => e !== entry && e\.start <= start && start < e\.end\);/.test(limiter), 'limiter: 只统计同时发声的 voice');
assert(/drain\(\): VoiceEntry<V>\[\]/.test(limiter), 'limiter: drain (暂停清空)');
// store: 发声起点 = max(排程时刻, 现在), 两处出声点都带 gain + startCtx
assert((store.match(/this\.trackVoice\(buf, src, gain, Math\.max\(at, this\.actx\.currentTime\)/g) || []).length === 2, '两处出声点: 发声起点 max(at, now)');
assert(/old\.v\.gain\.gain\.setTargetAtTime\(0, startCtx, 0\.008\)/.test(store), '被逐出 voice: ~25ms 淡出让位 (防咔哒)');
assert(/old\.v\.src\.stop\(startCtx \+ 0\.05\)/.test(store), '被逐出 voice: 淡出后停止');

// 暂停修复: stopAllHitVoices 接进 stopSource (暂停/换谱/变速重启都经此处)
// v251: 改走 allHitVoices 主集 (含被限流器逐出的 voice), drain 只负责清空限流器队列
assert(/private stopAllHitVoices\(\) \{\s*this\.voiceLimiter\.drain\(\);[^\n]*\n\s*for \(const v of this\.allHitVoices\) \{ try \{ v\.src\.stop\(\); \}/.test(store), 'stopAllHitVoices: drain 限流器 + 停止主集全部 voice (v251)');
assert(/private allHitVoices = new Set<\{ src: AudioBufferSourceNode; gain: GainNode \}>\(\)/.test(store), 'allHitVoices 主集定义 (v251)');
assert(/this\.stopAllHitVoices\(\); \/\/ v122: 引擎停止时 hitsound 一起停/.test(store), 'stopSource: 引擎停止时 hitsound 一起停');
assert(/pause\(\) \{[\s\S]{0,420}this\.stopSource\(\);/.test(store), 'pause 经 stopSource 停 hitsound'); // v261 适配: pause 内插入 resumeFloorMs 清除行, 窗口 260→420
assert(/this\.scheduler\?\.setMuted\(true\)/.test(store), 'pause: 排程器静音 (不再新排程)');

// 恢复播放: resync 从头重算游标 (暂停窗内被杀的 voice 重新排程)
const sched = read('src/osu/clock/HitSoundScheduler.ts');
assert(/resync\(\) \{\s*const now = this\.clock\.rawNowMs\(\);\s*this\.cursor = 0;/.test(sched), 'resync: 游标从头重算 (恢复后重排暂停窗内的音效)');
assert(/this\.scheduler\?\.resync\(\);/.test(store), 'play: resync 重排');

console.log(failures ? `\nV122_CHECK_FAILED: ${failures}` : '\nV122_CHECK_PASSED');
process.exit(failures ? 1 : 0);
