// v522: Timing 多选批量修改按钮 + 独立弹窗 (绿 SV / 红 BPM 与公共资源字段)
// 运行: npm run build 后 node verifier/v522/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 源码契约');
{
  const panel = read('src/components/TimingPanel.tsx'), dlg = read('src/components/TimingBatchDialog.tsx');
  assert(/data-tp-batch-open/.test(panel) && /data-tp-batch-red-open/.test(panel), '红绿多选均有批量修改按钮');
  assert(/<TimingBatchDialog/.test(panel), '按钮接入独立弹窗');
  assert(/DraggableDialog/.test(dlg) && /useState\(\(\) => \[\.\.\.times\]\)/.test(dlg), '开窗冻结选区');
  assert(/updateGreenLinesAt\(selectedTimes/.test(dlg) && /updateTimingPointsAt\(selectedTimes/.test(dlg), '应用复用现有批量 API (一次 undo)');
  assert(/batch-bpm/.test(dlg) && /batch-meter/.test(dlg), '红线支持 BPM 与拍号');
  assert(/allowNaN/.test(dlg), 'BPM/SV 保留 NaN 输入');
}

console.log('== B: CDP 绿线应用/取消 + 红线应用/undo');
{
  const PORT = 9536;
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { /* not ready */ }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('找不到 Electron 页面目标');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0; const pending = new Map();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise(resolve => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 700));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs);
    await sleep(2100);

    const out = await evalJs(`(async () => {
      const s = window.__osuStore;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const base = s.beatmap;
      const mk = (time, beatLength, uninherited) => ({ time, beatLength, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 50, uninherited, effects: 0 });
      const points = [mk(1000, 500, true), mk(2000, 600, true), mk(1500, -100, false), mk(2500, -50, false)];
      s.load({ ...base, timingPoints: points, hitObjects: [] }, s.audioUrl);
      s.pause(); s.seek(1200);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', bubbles: true, cancelable: true }));
      await sleep(200);
      const setNum = (id, value) => {
        const el = document.querySelector('[data-conv="' + id + '"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(value)); el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const out = {};
      s.selectGreenLines([1500, 2500]); await sleep(100);
      document.querySelector('[data-tp-batch-open]').click(); await sleep(150);
      out.greenOpen = !!document.querySelector('[data-dialog="batch-green"]');
      setNum('batch-volume', 88);
      document.querySelector('[data-tp-batch-dlg="cancel"]').click(); await sleep(100);
      out.cancelVolumes = s.beatmap.timingPoints.filter(p => !p.uninherited).map(p => p.volume);
      document.querySelector('[data-tp-batch-open]').click(); await sleep(100);
      setNum('batch-sv', 1.5); setNum('batch-volume', 77);
      document.querySelector('[data-tp-batch-dlg="ok"]').click(); await sleep(150);
      out.greenApplied = s.beatmap.timingPoints.filter(p => !p.uninherited).map(p => ({ sv: -100 / p.beatLength, volume: p.volume }));
      s.undo(); await sleep(100);
      out.greenUndone = s.beatmap.timingPoints.filter(p => !p.uninherited).map(p => ({ sv: -100 / p.beatLength, volume: p.volume }));

      s.selectGreenLines([1000, 2000]); await sleep(100);
      document.querySelector('[data-tp-batch-red-open]').click(); await sleep(150);
      out.redOpen = !!document.querySelector('[data-dialog="batch-red"]');
      setNum('batch-bpm', 120); setNum('batch-meter', 6); setNum('batch-volume', 66);
      const sample = document.querySelector('[data-tp-batch-red-input="sampleSet"]');
      const ss = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      ss.call(sample, '3'); sample.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('[data-tp-batch-red-input="kiai"]').click();
      document.querySelector('[data-tp-batch-dlg="ok"]').click(); await sleep(150);
      out.redApplied = s.beatmap.timingPoints.filter(p => p.uninherited).map(p => ({ bpm: 60000 / p.beatLength, meter: p.meter, sampleSet: p.sampleSet, volume: p.volume, effects: p.effects }));
      s.undo(); await sleep(100);
      out.redUndone = s.beatmap.timingPoints.filter(p => p.uninherited).map(p => ({ bpm: 60000 / p.beatLength, meter: p.meter, sampleSet: p.sampleSet, volume: p.volume, effects: p.effects }));
      return out;
    })()`);

    assert(out.greenOpen, '绿线批量修改按钮打开弹窗');
    assert(out.cancelVolumes.every(v => v === 50), `取消不写值 (${out.cancelVolumes})`);
    assert(out.greenApplied.every(p => p.sv === 1.5 && p.volume === 77), `全部绿线应用 SV/音量 (${JSON.stringify(out.greenApplied)})`);
    assert(out.greenUndone.every(p => p.volume === 50 && (p.sv === 1 || p.sv === 2)), '一次 undo 还原全部绿线');
    assert(out.redOpen, '红线批量修改按钮打开弹窗');
    assert(out.redApplied.every(p => p.bpm === 120 && p.meter === 6 && p.sampleSet === 3 && p.volume === 66 && p.effects === 1),
      `全部红线应用 BPM/拍号/音效 (${JSON.stringify(out.redApplied)})`);
    assert(out.redUndone.some(p => p.bpm === 120 && p.meter === 4) && out.redUndone.some(p => p.bpm === 100 && p.meter === 4)
      && out.redUndone.every(p => p.sampleSet === 2 && p.volume === 50 && p.effects === 0), '一次 undo 还原全部红线');

    ws.close();
  } catch (e) {
    failures++; console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V522_FAILED: ${failures} 处失败` : '\nVERIFIER_V522_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
