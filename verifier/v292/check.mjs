// 验证器 v292: 快捷键设置面板字体调大
// 依据: 用户反馈「快捷键设置里的字体太小了」。
//   分类标题 10px→text-xs(12px), 动作名 11px→13px (列宽 w-40→w-44), 键位按钮/捕获提示
//   10px→text-xs(12px), 冲突提示 9px→10px, 底部说明 9px→10px / 重置按钮 10px→text-xs,
//   面板宽度 460→520 配套。
// 运行: node verifier/v292/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const hp = fs.readFileSync(path.join(root, 'src/components/HotkeyPanel.tsx'), 'utf8');
// 注: 具体字号已被 v293 继续调大 (13/14px, 宽 560), 本断言只保留"v292 起步调大"的底线 (不再 ≤11px, 宽度 ≥520)
const w = +(hp.match(/width=\{(\d+)\}/)?.[1] ?? 0);
assert(w >= 520, '面板加宽 460→520 (v293 继续加宽至 ' + w + ')');
assert(!/text-\[9px\]/.test(hp), '面板内不再有 9px 文本 (v292 底线; ≤10px 由 v293 消除, 11px 提示文本保留)');
assert(/font-mono/.test(hp) && /hotkey-list/.test(hp), '面板结构存在');

if (failures) { console.error(`\nV292_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV292_ALL_PASSED');
