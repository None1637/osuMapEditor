// v469 单元断言: 曲库索引并发池 — 正确性 (条目齐全/缓存复用/trustNames/prio/取消) + 时序 (并发提速)
import { buildLibraryIndex, enumerateDifficultySkeletons, parseIndexEntry, type LibraryIndexEntry } from '@/osu/libraryIndex';
import type { FsDirLike, FsFileLike } from '@/osu/library';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// 人工延迟模拟 exe 服务器直读模式的 HTTP roundtrip
const LAT_LIST = 20, LAT_GET = 10, LAT_TEXT = 10;
let getFileCalls = 0;

const OSU = (n: number) => `osu file format v14

[General]
Mode:0

[Metadata]
Title:Song${n}
Artist:Artist${n}
Creator:Mapper
Version:Insane
Source:
Tags:tag${n}

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:8
ApproachRate:9

[TimingPoints]
0,500,4,2,0,50,1,0

[HitObjects]
256,192,1000,1,0,0:0:0:0:
256,192,2000,1,0,0:0:0:0:
`;

function fakeFile(text: string, size: number, mtime: number): FsFileLike {
  return {
    kind: 'file', name: '',
    async getFile() {
      getFileCalls++;
      await sleep(LAT_GET);
      return { size, lastModified: mtime, async text() { await sleep(LAT_TEXT); return text; } } as unknown as File;
    },
  };
}
function fakeDir(name: string, files: [string, FsFileLike][], subdirs: [string, FsDirLike][] = []): FsDirLike {
  return {
    kind: 'directory', name,
    async *entries() {
      await sleep(LAT_LIST);
      for (const [n, f] of files) yield [n, f];
      for (const [n, d] of subdirs) yield [n, d];
    },
    async getFileHandle() { throw new Error('n/a'); },
  };
}

const N_DIRS = 24, N_FILES = 3; // 24 歌 × 3 难度 = 72 条目
function makeRoot() {
  const subdirs: [string, FsDirLike][] = [];
  for (let d = 0; d < N_DIRS; d++) {
    const files: [string, FsFileLike][] = [];
    for (let f = 0; f < N_FILES; f++)
      files.push([`Artist${d} - Song${d} (Mapper) [Insane${f}].osu`, fakeFile(OSU(d), 1000 + d * 10 + f, 5000 + d * 10 + f)]);
    subdirs.push([`dir${d}`, fakeDir(`dir${d}`, files)]);
  }
  return fakeDir('Songs', [], subdirs);
}
async function drain(gen: AsyncGenerator<LibraryIndexEntry[]>, onBatch?: () => void): Promise<LibraryIndexEntry[]> {
  const all: LibraryIndexEntry[] = [];
  for await (const b of gen) { all.push(...b); onBatch?.(); }
  return all;
}

// ---- 1. 正确性: 全量解析条目齐全且字段正确 ----
{
  getFileCalls = 0;
  const t0 = Date.now();
  const all = await drain(buildLibraryIndex(makeRoot(), null, null, () => false));
  const wall = Date.now() - t0;
  assert(all.length === N_DIRS * N_FILES, `全量索引条目齐全 (72, 实际 ${all.length})`);
  assert(all.every(e => !e.partial && e.title.startsWith('Song') && e.creator === 'Mapper'), '条目字段经 parseIndexEntry 解析');
  // 串行下界 = 24×(20 + 3×20) = 1920ms; 并发后应远低于一半
  const serial = N_DIRS * (LAT_LIST + N_FILES * (LAT_GET + LAT_TEXT));
  assert(wall < serial / 2, `并发提速: ${wall}ms < 串行 ${serial}ms 的一半`);
  console.log(`  [计时] 全量索引 ${wall}ms (串行估算 ${serial}ms)`);
}

// ---- 2. 增量缓存: 未变更复用同一对象 (含 star), 变更才重解析 ----
{
  const first = await drain(buildLibraryIndex(makeRoot(), null, null, () => false));
  first[0]!.star = 3.14; // 模拟已算星级
  const cached = first;
  const second = await drain(buildLibraryIndex(makeRoot(), cached, null, () => false));
  assert(second.length === first.length, '增量扫描条目数一致');
  const reused = second.filter(e => first.includes(e)).length;
  assert(reused === first.length, `未变更全部复用缓存对象 (${reused}/${first.length})`);
  assert(second[0]!.star === 3.14, '复用条目保留已算 star');
}

