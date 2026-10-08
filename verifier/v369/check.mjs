// 验证器 v369: 「限制物件在游玩区域内」拖曳钳制改实时判定 — 用户反馈: 拖曳开始时滑条头/尾
//  有一端在游玩区外, 这次拖曳全程限界钳制失效 (即使两端拖回区内也不再钳; 必须先停拖,
//  下次拖曳才正常)。期望: 拖曳全程按当前实时位置持续钳制, 与拖曳起始状态无关。
// 根因: applyObjectDrag (EditorCanvas.tsx) 共享 delta 钳制按拖拽起始 orig 位置判定
//  「界内才纳入钳制」(v302/F04 规则), 起始在界外的头/尾整段拖拽被排除在钳制点集外;
//  且逐件头部钳 (v163) 会把起始在界外的头强制拉回界内 (与 v302「越界点不压回」冲突)。
// 修复: 钳制按上一帧应用后的当前位置 (orig + d.deltaX/d.deltaY) 逐点给出本帧 dx/dy
//  允许区间 — 界内点保持界内; 界外点不许比起始更往外、可向界内移动, 一旦进界即按界内
//  点钳制; 逐件应用处不再各自钳头部 (共享 delta 已钳好, 位移恒一致)。
// 运行: npm run build 后 node verifier/v369/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 钳制按当前帧实时位置 (不再按拖拽起始 orig 判定界内)');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/cx = p\.x \+ d\.deltaX, cy = p\.y \+ d\.deltaY/.test(ec), '钳制点当前位置 = orig + 上一帧已应用 delta');
  const m = ec.match(/\/\/ v369[\s\S]{0,2200}?if \(yLo <= yHi\) dy = Math\.max\(yLo, Math\.min\(yHi, dy\)\);/);
  assert(!!m, 'v369 实时钳制块存在');
  if (m) {
    assert(!/p\.x >= 0 && p\.x <= PW/.test(m[0]), '钳制块不再含「起始界内才纳入」门控');
    assert(/if \(cx < 0\)/.test(m[0]) && /else if \(cx > PW\)/.test(m[0]), '界外左/右分支: 不许更往外、可向界内');
  }
  assert(!/Math\.max\(0, Math\.min\(PW, orig\.x \+ dx\)\)/.test(ec), '逐件头部钳移除 (不再把界外头强制拉回)');
  assert(/const ax = dx, ay = dy;/.test(ec), '逐件直接应用共享 delta (位移恒一致)');
}

