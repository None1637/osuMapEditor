// 验证器 v21: 拖拽导入的目录也可跨会话记忆
// 用户报告: v20 修复后刷新仍"无已保存的目录记录 (IndexedDB 中无记录)"。根因: 用户走拖拽通道导入
// (picker 异常时 UI 也主动引导拖拽), 而旧实现用 webkitGetAsEntry, 句柄无法序列化进 IndexedDB,
// 天然无法跨会话 — 与 v20 修的 schema 问题是两个独立缺陷。修复:
//  1) dirHandleFromDropEx: 优先 DataTransferItem.getAsFileSystemHandle() (Chrome/Edge 86+),
//     返回的原生 FileSystemDirectoryHandle 可入 IndexedDB; 旧 API 回退仅会话内
//  2) persistSongsDirHandle/persistSkinDirHandle: 拖拽通道与选择器通道共用同一 写入+读回校验 持久化
//  3) SongLibrary/SkinPicker 拖拽处理器改 async 并接线持久化, 日志可见结果
// 运行: cd app && node verifier/v21/check.mjs; node verifier/v21/cdp-drop.mjs (需 7100 dev server)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('library.ts: dirHandleFromDropEx (getAsFileSystemHandle 优先, 旧 API 兜底)');
{
  const src = readSrc('src/osu/library.ts');
  assert(src.includes('export async function dirHandleFromDropEx'), 'dirHandleFromDropEx 导出');
  assert(src.includes('getAsFileSystemHandle'), '优先 getAsFileSystemHandle (句柄可持久化)');
  assert(/h\.kind === 'directory'\) return \{ dir: asDirLike/.test(src), '目录句柄 -> FsDirLike + native');
  assert(src.includes('dirHandleFromDrop(item);\n  return d ? { dir: d, native: null }'), '旧 API 回退 native=null');
  assert(src.includes('export async function persistSongsDirHandle'), 'persistSongsDirHandle 导出');
  assert(src.includes('export async function persistSkinDirHandle'), 'persistSkinDirHandle 导出');
  assert(src.includes('await persistDirHandle(KEY_SONGS_DIR, handle)'), '曲库持久化走 idbPutVerified 链');
  assert(src.includes('await persistDirHandle(KEY_SKIN_DIR, handle)'), '皮肤持久化走 idbPutVerified 链');
}

section('SongLibrary.tsx: 拖拽接线持久化');
{
  const src = readSrc('src/components/SongLibrary.tsx');
  assert(src.includes('dirHandleFromDropEx') && !src.includes('dirHandleFromDrop,'), '换用 dirHandleFromDropEx');
  assert(src.includes('persistSongsDirHandle(d.native)'), '拖拽拿到原生句柄后落库');
  assert(src.includes('rememberSongsDir(d.dir, d.native)'), '会话记忆带 native 句柄');
  assert(!src.includes('拖拽句柄无法持久化'), '删除"无法持久化"旧注释');
}

section('SkinPicker.tsx: 拖拽接线持久化');
{
  const src = readSrc('src/components/SkinPicker.tsx');
  assert(src.includes('dirHandleFromDropEx'), '换用 dirHandleFromDropEx');
  assert(src.includes('persistSkinDirHandle(d.native)'), '拖拽拿到原生句柄后落库');
  assert(src.includes('rememberSkinDir(d.dir, d.native)'), '会话记忆带 native 句柄');
  assert(!src.includes('拖拽句柄无法持久化'), '删除"无法持久化"旧注释');
}

if (failures) { console.error(`\nVERIFIER_V21_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V21_ALL_TESTS_PASSED');
