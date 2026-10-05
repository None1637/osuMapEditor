// v128 源码接线断言: 歌曲库会话缓存 — 二次打开免重扫 + 记住上次位置
// v290: 曲库改扁平难度列表, 缓存结构换为索引条目 (dirs/meta/diffs → LibraryIndexEntry[]),
// 断言同步更新; 规则不变 — 显式扫描失效 / 扫描中途关闭不写缓存 / 滚动·搜索词·选中记忆。
// 运行: node verifier/v128/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const sl = read('src/components/SongLibrary.tsx');

// 缓存结构与失效时机 (v290: 扁平难度索引条目)
assert(/interface LibraryCache \{/.test(sl), 'LibraryCache 结构定义');
assert(/rootName: string;/.test(sl) && /scrollTop: number;/.test(sl) && /filter: string;/.test(sl) && /selKey: string \| null;/.test(sl) && /entries: LibraryIndexEntry\[\];/.test(sl), '缓存含目录名/滚动/搜索/选中/索引条目');
assert(/let libraryCache: LibraryCache \| null = null;/.test(sl), '模块级会话缓存单例');
assert(/libraryCache = null; \/\/ v128: 任何显式扫描/.test(sl), 'startScan 顶部使缓存失效 (重新扫描/换目录/拖拽/授权)');

// 状态初值取缓存 (免重扫 + 位置记忆)
assert(/useState<LibraryIndexEntry\[\]>\(\(\) => libraryCache\?\.entries \?\? \[\]\)/.test(sl), '索引条目初值取缓存');
assert(/useState\(\(\) => libraryCache\?\.filter \?\? ''\)/.test(sl), '搜索词初值取缓存');
assert(/useState<string \| null>\(\(\) => curMapKey \?\? libraryCache\?\.selKey \?\? null\)/.test(sl), '选中难度初值取缓存 (v291: 当前打开谱面优先, 缓存兜底)');
assert(/useState\(\{ top: libraryCache\?\.scrollTop \?\? 0, height: 400 \}\)/.test(sl), '滚动位置初值取缓存');

// 缓存命中跳过扫描 (同目录才生效)
assert(/libraryCache && libraryCache\.rootName === mem\.dir\.name/.test(sl), '缓存按目录名匹配才生效');
// v346 适配: 日志文案改 i18n key (zh-CN 词典译文不变)
const zhLib = read('src/i18n/dicts/zh-CN/library.ts');
assert(/tNow\('library\.restored_list_from_cache', 'Restored list from session cache \(no rescan\)'\)/.test(sl)
  && zhLib.includes("'library.restored_list_from_cache': '已从会话缓存恢复列表 (未重新扫描)'"), '缓存命中日志 (library.restored_list_from_cache)');
const hitIdx = sl.indexOf("tNow('library.restored_list_from_cache'");
const scanAfterHit = sl.indexOf('startScan(mem.dir'); // v297: 调用带 native 参数, 前缀匹配
assert(hitIdx > 0 && scanAfterHit > hitIdx, '缓存命中分支在 startScan 之前 (命中即 return 不扫)');

// 扫描完成才允许写缓存 (中途关闭不写, 防残缺列表)
assert(/scanDoneRef\.current = false/.test(sl), '扫描开始 scanDone=false');
assert(/scanDoneRef\.current = true; \/\/ v128: 扫描完成/.test(sl), '扫描完成 scanDone=true');
assert(/!s\.rootName \|\| !scanDoneRef\.current/.test(sl), '卸载快照要求扫描完成');

// 滚动恢复 + 背景补取 + 快照字段
assert(/listRef\.current\.scrollTop = libraryCache\.scrollTop/.test(sl), '挂载后恢复滚动位置');
assert(/fetchBg\(entry\.dirName\)/.test(sl), '缓存命中补取选中难度背景 (fetchBg)');
assert(/snapRef\.current = \{ rootName: root\?\.name \?\? null, entries, filter, selKey, scrollTop: view\.top \}/.test(sl), '快照含全部位置字段');
assert(/libraryCache = \{ rootName: s\.rootName, entries: s\.entries, filter: s\.filter, selKey: s\.selKey, scrollTop: s\.scrollTop \}/.test(sl), '卸载写缓存 (扫描完成后)');

console.log(failures ? '\nV128_CHECK_FAILED: ' + failures : '\nV128_CHECK_PASSED');
process.exit(failures ? 1 : 0);
