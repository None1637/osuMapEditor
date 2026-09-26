// v282: 缩放支持仅X轴/仅Y轴 (用户反馈截图: 缩放窗口单一倍率 → 需分轴)
// 实现:
//   · transform.ts scaleObjects(objs, c, sx, sy=sx) — 非等比缩放; 滑条 pixelLength 系数:
//     等比=s; 仅单轴 (另一轴=1) = 该轴系数; 两轴不同且都≠1 = 几何平均 √(sx·sy) (近似)
//   · store.scaleSelected(sx, sy, origin) — 兼容旧调用 scaleSelected(s, origin)
//   · Inspector 左侧栏 + TransformDialog 缩放窗口: 倍率改为 x/y 两个输入框 (仅X: y填1; 仅Y: x填1)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failures = 0;
function assert(cond, label) {
  if (cond) { console.log(`  PASS ${label}`); }
  else { failures++; console.error(`  FAIL ${label}`); }
}

const tf = fs.readFileSync(path.join(root, 'src/osu/transform.ts'), 'utf8');
assert(/scaleObjects\(objs: HitObject\[\], c: Pt, sx: number, sy: number = sx\)/.test(tf), 'scaleObjects 支持 sx/sy 分轴 (sy 缺省=sx 兼容)');
assert(/p\.x - c\.x\) \* sx/.test(tf) && /p\.y - c\.y\) \* sy/.test(tf), '点变换分轴乘系数');
assert(/Math\.sqrt\(sx \* sy\)/.test(tf), '两轴都不同 → 长度按几何平均近似');

const store = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
assert(/scaleSelected\(sx: number, sy: number \| TransformOrigin = sx, origin: TransformOrigin = 'selection'\)/.test(store), 'store.scaleSelected 支持 (sx, sy, origin)');
assert(/typeof sy !== 'number'/.test(store), '兼容旧调用 scaleSelected(s, origin)');

const insp = fs.readFileSync(path.join(root, 'src/components/Inspector.tsx'), 'utf8');
assert(/testid="factor-y"/.test(insp), 'Inspector 缩放行含 y 倍率输入框');
assert(/scaleSelected\(factor, factorY, origin\)/.test(insp), 'Inspector 应用倍率传双轴');

const dlg = fs.readFileSync(path.join(root, 'src/components/TransformDialog.tsx'), 'utf8');
assert(/testid="factor-y"/.test(dlg), '缩放窗口含 y 倍率输入框');
assert(/scaleSelected\(factor, factorY, origin\)/.test(dlg), '缩放窗口应用倍率传双轴');

if (failures) { console.error(`\nV282_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV282_ALL_PASSED');
