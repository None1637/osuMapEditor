// 验证器 v442: 修「刷新后要等约三秒, 下方时间轴才会是正常大小」
// 根因: songLength() 优先取 audioBuffer.duration, 但 decodeAudioData 是秒级耗时;
//   解码完成前既没有 audioBuffer 也没有降级 this.audio, 只能退回谱面末物件+2s 的短长度,
//   时间轴全程按错误的短长度画, 解码完成后整体重排 — 用户感知为"3 秒后才正常"。
// 修复: setAudio 起解码的同时挂 <audio preload=metadata> 探针 (loadedmetadata ~100ms 级),
//   拿到时长写入 audioMetaDuration 并 emit; songLength() 在解码完成前用该时长。
// 运行: npm run build 后 node verifier/v442/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: setAudio 元数据探针');
{
  const st = read('src/osu/store.ts');
  assert(/v442: decodeAudioData 完成前先由 <audio preload=metadata> 探针/.test(st), 'v442 字段注释');
  assert(/private audioMetaDuration = 0;/.test(st), 'audioMetaDuration 字段');
  assert(/probe\.preload = 'metadata';/.test(st), '探针 preload=metadata');
  assert(/probe\.addEventListener\('loadedmetadata', \(\) => \{[\s\S]{0,300}?this\.audioMetaDuration = probe\.duration;[\s\S]{0,120}?this\.emit\(\);/.test(st), 'loadedmetadata 写入时长并 emit');
  assert(/if \(this\.audioUrl === url && isFinite\(probe\.duration\) && probe\.duration > 0\)/.test(st), '探针结果带换歌/合法性守卫');
  assert(/probe\.removeAttribute\('src'\);/.test(st), '拿到元数据即释放探针');
  assert(/this\.audioMetaDuration = 0; \/\/ v442: 换歌即作废旧探针时长/.test(st), '换歌时重置探针时长');
}

section('源码: songLength 解码前用探针时长');
{
  const st = read('src/osu/store.ts');
  const sl = st.match(/songLength\(\): number \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(sl.length > 0, 'songLength 定义存在');
  assert(/if \(this\.audioBuffer\) return this\.audioBuffer\.duration \* 1000;/.test(sl), 'audioBuffer 优先不变');
  assert(/if \(this\.audioMetaDuration > 0\) return this\.audioMetaDuration \* 1000;/.test(sl), '解码前退回探针时长');
  assert(sl.indexOf('audioMetaDuration') > sl.indexOf('this.audio && this.audio.duration'), '探针时长在谱面长度兜底之前');
}

section('CDP: 刷新后 songLength 在解码完成前就已等于音频时长');
{
  const PORT = 9500;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { /* not ready */ }
      if (!target) await sleep(300);
    }
    if (!target) throw new Error('找不到 Electron 页面目标');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      return r.result?.result?.value;
    };
    for (let i = 0; i < 40; i++) {
      const ready = await evalJs(`!!(window.__osuStore && window.__osuSetLang)`).catch(() => false);
      if (ready === true) break;
      await sleep(400);
    }
    await evalJs(`window.__osuSetLang && window.__osuSetLang('en')`);
    await send('Emulation.setCPUThrottlingRate', { rate: 6 }); // 放大解码耗时, 拉开探针与解码的时间差
    await send('Page.reload', { ignoreCache: true });
    await sleep(300);

    const SAMPLE = `(() => {
      const store = window.__osuStore;
      return {
        bm: !!(store && store.beatmap),
        len: store && store.songLength ? Math.round(store.songLength()) : null,
        audio: !!(store && store.getAudioBuffer && store.getAudioBuffer()),
        audioDur: store && store.getAudioBuffer && store.getAudioBuffer() ? Math.round(store.getAudioBuffer().duration * 1000) : null,
      };
    })()`;
    const t0 = Date.now();
    const hist = [];
    let tAudio = null;     // audioBuffer 就绪的时刻
    let finalAudioDur = null;
    for (let i = 0; i < 250; i++) {
      const v = await evalJs(SAMPLE).catch(() => null);
      if (v && v.bm && v.len != null) {
        if (v.audio) {
          if (tAudio == null) tAudio = Date.now() - t0;
          if (v.audioDur != null) finalAudioDur = v.audioDur;
        }
        // 解码前 len 与最终时长的比对在拿到 finalAudioDur 后做; 这里记录历史
        hist.push({ t: Date.now() - t0, ...v });
        if (tAudio != null && Date.now() - t0 > tAudio + 500) break;
      }
      await sleep(80);
    }
    assert(tAudio != null, `audioBuffer 最终就绪 (tAudio=${tAudio}ms)`);
    assert(finalAudioDur != null && finalAudioDur > 1000, `音频时长有效 (${finalAudioDur}ms)`);
    const pre = hist.filter(h => !h.audio && h.len != null);
    const early = pre.find(h => Math.abs(h.len - finalAudioDur) < 2000);
    assert(!!early, `解码完成前 songLength 已等于音频时长 (首次命中 t=${early ? early.t : '-'}ms, 解码就绪 t=${tAudio}ms)`);
    if (early && tAudio != null) assert(early.t < tAudio, `探针时长 (${early.t}ms) 早于解码就绪 (${tAudio}ms)`);
    const last = hist[hist.length - 1];
    assert(last && Math.abs(last.len - finalAudioDur) < 2000, `解码后 songLength 与音频时长一致 (${last?.len} vs ${finalAudioDur})`);
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', String(e).slice(0, 300));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nv442 验证失败: ${failures} 项`); process.exit(1); }
console.log('\nv442 全部通过');
