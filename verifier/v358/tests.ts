// v358 数据层断言: 多键绑定 (覆盖为组合键数组, 兼容旧单串; 数组每个键都参与匹配)
import {
  effectiveBindings, setHotkeyOverride, resetAllHotkeys, matchesHotkey, matchesHotkeyWheel,
  findConflict, HOTKEY_ACTIONS,
} from '../../src/osu/hotkeys';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

resetAllHotkeys();

// 默认多键动作 (delete: Delete + Backspace) 保持
assert(effectiveBindings('delete').join() === 'Delete,Backspace', '默认多键保持');

// 单串覆盖 (v286 旧调用形态) 仍等价单元素数组
setHotkeyOverride('delete', 'X');
assert(effectiveBindings('delete').join() === 'X', '单串覆盖兼容');
setHotkeyOverride('delete', null);

// 数组覆盖: 自定义也可绑多个键, 每个键都命中
setHotkeyOverride('delete', ['F9', 'Ctrl+F10', 'Mouse4']);
assert(effectiveBindings('delete').join() === 'F9,Ctrl+F10,Mouse4', '数组覆盖生效');
assert(matchesHotkey({ key: 'F9', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, 'delete'), '数组键 1 命中');
assert(matchesHotkey({ key: 'F10', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, 'delete'), '数组键 2 命中');
assert(!matchesHotkey({ key: 'Delete', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, 'delete'), '覆盖替换默认键 (Delete 不再删除)');
assert(findConflict('F9', 'copy') === 'delete', '数组键参与冲突检测');
setHotkeyOverride('delete', null);
assert(effectiveBindings('delete').join() === 'Delete,Backspace', '清除覆盖恢复默认');

// timeline-zoom-wheel 动作: 默认 Alt+Wheel + Ctrl+Wheel, 两键都命中
const tl = HOTKEY_ACTIONS.find(a => a.id === 'timeline-zoom-wheel');
assert(!!tl && tl.defaults.join() === 'Alt+Wheel,Ctrl+Wheel', 'timeline-zoom-wheel 默认双键 (stable Alt+滚轮 + 旧 Ctrl+滚轮)');
assert(matchesHotkeyWheel({ ctrlKey: false, metaKey: false, altKey: true, shiftKey: false }, 'timeline-zoom-wheel'), 'Alt+Wheel 命中时间轴缩放');
assert(matchesHotkeyWheel({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, 'timeline-zoom-wheel'), 'Ctrl+Wheel 命中时间轴缩放');
// 语境互斥豁免: Alt+Wheel 三动作互不算冲突
assert(findConflict('Alt+Wheel', 'timeline-zoom-wheel') === null, '时间轴缩放绑 Alt+Wheel 不与游玩区两动作冲突');
assert(findConflict('Alt+Wheel', 'distance-lock-wheel') === null, '锁定间距绑 Alt+Wheel 不与时间轴缩放冲突');

console.log(failures ? `V358_TESTS_FAILED: ${failures}` : 'V358_TESTS_ALL_PASSED');
if (failures) process.exit(1);
