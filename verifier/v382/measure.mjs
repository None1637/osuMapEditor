// v382: 慢放音质客观测量 — OfflineAudioContext 渲染测试音, FFT 分析失真
// 路径:
//   chromium    = AudioBufferSourceNode.playbackRate (Chromium 重采样; 当前 DT/HT 变调与回退路径)
//   signalsmith = signalsmith-stretch 变速不变调 (v295/v296 起编辑器慢放当前路径)
//   sinc        = src/osu/clock/rateResampler.worklet.js (v382 新增窗 sinc 变速变调, 文件不存在则跳过)
// 信号: 1k/5k/10k 正弦 + 多音复合; 倍速 0.5 / 0.75 (另测 1.0 作对照)
// 指标: THD%(谐波失真) / spurDb(总杂散能量比, 相对基频) / maxSpurDb(最大单杂散峰, 相对基频)
// 用法: node verifier/v382/measure.mjs           打印表格
//       node verifier/v382/measure.mjs --json    仅打印 JSON (供 check.mjs 复用)
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs'; // v383

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9482;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- 频谱分析 (Node 侧) ----------
function fft(re, im) { // 迭代 radix-2, 就地
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi;
        const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
}

/** 对稳态段做加窗 FFT, 返回 { thdPct, spurDb, maxSpurDb, fundDb }
 *  expectFreqs: 期望输出成分 (Hz); 第一个为基频 (THD 基准)。
 *  THD 仅对单音有意义 (多音时各成分窗泄漏落入谐波搜索窗, 数学上理想的重采样也会
 *  算出 ~71% — 已用纯 JS 理想合成验证, 属度量伪影), 多音返回 null 只看 spurDb。 */
function analyze(pcm, sr, expectFreqs) {
  const single = expectFreqs.length === 1;
  const N = 32768;
  if (pcm.length < N) throw new Error('pcm too short');
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { // Blackman-Harris 4 项窗
    const w = 0.35875 - 0.48829 * Math.cos(2 * Math.PI * i / N) + 0.14128 * Math.cos(4 * Math.PI * i / N) - 0.01168 * Math.cos(6 * Math.PI * i / N);
    re[i] = pcm[i] * w;
  }
  fft(re, im);
  const df = sr / N, half = N / 2;
  const pw = new Float64Array(half);
  for (let i = 0; i < half; i++) pw[i] = re[i] * re[i] + im[i] * im[i];
  const compRange = (f) => { // 成分能量: 峰值 ±6 bin
    const c = Math.round(f / df);
    let pk = c;
    for (let i = Math.max(1, c - 4); i <= Math.min(half - 2, c + 4); i++) if (pw[i] > pw[pk]) pk = i;
    let e = 0;
    for (let i = Math.max(1, pk - 6); i <= Math.min(half - 1, pk + 6); i++) e += pw[i];
    return { pk, e, lo: pk - 6, hi: pk + 6 };
  };
  const comps = expectFreqs.map(compRange);
  const fund = comps[0].e;
  // 谐波失真: 基频的 2~8 次谐波 (仅单音)
  let hd = 0;
  if (single) {
    for (let k = 2; k <= 8; k++) {
      const f = expectFreqs[0] * k;
      if (f >= sr / 2 - 4 * df) break;
      hd += compRange(f).e;
    }
  }
  // 杂散: 排除 DC 与所有"期望成分 + 基频谐波"邻域后的残余能量
  const mask = new Uint8Array(half);
  const mark = (lo, hi) => { for (let i = Math.max(0, lo); i <= Math.min(half - 1, hi); i++) mask[i] = 1; };
  mark(0, 2);
  for (const c of comps) mark(c.lo, c.hi);
  for (let k = 2; k <= 8; k++) {
    const f = expectFreqs[0] * k;
    if (f >= sr / 2 - 4 * df) break;
    const c = compRange(f); mark(c.lo, c.hi);
  }
  let spur = 0, maxSpur = 0;
  for (let i = 0; i < half; i++) if (!mask[i]) { spur += pw[i]; if (pw[i] > maxSpur) maxSpur = pw[i]; }
  const db = (x) => 10 * Math.log10(Math.max(x, 1e-30));
  return {
    thdPct: single ? 100 * Math.sqrt(hd / fund) : null,
    spurDb: db(spur) - db(fund),
    maxSpurDb: db(maxSpur) - db(fund),
    fundDb: db(fund),
  };
}