// ---- 3. trustNames 快路径: 文件名集合一致 → 零 getFile ----
{
  const cached = await drain(buildLibraryIndex(makeRoot(), null, null, () => false));
  getFileCalls = 0;
  const t0 = Date.now();
  const again = await drain(buildLibraryIndex(makeRoot(), cached, null, () => false, undefined, { trustNames: true }));
  const wall = Date.now() - t0;
  assert(getFileCalls === 0, `trustNames 全程零 getFile (实际 ${getFileCalls})`);
  assert(again.length === cached.length, 'trustNames 条目数一致');
  const serial = N_DIRS * LAT_LIST;
  assert(wall < serial / 2, `trustNames 目录枚举并发提速: ${wall}ms < ${serial / 2}ms`);
  console.log(`  [计时] trustNames reconcile ${wall}ms (串行估算 ${serial}ms)`);
}

// ---- 4. prio: 优先目录插队到首波 (并发下不重复认领) ----
{
  const order: string[] = [];
  await drain(buildLibraryIndex(makeRoot(), null, null, () => false, () => 'dir12'));
  // 再跑一遍记录完成顺序: 用批次流观察首个含 dir12 的批次位置
  const seen = new Set<string>();
  let dir12Rank = -1;
  const gen = buildLibraryIndex(makeRoot(), null, null, () => false, () => 'dir12');
  for await (const b of gen) {
    for (const e of b) {
      if (!seen.has(e.dirName)) {
        seen.add(e.dirName);
        if (e.dirName === 'dir12') dir12Rank = seen.size;
      }
    }
  }
  assert(dir12Rank > 0 && dir12Rank <= 8, `prio 目录 dir12 在首波 (第 ${dir12Rank} 个完成, 并发度 8)`);
  void order;
}

// ---- 5. 取消: 首批后取消, generator 及时收尾 ----
{
  let cancel = false;
  let batches = 0;
  const all = await drain(buildLibraryIndex(makeRoot(), null, null, () => cancel), () => { batches++; if (batches >= 1) cancel = true; });
  assert(batches <= 3, `取消后 generator 及时停止 (批次数 ${batches})`);
  void all;
}

// ---- 6. 骨架枚举并发: 24 目录串行 480ms → 并发远低于一半 ----
{
  const dirs: { name: string; handle: FsDirLike }[] = [];
  for (let d = 0; d < N_DIRS; d++)
    dirs.push({ name: `dir${d}`, handle: fakeDir(`dir${d}`, [[`A - B (C) [D${d}].osu`, fakeFile('', 0, 0)]]) });
  const t0 = Date.now();
  const all = await drain(enumerateDifficultySkeletons(dirs, () => false));
  const wall = Date.now() - t0;
  assert(all.length === N_DIRS, `骨架条目齐全 (${N_DIRS}, 实际 ${all.length})`);
  assert(all.every(e => e.partial === true && e.version.startsWith('D')), '骨架按文件名解析 (partial + version)');
  const serial = N_DIRS * LAT_LIST;
  assert(wall < serial / 2, `骨架枚举并发提速: ${wall}ms < ${serial / 2}ms`);
  console.log(`  [计时] 骨架枚举 ${wall}ms (串行估算 ${serial}ms)`);
}

// ---- 7. parseIndexEntry 结果与并发池产出一致 (抽样) ----
{
  const all = await drain(buildLibraryIndex(makeRoot(), null, null, () => false));
  const e = all.find(x => x.dirName === 'dir5')!;
  const ref = parseIndexEntry(OSU(5), 'dir5', e.fileName, e.size, e.lastModified);
  assert(e.title === ref.title && e.artist === ref.artist && e.bpm === ref.bpm && e.cs === ref.cs, '并发池产出 = parseIndexEntry 直出');
}

if (failures) { console.error(`V469_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V469_TESTS_PASSED');
