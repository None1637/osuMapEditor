// v528: 自定义 PNG/WebP 图标资源
import { addUiIconAsset, exportUiLayout, getUiLayout, importUiLayout, resetUiLayout, setUiOverride } from '../../src/osu/uiLayout';

const mem = new Map<string, string>();
Object.assign(globalThis, { localStorage: {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); },
} });
let n = 0;
function ok(cond: unknown, msg: string) { if (!cond) throw new Error(msg); n++; console.log('  ok:', msg); }
function throws(fn: () => void, msg: string) { let yes = false; try { fn(); } catch { yes = true; } ok(yes, msg); }

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9q6ioAAAAASUVORK5CYII=';
resetUiLayout();
const ref = addUiIconAsset(png);
ok(/^asset:[0-9a-f]+$/.test(ref), '图标以内容哈希引用');
ok(Object.values(getUiLayout().assets ?? {}).includes(png), '资源随配置保存');
setUiOverride('timeline.bottom.play', { icons: { default: ref } });
ok(exportUiLayout().includes(png), '导出携带图标资源');
const parsed = JSON.parse(exportUiLayout());
importUiLayout(JSON.stringify(parsed), 'replace');
ok(Object.values(getUiLayout().assets ?? {}).includes(png), '导入后资源仍保留');
ok(mem.has('osu-editor:ui-layout:v1'), '资源写入 localStorage');
throws(() => addUiIconAsset('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), 'SVG 拒绝');
throws(() => addUiIconAsset('x'.repeat(700_001)), '超大图标拒绝');
resetUiLayout();
ok(!getUiLayout().assets, '重置清除图标资源');
console.log(`V528_TESTS_PASSED (${n})`);
