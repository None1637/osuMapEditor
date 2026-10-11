// 验证器 v380: 时间类三项用户反馈修复
//  1) 放置物件与期望吸附点偏差 1ms — 根因: paste 用 Math.floor(c.time + at) (v196 为对齐 floor 显示),
//     而全部放置入口 (finishSlider/圆圈/转盘) 用 Math.round(吸附值); 非整节拍 tick (如 BPM 175.23 的
//     1941.6196) 放置落 1942, 粘贴落 1941, 差 1ms。修复: paste 物件/endTime/绿线统一回 round
//     (v113/v196/v357 验证器同步适配)。CDP: 多档 beatSnap × 多 BPM (含 175.23) 放置+粘贴, 差 0。
//  2) bookmark 区间「重新对齐」边界归属错 — 根因: timingResnap('bookmarks') 区间 [lo, hi) 前线 inclusive,
//     压前线的物件被吸到线前; 靠后线的区间内部件就近吸附可越过后线。修复: 压线物件作为锚点不动;
//     吸附越界时改取区间内贴近边界的 tick, 无内侧 tick 不动; 书签防御性排序 (parser 保持文件顺序)。
//  3) 手动改网格间距后撤销不回复 — v373 已修 store.load/restore 重置 gridSpacing (CDP 复核通过);
//     漏网路径: 间距输入框聚焦时 Ctrl+Z 被 App.tsx 的 INPUT 早退吞掉 (number 输入框无原生撤销),
//     且输入框本地 text 态在外部撤销后滞留显示旧值。修复: number 输入框放行 undo/redo 快捷键;
//     GridSpacingInput 在 committed 外部变化时丢弃本地文本。
// 运行: npm run build 后 node verifier/v380/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 需求1 paste 取整统一 round');
{
  const st = read('src/osu/store.ts');
  assert(st.includes('o.time = Math.round(c.time + at);'), 'paste 物件时间 round');
  assert(st.includes('o.endTime = Math.round(c.endTime + at)'), 'paste endTime round');
  assert(st.includes('const t = Math.round(c.time + at); // v357'), 'paste 绿线 round (与物件同路径)');
  assert(!/Math\.floor\(c\.(time|endTime) \+ at\)/.test(st), 'paste 不再有 floor 路径');
  assert(/v380: 取整 floor → round/.test(st), 'v380 注释存在');
}

section('源码: 需求2 bookmark 区间边界');
{
  const st = read('src/osu/store.ts');
  const fn = st.match(/timingResnap\(scope[\s\S]{0,2200}?\n  \}/)?.[0] ?? '';
  assert(/o\.time === lo \|\| o\.time === hi/.test(fn), '压线物件锚定不动');
  assert(/Math\.ceil\(\(lo - red\.time\) \/ div - 1e-9\)/.test(fn) && /Math\.floor\(\(hi - red\.time\) \/ div \+ 1e-9\)/.test(fn),
    '吸附越界改取区间内贴近边界的 tick');
  assert(/\[\.\.\.bm\.editor\.bookmarks\]\.sort/.test(fn), '书签防御性排序 (文件顺序不保证)');
}

section('源码: 需求3 输入框 undo/redo 放行 + 文本滞留');
{
  const app = read('src/App.tsx');
  assert(/type === 'number'[\s\S]{0,300}idNum === 'undo'/.test(app), 'number 输入框内放行 undo/redo 快捷键');
  assert(/useEffect\(\(\) => \{ setText\(null\); \}, \[committed\]\)/.test(app), 'GridSpacingInput 外部变更时丢弃本地文本');
  assert(read('src/osu/store.ts').includes('this.gridSpacing = null; // v373'), 'v373 store.load/restore 重置保持');
}

