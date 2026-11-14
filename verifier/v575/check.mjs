// v575: exe 曲库 manifest+批读索引与中途关闭会话续扫
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outBundle = path.join(root, 'verifier/v575/_bundle.mjs');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 服务器索引纯函数');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v575/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: outBundle });
  console.log(execSync(`node "${outBundle}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(outBundle)) fs.unlinkSync(outBundle); }

console.log('== B: 源码契约');
{
  const core = read('server/localFsCore.mjs'), sf = read('src/osu/serverFs.ts'), lib = read('src/components/SongLibrary.tsx');
  assert(core.includes('/api/local-fs/tree') && core.includes('/api/local-fs/read-batch'), 'tree/read-batch 端点');
  assert(core.includes('TREE_CONCURRENCY') && core.includes('READ_BATCH_MAX'), '目录并发与批大小有界');
  assert(sf.includes('fetchServerFileTree') && sf.includes('readServerFileBatch'), '前端批量通道');
  assert(lib.includes('h.serverRel === undefined ? await collectDirs') && lib.includes('scanServerLibraryIndex'), 'exe 跳过逐目录 HTTP 并走快速索引');
  assert(lib.includes('preserveView = false') && lib.includes('startScan(mem.dir, mem.native, false, true)'), '未完成会话缓存原地续扫');
  assert(lib.includes('complete: scanDoneRef.current'), '关闭时保存扫描完成标记');
}

console.log('== C: 临时曲库端点功能');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v575-'));
  try {
    fs.mkdirSync(path.join(tmp, 'set', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'set', 'a.osu'), 'osu file format v14\n[Metadata]\nTitle: A\n');
    fs.writeFileSync(path.join(tmp, 'set', 'b.osu'), 'osu file format v14\n[Metadata]\nTitle: B\n');
    fs.writeFileSync(path.join(tmp, 'set', 'nested', 'c.osu'), 'osu file format v14\n[Metadata]\nTitle: C\n');
    fs.writeFileSync(path.join(tmp, 'set', 'skip.txt'), 'not osu');
    const { createLocalFsHandler } = await import('file:///' + path.join(root, 'server/localFsCore.mjs').replace(/\\/g, '/'));
    const h = createLocalFsHandler(() => ({ songs: tmp, skin: null }));
    const tree = await h('GET', '/api/local-fs/tree', new URLSearchParams('root=songs'));
    const files = JSON.parse(tree.body).files;
    assert(tree.status === 200 && files.length === 3 && files.every(f => f.rel.endsWith('.osu') && f.size > 0 && f.lastModified > 0), 'tree 递归返回 .osu manifest');
    const batch = await h('POST', '/api/local-fs/read-batch', new URLSearchParams('root=songs'), Buffer.from(JSON.stringify({ files: ['set/a.osu', 'set/b.osu'] })));
    const got = JSON.parse(batch.body).files;
    assert(batch.status === 200 && got.length === 2 && got[0].text.includes('Title: A'), 'read-batch 按批返回文本与元数据');
    const tooLarge = await h('POST', '/api/local-fs/read-batch', new URLSearchParams('root=songs'), Buffer.from(JSON.stringify({ files: Array(17).fill('set/a.osu') })));
    assert(tooLarge.status === 400, '超过批大小拒绝');
    const traversal = await h('POST', '/api/local-fs/read-batch', new URLSearchParams('root=songs'), Buffer.from(JSON.stringify({ files: ['../outside.osu'] })));
    assert(JSON.parse(traversal.body).files.length === 0, '批读越界不返回外部内容');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

console.log(failures ? `\nVERIFIER_V575_FAILED: ${failures} 处失败` : '\nVERIFIER_V575_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
