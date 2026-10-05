// 验证器 v352: 滑条限界改「头/尾中心」+ compose/timing/song setup 页签快捷键 F1/F2/F3
//   用户反馈: 1) 开启「限制物件在游玩区域内」时滑条不应限制滑条点, 只限制头尾的中心
//     (v302/F04 原连控制点一起钳; 控制点出界成形是合法操作, 节点拖拽 v29 起本就不钳);
//   2) 页签快捷键 F1=compose F2=timing F3=song setup (stable 同款, 注册表可改键)。
// 运行: npm run build 后 node verifier/v352/check.mjs  (B 段会短暂弹出编辑器窗口)
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
  const ec = read('src/components/EditorCanvas.tsx');
  const clampBlk = ec.match(/v352: 钳制点集收窄[\s\S]*?yLo <= yHi\) dy = Math\.max/)?.[0] ?? '';
  assert(!!clampBlk, '拖拽限界块存在 (v352 语义)');
  assert(!clampBlk.includes('orig.curve'), '钳制点集不含控制点 (只头+尾)');
  assert(clampBlk.includes('pts.push(tail)'), '滑条尾中心仍纳入钳制');
  const hk = read('src/osu/hotkeys.ts');
  assert(/id: 'tab-compose'.*defaults: \['F1'\]/.test(hk) && /id: 'tab-timing'.*defaults: \['F2'\]/.test(hk) && /id: 'tab-setup'.*defaults: \['F3'\]/.test(hk), '注册表 F1/F2/F3 (可改键)');
  const app = read('src/App.tsx');
  assert(/case 'tab-compose': e\.preventDefault\(\); setTab\('edit'\)/.test(app)
    && /case 'tab-timing': e\.preventDefault\(\); setTab\('timing'\)/.test(app)
    && /case 'tab-setup': e\.preventDefault\(\); setTab\('setup'\)/.test(app), 'onKey 分发三页签');
  assert(/hotkeyLabel\(action\)/.test(app) && /hotkeyLabel\('tab-setup'\)/.test(app), '页签按钮显示 F1/F2/F3 提示');
  const dict = read('src/i18n/dicts/zh-CN/hotkey.ts');
  assert(dict.includes("'hotkey.action.tab_compose'") && dict.includes("'hotkey.action.tab_timing'") && dict.includes("'hotkey.action.tab_setup'"), 'zh-CN 词典三个动作 key');
}

section('B: CDP 按 F2/F3/F1 切页签');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9459;
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

    const activeTab = () => evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.className.includes('bg-[#2563eb]')); return b ? b.textContent.trim().replace(/\\s+/g, ' ') : null; })()`);
    const pressF = async (key, code, vk) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await sleep(300);
    };
    const t0 = await activeTab();
    assert(t0 && t0.startsWith('compose'), `初始 compose 页签激活 (实得 ${t0})`);
    await pressF('F2', 'F2', 113);
    const t2 = await activeTab();
    assert(t2 === 'timing F2', `F2 → timing 页签 (实得 ${t2})`);
    await pressF('F3', 'F3', 114);
    const t3 = await activeTab();
    assert(t3 === 'song setup F3', `F3 → song setup 页签 (实得 ${t3})`);
    await pressF('F1', 'F1', 112);
    const t1 = await activeTab();
    assert(t1 && t1.startsWith('compose'), `F1 → 回 compose (实得 ${t1})`);
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

console.log(failures ? `\nVERIFIER_V352_FAILED: ${failures} 处失败` : '\nVERIFIER_V352_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
