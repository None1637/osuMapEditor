// v126 源码接线断言: 视觉间距辅助线 (物件等距轮廓, 可调距离, 入辅助线设置面板)
// 运行: node verifier/v126/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const helpers = read('src/osu/geometryHelpers.ts');
const store = read('src/osu/store.ts');
const panel = read('src/components/GeoSnapPanel.tsx');
const canvas = read('src/components/EditorCanvas.tsx');

// geometryHelpers: 纯函数
assert(/export function geoDistSources\(/.test(helpers), 'geoDistSources 导出');
assert(/o\.type === 'circle' \|\| o\.type === 'slider'/.test(helpers), '来源: 单点+滑条 (转盘排除)');
assert(/export function offsetPolyline\(pts: Pt\[\], d: number\)/.test(helpers), 'offsetPolyline 导出');
assert(/Math\.max\(1 \/ 3,/.test(helpers), 'miter 限幅 3 倍');

// store: 字段 + 可调距离 (默认关, 默认 50px, clamp 0-500)
assert(/geoDist = false;/.test(store), 'geoDist 默认关');
assert(/geoDistValue = 50;/.test(store), 'geoDistValue 默认 50');
assert(/setGeoDistValue\(v: number\)/.test(store) && /Math\.min\(500/.test(store), 'setGeoDistValue clamp 0-500');
assert(/'geoCenter' \| 'geoCircle' \| 'geoLines' \| 'geoDist'/.test(store), 'setGeoFlag 支持 geoDist');

// 面板: 开关行 + 距离输入框
assert(/data-geo-toggle="geoDist"/.test(panel), '面板: geoDist 开关行');
assert(/data-geo-dist-input/.test(panel), '面板: 距离输入框');
assert(/视觉间距辅助线/.test(panel), '面板: 名称');
assert(/store\.setGeoDistValue\(parseFloat/.test(panel), '输入框回写 store');

// 渲染: EditorCanvas 接线 (v133: 滑条轮廓改描边环带法, 折线 miter 偏移与端帽半圆已移除; 轮廓随堆叠偏移)
assert(/if \(store\.geoDist && store\.geoEnabled\)/.test(canvas), '渲染受 geoDist 开关 + 总开关控制');
assert(/csToRadius\(bm\.difficulty\.cs\) \+ store\.geoDistValue/.test(canvas), '轮廓距离 = 物件半径 + 间距 (边缘等距)');
assert(/geoDistSources\(store\.geoScope/.test(canvas), '显示范围共用 geoScope');
assert(/drawDistanceGuideRing\(g, pts, distR/.test(canvas), '滑条走描边环带 (v133 精确等距, 取代 offsetPolyline)');
assert(!/offsetPolyline\(pts, distR\)/.test(canvas), 'v126 折线 miter 偏移渲染已移除 (内弯尖刺不准)');
assert(/g\.arc\(o\.x \+ dx, o\.y \+ dy, distR/.test(canvas), '单点画等距圆环 (v133 起随堆叠偏移)');
assert(!/ah \+ Math\.PI \/ 2/.test(canvas), 'v126 头尾半圆端帽已移除 (描边法圆角 cap 自动端帽)');
assert(/rgba\(242,181,68,0\.8\)/.test(canvas), '金色样式');

console.log(failures ? `\nV126_CHECK_FAILED: ${failures}` : '\nV126_CHECK_PASSED');
process.exit(failures ? 1 : 0);
