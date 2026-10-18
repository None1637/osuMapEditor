// v451: 屏外物件拖入屏内被截断 (滑条身笔直硬切口) — 复现 + 修复回归
// 根因: v341 平移拖拽层 (drawDragLayer) 与选中装饰层 (selLayer selTranslate) 的离屏位图
//   构建时按画布裁剪 (bboxToDevice clip), 拖拽起点部分在屏外的物件其屏外部分从未画进位图;
//   拖拽中按位移差 blit 这块残缺位图 → 屏外部分永远缺失, 切口 = 构建时画布边 (笔直), 拖回不补。
// 修复: 每帧覆盖核验 (当前位移下内容设备包围盒 ∩ 画布 = need, 必须落在已绘区域内),
//   越出即按 need 外扩 REVEAL_MARGIN(384px) 重建; 位图尺寸有界 (≤ 画布+2×边距)。
// CDP 复现: 页内生成候选滑条段清单 (段中点≈路径点, 远离锚点 — v438 锚点按下会进节点拖拽;
//   命中与否按下后用 __dragState/物件位移核验, 不中换下一个), 抓滑条身上推至头出画布顶
//   (光标不出窗口) → 松手 (静态层正确重建) → 取消选中再抓同一段拖回原位, 中途 (头已回屏内,
//   鼠标未松) 对头部 160px crop 存像素快照, 松手后同位置再取并逐像素 diff:
//   修复前缺口 (头部没画进位图) 在松手后才补上 → diffRatio 大; 修复后期间已完整 → diffRatio≈0。
//   (旧 brightAt 21×21 亮像素断言不可靠: 采样框骑切口边界+头球中心深色, 修复前曾跑出假绿。)
// 运行: node verifier/v451/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9466;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MAP = { folderRel: 'beatmap-639217845366573336-audio', file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' };

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// ---------- a) 静态断言 ----------
{
  const src = fs.readFileSync(path.join(root, 'src/osu/renderer.ts'), 'utf8');
  check('bboxToDeviceRaw (不裁剪外接矩形) 存在', /function bboxToDeviceRaw\(/.test(src));
  check('REVEAL_MARGIN 常量', /const REVEAL_MARGIN = 384/.test(src));
  check('drawDragLayer 覆盖核验+边距重建', /drawDragLayer[\s\S]*needEmpty[\s\S]*REVEAL_MARGIN/.test(src));
  check('drawSelectionLayer 覆盖核验 (selTranslate)', /drawSelectionLayer[\s\S]*rc\.selTranslate[\s\S]*REVEAL_MARGIN/.test(src));
  check('选中装饰包围盒并入控制点 (v302 语义保留)', /selectionContentBBox[\s\S]*curvePoints/.test(src));
}

// ---------- b) CDP 复现 ----------
const { proc, profile } = launchIsolatedElectron(root, PORT);
let target;
try {
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
    } catch { /* not ready */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('CONNECT_FAILED');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
    type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1,
  });

  await normalizeEnv(evalJs);
  await evalJs(`window.__osuMenuCmd(${JSON.stringify({ type: 'open', ...MAP })})`);
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    if (await evalJs(`(() => { const s = window.__osuStore; return !!(s.beatmap && s.beatmap.hitObjects.length > 700); })()`)) break;
  }

  // 候选滑条段 (仅直线 L 型 — 段中点精确落在路径上, 排除曲线弧垂导致的抓取落空):
  //   - 头在屏内 (留边 20); 控制段长 >=44 osu → 段中点离两端锚点 >=22 osu (锚点命中半径 10, 不会进 v438 节点拖拽)
  //   - 段中点比头低 >=70css (上推后中点仍在画布内可见, 供第二次抓取)
  //   - 头 30osu / 段中点 18osu 内无同时间窗邻居及其锚点 (像素断言与按下不被邻居污染)
  const cands = await evalJs(`(() => {
    const s = window.__osuStore; const bm = s.beatmap;
    const cv = document.querySelector('canvas.cursor-crosshair');
    const r = cv.getBoundingClientRect();
    const nearNode = (x, y, selfId, dist) => bm.hitObjects.some(o => {
      if (o.id === selfId || o.type !== 'slider' || Math.abs(o.time - (bm.hitObjects.find(q => q.id === selfId)?.time ?? 0)) > 4000) return false;
      const pts = [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
      return pts.some(p => Math.hypot(p.x - x, p.y - y) < dist);
    });
    const out = [];
    for (const sl of bm.hitObjects.filter(o => o.type === 'slider' && (o.curveType ?? '') === 'L' && (o.curvePoints?.length ?? 0) >= 1)) {
      const head = window.__osuToClient(sl.x, sl.y);
      if (!head || head.y < r.top + 20 || head.y > r.bottom - 20 || head.x < r.left + 20 || head.x > r.right - 20) continue;
      if (head.y - 12 < 60) continue; // 上推距离 >=60css 才有意义
      const ctrls = [{ x: sl.x, y: sl.y }, ...sl.curvePoints];
      for (let i = 0; i < ctrls.length - 1; i++) {
        const a = ctrls[i], b = ctrls[i + 1];
        if (Math.hypot(b.x - a.x, b.y - a.y) < 44) continue;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const midC = window.__osuToClient(mid.x, mid.y);
        if (!midC || midC.y < head.y + 70) continue;
        const nearHead = bm.hitObjects.some(o => o.id !== sl.id && Math.abs(o.time - sl.time) < 2000
          && Math.hypot(o.x - sl.x, o.y - sl.y) < 30);
        if (nearHead || nearNode(mid.x, mid.y, sl.id, 18)) break;
        out.push({ id: sl.id, time: sl.time, segI: i, hx: sl.x, hy: sl.y, headX: head.x, headY: head.y, canvasTop: r.top });
        break;
      }
      if (out.length >= 10) break;
    }
    return out;
  })()`);
  console.log(`  候选滑条 ${cands.length} 条`);
  check('找到候选滑条', cands.length > 0);

  const grabNow = (c) => `(() => {
    const o = window.__osuStore.beatmap.hitObjects.find(o => o.id === ${c.id});
    if (!o) return null;
    const ctrls = [{ x: o.x, y: o.y }, ...o.curvePoints];
    const a = ctrls[${c.segI}], b = ctrls[${c.segI} + 1];
    return window.__osuToClient((a.x + b.x) / 2, (a.y + b.y) / 2);
  })()`;
  const headState = (c) => `(() => {
    const o = window.__osuStore.beatmap.hitObjects.find(o => o.id === ${c.id});
    if (!o) return null;
    const p = window.__osuToCanvas(o.x, o.y);
    return { ox: o.x, oy: o.y, headCanvasY: p ? p.y : null, dragPath: window.__dragPath ?? null };
  })()`;
  // 头部 crop 快照/diff: 以物件头 osu 坐标对应的 client 位置为中心取 SIZE×SIZE 设备 px。
  // 拖拽中途 (鼠标未松) snap, 松手后 diff — crop 越界返回 err 由主循环换候选。
  const CROP = 160;
  const snapCrop = (ox, oy) => evalJs(`(() => {
    const p = window.__osuToClient(${ox}, ${oy});
    if (!p) return { err: 'no-client' };
    const cv = document.querySelector('canvas.cursor-crosshair');
    const r = cv.getBoundingClientRect();
    const sc = cv.width / r.width;
    const s = ${CROP}, h = s / 2;
    const px = Math.round((p.x - r.left) * sc), py = Math.round((p.y - r.top) * sc);
    if (px - h < 0 || py - h < 0 || px + h > cv.width || py + h > cv.height) return { err: 'crop-out', px, py, w: cv.width, h: cv.height };
    const img = cv.getContext('2d').getImageData(px - h, py - h, s, s);
    window.__v451 = { data: img.data, size: s, px, py };
    return { px, py };
  })()`);
  const diffCrop = (ox, oy) => evalJs(`(() => {
    const saved = window.__v451;
    if (!saved) return null;
    const p = window.__osuToClient(${ox}, ${oy});
    if (!p) return { err: 'no-client' };
    const cv = document.querySelector('canvas.cursor-crosshair');
    const r = cv.getBoundingClientRect();
    const sc = cv.width / r.width;
    const s = saved.size, h = s / 2;
    const px = Math.round((p.x - r.left) * sc), py = Math.round((p.y - r.top) * sc);
    const img = cv.getContext('2d').getImageData(px - h, py - h, s, s).data;
    let changed = 0, brightBefore = 0, brightAfter = 0;
    for (let i = 0; i < img.length; i += 4) {
      if (Math.max(Math.abs(img[i] - saved.data[i]), Math.abs(img[i + 1] - saved.data[i + 1]), Math.abs(img[i + 2] - saved.data[i + 2])) > 40) changed++;
      if (Math.max(saved.data[i], saved.data[i + 1], saved.data[i + 2]) > 60) brightBefore++;
      if (Math.max(img[i], img[i + 1], img[i + 2]) > 60) brightAfter++;
    }
    return { diffRatio: changed / (s * s), brightBefore, brightAfter, dCenter: Math.hypot(px - saved.px, py - saved.py) };
  })()`);

  let done = false;
  for (const c of cands) {
    // 就位: seek + 清选 + 关界内钳制
    await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(${c.time} + 5); s.setLimitToPlayfield(false); s.selected.clear(); s.emitSelection(); })()`);
    await sleep(250);
    const g0 = await evalJs(grabNow(c));
    if (!g0) continue;
    const upDist = Math.round(c.headY - 12); // 头目标 client y=12 (画布顶上方 ~65css), 光标不出窗口
    // 拖拽 #1: 上推至头出画布顶
    await mouse('mousePressed', g0.x, g0.y);
    await sleep(120);
    const ds1 = await evalJs(`window.__dragState`);
    if (!ds1) { await mouse('mouseReleased', g0.x, g0.y); console.log(`  候选 #${c.id} 按下未建物件拖拽 (命中锚点/落空), 换下一个`); continue; }
    const posBefore = await evalJs(headState(c));
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', g0.x, g0.y - (upDist * i) / 8); await sleep(90); }
    const st1 = await evalJs(headState(c));
    const movedOk = st1 && posBefore && Math.hypot(st1.ox - posBefore.ox, st1.oy - posBefore.oy) > 10;
    if (!movedOk || st1.dragPath !== 'translate' || !(st1.headCanvasY < 0)) {
      await mouse('mouseReleased', g0.x, g0.y - upDist);
      console.log(`  候选 #${c.id} 拖拽#1 未达预期 (moved=${movedOk} path=${st1?.dragPath} headY=${Math.round(st1?.headCanvasY ?? -1)}), 换下一个`);
      continue;
    }
    await mouse('mouseReleased', g0.x, g0.y - upDist);
    await sleep(500);
    const afterUp = await evalJs(headState(c));
    check('拖拽#1 后滑条头在画布顶上方 (屏外)', !!afterUp && afterUp.headCanvasY < 0, `headCanvasY=${Math.round(afterUp?.headCanvasY ?? -1)}`);

    // 拖拽 #2 (复现): 清选后抓同段拖回原位, 中途不松手做像素断言。
    //   按下后先探针小移 + 核验目标物件确实在动 (防止命中邻居锚点/落空框选), 不符则换候选
    await evalJs(`(() => { const s = window.__osuStore; s.selected.clear(); s.emitSelection(); })()`);
    const g1 = await evalJs(grabNow(c));
    await mouse('mousePressed', g1.x, g1.y);
    await sleep(120);
    const ds2 = await evalJs(`window.__dragState`);
    await mouse('mouseMoved', g1.x, g1.y + 8); await sleep(90);
    await mouse('mouseMoved', g1.x, g1.y + 16); await sleep(90);
    const probe = await evalJs(headState(c));
    const probeMoved = ds2 && probe && Math.hypot(probe.ox - afterUp.ox, probe.oy - afterUp.oy) > 2;
    if (!probeMoved) { await mouse('mouseReleased', g1.x, g1.y + 16); console.log(`  候选 #${c.id} 拖拽#2 探针未动目标 (命中邻居锚点/落空), 换下一个`); continue; }
    console.log(`  候选 #${c.id} 探针通过, 执行完整复现断言`);
    for (let i = 3; i <= 10; i++) { await mouse('mouseMoved', g1.x, g1.y + (upDist * i) / 10); await sleep(90); }
    const mid = await evalJs(headState(c));
    check('拖拽#2 仍在平移拖拽层路径', mid.dragPath === 'translate', `path=${mid.dragPath}`);
    check('拖拽#2 中途头已回屏内 (>40 设备px)', mid.headCanvasY > 40, `headCanvasY=${Math.round(mid.headCanvasY ?? -1)}`);
    const snap = await snapCrop(mid.ox, mid.oy);
    if (!snap || snap.err) {
      await mouse('mouseReleased', g1.x, g1.y + upDist);
      console.log(`  候选 #${c.id} 头部 crop 越界 (${snap?.err ?? 'null'} px=${snap?.px},py=${snap?.py}), 换下一个`);
      continue;
    }
    await mouse('mouseReleased', g1.x, g1.y + upDist);
    await sleep(600);
    const df = await diffCrop(c.hx, c.hy);
    check('松手后头部 crop 有内容 (防两端黑假绿)', !!df && df.brightAfter > 500, `brightAfter=${df?.brightAfter}`);
    check('拖拽中途头部画面已与松手后一致 (无切口, diffRatio<5%)', !!df && df.diffRatio < 0.05,
      `diffRatio=${((df?.diffRatio ?? 1) * 100).toFixed(2)}% brightDuring=${df?.brightBefore} brightAfter=${df?.brightAfter} dCenter=${Math.round(df?.dCenter ?? -1)}px`);
    const restored = await evalJs(`(() => { const o = window.__osuStore.beatmap.hitObjects.find(o => o.id === ${c.id}); return Math.hypot(o.x - ${c.hx}, o.y - ${c.hy}) < 2; })()`);
    check('滑条拖回原位 (功能无损)', restored === true);
    done = true;
    break;
  }
  check('候选中完成一次完整复现流程', done);
} finally {
  await killIsolated(proc, profile);
}

if (failures > 0) { console.error(`\n${failures} 项断言失败`); process.exit(1); }
console.log('\n全部断言通过');
