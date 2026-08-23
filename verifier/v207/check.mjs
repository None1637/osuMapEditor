// 验证器 v207: 滑条节点放置预览幻影吸附网格/辅助线 (与点击落点同公式, 所见即所放)
// 运行: node verifier/v207/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('EditorCanvas.tsx: 吸附公式收敛 + 预览共用');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const snapSliderCtrlPoint = \(p: \{ x: number; y: number \}\)/.test(src), 'snapSliderCtrlPoint 定义');
  // 公式内容与 v56 落点规则一致: 物件吸附(含辅助线 snapWithGeo) > 网格 gridSnapAt
  assert(/return gridSnapAt\(bm0, snapWithGeo\(bm0, p, snapToNearby\(p, objectSnapPoints/.test(src), '公式 = 物件/辅助线吸附 > 网格');
  // pendingCursor (上时间轴幻影) 走吸附
  assert(/store\.pendingCursor = store\.tool === 'slider' && store\.pendingSlider\.length > 0 \? snapSliderCtrlPoint\(\{ x: cp\.x, y: cp\.y \}\) : null;/.test(src),
    'pendingCursor 走 snapSliderCtrlPoint');
  // 画布渲染幻影光标走吸附后的 pendingCursor
  assert(/store\.pendingSlider\.length > 0 \? store\.pendingCursor : \{ x: cur\.x, y: cur\.y \}/.test(src),
    '画布幻影光标 = pendingCursor (已吸附)');
  // 两处落点路径同公式
  const n = (src.match(/snapSliderCtrlPoint\(p\)/g) || []).length;
  assert(n >= 2, `mousedown 落点路径用 snapSliderCtrlPoint >= 2 处 (实际 ${n})`);
}

if (failures) { console.error(`V207 FAILED: ${failures}`); process.exit(1); }
console.log('V207 ALL PASSED');
