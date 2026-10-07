// 验证器 v355: 「重新对齐Bookmark区间」+ 上方时间轴书签细蓝线
//   1) Timing 菜单「重新对齐当前Timing区间」下方新增「重新对齐Bookmark区间」:
//      区间 = 最后一个 <= 当前时间的书签 -> 下一个书签 (之前无书签从头起, 之后无书签到尾),
//      物件 time/endTime 吸附到生效红线节拍网格 (复用 timingResnap 主体, scope='bookmarks'), 一次 undo。
//   2) 上方时间轴书签显示: 全高 1px 细蓝线 (rgba(80,160,255,0.9), 与下方时间轴同款), 画在物件圆之下。
// 运行: npm run build 后 node verifier/v355/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: resnap bookmarks 链路 (菜单 -> bridge -> 路由 -> store)');
{
  const main = read('electron/main.cjs');
  assert(main.includes('"menu.resnap_bookmarks"'), '菜单文案 key (三语)');
  const cur = main.indexOf('"menu.resnap_current":'), bm = main.indexOf('"menu.resnap_bookmarks":');
  assert(bm > cur && bm < main.indexOf('"menu.timing_setup":'), '文案定义在 resnap_current 之后');
  const itemCur = main.indexOf('mT("menu.resnap_current")'), itemBm = main.indexOf('mT("menu.resnap_bookmarks")');
  assert(itemBm > itemCur && itemBm < main.indexOf('mT("menu.timing_setup")'), '菜单项在「重新对齐当前Timing区间」下面');
  assert(read('src/osu/electronBridge.ts').includes("{ type: 'timing-resnap-bookmarks' }"), 'bridge 消息类型');
  assert(read('src/osu/electronMenu.ts').includes("case 'timing-resnap-bookmarks': store.timingResnap('bookmarks'); return;"), 'electronMenu 路由');
  const store = read('src/osu/store.ts');
  assert(store.includes("timingResnap(scope: 'current' | 'all' | 'bookmarks')"), 'store scope 扩展');
  assert(store.includes("scope === 'bookmarks'") && store.includes('if (!marks.length) return;'), '书签区间分支 (无书签不动作)');
}

section('源码: 上方时间轴书签细蓝线');
{
  const src = read('src/components/Timelines.tsx');
  assert(src.includes('g.rect(bx - 0.5, 0, 1, r.height)'), '全高 1px 蓝线 (与上方时间轴同高)');
  const iLine = src.indexOf('g.rect(bx - 0.5, 0, 1, r.height)');
  const iObj = src.indexOf('// 物件行: stable 大圆');
  assert(iLine > 0 && iObj > 0 && iLine < iObj, '画在物件行之前 (位于 note 下方)');
  assert(src.lastIndexOf('v355', iLine) > src.lastIndexOf('const bm = store.beatmap', iLine), '属于上方时间轴绘制段');
}

