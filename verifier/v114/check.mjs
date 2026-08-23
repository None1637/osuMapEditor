// v114 源码接线断言: 右键已选中项删整个选区 + Q/W/E/R 三态语义 (lazer DrawableTernaryButton.Toggle)
// 运行: node verifier/v114/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const store = read('src/osu/store.ts');
const tl = read('src/components/Timelines.tsx');
const cv = read('src/components/EditorCanvas.tsx');

// store: Q/W/E/R 三态语义 (依据 lazer HitObjectComposer.checkToggleMappingFromKey -> DrawableTernaryButton.Toggle: False/Indeterminate->True, True->False)
assert(/DrawableTernaryButton\.Toggle 语义/.test(store), 'store: 注释引用 lazer DrawableTernaryButton.Toggle 依据');
assert(/toggleSelectedHitSound\(bit: number\) \{[\s\S]{0,200}this\.setSelectedHitSoundBit\(bit, !objs\.every\(o => \(\(o\.hitSound \?\? 0\) & bit\) !== 0\)\);/.test(store),
  'toggleSelectedHitSound: 未全有->全部置位, 全有->全部清位 (走 setSelectedHitSoundBit)');
assert(/toggleSelectedNewCombo\(\) \{[\s\S]{0,200}const on = !objs\.every\(o => !!o\.newCombo\);[\s\S]{0,150}o\.newCombo = on;/.test(store),
  'toggleSelectedNewCombo: 同三态语义统一置 true/false');
assert(!/o\.hitSound = \(o\.hitSound \?\? 0\) \^ bit/.test(store), 'toggle: 旧的逐物件 XOR 翻转已删');

// 右键已选中项 -> 删除整个选区 (三处: 画布物件 / 时间轴物件 / 时间轴绿线)
assert(/if \(store\.selected\.has\(hit\.id\)\) \{ store\.deleteSelected\(\); return; \}/.test(cv),
  'EditorCanvas: 右键已选中物件删整个选区');
assert(/if \(store\.selected\.has\(id\)\) \{ store\.deleteSelected\(\); return; \}/.test(tl),
  'Timelines: 右键已选中物件删整个选区');
assert(/if \(store\.selectedGreenLines\.has\(t\)\) store\.deleteSelected\(\);\s*else store\.deleteGreenLinesAt\(\[t\]\);/.test(tl),
  'Timelines: 右键已选中绿线删整个选区, 未选中删该线');

// 右键未选中项保持单删 (画布/时间轴物件的旧路径仍在)
assert(/bm\.hitObjects = bm\.hitObjects\.filter\(o => o\.id !== hit\.id\)/.test(cv), 'EditorCanvas: 未选中物件单删路径保留');
assert(/bm\.hitObjects = bm\.hitObjects\.filter\(o => o\.id !== id\)/.test(tl), 'Timelines: 未选中物件单删路径保留');

console.log(failures ? `\nV114_CHECK_FAILED: ${failures}` : '\nV114_CHECK_PASSED');
process.exit(failures ? 1 : 0);
