// 验证器 v242: 转换窗口关闭时保存参数 (不再仅在应用时保存)。
// 需求: 批量复制等窗口应该在关闭时保存其值, 而不是仅在应用时保存。
// 实现: DraggableDialog.tsx 新增 useSaveParamsOnClose(key, params) — ref 跟随最新值,
//   卸载 cleanup 落盘 (应用/取消/X 关窗统一覆盖); 五个转换弹窗全部接线
//   (duplicate/stream/split/polygon/symSlider); 应用按钮的即时 saveParams 保留 (双写无害)。
// 运行: node verifier/v242/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

console.log('== DraggableDialog.tsx: useSaveParamsOnClose hook');
{
  const src = readSrc('src/components/DraggableDialog.tsx');
  assert(/export function useSaveParamsOnClose<T>\(key: string, v: T\)/.test(src), 'hook 导出');
  assert(/ref\.current = v;/.test(src) && /useEffect\(\(\) => \(\) => saveParams\(key, ref\.current\), \[key\]\)/.test(src),
    'ref 跟随最新值 + 卸载 cleanup 落盘');
}

console.log('== 五个转换弹窗接线');
for (const [file, key] of [
  ['DuplicateDialog', 'duplicate'], ['StreamDialog', 'stream'], ['SplitDialog', 'split'],
  ['PolygonDialog', 'polygon'], ['SymSliderDialog', 'symSlider'],
]) {
  const src = readSrc(`src/components/convert/${file}.tsx`);
  assert(src.includes('useSaveParamsOnClose'), `${file}: 导入 hook`);
  assert(new RegExp(`useSaveParamsOnClose\\('${key}', params\\);`).test(src), `${file}: 关窗保存 '${key}'`);
}

if (failures) { console.error(`\nV242_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV242_ALL_PASSED');
