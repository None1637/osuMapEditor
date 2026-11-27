// v611: 打开指定谱面支持 Songs 外目录; 只在找不到歌曲文件时提示
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const main = read('electron/main.cjs');
const preload = read('electron/preload.cjs');
const bridge = read('src/osu/electronBridge.ts');
const lib = read('src/components/SongLibrary.tsx');
const menu = read('src/osu/electronMenu.ts');
const app = read('src/App.tsx');
const store = read('src/osu/store.ts');
const serverFs = read('src/osu/serverFs.ts');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

ok(main.includes('root: "external"') && main.includes('folderAbs: path.dirname(abs)'), '目录外 .osu 返回 external 根和绝对目录');
ok(!main.includes('menu.beatmap_outside_songs') && !lib.includes("'error' in r"), '删除目录外错误提示与 UI 分支');
ok(main.includes('ipcMain.handle("use-external-beatmap-dir"') && main.includes('external: dirExists(externalBeatmapDir)'), '主进程仅在确认后注册外部读取根');
ok(preload.includes('useExternalBeatmapDir:') && bridge.includes('useExternalBeatmapDir(dir: string)'), '外部目录注册桥接完整');
ok(lib.includes('openServerDifficulty(r.folderRel, r.file, r.root, r.folderAbs)'), '曲库传递谱面来源根');
ok(menu.includes('await getElectronAPI()?.useExternalBeatmapDir(folderAbs)') && menu.includes('serverDir(root, folderRel, folderAbs || folderRel)'), '统一加载管线支持外部目录');
ok(menu.includes("if (r.audioMissing) alert(tNow('library.audio_missing'"), '仅缺少歌曲文件时弹出现有音频提示');
ok(app.includes('openServerDifficulty(r.folderRel, r.file, r.root, r.folderAbs)') && main.includes('folderAbs: r.folderAbs'), '最近打开保留外部谱面来源');
ok(store.includes("rel == null || serverRoot === 'external'"), '外部谱面慢放按音频字节走 BASS, 不误拼 Songs 路径');
ok(serverFs.includes("export type ServerRoot = 'songs' | 'skin' | 'external'") && serverFs.includes('serverRoot: root'), '读写目录保留外部根类型');

// 功能验证: external 根可读写实际文件, 同时维持目录越界防护
const tmp = fs.mkdtempSync(path.join(root, 'verifier/v611/.tmp-'));
try {
  const songs = path.join(tmp, 'Songs');
  const external = path.join(tmp, 'Elsewhere', 'Artist - Title');
  fs.mkdirSync(songs, { recursive: true });
  fs.mkdirSync(external, { recursive: true });
  fs.writeFileSync(path.join(external, 'map.osu'), 'osu file format v14\n');
  fs.writeFileSync(path.join(external, 'song.mp3'), 'audio');
  const { createLocalFsHandler } = await import(pathToFileURL(path.join(root, 'server/localFsCore.mjs')).href);
  const h = createLocalFsHandler(() => ({ songs, skin: null, external }));
  const P = (p, q) => h('GET', p, new URLSearchParams(q));
  const beatmap = await P('/api/local-fs/file', 'root=external&rel=map.osu');
  const audio = await P('/api/local-fs/file', 'root=external&rel=song.mp3');
  ok(beatmap.status === 200 && Buffer.from(beatmap.body).toString().startsWith('osu file format'), 'external 根实际读取目录外谱面');
  ok(audio.status === 200 && Buffer.from(audio.body).toString() === 'audio', 'external 根实际读取同目录歌曲');
  const escape = await P('/api/local-fs/file', 'root=external&rel=' + encodeURIComponent('../outside.osu'));
  ok(escape.status === 403, 'external 根仍拒绝 .. 越界');
  const written = await h('POST', '/api/local-fs/write', new URLSearchParams('root=external&rel=map.osu'), Buffer.from('updated'));
  ok(written.status === 200 && fs.readFileSync(path.join(external, 'map.osu'), 'utf8') === 'updated', '外部谱面保存写回原目录');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `VERIFIER_V611_FAILED: ${failures}` : 'VERIFIER_V611_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
