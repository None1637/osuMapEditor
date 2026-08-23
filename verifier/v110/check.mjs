// v110 源码接线断言 (v127 重写): 原「工具栏加高 h-12 对齐波形面板」语义随 v127 整体作废 —
// 顶部标题行已删除 (无实际功能), WaveformPanel 悬浮窗也已废弃 (波形画在 TopTimeline 内, 无需对齐)。
// 保留仍有效的部分: v111 谱面信息/保存反馈在游玩区左下角
// 运行: node verifier/v110/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const app = read('src/App.tsx');

assert(!/h-12 bg-\[#1a1a22\]/.test(app) && !/osu! 谱面编辑器/.test(app), 'v127: h-12 标题行已删除 (加高对齐失去对象)');
assert(!fs.existsSync(path.join(root, 'src/components/WaveformPanel.tsx')), 'v127: WaveformPanel 已删除 (对齐目标不再存在)');
// v184 适配: 谱面信息移到页签栏 (song setup 左侧, flex-1 居中容器), data-save-message 在名称 Label 行
assert(/flex-1 flex items-center justify-center gap-2 min-w-0 pointer-events-none[\s\S]*data-save-message/.test(app), 'v111: 谱面信息/保存反馈 (v184: 页签栏 song setup 左侧居中容器)');

console.log(failures ? '\nV110_CHECK_FAILED: ' + failures : '\nV110_CHECK_PASSED');
process.exit(failures ? 1 : 0);
