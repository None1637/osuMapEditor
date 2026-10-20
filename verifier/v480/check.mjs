// 验证器 v480: 两件事
//   1) Ctrl+R 刷新图谱不跳保存警告 (soulten, 极度危险) — 原 role:reload = webContents.reload()
//      整页重载, 未保存改动直接丢; 改发 menu-cmd {type:'reload-map'} 走渲染端 reloadMap
//      (v350, 内含 guardUnsaved 未保存确认)。
//   2) song setup 改基础滑条速度后弹窗: 是否同步调整所有绿线 SV (×f = 旧/新倍率) 保持滑条速度
//      不变; 红线后无绿线覆盖的区间补插 SV=f 绿线 (stable 语义红线重置 SV=1); 补偿后 SV 超出
//      0.1~10 的钳边界并额外提醒; 不插红线。
//      实现: timingSv.ts planSvCompensation/applySvCompensation 纯函数 + SetupPage 草稿提交
//      输入框 (blur/Enter 落值, 滚轮即时落值) + 500ms 防抖弹窗。
// 运行: npm run build 后 node verifier/v480/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: Ctrl+R → reload-map (v480)');
{
  const main = read('electron/main.cjs');
  assert(!/role === "reload"/.test(main) && !/role: "reload"/.test(main), 'role:reload 整页重载已移除');
  assert(/\{ label: mT\("menu\.reload"\), accelerator: "CmdOrCtrl\+R", enabled: !!menuState, click: \(\) => send\(\{ type: "reload-map" \}\) \}/.test(main), '菜单项改发 reload-map 命令 (Ctrl+R)');
  const bridge = read('src/osu/electronBridge.ts');
  assert(/\{ type: 'reload-map' \}/.test(bridge), 'ElectronMenuCommand 含 reload-map');
  const app = read('src/App.tsx');
  assert(/cmd\.type === 'reload-map'\) \{ void reloadMapRef\.current\(\)/.test(app), 'App 处理 reload-map → reloadMapRef');
  assert(/const reloadMapRef = useRef\(reloadMap\)/.test(app), 'reloadMapRef ([] 依赖 effect 防陈旧闭包)');
}