section('CDP: resnap 书签区间功能 + 时间轴蓝线像素');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9462;
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
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');

    // -- 功能: 书签区间 resnap --
    const res = await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const beat = red.beatLength;
      const mk = (id, t) => ({ id, type: 'circle', time: Math.round(t), x: 256, y: 192, hitSound: 0, newCombo: false, comboOffset: 0 });
      const inT = red.time + beat * 4 + 37;   // 书签区间内, 偏离节拍 37ms
      const outT = red.time + beat * 12 + 37; // 第二个书签之后 (区间外)
      store.load({ ...base,
        editor: { ...base.editor, bookmarks: [Math.round(red.time - 1000), Math.round(red.time + beat * 8)] },
        hitObjects: [mk(888351, inT), mk(888352, outT)],
      }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.select([]);
      store.seek(red.time + beat * 4); // 当前时间落在书签区间 [red-1000, red+8b] 内
      const before = store.beatmap.hitObjects.map(o => o.time);
      store.timingResnap('bookmarks');
      const after = store.beatmap.hitObjects.map(o => o.time);
      const snap = store.beatSnap;
      const grid = beat / snap;
      const offGrid = (t) => { const k = (t - red.time) / grid; return Math.abs(k - Math.round(k)); };
      return { before, after, offIn: offGrid(after[0]), beat, red: red.time, snap };
    })()`);
    assert(res.after[0] !== res.before[0] && res.offIn < 1e-6,
      `区间内物件吸附节拍网格 (${res.before[0]} -> ${res.after[0]}, 网格偏差 ${res.offIn})`);
    assert(res.after[1] === res.before[1], `区间外物件不动 (${res.before[1]} 保持)`);

    // 撤销恢复 (一次 undo 契约)
    const undoOk = await evalJs(`(() => { window.__osuStore.undo(); return window.__osuStore.beatmap.hitObjects[0].time; })()`);
    assert(undoOk === res.before[0], `一次 undo 恢复 (${undoOk})`);

    // -- 像素: 上方时间轴书签蓝线 --
    await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      store.load({ ...base, editor: { ...base.editor, bookmarks: [6000] } }, store.audioUrl);
      store.seek(5500); // 书签偏离正中 (正中有当前时间针会盖住蓝线)
    })()`);
    await sleep(400);
    const pix = await evalJs(`(() => {
      const c = [...document.querySelectorAll('canvas')].find(x => x.className.includes('h-[92px]'));
      if (!c) return null;
      const store = window.__osuStore;
      const win = 6000 / (store.beatmap.editor.timelineZoom || 1);
      const t0 = store.currentTime - win / 2;
      const dpr = c.width / c.getBoundingClientRect().width;
      const bx = ((6000 - t0) / win) * c.width; // 书签 backing x
      const g = c.getContext('2d');
      const d = g.getImageData(Math.floor(bx) - 5, 0, 11, c.height).data;
      for (let x = 0; x < 11; x++)
        for (let y = 0; y < c.height; y++) {
          const i = (y * 11 + x) * 4;
          if (d[i + 2] > 150 && d[i + 2] > d[i] + 60 && d[i + 1] > d[i] + 30) return [Math.floor(bx) - 5 + x, y, d[i], d[i + 1], d[i + 2]];
        }
      return null;
    })()`);
    assert(!!pix, `上方时间轴书签处有蓝线像素 (${pix ? pix.join(',') : '未找到'})`);

    // 无书签时同一窗口无蓝线 (对照; 与正例同一位置 — 中心列有微蓝色时间针, 不能做对照)
    await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      store.load({ ...base, editor: { ...base.editor, bookmarks: [] } }, store.audioUrl);
      store.seek(5500);
    })()`);
    await sleep(400);
    const pix2 = await evalJs(`(() => {
      const c = [...document.querySelectorAll('canvas')].find(x => x.className.includes('h-[92px]'));
      const store = window.__osuStore;
      const win = 6000 / (store.beatmap.editor.timelineZoom || 1);
      const t0 = store.currentTime - win / 2;
      const bx = ((6000 - t0) / win) * c.width;
      const g = c.getContext('2d');
      const d = g.getImageData(Math.floor(bx) - 5, 0, 11, c.height).data;
      for (let x = 0; x < 11; x++)
        for (let y = 0; y < c.height; y++) {
          const i = (y * 11 + x) * 4;
          if (d[i + 2] > 150 && d[i + 2] > d[i] + 60 && d[i + 1] > d[i] + 30) return [Math.floor(bx) - 5 + x, y, d[i], d[i + 1], d[i + 2]];
        }
      return null;
    })()`);
    assert(!pix2, `无书签时同位置无蓝线 (对照${pix2 ? ' 意外找到 ' + pix2.join(',') : ''})`);
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

console.log(failures ? `\nVERIFIER_V355_FAILED: ${failures} 处失败` : '\nVERIFIER_V355_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
