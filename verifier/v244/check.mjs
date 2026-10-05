// 验证器 v244: 放置态 (Q/W/E/R 预设) UI 移到右侧栏顶部且始终显示。
// 需求: 将放置态 Q/W/E/R 预设下次放置物件的 UI 移到右侧栏顶部且始终显示。
// 实现 (src/App.tsx): 左栏工具区的 v241 放置态指示行 (仅放置工具时显示) 移除,
//   同款指示块改挂右侧栏 <Inspector /> 之前 (border-b 分隔), 不再按 store.tool 条件渲染。
// 运行: node verifier/v244/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const src = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

console.log('== 右栏顶部放置态指示 (始终显示)');
{
  // 指示块在 <Inspector /> 之前 (右侧栏容器内)
  // v346 i18n 改造后: title 走 t('app.placement_state_title', ...), 口哨/拍手走 t('app.hs_whistle'/'app.hs_clap')
  const blockIdx = src.indexOf("t('app.placement_state_title'");
  const inspIdx = src.indexOf('<Inspector />');
  assert(blockIdx > -1 && inspIdx > -1 && blockIdx < inspIdx, '放置态指示块位于 <Inspector /> 之前 (右栏顶部, i18n key app.placement_state_title)');
  assert(/v244: 放置态指示移到右侧栏顶部且始终显示/.test(src), 'v244 注释');
  const dict = fs.readFileSync(path.join(root, 'src/i18n/dicts/zh-CN/app.ts'), 'utf8');
  assert(/NC\(\{hotkeyLabel\('hs-newcombo'\)\}\)/.test(src)
    && /t\('app\.hs_whistle', 'Whistle'\)\}\(\{hotkeyLabel\('hs-whistle'\)\}\)/.test(src)
    && /Finish\(\{hotkeyLabel\('hs-finish'\)\}\)/.test(src)
    && /t\('app\.hs_clap', 'Clap'\)\}\(\{hotkeyLabel\('hs-clap'\)\}\)/.test(src)
    && dict.includes("'app.hs_whistle': '口哨'") && dict.includes("'app.hs_clap': '拍手'"),
    '四个状态项齐全 (v321: 键位经 hotkeyLabel 动态; v346: 口哨/拍手经 i18n key, zh-CN 译文正确)');
  assert(/store\.placeNewCombo \? 'text-pink-300/.test(src)
    && /store\.placeHitSound & 2/.test(src) && /store\.placeHitSound & 4/.test(src) && /store\.placeHitSound & 8/.test(src),
    '高亮逻辑不变 (NC + 三个音效位)');
}

console.log('== 左栏旧指示已移除 (不再按工具条件渲染)');
{
  assert(!/store\.tool !== 'select' && \([\s\S]{0,600}NC\(\{hotkeyLabel/.test(src), '左栏 v241 条件块 (store.tool !== select 包裹 NC 指示) 已移除');
  // 指示块仅剩一处 (右栏)
  const n = (src.match(/NC\(\{hotkeyLabel\('hs-newcombo'\)\}\)/g) || []).length;
  assert(n === 1, `NC 指示仅剩 1 处 (实际 ${n})`);
}

if (failures) { console.error(`\nV244_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV244_ALL_PASSED');
