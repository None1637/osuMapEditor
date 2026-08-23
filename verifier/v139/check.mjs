// 验证器 v139: 间距辅助线吸附语义修正 — 参考点直接吸到「可见环带」(WYSIWYG)
// 背景: v134 实现吸附后用户反馈"对放置/移动物件仍然没有吸附效果"。
// 根因: v134 采用"物件边缘贴环带"语义 — snap 目标 = distR + dragR, 吸附带在可见环带外侧一个
//   物件半径处 (CS4 ≈ 36 osu px); 用户自然地把物件中心拖到金线上, 距吸附带一个半径远, 不触发 — 感觉无吸附。
// 修复: distGuideSnap 目标改为 distR (= 绘制的环带中心线, 去掉 dragR 参数), 吸的就是画出来的那条线。
// 纯函数行为断言在 verifier/v134/tests.ts (已同步新语义); 本文件为变更点断言。
// 运行: node verifier/v139/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const gh = read('src/osu/geometryHelpers.ts');
const ec = read('src/components/EditorCanvas.tsx');
const panel = read('src/components/GeoSnapPanel.tsx');

// 1. 语义变更核心: 目标 = distR (可见环带), dragR 参数移除
assert(/export function distGuideSnap\(p: Pt, distR: number, circles: Pt\[\], paths: Pt\[\]\[\]\): Pt \| null \{\s*const target = distR;/.test(gh), 'distGuideSnap 目标 = distR (可见环带), 无 dragR');
assert(!/dragR: number/.test(gh) && !/distR \+ dragR;/.test(gh), 'dragR 参数与目标外扩已从代码移除 (仅注释提及)');
assert(/v139: 目标从 \(distR \+ dragR\) 改为 distR/.test(gh), '注释记录语义变更原因');

// 2. 调用点同步 (不再传物件半径)
assert(/distGuideSnap\(p, r \+ store\.geoDistValue, circles, paths\)/.test(ec), 'EditorCanvas 调用不传 dragR');
assert(!/distGuideSnap\(p, r \+ store\.geoDistValue, r,/.test(ec), '旧四参调用已移除');

// 3. 文案同步 (中心吸到环带线, 不再写边缘贴环带)
assert(/物件中心吸附到环带线/.test(panel), '面板开关行: 物件中心吸附到环带线');
assert(!/边缘吸附到环带/.test(panel) && !/边缘贴环带/.test(panel), '旧的"边缘贴环带"描述已移除');

console.log(failures ? `\nV139_CHECK_FAILED: ${failures}` : '\nV139_CHECK_PASSED');
process.exit(failures ? 1 : 0);
