// 验证器 v67: Ctrl+S 保存谱面 (stable 命名 / 三通道写回 / 服务器 write 端点)
// 运行: cd app && node verifier/v67/check.mjs; node verifier/v67/cdp-v67.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v67/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v67/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('saveMap.ts: 命名/路由/三通道');
{
  const src = readSrc('src/osu/saveMap.ts');
  assert(/replace\(\/\[\\\\\/:\*\?"<>\|\]\/g, ''\)/.test(src), 'stable 命名剔除非法字符');
  assert(/typeof d\.writeFile === 'function'\) return 'server'/.test(src), 'writeFile => server 通道');
  assert(/typeof d\.queryPermission === 'function'\) return 'native'/.test(src), '原生句柄 => native 通道');
  assert(/requestPermission\(\{ mode: 'readwrite' \}\)/.test(src), 'native 通道请求 readwrite 授权');
  assert(/route === 'download' \? mapFileName\(bm\) : source!\.fileName/.test(src), '写回用原文件名, 下载用 stable 命名');
}

section('store.ts: mapSource + save()');
{
  const src = readSrc('src/osu/store.ts');
  assert(/mapSource: MapSource \| null = null/.test(src), 'mapSource 字段');
  assert(/async save\(\): Promise<boolean>/.test(src) && /saveBeatmap\(this\.beatmap, this\.mapSource\)/.test(src), 'save() 调 saveBeatmap (v120: 返回是否成功)');
  assert(/r\.route === 'download' \? `已导出/.test(src) && /`已保存/.test(src), '保存反馈消息区分通道');
  assert(/lastSave: SaveOutcome \| null/.test(src), 'lastSave 测试挂钩');
  assert(/source: MapSource \| null = null\)/.test(src) && /this\.mapSource = source/.test(src), 'load() 接收来源');
}

section('App.tsx: Ctrl+S + 反馈 UI');
{
  const src = readSrc('src/App.tsx');
  assert(/e\.key\.toLowerCase\(\) === 's'\) \{ e\.preventDefault\(\); store\.save\(\)/.test(src), 'Ctrl+S 快捷键');
  assert(/data-save-message/.test(src) && /store\.saveMessage/.test(src), '保存反馈 (v81 起在右上角标题前缀)');
  assert(!/导出 \.osu<\/button>/.test(src), 'v81: 独立导出按钮已删除 (下载兜底仍在 store.save 内)');
  assert(/Ctrl\+S 保存谱面/.test(src), '快捷键帮助');
}

section('SongLibrary.tsx: 载入记录来源');
{
  const src = readSrc('src/components/SongLibrary.tsx');
  assert(/store\.load\(r\.bm, r\.audioUrl, r\.bgUrl, r\.samples, \{ dir: d\.handle, fileName \}\)/.test(src), 'openDiff 传 { dir, fileName }');
}

section('服务器 write 端点: core + vite + electron + 类型声明');
{
  const core = readSrc('server/localFsCore.mjs');
  assert(/\/api\/local-fs\/write/.test(core) && /fs\.writeFileSync\(abs, body\)/.test(core), 'write 端点写文件');
  assert(core.indexOf('!abs.startsWith(rootAbs + path.sep)') < core.indexOf('/api/local-fs/write'), '越界防护在 write 之前生效');
  const vite = readSrc('vite.config.ts');
  assert(/req\.on\("data"/.test(vite) && /Buffer\.concat\(chunks\)/.test(vite), 'vite 中间件收集请求体');
  const main = readSrc('electron/main.cjs');
  assert(/req\.on\("data"/.test(main) && /Buffer\.concat\(chunks\)/.test(main), 'electron 服务器收集请求体');
  const dts = readSrc('server/localFsCore.d.mts');
  assert(/body\?: Buffer/.test(dts), 'd.mts 声明同步');
}

section('serverFs.ts / library.ts: writeFile 能力');
{
  const srv = readSrc('src/osu/serverFs.ts');
  assert(/async writeFile\(n: string, content: string\)/.test(srv) && /api\/local-fs\/write\?root=/.test(srv), 'serverDir 实现 writeFile');
  const lib = readSrc('src/osu/library.ts');
  assert(/writeFile\?\(name: string, content: string\): Promise<void>/.test(lib), 'FsDirLike 可选 writeFile');
}

if (failures) { console.error(`\nVERIFIER_V67_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V67_ALL_PASSED');
