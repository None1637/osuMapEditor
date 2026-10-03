// v306 逻辑测试: F07 — 近共线三点圆弧 (头夹在另外两锚点间, thetaRange≈2π) 按 lazer
// EnsureValidPathTypes 规则 (圆弧包围盒 >=640x480) 回退贝塞尔, 几何长度/路径包围盒不再爆炸
import { SliderPath, sliderGeometryLength } from '../../src/osu/sliderPath';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok:', msg);
}

// 场景复现 (用户截图布局): a=头在中间, b=左上锚点偏离对角线 10px, c=右下锚点 — 近共线
const a = { x: 300, y: 300 }, b = { x: 100, y: 110 }, c = { x: 500, y: 500 };

// 1) 病态弧: 几何全长必须收敛到贝塞尔量级 (弦长 ~566px), 不再是 ~2πr ≈ 数万 px
const geo = sliderGeometryLength('P', [a, b, c]);
assert(geo < 1000, `病态弧几何全长收敛 (=${geo.toFixed(1)} < 1000, 修复前 ~21795)`);

// 2) 病态弧 + 合理长度 (重吸附/放置只能产生 snap(465) 量级): 路径收敛在控制点附近
const p = new SliderPath('P', [a, b, c], 300);
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const pt of p.points) {
  if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
  if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
}
assert(maxX - minX < 800 && maxY - minY < 800, `路径包围盒有界 (=${(maxX - minX).toFixed(0)}x${(maxY - minY).toFixed(0)}, 修复前 ~21795x21795)`);
assert(Math.abs(p.totalLength - 300) < 1, `totalLength = 预期长度 (=${p.totalLength.toFixed(1)})`);
assert(p.points.length < 5000, `采样点数有界 (=${p.points.length}, 修复前 ~25 万)`);

// 2b) length > 几何全长时仍按 v148 沿末端切线延长 (lazer 行为不变, 只多 1 个点)
const pExt = new SliderPath('P', [a, b, c], 2000);
assert(pExt.totalLength === 2000 && pExt.points.length < 5000, `v148 末端延长保持 (totalLength=${pExt.totalLength}, 点数=${pExt.points.length})`);

// 3) 正常弧不受影响: 四分之一圆 r=200 (包围盒 200x200 < 640x480) 仍走圆弧, 长度 = θ·r ≈ 314.16
const q1 = { x: 200, y: 0 }, q2 = { x: 200 * Math.SQRT1_2, y: 200 * Math.SQRT1_2 }, q3 = { x: 0, y: 200 };
const geoQ = sliderGeometryLength('P', [q1, q2, q3]);
assert(Math.abs(geoQ - Math.PI / 2 * 200) < 3, `正常弧保持圆弧 (长度=${geoQ.toFixed(2)} ≈ ${(Math.PI / 2 * 200).toFixed(2)})`);

// 4) 大但合法的弧: r=300 四分圆 (包围盒 300x300) 不触发回退
const r1 = { x: 300, y: 0 }, r2 = { x: 300 * Math.SQRT1_2, y: 300 * Math.SQRT1_2 }, r3 = { x: 0, y: 300 };
const geoR = sliderGeometryLength('P', [r1, r2, r3]);
assert(Math.abs(geoR - Math.PI / 2 * 300) < 4, `r=300 弧保持圆弧 (长度=${geoR.toFixed(2)} ≈ ${(Math.PI / 2 * 300).toFixed(2)})`);

// 5) 头在两端之间的普通扁弧 (thetaRange 小): b 在 a,c 中间偏上 30px — 小弧, 不触发回退
const f1 = { x: 100, y: 300 }, f2 = { x: 300, y: 270 }, f3 = { x: 500, y: 300 };
const geoF = sliderGeometryLength('P', [f1, f2, f3]);
const chord = 400, sag = 30;
const approxArc = Math.sqrt(chord * chord / 4 + sag * sag) * 2; // 两弦之和近似 (略大于弧长)
assert(geoF > chord && geoF < approxArc * 1.05, `扁弧保持圆弧 (长度=${geoF.toFixed(1)}, 弦=${chord})`);

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
