// v293 数值测试: buildLibraryIndex 优先目录插队 (prio 回调每目录前取最新值)
import { buildLibraryIndex } from '../../src/osu/libraryIndex';
import type { FsDirLike } from '../../src/osu/library';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const OSU = (title: string) => `osu file format v14
[Metadata]
Title:${title}
[Difficulty]
CircleSize:4
[TimingPoints]
0,500,4,2,0,100,1,0
[HitObjects]
64,64,1000,1,0
`;

// 伪 FsDirLike: entries() 异步产出, getFile 返回 {size,lastModified,text}
function fakeFile(text: string) {
  return { kind: 'file', name: '', size: text.length, lastModified: 1, getFile: async () => ({ size: text.length, lastModified: 1, text: async () => text }) };
}
function fakeDir(files: Record<string, string>): FsDirLike {
  return {
    kind: 'directory', name: '',
    entries: (async function* () { for (const [n, t] of Object.entries(files)) yield [n, { ...fakeFile(t), name: n }] as never; }) as unknown as FsDirLike['entries'],
    getFileHandle: async (n: string) => ({ ...fakeFile(files[n]!), name: n }),
  } as unknown as FsDirLike;
}
function fakeRoot(dirs: Record<string, Record<string, string>>): FsDirLike {
  return {
    kind: 'directory', name: 'Songs',
    entries: (async function* () { for (const [n, d] of Object.entries(dirs)) yield [n, { ...fakeDir(d), name: n, kind: 'directory' }] as never; }) as unknown as FsDirLike['entries'],
    getFileHandle: async () => { throw new Error('n/a'); },
  } as unknown as FsDirLike;
}
async function collect(root: FsDirLike, prio?: () => string | null): Promise<string[]> {
  const order: string[] = [];
  for await (const batch of buildLibraryIndex(root, null, null, () => false, prio))
    for (const e of batch) order.push(e.dirName);
  return order;
}

const root = fakeRoot({ aDir: { 'a.osu': OSU('A') }, bDir: { 'b.osu': OSU('B') }, cDir: { 'c.osu': OSU('C') } });

// 无 prio: 按枚举顺序
const plain = await collect(root);
assert(plain.join() === 'aDir,bDir,cDir', '无 prio 按枚举顺序: ' + plain.join());

// prio=cDir: 最先索引
const prioC = await collect(root, () => 'cDir');
assert(prioC[0] === 'cDir', 'prio 目录最先: ' + prioC.join());

// prio 动态变化: 第一次返回 bDir, 之后返回 aDir → bDir, aDir, cDir
let calls = 0;
const dyn = await collect(root, () => (++calls === 1 ? 'bDir' : 'aDir'));
assert(dyn.join() === 'bDir,aDir,cDir', 'prio 动态插队: ' + dyn.join());

// prio 指向不存在的目录: 不报错, 按原顺序
const bad = await collect(root, () => 'nope');
assert(bad.join() === 'aDir,bDir,cDir', 'prio 无效目录回退原顺序');

if (failures) { console.error(`\nV293_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV293_TESTS_PASSED');