// ---------- 页内渲染 ----------
const SIGNALS = {
  sine1k: [1000], sine5k: [5000], sine10k: [10000],
  multi: [697, 1369, 2543, 4211, 7431, 11881],
};

function pageRenderExpr(ssSrc, sincSrc) {
  const sigJson = JSON.stringify(SIGNALS);
  return `(async () => {
    const SIGNALS = ${sigJson};
    const SS_SRC = ${JSON.stringify(ssSrc)};
    const SINC_SRC = ${JSON.stringify(sincSrc)};
    const sr = 48000, durSrc = 1.0;
    const b64 = (f32) => {
      const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
      let bin = ''; const STEP = 32768;
      for (let i = 0; i < u8.length; i += STEP) bin += String.fromCharCode.apply(null, u8.subarray(i, i + STEP));
      return btoa(bin);
    };
    const mkBuf = (oc, freqs) => {
      const buf = oc.createBuffer(1, durSrc * sr, sr);
      const d = buf.getChannelData(0);
      const amp = 0.8 / Math.sqrt(freqs.length);
      for (const f of freqs) for (let i = 0; i < d.length; i++) d[i] += amp * Math.sin(2 * Math.PI * f * i / sr);
      return buf;
    };
    const render = async (kind, freqs, rate) => {
      const outDur = durSrc / rate + 0.05;
      const oc = new OfflineAudioContext(1, Math.ceil(outDur * sr), sr);
      const buf = mkBuf(oc, freqs);
      if (kind === 'chromium') {
        const s = oc.createBufferSource();
        s.buffer = buf; s.playbackRate.value = rate;
        s.connect(oc.destination); s.start(0);
      } else if (kind === 'sinc') {
        const url = URL.createObjectURL(new Blob([SINC_SRC], { type: 'application/javascript' }));
        await oc.audioWorklet.addModule(url);
        const node = new AudioWorkletNode(oc, 'osu-rate-resampler', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
        node.onprocessorerror = (e) => { throw new Error('processorerror: ' + (e && e.message)); };
        // buffers+schedule 合并为单条消息 + 等送达回执再渲染 (离线渲染极快, 消息任务可能
        // 排在渲染完成之后而整条丢失 — 未确认则重发, transfer 需每次新拷一份)
        let acked = false;
        node.port.onmessage = (e) => { if (e.data && e.data.type === 'buffers-acked') acked = true; };
        for (let tries = 0; tries < 20 && !acked; tries++) {
          const ch = buf.getChannelData(0).slice();
          node.port.postMessage({ type: 'buffers', sampleRate: sr, channels: [ch], schedule: { output: 0, input: 0, rate, active: true } }, [ch.buffer]);
          await new Promise(r => setTimeout(r, 50));
        }
        if (!acked) throw new Error('sinc worklet 消息未送达 (20 次重试)');
        node.connect(oc.destination);
      } else if (kind === 'signalsmith') {
        const url = URL.createObjectURL(new Blob([SS_SRC], { type: 'application/javascript' }));
        const create = (await import(url)).default;
        const node = await create(oc);
        const ch = buf.getChannelData(0).slice();
        await node.addBuffers([ch], [ch.buffer]);
        node.connect(oc.destination);
        await node.schedule({ output: 0, input: 0, rate, active: true });
      }
      const out = await oc.startRendering();
      return b64(out.getChannelData(0));
    };
    const jobs = [];
    for (const [sig, freqs] of Object.entries(SIGNALS))
      for (const rate of [1, 0.75, 0.5])
        for (const kind of ['chromium', 'sinc', 'signalsmith']) {
          if (kind === 'sinc' && !SINC_SRC) continue;
          jobs.push({ sig, kind, rate, freqs });
        }
    const results = [];
    for (const j of jobs) {
      try {
        results.push({ sig: j.sig, kind: j.kind, rate: j.rate, pcm: await render(j.kind, j.freqs, j.rate) });
      } catch (e) {
        results.push({ sig: j.sig, kind: j.kind, rate: j.rate, error: String(e && e.message || e).slice(0, 200) });
      }
    }
    return results;
  })()`;
}

