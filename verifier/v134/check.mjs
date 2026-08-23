// 验证器 v134: 视觉间距辅助线吸附 — 放置/拖拽时参考点吸附到金色环带
// 背景: v126 设计为仅显示不吸附; v133 修好轮廓后用户要求吸附。
// 实现: geometryHelpers.distGuideSnap (阈值 OBJECT_SNAP_RADIUS);
//   EditorCanvas geoDistSnap (与渲染同一来源 geoDistSources/geoScope/总开关, 含堆叠偏移, exclude 防自锁);
//   snapWithGeo 漏斗并入 (放置/节点拖拽/原点拖拽全生效); 物件移动拖拽链 geoDragCorrection 第三级 (取更近者)。
// v139 语义修正: snap 目标从 (distR + dragR, 边缘贴环带) 改为 distR (参考点直接吸到可见环带) —
//   边缘语义下吸附带在环带外侧一个物件半径处, 物件中心拖到金线上不触发, 用户感觉不到吸附。
// 运行: node verifier/v134/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v134/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v134/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V134_TESTS_*)
fs.unlinkSync(out);

section('geometryHelpers.ts: distGuideSnap');
{
  const src = readSrc('src/osu/geometryHelpers.ts');
  assert(/export function distGuideSnap\(p: Pt, distR: number, circles: Pt\[\], paths: Pt\[\]\[\]\)/.test(src), 'distGuideSnap 导出 (v139 起去掉 dragR 参数)');
  assert(/const target = distR;/.test(src), 'snap 目标 = distR (v139: 参考点直接吸到可见环带)');
  assert(!/distR \+ dragR;/.test(src), 'v134 边缘贴环带 (distR + dragR) 语义已移除 (代码中, 注释提及不算)');
  assert(/bestScore = OBJECT_SNAP_RADIUS/.test(src), '阈值 = OBJECT_SNAP_RADIUS (6.4, 同物件吸附)');
  assert(/包围盒早退/.test(src), '长路径包围盒早退 (性能)');
}

section('EditorCanvas.tsx: 吸附接线');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/import \{[^}]*distGuideSnap[^}]*\} from '@\/osu\/geometryHelpers'/.test(src), '引入 distGuideSnap');
  assert(/const geoDistSnap = \(bm: Beatmap, p: Pt, exclude\?: ReadonlySet<number>\)/.test(src), 'geoDistSnap helper');
  assert(/if \(!store\.geoDist \|\| !store\.geoEnabled\) return null;/.test(src), '受 geoDist 开关 + 总开关控制 (与渲染一致)');
  assert(/geoDistSources\(store\.geoScope/.test(src.slice(src.indexOf('const geoDistSnap'))), '来源共用 geoDistSources/geoScope (所见即所吸)');
  assert(/distGuideSnap\(p, r \+ store\.geoDistValue, circles, paths\)/.test(src), 'distR = 物件半径 + 间距 (v139: 目标 = 可见环带)');
  assert(/exclude\?\.has\(o\.id\)\) continue;/.test(src.slice(src.indexOf('const geoDistSnap'))), 'exclude 防自锁');
  assert(/for \(const c of \[geoSnap\(bm, p, exclude\), geoDistSnap\(bm, p, exclude\)\]\)/.test(src), 'snapWithGeo 漏斗并入 (放置/节点/原点拖拽生效)');
  assert(/geoDragCorrection\(dragPts, dx, dy, q => geoDistSnap\(bm, q, store\.selected\), corrDist\)/.test(src), '物件移动拖拽链第三级修正 (取更近者)');
}

section('GeoSnapPanel.tsx: 描述同步 (不再写"不参与吸附")');
{
  const src = readSrc('src/components/GeoSnapPanel.tsx');
  assert(/吸附到环带/.test(src), '开关行描述含吸附说明 (v139: 物件中心吸附到环带线)');
  assert(!/仅显示, 不参与吸附/.test(src) && !/不提供吸附/.test(src), '旧的"不参与吸附"描述已移除');
}

console.log(failures ? `\nV134_CHECK_FAILED: ${failures}` : '\nV134_CHECK_PASSED');
process.exit(failures ? 1 : 0);
