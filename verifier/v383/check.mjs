// 验证器 v383: CDP 验证器环境归一加固 (纯测试基建, 不动 app 行为)
//  背景: 某次验证器运行把真实 userData 的 settings.json 清成 0 字节并污染 localStorage →
//    firstRun 向导遮罩吃点击 + recents 丢失停在曲库界面 (App.tsx 快捷键直接 return) → 大面积假失败。
//  根因: ① electron/main.cjs menu-state IPC 每次加载谱面都非原子 writeFileSync settings.json
//    (recents 持久化), 验证器 electron.kill() (Windows TerminateProcess) 落在写入窗口即截断;
//    ② v281 从 Node 侧直写真实 settings.json (hideTitleBar 开关); ③ 用例写 localStorage
//    (i18n.lang / osu-editor:hotkeys / osu-editor:display-settings) 直接污染真实 profile。
//  加固: verifier/_lib/env.mjs —
//    launchIsolatedElectron: mkdtemp 独立 --user-data-dir + 播种真实 settings.json 副本
//      (可选 settingsPatch 合并, v281 的 hideTitleBar 改走这里, 不再碰真实配置);
//    normalizeEnv: 就绪等待 + __osuSetLang('en') + resetSkinToDefault + backdrop 语义关曲库面板
//      (必须走 onClose, App.tsx 快捷键在 showLibrary 时直接 return) + 清已知污染 localStorage 键。
//    首跑向导不能 el.remove() (React commit 崩溃) 也不能 display:none (useCounterZoom 死循环
//      React #185 整树卸载) — 它不拦快捷键/合成事件, 仅挡 CDP 真实点击, 保留即可。
// 运行: node verifier/v383/check.mjs  (CDP 段会短暂弹出编辑器窗口 ×2)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv, realSettingsPath } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

section('源码: helper 与迁移到位');
{
  const env = read('verifier/_lib/env.mjs');
  assert(/export function launchIsolatedElectron/.test(env) && /export async function killIsolated/.test(env) && /export async function normalizeEnv/.test(env),
    '_lib/env.mjs 导出三个 helper');
  assert(/--user-data-dir/.test(env) && /mkdtempSync/.test(env), 'launchIsolatedElectron: 独立临时 user-data-dir');
  const clearLines = env.split('\n').filter(l => l.includes('localStorage.clear()'));
  assert(clearLines.every(l => l.indexOf('//') !== -1 && l.indexOf('//') < l.indexOf('localStorage.clear()')),
    'normalizeEnv 不全清 localStorage (会触发首跑语言框)');
  const v281 = read('verifier/v281/cdp-v281.mjs');
  assert(!/fs\.writeFileSync\(SETTINGS/.test(v281) && /settingsPatch/.test(v281), 'v281 不再直写真实 settings.json (走 settingsPatch)');
  // 所有 v340+ check.mjs 都走隔离 helper
  const { readdirSync } = fs;
  const dirs = readdirSync(path.join(root, 'verifier')).filter(d => /^v3(4[0-9]|5[0-9]|6[0-9]|7[89]|8[0-2])$/.test(d));
  const bad = [];
  for (const d of dirs) {
    const f = path.join(root, 'verifier', d, 'check.mjs');
    if (!fs.existsSync(f)) continue;
    const s = fs.readFileSync(f, 'utf8');
    if (/remote-debugging-port/.test(s) && !/launchIsolatedElectron/.test(s)) bad.push(d);
  }
  assert(bad.length === 0, `v340+ CDP check.mjs 全部走 launchIsolatedElectron${bad.length ? ' (漏: ' + bad.join(',') + ')' : ''}`);
}

// 通用 CDP 连接封装
async function connectCdp(port) {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
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
  return { ws, send, evalJs };
}

const realSettings = () => (fs.existsSync(realSettingsPath()) ? fs.readFileSync(realSettingsPath(), 'utf8') : null);

section('CDP-A: 播种路径 (隔离 + 谱面恢复 + 热键通路 + 真实配置只读)');
{
  const before = realSettings();
  const { proc, profile } = launchIsolatedElectron(root, 9492);
  try {
    assert(fs.existsSync(path.join(profile, 'settings.json')), 'A0: 临时 profile 已播种 settings.json 副本');
    const { ws, evalJs } = await connectCdp(9492);
    const norm = await normalizeEnv(evalJs);
    assert(norm.beatmap && norm.libraryClosed && !norm.wizardSeen, `A1: 播种启动 — 谱面恢复, 无向导, 曲库关 (${JSON.stringify(norm)})`);
    const st = await evalJs('window.osuEditor.getSettings()');
    const real = before ? JSON.parse(before) : {};
    assert(!st.firstRun && st.songsDir === real.songsDir, `A2: 隔离实例读到播种配置 (songsDir=${st.songsDir})`);
    const hk = await evalJs(`(async () => {
      const s = window.__osuStore, sleep = (ms) => new Promise(r => setTimeout(r, ms));
      s.clearSelection();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
      await sleep(250);
      const sel = s.selected.size;
      s.tool = 'select';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }));
      await sleep(250);
      return { sel, tool: s.tool, objs: s.beatmap.hitObjects.length };
    })()`);
    assert(hk.objs > 0 && hk.sel === hk.objs && hk.tool === 'circle', `A3: 热键通路 (Ctrl+A 全选 ${hk.sel}/${hk.objs}, 2 切单点)`);
    await sleep(1500); // 给 menu-state 持久化留时间 (写进临时 profile)
    ws.close();
  } catch (e) { failures++; console.error('  FAIL: CDP-A 异常 —', String(e).slice(0, 300)); }
  finally { await killIsolated(proc, profile); }
  assert(!fs.existsSync(profile), 'A4: 临时 profile 已回收');
  assert(realSettings() === before, 'A5: 真实 settings.json 全程未被改动');
}

section('CDP-B: 无播种路径 (模拟配置丢失: 向导出现但热键/归一仍可用)');
{
  const before = realSettings();
  const { proc, profile } = launchIsolatedElectron(root, 9493, { seed: false });
  try {
    assert(!fs.existsSync(path.join(profile, 'settings.json')), 'B0: 无播种 — 临时 profile 无 settings.json');
    const { ws, evalJs } = await connectCdp(9493);
    const norm = await normalizeEnv(evalJs);
    assert(norm.wizardSeen, 'B1: 首跑向导出现 (符合预期)');
    assert(norm.beatmap && norm.libraryClosed, `B2: 演示谱面兜底 + 曲库面板已关 (${JSON.stringify(norm)})`);
    const hk = await evalJs(`(async () => {
      const s = window.__osuStore, sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const lang = localStorage.getItem('i18n.lang');
      s.tool = 'select';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }));
      await sleep(250);
      return { tool: s.tool, lang };
    })()`);
    assert(hk.tool === 'circle', 'B3: 向导在场也不挡热键 (2 切单点)');
    assert(hk.lang === 'en', 'B4: 语言归一 en (首跑语言框已关)');
    ws.close();
  } catch (e) { failures++; console.error('  FAIL: CDP-B 异常 —', String(e).slice(0, 300)); }
  finally { await killIsolated(proc, profile); }
  assert(realSettings() === before, 'B5: 真实 settings.json 全程未被改动');
}

console.log(failures ? `\nVERIFIER_V383_FAILED: ${failures} 处失败` : '\nVERIFIER_V383_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
