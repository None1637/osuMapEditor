// v578/v579: exe 持久索引缓存先恢复, 后台继续扫描
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sl = fs.readFileSync(path.join(root, 'src/components/SongLibrary.tsx'), 'utf8');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const server = sl.slice(sl.indexOf('if (h.serverRel !== undefined)'), sl.indexOf('const all: LibraryIndexEntry[] = [];', sl.indexOf('if (h.serverRel !== undefined)')));
const fast = server.slice(0, server.indexOf('const manifest = []'));
assert(fast.includes('if (!thorough && !preserveView)'), '仅自动打开走缓存快路径, 手动重扫与未完成续扫除外');
assert(fast.includes('Promise.race([cachedPromise') && fast.includes('resolve(null), 250'), '缓存快路径有 250ms 上限, 不阻塞无缓存首扫');
assert(fast.includes('if (cached?.length)') && fast.includes('flushNow(cached)'), '持久缓存直接填充列表');
assert(!fast.includes('scanDoneRef.current = true'), 'v579: 缓存首屏后仍继续后台扫描');
assert(fast.includes("serverDir('songs', name, name)"), '缓存恢复目录句柄, 选中谱面可直接打开');
assert(fast.includes("library.restored_from_index_cache"), '日志明确后台校验更新');
assert(!fast.includes('scanServerFileManifest('), '缓存读取完成后再进入分页扫描');

console.log(failures ? `\nVERIFIER_V578_FAILED: ${failures} 处失败` : '\nVERIFIER_V578_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
