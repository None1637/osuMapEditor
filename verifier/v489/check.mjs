// 验证器 v489: 插入锚点 (弹簧) — 每条规则加时间偏移 a×1/b (相位) + 拍数分子输入框收窄 (w-20 → w-10)
//   - AnchorStampRule.offsetNum/offsetDen (默认 0×1/4; 旧存档回退 0) ; 采样 d 从 offset 起 (d<1px 跳过)
//   - DraftNum 加 w 属性 (默认 w-20), BeatFrac 分子传 w-10
//   - CDP: offset 1×1/8 + 间隔 1×1/4 → 插入点相位平移半间隔 (x=100+step/2 有, x=100+step 无)
// 运行: npm run build 后 node verifier/v489/check.mjs
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
  const c = read('src/osu/convert/anchorStamp.ts');
  assert(/offsetNum: number; offsetDen: number;/.test(c), 'AnchorStampRule.offset 字段');
  assert(/offsetNum: 0, offsetDen: 4/.test(c), 'newRule 默认 offset 0×1/4');
  assert(/Number\.isFinite\(rule\.offsetNum\) \? rule\.offsetNum : 0/.test(c), '旧存档回退 offset 0');
  assert(/for \(let d = offset; d < eff - 1e-6; d \+= step\)/.test(c), '采样从 offset 起 (相位)');
  const dd = read('src/components/DraggableDialog.tsx');
  assert(/w = 'w-20'/.test(dd) && /className=\{`\$\{w\} /.test(dd), 'DraftNum w 属性 (默认 w-20)');
  const dlg = read('src/components/convert/AnchorStampDialog.tsx');
  assert(/w="w-10"/.test(dlg), 'BeatFrac 分子框 w-10 (收窄一半)');
  assert(/idNum=\{`offset-num-\$\{i\}`\}/.test(dlg) && /minNum=\{0\}/.test(dlg), '浮窗偏移输入 (允许 0)');
  const dict = read('src/i18n/dicts/zh-CN/convert.ts');
  assert(dict.includes("'convert.stamp_offset'"), 'zh-CN stamp_offset');
}

section('CDP: 时间偏移相位 + 输入框宽度');
{
  const PORT = 9502;
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
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);

    // 水平主滑条 (100,192)→(412,192), 间隔 1/4: offset 0 → 插入点在 100+step, 100+2step…
    // 改 offset 1×1/8 → 相位平移半间隔: 100+step/2, 100+3step/2…
    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = base.timingPoints.find(p => p.uninherited);
      const sm = base.difficulty.sliderMultiplier;
      const vel = 100 * sm / red0.beatLength;
      const step = red0.beatLength / 4 * vel;
      const t = Math.round(red0.time + red0.beatLength * 8);
      const main = { id: 489001, type: 'slider', x: 100, y: 192, time: t, newCombo: true, comboSkip: 0,
        hitSound: 0, curveType: 'L', curvePoints: [{ x: 412, y: 192 }], slides: 1, length: 312 };
      const tpl = { id: 489002, type: 'slider', x: 100, y: 400, time: t + Math.round(red0.beatLength * 4),
        newCombo: false, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: 180, y: 400 }], slides: 1, length: 80 };
      store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [main, tpl] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select'; store.seek(t);
      store.select([489001]);
      store.openConversion('anchorStamp');
      await sleep(350);
      document.querySelector('[data-conv="add-rule"]').click();
      await sleep(150);
      store.select([489002]);
      await sleep(100);
      document.querySelector('[data-conv="capture-0"]').click();
      await sleep(350);
      const out = { step };
      // 主线上 (y≈192) 的接缝点 x 列 = 插入位置 (rotate 90° 默认, 盖章段向下)
      const seamXs = () => {
        const o = store.conversionPreview && store.conversionPreview.objects[0];
        if (!o) return [];
        return [{ x: o.x, y: o.y }, ...(o.curvePoints || [])]
          .filter(p => Math.abs(p.y - 192) <= 1).map(p => p.x).sort((a, b) => a - b);
      };
      out.seam0 = seamXs();
      out.numWidth = document.querySelector('[data-conv="interval-num-0"]').offsetWidth;
      // offset = 1×1/8
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const numInp = document.querySelector('[data-conv="offset-num-0"]');
      setter.call(numInp, '1');
      numInp.dispatchEvent(new Event('input', { bubbles: true }));
      const denSel = document.querySelector('[data-conv="offset-den-0"]');
      const selSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      selSetter.call(denSel, '8');
      denSel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(350);
      out.seamOff = seamXs();
      store.closeConversion();
      return out;
    })()`);

    const near = (arr, x, tol = 2) => arr.some(v => Math.abs(v - x) <= tol);
    const step = out.step;
    assert(near(out.seam0, 100 + step) && !near(out.seam0, 100 + step / 2),
      `offset=0: 插入点在 100+step=${(100 + step).toFixed(0)} (接缝 ${JSON.stringify(out.seam0.slice(0, 5))})`);
    assert(near(out.seamOff, 100 + step / 2) && near(out.seamOff, 100 + step * 1.5) && !near(out.seamOff, 100 + step),
      `offset 1/8: 相位平移半间隔 → 100+step/2=${(100 + step / 2).toFixed(0)} 有, 100+step 无 (接缝 ${JSON.stringify(out.seamOff.slice(0, 5))})`);
    assert(out.numWidth > 0 && out.numWidth <= 48, `分子输入框宽度 ≤48px (w-10=40px+边框; 实际 ${out.numWidth}px)`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V489_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V489_ALL_TESTS_PASSED');
