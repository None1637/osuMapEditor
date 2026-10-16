// 验证器 v429: 右栏按钮快捷键从文本挪进 tooltip
//  - 带快捷键后缀的按钮 (Sliders to Stream/Polygon Generator/Delete) 文本去掉 ({key})/(Del);
//    title tooltip = 功能详情 + hotkeyLabel (随 v321 改键同步), 与 v427 旋转/镜像同一模式。
//  - 新词典 key: inspector.stream_tip / polygon_tip / delete_tip (zh/en)。
// 运行: cd app && node verifier/v429/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('Inspector.tsx: 文本去快捷键 + tooltip 接线');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert(/v429: 按钮文本不再带快捷键后缀/.test(src), 'v429 版本注释');
  assert(/t\('inspector\.sliders_to_stream', 'Sliders to Stream \(\{n\}\)'/.test(src), 'stream 文本去 {key}');
  assert(!src.includes("Sliders to Stream ({n}, {key})"), '旧 stream 后缀清除');
  assert(/t\('inspector\.stream_tip', 'Convert sliders to a circle stream \(\{key\}\)', \{ key: hotkeyLabel\('stream'\) \}\)/.test(src), 'stream tooltip = 详情+快捷键');
  assert((src.match(/t\('inspector\.polygon_generate', 'Polygon Generator'\)/g) ?? []).length === 2, 'polygon 文本去 {key} ×2');
  assert(!src.includes("Polygon Generator ({key})"), '旧 polygon 后缀清除');
  assert((src.match(/t\('inspector\.polygon_tip', 'Generate a polygon of circles \(\{key\}\)', \{ key: hotkeyLabel\('polygon'\) \}\)/g) ?? []).length === 2, 'polygon tooltip ×2');
  assert(/t\('inspector\.delete', 'Delete'\)/.test(src) && !src.includes('Delete (Del)'), 'delete 文本去 (Del)');
  assert(/t\('inspector\.delete_tip', 'Delete selected objects \(\{key\}\)', \{ key: hotkeyLabel\('delete'\) \}\)/.test(src), 'delete tooltip = 详情+快捷键');
  // v427 镜像/旋转模式保持 (tooltip 带 hotkeyLabel)
  assert(/flip_h_tip[\s\S]{0,80}?hotkeyLabel\('flip-h'\)/.test(src), 'v427 镜像 tooltip 模式保持');
}

section('zh-CN 词典同步');
{
  const zh = readSrc('src/i18n/dicts/zh-CN/inspector.ts');
  assert(/'inspector\.sliders_to_stream': '滑条转连打 \(\{n\} 条\)'/.test(zh), 'stream zh 去 {key}');
  assert(/'inspector\.stream_tip': '把滑条转成连打单点 \(\{key\}\)'/.test(zh), 'stream_tip zh');
  assert(/'inspector\.polygon_generate': '多边形生成'/.test(zh) && !zh.includes("多边形生成 ({key})"), 'polygon zh 去 {key}');
  assert(/'inspector\.polygon_tip': '生成多边形单点 \(\{key\}\)'/.test(zh), 'polygon_tip zh');
  assert(/'inspector\.delete': '删除'/.test(zh) && !zh.includes('删除 (Del)'), 'delete zh 去 (Del)');
  assert(/'inspector\.delete_tip': '删除选中物件 \(\{key\}\)'/.test(zh), 'delete_tip zh');
}

if (failures) { console.error(`\nV429 FAILED (${failures})`); process.exit(1); }
console.log('\nV429 ALL PASSED');
