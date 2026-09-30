// v286 数值测试: 快捷键注册表 + 自定义改键
// 组合键规范化 / 派发匹配 (带修饰精确, 无修饰忽略 Shift) / 覆盖语义 / 冲突检测 / Electron accelerator
import {
  HOTKEY_ACTIONS, comboFromEvent, findHotkeyAction, findConflict,
  effectiveBindings, setHotkeyOverride, resetAllHotkeys, toElectronAccel, formatCombo,
} from '../../src/osu/hotkeys';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
const ev = (key: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean }> = {}) => ({
  key, ctrlKey: !!mods.ctrl, metaKey: false, altKey: !!mods.alt, shiftKey: !!mods.shift,
});

// comboFromEvent 规范化
assert(comboFromEvent(ev('s', { ctrl: true })) === 'Ctrl+S', 'ctrl+s → Ctrl+S (字母大写)');
assert(comboFromEvent(ev('S', { ctrl: true, shift: true })) === 'Ctrl+Shift+S', '修饰序 Ctrl→Shift');
assert(comboFromEvent(ev(' ')) === 'Space', '空格 → Space');
assert(comboFromEvent(ev(',')) === ',', '标点原样 (,)');
assert(comboFromEvent(ev('Control', { ctrl: true })) === null, '纯修饰键 → null');
assert(comboFromEvent(ev('q', { shift: true })) === 'Shift+Q', 'shift+q → Shift+Q');

// 派发匹配
assert(findHotkeyAction(ev(' ')) === 'play-pause', '空格 → play-pause');
assert(findHotkeyAction(ev('s', { ctrl: true })) === 'save', 'Ctrl+S → save');
assert(findHotkeyAction(ev('s', { ctrl: true, shift: true })) === 'open-scale', 'Ctrl+Shift+S → open-scale (不是 save)');
assert(findHotkeyAction(ev('1')) === 'tool-select', '1 → tool-select');
assert(findHotkeyAction(ev('1', { ctrl: true })) === null, 'Ctrl+1 → null (带修饰不误触工具切换)');
assert(findHotkeyAction(ev('q', { shift: true })) === 'hs-newcombo', 'Shift+Q → hs-newcombo (无修饰绑定忽略 Shift, 旧行为)');
assert(findHotkeyAction(ev('ArrowLeft')) === 'seek-left', '← → seek-left');
assert(findHotkeyAction(ev('ArrowLeft', { shift: true })) === 'seek-left', 'Shift+← → seek-left (e.shiftKey 仍可读=4拍)');
assert(findHotkeyAction(ev('Delete')) === 'delete', 'Delete → delete');
assert(findHotkeyAction(ev('Backspace')) === 'delete', 'Backspace → delete');
assert(findHotkeyAction(ev('z', { ctrl: true, shift: true })) === 'redo', 'Ctrl+Shift+Z → redo (次默认键)');
assert(findHotkeyAction(ev('F6')) === 'timing-open-settings', 'F6 → timing-open-settings');

// 覆盖语义: 改键替换全部默认键
setHotkeyOverride('delete', 'X');
assert(findHotkeyAction(ev('x')) === 'delete', '改键后 X → delete');
assert(findHotkeyAction(ev('Delete')) === null, '改键后 Delete 不再触发');
assert(findHotkeyAction(ev('Backspace')) === null, '改键后 Backspace 不再触发 (覆盖替换全部默认)');
assert(effectiveBindings('delete').join() === 'X', 'effectiveBindings 只余覆盖键');
setHotkeyOverride('delete', null);
assert(findHotkeyAction(ev('Delete')) === 'delete' && findHotkeyAction(ev('Backspace')) === 'delete', '重置后恢复双默认键');

// 冲突检测 (含无修饰 Shift 松弛)
assert(findConflict('Ctrl+S', 'open-scale') === 'save', 'Ctrl+S 冲突 save');
assert(findConflict('Ctrl+S', 'save') === null, '自身不算冲突');
assert(findConflict('Q', 'hs-whistle') === 'hs-newcombo', 'Q 冲突 hs-newcombo');
assert(findConflict('Shift+Q', 'hs-whistle') === 'hs-newcombo', 'Shift+Q 也冲突 hs-newcombo (Shift 松弛)');
assert(findConflict('F9', 'save') === null, 'F9 无冲突');

// Electron accelerator + 展示名
assert(toElectronAccel('Ctrl+S') === 'CmdOrCtrl+S', 'Ctrl → CmdOrCtrl');
assert(toElectronAccel('F6') === 'F6', '单键原样');
assert(formatCombo('Space') === '空格', '展示: Space→空格');
assert(formatCombo('Ctrl+Delete') === 'Ctrl+Del', '展示: Delete→Del');

resetAllHotkeys();
assert(HOTKEY_ACTIONS.length >= 40, `注册表动作数 (${HOTKEY_ACTIONS.length}) ≥ 40`);

if (failures) { console.error(`\nV286_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV286_TESTS_PASSED');
