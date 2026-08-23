// 验证器 v60 测试: signalsmith-stretch (WASM) 变速不变调引擎
// 在 Node 沙箱中模拟 AudioWorkletGlobalScope, 加载官方包的真实 worklet 处理器
// (WASM 内嵌 base64, 无需浏览器), 按主线程消息协议驱动, 断言:
//   - 处理器注册/ready/延迟上报
//   - schedule 锚点精确 (冲激落点, 含 0.25x 与仅提前 20ms 排程) — 时钟映射无漂移的核心证据
//   - 变速后音高保持 (0.5x/0.25x 正弦基频不变; 变调路径会得到 1/2、1/4 频率)
//   - 起始前静音 / stop 后静音
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const SR = 44100;
const QUANTUM = 128;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---- 沙箱加载官方 worklet 处理器 ----
interface MockPort { onmessage: null | ((e: { data: unknown[] }) => void); msgs: unknown[][]; postMessage(m: unknown[]): void }
interface MockProcessor { port: MockPort; process(i: unknown[], o: Float32Array[][], p: unknown): boolean }
const pkgPath = path.join(root, 'node_modules/signalsmith-stretch/SignalsmithStretch.mjs');

function loadProcessorClass() {
  let code = fs.readFileSync(pkgPath, 'utf8');
  code = code.replace(/export default _export;?/, '');
  const scope: Record<string, unknown> = {
    sampleRate: SR,
    currentTime: 0,
    AudioWorkletProcessor: class {
      port: MockPort = { onmessage: null, msgs: [], postMessage(m: unknown[]) { this.msgs.push(m); } };
    },
    registerProcessor: (n: string, c: unknown) => { scope.__name = n; scope.__cls = c; },
  };
  new Function('scope', `with (scope) { ${code} }`)(scope);
  return scope as { __name: string; __cls: new (o: unknown) => MockProcessor; currentTime: number };
}

/** 创建实例并等 WASM ready */
async function createProc(scope: { __cls: new (o: unknown) => MockProcessor }) {
  const p = new scope.__cls({ numberOfOutputs: 1, outputChannelCount: [2] });
  for (let i = 0; i < 300 && !p.port.msgs.some(m => m[0] === 'ready'); i++) {
    await new Promise(r => setTimeout(r, 10));
  }
  return p;
}

/** 单频正弦 (+二次谐波, 近似旋律音) */
function tone(freq: number, sec: number): Float32Array {
  const n = Math.floor(sec * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    x[i] = Math.sin(2 * Math.PI * freq * t) * 0.8 + Math.sin(2 * Math.PI * freq * 2 * t) * 0.15;
  }
  return x;
}

/** 自相关法估计基频 (限 [minF, maxF]) */
function dominantFreq(x: Float32Array, s0: number, s1: number, minF = 300, maxF = 1200): number {
  let bestLag = 0, bestC = -Infinity;
  for (let lag = Math.floor(SR / maxF); lag <= Math.ceil(SR / minF); lag++) {
    let c = 0;
    for (let i = s0; i < s1 - lag; i++) c += x[i] * x[i + lag];
    if (c > bestC) { bestC = c; bestLag = lag; }
  }
  return SR / bestLag;
}

const rms = (a: Float32Array, s: number, e: number) => {
  let v = 0;
  for (let i = s; i < e; i++) v += a[i] * a[i];
  return Math.sqrt(v / Math.max(1, e - s));
};

/**
 * 端到端场景: 预渲染到 nowSec, 排程 start(startW, input 0, rate), 渲染至 durSec 并回收输出.
 * 输入列表形状模拟"节点有 1 个输入但未连接" (浏览器实际行为; numberOfInputs=0 会崩, 见 tempoWorklet.ts).
 */
async function runScenario(
  scope: { __cls: new (o: unknown) => MockProcessor; currentTime: number },
  pcm: Float32Array, rate: number, startW: number, renderUntil: number, nowSec = 0.5,
): Promise<{ out: Float32Array; proc: MockProcessor }> {
  const p = await createProc(scope);
  const send = (data: unknown[]) => p.port.onmessage!({ data });
  send([0, 'addBuffers', [pcm, pcm.slice()]]);
  const preBlocks = Math.round(nowSec * SR / QUANTUM);
  for (let b = 0; b < preBlocks; b++) {
    scope.currentTime = b * QUANTUM / SR;
    p.process([[]], [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]], {});
  }
  scope.currentTime = nowSec;
  send([1, 'schedule', { active: true, output: startW, input: 0, rate }]);
  const total = Math.ceil((renderUntil - nowSec) * SR / QUANTUM);
  const out = new Float32Array(total * QUANTUM);
  for (let b = 0; b < total; b++) {
    scope.currentTime = nowSec + b * QUANTUM / SR;
    const o = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    p.process([[]], [o], {});
    out.set(o[0], b * QUANTUM);
  }
  return { out, proc: p };
}

/** 冲激落点偏差 (ms): 冲激在输入 impSec, 期望可闻于 startW + impSec/rate */
async function impulseDeviationMs(scope: ReturnType<typeof loadProcessorClass>, rate: number, aheadSec: number): Promise<number> {
  const pcm = new Float32Array(SR * 2);
  pcm[SR] = 1; // 冲激 @ 输入 1.0s
  const startW = 0.5 + aheadSec;
  const expect = startW + 1.0 / rate;
  const { out } = await runScenario(scope, pcm, rate, startW, expect + 0.5);
  let peak = 0, pi = -1;
  for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > peak) { peak = a; pi = i; } }
  return (0.5 + pi / SR - expect) * 1000;
}

