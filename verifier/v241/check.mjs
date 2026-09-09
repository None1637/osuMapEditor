// 验证器 v241: 放置态 — 放置工具下 Q/W/E/R 预设下次放下物件的 newCombo/hitsound。
// 需求: 放置物件前按 Q 将下次放下的物件设为 new combo; W/E/R 为下次放置的物件增加音效。
// 实现: store.placeNewCombo/placeHitSound + toggle 方法; App.tsx 快捷键按 store.tool 分流
//   (放置工具 → 放置态; select → 选中物件/时间轴节点 v213 原语义);
//   EditorCanvas 四处放置点 (circle/finishSlider/finishFreehandSlider/finishSpinner) 读放置态
//   (slider/spinner 原硬编码 NC=true 移除, 统一由放置态决定); 左栏工具区显示放置态指示 (v244 起移到右侧栏顶部且始终显示)。
// 运行: node verifier/v241/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

console.log('== store.ts: 放置态字段 + toggle');
{
  const src = readSrc('src/osu/store.ts');
  assert(/placeNewCombo = false;/.test(src) && /placeHitSound = 0;/.test(src), 'placeNewCombo/placeHitSound 默认关闭');
  assert(/togglePlaceNewCombo\(\) \{ this\.placeNewCombo = !this\.placeNewCombo/.test(src), 'togglePlaceNewCombo');
  assert(/togglePlaceHitSound\(bit: number\) \{ this\.placeHitSound \^= bit/.test(src), 'togglePlaceHitSound (位异或)');
}

console.log('== App.tsx: 快捷键按工具分流 + 放置态指示 (v244: 右栏顶部, 始终显示)');
{
  const src = readSrc('src/App.tsx');
  assert(/if \(store\.tool !== 'select'\) \{\s*if \(k === 'q'\) \{ store\.togglePlaceNewCombo\(\); return; \}/.test(src), '放置工具: Q → 放置态 NC');
  assert(/if \(k === 'w'\) \{ store\.togglePlaceHitSound\(2\); return; \}/.test(src)
    && /if \(k === 'e'\) \{ store\.togglePlaceHitSound\(4\); return; \}/.test(src)
    && /if \(k === 'r'\) \{ store\.togglePlaceHitSound\(8\); return; \}/.test(src), '放置工具: W/E/R → 放置态音效位');
  assert(/store\.toggleSelectedNewCombo\(\)/.test(src) && /store\.toggleEdgeHitSound/.test(src), 'select 工具原语义保留 (选中物件/节点)');
  assert(/store\.placeNewCombo \? 'text-pink-300/.test(src) && /NC\(Q\)/.test(src), '放置态指示 (v244 起在右栏顶部)');
}

console.log('== EditorCanvas.tsx: 四处放置点读放置态 + NC 消费复位');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  const n = (src.match(/newCombo: store\.placeNewCombo, comboSkip: 0, hitSound: store\.placeHitSound/g) || []).length;
  assert(n === 4, `circle/finishSlider/finishFreehandSlider/finishSpinner 四处 (实际 ${n})`);
  const c = (src.match(/store\.placeNewCombo = false; \/\/ v241: NC 仅一次/g) || []).length;
  assert(c === 4, `NC 仅一次: 四处放置后复位 (实际 ${c}); W/E/R 音效位无复位代码`);
  assert(!/newCombo: true, comboSkip: 0, hitSound: 0,/.test(src), 'slider/spinner 硬编码 NC=true 已移除');
}

if (failures) { console.error(`\nV241_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV241_ALL_PASSED');
