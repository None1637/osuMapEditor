// 验证器 v290: 曲库搜索对齐 lazer — 元数据索引 + 查询语法 + 扁平难度列表
// 依据: 计划 x-23-forager-quasar (用户选定: star= 星级过滤后台渐进计算+IDB 缓存; 曲库改扁平难度列表)。
//   librarySearch.ts — parseLibraryQuery/matchLibraryEntry (键值对过滤+容差/自由文本/[diff] 段, 纯函数);
//   libraryIndex.ts — LibraryIndexEntry/parseIndexEntry 轻解析 (众数 BPM/spinner 时长) /
//     buildLibraryIndex (50 文件/批 yield, 传缓存即增量 reconcile) / runStarQueue 后台星级队列;
//   library.ts — DB_VERSION 2→3, store 'libraryIndex' (contains 守卫补建), idbLibraryIndex{Get,Put,Del};
//   SongLibrary.tsx — 扁平难度列表 (虚拟化 ROW_H 34) + 查询搜索 + 排序 + 详情栏, 保留
//     v128 会话缓存规则/v120 guardUnsaved/v67 来源记录/拖拽导入/授权流程/诊断日志。
// 运行: node verifier/v290/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v290/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v290/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V290_TESTS_*)
fs.unlinkSync(out);

// librarySearch.ts: 键表 / 容差 / 解析结构
const search = readSrc('src/osu/librarySearch.ts');
assert(/export function parseLibraryQuery/.test(search) && /export function matchLibraryEntry/.test(search), '查询解析/匹配导出');
assert(/star:\s*\{ tol: 0\.005/.test(search) && /bpm:\s*\{ tol: 0\.5/.test(search) && /ar:\s*\{ tol: 0\.05/.test(search), '键表容差 (star 0.005 / bpm 0.5 / ar 0.05)');
assert(/keys/.test(search) && /e\.mode !== 3/.test(search), 'keys 仅 mania (mode=3)');
assert(/creator/.test(search) && /artist/.test(search) && /diff/.test(search) && /tag/.test(search), '文本键 (creator/artist/diff/tag)');
assert(/std: 0, osu: 0, taiko: 1, catch: 2/.test(search), 'mode 键 (项目补充)');
assert(search.includes('\\[([^\\]]*)\\]'), '[...] 段 → diff 过滤');
assert(/beatmapID === t\.text \|\| e\.beatmapSetID/.test(search), '纯数字 term 兜底 beatmapID/beatmapSetID');
assert(/return whole; \/\/ 未知键/.test(search), '未知键不退化 (留作自由文本)');

// libraryIndex.ts: 条目 / 轻解析 / reconcile / 星级队列
const idx = readSrc('src/osu/libraryIndex.ts');
assert(/export interface LibraryIndexEntry \{/.test(idx) && /star: number \| null;/.test(idx) && /size: number;/.test(idx) && /lastModified: number;/.test(idx), 'LibraryIndexEntry 结构 (含 star/size/lastModified)');
assert(/export function parseIndexEntry/.test(idx), 'parseIndexEntry 导出');
assert(/counts\.set\(bl/.test(idx) && /60000 \/ bestBl/.test(idx), 'BPM 众数 beatLength (lazer 口径)');
assert(/spinner end time/.test(idx), 'lengthMs: spinner 取第 6 字段 end time');
assert(/export async function\* buildLibraryIndex/.test(idx) && /batch\.length >= 50/.test(idx) && /await new Promise\(r => setTimeout\(r\)\)/.test(idx), 'buildLibraryIndex 分批 yield + 让出主线程');
assert(/hit\.size === file\.size && hit\.lastModified === file\.lastModified/.test(idx), '增量 reconcile: size+lastModified 比对复用缓存');
assert(/export async function runStarQueue/.test(idx) && /e\.mode === 0 && e\.star == null/.test(idx) && /computeStarRating\(parseOsu\(text\)\)/.test(idx), 'runStarQueue: 仅 mode=0 无 star, parseOsu+computeStarRating');
assert(/sinceFlush >= 20/.test(idx) && /onFlush/.test(idx), '星级队列节流落库 (每 20 张)');

// library.ts: DB 升级 + 索引 store 持久化
const lib = readSrc('src/osu/library.ts');
assert(/const DB_VERSION = 3;/.test(lib), 'DB_VERSION 2→3');
assert(/DB_STORE_LIBRARY_INDEX = 'libraryIndex'/.test(lib), "store 'libraryIndex' 定义");
assert(/if \(!db\.objectStoreNames\.contains\(DB_STORE_LIBRARY_INDEX\)\) db\.createObjectStore/.test(lib), 'onupgradeneeded contains 守卫补建 (兼容旧库)');
assert(/export async function idbLibraryIndexGet/.test(lib) && /export async function idbLibraryIndexPut/.test(lib), 'idbLibraryIndexGet/Put 导出');

// SongLibrary.tsx: 扁平难度列表 + 查询搜索 + 保留既有行为
const sl = readSrc('src/components/SongLibrary.tsx');
assert(/parseLibraryQuery\(filter\)/.test(sl) && /matchLibraryEntry\(query, e\)/.test(sl), '搜索框接 parseLibraryQuery + matchLibraryEntry');
assert(/const ROW_H = 44;/.test(sl) && /filtered\.length \* ROW_H/.test(sl), '扁平难度列表虚拟化 (ROW_H 44; v303 F01 字号增大 34→44)');
assert(!/countDifficulties/.test(sl), 'countDifficulties 徽标懒加载链路删除');
assert(/onDoubleClick=\{\(\) => \{ selectEntry\(e\); void openDiff\(e\.fileName\); \}\}/.test(sl), '双击行打开难度');
assert(/if \(!store\.guardUnsaved\(\(\) => \{ void openDiff\(fileName\); \}\)\) return;/.test(sl), 'openDiff: v120 guardUnsaved 保留');
assert(/store\.load\(r\.bm, r\.audioUrl, r\.bgUrl, r\.samples, \{ dir: d\.handle, fileName \}\)/.test(sl), 'openDiff: v67 来源记录保留');
assert(/libraryCache = null; \/\/ v128: 任何显式扫描/.test(sl) && /!s\.rootName \|\| !scanDoneRef\.current/.test(sl), 'v128 会话缓存规则保留 (显式扫描失效 + 中途关闭不写)');
assert(/dirHandleFromDropEx/.test(sl) && /permNeeded/.test(sl) && /授权访问/.test(sl), '拖拽导入 + 授权流程保留');
// v296: 全局星数队列已屏蔽 (太慢), 头部不再显示「星级计算中 x/y」; runStarQueue 导出保留 (见上)
assert(!/setStarProg/.test(sl) && /难度 \/ /.test(sl), '头部状态行 (N 难度 / M 目录; v296 星数进度已移除)');
assert(/已从索引缓存恢复/.test(sl) && /idbLibraryIndexGet/.test(sl), '启动读索引缓存立即可搜');

if (failures) { console.error(`\nV290_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV290_ALL_PASSED');
