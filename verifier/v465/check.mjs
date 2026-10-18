// 验证器 v465: 上方物件时间轴两段式绘制 — 先全部身体 (连体条/尾圆/折返点), 再全部头圆/note
// 背景: 用户反馈「上方物件時間軸的滑條尾不該完全遮住note」。旧实现每个物件原子绘制
//   (drawTimelineObject 一次画完身体+头), 倒序遍历 = 晚物件压底, 滑条 (头早) 的尾圆盖住
//   同刻/近刻 note (头晚, 先画在底)。修复: TimelineObjectStyle.part = 'all'|'body'|'head',
//   物件行主循环包成 body/head 两段 (各自保持倒序, v189 头圆压盖语义不变),
//   stable 层级 = 圆压条。幻影预览不传 part = 单件全画, 行为不变。
// 运行: npm run build 后 node verifier/v465/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: part 字段与两段式循环');
{
  const tl = read('src/components/Timelines.tsx');
  assert(/part\?: 'all' \| 'body' \| 'head';/.test(tl), 'TimelineObjectStyle.part 三态字段');
  assert(/const part = st\.part \?\? 'all';/.test(tl), 'drawTimelineObject 缺省 all (幻影不变)');
  assert(/if \(part !== 'head' && st\.dur\) \{/.test(tl), '身体段 (连体条/尾圆/折返点) 仅 body/all');
  assert(/if \(part !== 'body'\) \{/.test(tl), '头圆段仅 head/all');
  assert(/if \(part === 'body' && k === 0\) continue;/.test(tl), '节点色点 k=0 跟头圆段');
  assert(/if \(part === 'head' && k > 0\) continue;/.test(tl), '节点色点 k>=1 跟身体段');
  assert(/for \(const part of \['body', 'head'\] as const\) \{/.test(tl), '物件行两段式主循环');
  assert(/if \(part === 'body' && displaySettings\.timelineSvSample\) \{/.test(tl), 'sample 药丸只随 body 段收集一次');
  assert(/part, \/\/ v465/.test(tl), 'drawTimelineObject 调用传 part');
  // 幻影预览两处不传 part (虚线单件全画)
  const phantomCalls = tl.match(/dashed: true, dur: true,\s*\n?\s*\}\);/g) || [];
  assert(phantomCalls.length === 2, `幻影预览仍两处不传 part (${phantomCalls.length})`);
}

section('CDP: 像素断言 — note 头圆压滑条尾圆');
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
    await normalizeEnv(evalJs);
    await sleep(500);

    const r = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = base.timingPoints.find(p => p.uninherited);
      const SM = base.difficulty.sliderMultiplier;
      // length = 100*SM → 滑条时长恰好一拍 (beatLength ms, sv=1)
      const t1 = Math.round(red0.time + red0.beatLength * 8);
      const t2 = t1 + red0.beatLength;
      const slider = { id: 965001, type: 'slider', x: 200, y: 200, time: t1, newCombo: false, comboSkip: 0,
        hitSound: 0, curveType: 'L', curvePoints: [{ x: 320, y: 200 }], slides: 1, length: 100 * SM };
      // 上时间轴: win = 6000/zoom, x(t) = (t - (cur-win/2))/win * cssW; seek(t2) 后尾圆在画布正中
      const cvs = [...document.querySelectorAll('canvas')].filter(c => c.className.includes('h-[92px]'));
      if (!cvs.length) return { error: 'no top timeline canvas' };
      const cv = cvs[0];
      const rect = cv.getBoundingClientRect();
      const cssW = rect.width;
      // note 与尾圆中心相距 ~30 css px (两圆半径 24 有重叠透镜区, 且时间不同不堆叠)
      const deltaT = Math.max(2, Math.round(30 * 6000 / cssW));
      const tN = t2 + deltaT;
      const note = { id: 965002, type: 'circle', x: 400, y: 300, time: tN, newCombo: true, comboSkip: 0, hitSound: 0 };
      store.load({
        ...base,
        timingPoints: [{ ...red0 }],
        colors: { ...base.colors, combos: ['#FF69B4', '#46B4FF'] }, // combo1 粉 / combo2 蓝
        editor: { ...base.editor, timelineZoom: 1 },
        hitObjects: [slider, note],
      }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select'; store.clearSelection();
      store.seek(t2);
      await sleep(700); // 等几帧 rAF 画完
      const g = cv.getContext('2d');
      const ratio = cv.width / rect.width;
      const cy = 30; // OBJ_H/2 (非堆叠 level 0)
      const xOf = (t) => (t - (t2 - 3000)) / 6000 * cssW;
      const xTail = xOf(t2), xNote = xOf(tN);
      const pick = (fx, fy) => {
        const d = g.getImageData(Math.round(fx * ratio), Math.round(fy * ratio), 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      // 几何锚定 (不靠 combo 色名 — 皮肤/设置会改配色):
      //   tailOnly = 尾圆中心 (距 note 圆心 30 > r24, 纯尾圆填充)
      //   noteOnly = note 圆内远离尾圆/数字处 (距尾圆心 46 > 24, 距 note 心 16 < 24)
      //   overlap  = 两圆重叠透镜区
      const tailOnly = pick(xTail, cy);
      const noteOnly = pick(xNote + 16, cy);
      const overlap = [0.35, 0.5, 0.65, 0.75].map(f => pick(xTail + (xNote - xTail) * f, cy));
      const deltaCss = xNote - xTail;
      return { tailOnly, noteOnly, overlap, deltaCss, cssW };
    })()`);
    if (r.error) throw new Error(r.error);
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    assert(r.deltaCss > 12 && r.deltaCss < 48, `两圆心间距落在重叠区 (${r.deltaCss.toFixed(1)} css px)`);
    assert(dist(r.tailOnly, r.noteOnly) > 60, `尾圆/note 填充色可区分 (dist=${dist(r.tailOnly, r.noteOnly).toFixed(0)})`);
    const nearNote = r.overlap.filter(p => dist(p, r.noteOnly) < 40).length;
    const farFromTail = r.overlap.filter(p => dist(p, r.tailOnly) > 40).length;
    assert(nearNote >= 3 && farFromTail >= 3,
      `重叠区绘制为 note 头圆填充而非尾圆 (nearNote=${nearNote}/4 farFromTail=${farFromTail}/4, ` +
      `overlap=${JSON.stringify(r.overlap)} note=${JSON.stringify(r.noteOnly)} tail=${JSON.stringify(r.tailOnly)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V465_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V465_ALL_TESTS_PASSED');
