// 验证器 v488: 插入锚点 (弹簧) — 模板默认垂直于主滑条 (rotate 默认 90°) + 支持旋转角度控制
//   - AnchorStampRule.rotate (度, 相对切线对齐偏转; 旧存档回退 90) ; newRule 默认 90
//   - 浮窗每条规则加「旋转」输入 (-360~360°) ; i18n
//   - CDP: 水平主滑条 + 水平线模板 → 默认盖章垂直 (y 偏离), 改 0° → 沿切线 (y 不离线)
// 运行: npm run build 后 node verifier/v488/check.mjs
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
  assert(/rotate: number;/.test(c), 'AnchorStampRule.rotate 字段');
  assert(/rotate: 90 \}/.test(c), 'newRule 默认 rotate = 90 (垂直)');
  assert(/Number\.isFinite\(rule\.rotate\) \? rule\.rotate : 90/.test(c), '旧存档回退 90°');
  assert(/theta - s\.thetaT \+ s\.rot/.test(c), '盖章变换叠加偏转角');
  const dlg = read('src/components/convert/AnchorStampDialog.tsx');
  assert(/testid=\{`rotate-\$\{i\}`\}/.test(dlg), '浮窗旋转输入框');
  assert(/normalizeAnchorStampParams/.test(dlg) && /Number\.isFinite\(r\.rotate\) \? r\.rotate : 90/.test(c), '浮窗载入经 normalize 补默认 90° (v519)');
  const dict = read('src/i18n/dicts/zh-CN/convert.ts');
  assert(dict.includes("'convert.stamp_rotate'") && dict.includes("'convert.stamp_rotate_hint'"), 'zh-CN i18n');
}

section('CDP: 默认垂直盖章 + 旋转角可调');
{
  const PORT = 9501;
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

    // 水平主滑条 (y=192) + 水平线模板 (+x 方向, 80px): rotate=90 → 盖章向下 (y>192), rotate=0 → 全在线上
    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red0.time + red0.beatLength * 8);
      const main = { id: 488001, type: 'slider', x: 100, y: 192, time: t, newCombo: true, comboSkip: 0,
        hitSound: 0, curveType: 'L', curvePoints: [{ x: 412, y: 192 }], slides: 1, length: 312 };
      const tpl = { id: 488002, type: 'slider', x: 100, y: 400, time: t + Math.round(red0.beatLength * 4),
        newCombo: false, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: 180, y: 400 }], slides: 1, length: 80 };
      store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [main, tpl] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select'; store.seek(t);
      store.select([488001]);
      store.openConversion('anchorStamp');
      await sleep(350);
      document.querySelector('[data-conv="add-rule"]').click();
      await sleep(150);
      store.select([488002]);
      await sleep(100);
      document.querySelector('[data-conv="capture-0"]').click();
      await sleep(350);
      const out = {};
      const rotInp = document.querySelector('[data-conv="rotate-0"]');
      out.rotateDefault = rotInp ? rotInp.value : null;
      const maxDev = () => {
        const o = store.conversionPreview && store.conversionPreview.objects[0];
        if (!o) return null;
        return Math.max(...[{ x: o.x, y: o.y }, ...(o.curvePoints || [])].map(p => Math.abs(p.y - 192)));
      };
      out.dev90 = maxDev(); // 默认 90°: 盖章段垂直向下, 偏离应接近模板长 80
      // 改 0° → 沿切线, 全共线
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(rotInp, '0');
      rotInp.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(350);
      out.dev0 = maxDev();
      // 改 45° → 偏离 ≈ 80×sin45 ≈ 56.6
      setter.call(rotInp, '45');
      rotInp.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(350);
      out.dev45 = maxDev();
      store.closeConversion();
      return out;
    })()`);

    assert(out.rotateDefault === '90', `旋转框默认 90 (实际 ${out.rotateDefault})`);
    assert(out.dev90 !== null && out.dev90 > 70 && out.dev90 <= 82, `默认垂直: 盖章偏离主线 ≈80px (实际 ${out.dev90 && out.dev90.toFixed(1)})`);
    assert(out.dev0 !== null && out.dev0 < 3, `0° 沿切线: 偏离 ≈0 (实际 ${out.dev0 && out.dev0.toFixed(2)})`);
    assert(out.dev45 !== null && Math.abs(out.dev45 - 80 * Math.SQRT1_2) < 4, `45°: 偏离 ≈56.6 (实际 ${out.dev45 && out.dev45.toFixed(1)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V488_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V488_ALL_TESTS_PASSED');
