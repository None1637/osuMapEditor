// 验证器 v16: 目录记忆修复 (会话内记忆兜底 + 持久化诊断可见)
// 背景: 用户报告"选完曲库目录后, 不关闭浏览器, 重开曲库面板仍要重选"。
// 根因: 持久化完全依赖 IndexedDB, 写入失败被静默吞掉, 读取挂起 2s 超时按无记录处理;
//       面板关闭即卸载组件, 会话内没有任何兜底。
// 修复: 模块级会话记忆(选择/拖拽立即记住, restore 优先命中) + IDB 写入有界等待结果可见
//       (getLastPersistError) + 恢复失败原因可见 (getLastRestoreReason) + idbSelfTest 自检。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('library.ts: 会话内记忆 + 诊断');
{
  const src = readSrc('src/osu/library.ts');
  assert(src.includes('let memSongsDir') && src.includes('let memSkinDir'), '模块级会话记忆槽');
  assert(src.includes('export function rememberSongsDir') && src.includes('export function getRememberedSongsDir'), '曲库记忆读写接口');
  assert(src.includes('export function rememberSkinDir') && src.includes('export function getRememberedSkinDir'), '皮肤记忆读写接口');
  assert(/pickSongsDir[\s\S]*?rememberSongsDir\(asDirLike\(h\), h\)/.test(src), '选择曲库目录后立即写入会话记忆');
  assert(/pickSkinDir[\s\S]*?rememberSkinDir\(asDirLike\(h\), h\)/.test(src), '选择皮肤目录后立即写入会话记忆');
  assert(/restoreSongsDir[\s\S]*?memSongsDir\?\.native/.test(src), '恢复曲库目录: 会话记忆优先于 IndexedDB');
  assert(/restoreSkinDir[\s\S]*?memSkinDir\?\.native/.test(src), '恢复皮肤目录: 会话记忆优先于 IndexedDB');
  assert(!src.includes(".catch(() => { });\n  return handle;"), 'IDB 写入不再静默吞错');
  assert(src.includes('lastPersistError') && src.includes('getLastPersistError'), '持久化错误可见');
  assert(src.includes('lastRestoreReason') && src.includes('getLastRestoreReason'), '恢复失败原因可见');
  assert(src.includes('export async function idbSelfTest'), 'IDB 自检函数');
  assert(/forgetSkinDir[\s\S]*?memSkinDir = null/.test(src), '遗忘皮肤目录同时清会话记忆');
}

section('SongLibrary.tsx: 记忆兜底与诊断日志');
{
  const src = readSrc('src/components/SongLibrary.tsx');
  assert(src.includes('getRememberedSongsDir'), '恢复失败时查会话记忆 (拖拽通道)');
  assert(src.includes('已从会话记忆恢复') || src.includes('已从本次会话记忆恢复'), '会话记忆恢复日志');
  assert(src.includes('rememberSongsDir(d.dir, null)'), '拖拽导入写入会话记忆 (v21: 旧 API 回退路径 native=null)');
  assert(src.includes('getLastPersistError'), '选择后显示持久化结果');
  assert(src.includes('idbSelfTest'), '无记录时跑 IDB 自检');
  assert(src.includes('getLastRestoreReason'), '显示恢复失败原因');
}

section('SkinPicker.tsx: 皮肤目录记忆兜底');
{
  const src = readSrc('src/components/SkinPicker.tsx');
  assert(src.includes('getRememberedSkinDir'), '恢复失败时查会话记忆');
  assert(src.includes('rememberSkinDir(d.dir, null)'), '拖拽导入写入会话记忆 (v21: 旧 API 回退路径 native=null)');
}

if (failures) { console.error(`\nVERIFIER_V16_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V16_ALL_TESTS_PASSED');