section('worklet 加载: 注册 / ready / 延迟上报');
{
  const scope = loadProcessorClass();
  assert(scope.__name === 'signalsmith-stretch', `处理器注册名 signalsmith-stretch (实际 ${scope.__name})`);
  const p = await createProc(scope);
  const ready = p.port.msgs.find(m => m[0] === 'ready');
  assert(!!ready, 'WASM 初始化后回执 ready');
  const methods = ready ? Object.keys(ready[1] as object) : [];
  for (const m of ['configure', 'latency', 'schedule', 'start', 'stop', 'addBuffers', 'dropBuffers', 'setUpdateInterval']) {
    assert(methods.includes(m), `暴露方法 ${m}`);
  }
  p.port.onmessage!({ data: [99, 'latency'] });
  const latMsg = p.port.msgs.find(m => m[0] === 99);
  const lat = latMsg ? (latMsg[1] as number) : -1;
  assert(lat > 0.05 && lat < 0.5, `默认 preset 总延迟 ~120ms (实际 ${(lat * 1000).toFixed(0)}ms) — 节点自补偿, app 无需另算`);
}

section('schedule 锚点: 冲激落点精确 (时钟映射无漂移的核心证据)');
{
  const d1 = await impulseDeviationMs(loadProcessorClass(), 1, 1.0);
  assert(Math.abs(d1) < 5, `rate=1 落点偏差 < 5ms (实际 ${d1.toFixed(1)}ms)`);
  const d2 = await impulseDeviationMs(loadProcessorClass(), 0.5, 1.0);
  assert(Math.abs(d2) < 5, `rate=0.5 落点偏差 < 5ms (实际 ${d2.toFixed(1)}ms)`);
  const d3 = await impulseDeviationMs(loadProcessorClass(), 0.25, 1.0);
  assert(Math.abs(d3) < 5, `rate=0.25 落点偏差 < 5ms (实际 ${d3.toFixed(1)}ms)`);
  const d4 = await impulseDeviationMs(loadProcessorClass(), 0.5, 0.02);
  assert(Math.abs(d4) < 5, `仅提前 20ms 排程 (app 实际用法) 落点偏差 < 5ms (实际 ${d4.toFixed(1)}ms)`);
}

section('rate=0.5: 时长翻倍, 音高不变, 起始前静音');
{
  const scope = loadProcessorClass();
  const startW = 1.0;
  const { out } = await runScenario(scope, tone(440, 2), 0.5, startW, 6.0, 0.5);
  // 起始前静音 (留 0.2s 余量避开 STFT 窗渗出的淡入沿)
  const preEnd = Math.floor((startW - 0.5 - 0.2) * SR);
  let preMax = 0;
  for (let i = 0; i < preEnd; i++) preMax = Math.max(preMax, Math.abs(out[i]));
  assert(preMax < 1e-6, `startW 前 0.2s 起严格静音 (峰值 ${preMax})`);
  // 有声持续 ~4s (2s 输入 0.5x): 末段 5.4s 后应静音
  const tailStart = Math.floor((5.6 - 0.5) * SR);
  let tailMax = 0;
  for (let i = tailStart; i < out.length; i++) tailMax = Math.max(tailMax, Math.abs(out[i]));
  assert(tailMax < 0.02, `4s 输出后收尾静音 (尾部峰值 ${tailMax.toFixed(4)})`);
  // 音高: 中段基频保持 440Hz (变调路径会得到 220Hz)
  const f = dominantFreq(out, Math.floor(2.5 * SR), Math.floor(3.0 * SR));
  assert(Math.abs(f - 440) < 15, `基频保持 440Hz ±15 (实际 ${f.toFixed(1)}Hz)`);
}

section('rate=0.25: 4 倍拉伸音高不变');
{
  const scope = loadProcessorClass();
  const { out } = await runScenario(scope, tone(523.25, 1.5), 0.25, 1.0, 7.5, 0.5);
  const f = dominantFreq(out, Math.floor(4.0 * SR), Math.floor(4.5 * SR));
  assert(Math.abs(f - 523.25) < 18, `基频保持 523.25Hz (实际 ${f.toFixed(1)}Hz; 变调路径会得到 130.8Hz)`);
}

section('stop: 播放中排程停止后静音');
{
  const scope = loadProcessorClass();
  const p = await createProc(scope);
  const send = (data: unknown[]) => p.port.onmessage!({ data });
  const pcm = tone(440, 2);
  send([0, 'addBuffers', [pcm, pcm.slice()]]);
  send([1, 'schedule', { active: true, output: 0.5, input: 0, rate: 0.5 }]);
  const total = Math.ceil(2.5 * SR / QUANTUM);
  const out = new Float32Array(total * QUANTUM);
  let stopped = false;
  for (let b = 0; b < total; b++) {
    scope.currentTime = b * QUANTUM / SR;
    // 播到 1.0s 时排程 1.5s 停止 (镜像 app 用法: 播放中发 stop; 不能在未来 start 之前排未来 stop,
    // schedule 会清除 outputTime 之后的所有排程, 把 start 一并丢弃)
    if (!stopped && scope.currentTime >= 1.0) { send([2, 'stop', 1.5]); stopped = true; }
    const o = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    p.process([[]], [o], {});
    out.set(o[0], b * QUANTUM);
  }
  const sounding = rms(out, Math.floor(1.2 * SR), Math.floor(1.4 * SR));
  assert(sounding > 0.1, `停止前有声 (RMS ${sounding.toFixed(3)})`);
  const after = rms(out, Math.floor(1.8 * SR), Math.floor(2.4 * SR));
  assert(after < 0.02, `stop(1.5s) 后静音 (RMS ${after.toFixed(4)})`);
}

if (failures) { console.error(`\nTESTS_V60_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V60_ALL_PASSED');
