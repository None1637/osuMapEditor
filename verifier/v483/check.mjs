// 验证器 v483: 开游玩区平移后光标在游玩区 (osu 界) 外拉滑条无法实时预览 (用户反馈)
//   根因: 放置幽灵/幻影尾点的渲染门控用 cur.inside (osu 坐标 ∈ [0,512]×[0,384])。
//   无平移时游玩区≈铺满画布, 界外只有窄留白碰不到; 开平移 (尤其缩小) 后画布大片区域
//   逆变换落在 osu 界外 → inside=false → 预览冻结。toOsu 对界外坐标本就工作正常,
//   pendingCursor 一直在更新, 纯粹是渲染门控丢弃。
//   修复: cursorRef 拆出 over (光标在 canvas 元素上), 三处渲染门控 inside→over;
//   inside 保留给真正需要 osu 界语义的逻辑 (limitToPlayfield 钳制/间距面板预览)。
//   钩子: window.__placeGhost (与 __dragState 同款调试/验证钩子)。
// 运行: npm run build 后 node verifier/v483/check.mjs
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
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/cursorRef = useRef<\{ x: number; y: number; inside: boolean; over: boolean \}>/.test(ec), 'cursorRef 带 over 标志');
  assert(/cursorRef\.current = \{ x: cp\.x, y: cp\.y, inside: [^}]+, over: true \}/.test(ec), 'onMouseMove 置 over=true');
  assert(/cursorRef\.current\.over = false;/.test(ec), 'onMouseLeave 置 over=false');
  assert(/&& \(cur\.over \|\| !store\.limitToPlayfield \|\| placingDrag\)\)/.test(ec), '幽灵总门控改 over');
  assert(/computePendingPath\(store\.pendingSlider, cur\.over \? store\.pendingCursor : null\)/.test(ec), '幻影尾点门控改 over');
  assert(/cur\.over && store\.tool === 'slider' && !store\.playing/.test(ec), 'renderPlayfield 幻影点门控改 over');
  assert(/__placeGhost = ghosts;/.test(ec) && /__placeGhost = null;/.test(ec), '__placeGhost 钩子');
}

section('CDP: 开平移缩小后 osu 界外预览实时跟随');
{
  const PORT = 9496;
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
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);

    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      // 开平移 + 缩小 — 画布大片区域逆变换落在 osu 界外
      store.playfieldPanEnabled = true; store.playfieldScale = 0.6; store.playfieldPanX = 0; store.playfieldPanY = 0;
      store.pause && store.pause(); store.tool = 'slider'; store.emit();
      store.pendingSlider = [{ x: 100, y: 192 }];
      const c = [...document.querySelectorAll('canvas')].sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return rb.width * rb.height - ra.width * ra.height;
      })[0]; // 游玩区 = 面积最大的 canvas
      const r = c.getBoundingClientRect();
      const mv = async (ox, oy) => {
        const p = window.__osuToClient(ox, oy);
        const cx = p.x, cy = p.y;
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy, buttons: 0, bubbles: true }));
        await sleep(160);
        return { cx, cy, inCanvas: cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom,
          ghost: (window.__placeGhost || null) && window.__placeGhost.map(g => ({ t: g.type, n: (g.curvePoints || []).length, len: Math.round(g.length || 0) })) };
      };
      const out = {};
      out.outA = await mv(600, 192);   // osu 界外 (x>512)
      out.outB = await mv(680, 260);   // 界外另一点 — 预览应实时变化
      out.inside = await mv(300, 192); // 界内对照
      c.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null })); // React onMouseLeave 由 mouseout 合成
      await sleep(160);
      out.afterLeave = window.__placeGhost;
      out.limit = store.limitToPlayfield;
      return out;
    })()`);

    assert(out.outA.inCanvas && out.outB.inCanvas, `布景: 界外两点仍在 canvas 元素内 (A=${out.outA.inCanvas} B=${out.outB.inCanvas})`);
    assert(out.outA.ghost && out.outA.ghost[0] && out.outA.ghost[0].t === 'slider' && out.outA.ghost[0].n >= 1,
      `osu 界外: 滑条幽灵+幻影尾点渲染 (实际 ${JSON.stringify(out.outA.ghost)})`);
    assert(out.outB.ghost && out.outB.ghost[0] && JSON.stringify(out.outB.ghost) !== JSON.stringify(out.outA.ghost),
      `界外移动: 预览实时跟随 (A=${JSON.stringify(out.outA.ghost)} B=${JSON.stringify(out.outB.ghost)})`);
    assert(out.inside.ghost && out.inside.ghost[0] && out.inside.ghost[0].t === 'slider',
      `界内对照: 幽灵正常 (${JSON.stringify(out.inside.ghost)})`);
    assert(out.afterLeave === null, `mouseleave 后幽灵清除 (over=false, limitToPlayfield=${out.limit}, 实际 ${JSON.stringify(out.afterLeave)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V483_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V483_ALL_TESTS_PASSED');
