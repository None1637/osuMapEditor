// v579: 缓存先显示但后台继续扫描, 修复 v578 缓存命中后不再更新
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sl = fs.readFileSync(path.join(root, 'src/components/SongLibrary.tsx'), 'utf8');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const serverStart = sl.indexOf('if (h.serverRel !== undefined)');
const server = sl.slice(serverStart);
const fast = server.slice(0, server.indexOf('const manifest = []'));
assert(fast.includes('flushNow(cached)') && !fast.includes('scanDoneRef.current = true'), '缓存只填首屏, 不提前标记完成');
assert(server.indexOf('scanServerFileManifest(') > server.indexOf('flushNow(cached)'), '缓存显示后继续获取分页清单');
assert(server.includes('if (!cached?.length)') && server.includes('dirsRef.current = serverDirectories(manifest)'), '有缓存时不逐页重排, 无缓存仍逐页显示');
assert(server.includes('const byKey = new Map(cached.map') && server.includes('byKey.get(entryKey(all[i]))'), '清单完成后同 key 保留缓存元数据');
assert(server.indexOf('byKey.get(entryKey(all[i]))') < server.indexOf('scanServerLibraryIndex('), '先合并缓存再 reconcile');
assert(server.indexOf('scanServerLibraryIndex(') < server.indexOf('scanDoneRef.current = true'), '后台索引完成后才标记扫描完成');
assert(!sl.includes('library.restored_index_no_rescan'), '移除“未重新扫描”的错误日志');

console.log(failures ? `\nVERIFIER_V579_FAILED: ${failures} 处失败` : '\nVERIFIER_V579_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
