// 验证器 v403: 曲库两改进 —
//   1) 未索引 (骨架) 谱面按文件名中有的信息可搜 (artist/title/creator/[diff]/自由文本);
//      仅数值/length/keys/mode/tag/source 等文件内容条件才排除骨架并提示等待索引
//   2) 选中骨架谱面立即按需解析其目录插队升级 (右侧不再一直"索引中"; 叠加层幂等, 后台批次同 key 覆盖)
// 运行: cd app && node verifier/v403/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v403/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v403/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('librarySearch.ts: 骨架可答条件');
{
  const src = readSrc('src/osu/librarySearch.ts');
  assert(/export function partialQueryNeedsIndex/.test(src), 'partialQueryNeedsIndex 导出');
  assert(/export function matchLibraryEntryPartial/.test(src), 'matchLibraryEntryPartial 导出');
  assert(/PARTIAL_TEXT_KEYS = new Set\(\['artist', 'title', 'creator', 'author', 'mapper', 'diff'\]\)/.test(src),
    '文件名可答键 = artist/title/creator/author/mapper/diff');
}

section('SongLibrary.tsx: 骨架参与搜索 + 提示条件收窄');
{
  const src = readSrc('src/components/SongLibrary.tsx');
  assert(/e\.partial \? matchLibraryEntryPartial\(query, e\) : matchLibraryEntry\(query, e\)/.test(src), '骨架走 partial 匹配');
  assert(/needsIndexHint = indexing && filter\.trim\(\)\.length > 0 && partialQueryNeedsIndex\(query\)/.test(src),
    '等待索引提示仅在含文件内容条件时显示');
  assert(!/queryHasConds/.test(src), '旧 queryHasConds 排除逻辑移除');
}

section('SongLibrary.tsx: 选中谱面插队解析');
{
  const src = readSrc('src/components/SongLibrary.tsx');
  assert(/upgradesRef = useRef\(new Map<string, LibraryIndexEntry>\(\)\)/.test(src), '升级叠加层 upgradesRef');
  assert(/demandParsedRef = useRef\(new Set<string>\(\)\)/.test(src), '防重复触发 demandParsedRef');
  assert(/if \(!e\?\.partial \|\| !e\.fileName\) return;/.test(src), '仅骨架条目触发插队解析');
  assert(/parseIndexEntry\(await file\.text\(\), dirName, name, file\.size, file\.lastModified\)/.test(src), '按需 parseIndexEntry 整目录');
  assert(/scanGenRef\.current !== myGen/.test(src), '扫描代数守卫 (关面板/重扫取消)');
  assert(/upgradesRef\.current\.clear\(\); demandParsedRef\.current\.clear\(\)/.test(src), '重扫清空升级层');
  assert(/viewEntries\.find\(e => entryKey\(e\) === selKey\)/.test(src), '详情走升级叠加层');
  assert(/viewEntries\.filter\(e => \(e\.partial/.test(src), '筛选走升级叠加层');
  assert(/v403/.test(src), 'v403 版本注释');
}

section('验证器适配标注');
{
  assert(/v403/.test(readSrc('verifier/v299/check.mjs')), 'v299 check 已适配 (骨架搜索断言)');
}

if (failures) { console.error(`V403 FAILED (${failures})`); process.exit(1); }
console.log('V403 ALL PASSED');
