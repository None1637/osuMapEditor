// 验证器 v24: hitsound 快捷键 (Q/W/E/R) + Inspector hitsound 编辑
// 运行: cd app && node verifier/v24/check.mjs; node verifier/v24/cdp-hitsound.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v24/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v24/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// 纯函数测试 (hitSound 位 toggle / hitSample 编辑 / 序列化往返)
await import('file://' + out);
fs.unlinkSync(out);

// ---- 源码接线断言 ----
section('hitSounds.ts: hitSample 编辑辅助函数');
{
  const src = readSrc('src/osu/clock/hitSounds.ts');
  assert(src.includes('export function hitSampleFilename'), '导出 hitSampleFilename');
  assert(src.includes('export function buildHitSampleRaw'), '导出 buildHitSampleRaw');
  assert(/buildHitSampleRaw[\s\S]*?return undefined/.test(src), '全默认无 filename -> undefined (序列化省略 hitSample 字段)');
}

section('store.ts: 选区 hitsound/newCombo 方法 (一次操作一次 undo)');
{
  const src = readSrc('src/osu/store.ts');
  assert(src.includes('toggleSelectedHitSound(bit: number)'), 'toggleSelectedHitSound 方法');
  assert(src.includes('toggleSelectedNewCombo()'), 'toggleSelectedNewCombo 方法');
  assert(src.includes('setSelectedHitSoundBit(bit: number, on: boolean)'), 'setSelectedHitSoundBit 方法 (Inspector checkbox)');
  assert(src.includes('applyHitSampleToSelected(patch: Partial<HitSample>)'), 'applyHitSampleToSelected 方法');
  const apply = src.match(/private applyToSelected[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(apply.includes('pushUndo()'), '批量编辑一次操作一次 undo 快照');
  assert(apply.includes('this.emit()'), 'emit() bump dataVersion -> hitsound 事件表自动重建');
  assert(!apply.includes('invalidatePath'), 'hitsound 编辑不失效滑条几何缓存 (没改几何)');
  // v114: 逐物件取反 (!o.newCombo) 改为三态统一置位 (o.newCombo = on, lazer DrawableTernaryButton.Toggle) — 意图不变: 只动 newCombo, ComboSkip 不动
  assert(/toggleSelectedNewCombo[\s\S]*?o\.newCombo = on;/.test(src), 'Q 只切 newCombo 位 (ComboSkip 不动; v114 三态语义)');
}

section('App.tsx: Q/W/E/R 快捷键注册');
{
  const src = readSrc('src/App.tsx');
  assert(src.includes('store.toggleSelectedNewCombo()'), 'Q -> toggleSelectedNewCombo');
  // v213 适配: W/E/R 经 hs() 路由 (选中滑条节点 → toggleEdgeHitSound, 否则物件级 toggleSelectedHitSound)
  assert(src.includes('hs(2)') && src.includes('toggleSelectedHitSound(b)'), 'W -> whistle(2) (v213: 经 hs 路由)');
  assert(src.includes('hs(4)'), 'E -> finish(4) (v213: 经 hs 路由)');
  assert(src.includes('hs(8)'), 'R -> clap(8) (v213: 经 hs 路由)');
  const block = src.match(/if \(!e\.ctrlKey && !e\.metaKey && !e\.altKey\)[\s\S]*?\n      \}/)?.[0] ?? '';
  assert(block.includes("k === 'q'") && block.includes("k === 'w'") && block.includes("k === 'e'") && block.includes("k === 'r'"), 'Q/W/E/R 在无修饰键分支内 (不与 Ctrl 系冲突)');
  assert(src.indexOf("tag === 'INPUT'") < src.indexOf("k === 'q'"), '输入框焦点 guard 在快捷键之前 (输入框聚焦时不触发)');
  assert(src.includes('Q/W/E/R'), '快捷键帮助面板列出 Q/W/E/R');
}

section('Inspector.tsx: hitsound 区块');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert(src.includes('HitSoundPanel'), 'HitSoundPanel 组件');
  assert(src.includes('setSelectedHitSoundBit'), 'checkbox 批量置位/清位');
  assert(src.includes('applyHitSampleToSelected'), 'hitSample 批量应用');
  assert(src.includes("bit={2}") && src.includes("bit={4}") && src.includes("bit={8}"), 'whistle/finish/clap 三个 checkbox');
  assert(src.includes("field: 'normalSet' | 'additionSet'"), 'normalSet/additionSet 下拉');
  assert(src.includes("field: 'customIndex' | 'volume'"), 'customIndex/volume 数字输入');
  assert(/clamp=\{v => v <= 0 \? 0 : Math\.min\(100, Math\.max\(5/.test(src), '音量 0=继承, 否则钳制 5~100');
  const multi = src.match(/if \(sel\.length !== 1\)[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(multi.includes('HitSoundPanel'), '多选时 hitsound 区块可用 (批量应用)');
  assert(src.includes('data-hs'), 'CDP 可定位的 data-hs 标记');
}

if (failures) { console.error(`\nVERIFIER_V24_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V24_ALL_TESTS_PASSED');
