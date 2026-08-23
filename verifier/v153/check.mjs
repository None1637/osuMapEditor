// 验证器 v153: 快捷键 V — 跳转到最后一个物件的时间位置 (源码接线断言, 无纯函数)
// 运行: node verifier/v153/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }

const src = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

section('App.tsx: V 键跳转最后物件');
{
  // 无修饰键块内 (与 Q/W/E/R/J/K 同块, 即 !ctrl && !meta && !alt)
  const noModIdx = src.indexOf('if (!e.ctrlKey && !e.metaKey && !e.altKey)');
  const vIdx = src.indexOf("k === 'v'");
  assert(noModIdx > 0 && vIdx > noModIdx, 'V 在无修饰键块内 (不与 Ctrl+V 粘贴冲突)');
  const blk = src.slice(vIdx, vIdx + 400); // 含空谱面守卫 return + seek 行
  assert(/store\.beatmap; if \(!bm \|\| bm\.hitObjects\.length === 0\) return;/.test(blk), '无谱面/无物件时不动作');
  assert(/store\.seek\(Math\.max\(\.\.\.bm\.hitObjects\.map\(o => o\.time\)\)\)/.test(blk), 'seek 到最后物件 time (Math.max 不假定有序)');
  // 输入框/面板守卫在该键之前已存在 (回归确认)
  const guardIdx = src.indexOf("if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;");
  assert(guardIdx > 0 && guardIdx < vIdx, '输入框聚焦守卫在 V 处理之前');
  const modalGuard = src.indexOf('if (showLibrary || showSkin) return;');
  assert(modalGuard > 0 && modalGuard < vIdx, '曲库/皮肤面板打开守卫在 V 处理之前');
}

section('快捷键帮助列表');
{
  assert(/<div>V 跳到最后一个物件<\/div>/.test(src), '帮助列表含 V 条目 (紧跟 J/K 条目)');
}

if (failures) { console.error(`\nV153_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV153_ALL_PASSED');
