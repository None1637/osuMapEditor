// 验证器 v291: 曲库 UI 反馈修正 — 窗口加宽 50% / 右栏固定宽 / 占位条目先行显示 /
//   默认选中当前打开的谱面 / 含条件搜索的索引等待提示
// 依据: 用户反馈「曲库界面宽度增加50%, 右侧详情预览不要宽度随谱面变化;
//   优先按旧方式显示所有谱面 (默认选中当前打开的谱面), 现在建索引太慢了;
//   索引在后台建立, 仅当搜索需要索引的时候才提示需要等索引建立完成」。
// 实现: libraryIndex.ts 新增 placeholderFromDirName (目录名 → 占位条目, fileName='' 标记);
//   SongLibrary startScan 无 IDB 缓存时先列占位 (不读文件), 索引批次渐进替换已覆盖目录的占位,
//   完成后剔除剩余占位 (防入会话缓存); selKey 初值/重扫回退取 store.mapSource,
//   条目出现后一次性滚动定位 (scrollToSelRef); queryHasConds (filters/[diff]) 时占位不参与
//   条件过滤 + 显示 needsIndexHint; 布局 w-[1380px] + 右栏 w-[380px] shrink-0。
// 运行: node verifier/v291/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v291/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v291/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V291_TESTS_*)
fs.unlinkSync(out);

const li = readSrc('src/osu/libraryIndex.ts');
assert(/export function placeholderFromDirName/.test(li), 'placeholderFromDirName 导出');
assert(/fileName: '',/.test(li), '占位条目 fileName 空标记');

const sl = readSrc('src/components/SongLibrary.tsx');
assert(/w-\[1380px\]/.test(sl), '窗口宽度 +50% (920→1380)');
assert(/w-\[380px\] shrink-0/.test(sl), '右栏固定宽度 (不随谱面内容变化)');
// v299: 占位条目机制已被文件名骨架取代 (enumerateDifficultySkeletons — 纯枚举 .osu 文件名,
// 从 "Artist - Title (Creator) [Version].osu" 解析出完整行信息, key 与索引后一致)
assert(/enumerateDifficultySkeletons/.test(sl) && /enumerateDifficultySkeletons/.test(li), 'v299: 文件名骨架接入 startScan');
assert(/difficultyFromFileName/.test(li) && /partial: true/.test(li), 'v299: 骨架条目解析文件名 + partial 标记');
assert(/store\.mapSource/.test(sl), '默认选中当前打开的谱面 (mapSource)');
assert(/scrollToSelRef/.test(sl), '条目出现后一次性滚动定位');
assert(/queryHasConds/.test(sl) && /needsIndexHint/.test(sl), '含条件搜索的索引等待提示');
assert(/listDifficulties\(d\.handle\)/.test(sl), '占位条目打开时懒解析目录 (第一个难度)');

if (failures) { console.error(`\nV291_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV291_ALL_PASSED');
