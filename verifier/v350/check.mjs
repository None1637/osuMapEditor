// 验证器 v350: 右上角「刷新谱面」按钮 — 从磁盘重新加载当前 .osu (外部修改后更新表现)
//   - mapSource (谱面磁盘来源: 目录+文件名) 存在时可用, 否则禁用;
//   - guardUnsaved 确认后 loadDifficulty 重读 + store.load, 当前时间尽量保留 (clamp 到末物件+5s)。
// 运行: npm run build 后 node verifier/v350/check.mjs  (B 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';
import { spawn, execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

section('A: 源码形态');
{
  const app = read('src/App.tsx');
  assert(/data-reload-map-btn/.test(app), '刷新按钮探针钩子');
  assert(/disabled=\{!store\.mapSource \|\| reloadingMap\}/.test(app), '无磁盘来源 (mapSource=null) 时禁用');
  assert(/store\.guardUnsaved/.test(app) && /loadDifficulty\(src\.dir, src\.fileName\)/.test(app), 'guardUnsaved 确认 + loadDifficulty 重读原文件');
  assert(/store\.load\(r\.bm, r\.audioUrl, r\.bgUrl, r\.samples, src\)/.test(app), '重载保持原 mapSource (保存仍写回原文件)');
  assert(/store\.seek\(Math\.min\(t0, lastEnd \+ 5000\)\)/.test(app), '重载后当前时间保留 (clamp 末物件+5s)');
  const dict = read('src/i18n/dicts/zh-CN/app.ts');
  assert(dict.includes("'app.reload_map'") && dict.includes("'app.reload_map_title'") && dict.includes("'app.reload_failed'"), 'zh-CN 词典三个 key 齐全');
}

section('B: CDP 功能 (点击刷新 → beatmap 对象更换 + 时间保留 + mapSource 不变)');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9457;
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

    const src = await evalJs(`window.__osuStore.mapSource ? window.__osuStore.mapSource.fileName : null`);
    if (!src) {
      assert(await evalJs(`document.querySelector('[data-reload-map-btn]')?.disabled`), '无 mapSource: 按钮禁用');
      console.log('  skip: 当前谱面无磁盘来源, 跳过重载功能断言 (环境无最近打开的谱面)');
    } else {
      assert(await evalJs(`!document.querySelector('[data-reload-map-btn]')?.disabled`), `有 mapSource (${src}): 按钮可用`);
      // 先改一个未保存改动之外的状态: 把当前时间移到 60s (重载后应保留)
      await evalJs(`window.__osuStore.seek(60000)`);
      await sleep(200);
      const before = await evalJs(`(() => { const s = window.__osuStore; return { t: s.currentTime, lastEnd: s.beatmap.hitObjects.reduce((m, o) => Math.max(m, o.endTime || o.time), 0) }; })()`);
      await evalJs(`window.__v350BeforeRef = window.__osuStore.beatmap`);
      await evalJs(`document.querySelector('[data-reload-map-btn]').click()`);
      // 等重载完成 (beatmap 引用更换)
      let swapped = false;
      for (let i = 0; i < 40 && !swapped; i++) {
        await sleep(500);
        swapped = await evalJs(`window.__osuStore.beatmap !== window.__v350BeforeRef`).catch(() => false);
      }
      assert(swapped, '点击刷新后 beatmap 对象更换 (store.load 重跑)');
      const expectT = Math.min(60000, before.lastEnd + 5000);
      const afterT = await evalJs(`window.__osuStore.currentTime`);
      assert(Math.abs(afterT - expectT) < 2000, `当前时间保留 (期望 ~${Math.round(expectT)}, 实得 ${Math.round(afterT)})`);
      assert(await evalJs(`window.__osuStore.mapSource && window.__osuStore.mapSource.fileName`) === src, 'mapSource 不变 (保存仍写回原文件)');
      assert(await evalJs(`!document.querySelector('[data-reload-map-btn]')?.disabled`), '重载完成后按钮恢复可用');
    }
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    electron.kill();
  }
}

section('C: 编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V350_FAILED: ${failures} 处失败` : '\nVERIFIER_V350_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
