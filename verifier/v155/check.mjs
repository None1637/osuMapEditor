// 验证器 v155: 下方时间轴重构为 osu!stable 样式 + Ctrl+B 书签
//   kiai 橙区 / 红绿全高线 / 蓝线书签 / 黄线预览点 / 物件粉点 / 左侧时间+百分比
// 运行: node verifier/v155/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v155/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v155/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V155_TESTS_*)
fs.unlinkSync(out);

section('parser.ts: editor.bookmarks 字段 + 解析 + 序列化');
{
  const src = readSrc('src/osu/parser.ts');
  assert(/bookmarks: number\[\]/.test(src), 'editor 接口含 bookmarks: number[]');
  assert(/k === 'Bookmarks'/.test(src), '[Editor] 解析 Bookmarks 键');
  assert(/bm\.editor\.bookmarks\.length \? \[`Bookmarks: /.test(src), '有序列化条件写出');
}

section('store.ts: addBookmark / removeBookmarkNear');
{
  const src = readSrc('src/osu/store.ts');
  assert(/addBookmark\(/.test(src) && /pushUndo/.test(src.slice(src.indexOf('addBookmark('), src.indexOf('addBookmark(') + 400)), 'addBookmark 带 undo');
  assert(/removeBookmarkNear\(/.test(src), 'removeBookmarkNear 存在');
  const blk = src.slice(src.indexOf('addBookmark('), src.indexOf('addBookmark(') + 400);
  assert(/includes\(/.test(blk) || /indexOf\(/.test(blk), 'addBookmark 去重');
}

section('App.tsx: Ctrl+B / Ctrl+Shift+B 快捷键');
{
  const src = readSrc('src/App.tsx');
  // v286 适配: 注册表派发 — bookmark-add / bookmark-remove 两个动作 (默认 Ctrl+B / Ctrl+Shift+B)
  assert(/case 'bookmark-add': e\.preventDefault\(\); store\.addBookmark\(store\.currentTime\)/.test(src)
    && /case 'bookmark-remove': e\.preventDefault\(\); store\.removeBookmarkNear\(store\.currentTime\)/.test(src), 'Ctrl+B 添加 / Ctrl+Shift+B 删除最近书签 (v286 注册表派发)');
}

section('Timelines.tsx: 下时间轴 stable 样式各层');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/rgba\(255,150,30,0\.28\)/.test(src), 'kiai 区间橙色填充');
  assert(/rgba\(80,160,255,0\.9\)/.test(src), '书签蓝线');
  assert(/bm\.general\.previewTime >= 0/.test(src) && /fillRect\(x\(bm\.general\.previewTime\), 0, 1, r\.height\)/.test(src), '预览点黄线 (全高; v161 起 1px)');
  assert(/rgba\(255,105,180,0\.9\)/.test(src) && /\.arc\(/.test(src), '物件粉点 (arc 圆点替代粉线; v158 加亮至 0.9)');
  assert(/data-bottom-time/.test(src), '左侧当前时间+百分比块');
}

console.log(failures ? `\nV155 FAILED: ${failures}` : '\nV155 ALL PASSED');
process.exit(failures ? 1 : 0);
