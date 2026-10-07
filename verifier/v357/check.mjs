// 验证器 v357: 粘贴目标时间吸附节拍网格 (lazer ComposeScreen.Paste: SnapTime(clock.CurrentTime) - Min(StartTime))
//   用户反馈 (soulten/None1637): 物件落点与预期差 4001ms, 需重新对齐才能救回; 此前 paste 直接用
//   未吸附的 currentTime, 节拍间暂停/播放中粘贴的物件全部落在网格外。修复: paste 内统一 snapPlacementTime
//   吸附锚点 (物件+绿线同一锚点), 与放置/预览同一公式。
// 运行: npm run build 后 node verifier/v357/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: paste 锚点吸附');
{
  const src = read('src/osu/store.ts');
  assert(src.includes("import { resnapSliderLength, snapPlacementTime } from './sliderPath';"), 'store 引入 snapPlacementTime');
  assert(src.includes('const at = snapPlacementTime(this.beatmap.timingPoints, atTime, this.beatSnap);'), 'paste 锚点 = snapPlacementTime (lazer SnapTime 语义)');
  assert(src.includes('o.time = Math.floor(c.time + at);'), '物件按吸附锚点写入');
  assert(src.includes('const t = Math.floor(c.time + at); // v357'), '绿线同一吸附锚点');
  assert(!src.includes('c.time + atTime'), '不再使用未吸附 atTime');
}

section('CDP: 离网格时刻粘贴 -> 落点吸附');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9464;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: 'ignore' });
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
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');

    const res = await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const grid = red.beatLength / store.beatSnap;
      // 源物件恰在网格上
      const src = { id: 888371, type: 'circle', time: Math.round(red.time + grid * 20), x: 256, y: 192, hitSound: 0, newCombo: false, comboOffset: 0 };
      store.load({ ...base, hitObjects: [src] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.select([888371]);
      store.copy();
      // 离网格 37ms 的当前时刻粘贴 (修复前: 落 56787 式网格外; 修复后: 吸附)
      const raw = red.time + grid * 40 + 37;
      store.seek(raw);
      store.paste(store.currentTime);
      const pasted = store.beatmap.hitObjects.find(o => o.id !== 888371);
      // 期望: floor(吸附(raw) + (src.time - src.time)) = floor(snap)
      const snapped = red.time + Math.round((raw - red.time) / grid) * grid;
      return { pastedTime: pasted?.time, expected: Math.floor(snapped), raw: store.currentTime, grid, selected: [...store.selected] };
    })()`);
    assert(res.pastedTime === res.expected,
      `离网格 ${(res.raw % res.grid).toFixed(1)}ms 粘贴 -> 吸附到 ${res.expected} (实得 ${res.pastedTime}${res.pastedTime !== res.expected ? ', 修复前会落 ' + Math.floor(res.raw) : ''})`);
    assert(res.selected.length === 1 && res.selected[0] !== 888371, '粘贴后选中副本');

    // 一次 undo 恢复
    const left = await evalJs(`(() => { window.__osuStore.undo(); return window.__osuStore.beatmap.hitObjects.length; })()`);
    assert(left === 1, `一次 undo 撤掉粘贴 (剩 ${left})`);
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    electron.kill();
  }
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V357_FAILED: ${failures} 处失败` : '\nVERIFIER_V357_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