section('CDP: 区外起拖全程实时钳制 (a/b) / 区内不变 (c) / 多选 (d)');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9452;
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
    const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0,
      buttons: type === 'mouseReleased' ? 0 : 1,
    });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await sleep(800); // 布局稳定 (视口足够大, 游玩区外仍有可点画布余量; 区外偏移见 b 段动态计算)

    // 基础环境: 开限界, 关一切吸附 (钳制断言不受吸附修正干扰)
    await evalJs(`(() => {
      const store = window.__osuStore;
      store.pause && store.pause();
      store.tool = 'select';
      store.setLimitToPlayfield(true);
      store.setObjectSnapEnabled(false);
      store.gridSnap = false;
      store.distanceLock = false;
      store.select([]); store.setSelectedNodes([]);
      return true;
    })()`);

    const mkS = (id, x, y, cx, cy, len) => `{ id: ${id}, type: 'slider', x: ${x}, y: ${y}, time: 5000, newCombo: true, comboSkip: 0, hitSound: 0, curvePoints: [{ x: ${cx}, y: ${cy} }], curveType: 'L', slides: 1, length: ${len} }`;
    const mkC = (id, x, y) => `{ id: ${id}, type: 'circle', x: ${x}, y: ${y}, time: 5000, newCombo: true, comboSkip: 0, hitSound: 0 }`;
    const setObjs = (objsJs, selIds) => evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      store.load({ ...base, hitObjects: [${objsJs}], timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
      store.tool = 'select';
      store.seek(5000);
      store.select(${JSON.stringify(selIds)});
      return true;
    })()`);
    const obj = (id) => evalJs(`(() => { const o = window.__osuStore.beatmap.hitObjects.find(x => x.id === ${id});
      return o ? { x: o.x, y: o.y, cp: o.curvePoints ? o.curvePoints.map(c => ({ x: c.x, y: c.y })) : null } : null; })()`);
    const toClient = (ox, oy) => evalJs(`window.__osuToClient(${ox}, ${oy})`);
    const interp = (from, to, step = 30) => {
      const pts = [];
      const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
      for (let i = 1; i <= n; i++) pts.push([from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n]);
      return pts;
    };
    // 一次完整拖曳: 在 down 处按下, 依次经过各途径点 (段内插值), 最后松开;
    // afterMove[i] = 到达第 i 个途径点后的中途断言 (拖拽不中断)
    const drag = async (down, waypoints, afterMove) => {
      const dp = await toClient(down[0], down[1]);
      await mouse('mousePressed', dp.x, dp.y);
      await sleep(200);
      let cur = down;
      for (let i = 0; i < waypoints.length; i++) {
        for (const pt of interp(cur, waypoints[i])) {
          const p = await toClient(pt[0], pt[1]);
          await mouse('mouseMoved', p.x, p.y);
          await sleep(60);
        }
        await sleep(250); // rAF 应用末帧
        if (afterMove && afterMove[i]) await afterMove[i]();
        cur = waypoints[i];
      }
      const lp = await toClient(cur[0], cur[1]);
      await mouse('mouseReleased', lp.x, lp.y);
      await sleep(250);
    };

    // (a) 尾在区外起拖: 往更外拖被钳住不动; 拖回两端入区后再往边界拖, 尾被钳在 512
    //     (不预选 — 选中单滑条点头/锚点会走节点拖拽 singleSliderNodePress; 空选区按下头部 = 物件拖拽)
    await setObjs(mkS(101, 400, 192, 600, 192, 200), []); // 头(400,192) 尾(600,192) 尾在区外右
    await sleep(300);
    await drag([400, 192], [[520, 192], [200, 192], [620, 192]], [
      async () => {
        const o = await obj(101);
        assert(o && o.x === 400 && o.cp[0].x === 600, `(a1) 尾区外起拖往更外拖: 整件钳住不动 (头 ${o?.x}, 尾 ${o?.cp?.[0]?.x}; 期望 400/600; 修复前头跟到 512)`);
      },
      async () => {
        const o = await obj(101);
        assert(o && o.x === 200 && o.cp[0].x === 400, `(a2) 拖回两端入区: 正常跟随 (头 ${o?.x}, 尾 ${o?.cp?.[0]?.x}; 期望 200/400)`);
      },
      async () => {
        const o = await obj(101);
        assert(o && o.x === 312 && Math.abs(o.cp[0].x - 512) <= 2, `(a3) 入区后再往边界拖: 尾钳在 512 (头 ${o?.x}, 尾 ${o?.cp?.[0]?.x}; 期望 312/512; 修复前尾到 712)`);
      },
    ]);

    // (b) 头在区外起拖: 往更外拖头不被强制拉回也不更往外; 往界内拖全程受钳
    const ob = 50; // 区外偏移 (osu px) — 实测左侧可点画布余量 63 osu px (余量随窗口/缩放变, 此处断言兜底)
    const obOk = await evalJs(`(() => {
      const p = window.__osuToClient(-50, 100);
      const el = document.elementFromPoint(p.x, p.y);
      return !!el && el.tagName === 'CANVAS';
    })()`);
    assert(obOk, '(b0) 区外头落点在可点画布内 (左侧界外余量 ≥ 50 osu px)');
    await setObjs(mkS(102, -ob, 100, 200 - ob, 100, 200), []); // 头(-ob,100) 区外左, 尾(200-ob,100) 界内
    await sleep(300);
    await drag([-ob, 100], [[-ob - 30, 100], [560, 100]], [
      async () => {
        const o = await obj(102);
        assert(o && Math.abs(o.x - (-ob)) <= 1, `(b1) 头区外起拖往更外拖: 头留在原位不被强制拉回 (头 ${o?.x}; 期望 ${-ob}; 修复前被拉回 0)`);
      },
      async () => {
        const o = await obj(102);
        assert(o && Math.abs(o.x - 312) <= 2 && Math.abs(o.cp[0].x - 512) <= 2, `(b2) 头区外起拖往界内拖: 尾钳在 512 (头 ${o?.x}, 尾 ${o?.cp?.[0]?.x}; 期望 312/512)`);
      },
    ]);

    // (c) 正常区内起拖: 行为不变 (尾钳 512, 拖回正常跟随)
    await setObjs(mkS(103, 100, 300, 300, 300, 200), []); // 头(100,300) 尾(300,300) 均界内
    await sleep(300);
    await drag([100, 300], [[700, 300], [100, 300]], [
      async () => {
        const o = await obj(103);
        assert(o && Math.abs(o.x - 312) <= 2 && Math.abs(o.cp[0].x - 512) <= 2, `(c1) 区内起拖到边界: 尾钳在 512 (头 ${o?.x}, 尾 ${o?.cp?.[0]?.x}; 期望 312/512)`);
      },
      async () => {
        const o = await obj(103);
        assert(o && o.x === 100 && o.cp[0].x === 300, `(c2) 拖回原点: 正常跟随 (头 ${o?.x}, 尾 ${o?.cp?.[0]?.x}; 期望 100/300)`);
      },
    ]);

    // (d) 多选含区外滑条整体拖曳: 往更外拖整组钳住; 拖回入区后出界方向被钳
    await setObjs(`${mkS(104, 400, 192, 600, 192, 200)}, ${mkC(105, 200, 100)}`, [104, 105]);
    await sleep(300);
    await drag([200, 100], [[500, 100], [50, 100], [600, 100]], [
      async () => {
        const s = await obj(104), c = await obj(105);
        assert(s && c && s.x === 400 && c.x === 200, `(d1) 多选往更外拖: 整组钳住不动 (滑条头 ${s?.x}, 圆 ${c?.x}; 期望 400/200; 修复前整组 +112)`);
      },
      async () => {
        const s = await obj(104), c = await obj(105);
        assert(s && c && s.x === 250 && s.cp[0].x === 450 && c.x === 50, `(d2) 多选拖回入区: 正常跟随 (滑条头 ${s?.x}/尾 ${s?.cp?.[0]?.x}, 圆 ${c?.x}; 期望 250/450, 50)`);
      },
      async () => {
        const s = await obj(104), c = await obj(105);
        assert(s && c && Math.abs(s.cp[0].x - 512) <= 2 && Math.abs(c.x - 112) <= 2, `(d3) 多选入区后再出界: 尾钳 512, 圆随共享 delta (尾 ${s?.cp?.[0]?.x}, 圆 ${c?.x}; 期望 512/112; 修复前尾 712/圆 312)`);
      },
    ]);

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

console.log(failures ? `\nVERIFIER_V369_FAILED: ${failures} 处失败` : '\nVERIFIER_V369_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
