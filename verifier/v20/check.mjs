// 验证器 v20: 曲库/皮肤目录跨会话记忆修复
// 用户报告: 每次刷新浏览器都忘记之前选的目录, 日志"无已保存的目录记录"。
// 排查 (verifier/v19/cdp-idb-probe.mjs): 标准 Chromium 下句柄经 IndexedDB 跨刷新往返正常,
// 推断根因为早期版本遗留的同名 v1 库不含 settings store -> open 成功但事务抛 NotFoundError,
// 写入静默失败 (有界等待被当成功)。修复:
//  1) openDB 升 v2 + objectStoreNames.contains 守卫补建 settings (兼容存量正常库, 不重复建 store)
//  2) idbPutVerified 写入后立即读回校验, 失败当场经 getLastPersistError 可见
// 运行: cd app && node verifier/v20/check.mjs; node verifier/v20/cdp-persist.mjs (需 7100 dev server)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('library.ts: openDB v2 兼容升级 (含 contains 守卫)');
{
  const src = readSrc('src/osu/library.ts');
  assert(src.includes('const DB_VERSION = 2'), 'DB 版本升到 2');
  assert(src.includes('indexedDB.open(DB_NAME, DB_VERSION)'), 'open 使用 DB_VERSION');
  assert(src.includes('db.objectStoreNames.contains(DB_STORE)'), '升级时 contains 守卫 (存量正常库不重复建 store)');
  assert(!src.includes('indexedDB.open(DB_NAME, 1)'), '不再硬编码 v1');
}

section('library.ts: 写入读回校验');
{
  const src = readSrc('src/osu/library.ts');
  assert(src.includes('async function idbPutVerified'), 'idbPutVerified 存在');
  assert(/idbPutVerified[\s\S]*?await idbPut\(key, value\)[\s\S]*?await idbGet/.test(src), '写入后立即读回');
  assert(src.includes('idbPutVerified(idbKey, handle)'), 'pickDir 使用校验写入');
  assert(src.includes('getLastPersistError'), '失败经 getLastPersistError 可见');
}

if (failures) { console.error(`\nVERIFIER_V20_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V20_ALL_TESTS_PASSED');
