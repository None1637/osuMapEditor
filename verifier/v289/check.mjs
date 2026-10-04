// 验证器 v289: 鼠标按键加入快捷键面板 + 全部按键纳入注册表的规则落地
// 依据: 用户要求「本项目的所有按键都需要加入快捷键设置界面, 鼠标也得加入快捷键面板」。
//   hotkeys.ts 新增鼠标组合体系 (comboFromMouseEvent/isMouseCombo/matchesHotkeyMouse/MOUSE_BUTTON_TOKENS),
//   游玩击打键 1 默认绑定加入 MouseLeft, 新增 test-exit (默认 Escape); pushMenuAccels 跳过鼠标组合
//   (Electron accelerator 不支持鼠标按键); formatCombo 补鼠标中文名。
//   HotkeyPanel 捕获态新增 mousedown/contextmenu 捕获 — 改键时可录入鼠标按键。
//   TestPlayOverlay 击打判定加 isHitButton (matchesHotkeyMouse), mouse 按住状态由布尔改计数,
//   退出键由硬编码 Escape 改走 test-exit 注册表, 顶部提示动态显示。
//   AGENTS.md 追加「快捷键注册规则 (v289)」节, 规定新快捷键必须注册进 HOTKEY_ACTIONS。
// 运行: node verifier/v289/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v289/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v289/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V289_TESTS_*)
fs.unlinkSync(out);

const hk = readSrc('src/osu/hotkeys.ts');
assert(/const MOUSE_BUTTON_TOKENS/.test(hk), 'MOUSE_BUTTON_TOKENS 映射表');
assert(/export function comboFromMouseEvent/.test(hk), 'comboFromMouseEvent 导出');
assert(/export function isMouseCombo/.test(hk), 'isMouseCombo 导出');
assert(/export function matchesHotkeyMouse/.test(hk), 'matchesHotkeyMouse 导出');
assert(/id: 'test-exit'[\s\S]*?defaults: \['Escape'\]/.test(hk), 'test-exit 注册 (默认 Escape)');
assert(/if \(isMouseCombo\(b\) \|\| isWheelCombo\(b\)\) continue/.test(hk), 'pushMenuAccels 跳过鼠标组合 (非法 Electron accelerator; v330: 滚轮同跳)');
assert(/MouseLeft: '鼠标左键'/.test(hk), 'formatCombo 鼠标中文名');

const panel = readSrc('src/components/HotkeyPanel.tsx');
assert(/comboFromMouseEvent/.test(panel), 'HotkeyPanel: 捕获态录入鼠标按键');
assert(/addEventListener\('mousedown', onMouse, true\)/.test(panel), 'HotkeyPanel: mousedown 捕获监听');
assert(/addEventListener\('contextmenu', onCtx, true\)/.test(panel), 'HotkeyPanel: 右键改键时抑制上下文菜单');
assert(/按任意键\/鼠标键\/滚轮… Esc取消/.test(panel), 'HotkeyPanel: 捕获提示含鼠标键 (v330: 含滚轮)');

const ov = readSrc('src/components/TestPlayOverlay.tsx');
assert(/matchesHotkeyMouse\(e, 'test-hit-1'\) \|\| matchesHotkeyMouse\(e, 'test-hit-2'\)/.test(ov), '鼠标击打判定走注册表 (isHitButton)');
assert(/matchesHotkey\(e, 'test-exit'\)/.test(ov), '退出键走 test-exit 注册表');
assert(/heldRef\.current\.mouse\+\+/.test(ov) && /mouse - 1/.test(ov), '鼠标按住状态计数 (多键不互清)');
assert(/heldRef\.current\.mouse = 0/.test(ov), '失焦鼠标计数清零');
assert(/formatCombo\(effectiveBindings\('test-exit'\)/.test(ov), '提示动态显示退出键绑定');

const agents = readSrc('AGENTS.md');
assert(/快捷键注册规则 \(v289\)/.test(agents), 'AGENTS.md: 快捷键注册规则落地');

if (failures) { console.error(`\nV289_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV289_ALL_PASSED');
