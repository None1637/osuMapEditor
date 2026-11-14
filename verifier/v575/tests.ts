import { scanServerLibraryIndex, serverDirectories, serverSkeletons } from '../../src/osu/serverLibraryIndex';
import { parseIndexEntry, type LibraryIndexEntry } from '../../src/osu/libraryIndex';

let n = 0;
function ok(cond: unknown, msg: string) { if (!cond) throw new Error(msg); n++; console.log('  ok:', msg); }
const manifest = [
  { rel: '123 Artist - Song/a.osu', size: 10, lastModified: 100 },
  { rel: '123 Artist - Song/b.osu', size: 20, lastModified: 200 },
];
const skeleton = serverSkeletons(manifest);
ok(skeleton.length === 2 && skeleton[0].title === 'a' && skeleton[0].partial, 'manifest 立即生成文件名骨架');
const dirs = serverDirectories(manifest);
ok(dirs.length === 1 && dirs[0].name === '123 Artist - Song' && dirs[0].handle.serverRel === '123 Artist - Song', 'manifest 直接构造目录句柄');
const cached = parseIndexEntry('osu file format v14\n[Metadata]\nTitle: Cached\n', '123 Artist - Song', 'a.osu', 10, 100);
const originalFetch = globalThis.fetch;
let reads = 0;
globalThis.fetch = async (_url, init) => {
  reads++;
  const files = JSON.parse(String(init?.body)).files;
  return new Response(JSON.stringify({ files: files.map(rel => ({
    rel, text: 'osu file format v14\n[Metadata]\nTitle: New\n', size: 20, lastModified: 200,
  })) }));
};
try {
  const out: LibraryIndexEntry[] = [];
  for await (const batch of scanServerLibraryIndex(manifest, [cached], () => false)) out.push(...batch);
  ok(out.length === 2 && out.some(e => e === cached) && out.some(e => e.title === 'New'), '缓存命中复用, 仅变更文件重解析');
  ok(reads === 1, '变更文件使用单次批读');
  reads = 0;
  for await (const _ of scanServerLibraryIndex(manifest, [cached], () => true)) { void _; }
  ok(reads === 0, '取消后不再发起批读');
} finally { globalThis.fetch = originalFetch; }
console.log(`V575_TESTS_PASSED (${n})`);
