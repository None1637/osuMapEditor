// 验证器 v142: 上方时间轴 ① 滑条中段可选中+按住拖动改时间 ② 折返点显示与滑条尾同款圆圈
// 背景: ① 原连体条中段只在 mouseup 单击时兜底选中 (v80), mousedown 直接进框选 — 无法从条中段拖物件;
//       现 mousedown 圆命中落空后、绿线药丸/框选前查 timelineBarHit (仅物件行 y<=OBJ_H),
//       命中即与头/尾圆同款 选中 + markerDrag 拖动 (吸附节拍); 框选仍可从行空白处/行下方全高度起手 (v102)。
//       ② 折返点原只画 reversearrow 贴图; 现与滑条尾同款圆圈 (填充+环, 描边沿用条样式), 箭头画在圆圈上。
// 运行: node verifier/v142/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const tl = readSrc('src/components/Timelines.tsx');

section('折返点圆圈 (与滑条尾同款) + 箭头在上');
{
  assert(/v142 起与滑条尾同款圆圈/.test(tl), '折返点注释标明 v142 圆圈语义');
  const loop = tl.match(/for \(let s = 1; s < n; s\+\+\) \{[\s\S]*?\n      \}/);
  assert(!!loop, '折返循环可定位');
  const body = loop ? loop[0] : '';
  assert(/arc\(tx, cy, rad, 0, Math\.PI \* 2\); g\.fill\(\)/.test(body), '折返点圆填充 (st.fill, 与尾圆同款)');
  assert(/arc\(tx, cy, rad, 0, Math\.PI \* 2\); g\.stroke\(\)/.test(body), '折返点圆描边 (沿用条样式, 与尾圆同款)');
  assert(body.indexOf('g.fill()') < body.indexOf('drawImage') && body.indexOf('g.stroke()') < body.indexOf('drawImage'), '圆圈在箭头下层 (箭头画在圆圈上指示方向)');
  assert(body.includes('getSkin().reversearrow') === false && tl.includes('getSkin().reversearrow'), 'reversearrow 贴图保留 (v98 语义)');
}

section('mousedown: 连体条中段命中 -> 选中 + 拖动改时间');
{
  assert(/timelineBarHit\(bmBar\.hitObjects, objEnd/.test(tl), 'mousedown 中段走 timelineBarHit');
  assert(/e\.clientY - rBar\.top <= OBJ_H/.test(tl), '中段命中限物件行 (y <= OBJ_H, 不抢药丸/tick 行)');
  assert(/anchorId: barId, startX: e\.clientX, moved: false/.test(tl), '命中即准备 markerDrag (吸附节拍拖动)');
  assert(/store\.toggleSelect\(barId\)/.test(tl), 'Shift/Ctrl 加选/减选 (与圆命中同款)');
  // 分支顺序: 尾端 resize -> 圆命中 -> 中段 bar -> 绿线药丸 -> 框选
  const iTail = tl.indexOf('const tailId = store.lockNotes ? null : hitTestTail(e);');
  const iMarker = tl.indexOf('const id = hitTestMarker(e);');
  const iBar = tl.indexOf('const barId = timelineBarHit(bmBar');
  const iPill = tl.indexOf('const pill = hitTestTimingPill(e);\n            if (pill && !pill.tp.uninherited)');
  const iMarquee = tl.indexOf('marqueeRef.current = {');
  assert(iTail > 0 && iTail < iMarker && iMarker < iBar && iBar < iPill && iPill < iMarquee, '命中优先级: 尾端 > 头/尾圆 > 中段 > 绿线药丸 > 框选');
  // v115 锁定物件: 中段同样只可选中不可拖
  const barBlk = tl.slice(iBar, iPill);
  assert(/if \(!store\.lockNotes\)/.test(barBlk), '锁定物件禁用中段拖动 (v115 语义)');
  // 旧路径不动
  assert(/timelineBarHit\(bm\.hitObjects, objEnd/.test(tl), 'v80 单击/右键兜底 barHit 保留');
  assert(/timelineMarkerHit\(bm\.hitObjects, objEnd, t0, win, r\.width, px, RAD, py, stackGeomOf/.test(tl), '圆命中走纯函数 (v79 语义; v162: 带堆叠几何)');
}

section('timelineHit.ts: 注释同步 (中段参与 mousedown)');
{
  const src = readSrc('src/osu/timelineHit.ts');
  assert(/v142: mousedown 中段命中也走本函数/.test(src), 'barHit 注释更新 (不再是"不参与 mousedown")');
  assert(!/不参与 mousedown 拖拽预备/.test(src), '旧注释 (不参与 mousedown) 移除');
  assert(/export function timelineBarHit</.test(src) && /end - o\.time <= 1/.test(src), 'barHit 纯函数语义不变 (排除无时长物件)');
}

console.log(failures ? `\nV142_CHECK_FAILED: ${failures}` : '\nV142_CHECK_PASSED');
process.exit(failures ? 1 : 0);
