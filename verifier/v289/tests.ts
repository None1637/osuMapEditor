// v289 数值测试: 鼠标按键组合键 (comboFromMouseEvent/isMouseCombo/matchesHotkeyMouse) +
//   游玩击打键默认含鼠标左键 + test-exit 注册 (默认 Escape)
import {
  HOTKEY_ACTIONS, comboFromMouseEvent, isMouseCombo, matchesHotkeyMouse,
  matchesHotkey, setHotkeyOverride, resetAllHotkeys, effectiveBindings, formatCombo,
} from '../../src/osu/hotkeys';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
const mev = (button: number, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean }> = {}) => ({
  button, ctrlKey: !!mods.ctrl, metaKey: false, altKey: !!mods.alt, shiftKey: !!mods.shift,
});
const kev = (key: string) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });

// comboFromMouseEvent
assert(comboFromMouseEvent(mev(0)) === 'MouseLeft', 'button 0 → MouseLeft');
assert(comboFromMouseEvent(mev(1)) === 'MouseMiddle', 'button 1 → MouseMiddle');
assert(comboFromMouseEvent(mev(2, { ctrl: true })) === 'Ctrl+MouseRight', 'Ctrl+右键 → Ctrl+MouseRight');
assert(comboFromMouseEvent(mev(3, { shift: true })) === 'Shift+Mouse4', 'Shift+侧键 → Shift+Mouse4');
assert(comboFromMouseEvent(mev(5)) === null, '未知 button 返回 null');

// isMouseCombo
assert(isMouseCombo('MouseLeft') && isMouseCombo('Ctrl+MouseRight'), '鼠标组合识别');
assert(!isMouseCombo('Ctrl+Z') && !isMouseCombo('MouseA'), '键盘组合不误判');

// 击打键默认含鼠标左键
assert(effectiveBindings('test-hit-1').includes('MouseLeft'), 'test-hit-1 默认含 MouseLeft');
assert(matchesHotkeyMouse(mev(0), 'test-hit-1'), '左键默认命中 test-hit-1');
assert(matchesHotkeyMouse(mev(0, { shift: true }), 'test-hit-1'), 'Shift+左键松弛命中 (无修饰绑定忽略 Shift)');
assert(!matchesHotkeyMouse(mev(0, { ctrl: true }), 'test-hit-1'), 'Ctrl+左键不命中 (带修饰精确)');
assert(!matchesHotkeyMouse(mev(0), 'test-hit-2'), '左键不串到 test-hit-2');

// 改键覆盖鼠标绑定
setHotkeyOverride('test-hit-1', 'A');
assert(!matchesHotkeyMouse(mev(0), 'test-hit-1'), '改键 A 后左键失效');
assert(matchesHotkey(kev('a'), 'test-hit-1'), '改键 A 后 a 生效');
resetAllHotkeys();
assert(matchesHotkeyMouse(mev(0), 'test-hit-1'), '重置后左键恢复');

// test-exit 注册
const exit = HOTKEY_ACTIONS.find(a => a.id === 'test-exit');
assert(!!exit && exit!.defaults.includes('Escape') && exit!.category === '测试游玩', 'test-exit 注册 (默认 Escape, 测试游玩分类)');
assert(matchesHotkey(kev('Escape'), 'test-exit'), 'Escape 命中 test-exit');

// 中文显示名
assert(formatCombo('MouseLeft') === '鼠标左键', 'MouseLeft 显示 鼠标左键');
assert(formatCombo('Ctrl+MouseRight') === 'Ctrl+鼠标右键', 'Ctrl+MouseRight 显示 Ctrl+鼠标右键');

if (failures) { console.error(`\nV289_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV289_TESTS_PASSED');
