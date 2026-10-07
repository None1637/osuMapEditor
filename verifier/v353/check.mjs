// 验证器 v353: 显示设置「滑条渐变轨道」开关 — 滑条轨道中心亮/边缘暗径向渐变 (lazer LegacySliderBody 同款)
//   公式 (本地检出 D:/Projects/osuMapEditor/osu/.../LegacySliderBody.cs + LegacyUtils.cs):
//   轨道 [border 内缘 0.8125r, 圆心] 线性渐变: 外缘 = framework Darken(accent, 0.1) = c*0.95-25.5,
//   圆心 = legacy 私有 lighten(accent, 0.5) (amount 先 *0.5) = c*1.125+63.75; 轨道整体 Opacity(0.7)。
//   实现: paintSliderBody 离屏贴图构建时 24 层 destination-over 描边 (先窄亮后宽暗), bodyCache 按物件缓存,
//   逐帧零成本; 缓存 key / 静态场景层 key 均含开关位。
// 运行: npm run build 后 node verifier/v353/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: displaySettings / DisplayPanel / 词典');
{
  const ds = read('src/osu/displaySettings.ts');
  assert(/sliderGradientTrack: boolean/.test(ds), 'DisplaySettings 接口含 sliderGradientTrack 布尔字段');
  assert(ds.includes('sliderGradientTrack: false,'), '默认 false (保持 v19 纯黑轨道观感)');
  assert(ds.includes('sliderGradientTrack: !!p.sliderGradientTrack'), 'localStorage 解析回退');
  const dp = read('src/components/DisplayPanel.tsx');
  assert(dp.includes("key: 'sliderGradientTrack'") && dp.includes('display.slider_gradient_track_name'), 'DisplayPanel 开关行');
  const dict = read('src/i18n/dicts/zh-CN/display.ts');
  assert(dict.includes('display.slider_gradient_track_name') && dict.includes('display.slider_gradient_track_desc'), 'zh-CN 词典 name/desc');
}

section('源码: renderer 渐变分支 + 缓存联动');
{
  const src = read('src/osu/renderer.ts');
  assert(src.includes('if (displaySettings.sliderGradientTrack)'), 'paintSliderBody 渐变分支');
  assert(src.includes('const N = 24;') && src.includes("g.globalCompositeOperation = 'destination-over'"), '24 层 destination-over 描边');
  assert(src.includes('lazerLighten(base, 0.25)') && src.includes('lazerLighten(base, -0.1)'), '圆心 lighten(0.5 预半) / 外缘 Darken(0.1)');
  assert(src.includes("|${displaySettings.sliderGradientTrack ? 'G' : ''}`"), '滑条身贴图缓存 key 含开关位');
  assert(src.includes('displaySettings.sliderGradientTrack, // v353'), '静态场景层 key 含开关位');
  assert(!src.includes('_track'), 'track 参数不再 unused');
}

section('CDP 像素: 关=平坦轨道 / 开=中心亮边缘暗');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9460;
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

    // 测试谱面: 单条 L 滑条 (312,192)->(380,150) @6000ms; skinColors 关; 谱面 sliderTrackOverride=红 (公式可预测)
    await evalJs(`(() => {
      const store = window.__osuStore;
      store.setDisplayFlag('skinColors', false);
      store.setDisplayFlag('sliderGradientTrack', false);
      window.__osuSkin.getSkin().sliderTrackOverride = null;
      const base = store.beatmap;
      const ts = base.hitObjects.find(o => o.type === 'slider');
      store.load({ ...base, colors: { ...base.colors, sliderTrackOverride: 'rgb(255,0,0)' }, hitObjects: [
        { ...ts, id: 888353, time: 6000, x: 312, y: 192, curvePoints: [{ x: 380, y: 150 }], curveType: 'L', slides: 1, length: 100 },
      ] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.select([]);
      store.seek(6000);
    })()`);
    await sleep(400);

    // 探针: 滑条体中点 (346,171) 法线 (0.526,0.851); 近中心 0.25r / 近边缘 0.65r (轨道区 <=0.8125r)
    const cs = await evalJs('window.__osuStore.beatmap.difficulty.cs');
    const r = 54.4 - 4.48 * cs;
    const probeAt = (k) => evalJs(`(() => {
      const p = window.__osuToCanvas(${346} + ${0.526} * ${k}, ${171} + ${0.851} * ${k});
      const c = document.querySelector('canvas'); const g = c.getContext('2d');
      const d = g.getImageData(Math.floor(p.x) - 2, Math.floor(p.y) - 2, 5, 5).data;
      let best = null, bestA = -1;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > bestA) { bestA = d[i + 3]; best = [d[i], d[i + 1], d[i + 2]]; }
      return best;
    })()`);
    const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

    const offC = await probeAt(0.25 * r), offE = await probeAt(0.65 * r);
    assert(offC && offE && Math.abs(lum(offC) - lum(offE)) <= 15,
      `关: 纯黑轨道平坦 (中心 ${offC} vs 边缘 ${offE}, 亮度差 ${offC && offE ? Math.abs(lum(offC) - lum(offE)).toFixed(1) : 'NA'})`);

    await evalJs(`(() => { window.__osuStore.setDisplayFlag('sliderGradientTrack', true); window.__osuStore.seek(6001); window.__osuStore.seek(6000); })()`);
    await sleep(400);
    const onC = await probeAt(0.25 * r), onE = await probeAt(0.65 * r);
    // 红轨道: 圆心 [255,64,64] -> 外缘 [217,0,0] (x0.7 alpha 叠暗底), 中心 G 通道应明显更高
    assert(onC && onE && onC[1] - onE[1] >= 15,
      `开: 中心 G 通道明显高于边缘 (中心 ${onC} vs 边缘 ${onE})`);
    assert(onC && onE && lum(onC) - lum(onE) >= 15,
      `开: 中心亮度 > 边缘亮度 (差 ${onC && onE ? (lum(onC) - lum(onE)).toFixed(1) : 'NA'})`);
    assert(onC && onC[0] > 100 && onC[0] >= onC[1], `开: 轨道着轨道色 (红) 而非纯白/纯黑 (中心 ${onC})`);

    await evalJs(`(() => { window.__osuStore.setDisplayFlag('sliderGradientTrack', false); })()`);
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

console.log(failures ? `\nVERIFIER_V353_FAILED: ${failures} 处失败` : '\nVERIFIER_V353_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
