// v288 数值测试: 游玩击打键 (Z/X) 注册进快捷键表 + matchesHotkey 匹配/改键生效
import { matchesHotkey, setHotkeyOverride, resetAllHotkeys, effectiveBindings } from '../../src/osu/hotkeys';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
const ev = (key: string, mods: Partial<{ ctrl: boolean; shift: boolean }> = {}) => ({
  key, ctrlKey: !!mods.ctrl, metaKey: false, altKey: false, shiftKey: !!mods.shift,
});

// 默认 Z/X
assert(matchesHotkey(ev('z'), 'test-hit-1'), 'z → test-hit-1');
assert(matchesHotkey(ev('x'), 'test-hit-2'), 'x → test-hit-2');
assert(!matchesHotkey(ev('z'), 'test-hit-2') && !matchesHotkey(ev('x'), 'test-hit-1'), '两键互不串');
assert(matchesHotkey(ev('Z', { shift: true }), 'test-hit-1'), 'Shift+Z 等效 (无修饰绑定忽略 Shift)');
assert(!matchesHotkey(ev('z', { ctrl: true }), 'test-hit-1'), 'Ctrl+Z 不触击打键 (带修饰精确)');

// 改键生效 (覆盖语义)
setHotkeyOverride('test-hit-1', 'A');
assert(matchesHotkey(ev('a'), 'test-hit-1') && !matchesHotkey(ev('z'), 'test-hit-1'), '改键 A 后 z 失效 a 生效');
assert(effectiveBindings('test-hit-1').join() === 'A', 'effectiveBindings 只余覆盖键');
assert(matchesHotkey(ev('x'), 'test-hit-2'), 'test-hit-2 不受影响');
resetAllHotkeys();
assert(matchesHotkey(ev('z'), 'test-hit-1'), '重置后恢复 Z');

if (failures) { console.error(`\nV288_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV288_TESTS_PASSED');
