// 验证器 v331: 旋转窗口预览后直接点选其他物件 — 旧物件不复原且不能撤销 (用户反馈)
//   根因: 回滚靠 TransformDialog 的 React effect (v315 F17c), 但画布 mousedown 的
//   beginDrag/pushUndo 在 effect 运行之前执行 → undo 快照带着预览态; mouseup 空拖拽
//   store.undo() 把预览态顶回当前态 = "不复原 + 不能撤销"。
// 修法:
//   1) store.pushUndo 守卫: 预览会话 (tfBackup) 中物件选区签名已变 → 快照前同步
//      restoreTransformBackup (单点兜底, 覆盖所有选区变更路径, 不止 select());
//      [v345 更新: 签名守卫误弹面太大 (选区不变的入栈路径也会把预览态混进快照),
//       改为 pushUndo 无条件 restoreTransformBackup (回滚幂等) + selKeyOf/tfSelKey 移除;
//       空拖拽收尾改 cancelDragNoop 按栈深静默弹栈]
//   2) TransformDialog 选区切换时角度/倍率归零 (用户反馈: 选其他物件旋转角度不归零);
//      对话框 effect 的 end/begin 保留作双保险。
// 运行: node verifier/v331/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const store = readSrc('src/osu/store.ts');
const dlg = readSrc('src/components/TransformDialog.tsx');

section('store.ts: pushUndo 预览回滚守卫 (v345: 无条件回滚, 取代 v331 选区签名守卫)');
{
  assert(!/selKeyOf|tfSelKey/.test(store), 'v345: selKeyOf/tfSelKey 签名守卫已移除 (改无条件回滚)');
  const push = store.match(/pushUndo\(\) \{[\s\S]{0,600}?\n  \}/);
  assert(!!push && /if \(this\.tfBackup\) this\.restoreTransformBackup\(\);/.test(push[0]), 'pushUndo: 预览会话中快照前无条件回滚到基准 (回滚幂等)');
  assert(!!push && push[0].indexOf('restoreTransformBackup') < push[0].indexOf('this.undoStack.push'), '回滚先于快照');
  assert(/cancelDragNoop\(\) \{[\s\S]{0,300}?this\.dragUndoDepth/.test(store), 'v345: cancelDragNoop 空拖拽按栈深静默弹栈 (不进 redo)');
}

section('TransformDialog: 选区切换归零');
{
  const eff = dlg.match(/prevSelKey\.current = selKey;[\s\S]{0,300}?\}, \[selKey, mode\]\);/);
  assert(!!eff && /setAngle\(0\)/.test(eff[0]), '切换选区 → 角度归零');
  assert(!!eff && /setFactor\(1\); setFactorY\(1\)/.test(eff[0]), '切换选区 → 缩放倍率归 1 (v331 同批用户反馈: 缩放不预设1倍)');
  assert(!!eff && /store\.endTransformPreview\(\);[\s\S]{0,100}?store\.beginTransformPreview\(\);/.test(eff[0]), 'effect 回滚+重开保留 (双保险)');
}

section('功能: 竞态时序全链复现 (esbuild 打包真跑)');
{
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v331-')), 'bundle.mjs');
  execSync(`npx esbuild verifier/v331/entry.ts --bundle --format=esm --platform=node --outfile="${out}" --log-level=error --alias:@=./src`, { cwd: root, stdio: 'pipe' });
  const mod = await import('file:///' + out.replace(/\\/g, '/'));
  const { store: st, rotateObjects, scaleObjects } = mod;
  const slider = (id, x) => ({ id, type: 'slider', x, y: 192, time: id * 1000, newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L', curvePoints: [{ x: x + 100, y: 192 }], slides: 1, length: 100 });
  st.beatmap = {
    hitObjects: [slider(1, 100), slider(2, 300)],
    timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
    difficulty: { hp: 5, cs: 4, od: 5, ar: 9, sliderMultiplier: 1.4, sliderTickRate: 1 },
    editor: { bookmarks: [], distanceSpacing: 1, beatDivisor: 4, gridSize: 4, timelineZoom: 1 },
    general: {}, metadata: {}, colors: [], events: [],
  };
  const o1 = st.beatmap.hitObjects[0];
  const origX = o1.x, origCpX = o1.curvePoints[0].x;
  // 1) 开窗 + 预览旋转 90°
  st.select([1]);
  st.beginTransformPreview();
  st.previewTransform((objs, c) => rotateObjects(objs, c, 90), 'selection');
  assert(o1.x !== origX, '预览生效 (A 已旋转)');
  // 2) 用户不点应用, mousedown 点选滑条 B: select → beginDrag(pushUndo) — 竞态点
  st.select([2]);
  st.pushUndo(); // beginDrag
  // 3) React effect (双保险): end + begin
  st.endTransformPreview();
  st.beginTransformPreview();
  // 4) mouseup 空拖拽: undo() 弹出空快照 — 修复前这一步把预览态顶回
  st.undo();
  assert(o1.x === origX && o1.curvePoints[0].x === origCpX, `mouseup undo 后 A 复原 (x=${o1.x}, cp=${o1.curvePoints[0].x}, 期望 ${origX}/${origCpX})`);
  assert(!st.canUndo, 'undo 栈干净 (预览全程无残留快照)');
  // 5) 同选区拖拽不触发守卫 (pushUndo 快照 = 预览态是 preview 语义内行为): 选区不变时守卫静默
  st.select([2]); st.beginTransformPreview();
  st.pushUndo(); // 选区未变
  assert(st.canUndo, '同选区 pushUndo 正常入栈 (守卫不误触发)');
  st.endTransformPreview();
  // 6) 缩放窗口同款竞态 (用户反馈: 縮放也是相同問題) — scaleObjects 走同一 tfBackup 预览会话
  //    注意: undo 的 restore() 深拷贝替换 hitObjects, o1 引用需重取
  st.undoStack.length = 0; st.redoStack.length = 0;
  st.select([1]); st.beginTransformPreview();
  let cur1 = st.beatmap.hitObjects[0];
  st.previewTransform((objs, c) => scaleObjects(objs, c, 2), 'selection');
  assert(cur1.x !== origX, '缩放预览生效');
  st.select([2]); st.pushUndo(); // mousedown 点选 B: 竞态点
  st.endTransformPreview(); st.beginTransformPreview(); // effect 双保险
  st.undo(); // mouseup 空拖拽
  cur1 = st.beatmap.hitObjects[0];
  assert(cur1.x === origX && cur1.curvePoints[0].x === origCpX, '缩放预览: mouseup undo 后 A 复原');
  assert(!st.canUndo, '缩放预览: undo 栈干净');
  // 7) 取消选取路径 (点空白 = clearSelection, 无 pushUndo): effect 回滚即复原
  st.select([1]); st.beginTransformPreview();
  cur1 = st.beatmap.hitObjects[0];
  st.previewTransform((objs, c) => scaleObjects(objs, c, 2), 'selection');
  st.clearSelection();
  st.endTransformPreview(); // 对话框 selKey effect
  cur1 = st.beatmap.hitObjects[0];
  assert(cur1.x === origX && cur1.curvePoints[0].x === origCpX, '取消选取: 缩放预览复原');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv331 全部通过');
process.exit(failures ? 1 : 0);
