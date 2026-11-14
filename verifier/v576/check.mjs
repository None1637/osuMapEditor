// v576: exe 大曲库分页渐进索引, 避免完整 manifest/IDB 阻塞首屏
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outBundle = path.join(root, 'verifier/v576/_bundle.mjs');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 分页清单生成器');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v576/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: outBundle });
  console.log(execSync(`node "${outBundle}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(outBundle)) fs.unlinkSync(outBundle); }

console.log('== B: 首屏不阻塞源码契约');
{
  const core = read('server/localFsCore.mjs'), sf = read('src/osu/serverFs.ts'), lib = read('src/components/SongLibrary.tsx');
  assert(core.includes('/api/local-fs/tree-page') && core.includes('nextOffset'), '服务端分页清单端点');
  assert(sf.includes('fetchServerFileTreePage') && sf.includes('nextOffset: number | null'), '前端分页类型与请求');
  assert(lib.includes('scanServerFileManifest') && !lib.includes('await fetchServerFileTree()'), '曲库不再等待完整 tree');
  assert(lib.indexOf('const cachedPromise') < lib.indexOf('for await (const files of scanServerFileManifest'), 'IDB 与服务器清单并行');
  assert(lib.includes('Promise.race([cachedPromise') && lib.includes('resolve(null), 2000'), 'IDB 读取有 2 秒回退');
  const loop = lib.slice(lib.indexOf('for await (const files of scanServerFileManifest'), lib.indexOf('cached = await Promise.race'));
  assert(loop.includes('all.push(...serverSkeletons(files))') && loop.includes('flushNow([...all])'), '每页骨架立即刷新到界面');
}

console.log('== C: 临时曲库分页端点');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v576-'));
  try {
    for (const dir of ['a', 'b', 'c']) {
      fs.mkdirSync(path.join(tmp, dir, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(tmp, dir, `${dir}.osu`), `osu file format v14\n[Metadata]\nTitle: ${dir}\n`);
    }
    fs.writeFileSync(path.join(tmp, 'c', 'nested', 'deep.osu'), 'not a top-level difficulty');
    fs.writeFileSync(path.join(tmp, 'root.txt'), 'skip');
    const { createLocalFsHandler } = await import('file:///' + path.join(root, 'server/localFsCore.mjs').replace(/\\/g, '/'));
    const h = createLocalFsHandler(() => ({ songs: tmp, skin: null }));
    const first = await h('GET', '/api/local-fs/tree-page', new URLSearchParams('root=songs&offset=0&limit=2'));
    const p1 = JSON.parse(first.body);
    assert(first.status === 200 && p1.total === 3 && p1.nextOffset === 2 && p1.files.length === 2, '首页只处理指定目录页并返回进度');
    const second = await h('GET', '/api/local-fs/tree-page', new URLSearchParams('root=songs&offset=2&limit=2'));
    const p2 = JSON.parse(second.body);
    assert(second.status === 200 && p2.nextOffset === null && p2.files.length === 1 && p2.files[0].rel === 'c/c.osu', '末页终止且保持原顶层目录语义');
    assert(!p2.files.some(f => f.rel.includes('deep.osu')), '分页不递归误入子目录');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

console.log(failures ? `\nVERIFIER_V576_FAILED: ${failures} 处失败` : '\nVERIFIER_V576_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
