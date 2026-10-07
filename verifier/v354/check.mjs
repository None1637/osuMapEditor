// 验证器 v354: 滑条轨道色 (SliderTrackOverride) 走与 v348 边框相同的优先级翻转逻辑
//   开「使用皮肤颜色」: 皮肤 > 谱面 > combo 色; 关: 谱面 > 皮肤 > combo 色 (缺省互相回退)
//   此前关开关时完全不查皮肤的 SliderTrackOverride (track: bm... || color)。
// 运行: npm run build 后 node verifier/v354/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: sliderBodyColors 轨道色优先级随开关翻转');
{
  const src = read('src/osu/renderer.ts');
  assert(src.includes('track: skin.sliderTrackOverride || bm.colors.sliderTrackOverride || color,'), '开: 皮肤 > 谱面 > combo 色');
  assert(src.includes('track: bm.colors.sliderTrackOverride || skin.sliderTrackOverride || color,'), '关: 谱面 > 皮肤 > combo 色 (v354 缺省回退皮肤)');
  assert(src.includes('v354: SliderTrackOverride 走同一套翻转逻辑'), 'v348 注释同步 v354 (轨道色同逻辑)');
}

section('CDP 像素: 轨道色优先级 (渐变轨道开, 探滑条体中心色)');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9461;
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
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas && window.__osuSkin)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');

    // 单条 L 滑条 (312,192)->(380,150) @6000ms; 渐变轨道开 (纯黑轨道不吃轨道色, 测不出)
    await evalJs(`(() => {
      const store = window.__osuStore;
      store.setDisplayFlag('skinColors', false);
      store.setDisplayFlag('sliderGradientTrack', true);
      const base = store.beatmap;
      const ts = base.hitObjects.find(o => o.type === 'slider');
      const mk = (track) => ({ ...base, colors: { ...base.colors, sliderTrackOverride: track || '' }, hitObjects: [
        { ...ts, id: 888354, time: 6000, x: 312, y: 192, curvePoints: [{ x: 380, y: 150 }], curveType: 'L', slides: 1, length: 100 },
      ] });
      window.__v354Load = (bmTrack, skinTrack, useSkin) => {
        window.__osuSkin.getSkin().sliderTrackOverride = skinTrack || null;
        store.setDisplayFlag('skinColors', !!useSkin);
        store.load(mk(bmTrack), store.audioUrl);
        store.pause && store.pause();
        store.tool = 'select';
        store.select([]);
        store.seek(6000);
      };
      window.__v354Load();
    })()`);
    await sleep(400);

    // 探针: 滑条体中点 (346,171) 法线 (0.526,0.851) 偏移 0.25r (近中心, 渐变最亮处)
    const cs = await evalJs('window.__osuStore.beatmap.difficulty.cs');
    const r = 54.4 - 4.48 * cs;
    const px = 346 + 0.526 * 0.25 * r, py = 171 + 0.851 * 0.25 * r;
    const probe = () => evalJs(`(() => {
      const p = window.__osuToCanvas(${px}, ${py});
      const c = document.querySelector('canvas'); const g = c.getContext('2d');
      const d = g.getImageData(Math.floor(p.x) - 2, Math.floor(p.y) - 2, 5, 5).data;
      let best = null, bestA = -1;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > bestA) { bestA = d[i + 3]; best = [d[i], d[i + 1], d[i + 2]]; }
      return best;
    })()`);
    const RED = 'rgb(255,0,0)', BLUE = 'rgb(0,0,255)';
    const isRed = (c) => c && c[0] > c[2] + 60;
    const isBlue = (c) => c && c[2] > c[0] + 60;

    const run = async (bmTrack, skinTrack, useSkin, expect, label) => {
      await evalJs(`window.__v354Load(${JSON.stringify(bmTrack)}, ${JSON.stringify(skinTrack)}, ${useSkin})`);
      await sleep(400);
      const c = await probe();
      assert((expect === 'red' ? isRed(c) : isBlue(c)), `${label} (实得 ${c})`);
    };

    await run(RED, BLUE, false, 'red', '关+谱面红/皮肤蓝: 谱面优先 -> 红');
    await run('', BLUE, false, 'blue', '关+谱面无: 回退皮肤 -> 蓝 (v354 新增)');
    await run(RED, BLUE, true, 'blue', '开+谱面红/皮肤蓝: 皮肤优先 -> 蓝');
    await run(RED, '', true, 'red', '开+皮肤无: 回退谱面 -> 红');

    await evalJs(`(() => { window.__osuSkin.getSkin().sliderTrackOverride = null; window.__osuStore.setDisplayFlag('skinColors', false); window.__osuStore.setDisplayFlag('sliderGradientTrack', false); window.__v354Load(); })()`);
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

console.log(failures ? `\nVERIFIER_V354_FAILED: ${failures} 处失败` : '\nVERIFIER_V354_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
