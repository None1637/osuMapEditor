// v524 纯函数: 配置核心/校验/持久化/导入导出/备份恢复
import {
  UI_CONTROLS, exportUiLayout, getUiLayout, getUiOverride, importUiLayout, resetUiControl, resetUiLayout,
  restoreUiLayoutBackup, setUiOverride, subscribeUiLayout, validateUiLayoutFile,
} from '../../src/osu/uiLayout';

const mem = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
  },
});

let n = 0;
function ok(cond: unknown, msg: string) { if (!cond) throw new Error(msg); n++; console.log('  ok:', msg); }
function throws(fn: () => void, msg: string) { let yes = false; try { fn(); } catch { yes = true; } ok(yes, msg); }

resetUiLayout();
ok(new Set(UI_CONTROLS.map(c => c.id)).size === UI_CONTROLS.length, '控件永久 ID 唯一');
let notices = 0;
const off = subscribeUiLayout(() => notices++);
setUiOverride('timeline.bottom.play', {
  layout: { offsetX: 12, width: 40 }, icons: { default: 'lucide:Pause' },
  text: { 'zh-CN': '播放' }, visible: false, enabled: false,
});
setUiOverride('timeline.bottom.play', { layout: { offsetY: 8 } });
const o = getUiOverride('timeline.bottom.play');
ok(o.layout?.offsetX === 12 && o.layout?.offsetY === 8 && o.layout?.width === 40, '布局 patch 深层合并');
ok(o.icons?.default === 'lucide:Pause' && o.text?.['zh-CN'] === '播放', '图标/文本覆盖');
ok(o.visible === false && o.enabled === false, '隐藏/禁用覆盖');
ok(notices === 2, '配置订阅通知');
off();
ok(mem.has('osu-editor:ui-layout:v1'), 'localStorage 持久化');
ok(validateUiLayoutFile(JSON.parse(exportUiLayout())).controls['timeline.bottom.play'].visible === false, '导出/校验往返');

const imported = JSON.stringify({ schemaVersion: 1, application: 'osu-map-editor', controls: {
  'timeline.top.add-red': { text: { en: 'Add red' } },
  'obsolete.control': { visible: false },
} });
const result = importUiLayout(imported, 'merge');
ok(result.applied === 1 && result.unknown[0] === 'obsolete.control', '导入报告未知 ID 且仅应用已知控件');
ok(getUiOverride('timeline.bottom.play').layout?.offsetX === 12, 'merge 保留现有配置');
ok(restoreUiLayoutBackup(), '导入前备份可恢复');
ok(!getUiOverride('timeline.top.add-red').text, '恢复后未保留导入项');

importUiLayout(imported, 'replace');
ok(!getUiOverride('timeline.bottom.play').layout, 'replace 清除未包含旧覆盖');
resetUiControl('timeline.top.add-red');
ok(Object.keys(getUiLayout().controls).length === 0, '单控件重置为默认');

const before = exportUiLayout();
setUiOverride('timeline.bottom.play', { visible: false, text: { en: 'Play' } });
const changed = exportUiLayout();
throws(() => importUiLayout(JSON.stringify({ schemaVersion: 1, application: 'osu-map-editor', controls: {
  'timeline.bottom.play': { layout: { width: -2 } },
} })), '非法尺寸拒绝');
ok(exportUiLayout() === changed, '非法导入不改变当前布局');
throws(() => importUiLayout(JSON.stringify({ schemaVersion: 1, application: 'other', controls: {} })), '异应用配置拒绝');
throws(() => validateUiLayoutFile({ schemaVersion: 1, application: 'osu-map-editor', controls: {}, assets: {
  x: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
} }), 'SVG/非白名单资源拒绝');
throws(() => importUiLayout('{broken'), '损坏 JSON 拒绝');
resetUiLayout();
ok(exportUiLayout() !== before && Object.keys(getUiLayout().controls).length === 0, '全部恢复默认');
console.log(`V524_TESTS_PASSED (${n})`);
