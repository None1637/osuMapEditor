import { buildUiControlTree } from '../../src/osu/uiControlTree';
import type { UiControlDefinition } from '../../src/osu/uiLayout';

let n = 0;
function ok(cond: unknown, msg: string) { if (!cond) throw new Error(msg); n++; console.log('  ok:', msg); }
const controls: UiControlDefinition[] = [
  { id: 'sidebar.left.panel', kind: 'panel' },
  { id: 'sidebar.left.tool.circle', kind: 'button' },
  { id: 'chrome.volume', kind: 'button' },
  { id: 'chrome.hotkeys', kind: 'button' },
  { id: 'timeline.bottom.play', kind: 'button' },
];
const tree = buildUiControlTree(controls);
ok(tree.length === 3 && tree.map(x => x.label).join(',') === 'chrome,sidebar,timeline', '按 ID 层级构建根节点');
const sidebar = tree.find(x => x.id === 'sidebar')!;
ok(sidebar.children[0].id === 'sidebar.left' && sidebar.children[0].children.some(x => x.id === 'sidebar.left.panel'), '共享前缀合并成分组');
ok(sidebar.children[0].children.find(x => x.id === 'sidebar.left.panel')?.control?.kind === 'panel', '同时存在子节点的控件不丢失');
const found = buildUiControlTree(controls, 'volume');
ok(found.length === 1 && found[0].children[0].control?.id === 'chrome.volume', '搜索保留命中项及祖先');
ok(buildUiControlTree(controls, 'missing').length === 0, '无命中返回空树');
console.log(`V539_TESTS_PASSED (${n})`);
