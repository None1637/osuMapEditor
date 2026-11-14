import { exportUiLayout, getUiOverride, importUiLayout, registerUiControls, resetUiLayout } from '../../src/osu/uiLayout';

resetUiLayout();
const result = importUiLayout(JSON.stringify({ schemaVersion: 1, application: 'osu-map-editor', controls: {
  'dialog.polygon.input.vertices': { visible: false },
  'obsolete.control': { visible: false },
} }), 'replace');
if (result.applied !== 0 || result.unknown.length !== 2) throw new Error('动态/未知 ID 报告错误');
if (getUiOverride('dialog.polygon.input.vertices').visible !== false) throw new Error('未挂载动态控件配置未保留');
registerUiControls([{ id: 'dialog.polygon.input.vertices', kind: 'input' }]);
if (!exportUiLayout().includes('dialog.polygon.input.vertices')) throw new Error('动态控件配置导出丢失');
console.log('V532_TESTS_PASSED (3)');
