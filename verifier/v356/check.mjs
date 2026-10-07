// 验证器 v356: 滑条球渲染全程健康性 (用户反馈 "有些時間點可以顯示sliderball 有些不行")
//   结论: 渲染器无 bug — 直滑条 slides=1/3 各 5 个分数点探测, 球 (含跟随圈) 全部渲染;
//   用户看到的「有些时间点没球」是物件落点时间错误 (v357 粘贴未吸附) 的表象:
//   在音乐正确时刻, 写错时间的滑条还未开始, 自然没有球。
//   探针法: 球在时 vs 滑条开始前 (approach 无球) 同位置最大亮度差 > 12。
// 运行: npm run build 后 node verifier/v356/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 滑条球绘制门控');
{
  const src = read('src/osu/renderer.ts');
  assert(src.includes('if (dt >= 0 && dt <= duration)'), '球仅在滑动期间绘制 (dt ∈ [0, duration])');
  assert(src.includes('drawSpriteRect(g, skin.sliderb'), '球贴图绘制 (固有尺寸 + 切线旋转)');
}

section('CDP: slides=1/3 各 5 分数点球可见性');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9463;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { }
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
    for (let i = 0; i < 60 && !ready; i++) { await sleep(500); ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas)').catch(() => false); }
    if (!ready) throw new Error('应用未就绪');

    // 合成谱面: 直滑条 (150,192)->(450,192) slides=1 / (150,280)->(450,280) slides=3
    await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const ts = base.hitObjects.find(o => o.type === 'slider');
      store.load({ ...base, hitObjects: [
        { ...ts, id: 888356, time: 6000, x: 150, y: 192, curvePoints: [{ x: 450, y: 192 }], curveType: 'L', slides: 1, length: 300 },
        { ...ts, id: 888357, time: 6000, x: 150, y: 280, curvePoints: [{ x: 450, y: 280 }], curveType: 'L', slides: 3, length: 300 },
      ] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.select([]);
    })()`);
    await sleep(300);

    const dur = await evalJs(`(() => {
      const store = window.__osuStore, bm = store.beatmap;
      let red = bm.timingPoints.find(p => p.uninherited);
      for (const p of bm.timingPoints) { if (p.time > 6000) break; if (p.uninherited) red = p; }
      let green = null;
      for (const p of bm.timingPoints) { if (p.time > 6000) break; if (p.uninherited) green = null; else green = p; }
      const sv = green ? -100 / green.beatLength : 1;
      return bm.difficulty.sliderMultiplier * 100 * sv / red.beatLength; // px/ms (sliderVelocityAt 语义)
    })()`);

    const probe = async (ox, oy) => evalJs(`(() => {
      const p = window.__osuToCanvas(${ox}, ${oy});
      const c = [...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0];
      const g = c.getContext('2d');
      const d = g.getImageData(Math.floor(p.x)-3, Math.floor(p.y)-3, 7, 7).data;
      let best = 0;
      for (let i = 0; i < d.length; i += 4) { const l = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; if (l > best) best = l; }
      return best;
    })()`);

    for (const [slides, oy] of [[1, 192], [3, 280]]) {
      const duration = 300 / dur * slides;
      for (const f of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        const prog = f * 300 * slides;
        const cycle = Math.floor(prog / 300);
        let along = prog - cycle * 300;
        if (cycle % 2 === 1) along = 300 - along;
        const bx = 150 + along;
        await evalJs(`window.__osuStore.seek(${6000 - 300})`); await sleep(200);
        const baseL = await probe(bx, oy);
        await evalJs(`window.__osuStore.seek(${6000 + f * duration})`); await sleep(200);
        const ballL = await probe(bx, oy);
        assert(ballL - baseL > 12, `slides=${slides} f=${f}: 球可见 (亮度差 ${(ballL - baseL).toFixed(0)})`);
      }
    }
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

console.log(failures ? `\nVERIFIER_V356_FAILED: ${failures} 处失败` : '\nVERIFIER_V356_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
