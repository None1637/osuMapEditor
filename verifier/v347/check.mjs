// 验证器 v347: skin.ini SliderBorder 作为未选中滑条边框颜色
//   v348 修订: 优先级随「使用皮肤颜色」开关翻转 — 开: 皮肤 > 谱面 > 默认;
//   关: 谱面 > 皮肤 > 默认 (缺省互相回退); parser 不再回填 '#FFFFFF' (留空=谱面未定义)。
//   例: F:\Backup\D\osu!\Skins\- (RX) Fantastical Evening Star\skin.ini 的 SliderBorder: 82,82,82
// 运行: npm run build 后 node verifier/v347/check.mjs  (C 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(root, rel), 'utf8');

section('源码: sliderBodyColors 优先级随开关翻转 (v348)');
{
  const src = read('src/osu/renderer.ts');
  assert(src.includes("border: skin.sliderBorder || bm.colors.sliderBorder || '#ffffff'"), '开「使用皮肤颜色」: 皮肤 > 谱面 > 默认');
  assert(src.includes("border: bm.colors.sliderBorder || skin.sliderBorder || '#ffffff'"), '关: 谱面 > 皮肤 > 默认 (缺省互相回退)');
  const parser = read('src/osu/parser.ts');
  assert(!parser.includes("if (!bm.colors.sliderBorder) bm.colors.sliderBorder = '#FFFFFF';"), 'parser 不再回填 #FFFFFF (留空=谱面未定义, 渲染层回退)');
  const dp = read('src/components/DisplayPanel.tsx');
  assert(dp.includes('on: skin first, off: beatmap first'), 'DisplayPanel 英文描述同步 (优先级随开关)');
  assert(read('src/i18n/dicts/zh-CN/display.ts').includes('开: 皮肤优先; 关: 谱面优先'), 'zh-CN 词典描述同步');
}

section('真实 skin.ini 解析 (esbuild) + 合成样例');
{
  fs.writeFileSync(path.join(root, 'verifier/v347/entry.ts'),
    `export { parseSkinIniColours } from '@/osu/skin';\n`);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v347-')), 'bundle.mjs');
  execSync(`npx esbuild verifier/v347/entry.ts --bundle --format=esm --platform=node --outfile="${out}" --log-level=error --alias:@=./src`, { cwd: root, stdio: 'pipe' });
  const mod = await import('file:///' + out.replace(/\\/g, '/'));
  const SKIN_INI = 'F:/Backup/D/osu!/Skins/- (RX) Fantastical Evening Star/skin.ini';
  if (fs.existsSync(SKIN_INI)) {
    const cols = mod.parseSkinIniColours(read(SKIN_INI));
    assert(cols.sliderBorder === '#525252', `真实皮肤 SliderBorder 82,82,82 -> #525252 (实得 ${cols.sliderBorder})`);
    assert(cols.sliderTrackOverride === '#000000', `真实皮肤 SliderTrackOverride 0,0,0 -> #000000 (实得 ${cols.sliderTrackOverride})`);
    assert(cols.combos.length === 2 && cols.combos[0] === '#ad3cbf' && cols.combos[1] === '#599eff', `真实皮肤 Combo1/2 (#ad3cbf/#599eff; 实得 ${cols.combos.join(',')})`);
  } else {
    console.log('  skip: 示例 skin.ini 不在本机 (非用户环境), 跳过真实文件断言');
  }
  const syn = mod.parseSkinIniColours('[Colours]\nSliderBorder: 1, 2, 3\nCombo1: 255,0,0\n');
  assert(syn.sliderBorder === '#010203' && syn.combos[0] === '#ff0000', '合成样例: r,g,b -> #rrggbb');
  assert(mod.parseSkinIniColours('[General]\nName: x\n').sliderBorder === null, '无 [Colours] 段 -> null (回退链生效)');
}

