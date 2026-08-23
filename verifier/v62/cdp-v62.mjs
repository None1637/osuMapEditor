// CDP v62 端到端: Timing 页绿行音效集/序号/kiai 编辑 + 插入克隆生效点默认值
// 运行: node verifier/v62/cdp-v62.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9397;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v62-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', APP_URL,
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown')
    exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? ''));
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.error) throw new Error('CDP 错误: ' + JSON.stringify(r.error).slice(0, 300));
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.tool = 'select';
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 400, meter: 3, sampleSet: 2, sampleIndex: 0, volume: 55, uninherited: true, effects: 0 },
        { time: 1000, beatLength: -200, meter: 4, sampleSet: 3, sampleIndex: 2, volume: 45, uninherited: false, effects: 1 },
      ];
      s.beatmap.editor.timelineZoom = 1;
      s.seek(2500);
      s.clearSelection();
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);
  // 切到 timing 页签
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'timing').click(); "ok"`);
  await sleep(400);

  console.log('== A) 插入绿线: 克隆当前生效绿线全部字段 (lazer addNew)');
  {
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('+ 绿线')).click(); "ok"`);
    await sleep(300);
    const g = await evalJs(`(() => {
      const tp = window.__osuStore.beatmap.timingPoints.find(p => !p.uninherited && p.time === 2500);
      return tp ? [tp.beatLength, tp.sampleSet, tp.sampleIndex, tp.volume, tp.effects] : null;
    })()`);
    assert(g !== null && g[0] === -200 && g[1] === 3 && g[2] === 2 && g[3] === 45 && g[4] === 1,
      `新绿线@2500 克隆 SV=0.5/Drum/idx2/vol45/kiai (实际 ${JSON.stringify(g)})`);
  }

  console.log('== B) 插入红线: 克隆当前生效红线 (beatLength/拍号/音量)');
  {
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('+ 红线')).click(); "ok"`);
    await sleep(300);
    const r = await evalJs(`(() => {
      const tp = window.__osuStore.beatmap.timingPoints.find(p => p.uninherited && p.time === 2500);
      return tp ? [tp.beatLength, tp.meter, tp.sampleSet, tp.volume] : null;
    })()`);
    assert(r !== null && r[0] === 400 && r[1] === 3 && r[2] === 2 && r[3] === 55,
      `新红线@2500 克隆 150BPM/3拍/Soft/vol55 (实际 ${JSON.stringify(r)})`);
  }

  console.log('== C) 表格编辑: 音效集下拉 / 序号 / kiai / 省略小节线');
  {
    // 找到绿线@1000 所在行的音效集下拉, 改 Soft(2)
    const rowInfo = await evalJs(`(() => {
      const rows = [...document.querySelectorAll('tbody tr')];
      const s = window.__osuStore;
      // 行顺序 = timingPoints 排序后顺序: red@0, red@2500, green@1000, green@2500
      return s.beatmap.timingPoints.map(p => [p.time, p.uninherited]);
    })()`);
    const greenIdx = rowInfo.findIndex(p => p[0] === 1000 && p[1] === false);
    await evalJs(`(() => {
      const sel = document.querySelectorAll('tbody tr')[${greenIdx}].querySelector('[data-tp-input=sampleSet]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, '2');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await sleep(250);
    const set2 = await evalJs(`window.__osuStore.beatmap.timingPoints[${greenIdx}].sampleSet`);
    assert(set2 === 2, `音效集改 Soft (实际 ${set2})`);
    // kiai 取消勾选
    await evalJs(`document.querySelectorAll('tbody tr')[${greenIdx}].querySelector('[data-tp-input=kiai]').click(); "ok"`);
    await sleep(250);
    const kiai = await evalJs(`window.__osuStore.beatmap.timingPoints[${greenIdx}].effects`);
    assert((kiai & 1) === 0, `kiai 取消 (effects=${kiai})`);
    // 红线省略小节线勾选 (bit3)
    const redIdx = rowInfo.findIndex(p => p[0] === 0 && p[1] === true);
    await evalJs(`document.querySelectorAll('tbody tr')[${redIdx}].querySelector('[data-tp-input=omitBar]').click(); "ok"`);
    await sleep(250);
    const fx = await evalJs(`window.__osuStore.beatmap.timingPoints[${redIdx}].effects`);
    assert((fx & 8) !== 0, `红线省略小节线 bit3 置位 (effects=${fx})`);
    // 序号输入
    await evalJs(`(() => {
      const inp = document.querySelectorAll('tbody tr')[${greenIdx}].querySelector('[data-tp-input=sampleIndex]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '5');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    await sleep(250);
    const idx = await evalJs(`window.__osuStore.beatmap.timingPoints[${greenIdx}].sampleIndex`);
    assert(idx === 5, `自定义序号改 5 (实际 ${idx})`);
  }

  console.log('== D) 序列化往返: 编辑后字段写入 .osu 文本');
  {
    const txt = await evalJs(`(() => {
      const { serializeOsu } = window.__osuDebug ?? {};
      return null;
    })()`).catch(() => null);
    // serialize 不经 window 暴露, 用解析器动态 import 验证 (dev server ESM)
    const line = await evalJs(`import('/src/osu/parser.ts').then(m => {
      const out = m.serializeOsu(window.__osuStore.beatmap);
      return out.split('\\n').filter(l => l.includes(',0,') || l.includes(',1,')).filter(l => l.split(',').length === 8);
    })`);
    const g1000 = line.find(l => l.startsWith('1000,'));
    assert(g1000 !== undefined && g1000.includes(',2,5,') && g1000.endsWith(',0'), `绿线@1000 序列化 set2/idx5/kiai0 (实际 ${g1000})`);
    const r0 = line.find(l => l.startsWith('0,'));
    assert(r0 !== undefined && r0.endsWith(',8'), `红线@0 序列化 omit bit3 (实际 ${r0})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V62_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V62_CDP_PASSED');
