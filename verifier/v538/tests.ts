import {
  addUiIconAsset, beginUiLayoutGesture, canRedoUiLayout, endUiLayoutGesture, getUiLayout, getUiOverride,
  importUiLayout, redoUiLayout, resetUiLayout, setUiOverride, setUiOverrides, undoUiLayout,
} from '../../src/osu/uiLayout';

let n = 0;
function ok(cond: unknown, msg: string) { if (!cond) throw new Error(msg); n++; console.log('  ok:', msg); }

resetUiLayout();
setUiOverride('timeline.bottom.play', { layout: { offsetX: 12 } });
ok(undoUiLayout() && !getUiOverride('timeline.bottom.play').layout, '撤销控件修改');
ok(redoUiLayout() && getUiOverride('timeline.bottom.play').layout?.offsetX === 12, '重做控件修改');
ok(undoUiLayout(), '再次撤销准备分支');
setUiOverride('timeline.bottom.play', { text: { en: 'Play!' } });
ok(!canRedoUiLayout(), '新修改清空重做分支');

resetUiLayout();
setUiOverrides(['timeline.bottom.play', 'timeline.top.add-red'], { layout: { width: 120 } });
ok(getUiOverride('timeline.bottom.play').layout?.width === 120 && getUiOverride('timeline.top.add-red').layout?.width === 120, '批量宽高写入全部 ID');
undoUiLayout();
ok(!getUiOverride('timeline.bottom.play').layout && !getUiOverride('timeline.top.add-red').layout, '批量修改一次撤销');
redoUiLayout();
ok(getUiOverride('timeline.bottom.play').layout?.width === 120 && getUiOverride('timeline.top.add-red').layout?.width === 120, '批量修改一次重做');

beginUiLayoutGesture();
setUiOverride('timeline.bottom.play', { layout: { offsetX: 1 } });
setUiOverride('timeline.bottom.play', { layout: { offsetX: 2 } });
setUiOverride('timeline.bottom.play', { layout: { offsetX: 3 } });
endUiLayoutGesture();
undoUiLayout();
ok(!getUiOverride('timeline.bottom.play').layout?.offsetX && getUiOverride('timeline.bottom.play').layout?.width === 120, '连续拖动只产生一个历史项');
redoUiLayout();
ok(getUiOverride('timeline.bottom.play').layout?.offsetX === 3, '拖动手势重做最终值');

setUiOverride('timeline.bottom.play', { layout: { offsetX: 3 } });
undoUiLayout();
ok(!getUiOverride('timeline.bottom.play').layout?.offsetX, '无效重复修改不产生新历史');

const data = 'data:image/png;base64,iVBORw0KGgo=';
addUiIconAsset(data);
ok(!!getUiLayout().assets, '图标资源进入快照');
undoUiLayout();
ok(!getUiLayout().assets, '撤销移除新增图标资源');

importUiLayout(JSON.stringify({ schemaVersion: 1, application: 'osu-map-editor', controls: {
  'timeline.top.add-red': { text: { en: 'Imported' } },
} }), 'merge');
ok(getUiOverride('timeline.top.add-red').text?.en === 'Imported', '导入生效');
undoUiLayout();
ok(!getUiOverride('timeline.top.add-red').text, '导入可撤销');

console.log(`V538_TESTS_PASSED (${n})`);