section('CDP 像素: 边框回退链 + 优先级随开关翻转');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9453;
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

    // 测试谱面: 单条 L 滑条 (312,192)->(380,150) @6000ms; skinColors 关 + 谱面无 sliderBorder
    await evalJs(`(() => {
      const store = window.__osuStore;
      store.setDisplayFlag('skinColors', false);
      window.__osuSkin.getSkin().sliderBorder = null;
      const base = store.beatmap;
      const ts = base.hitObjects.find(o => o.type === 'slider');
      const mk = (border) => ({ ...base, colors: { ...base.colors, sliderBorder: border || '' }, hitObjects: [
        { ...ts, id: 888101, time: 6000, x: 312, y: 192, curvePoints: [{ x: 380, y: 150 }], curveType: 'L', slides: 1, length: 100 },
      ] });
      window.__v347Load = (border) => store.load(mk(border), store.audioUrl);
      window.__v347Load();
      store.pause && store.pause();
      store.tool = 'select';
      store.select([]);
      store.seek(6000);
    })()`);
    await sleep(400);

    // 探针: 滑条体中点 (346,171) 沿法线 (0.526,0.851) 偏移 0.87r (边框带 0.81r..0.925r)
    const cs = await evalJs('window.__osuStore.beatmap.difficulty.cs');
    const r = 54.4 - 4.48 * cs;
    const px = 346 + 0.526 * 0.87 * r, py = 171 + 0.851 * 0.87 * r;
    const probe = () => evalJs(`(() => {
      const p = window.__osuToCanvas(${px}, ${py});
      const c = document.querySelector('canvas'); const g = c.getContext('2d');
      const d = g.getImageData(Math.floor(p.x) - 2, Math.floor(p.y) - 2, 5, 5).data;
      let best = null, bestA = -1;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > bestA) { bestA = d[i + 3]; best = [d[i], d[i + 1], d[i + 2]]; }
      return best;
    })()`);
    const near = (c, rgb, tol) => c && Math.abs(c[0] - rgb[0]) <= tol && Math.abs(c[1] - rgb[1]) <= tol && Math.abs(c[2] - rgb[2]) <= tol;

    let c1 = await probe();
    assert(near(c1, [255, 255, 255], 25), `关+皮肤/谱面都未定义: 默认纯白 (实得 ${c1})`);

    await evalJs(`(() => { window.__osuSkin.getSkin().sliderBorder = '#525252'; window.__v347Load(); window.__osuStore.select([]); window.__osuStore.seek(6000); })()`);
    await sleep(400);
    let c2 = await probe();
    assert(near(c2, [82, 82, 82], 20), `关+谱面未定义: 回退皮肤 SliderBorder #525252 (实得 ${c2})`);

    await evalJs(`(() => { window.__osuSkin.getSkin().sliderBorder = null; window.__v347Load(); window.__osuStore.select([]); window.__osuStore.seek(6000); })()`);
    await sleep(400);
    let c3 = await probe();
    assert(near(c3, [255, 255, 255], 25), `还原 null 后回到纯白 (贴图缓存按 border 作 key, 无残留; 实得 ${c3})`);

    // v348 优先级: 谱面(rgb(255,0,0)) 与皮肤(#525252) 同时定义
    await evalJs(`(() => { window.__osuSkin.getSkin().sliderBorder = '#525252'; window.__v347Load('rgb(255,0,0)'); window.__osuStore.select([]); window.__osuStore.seek(6000); })()`);
    await sleep(400);
    let c4 = await probe();
    assert(near(c4, [255, 0, 0], 40), `关: 谱面 sliderBorder 优先于皮肤 (实得 ${c4})`);

    await evalJs(`(() => { window.__osuStore.setDisplayFlag('skinColors', true); window.__v347Load('rgb(255,0,0)'); window.__osuStore.select([]); window.__osuStore.seek(6000); })()`);
    await sleep(400);
    let c5 = await probe();
    assert(near(c5, [82, 82, 82], 20), `开: 皮肤 SliderBorder 优先于谱面 (实得 ${c5})`);

    await evalJs(`(() => { window.__osuSkin.getSkin().sliderBorder = null; window.__v347Load('rgb(255,0,0)'); window.__osuStore.select([]); window.__osuStore.seek(6000); })()`);
    await sleep(400);
    let c6 = await probe();
    assert(near(c6, [255, 0, 0], 40), `开+皮肤未定义: 回退谱面 sliderBorder (实得 ${c6})`);

    await evalJs(`(() => { window.__osuStore.setDisplayFlag('skinColors', false); window.__v347Load(); window.__osuStore.select([]); window.__osuStore.seek(6000); })()`);
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

console.log(failures ? `\nVERIFIER_V347_FAILED: ${failures} 处失败` : '\nVERIFIER_V347_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
