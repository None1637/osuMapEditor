// 验证器 v323: 曲库卡死修复 (用户反馈: 曲库改搜索后经常卡死, 无操作也卡死, 关不掉/杀不掉)
//   根因 1: /api/local-fs/* 处理器用 readdirSync/readFileSync/writeFileSync — exe 索引期间渲染端
//     连发数千个请求, Electron 主进程事件循环被同步磁盘 I/O 占满, OS 判窗口未响应且无法关闭
//   根因 2: 关闭曲库面板不取消进行中的扫描 (zombie scan) — exe 服务器直读走主线程回退路径,
//     用户回编辑器"什么都没做"时后台仍在连发请求+逐文件解析
//   修复: 处理器全异步 (fs.promises) + SongLibrary 卸载时 bump scanGenRef 取消扫描
// 运行: node verifier/v323/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const core = readSrc('server/localFsCore.mjs');
const main = readSrc('electron/main.cjs');
const vite = readSrc('vite.config.ts');
const lib = readSrc('src/components/SongLibrary.tsx');

section('a) localFsCore 全异步 (无同步 fs 残留)');
{
  assert(!/fs\.(readdirSync|readFileSync|writeFileSync)\(/.test(core), 'localFsCore 无同步 fs 调用 (注释提及不算)');
  assert(/fs\.promises\.readdir/.test(core) && /fs\.promises\.readFile/.test(core) && /fs\.promises\.writeFile/.test(core), '三处均走 fs.promises');
  assert(/return async \(method, pathname, searchParams, body\)/.test(core), 'handler 为 async 函数');
  assert(/req\.on\("end", async \(\) => \{\s*\n\s*\/\/ v323[\s\S]{0,300}?await handleLocalFs/.test(main), 'electron/main.cjs await 异步 handler');
  assert(/req\.on\("end", async \(\) => \{\s*\n\s*const r = await handleLocalFs/.test(vite), 'vite.config.ts await 异步 handler');
  assert(/Promise<null \| \{ status: number/.test(readSrc('server/localFsCore.d.mts')), '类型声明同步为 Promise');
}

section('b) 关闭曲库面板取消扫描');
{
  const unmount = lib.match(/useEffect\(\(\) => \(\) => \{[\s\S]{0,900}?\}, \[\]\);/);
  assert(!!unmount, '卸载 cleanup effect 存在');
  assert(!!unmount && /scanGenRef\.current\+\+/.test(unmount[0]), '卸载时 bump scanGenRef (进行中的扫描批内取消)');
  assert(!!unmount && unmount[0].indexOf('scanGenRef.current++') < unmount[0].indexOf('libraryCache = {'), '先取消再写会话缓存');
}

section('c) 功能回归: 异步 handler 行为不变');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v323-'));
  try {
    fs.mkdirSync(path.join(tmp, '12345 Artist - Title'));
    fs.writeFileSync(path.join(tmp, '12345 Artist - Title', 'a.osu'), 'osu file format v14\n');
    fs.writeFileSync(path.join(tmp, '12345 Artist - Title', 'b.osu'), 'osu file format v14\n\n[Metadata]\nTitle: X\n');
    const { createLocalFsHandler } = await import(path.join(root, 'server/localFsCore.mjs').startsWith('/') ? 'file://' + path.join(root, 'server/localFsCore.mjs') : 'file:///' + path.join(root, 'server/localFsCore.mjs').replace(/\\/g, '/'));
    const h = createLocalFsHandler(() => ({ songs: tmp, skin: null }));
    const P = (p, q) => h('GET', p, new URLSearchParams(q));

    const cfg = await P('/api/local-fs/config', '');
    assert(cfg.status === 200 && JSON.parse(cfg.body).songsDir === tmp, 'config 返回根目录');

    const list = await P('/api/local-fs/list', 'root=songs&rel=');
    assert(list.status === 200 && JSON.parse(list.body)[0].kind === 'directory', 'list 列目录');

    const sub = await P('/api/local-fs/list', 'root=songs&rel=' + encodeURIComponent('12345 Artist - Title'));
    const names = JSON.parse(sub.body).map(e => e.name).sort();
    assert(names.length === 2 && names[0] === 'a.osu' && names[1] === 'b.osu', 'list 列文件');

    const file = await P('/api/local-fs/file', 'root=songs&rel=' + encodeURIComponent('12345 Artist - Title/a.osu'));
    assert(file.status === 200 && Buffer.from(file.body).toString().startsWith('osu file format v14'), 'file 读文件内容');

    const nf = await P('/api/local-fs/file', 'root=songs&rel=nope.osu');
    assert(nf.status === 404, '不存在文件 404');

    const esc = await P('/api/local-fs/list', 'root=songs&rel=' + encodeURIComponent('../../..'));
    assert(esc.status === 403, '越界 403');

    const noroot = await P('/api/local-fs/list', 'root=skin&rel=');
    assert(noroot.status === 404, '未配置 root 404');

    const w = await h('POST', '/api/local-fs/write', new URLSearchParams('root=songs&rel=' + encodeURIComponent('out.txt')), Buffer.from('hello'));
    assert(w.status === 200 && fs.readFileSync(path.join(tmp, 'out.txt'), 'utf8') === 'hello', 'write 写文件');

    const other = await P('/api/other', '');
    assert(other === null, '非本 API 返回 null');

    // 并发: 50 个并发 list 全部完成 (同步实现会串行阻塞事件循环, 异步实现交错完成)
    const t0 = Date.now();
    const rs = await Promise.all(Array.from({ length: 50 }, () => P('/api/local-fs/list', 'root=songs&rel=')));
    assert(rs.every(r => r.status === 200), `50 并发 list 全部 200 (${Date.now() - t0}ms)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

section('d) parseIndexEntry 巨型文件不卡 (逐行扫描首末行, 不 split 全文)');
{
  const li = readSrc('src/osu/libraryIndex.ts');
  assert(/function firstSignificantLine/.test(li) && /function lastSignificantLine/.test(li), '首/末行扫描助手存在');
  assert(!/ho\.split\('\\n'\)/.test(li), 'HitObjects 不再 split 全文');
  // 功能: esbuild 现打包直接测 (20MB 故事板谱)
  const out = path.join(root, 'verifier/v323/.libindex.tmp.mjs');
  execSync(`npx esbuild src/osu/libraryIndex.ts --bundle --format=esm --platform=node --outfile="${out}" --log-level=error`, { cwd: root, stdio: 'pipe' });
  try {
    const m = await import('file:///' + out.replace(/\\/g, '/'));
    const sb = 'Sprite,Pass,Centre,"SB/dot.png",320,240\n'.repeat(500000);
    const text = 'osu file format v14\n\n[Metadata]\nTitle: Big\n\n[Events]\n' + sb + '\n[HitObjects]\n// comment\n\n256,192,1000,1,0\n64,64,1500,1,0\n256,192,2000,12,0,5000\n// tail comment\n\n';
    const t0 = Date.now();
    const e = m.parseIndexEntry(text, 'dir', 'f.osu', text.length, 0);
    const ms = Date.now() - t0;
    assert(e.title === 'Big', '元数据正确');
    assert(e.lengthMs === 4000, `lengthMs = spinner end 5000 - 首物件 1000 (实际 ${e.lengthMs})`);
    assert(ms < 1000, `20MB 故事板谱解析 < 1s (实际 ${ms}ms; 旧 split/map/filter 全量遍历需数秒)`);
    // 小图常规行为: 末物件非 spinner → lengthMs = 尾起-首起
    const small = 'osu file format v14\n\n[Metadata]\nTitle: S\n\n[HitObjects]\n256,192,1000,1,0\n64,64,3000,1,0\n';
    assert(m.parseIndexEntry(small, 'd', 's.osu').lengthMs === 2000, '常规小图 lengthMs 正确');
  } finally {
    fs.rmSync(out, { force: true });
  }
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv323 全部通过');
process.exit(failures ? 1 : 0);
