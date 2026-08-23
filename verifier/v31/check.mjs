// 验证器 v31: 上方时间轴物件 combo 染色 + 滑条尾端圆 + 右键删除物件
// 运行: cd app && node verifier/v31/check.mjs; node verifier/v31/cdp-timeline.mjs (需 7100 dev server)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('Timelines.tsx: v31 时间轴增强');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/import \{[^}]*computeCombos, comboColor, invalidatePath[^}]*\} from '@\/osu\/renderer'/.test(src), '引入 comboColor/invalidatePath');
  assert(/comboColor\(bm, displaySettings\.skinColors \? ci\.combo : ci\.comboWithOffset/.test(src), '物件按 combo 染色 (不再固定灰; v132 起第三参为皮肤颜色开关 override; v201 皮肤色用 combo 谱面色用 WithOffsets)');
  assert(src.includes('mixDark') && src.includes('alphaOf'), '染色混色助手 (填充混深底 / 连体条半透明)');
  assert(/尾端圆[\s\S]*?arc\(ex, cy, rad,/.test(src), '滑条尾端圆 (与头圆同径; v83 起在共用 drawTimelineObject 内)');
  assert(/onContextMenu=\{[\s\S]*?hitTestMarker\(e\)[\s\S]*?filter\(o => o\.id !== id\)[\s\S]*?store\.emit\(\)/.test(src),
    '右键时间轴物件 -> 删除 + undo + emit');
}

if (failures) { console.error(`\nVERIFIER_V31_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V31_ALL_TESTS_PASSED');
