// 验证器 v486: 滑条批量插入锚点 (弹簧滑条)
//   - 浮窗规则 (优先级/捕获模板/间隔 a×1/b 到 1/128/消除吞除) + 保形盖章 (转B de Casteljau)
//   - 预览 (conversionPreview 含 SV 绿线); v519 起捕获为快照, 源滑条后续编辑不联动
//   - 保留时长: SV 反解头绿线改/插 + applyConversion 全量 timing 替换 (第 4 参 replaceTiming)
//   - 优先级: 同位置冲突 priority 小者胜
// 运行: npm run build 后 node verifier/v486/check.mjs
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
  assert(/export function computeAnchorStamp/.test(c) && /export function resolveTemplate/.test(c) && /export function captureTemplate/.test(c), 'compute/resolve/capture 导出');
  assert(/STAMP_DENOMINATORS = \[1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 72, 96, 128\]/.test(c), '分母到 1/128 (浮窗本地, 不动全局)');
  assert(/sliderToBezierSegments/.test(c) && /extractRange/.test(c) && /segmentsToPoints/.test(c), '保形管线 (de Casteljau)');
  assert(/k\.rule\.priority <= s\.rule\.priority/.test(c), '优先级冲突去重');
  assert(/cursor = s\.d \+ s\.erase/.test(c), '吞除推进 cursor');
  assert(/svForDurationRaw/.test(c) && /svRestoreTargetAt/.test(c), 'SV 反解 + 恢复线');
  const st = read('src/osu/store.ts');
  assert(/'anchorStamp' \| null/.test(st), 'conversionDialog 联合类型');
  assert(/replaceTiming\?: TimingPoint\[\] \| null/.test(st), 'applyConversion 第 4 参全量替换');
  const dlg = read('src/components/convert/AnchorStampDialog.tsx');
  assert(/loadParams\('anchorStamp'/.test(dlg) && /useSaveParamsOnClose\('anchorStamp'/.test(dlg), '参数持久化');
  assert(/store\.getVersion\(\)/.test(dlg), 'sig 依赖 getVersion (节点拖拽联动)');
  const app = read('src/App.tsx');
  assert(/conversionDialog === 'anchorStamp' && <AnchorStampDialog \/>/.test(app), 'App 挂载');
  const dict = read('src/i18n/dicts/zh-CN/convert.ts');
  for (const k of ['stamp_title', 'stamp_capture', 'stamp_interval', 'stamp_erase', 'stamp_keep_duration', 'stamp_sv_preview', 'stamp_summary'])
    assert(dict.includes(`'convert.${k}'`), `zh-CN ${k}`);
}

section('CDP: 全链路 (捕获/快照预览/应用/SV/优先级/undo)');
{
  const PORT = 9499;
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

    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = base.timingPoints.find(p => p.uninherited);
      const sm = base.difficulty.sliderMultiplier;
      const vel = 100 * sm / red0.beatLength; // px/ms
      const t = Math.round(red0.time + red0.beatLength * 8);
      const main = { id: 486001, type: 'slider', x: 100, y: 192, time: t, newCombo: true, comboSkip: 0,
        hitSound: 0, curveType: 'L', curvePoints: [{ x: 412, y: 192 }], slides: 1, length: 312 };
      const tpl = { id: 486002, type: 'slider', x: 100, y: 400, time: t + Math.round(red0.beatLength * 4),
        newCombo: false, comboSkip: 0, hitSound: 0, curveType: 'P',
        curvePoints: [{ x: 140, y: 360 }, { x: 180, y: 400 }], slides: 1, length: 90 };
      store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [main, tpl] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select'; store.seek(t);
      const out = { vel, beatLength: red0.beatLength, dur0: 312 / vel };
      // 1) 选中主滑条开窗
      store.select([486001]);
      store.openConversion('anchorStamp');
      await sleep(350);
      out.dlgOpen = !!document.querySelector('[data-dialog="anchorStamp"]');
      // 2) 加规则 + 捕获模板 (选区切到模板滑条, 主滑条保持固定)
      document.querySelector('[data-conv="add-rule"]').click();
      await sleep(150);
      store.select([486002]);
      await sleep(100);
      document.querySelector('[data-conv="capture-0"]').click();
      await sleep(300);
      out.captureLabel = document.querySelector('[data-conv="capture-0"]').textContent;
      // 3) 预览: 默认 1x1/4 消除 0 → 盖章数 = floor((312-ε)/step), step = beatLength/4×vel
      const step4 = red0.beatLength / 4 * vel;
      out.expectStamps = Math.floor((312 - 1e-6 - step4) / step4) + 1;
      out.preview = store.conversionPreview
        ? { n: store.conversionPreview.objects.length, type: store.conversionPreview.objects[0].curveType,
            anchors: (store.conversionPreview.objects[0].curvePoints || []).length + 1,
            hide: store.conversionPreview.hideIds, sv: (store.conversionPreview.timingPoints || []).length }
        : null;
      out.previewLen = store.conversionPreview ? store.conversionPreview.objects[0].length : 0;
      // 4) v519 快照语义: 捕获后改源滑条锚点 → 窗口模板与预览不变
      const o2 = store.beatmap.hitObjects.find(o => o.id === 486002);
      o2.curvePoints = [{ x: 150, y: 340 }, { x: 180, y: 400 }];
      store.emit();
      await sleep(250);
      out.sourceEditLen = store.conversionPreview ? store.conversionPreview.objects[0].length : 0;
      // 5) SV 预览文本
      const svEl = document.querySelector('[data-conv="sv-preview"]');
      out.svText = svEl ? svEl.textContent : null;
      out.expectSv = out.sourceEditLen / 312; // v519: 使用捕获快照的几何长度
      // 6) 应用
      document.querySelector('[data-conv="apply"]').click();
      await sleep(300);
      const bm2 = store.beatmap;
      const res = bm2.hitObjects.find(o => o.type === 'slider' && o.id !== 486002);
      out.applied = res ? { id: res.id, type: res.curveType, anchors: (res.curvePoints || []).length + 1,
        len: res.length, mainGone: !bm2.hitObjects.some(o => o.id === 486001), selected: store.selected.has(res.id) } : null;
      const green = bm2.timingPoints.find(p => !p.uninherited && Math.round(p.time) === t);
      out.greenSv = green ? -100 / green.beatLength : null;
      // 时长保持: 新 velocity = 100*sm*sv/red; endTime = t + len/velNew
      const velNew = 100 * sm * out.greenSv / red0.beatLength;
      out.newDur = res.length / velNew;
      // 7) undo 一步还原
      store.undo();
      await sleep(150);
      const bm3 = store.beatmap;
      out.undone = { mainBack: bm3.hitObjects.some(o => o.id === 486001),
        greenGone: !bm3.timingPoints.some(p => !p.uninherited && Math.round(p.time) === t),
        stampedGone: !bm3.hitObjects.some(o => o.id === out.applied.id) };
      return out;
    })()`);

    assert(out.dlgOpen, '窗口打开');
    assert(/P\/3/.test(out.captureLabel || ''), `捕获模板显示 P/3 (实际 ${out.captureLabel})`);
    assert(out.preview && out.preview.n === 1 && out.preview.type === 'B' && out.preview.hide[0] === 486001,
      `预览: 1 根 B 结果滑条且隐藏主滑条 (${JSON.stringify(out.preview)})`);
    assert(out.preview.sv >= 1, `预览含 SV 绿线 (${out.preview.sv} 条)`);
    assert(out.preview.anchors > 3 * out.expectStamps, `预览锚点数 ${out.preview.anchors} > ${3 * out.expectStamps} (模板×${out.expectStamps}处)`);
    assert(out.sourceEditLen === out.previewLen, `v519 快照: 捕获后改源滑条不影响预览 (len ${out.previewLen.toFixed(1)} → ${out.sourceEditLen.toFixed(1)})`);
    const m = /SV: ([\d.]+) → ([\d.]+)/.exec(out.svText || '');
    assert(m && Math.abs(parseFloat(m[2]) - out.expectSv) < 0.02, `SV 预览 = 1.00 → ${out.expectSv.toFixed(2)} (实际 ${out.svText})`);
    assert(out.applied && out.applied.mainGone && out.applied.selected && out.applied.type === 'B',
      `应用: 替换主滑条并选中结果 (${JSON.stringify(out.applied)})`);
    assert(Math.abs(out.greenSv - out.expectSv) < 0.02, `头绿线 SV = ${out.expectSv.toFixed(2)} (实际 ${out.greenSv && out.greenSv.toFixed(3)})`);
    assert(Math.abs(out.newDur - out.dur0) < 2, `时长保持 ${out.dur0.toFixed(1)}ms (实际 ${out.newDur.toFixed(1)}ms)`);
    assert(out.undone.mainBack && out.undone.greenGone && out.undone.stampedGone,
      `undo 一步还原 (含绿线移除) ${JSON.stringify(out.undone)}`);

    // 优先级: P1 1x1/4 + P2 1x1/2 → P2 的 4 个点全部落在 P1 点上被吞, 插入数 = P1 的 8 (期望 expectStamps)
    const out2 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.select([486001]);
      store.openConversion('anchorStamp');
      await sleep(300);
      document.querySelector('[data-conv="add-rule"]').click();
      await sleep(120);
      store.select([486002]);
      await sleep(80);
      document.querySelector('[data-conv="capture-0"]').click();
      await sleep(120);
      // 规则2: priority 2, 间隔 1x1/2
      document.querySelector('[data-conv="add-rule"]').click();
      await sleep(120);
      document.querySelector('[data-conv="capture-1"]').click();
      await sleep(120);
      const denSel = document.querySelector('[data-conv="interval-den-1"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(denSel, '2');
      denSel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
      const txt = document.querySelector('[data-dialog="anchorStamp"]').textContent;
      const m = /将插入 (\\d+) 处模板/.exec(txt) || /insert (\\d+)/.exec(txt);
      const stamps = m ? parseInt(m[1]) : -1;
      store.closeConversion();
      return { stamps, txt: txt.slice(0, 200) };
    })()`);
    assert(out2.stamps === out.expectStamps, `优先级: P2 1/2 点全被 P1 1/4 吞, 插入数 = ${out.expectStamps} (实际 ${out2.stamps})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V486_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V486_ALL_TESTS_PASSED');
