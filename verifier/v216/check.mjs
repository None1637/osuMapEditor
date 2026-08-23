// 验证器 v216: 播放中滚轮 seek 音质修复 — 防咔哒从"共享音乐总线 dip"改为
// "per-source 交叉淡变 (sourceGain) / 变速支路 dip (tempoGain)"。
// 根因: seekWhilePlaying 每次滚轮步进都把共享 musicBus 增益 setTargetAtTime(0, τ=1.5ms)
// 瞬时拉零再恢复, 滚轮连击 = 全轨反复静音 + cancelScheduledValues 截断恢复斜坡,
// 听感 = 断续发闷, 类似低码率/削频 (暂停再播放不走此路径, 故正常)。
// 运行: node verifier/v216/check.mjs
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
const playBody = src.slice(src.indexOf('play() {'), src.indexOf('pause() {'));
const stopBody = src.slice(src.indexOf('private stopSource()'), src.indexOf('private stopSource()') + 600);

section('字段: sourceGain / tempoGain');
{
  assert(/private sourceGain: GainNode \| null = null;/.test(src), 'sourceGain 字段声明');
  assert(/private tempoGain: GainNode \| null = null;/.test(src), 'tempoGain 字段声明');
}

section('seekWhilePlaying: 移除总线 dip, 改交叉淡变');
{
  assert(!/bus\.gain\.(cancelScheduledValues|setTargetAtTime)/.test(seekBody), 'seek 不再触碰共享音乐总线增益');
  assert(/this\.sourceGain\.gain\.cancelScheduledValues\(now\);/.test(seekBody), '旧 sourceGain 取消旧自动化');
  assert(/this\.sourceGain\.gain\.setTargetAtTime\(0, now, 0\.004\)/.test(seekBody), '旧 source ~12ms 淡出');
  assert(/this\.source\.stop\(now \+ 0\.05\)/.test(seekBody), '旧 source 淡出后停止 (非瞬时硬切)');
  assert(/sg\.gain\.setValueAtTime\(0, now\);/.test(seekBody), '新 sourceGain 从 0 开始');
  assert(/sg\.gain\.setTargetAtTime\(1, startW, 0\.003\)/.test(seekBody), '新 source ~10ms 淡入');
  assert(/src\.connect\(sg\);\s*\n\s*sg\.connect\(bus\);/.test(seekBody), '新 source → sourceGain → 音乐总线');
  assert(/this\.sourceGain = sg;/.test(seekBody), 'sourceGain 随 source 登记');
}

section('seekWhilePlaying: 变速支路只 dip tempoGain');
{
  assert(/tg\.setTargetAtTime\(0, actx\.currentTime, 0\.0015\)/.test(seekBody), '变速支路 dip tempoGain (防咔哒保留)');
  assert(/tg\.setTargetAtTime\(1, actx\.currentTime \+ 0\.005, 0\.002\)/.test(seekBody), '变速支路恢复目标 = 1 (支路增益, 非 musicGain)');
}

section('play(): source 经 sourceGain');
{
  assert(/const sg = this\.actx!\.createGain\(\)/.test(playBody), 'play 创建 sourceGain');
  assert(/sg\.gain\.setTargetAtTime\(1, startW, 0\.003\)/.test(playBody), 'play 启动 ~10ms 淡入防咔哒');
  assert(/src\.connect\(sg\);\s*\n\s*sg\.connect\(this\.ensureMusicBus\(\)\);/.test(playBody), 'play: source → sourceGain → 音乐总线');
  assert(/this\.sourceGain = sg;/.test(playBody), 'play 登记 sourceGain');
}

section('stopSource / ensureTempoNode / setAudio');
{
  assert(/this\.sourceGain\.disconnect\(\)/.test(stopBody) && /this\.sourceGain = null;/.test(stopBody), 'stopSource 释放 sourceGain');
  assert(/an\.connect\(g\);\s*\n\s*g\.connect\(this\.ensureMusicBus\(\)\)/.test(src), 'tempoNode → analyser → tempoGain → 音乐总线');
  assert(/this\.tempoGain = g;/.test(src), 'ensureTempoNode 登记 tempoGain');
  assert(/this\.tempoNode = null; this\.tempoAnalyser = null; this\.tempoGain = null;/.test(src), 'setAudio 换歌时清空 tempoGain');
}

section('回归: 既有语义保留');
{
  assert(/actx\.currentTime \+ 0\.004/.test(seekBody), 'v193: 即时启动 (4ms 锚定)');
  assert(/this\.stopAllHitVoices\(\);[^\n]*\n[^\n]*this\.scheduler\?\.resync\(\);/.test(seekBody), 'v198: resync 前停旧区间 hitsound');
  assert(/this\.clock\.onStartedAtCtxTime\(startW, t\)/.test(seekBody), 'v193: 时钟重锚定');
  assert(!seekBody.includes('this.play()'), 'v193: 不重启播放引擎');
}

if (failures) { console.error(`V216 FAILED: ${failures}`); process.exit(1); }
console.log('V216 ALL PASSED');