section('CDP: 三项行为实测');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9480;
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
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient && window.__osuSetLang)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');

    // setup: 归一持久化状态 (localStorage/皮肤跨运行污染教训), 造谱工具挂 window
    await evalJs(`(async () => {
      const store = window.__osuStore;
      window.__osuSetLang && window.__osuSetLang('en'); // 关首跑语言框
      localStorage.removeItem('osu-editor:hotkeys'); // 改键覆盖持久化, 清掉保证默认键位
      window.__osuSkin && window.__osuSkin.resetSkinToDefault();
      store.pause && store.pause();
      store.tool = 'select'; store.lockNotes = false;
      window.__v380 = {
        sleep: (ms) => new Promise(r => setTimeout(r, ms)),
        // 造谱: 指定 BPM (beatLength 可非整), 空物件, 无书签
        loadBpm: (bpm, beatDivisor = 4) => {
          const base = store.beatmap;
          store.load({ ...base,
            timingPoints: [{ time: 1000, beatLength: 60000 / bpm, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
            hitObjects: [], editor: { ...base.editor, beatDivisor, bookmarks: [] } }, null);
          store.pause && store.pause();
        },
        // 画布点击放置单点 (切 circle 工具), 返回新物件 time
        clickPlace: () => {
          store.tool = 'circle';
          const c = document.querySelector('canvas.cursor-crosshair');
          const pt = window.__osuToClient(256, 192);
          const n0 = store.beatmap.hitObjects.length;
          c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
          c.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
          store.tool = 'select';
          const news = store.beatmap.hitObjects.slice(n0);
          return news.length ? news[news.length - 1].time : null;
        },
      };
    })()`);

    // ---- 需求1: 多 BPM × 多 beatSnap 点击放置 + 粘贴, time == round(理论吸附值) ----
    const r1 = await evalJs(`(async () => {
      const store = window.__osuStore, V = window.__v380;
      const snap = window.__osuSnap;
      const rows = [];
      let bad = 0;
      for (const bpm of [120, 175.23, 90.5]) {
        for (const div0 of [1, 2, 3, 4, 6, 8, 12]) {
          const beat = 60000 / bpm;
          // 多个当前时刻: tick 上/间/贴边界 (含小数 .4/.6 漂移); 每个采样点重新造谱
          // (避免 stable「同时间点放置删除旧物件」规则干扰采样)
          for (const off of [beat * 8, beat * 8 + 0.4, beat * 8 + beat / div0 / 2, beat * 10 + 0.6, beat * 13 - 0.4]) {
            V.loadBpm(bpm, div0);
            const t = 1000 + off;
            store.seek(t);
            const expected = Math.round(snap.snapPlacementTime(store.beatmap.timingPoints, store.currentTime, store.beatSnap));
            const placed = V.clickPlace();
            const dPlace = placed === null ? 999 : Math.abs(placed - expected);
            // 粘贴: 复制刚放的物件, 同一时刻粘贴, 期望与放置同刻
            const lastId = store.beatmap.hitObjects[store.beatmap.hitObjects.length - 1].id;
            store.select([lastId]); store.copy();
            store.paste(store.currentTime);
            const pasted = store.beatmap.hitObjects.find(o => o.id !== lastId && o.time === expected);
            const anyPasted = store.beatmap.hitObjects[store.beatmap.hitObjects.length - 1];
            const dPaste = pasted ? 0 : Math.abs(anyPasted.time - expected);
            if (dPlace !== 0 || dPaste !== 0) { bad++; rows.push({ bpm, div0, off, expected, placed, pasted: anyPasted.time, dPlace, dPaste }); }
          }
        }
      }
      return { bad, rows: rows.slice(0, 8) };
    })()`);
    assert(r1.bad === 0, `1a: 多 BPM × 多 beatSnap 点击放置+粘贴 time == round(理论吸附) (偏差样本 ${r1.bad} 个)`);
    if (r1.bad) console.log('  dbg:', JSON.stringify(r1.rows));

    // ---- 需求2: bookmark 区间 resnap 边界 ----
    const r2 = await evalJs(`(async () => {
      const store = window.__osuStore, V = window.__v380;
      const bpm = 175.23, beat = 60000 / bpm, div = beat / 4;
      const mk = (id, t) => ({ id, type: 'circle', time: Math.round(t), x: 256, y: 192, hitSound: 0, newCombo: false, comboSkip: 0 });
      const B1 = Math.round(1000 + beat * 4 + 40);   // 前线 (离线 40ms)
      const tickBeforeB2 = 1000 + 32 * div;          // 后线前的 tick
      const B2 = Math.round(tickBeforeB2 + div * 0.7); // 后线: 距前一 tick 0.7div => 线前 0.2div 内的物件会吸过线
      const objs = [
        mk(1, B1),                          // 正好压前线 -> 不动 (修复前: 吸到线前)
        mk(2, 1000 + beat * 6 + 3),         // 区间内 -> 吸附网格
        mk(3, Math.round(B2 - div * 0.15)), // 靠后线的区间内部件, 就近 tick 在线后 -> 改取内侧 tick (修复前: 越到线后)
        mk(4, B2),                          // 正好压后线 -> 不动
        mk(5, B2 + 300),                    // 区间外 -> 不动
      ];
      const base = store.beatmap;
      store.load({ ...base,
        timingPoints: [{ time: 1000, beatLength: beat, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
        hitObjects: objs, editor: { ...base.editor, beatDivisor: 4, bookmarks: [B1, B2] } }, null);
      store.pause && store.pause();
      store.seek((B1 + B2) / 2);
      const before = store.beatmap.hitObjects.map(o => o.time);
      store.timingResnap('bookmarks');
      const after = store.beatmap.hitObjects.map(o => o.time);
      const gridOk = (t) => { const k = (t - 1000) / div; return Math.abs(k - Math.round(k)) < 1e-6; };
      const out = {
        B1, B2, before, after,
        frontAnchorKept: after[0] === before[0],                       // 前线锚点不动
        interiorSnapped: after[1] !== before[1] && gridOk(after[1]) && after[1] > B1 && after[1] < B2,
        nearBackClamped: after[2] <= B2 + 1e-6 && after[2] >= B1 && gridOk(after[2]) && after[2] !== 1000 + 33 * div, // 不越线 (修复前 = 33*div 在线后)
        backAnchorKept: after[3] === before[3],                        // 后线锚点不动
        outsideKept: after[4] === before[4],
      };
      store.undo();
      out.undoOk = store.beatmap.hitObjects.every((o, i) => o.time === before[i]);
      return out;
    })()`);
    assert(r2.frontAnchorKept, `2a: 压前线物件不动 (${r2.before[0]} -> ${r2.after[0]}; 修复前吸到线前)`);
    assert(r2.interiorSnapped, `2b: 区间内部件吸附网格且不越界 (${r2.before[1]} -> ${r2.after[1]})`);
    assert(r2.nearBackClamped, `2c: 靠后线物件不越过后线 (${r2.before[2]} -> ${r2.after[2]}, B2=${r2.B2}; 修复前吸到线后)`);
    assert(r2.backAnchorKept && r2.outsideKept, `2d: 压后线/区间外物件不动 (${r2.before[3]}->${r2.after[3]}, ${r2.before[4]}->${r2.after[4]})`);
    assert(r2.undoOk, '2e: 一次 undo 恢复');

    // ---- 需求3: 网格间距 撤销/刷新 (真实输入框路径) ----
    const r3 = await evalJs(`(async () => {
      const store = window.__osuStore, V = window.__v380;
      const base = store.beatmap;
      store.load({ ...base, editor: { ...base.editor, gridSize: 4 } }, null);
      store.pause && store.pause();
      const inp = document.querySelector('[data-grid-input="spacing"]');
      if (!inp) return { err: 'grid spacing input not found' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const committed = () => store.gridSpacing ?? store.beatmap.editor.gridSize;
      const out = { initial: committed() };
      // 聚焦输入框并输入 16 (真实路径: 本地 text 态 + 提交)
      inp.focus();
      setter.call(inp, '16');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await V.sleep(150);
      out.afterType = committed();
      out.displayAfterType = inp.value;
      // 焦点仍在输入框时按 Ctrl+Z (修复前: App 快捷键 INPUT 早退, 撤销被吞)
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
      await V.sleep(150);
      out.afterUndo = committed();
      out.displayAfterUndo = inp.value; // 修复前: 本地 text 滞留显示 16
      // Ctrl+Y 重做
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }));
      await V.sleep(150);
      out.afterRedo = committed();
      // 刷新谱面 (reloadMap 内核 = store.load 从磁盘数据重建; 磁盘值=旧值 4)
      const diskBm = { ...base, editor: { ...base.editor, gridSize: 4 } };
      store.load(diskBm, null);
      await V.sleep(150);
      out.afterReload = committed();
      out.displayAfterReload = document.querySelector('[data-grid-input="spacing"]').value;
      return out;
    })()`);
    assert(!r3.err && r3.initial === 4 && r3.afterType === 16, `3a: 输入框改间距生效 (4 -> ${r3.afterType})`);
    assert(r3.afterUndo === 4, `3b: 输入框聚焦时 Ctrl+Z 撤销回复间距 (实得 ${r3.afterUndo}; 修复前按键被吞保持 16)`);
    assert(r3.displayAfterUndo === '4', `3c: 撤销后输入框显示回复 (实得 "${r3.displayAfterUndo}"; 修复前本地文本滞留 "16")`);
    assert(r3.afterRedo === 16, `3d: Ctrl+Y 重做回复 16 (实得 ${r3.afterRedo})`);
    assert(r3.afterReload === 4 && r3.displayAfterReload === '4', `3e: 刷新谱面 (store.load) 间距跟随磁盘值 (实得 ${r3.afterReload} / 显示 "${r3.displayAfterReload}")`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    electron.kill();
  }
}

section('改动文件无 CRLF');
{
  for (const f of ['src/osu/store.ts', 'src/App.tsx', 'verifier/v380/check.mjs', 'verifier/v113/check.mjs', 'verifier/v196/check.mjs', 'verifier/v196/tests.ts', 'verifier/v357/check.mjs'])
    assert(!read(f).includes('\r'), `${f} 无 CRLF`);
}

console.log(failures ? `\nVERIFIER_V380_FAILED: ${failures} 处失败` : '\nVERIFIER_V380_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
