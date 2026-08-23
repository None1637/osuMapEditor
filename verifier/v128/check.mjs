// v128 源码接线断言: 歌曲库会话缓存 — 二次打开免重扫 + 记住上次位置
// 运行: node verifier/v128/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const sl = read('src/components/SongLibrary.tsx');

// 缓存结构与失效时机
assert(/interface LibraryCache \{/.test(sl), 'LibraryCache 结构定义');
assert(/rootName: string;/.test(sl) && /scrollTop: number;/.test(sl) && /filter: string;/.test(sl) && /selName: string \| null;/.test(sl) && /diffs: DifficultyInfo\[\] \| null;/.test(sl), '缓存含目录名/滚动/搜索/选中/难度列表');
assert(/let libraryCache: LibraryCache \| null = null;/.test(sl), '模块级会话缓存单例');
assert(/libraryCache = null; \/\/ v128: 任何显式扫描/.test(sl), 'startScan 顶部使缓存失效 (重新扫描/换目录/拖拽/授权)');

// 状态初值取缓存 (免重扫 + 位置记忆)
assert(/useState<DirEntry\[\]>\(\(\) => libraryCache\?\.dirs \?\? \[\]\)/.test(sl), 'dirs 初值取缓存');
assert(/useState\(\(\) => libraryCache\?\.filter \?\? ''\)/.test(sl), '搜索词初值取缓存');
assert(/useState<string \| null>\(\(\) => libraryCache\?\.selName \?\? null\)/.test(sl), '选中歌曲初值取缓存');
assert(/useState<DifficultyInfo\[\] \| null>\(\(\) => libraryCache\?\.diffs \?\? null\)/.test(sl), '难度列表初值取缓存');
assert(/useState\(\{ top: libraryCache\?\.scrollTop \?\? 0, height: 400 \}\)/.test(sl), '滚动位置初值取缓存');
assert(/new Map<string, number \| 'loading'>\(libraryCache\?\.meta \?\? \[\]\)/.test(sl), '难度数徽标初值取缓存');

// 缓存命中跳过扫描 (同目录才生效)
assert(/libraryCache && libraryCache\.rootName === mem\.dir\.name/.test(sl), '缓存按目录名匹配才生效');
assert(/已从会话缓存恢复列表 \(未重新扫描\)/.test(sl), '缓存命中日志');
const hitIdx = sl.indexOf('已从会话缓存恢复列表 (未重新扫描)');
const scanAfterHit = sl.indexOf('startScan(mem.dir)');
assert(hitIdx > 0 && scanAfterHit > hitIdx, '缓存命中分支在 startScan 之前 (命中即 return 不扫)');

// 扫描完成才允许写缓存 (中途关闭不写, 防残缺列表)
assert(/scanDoneRef\.current = false/.test(sl), '扫描开始 scanDone=false');
assert(/scanDoneRef\.current = true; \/\/ v128: 扫描完成/.test(sl), '扫描完成 scanDone=true');
assert(/!s\.rootName \|\| !scanDoneRef\.current/.test(sl), '卸载快照要求扫描完成');

// 滚动恢复 + 背景补取 + 快照字段
assert(/listRef\.current\.scrollTop = libraryCache\.scrollTop/.test(sl), '挂载后恢复滚动位置');
assert(/restoreSelBg\(libraryCache\)/.test(sl), '缓存命中补取选中歌曲背景');
assert(/snapRef\.current = \{ rootName: root\?\.name \?\? null, dirs, filter, selName, diffs, scrollTop: view\.top \}/.test(sl), '快照含全部位置字段');
assert(/if \(typeof v === 'number'\) meta\.set\(k, v\)/.test(sl), "'loading' 占位不入缓存");

console.log(failures ? '\nV128_CHECK_FAILED: ' + failures : '\nV128_CHECK_PASSED');
process.exit(failures ? 1 : 0);