section('源码: SV 补偿弹窗 (v480)');
{
  const sv = read('src/osu/timingSv.ts');
  assert(/export function planSvCompensation/.test(sv) && /export function applySvCompensation/.test(sv), 'plan/apply 纯函数导出');
  assert(/红线时刻补插 SV=f 的绿线/.test(sv), '红线后无覆盖区间补绿线 (注释语义)');
  const setup = read('src/components/SetupPage.tsx');
  assert(/data-dialog="sv-comp"/.test(setup) && /data-sv-comp="apply"/.test(setup) && /data-sv-comp="skip"/.test(setup), '弹窗 + 双按钮探针钩子');
  assert(/planSvCompensation\(bm\.timingPoints, base \/ cur\)/.test(setup), '防抖弹窗 f = 基线/当前');
  assert(/applySvCompensation\(bm\.timingPoints/.test(setup), '应用走 applySvCompensation');
  const dict = read('src/i18n/dicts/zh-CN/setup.ts');
  for (const k of ['sv_comp_title', 'sv_comp_body', 'sv_comp_insert', 'sv_comp_clamp_warn', 'sv_comp_apply', 'sv_comp_skip'])
    assert(dict.includes(`'setup.${k}'`), `zh-CN ${k}`);
}

section('CDP: 全链路');
{
  const PORT = 9490;
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
    await normalizeEnv(evalJs);

    // ---- Req2: Ctrl+R 脏状态跳未保存警告 (经菜单项 menuItemClick 全链路) ----
    const r1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const api = window.osuEditor;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      // 造脏: 加一个物件
      const o = { ...store.beatmap.hitObjects[0], id: 480001, time: 99999 };
      store.pushUndo(); store.beatmap.hitObjects.push(o); store.emit();
      await sleep(100);
      const dirty = store.dirty;
      // 找菜单里的「刷新」项 id 并点击 (主进程 click → menu-cmd → 渲染端 reloadMap)
      const def = await api.getMenuDefinition();
      let reloadId = null;
      const walk = (items) => { for (const it of items || []) { if (it.id && /Reload|刷新|重新整理/.test(it.label)) reloadId = it.id; if (it.submenu) walk(it.submenu); } };
      walk(def);
      if (reloadId) api.menuItemClick(reloadId);
      await sleep(600);
      return { dirty, reloadId, unsavedShown: !!document.querySelector('[data-unsaved-dialog="root"]'),
        stillThere: !!store.beatmap.hitObjects.find(x => x.id === 480001), reloaded: false };
    })()`);
    assert(r1.dirty, '造脏成功');
    assert(r1.reloadId, `菜单「刷新」项存在 (${r1.reloadId})`);
    assert(r1.unsavedShown, 'Ctrl+R 菜单命令 → 脏状态弹未保存警告 (v480 修复点)');
    assert(r1.stillThere, '未保存改动未被丢弃');
    // 点「取消」关窗, 别影响后续用例
    await evalJs(`document.querySelector('[data-unsaved-dialog="cancel"]')?.click()`);
    await sleep(300);

    // ---- Req1: song setup 改滑条速度 → SV 补偿弹窗 ----
    const r2 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      // 两条红线 (0 / 5000), 0 处一条 SV=1.5 绿线 → 5000 红线后无绿线覆盖
      const tps = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 },
        { time: 0, beatLength: -66.66666666666667, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: false, effects: 0 },
        { time: 5000, beatLength: 400, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 },
      ];
      const slider = { ...(base.hitObjects.find(o => o.type === 'slider') || base.hitObjects[0]), id: 480002,
        type: 'slider', time: 6000, x: 200, y: 200, curveType: 'L', curvePoints: [{ x: 300, y: 200 }], slides: 1, length: 200 };
      store.load({ ...base, hitObjects: [slider], timingPoints: tps }, store.audioUrl);
      store.pause && store.pause();
      // 切到 song setup 页签
      [...document.querySelectorAll('button')].find(b => /song setup/i.test(b.textContent))?.click();
      await sleep(400);
      const inp = document.querySelector('[data-setup="slider-multiplier"]');
      if (!inp) return { err: 'no input' };
      const mult0 = store.beatmap.difficulty.sliderMultiplier;
      // 未聚焦改动 (= 滚轮路径): 即时提交
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const v1 = Math.round(mult0 / 2 * 100) / 100; // f = 2
      setter.call(inp, String(v1));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(900); // 防抖 500ms
      const dlg = !!document.querySelector('[data-dialog="sv-comp"]');
      const insertLine = !!document.querySelector('[data-dialog="sv-comp"]')?.textContent.match(/插入|insert/i);
      const warnLine = !!document.querySelector('[data-dialog="sv-comp"]')?.textContent.match(/0\.1~10/);
      // 点「同步调整」
      document.querySelector('[data-sv-comp="apply"]')?.click();
      await sleep(300);
      const tpsAfter = store.beatmap.timingPoints;
      const greens = tpsAfter.filter(p => !p.uninherited);
      const svOf = (p) => Math.round(-100 / p.beatLength * 10000) / 10000;
      const g0 = greens.find(p => p.time === 0);
      const g5000 = greens.find(p => p.time === 5000);
      return { mult0, v1, multNow: store.beatmap.difficulty.sliderMultiplier, dlg, insertLine, warnLine,
        greensCount: greens.length, sv0: g0 ? svOf(g0) : null, sv5000: g5000 ? svOf(g5000) : null,
        closedAfterApply: !document.querySelector('[data-dialog="sv-comp"]') };
    })()`);
    assert(!r2.err, 'slider-multiplier 输入框存在');
    assert(r2.multNow === r2.v1, `倍率已改 (${r2.mult0} → ${r2.multNow})`);
    assert(r2.dlg, '改滑条速度后弹出 SV 补偿窗');
    assert(r2.insertLine, '弹窗含插入绿线说明');
    assert(!r2.warnLine, 'f=2 无越界 → 不显示额外提醒');
    assert(r2.greensCount === 2, `绿线 1→2 条 (5000 红线后补插; 实际 ${r2.greensCount})`);
    assert(r2.sv0 === 3, `原绿线 SV 1.5×2=3 (实际 ${r2.sv0})`);
    assert(r2.sv5000 === 2, `插入绿线 SV=f=2 (实际 ${r2.sv5000})`);
    assert(r2.closedAfterApply, '应用后关窗');

    // 越界提醒 + 不调整路径
    const r3 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const inp = document.querySelector('[data-setup="slider-multiplier"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const cur = store.beatmap.difficulty.sliderMultiplier;
      setter.call(inp, String(cur / 10)); // f=10 → 绿线 3×10=30 > 10 越界
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(900);
      const dlg = document.querySelector('[data-dialog="sv-comp"]');
      const warnLine = !!dlg?.textContent.match(/0\.1~10/);
      const greensBefore = store.beatmap.timingPoints.filter(p => !p.uninherited).length;
      document.querySelector('[data-sv-comp="skip"]')?.click(); // 不调整
      await sleep(300);
      const greensAfter = store.beatmap.timingPoints.filter(p => !p.uninherited).length;
      return { warnLine, greensBefore, greensAfter, closed: !document.querySelector('[data-dialog="sv-comp"]') };
    })()`);
    assert(r3.warnLine, '越界时显示 0.1~10 额外提醒');
    assert(r3.greensAfter === r3.greensBefore, '「不调整」不动绿线');
    assert(r3.closed, '「不调整」关窗');

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V480_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V480_ALL_TESTS_PASSED');
