// 验证器 v288: 游玩击打键 (Z/X) 加入快捷键设置界面 (可改键)
// 依据: 用户要求 Z/X 可自定义; hotkeys.ts 新增 test-hit-1/test-hit-2 (默认 Z/X) +
//   matchesHotkey 助手 (与 findHotkeyAction 同一匹配规则); TestPlayOverlay 击打判定改走注册表,
//   按住状态改计数 (双键同按不互相清) + blur 清零; 顶部提示动态显示当前绑定。
//   鼠标左键为鼠标事件, 无法作为键盘组合改键 — 固定不可改 (注释注明)。
// 运行: node verifier/v288/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v288/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v288/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V288_TESTS_*)
fs.unlinkSync(out);

const hk = readSrc('src/osu/hotkeys.ts');
assert(/id: 'test-hit-1'[\s\S]*?defaults: \['Z', 'MouseLeft'\]/.test(hk), "test-hit-1 注册 (默认 Z/鼠标左键, v289)");
assert(/id: 'test-hit-2'[\s\S]*?defaults: \['X'\]/.test(hk), "test-hit-2 注册 (默认 X)");
assert(/export function matchesHotkey/.test(hk), 'matchesHotkey 助手导出');

const ov = readSrc('src/components/TestPlayOverlay.tsx');
assert(/matchesHotkey\(e, 'test-hit-1'\) \|\| matchesHotkey\(e, 'test-hit-2'\)/.test(ov), '击打判定走注册表');
assert(/heldRef\.current\.keys\+\+/.test(ov) && /keys - 1/.test(ov), '按住状态计数 (双键不互清)');
assert(/addEventListener\('blur', onBlur\)/.test(ov), '失焦清零防卡住');
assert(/formatCombo\(effectiveBindings\('test-hit-1'\)/.test(ov), '提示动态显示当前绑定');

if (failures) { console.error(`\nV288_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV288_ALL_PASSED');
