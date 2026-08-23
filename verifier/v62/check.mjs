// 验证器 v62: 绿线音效集编辑 (.osu 绿行全字段) + 插入默认克隆生效点 (lazer addNew)
// 运行: cd app && node verifier/v62/check.mjs; node verifier/v62/cdp-v62.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v62/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v62/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('timingEdit.ts: 克隆语义 + effects 位');
{
  const src = readSrc('src/osu/timingEdit.ts');
  assert(/export function effectivePointAt/.test(src) && /p\.time > time\) continue/.test(src), 'effectivePointAt (同类 time<=t 最后一条)');
  assert(/export function defaultNewPoint/.test(src) && /\{ \.\.\.eff, time \}/.test(src), 'defaultNewPoint 克隆生效点全部字段');
  assert(/export const EFFECT_KIAI = 1/.test(src) && /export const EFFECT_OMIT_BARLINE = 8/.test(src), 'effects 位常量 (.osu bit0/bit3)');
  assert(/export function setEffectBit/.test(src), 'setEffectBit');
}

section('TimingPanel.tsx: 绿行音效集/序号/kiai 编辑 + 插入克隆');
{
  const src = readSrc('src/components/TimingPanel.tsx');
  assert(/defaultNewPoint\(bm\.timingPoints, t, uninherited\)/.test(src), '插入走 defaultNewPoint (lazer addNew 克隆)');
  assert(/data-tp-input="sampleSet"/.test(src), '音效集下拉 (Normal/Soft/Drum)');
  assert(/option value=\{1\}>Normal/.test(src) && /option value=\{2\}>Soft/.test(src) && /option value=\{3\}>Drum/.test(src), '音效集三选项');
  assert(/data-tp-input="sampleIndex"/.test(src), '自定义序号输入');
  assert(/data-tp-input="kiai"/.test(src) && /setEffectBit\(tp\.effects, EFFECT_KIAI/.test(src), 'kiai 勾选 (bit0)');
  assert(/data-tp-input="omitBar"/.test(src) && /tp\.uninherited && \(/.test(src), '省略小节线勾选 (仅红线, bit3)');
}

section('parser.ts: 绿行 8 字段完整往返 (既有能力, 编辑现在有 UI)');
{
  const src = readSrc('src/osu/parser.ts');
  assert(/\$\{t\.uninherited \? 1 : 0\},\$\{t\.effects\}/.test(src), '序列化含 effects (绿行 8 字段)');
}

if (failures) { console.error(`\nVERIFIER_V62_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V62_ALL_PASSED');
