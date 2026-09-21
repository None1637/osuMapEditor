// 验证器 v60: 变速不变调 (signalsmith-stretch WASM/AudioWorklet 引擎 + HTMLAudio preservesPitch)
// 运行: cd app && node verifier/v60/check.mjs; node verifier/v60/cdp-v60.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v60/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v60/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('WSOLA 手写实现已移除');
{
  assert(!fs.existsSync(path.join(root, 'src/osu/clock/wsola.ts')), 'wsola.ts 已删除 (被 signalsmith-stretch 替代)');
  assert(!/wsola/i.test(readSrc('src/osu/store.ts')), 'store.ts 无 WSOLA 残留引用');
}

section('tempoWorklet.ts: signalsmith-stretch 封装');
{
  const src = readSrc('src/osu/clock/tempoWorklet.ts');
  assert(/import SignalsmithStretch from 'signalsmith-stretch'/.test(src), '引入官方包 (npm: signalsmith-stretch, MIT)');
  assert(/export interface TempoNode extends AudioWorkletNode/.test(src), 'TempoNode 类型 (包无 TS 声明)');
  assert(/schedule\(obj: TempoSchedule\)/.test(src) && /addBuffers\(/.test(src) && /latency\(\)/.test(src), 'schedule/addBuffers/latency API');
  assert(/export async function createTempoNode/.test(src), 'createTempoNode 工厂');
  assert(/numberOfInputs = 1/.test(src), '注明必须 numberOfInputs=1 (buffer 模式, 0 会崩)');
  assert(fs.existsSync(path.join(root, 'src/types/signalsmith-stretch.d.ts')), '模块声明文件存在');
}

section('store.ts: tempo 引擎接线');
{
  const src = readSrc('src/osu/store.ts');
  assert(/private tempoNode: TempoNode \| null/.test(src), 'tempoNode 字段 (TempoNode 类型)');
  assert(/await createTempoNode\(actx\)/.test(src), '创建 signalsmith 节点');
  assert(/await node\.addBuffers\(rc === lc \? \[lc\] : \[lc, rc\]/.test(src), 'PCM 移交节点内部缓冲 (buffer 模式, transferable)');
  assert(/an\.fftSize = 4096/.test(src) && /node\.connect\(an\)/.test(src), 'AnalyserNode 频谱验证钩子保留');
  assert(/this\.playbackRate !== 1 && this\.tempoNode/.test(src), 'rate≠1 且引擎就绪 -> tempo 路径');
  assert(/this\.tempoNode\.schedule\(\{ output: startW, input: offset, rate: this\.playbackRate, active: true \}\)/.test(src), 'schedule 锚定 startW/offset/rate (节点自补偿延迟, 与 source.start 同语义)');
  assert(/tempoEndTimer = setTimeout/.test(src) && /不能提前 schedule 一个未来 stop/.test(src), '播完: 定时器播完逻辑 + 到点 stop (替代 ended 回执; 未来 stop 会吞掉 start, 已注明)');
  assert(/clearTimeout\(this\.tempoEndTimer\)/.test(src) && /this\.tempoNode\.stop\(\)/.test(src), 'stopSource 清定时器并 stop 节点');
  assert(/clock\.rate = this\.playbackRate/.test(src) && /clock\.onStartedAtCtxTime\(startW, offset \* 1000\)/.test(src), '时钟锚定与 source 路径一致 (v251: 锚定到采样网格吸附后的 offset, 与 source.start 同一值)');
  assert(/this\.audioBuffer !== buf/.test(src), '加载期间换歌守卫');
  assert(/ensureTempoNode\(\); \/\/ 预热/.test(src), '解码完成预热引擎');
  assert(/this\.audio\.preservesPitch = true/.test(src) && /webkitPreservesPitch/.test(src), 'HTMLAudio 降级路径 preservesPitch (浏览器原生不变调)');
  assert(/tempoReady: !!this\.tempoNode/.test(src) && /tempoActive: this\.tempoActive/.test(src), 'debugState 暴露 tempo 状态');
  assert(/this\.tempoNode = null; this\.tempoAnalyser = null/.test(src), '换歌销毁旧节点 (持有旧 PCM)');
  assert(/dependencies/.test(readSrc('package.json')) && /"signalsmith-stretch":/.test(readSrc('package.json')), 'package.json 依赖 signalsmith-stretch');
}

section('Timelines.tsx: 倍速控件提示不变调');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/变速不变调 signalsmith-stretch/.test(src), 'tooltip 标注不变调');
}

if (failures) { console.error(`\nVERIFIER_V60_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V60_ALL_PASSED');
