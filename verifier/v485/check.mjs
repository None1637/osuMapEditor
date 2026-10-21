// 验证器 v485: 「這還沒修, 選轉跟縮放都不會有效果」(soulten 对 v484 的追评) — 快捷键路径
//   v484 只修了浮窗路径 (TransformDialog nodeMode ≥2 锚点); 快捷键路由 (App.tsx rot-ccw/
//   rot-cw/flip-h/flip-v) 仍是 nodeSelectionCount 非 0 即走节点变换 — 拖锚点选区收敛为 1
//   (v410) 后单锚点绕自身旋转/镜像 = 恒等 = 没效果。缩放快捷键开浮窗 (v484 已覆盖)。
//   修复: 4 处路由改 nodeSelectionCount > 1, 单锚点+物件在选区回落物件变换 (游玩区中心)。
// 运行: npm run build 后 node verifier/v485/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码');
{
  const app = read('src/App.tsx');
  for (const [id, fn, arg] of [['rot-ccw', 'rotateSelectedNodes(-90)', 'rotateSelected(-90'],
    ['rot-cw', 'rotateSelectedNodes(90)', 'rotateSelected(90'],
    ['flip-h', "flipSelectedNodes('h')", "flipSelected('h'"],
    ['flip-v', "flipSelectedNodes('v')", "flipSelected('v'"]]) {
    const re = new RegExp(`case '${id}': e\\.preventDefault\\(\\); store\\.nodeSelectionCount > 1 \\? store\\.${fn.replace(/[()']/g, m => '\\' + m)} : store\\.${arg.replace(/[()']/g, m => '\\' + m)}`);
    assert(re.test(app), `${id} 路由 ≥2 锚点才走节点变换`);
  }
  assert(/v485: ≥2 锚点才走节点变换/.test(app), 'v485 注释记录根因');
}

section('CDP: 单锚点快捷键回落物件变换 / 双锚点仍节点变换');
{
  const PORT = 9498;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
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
    let msgId = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
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
    await normalizeEnv(evalJs);

    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      const mk = () => ({ id: 485001, type: 'slider', x: 200, y: 150, time: t,
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: 350, y: 150 }], slides: 1, length: 220 });
      const load = () => { store.load({ ...base, hitObjects: [mk()] }, store.audioUrl); store.pause && store.pause(); store.tool = 'select'; store.seek(t); store.select([485001]); };
      const head = () => { const o = store.beatmap.hitObjects.find(o => o.id === 485001); return { x: o.x, y: o.y }; };
      const key = async (k) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true })); await sleep(200); };
      const out = {};
      // 1) 单锚点 (v410 拖后收敛态) + Ctrl+. → 物件绕游玩区中心 (256,192) 顺时针 90°: (200,150)→(298,136)
      load(); store.setSelectedNodes([[485001, 1]]);
      await key('.');
      out.rotSingle = head();
      // 2) 双锚点 + Ctrl+, → 节点绕包围盒中心 (275,150) 逆时针 90°: (200,150)→(275,225)
      load(); store.setSelectedNodes([[485001, 0], [485001, 1]]);
      await key(',');
      out.rotDouble = head();
      // 3) 单锚点 + Ctrl+H → 物件绕游玩区中心水平镜像: (200,150)→(312,150)
      load(); store.setSelectedNodes([[485001, 1]]);
      await key('h');
      out.flipSingle = head();
      return out;
    })()`);

    const near = (p, x, y) => Math.abs(p.x - x) <= 2 && Math.abs(p.y - y) <= 2;
    assert(near(out.rotSingle, 298, 136), `单锚点 Ctrl+. → 物件级旋转生效 (期望 ≈(298,136), 实际 ${JSON.stringify(out.rotSingle)})`);
    assert(near(out.rotDouble, 275, 225), `双锚点 Ctrl+, → 节点级旋转保留 (期望 ≈(275,225), 实际 ${JSON.stringify(out.rotDouble)})`);
    assert(near(out.flipSingle, 312, 150), `单锚点 Ctrl+H → 物件级镜像生效 (期望 ≈(312,150), 实际 ${JSON.stringify(out.flipSingle)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V485_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V485_ALL_TESTS_PASSED');
