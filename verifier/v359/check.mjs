// 验证器 v359: Timing 界面优化 (soulten/None1637 反馈)
//   1) 行尾「→ 跳转 / × 删除」按钮太小 → 放大 (px-2 py-1, X 图标 w-4 h-4, → text-base) 且横向并排分开 (inline-flex gap);
//   2) timing 窗口垂直满版 — full 模式根 flex-1 min-h-0 flex flex-col 撑满页签高度, 表格区 flex-1 内滚 (替代 max-h-[65vh]);
//   3) 加新线不在当前画面中要自己滚下去 → addTimingPoint 后自动滚动定位新行 (被页签过滤隐藏时先切到能显示的页签)。
// 运行: npm run build 后 node verifier/v359/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 行尾按钮放大并排');
{
  const src = read('src/components/TimingPanel.tsx');
  assert(/inline-flex items-center gap-1\.5/.test(src), '跳转/删除横向并排 (inline-flex gap)');
  assert(/px-2 py-1 rounded text-base leading-none text-sky-400/.test(src), '跳转按钮放大 (px-2 py-1, text-base)');
  assert(/px-2 py-1 rounded text-red-400[\s\S]{0,80}?w-4 h-4/.test(src), '删除按钮放大 (px-2 py-1, 图标 w-4 h-4)');
  assert(src.indexOf("timing.seek_title") < src.indexOf("timing.delete_title"), '跳转在删除之前 (破坏性操作靠后)');
  assert(!/w-3\.5 h-3\.5/.test(src), '旧小图标移除');
}

section('源码: 垂直满版');
{
  const src = read('src/components/TimingPanel.tsx');
  assert(/overflow-hidden flex-1 min-h-0 flex flex-col/.test(src), 'full 窗口根 flex-1 撑高');
  assert(/full \? 'flex-1 min-h-0' : 'max-h-44'/.test(src), '表格区 flex-1 内滚 (嵌入模式仍 max-h-44)');
  assert(!/max-h-\[65vh\]/.test(src), '旧 65vh 限高移除');
  assert(/flex-1 min-w-0 flex flex-col/.test(src), 'TimingPage 包裹 flex-col 传导高度');
}

section('源码: 加新线自动滚动定位');
{
  const src = read('src/components/TimingPanel.tsx');
  assert(/const scrollRowToCenter = \(idx: number\)/.test(src), 'scrollRowToCenter helper (挂载定位复用)');
  assert(/const np = defaultNewPoint/.test(src) && /bm\.timingPoints\.indexOf\(np\)/.test(src), '记录新点引用并取排序后下标');
  assert(/if \(full\) scrollRowToCenter\(bm\.timingPoints\.indexOf\(np\)\)/.test(src), '添加后滚动到新行');
  assert(/setFilter\(uninherited \? 'red' : 'green'\)/.test(src), '新线被页签过滤时先切页签');
}

section('源码: i18n');
{
  const zh = read('src/i18n/dicts/zh-CN/timing.ts');
  assert(/'timing\.seek_title': '跳转到时间轴上的该点'/.test(zh), 'zh-CN: seek_title');
  assert(/'timing\.delete_title': '删除该点'/.test(zh), 'zh-CN: delete_title');
}

section('CDP: 垂直满版 + 加线自动滚动');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9466;
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

    // F2 切到 timing 页签
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }))`);
    await sleep(400);

    // 垂直满版: 窗口底边贴满页签内容区底 (my-2 = 8px 余量; 内容区下方还有全局时间轴, 故不对视口断言)
    const fill = await evalJs(`(() => {
      const sc = document.querySelector('[data-tp-scroll]');
      if (!sc) return { err: 'no scroll container' };
      const panel = sc.parentElement, wrapper = panel.parentElement;
      const r = panel.getBoundingClientRect(), w = wrapper.getBoundingClientRect();
      return { bottomGap: w.bottom - r.bottom, fillRatio: r.height / w.height };
    })()`);
    if (fill.err) throw new Error(fill.err);
    assert(fill.bottomGap < 16 && fill.fillRatio > 0.9, `timing 窗口垂直满版 (底边距页签区 ${fill.bottomGap.toFixed(1)}px, 填充比 ${(fill.fillRatio * 100).toFixed(1)}%)`);

    // 加新线自动滚动: seek 到歌尾 (远离当前可视区), 点 +绿线, 新行应滚入视野
    const scroll = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sc = document.querySelector('[data-tp-scroll]');
      store.seek(store.songLength() - 2000);
      await new Promise(r => setTimeout(r, 100));
      const btn = document.querySelector('button[class*="bg-green-500/30"]');
      if (!btn) return { err: 'no add green btn' };
      btn.click();
      await new Promise(r => setTimeout(r, 300));
      const n = store.beatmap.timingPoints.length;
      const row = sc.querySelector('[data-tp-row="' + (n - 1) + '"]');
      if (!row) return { err: 'new row not found (n=' + n + ')' };
      const cr = sc.getBoundingClientRect(), rr = row.getBoundingClientRect();
      return { scrollTop: sc.scrollTop, visible: rr.top >= cr.top - 1 && rr.bottom <= cr.bottom + 1 };
    })()`);
    if (scroll.err) throw new Error(scroll.err);
    assert(scroll.visible, `加新绿线后新行滚入视野 (scrollTop=${scroll.scrollTop})`);
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

console.log(failures ? `\nVERIFIER_V359_FAILED: ${failures} 处失败` : '\nVERIFIER_V359_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
