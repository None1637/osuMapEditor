// 验证器 v378: 六项交互修复 (全部来自用户反馈)
//  1) 未选中滑条的锚点可直接拖 (自动选中该滑条进入节点编辑; stable 行为) —
//     原必须先选中滑条才能拖它的锚点。新增 unselectedSliderNodePress (onMouseDown 物件命中前 intercept;
//     头部锚点 idx=0 排除 — 头部 = 物件本体抓取点, 空选区按头部仍是物件拖拽, v369 语义不变)。
//  2) 四侧 UI 覆盖区穿透扩展到全部可互动物件 — v361/v362 只穿透锚点交互;
//     现 playfieldNodePress 补齐 onMouseDown 完整优先级链: 旋转/缩放手柄 (抽至 selectionHandlePress)
//     → Alt → 整组拖拽 → 单滑条节点 → 未选锚点 → 物件本体拖拽 (抽至 objectPress); 空白不拦截。
//  3) (a) 覆盖区右键删锚点/红转白 — 新增 contextmenu 捕获拦截 + playfieldNodeContext
//     (onContextMenu 锚点分支抽至 sliderAnchorContextPress); (b) 锚点命中压过控件 —
//     捕获拦截先判 playfieldAnchorHit, 命中即吞 (即使落在输入框/按钮上); 只有锚点压过控件,
//     物件/手柄命中仍保持控件优先。
//  4) 关闭显示设置「选中包围框」后节点框选组不再生成 quads — 原开关只挡绘制, 复选滑条点的
//     黄框 (dq) 仍参与整组拖拽 insideBox (v309) 与手柄命中 = 看不见但仍能交互; 现 currentQuads
//     整体按 selectionBounds 门控 (开关进 memo 键)。
//  5) Alt 锚点黄圈半径改固定屏幕 px — hover 环原固定 9 osu px (缩放跟着变), 选中节点环补 uiZoom;
//     统一 视觉px / uiZoom() / playfieldTransform(...).scale 换算 (v217 基准)。
//  6) 选中框四角旋转手柄偏移 (ROT_HANDLE_OUT=12.5) 改固定屏幕 px — rotationHandlePoints/
//     hitRotationHandle 加 out 参数, 绘制/命中同参 (默认参数保持 v50 纯函数行为)。
// 运行: npm run build 后 node verifier/v378/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs'; // v383: 环境归一共享 helper

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundleOut = path.join(root, 'verifier/v378/_bundle.mjs');
buildSync({ entryPoints: [path.join(root, 'verifier/v378/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: bundleOut });

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + bundleOut);
fs.unlinkSync(bundleOut);

section('源码: 需求1 未选滑条锚点直接拖');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/const unselectedSliderNodePress = \(p: Pt/.test(ec), 'unselectedSliderNodePress 抽函数存在');
  assert(/if \(unselectedSliderNodePress\(p, e\)\) return;/.test(ec), '画布 onMouseDown 接入 (物件命中前)');
  assert(/if \(unselectedSliderNodePress\(p, mods\)\) return true;/.test(ec), '穿透链接入 (playfieldNodePress)');
  assert(/hitNode\.idx === 0/.test(ec), '头部锚点排除 (头部 = 物件本体抓取点, v369 语义不变)');
  assert(/store\.select\(\[hitNode\.objId\]\)/.test(ec), '命中锚点自动选中该滑条');
}

section('源码: 需求2 穿透扩展 (手柄/物件本体)');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/const selectionHandlePress = \(p: Pt/.test(ec) && /if \(selectionHandlePress\(p, e\)\) return;/.test(ec), 'selectionHandlePress 抽出且画布共用');
  assert(/const objectPress = \(p: Pt/.test(ec) && /if \(objectPress\(p, e\)\) return;/.test(ec), 'objectPress 抽出且画布共用');
  const press = ec.match(/store\.playfieldNodePress = \(cx, cy, mods\) => \{[\s\S]{0,1400}?\n    \};/)?.[0] ?? '';
  assert(/selectionHandlePress\(p, mods\)\) return true/.test(press), '穿透: 旋转/缩放手柄');
  assert(/return objectPress\(p, mods\);/.test(press), '穿透: 物件本体拖拽 (末尾)');
  assert(press.indexOf('nodeAltPress') > press.indexOf('selectionHandlePress') && press.indexOf('singleSliderNodePress') > press.indexOf('nodeAltPress')
    && press.indexOf('unselectedSliderNodePress') > press.indexOf('singleSliderNodePress'), '穿透顺序与 onMouseDown 一致 (手柄→Alt→整组→单滑条→未选锚点)');
}

section('源码: 需求3 右键穿透 + 锚点压过控件');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/const sliderAnchorContextPress = \(p: Pt\): boolean/.test(ec), 'sliderAnchorContextPress 抽函数存在');
  assert(/if \(sliderAnchorContextPress\(toOsu\(e\)\)\) return;/.test(ec), '画布 onContextMenu 调用同一函数');
  assert(/store\.playfieldNodeContext = \(cx, cy\)/.test(ec), '注册 playfieldNodeContext');
  assert(/store\.playfieldAnchorHit = \(cx, cy, mods\)/.test(ec), '注册 playfieldAnchorHit');
  assert(/window\.addEventListener\('contextmenu', onCtx, true\)/.test(ec), 'contextmenu 捕获拦截 (覆盖区右键删锚点)');
  const onDown = ec.match(/const onDown = \(e: MouseEvent\) => \{[\s\S]{0,1400}?\n    \};/)?.[0] ?? ''; // v404: 窗口 700→1400 (加可交互UI分支)
  assert(/anchorFirst/.test(onDown) && onDown.indexOf('anchorFirst') < onDown.indexOf("el.closest('button"), '锚点命中先于控件优先判定');
  const st = read('src/osu/store.ts');
  assert(/playfieldAnchorHit: \(\(clientX/.test(st) && /playfieldNodeContext: \(\(clientX/.test(st), 'store 桥字段声明');
}

section('源码: 需求4 关包围框后节点框不生成/不命中');
{
  const ec = read('src/components/EditorCanvas.tsx');
  const cq = ec.match(/const currentQuads = \(bm: Beatmap\)[\s\S]{0,1600}?\n  \};/)?.[0] ?? '';
  assert(/if \(displaySettings\.selectionBounds\) \{/.test(cq), 'currentQuads 整体按 selectionBounds 门控 (节点层同物件层)');
  assert(/selectionSig\(\)\}\|\$\{displaySettings\.selectionBounds/.test(cq), '开关进 memo 键 (切换立即生效)');
}

section('源码: 需求5/6 固定屏幕 px');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/g\.arc\(pt\.x, pt\.y, 9 \/ uiZoom\(\) \/ scale/.test(ec), 'Alt hover 锚点环半径固定屏幕 px');
  assert(/const rr = 10 \/ uiZoom\(\) \/ scale/.test(ec), '选中节点黄环半径固定屏幕 px (补 uiZoom)');
  assert(/const rotOut = ROT_HANDLE_OUT \/ uiZoom\(\) \/ scale/.test(ec) && /rotationHandlePoints\(dq, rotOut\)/.test(ec), '旋转手柄偏移固定屏幕 px (绘制)');
  assert(/hitRotationHandle\(quads\.dq, p, tol, rotHandleOut\(\)\)/.test(ec) && /hitRotationHandle\(quads0\.dq, p, tol, rotHandleOut\(\)\)/.test(ec), '旋转手柄命中同参 (hover/按下)');
  const sb = read('src/osu/selectionBox.ts');
  assert(/rotationHandlePoints\(dq: Quad, out: number = ROT_HANDLE_OUT\)/.test(sb), 'rotationHandlePoints out 参数 (默认 12.5 兼容 v50)');
  assert(/hitRotationHandle\(dq: Quad, p: Pt, tol: number, out: number = ROT_HANDLE_OUT\)/.test(sb), 'hitRotationHandle out 参数');
}

section('CDP: 六项行为实测');
{
  const PORT = 9478;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT); // v383: 隔离 userData, 不碰真实 settings/localStorage
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
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs); // v383: 环境归一 (语言 en / 默认皮肤 / 关曲库面板遮罩 / 清污染 localStorage 键)
    await evalJs(`window.__osuSetLang && window.__osuSetLang('en')`); // v378: 关首跑语言框 (v349 LangFirstRun; localStorage 按 dev 端口隔离, 端口变即弹全屏遮罩拦截真实事件/elementFromPoint)
    await sleep(800); // 布局稳定

    // 场景: 五条滑条/一个单点, 各据测试区位 —
    //   378001 中央斜滑条 (需求1/4/5/6, 头 256,120 cp (316,195) (376,270));
    //   378002 尾锚点/包围框角落在下时间轴覆盖带 (需求2 手柄穿透);
    //   378003 尾锚点在左侧栏输入控件 (select) 上 (需求3b);
    //   378004 单点在左侧栏非控件区 (需求2 物件穿透);
    //   378005 三控制点滑条, 中锚点在下时间轴覆盖带 (需求3a 右键删除)
    const setup = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const p0 = window.__osuToClient(0, 0), px = window.__osuToClient(1, 0), py = window.__osuToClient(0, 1);
      const szx = px.x - p0.x, szy = py.y - p0.y; // 视觉 px / osu px
      const toOsu = (cx, cy) => ({ x: (cx - p0.x) / szx, y: (cy - p0.y) / szy });
      const base = store.beatmap;
      const cs = base.difficulty.cs, radius = 54.4 - 4.48 * cs;
      const red = base.timingPoints.find(p => p.uninherited);
      const mk = (id, x, y, cps, beats, len = 300) => ({ id, type: 'slider', x: Math.round(x), y: Math.round(y), time: Math.round(red.time + red.beatLength * beats),
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L', curvePoints: cps.map(c => ({ x: Math.round(c[0]), y: Math.round(c[1]) })), slides: 1, length: len });

      // 378002: 斜滑条 (w/h>0 才有角手柄), 包围盒 br 角落在下时间轴覆盖带;
      //   length = 几何全长 (路径尾 = cp1) — 显示盒 dq 才能按控制点盒精确预算手柄位置
      const bottomC = document.querySelector('canvas.flex-1');
      const br = bottomC.getBoundingClientRect();
      // v378 加固: 落点取覆盖带垂直中央 (原 br.top+12 贴带上沿, 布局微变即翻出带外 flaky)
      const T = { x: br.left + br.width * 0.45, y: br.top + br.height / 2 }; // 覆盖带内目标点 (视觉 px)
      const osuT = toOsu(T.x, T.y);
      const h2 = { x: osuT.x - 80 - radius - 5, y: osuT.y - 100 - radius - 5 }; // br 手柄 = cp1 + (radius+5)
      const s2 = mk(378002, h2.x, h2.y, [[h2.x + 80, h2.y + 100]], 10, Math.round(Math.hypot(80, 100)));

      // 378007: 旋转手柄穿透专用 (与 378002 同构另一位点; 两测试分滑条避免缩放改动几何后手柄位置失算)
      const Tr = { x: br.left + br.width * 0.62, y: br.top + br.height / 2 }; // v378 加固: 同 2b 取带中央
      const osuTr = toOsu(Tr.x, Tr.y);
      const h2r = { x: osuTr.x - 80 - radius - 5, y: osuTr.y - 100 - radius - 5 };
      const s2r = mk(378007, h2r.x, h2r.y, [[h2r.x + 80, h2r.y + 100]], 30, Math.round(Math.hypot(80, 100)));

      // 378003: 尾锚点压在左侧栏 select (节拍吸附下拉) 中心
      const sel3 = document.querySelector('div.w-56 select');
      const s3r = sel3.getBoundingClientRect();
      const a3 = toOsu(s3r.left + s3r.width / 2, s3r.top + s3r.height / 2);
      const s3 = mk(378003, a3.x, a3.y + 200, [[a3.x, a3.y]], 14);

      // 378004: 单点 — 下时间轴覆盖带 (物件本体穿透; 左侧栏全是控件无非控件落点,
      //   覆盖区 canvas 非控件, 命中物件即吞不再 seek)。横向拖避免越界钳制干扰
      let a4 = null;
      for (let fx = 0.15; fx < 0.9 && !a4; fx += 0.05) {
        const o = toOsu(br.left + br.width * fx, br.top + br.height / 2);
        if (o.x > 60 && o.x < 420) a4 = o;
      }
      if (!a4) throw new Error('下时间轴覆盖带找不到界内 x 落点');
      const c4 = { id: 378004, type: 'circle', x: Math.round(a4.x), y: Math.round(a4.y), time: Math.round(red.time + red.beatLength * 18),
        newCombo: true, comboSkip: 0, hitSound: 0 };

      // 378005: 中锚点在下时间轴覆盖带中央 (右键删除目标)
      const a5 = toOsu(br.left + br.width * 0.7, br.top + br.height / 2);
      const s5 = mk(378005, a5.x - 120, a5.y + 160, [[a5.x, a5.y], [a5.x + 120, a5.y + 160]], 22);

      const s1 = mk(378001, 256, 120, [[316, 195], [376, 270]], 26);
      store.load({ ...base, hitObjects: [s1, s2, s2r, s3, c4, s5] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.lockNotes = false;
      store.setDisplayFlag('selectionBounds', true); // v378 加固: 包围框开关持久化在 localStorage,
      //   前次运行收尾写盘可能被 electron.kill() 抢先 (leveldb 异步 flush) 留下 false → 2b/2c 手柄 quads 不生成 flaky
      await sleep(400);
      return { szx, radius, t1: s1.time, t2: s2.time, t2r: s2r.time, t3: s3.time, t4: c4.time, t5: s5.time };
    })()`);

    // ---- 需求1: 未选滑条锚点直接拖 (画布内) ----
    const r1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      store.seek(${setup.t1});
      store.clearSelection(); store.setSelectedNodes([]);
      const o = store.beatmap.hitObjects.find(x => x.id === 378001);
      const pt = window.__osuToClient(o.curvePoints[1].x, o.curvePoints[1].y); // 尾锚点 (idx 2)
      const head0 = { x: o.x, y: o.y }, cp0 = { x: o.curvePoints[1].x, y: o.curvePoints[1].y };
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      const dragging = store.canvasDragging;
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + 50, clientY: pt.y + 20, bubbles: true }));
      await sleep(250);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 50, clientY: pt.y + 20, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 50, clientY: pt.y + 20, bubbles: true }));
      await sleep(100);
      return { dragging, sel: [...store.selected], head: { x: o.x, y: o.y }, cp: { x: o.curvePoints[1].x, y: o.curvePoints[1].y }, head0, cp0 };
    })()`);
    assert(r1.dragging && r1.sel.length === 1 && r1.sel[0] === 378001, `1a: 未选滑条锚点按下 = 自动选中该滑条并拖拽 (选中 ${JSON.stringify(r1.sel)})`);
    assert(r1.head.x === r1.head0.x && r1.head.y === r1.head0.y, '1b: 头部不动 (是节点拖拽不是物件拖拽)');
    const d1x = r1.cp.x - r1.cp0.x, d1y = r1.cp.y - r1.cp0.y;
    assert(Math.abs(d1x - 50 / setup.szx) <= 4 && Math.abs(d1y - 20 / setup.szx) <= 4, `1c: 锚点随拖动精确位移 (dx ${d1x} ≈ ${(50 / setup.szx).toFixed(1)}, dy ${d1y} ≈ ${(20 / setup.szx).toFixed(1)})`);

    // 需求1 负例: 滑条身中段按下仍是物件拖拽 (整件移动)
    const r1b = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const o = store.beatmap.hitObjects.find(x => x.id === 378001);
      // 第二段中点 (距各锚点 >10 osu px) — 第一/三段中点会误压中锚点 cp0
      const mid = { x: (o.curvePoints[0].x + o.curvePoints[1].x) / 2, y: (o.curvePoints[0].y + o.curvePoints[1].y) / 2 };
      const pt = window.__osuToClient(mid.x, mid.y);
      const h0 = { x: o.x, y: o.y }, t0 = { x: o.curvePoints[1].x, y: o.curvePoints[1].y };
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x - 30, clientY: pt.y, bubbles: true }));
      await sleep(250);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x - 30, clientY: pt.y, bubbles: true }));
      await sleep(100);
      return { head: { x: o.x, y: o.y }, tail: { x: o.curvePoints[1].x, y: o.curvePoints[1].y }, h0, t0 };
    })()`);
    assert(r1b.head.x !== r1b.h0.x && r1b.tail.x !== r1b.t0.x && (r1b.tail.x - r1b.head.x) === (r1b.t0.x - r1b.h0.x),
      `1d: 滑条身中段按下仍是物件整体拖拽 (头 ${r1b.h0.x}→${r1b.head.x}, 尾同步)`);

    // ---- 需求2a: 下时间轴覆盖区物件本体拖拽 (单点; 不再 seek) ----
    const r2a = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.seek(${setup.t4});
      store.clearSelection(); store.setSelectedNodes([]);
      const o = store.beatmap.hitObjects.find(x => x.id === 378004);
      const pt = window.__osuToClient(o.x, o.y);
      const bottomC = document.querySelector('canvas.flex-1');
      const t0 = store.currentTime;
      const x0 = o.x;
      const consumed = !bottomC.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      const dragging = store.canvasDragging;
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + 40, clientY: pt.y, bubbles: true }));
      await sleep(250);
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 40, clientY: pt.y, bubbles: true }));
      await sleep(100);
      return { consumed, dragging, sel: [...store.selected], dx: o.x - x0, seeked: store.currentTime !== t0 };
    })()`);
    assert(r2a.consumed && r2a.dragging, '2a: 下时间轴按下单点 = 穿透拖拽 (事件被吞)');
    assert(r2a.sel.includes(378004) && Math.abs(r2a.dx - 40 / setup.szx) <= 4, `2a: 单点被选中并随拖动位移 (dx ${r2a.dx} ≈ ${(40 / setup.szx).toFixed(1)})`);
    assert(!r2a.seeked, '2a: 穿透命中后下时间轴不 seek');

    // ---- 需求2b: 下时间轴覆盖区缩放手柄 ----
    const r2b = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      // v378 加固: 等上段拖拽 rAF 收尾 (v341 节流, 机器忙时 100ms 不够; canvasDragging=true 时
      //   playfieldNodePress 直接 false → consumed 假失败), 且首次未吞时重算落点重试一次
      for (let i = 0; i < 30 && store.canvasDragging; i++) await sleep(50);
      store.seek(${setup.t2});
      store.clearSelection(); store.setSelectedNodes([]);
      store.select([378002]);
      const o = store.beatmap.hitObjects.find(x => x.id === 378002);
      const radius = ${setup.radius};
      const bottomC = document.querySelector('canvas.flex-1');
      const lenOf = () => Math.hypot(o.curvePoints[0].x - o.x, o.curvePoints[0].y - o.y);
      const len0 = lenOf();
      let pt = null, inBottomEl = null, consumed = false, dragging = false;
      for (let attempt = 0; attempt < 2 && !consumed; attempt++) {
        if (attempt) await sleep(300);
        const brH = { x: o.curvePoints[0].x + radius + 5, y: o.curvePoints[0].y + radius + 5 }; // dq 的 br 角 = 缩放手柄
        pt = window.__osuToClient(brH.x, brH.y);
        inBottomEl = document.elementFromPoint(pt.x, pt.y);
        consumed = !bottomC.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
        dragging = store.canvasDragging;
        if (!consumed) continue;
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + 30, clientY: pt.y + 30, bubbles: true }));
        await sleep(250);
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 30, clientY: pt.y + 30, bubbles: true }));
        await sleep(100);
      }
      const brNow = bottomC.getBoundingClientRect();
      return { consumed, dragging, len0, len1: lenOf(), inBottom: !!inBottomEl && inBottomEl === bottomC,
        pt, brNow: { left: brNow.left, top: brNow.top, width: brNow.width, height: brNow.height },
        hitEl: inBottomEl ? inBottomEl.tagName + '.' + String(inBottomEl.className).slice(0, 60) : null };
    })()`);
    assert(r2b.inBottom, `2b: 缩放手柄落点确实在下时间轴覆盖带上 (pt ${JSON.stringify(r2b.pt)}, 带 ${JSON.stringify(r2b.brNow)}, 命中 ${r2b.hitEl})`);
    assert(r2b.consumed && r2b.dragging, '2b: 下时间轴按下缩放手柄 = 穿透 (事件被吞)');
    assert(r2b.len1 > r2b.len0 + 5, `2b: 拖 br 手柄滑条被放大 (控制点距头 ${r2b.len0.toFixed(1)} → ${r2b.len1.toFixed(1)})`);

    // ---- 需求2c: 下时间轴覆盖区旋转手柄 (独立滑条 378007, 几何未被 2b 改动) ----
    const r2c = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30 && store.canvasDragging; i++) await sleep(50); // v378 加固: 等上段拖拽收尾 (同 2b)
      store.seek(${setup.t2r});
      store.clearSelection(); store.setSelectedNodes([]);
      store.select([378007]);
      const o = store.beatmap.hitObjects.find(x => x.id === 378007);
      const radius = ${setup.radius};
      const bottomC = document.querySelector('canvas.flex-1');
      const bcr = bottomC.getBoundingClientRect();
      const cp0 = { x: o.curvePoints[0].x, y: o.curvePoints[0].y }, h0 = { x: o.x, y: o.y };
      let pt = null, consumed = false, dragging = false;
      for (let attempt = 0; attempt < 2 && !consumed; attempt++) { // v378 加固: 首次未吞重试一次 (重算落点)
        if (attempt) await sleep(300);
        const corner = window.__osuToClient(o.curvePoints[0].x + radius + 5, o.curvePoints[0].y + radius + 5); // dq br 角
        pt = { x: corner.x + 12.5, y: corner.y + 12.5 }; // v378: 手柄固定 12.5 视觉 px 外
        consumed = !bottomC.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
        dragging = store.canvasDragging;
        if (!consumed) continue;
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + 40, clientY: pt.y, bubbles: true }));
        await sleep(250);
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 40, clientY: pt.y, bubbles: true }));
        await sleep(100);
      }
      return { consumed, dragging, cp0, cp1: { x: o.curvePoints[0].x, y: o.curvePoints[0].y }, h0, h1: { x: o.x, y: o.y },
        inBottom: pt.y > bcr.top && pt.y < bcr.bottom };
    })()`);
    assert(r2c.inBottom, '2c: 旋转手柄落点在下时间轴覆盖带内');
    assert(r2c.consumed && r2c.dragging, '2c: 下时间轴按下旋转手柄 = 穿透 (事件被吞)');
    assert(r2c.h1.x === r2c.h0.x && r2c.h1.y === r2c.h0.y && (r2c.cp1.x !== r2c.cp0.x || r2c.cp1.y !== r2c.cp0.y),
      `2c: 拖旋转手柄滑条被旋转 (头不动, 控制点 ${JSON.stringify(r2c.cp0)} → ${JSON.stringify(r2c.cp1)})`);

    // ---- 需求3a: 下时间轴覆盖区右键删锚点 ----
    const r3a = await evalJs(`(() => {
      const store = window.__osuStore;
      store.seek(${setup.t5});
      store.clearSelection(); store.setSelectedNodes([]);
      store.select([378005]);
      const o = store.beatmap.hitObjects.find(x => x.id === 378005);
      const n0 = o.curvePoints.length;
      const pt = window.__osuToClient(o.curvePoints[0].x, o.curvePoints[0].y); // 中锚点 (idx 1)
      const bottomC = document.querySelector('canvas.flex-1');
      const consumed = !bottomC.dispatchEvent(new MouseEvent('contextmenu', { clientX: pt.x, clientY: pt.y, button: 2, bubbles: true, cancelable: true }));
      return { consumed, n0, n1: o.curvePoints.length };
    })()`);
    assert(r3a.consumed && r3a.n0 === 2 && r3a.n1 === 1, `3a: 下时间轴右键锚点 = 穿透删除 (${r3a.n0} → ${r3a.n1}, 事件被吞)`);

    // ---- 需求3b: 输入控件上的锚点 — 锚点优先, 控件被压过 ----
    const r3b = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.seek(${setup.t3});
      store.clearSelection(); store.setSelectedNodes([]);
      const o = store.beatmap.hitObjects.find(x => x.id === 378003);
      const sel3 = document.querySelector('div.w-56 select');
      const pt = window.__osuToClient(o.curvePoints[0].x, o.curvePoints[0].y);
      const cp0 = { x: o.curvePoints[0].x, y: o.curvePoints[0].y };
      const consumed = !sel3.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      const dragging = store.canvasDragging;
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x, clientY: pt.y + 30, bubbles: true }));
      await sleep(250);
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y + 30, bubbles: true }));
      await sleep(100);
      return { consumed, dragging, focused: document.activeElement === sel3, sel: [...store.selected],
        moved: o.curvePoints[0].y !== cp0.y };
    })()`);
    assert(r3b.consumed && r3b.dragging && !r3b.focused, '3b: 输入控件 (select) 上的锚点按下 = 锚点优先 (吞事件, 控件不聚焦)');
    assert(r3b.sel.length === 1 && r3b.sel[0] === 378003 && r3b.moved, '3b: 自动选中并拖动锚点');

    // ---- 需求3b 负例: 非锚点处控件仍优先 ----
    const r3c = await evalJs(`(() => {
      const btn = document.querySelector('div.w-56 button');
      const r = btn.getBoundingClientRect();
      const consumed = !btn.dispatchEvent(new MouseEvent('mousedown', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, bubbles: true, cancelable: true }));
      return { consumed, dragging: window.__osuStore.canvasDragging };
    })()`);
    assert(!r3c.consumed && !r3c.dragging, '3c: 非锚点处按钮 mousedown 不被吞 (控件优先保持)');

    // ---- 需求4: 关闭包围框后节点框不生成/不命中 ----
    const r4on = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      store.setDisplayFlag('selectionBounds', true);
      store.seek(${setup.t1});
      store.clearSelection();
      store.setSelectedNodes([[378001, 1], [378001, 2]]); // 复选两个滑条点
      const o = store.beatmap.hitObjects.find(x => x.id === 378001);
      const n1 = o.curvePoints[0], n2 = o.curvePoints[1];
      const corner = { x: Math.min(n1.x, n2.x) - 8, y: Math.min(n1.y, n2.y) - 8 }; // 节点黄框 dq 角 (pad 8)
      const pt = window.__osuToClient(corner.x, corner.y);
      const h0 = { x: o.x, y: o.y }, p0 = { x: n1.x, y: n1.y };
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + 30, clientY: pt.y, bubbles: true }));
      await sleep(250);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 30, clientY: pt.y, bubbles: true }));
      await sleep(100);
      return { headMoved: o.x !== h0.x || o.y !== h0.y, nodeMoved: o.curvePoints[0].x !== p0.x, selEmpty: store.selected.size === 0 };
    })()`);
    assert(!r4on.headMoved && r4on.nodeMoved && r4on.selEmpty, '4a: 包围框开启时节点黄框内按下 = 整组拖 (基线, v309 语义不变)');

    const r4off = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      store.setDisplayFlag('selectionBounds', false); // 关闭「选中包围框」
      await sleep(300);
      const o = store.beatmap.hitObjects.find(x => x.id === 378001);
      const n1 = o.curvePoints[0], n2 = o.curvePoints[1];
      const corner = { x: Math.min(n1.x, n2.x) - 8, y: Math.min(n1.y, n2.y) - 8 };
      // 绘制判定: dq 角周边 (框线原位置) 不应再有黄色 (#f2b544) 像素
      const r = c.getBoundingClientRect(), g = c.getContext('2d');
      const dpr = c.width / r.width;
      const cc = window.__osuToClient(corner.x + 4, corner.y); // 原框线上沿中点附近
      let yellow = 0;
      const dx0 = Math.round((cc.x - r.left) * dpr), dy0 = Math.round((cc.y - r.top) * dpr);
      const img = g.getImageData(dx0 - 4, dy0 - 4, 9, 9).data;
      for (let i = 0; i < img.length; i += 4) {
        if (Math.abs(img[i] - 242) < 40 && Math.abs(img[i + 1] - 181) < 40 && Math.abs(img[i + 2] - 68) < 40) yellow++;
      }
      const pt = window.__osuToClient(corner.x, corner.y);
      const h0 = { x: o.x, y: o.y }, p0 = { x: n1.x, y: n1.y };
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + 30, clientY: pt.y, bubbles: true }));
      await sleep(250);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 30, clientY: pt.y, bubbles: true }));
      await sleep(100);
      const groupDragged = (o.x === h0.x && o.y === h0.y) && o.curvePoints[0].x !== p0.x && store.selected.size === 0;
      return { yellow, groupDragged };
    })()`);
    assert(r4off.yellow === 0, `4b: 关闭后节点黄框不再绘制 (角点黄像素 ${r4off.yellow})`);
    assert(!r4off.groupDragged, '4b: 关闭后原框内按下不再整组拖 (无隐形包围框)');
    await evalJs(`window.__osuStore.setDisplayFlag('selectionBounds', true)`);

    // ---- 需求5: Alt 锚点黄圈半径不随游玩区缩放变 ----
    // 选中节点黄环 (#f2b544, 关包围框排除框线干扰) 与 Alt hover 环 (#f5a623), zoom 1 / 2 各测一次
    const r5z1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      store.setDisplayFlag('selectionBounds', false);
      store.playfieldPanEnabled = true; store.playfieldScale = 1; store.playfieldPanX = 0; store.playfieldPanY = 0;
      store.seek(${setup.t1});
      store.clearSelection();
      store.setSelectedNodes([[378001, 2]]);
      await sleep(300);
      const o = store.beatmap.hitObjects.find(x => x.id === 378001);
      const scanSel = (rgb) => {
        const cc = window.__osuToClient(o.curvePoints[1].x, o.curvePoints[1].y);
        const r = c.getBoundingClientRect(), g = c.getContext('2d'), dpr = c.width / r.width;
        const cx0 = Math.round((cc.x - r.left) * dpr), cy0 = Math.round((cc.y - r.top) * dpr);
        const w = Math.round(40 * dpr);
        const img = g.getImageData(cx0, cy0 - 2, w, 5).data;
        for (let col = Math.round(3 * dpr); col < w - 2; col++) {
          const i = (2 * w + col) * 4;
          if (Math.abs(img[i] - rgb[0]) < 40 && Math.abs(img[i + 1] - rgb[1]) < 40 && Math.abs(img[i + 2] - rgb[2]) < 40) return col / dpr;
        }
        return -1;
      };
      const selRing = scanSel([242, 181, 68]);
      // Alt hover 头锚点环
      store.setSelectedNodes([]);
      const hp = window.__osuToClient(o.x, o.y);
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: hp.x, clientY: hp.y, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true }));
      await sleep(300);
      const hovRing = (() => {
        const cc = window.__osuToClient(o.x, o.y);
        const r = c.getBoundingClientRect(), g = c.getContext('2d'), dpr = c.width / r.width;
        const cx0 = Math.round((cc.x - r.left) * dpr), cy0 = Math.round((cc.y - r.top) * dpr);
        const w = Math.round(40 * dpr);
        const img = g.getImageData(cx0, cy0 - 2, w, 5).data;
        for (let col = Math.round(3 * dpr); col < w - 2; col++) {
          const i = (2 * w + col) * 4;
          if (Math.abs(img[i] - 245) < 40 && Math.abs(img[i + 1] - 166) < 40 && Math.abs(img[i + 2] - 35) < 40) return col / dpr;
        }
        return -1;
      })();
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
      return { selRing, hovRing };
    })()`);
    assert(r5z1.selRing > 5 && r5z1.selRing < 15, `5a: zoom=1 选中节点黄环半径 ≈10 视觉 px (实测 ${r5z1.selRing?.toFixed(1)})`);
    assert(r5z1.hovRing > 4.5 && r5z1.hovRing < 14, `5b: zoom=1 Alt hover 环半径 ≈9 视觉 px (实测 ${r5z1.hovRing?.toFixed(1)})`);

    const r5z2 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      store.playfieldScale = 2; // 游玩区放大 2x
      store.playfieldPanX = -256; store.playfieldPanY = -192; // 平移补偿: 游玩区中心保持原位 (被测锚点不出屏)
      await sleep(300);
      const o = store.beatmap.hitObjects.find(x => x.id === 378001);
      const meas = (ox, oy, rgb) => {
        const cc = window.__osuToClient(ox, oy);
        const r = c.getBoundingClientRect(), g = c.getContext('2d'), dpr = c.width / r.width;
        const cx0 = Math.round((cc.x - r.left) * dpr), cy0 = Math.round((cc.y - r.top) * dpr);
        const w = Math.round(40 * dpr);
        const img = g.getImageData(cx0, cy0 - 2, w, 5).data;
        for (let col = Math.round(3 * dpr); col < w - 2; col++) {
          const i = (2 * w + col) * 4;
          if (Math.abs(img[i] - rgb[0]) < 40 && Math.abs(img[i + 1] - rgb[1]) < 40 && Math.abs(img[i + 2] - rgb[2]) < 40) return col / dpr;
        }
        return -1;
      };
      store.setSelectedNodes([[378001, 2]]);
      await sleep(250);
      const selRing = meas(o.curvePoints[1].x, o.curvePoints[1].y, [242, 181, 68]);
      store.setSelectedNodes([]);
      const hp = window.__osuToClient(o.x, o.y);
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: hp.x, clientY: hp.y, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true }));
      await sleep(300);
      const hovRing = meas(o.x, o.y, [245, 166, 35]);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
      return { selRing, hovRing };
    })()`);
    assert(r5z2.selRing > 5 && r5z2.selRing < 15 && Math.abs(r5z2.selRing - r5z1.selRing) <= 2.5,
      `5c: zoom=2 选中节点黄环半径不变 (实测 ${r5z2.selRing?.toFixed(1)} vs zoom1 ${r5z1.selRing?.toFixed(1)}; 修复前 zoom2 约 20)`);
    assert(r5z2.hovRing > 4.5 && r5z2.hovRing < 14 && Math.abs(r5z2.hovRing - r5z1.hovRing) <= 2.5,
      `5d: zoom=2 Alt hover 环半径不变 (实测 ${r5z2.hovRing?.toFixed(1)} vs zoom1 ${r5z1.hovRing?.toFixed(1)}; 修复前 zoom2 约 18)`);

    // ---- 需求6: 旋转手柄偏移不随游玩区缩放变 (hover 光标 + 绘制像素) ----
    const rotTest = async (scaleVal) => {
      return await evalJs(`(async () => {
        const store = window.__osuStore;
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const c = document.querySelector('canvas.cursor-crosshair');
        store.playfieldScale = ${scaleVal};
        store.playfieldPanX = 0; store.playfieldPanY = 0; // 复位 v378 需求5 测试的平移补偿
        store.setDisplayFlag('selectionBounds', true);
        store.seek(${setup.t1});
        store.clearSelection(); store.setSelectedNodes([]);
        store.select([378001]);
        await sleep(300);
        const o = store.beatmap.hitObjects.find(x => x.id === 378001);
        const radius = ${setup.radius};
        const minX = Math.min(o.x, o.curvePoints[0].x, o.curvePoints[1].x), minY = Math.min(o.y, o.curvePoints[0].y, o.curvePoints[1].y);
        const tl = window.__osuToClient(minX - radius - 5, minY - radius - 5); // dq tl 角
        const hp = { x: tl.x - 12.5, y: tl.y - 12.5 }; // v378: 手柄固定 12.5 视觉 px 外
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: hp.x, clientY: hp.y, bubbles: true }));
        await sleep(250);
        const cursor = c.style.cursor;
        // 绘制像素: 手柄圆 (hover 淡入显示) 中心应在 hp 附近 ±7 视觉 px 内有黄色填充
        // v378 加固: 淡入是逐帧动画, 机器忙时 sleep(250) 后 alpha 仍低 → 轮询重采至淡入完成 (上限 ~1.8s)
        const r = c.getBoundingClientRect(), g = c.getContext('2d'), dpr = c.width / r.width;
        const cx0 = Math.round((hp.x - r.left) * dpr), cy0 = Math.round((hp.y - r.top) * dpr);
        const half = Math.round(7 * dpr);
        let yellow = 0;
        for (let t = 0; t < 15; t++) {
          const img = g.getImageData(cx0 - half, cy0 - half, half * 2, half * 2).data;
          yellow = 0;
          for (let i = 0; i < img.length; i += 4) {
            if (Math.abs(img[i] - 242) < 40 && Math.abs(img[i + 1] - 181) < 40 && Math.abs(img[i + 2] - 68) < 40) yellow++;
          }
          if (yellow > 20) break;
          await sleep(120);
        }
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: tl.x - 200, clientY: tl.y - 200, bubbles: true })); // 移开
        return { cursor, yellow };
      })()`);
    };
    const r6z1 = await rotTest(1);
    assert(r6z1.cursor === 'grab', `6a: zoom=1 hover 固定偏移处 = 旋转手柄光标 (实际 '${r6z1.cursor}')`);
    assert(r6z1.yellow > 20, `6a: zoom=1 手柄圆绘制在固定偏移处 (黄像素 ${r6z1.yellow})`);
    const r6z2 = await rotTest(2);
    assert(r6z2.cursor === 'grab', `6b: zoom=2 hover 固定偏移处 = 旋转手柄光标 (实际 '${r6z2.cursor}'; 修复前手柄已漂到 25px 外)`);
    assert(r6z2.yellow > 20, `6b: zoom=2 手柄圆仍绘制在固定偏移处 (黄像素 ${r6z2.yellow}; 修复前此处无手柄)`);
    await evalJs(`(() => { const s = window.__osuStore; s.playfieldScale = 1; s.playfieldPanX = 0; s.playfieldPanY = 0; s.playfieldPanEnabled = false; s.setDisplayFlag('selectionBounds', true); return true; })()`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile); // v383: 杀进程 + 回收临时 profile
  }
}

console.log(failures ? `\nVERIFIER_V378_FAILED: ${failures} 处失败` : '\nVERIFIER_V378_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
