// 验证器 v213: 上方时间轴选中滑条头/尾/折返节点单独加音效 (对齐 osu!stable)
// 运行: node verifier/v213/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('edgeSounds/timelineNodeHit 纯函数单测 (tests.ts)');
{
  const out = path.join(root, 'verifier/v213/_bundle.mjs');
  execSync(`npx esbuild "${path.join(root, 'verifier/v213/tests.ts')}" --bundle --platform=node --outfile="${out}"`, { cwd: root, stdio: 'pipe' });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '    ' + l).join('\n'));
}

section('timelineHit.ts: timelineNodeHit');
{
  const src = readSrc('src/osu/timelineHit.ts');
  assert(/export function timelineNodeHit/.test(src), 'timelineNodeHit 导出');
  assert(/for \(let k = 1; k <= slides; k\+\+\)/.test(src), '节点循环 k=1..slides (不含头)');
  assert(/\{ id: number; edge: number \} \| null/.test(src), '返回 { id, edge }');
  assert(/export function timelineMarkerHit/.test(src), 'timelineMarkerHit 保留 (旧语义不动)');
}

section('store.ts: edge 选区 + 音效写入');
{
  const src = readSrc('src/osu/store.ts');
  assert(/selectedEdges = new Map<number, Set<number>>\(\)/.test(src), 'selectedEdges 状态');
  assert(/selectEdges\(objId: number, edges: number\[\], additive = false\)/.test(src), 'selectEdges 方法');
  assert(/clearEdgeSelection\(\)/.test(src), 'clearEdgeSelection 方法');
  assert(/isEdgeSelected\(objId: number, edge: number\)/.test(src), 'isEdgeSelected 方法');
  assert(/toggleEdgeHitSound\(bit: number\)/.test(src), 'toggleEdgeHitSound 方法');
  assert(/toggleEdgesHitSound\(targets, bit\)/.test(src), 'toggleEdgeHitSound 走纯函数 toggleEdgesHitSound');
  assert(/setEdgeSoundBitAll\(o, bit, on\)/.test(src), '物件级设置同步已 materialize 的 edge 串 (stable 语义)');
  // 各选区入口同步清 edge 选区
  const clears = (src.match(/selectedEdges\.clear\(\)/g) ?? []).length;
  assert(clears >= 5, `select/toggleSelect(删宿主)/clearSelection/selectGreenLines/selectWithGreens/deleteSelected 清理 (实际 ${clears} 处 clear)`);
  assert(src.includes('this.selectedEdges.delete(id)'), 'toggleSelect 移除宿主物件时清其节点选区');
}

section('Timelines.tsx: 交互 + 绘制接线');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/timelineNodeHit/.test(src) && /hitTestNode/.test(src), 'hitTestNode 接线 timelineNodeHit');
  assert(src.includes('store.selectEdges(nh.id, [nh.edge], e.shiftKey || e.ctrlKey || e.metaKey)'), 'mousedown 点节点 → selectEdges (Shift/Ctrl 加选)');
  assert(src.includes('store.selectEdges(tr.objId, [to.slides ?? 1])'), '拖尾把手单击 (未拖动) → 选中尾节点');
  assert(/resizeEdgeStrings\(o\)/.test(src), '拖尾改 slides 后 resizeEdgeStrings 同步段数');
  assert(/edgeSel:\s*edgeSel\?\.size/.test(src), '绘制传入 edgeSel');
  assert(/edgeSounds: o\.type === 'slider' \? parseEdgeSounds\(o\)/.test(src), '绘制传入 edgeSounds (滑条逐段解析)');
  assert(/HS_DOTS/.test(src), 'hitsound 色点绘制');
  assert(src.includes("const sel = (store.selected.has(o.id) || prevIds.has(o.id)) && !edgeSel?.size"), '节点选区存在时整条不高亮');
}

section('App.tsx: W/E/R 路由');
{
  const src = readSrc('src/App.tsx');
  assert(src.includes('store.selectedEdges.size > 0'), '选中节点时 W/E/R 路由到节点级');
  assert(/toggleEdgeHitSound/.test(src), 'toggleEdgeHitSound 接线');
}

if (failures) { console.error(`V213 FAILED: ${failures}`); process.exit(1); }
console.log('V213 ALL PASSED');