// ---------- 主流程 ----------
export async function runMeasurements({ log = console.log } = {}) {
  const ssSrc = fs.readFileSync(path.join(root, 'node_modules', 'signalsmith-stretch', 'SignalsmithStretch.mjs'), 'utf8');
  const sincPath = path.join(root, 'src', 'osu', 'clock', 'rateResampler.worklet.js');
  const sincSrc = fs.existsSync(sincPath) ? fs.readFileSync(sincPath, 'utf8') : null;

  const { proc: electron, profile } = launchIsolatedElectron(root, DEBUG_PORT); // v383: 隔离 userData
  try {
    let target;
    for (let i = 0; i < 40 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
        target = targets.find(t => t.type === 'page');
      } catch { }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('CONNECT_FAILED');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => {
      const id = ++msgId;
      return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    };
    await send('Runtime.enable');
    const evalJs = async (expr) => { // v383: normalizeEnv 需要的 Runtime.evaluate 封装
      const rr = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (rr.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(rr.result.exceptionDetails).slice(0, 400));
      return rr.result?.result?.value;
    };
    await normalizeEnv(evalJs); // v383: 环境归一
    const r = await send('Runtime.evaluate', { expression: pageRenderExpr(ssSrc, sincSrc), awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    const rendered = r.result?.result?.value;

    const sr = 48000;
    const decode = (b64s) => {
      const bin = Buffer.from(b64s, 'base64');
      return new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
    };
    const rows = [];
    for (const it of rendered) {
      if (it.error) { rows.push({ ...it, error: it.error }); continue; }
      const pcmFull = decode(it.pcm);
      // 稳态分析窗: 跳过起始段 (signalsmith 有 ~120ms 引擎延迟; 统一从 40% 处取窗)
      const start = Math.min(Math.floor(pcmFull.length * 0.4), pcmFull.length - 32768);
      const pcm = pcmFull.subarray(start, start + 32768);
      const srcFreqs = SIGNALS[it.sig];
      // 期望输出频率: 变调路径频率×rate; signalsmith 不变调保持原频率
      const outFreqs = it.kind === 'signalsmith' ? srcFreqs : srcFreqs.map(f => f * it.rate);
      const m = analyze(pcm, sr, outFreqs);
      rows.push({ sig: it.sig, kind: it.kind, rate: it.rate, ...m });
    }
    return rows;
  } finally {
    await killIsolated(electron, profile); // v383: 杀进程 + 回收临时 profile
  }
}

export function printTable(rows, log = console.log) {
  log('sig      kind         rate   THD%      spurDb   maxSpurDb');
  for (const r of rows) {
    if (r.error) { log(`${r.sig.padEnd(8)} ${r.kind.padEnd(12)} ${r.rate}  ERROR ${r.error}`); continue; }
    const thd = r.thdPct === null ? '    -' : r.thdPct.toFixed(4).padStart(8);
    log(`${r.sig.padEnd(8)} ${r.kind.padEnd(12)} ${String(r.rate).padEnd(4)} ${thd} ${r.spurDb.toFixed(1).padStart(9)} ${r.maxSpurDb.toFixed(1).padStart(10)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const rows = await runMeasurements();
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
  else printTable(rows);
}
