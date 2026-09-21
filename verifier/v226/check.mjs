// 验证器 v226: 播放中滚轮 seek 音质再修复 — v216 交叉淡变改回硬切换 (2ms 防爆音斜坡)。
// 根因: v216 的 ~10-20ms 交叉淡变单次 seek 不可闻, 但滚轮连击时链式重叠 — 任意瞬间
// 2~4 份"同曲不同进度"同时发声 (播放中步长 ~0.5s/格), 听感 = 持续双重曝光/响度抽动;
// 时间轴点击 seek 走 pause/play 零重叠硬切, 故不复现 (用户反馈原话)。
// 修复: 统一切换时刻 startW = now+3ms; 旧源 2ms 斜降到 0、startW+10ms 停止;
//       新源 startW 启动、2ms 斜升到 1; 重叠窗 ~2ms 仅防爆音。变速支路 dip 缩为贴紧
//       切换点的单次 ~5ms 短窗 (不再"立即拉零 + 延迟恢复")。
// 运行: node verifier/v226/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const src = readSrc('src/osu/store.ts');
const seekBody = src.slice(src.indexOf('seekWhilePlaying(t: number)'), src.indexOf('play() {'));

section('seekWhilePlaying: 硬切换 (常速支路)');
{
  assert(/const now = actx\.currentTime;\s*\n[\s\S]*?const startW = Math\.round\(\(now \+ 0\.003\) \* sr\) \/ sr;/.test(seekBody), '统一切换时刻 startW = now+3ms (v251: 吸附到采样整数)');
  assert(/og\.cancelScheduledValues\(now\);/.test(seekBody), '旧 sourceGain 取消旧自动化');
  assert(/og\.setValueAtTime\(og\.value, now\);/.test(seekBody), '旧源从当前增益值起斜坡 (防跳变)');
  assert(/og\.linearRampToValueAtTime\(0, startW \+ 0\.002\)/.test(seekBody), '旧源 2ms 斜降到 0');
  assert(/this\.source\.stop\(startW \+ 0\.01\)/.test(seekBody), '旧源 startW+10ms 停止 (紧贴切换点, 非 50ms 长尾)');
  assert(!/setTargetAtTime\(0, now, 0\.004\)/.test(seekBody), 'v216 交叉淡变淡出已移除');
  assert(!/\.stop\(now \+ 0\.05\)/.test(seekBody), 'v216 旧源 50ms 延迟停止已移除');
  assert(/sg\.gain\.setValueAtTime\(0, now\);/.test(seekBody), '新 sourceGain 从 0 开始');
  assert(/sg\.gain\.linearRampToValueAtTime\(1, startW \+ 0\.002\)/.test(seekBody), '新源 2ms 斜升到 1');
  assert(!/sg\.gain\.setTargetAtTime\(1, startW/.test(seekBody), 'v216 新源 ~10ms 指数淡入已移除');
  assert(/src\.start\(startW, offset\);/.test(seekBody), '新源 startW 启动');
  assert(!/bus\.gain\.(cancelScheduledValues|setTargetAtTime|linearRamp)/.test(seekBody), '共享音乐总线增益全程不动 (v216 语义保留)');
}

section('seekWhilePlaying: 变速支路单次短 dip');
{
  assert(/tg\.cancelScheduledValues\(now\);/.test(seekBody), 'tempoGain 取消旧自动化');
  assert(/tg\.setValueAtTime\(tg\.value, now\);/.test(seekBody), '从当前值起斜坡');
  assert(/tg\.linearRampToValueAtTime\(0, startW\);/.test(seekBody), 'dip 到 0 对齐切换点');
  assert(/tg\.linearRampToValueAtTime\(1, startW \+ 0\.002\);/.test(seekBody), '切换后 2ms 恢复 (单次 ~5ms 短窗)');
  assert(!/tg\.setTargetAtTime/.test(seekBody), 'v216 "立即拉零+延迟恢复" 指数 dip 已移除');
}

section('回归: 既有语义保留');
{
  assert(/this\.clock\.onStartedAtCtxTime\(startW, t\)/.test(seekBody), 'v193: 时钟重锚定');
  assert(/this\.stopAllHitVoices\(\);[^\n]*\n[^\n]*this\.scheduler\?\.resync\(\);/.test(seekBody), 'v198: resync 前停旧区间 hitsound');
  assert(!seekBody.includes('this.play()'), 'v193: 不重启播放引擎');
  assert(/this\.tempoNode\.schedule\(\{ output: startW, input: offset/.test(seekBody), '变速支路 schedule 锚点 = startW');
}

if (failures) { console.error(`V226 FAILED: ${failures}`); process.exit(1); }
console.log('V226 ALL PASSED');
