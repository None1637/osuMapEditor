// v183: 「打击动画」关 (stable 编辑器暂留模式) 时, 单点命中后缩圈固定贴边随本体渐隐 (对齐 osu!stable)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
let failures = 0;
const ok = (cond, label) => { console.log(cond ? 'PASS' : 'FAIL', label); if (!cond) failures++; };

const r = fs.readFileSync(path.join(root, 'src/osu/renderer.ts'), 'utf8');

ok(/function drawApproach\([^)]*pinAfterHit = false\)/.test(r), 'drawApproach 带 pinAfterHit 参数 (默认 false)');
ok(/if \(dt >= 0\) \{\s*if \(!pinAfterHit\) return;/.test(r), '命中后: 不贴边则照旧不画缩圈');
// v195 适配: 贴边大小由固定 size 改为 size × approachBounceScale(dt, preempt) (命中后向外反弹 0.2 再停住)
ok(/const pin = size \* approachBounceScale\(dt, preempt\);\s*g\.drawImage\(tintedSprite\(skin\.approachcircle, color\), x - pin \/ 2, y - pin \/ 2, pin, pin\)/.test(r), '贴边缩圈: 最终大小 = 2r 盒子 × 反弹系数 (v195)');
ok(/drawApproach\(g, skin, color, x, y, size, dt, preempt, linger\)/.test(r) && /const linger = displaySettings\.hitExplosion && !displaySettings\.hitAnimation;/.test(r), '单点: 仅「点击特效开 + 打击动画关」暂留模式贴边 (v200: 条件收敛为 linger 变量)');
ok(/drawApproach\(g, skin, color, o\.x, o\.y, size, dt, preempt\)/.test(r), '滑条: 不贴边 (默认 false, 命中即消失)');

// 透明度: 贴边渐隐继承 lifecycle.alphaAt 的 HIT_LINGER 800ms 线性渐隐 (caller g.globalAlpha)
const lc = fs.readFileSync(path.join(root, 'src/osu/lifecycle.ts'), 'utf8');
ok(/!displaySettings\.hitAnimation && o\.type === 'circle'\) return Math\.max\(0, 1 - \(time - end\) \/ HIT_LINGER\)/.test(lc), '暂留渐隐 = HIT_LINGER 线性 (缩圈继承同一 alpha)');

console.log(failures ? `FAILURES: ${failures}` : 'ALL_OK');
if (failures) process.exit(1);
