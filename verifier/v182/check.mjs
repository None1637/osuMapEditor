// v187: 撤销 v182 — disable-frame-rate-limit 在部分机器上导致合成器非节流连发, 帧率暴跌;
// 原生 rAF 本身跟随显示器 vsync, 不需要帧率开关
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
let failures = 0;
const ok = (cond, label) => { console.log(cond ? 'PASS' : 'FAIL', label); if (!cond) failures++; };

const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
ok(!/appendSwitch\("disable-frame-rate-limit"\)/.test(main), 'main.cjs: disable-frame-rate-limit 开关已移除 (v187 撤销 v182)');
ok(!/app\.disableHardwareAcceleration\(/.test(main), '未禁用硬件加速 (rAF 需 GPU vsync 同步)');
ok(/v187: 撤销 v182/.test(main), 'v187 撤销注释');

// 渲染循环为 rAF 驱动 (跟随 vsync), 无定时器回退
const ec = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
const tl = fs.readFileSync(path.join(root, 'src/components/Timelines.tsx'), 'utf8');
ok(/requestAnimationFrame\(loop\)/.test(ec), 'EditorCanvas 播放循环 = rAF');
ok(/requestAnimationFrame\(draw\)/.test(tl), 'Timelines 绘制循环 = rAF');
ok(!/setInterval\([^,]*loop|setTimeout\(loop/.test(ec), 'EditorCanvas 无定时器驱动渲染');

console.log(failures ? `FAILURES: ${failures}` : 'ALL_OK');
if (failures) process.exit(1);
