// CDP v281 端到端: 两种标题栏模式统一用应用内自绘菜单条 (electron 实跑)
//   模式A hideTitleBar=false (原生标题栏): 页面渲染 [data-menu-bar], paddingRight=0, 无 app-region drag;
//     原生菜单栏由 autoHideMenuBar 隐藏 (截图人工确认不重复)
//   模式B hideTitleBar=true (WCO): 菜单条 paddingRight=140 + drag 区 (v280 行为不变)
//   两模式各截一张顶部图 (v281-framed.png / v281-overlay.png) 供人工核对
// 运行: node verifier/v281/cdp-v281.mjs
// v383: 不再直写真实 %APPDATA%/osu-map-editor/settings.json (曾是把用户配置写坏的根因之一) —
//   改走 _lib/env.mjs 隔离 userData + settingsPatch 把 hideTitleBar 合入临时 profile 副本。
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { launchIsolatedElectron, killIsolated } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9442;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

async function runMode(hideTitleBar, shotFile) {
  console.log(`\n== 模式 hideTitleBar=${hideTitleBar} ==`);
  const { proc: el, profile } = launchIsolatedElectron(root, DEBUG_PORT, { settingsPatch: { hideTitleBar } });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      target = targets.find(t => t.type === 'page');
    } catch { /* not ready */ }
    if (!target) await sleep(500);
  }
  if (!target) { console.error('ELECTRON_CONNECT_FAILED'); el.kill(); failures++; return; }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => {
    const id = ++msgId;
    return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  };
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  try {
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) {
      ok = await evalJs('!!(document.querySelector("[data-menu-bar]") && window.__osuStore && window.__osuStore.beatmap)');
      if (!ok) await sleep(500);
    }
    assert(ok, '菜单条渲染 + 谱面已恢复');
    const tops = await evalJs('[...document.querySelectorAll("[data-menu-top]")].map(b => b.dataset.menuTop)');
    assert(JSON.stringify(tops) === JSON.stringify(['文件', '编辑', '作图', 'Timing', '设置', '关于']), `顶级菜单 = ${JSON.stringify(tops)}`);
    const st = await evalJs(`(() => { const b = document.querySelector('[data-menu-bar]'); const cs = getComputedStyle(b);
      return { paddingRight: cs.paddingRight, appRegion: cs.appRegion || cs.webkitAppRegion }; })()`);
    if (hideTitleBar) {
      assert(st.paddingRight === '140px', `overlay 模式留白 140 (实际 ${st.paddingRight})`);
      assert(st.appRegion === 'drag', `overlay 模式菜单条兼拖拽区 (实际 ${st.appRegion})`);
    } else {
      assert(st.paddingRight === '0px', `framed 模式无留白 (实际 ${st.paddingRight})`);
      assert(st.appRegion !== 'drag', `framed 模式无拖拽区 (实际 ${st.appRegion})`);
    }
    await sleep(800);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(root, 'verifier/v281', shotFile), Buffer.from(shot.result.data, 'base64'));
    console.log('  截图:', `verifier/v281/${shotFile}`);
  } catch (e) { failures++; console.error('  ERROR:', e.message); }
  try { ws.close(); } catch { /* ignore */ }
  await killIsolated(el, profile);
}

await runMode(false, 'v281-framed.png');
await runMode(true, 'v281-overlay.png');

console.log(failures ? `\nV281_CDP_FAILED: ${failures}` : '\nV281_CDP_ALL_PASSED');
process.exit(failures ? 1 : 0);
