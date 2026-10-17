// 验证器 v444: 刷新谱面音频文件未变时不重新解码
// 根因: loadDifficulty 每次新建 blob URL, setAudio 按 URL 判新旧 -> 刷新必重新 fetch+decodeAudioData (秒级)
// 修复: library.ts 给出 audioKey (name:size:lastModified); store 单条缓存 audioCache,
//   setAudio 命中即复用 AudioBuffer (跳过 fetch/解码/元数据探针), 解码成功才写缓存。
// 运行: node verifier/v444/check.mjs (纯源码断言, 无需 build)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('library.ts: audioKey 文件身份');
{
  const lib = read('src/osu/library.ts');
  assert(/audioKey: string \| null;/.test(lib), 'LoadedSong.audioKey 字段');
  assert(/audioKey: audio \? `\$\{audio\.name\}:\$\{audio\.size\}:\$\{audio\.lastModified\}` : null/.test(lib), 'audioKey = name:size:lastModified');
}

section('store.ts: 解码缓存');
{
  const st = read('src/osu/store.ts');
  assert(/private audioCache: \{ key: string; buffer: AudioBuffer \} \| null = null;/.test(st), 'audioCache 单条缓存字段');
  assert(/setAudio\(url: string \| null, audioKey: string \| null = null\)/.test(st), 'setAudio 收 audioKey');
  assert(/this\.audioCache\?\.key === audioKey/.test(st), '命中判定');
  const hit = st.match(/if \(url && audioKey && this\.audioCache\?\.key === audioKey\) \{[\s\S]{0,400}?return;\s*\}/)?.[0] ?? '';
  assert(hit.includes('this.audioBuffer = this.audioCache.buffer'), '命中复用 AudioBuffer');
  assert(hit.includes('this.audioMetaDuration = this.audioBuffer.duration'), '命中直填时长 (跳过 v442 探针)');
  assert(hit.includes('this.emit()'), '命中后 emit');
  assert(/if \(audioKey\) this\.audioCache = \{ key: audioKey, buffer: decoded \};/.test(st), '解码成功才写缓存');
  assert(/this\.setAudio\(audioUrl, audioKey\); \/\/ v444/.test(st), 'load 透传 audioKey');
}

section('调用点接线 (loadDifficulty 三链路)');
{
  assert(/store\.load\(r\.bm, r\.audioUrl, r\.bgUrl, r\.samples, src, r\.audioKey\)/.test(read('src/App.tsx')), 'App 刷新谱面接线');
  assert(/store\.load\(r\.bm, r\.audioUrl, r\.bgUrl, r\.samples, \{ dir: d\.handle, fileName \}, r\.audioKey\)/.test(read('src/components/SongLibrary.tsx')), '曲库打开接线');
  assert(/store\.load\(r\.bm, r\.audioUrl, r\.bgUrl, r\.samples, \{ dir, fileName: file \}, r\.audioKey\)/.test(read('src/osu/electronMenu.ts')), '菜单/恢复打开接线');
}

section('编译');
{
  execSync('node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc 通过');
}

console.log(failures ? `\nVERIFIER_V444_FAILED: ${failures} 处失败` : '\nVERIFIER_V444_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
