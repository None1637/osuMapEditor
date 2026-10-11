// 验证器 v393: pattern 库「不记录物件音效」勾选框
// 运行: cd app && node verifier/v393/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v393/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v393/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('patternLibrary.ts: makePattern 支持 noHitsound');
{
  const src = readSrc('src/osu/patternLibrary.ts');
  assert(/opts: \{ noHitsound\?: boolean \} = \{\}/.test(src), 'makePattern 接收 noHitsound 选项');
  assert(/hitSound: opts\.noHitsound \? 0 : \(o\.hitSound \?\? 0\)/.test(src), 'noHitsound 时 hitSound 归零');
  assert(/hitSampleRaw: opts\.noHitsound \? undefined : o\.hitSampleRaw/.test(src), 'noHitsound 时不存 hitSampleRaw');
  assert(/edgeSoundsRaw: opts\.noHitsound \? undefined : o\.edgeSoundsRaw/.test(src), 'noHitsound 时不存 edgeSoundsRaw');
  assert(/edgeSetsRaw: opts\.noHitsound \? undefined : o\.edgeSetsRaw/.test(src), 'noHitsound 时不存 edgeSetsRaw');
}

section('store.ts: patternNoHitsound 状态');
{
  const src = readSrc('src/osu/store.ts');
  assert(/patternNoHitsound = false/.test(src), '默认记录音效 (勾选框默认关)');
  assert(/setPatternNoHitsound\(b: boolean\)/.test(src), 'store.setPatternNoHitsound');
  assert(/makePattern\([\s\S]{0,200}\{ noHitsound: this\.patternNoHitsound \}/.test(src), '收藏时把选项传给 makePattern');
}

section('PatternPanel.tsx + zh-CN 词典');
{
  const panel = readSrc('src/components/PatternPanel.tsx');
  assert(/data-pattern-nohitsound/.test(panel), '勾选框 data-pattern-nohitsound');
  assert(/checked=\{store\.patternNoHitsound\}/.test(panel), '勾选状态绑定 store');
  assert(/onChange=\{e => store\.setPatternNoHitsound\(e\.target\.checked\)\}/.test(panel), '勾选切换 store');
  const dict = readSrc('src/i18n/dicts/zh-CN/pattern.ts');
  assert(dict.includes("'pattern.no_hitsound': '不记录物件音效'"), 'zh-CN: 不记录物件音效');
  assert(/'pattern\.no_hitsound_hint':/.test(dict), 'zh-CN: no_hitsound_hint');
}

if (failures) { console.error(`V393 FAILED (${failures})`); process.exit(1); }
console.log('V393 ALL PASSED');
