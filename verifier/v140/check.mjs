// 验证器 v140: 脏标记按内容指纹判断 — 无实际改动/撤销回保存态时不显示未保存
// 背景: v120 在 pushUndo 统一埋点 setDirty(true) — 只要操作过 (即使没实际改动, 或撤销回原状) 就显示未保存。
// 修复: savedFingerprint (保存/载入时六段快照 JSON 基准) + refreshDirty (当前指纹 !== 基准 => 脏),
//   挂 emit() 漏斗 (所有数据变更含 undo/redo/拖拽提交都经过); pushUndo 不再盲置脏; load/save 更新基准。
// 运行: node verifier/v140/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v140/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v140/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V140_TESTS_*)
fs.unlinkSync(out);

section('dirtyFingerprint.ts: 纯函数模块');
{
  const src = readSrc('src/osu/dirtyFingerprint.ts');
  assert(/export function dirtyFingerprint\(bm: Beatmap\): string/.test(src), 'dirtyFingerprint 导出');
  assert(/bm\.hitObjects, bm\.timingPoints, bm\.difficulty, bm\.editor, bm\.general, bm\.metadata/.test(src), '六段数据 = snapshot() 同范围');
}

section('store.ts: 指纹基准与重算');
{
  const src = readSrc('src/osu/store.ts');
  assert(/import \{ dirtyFingerprint \} from '\.\/dirtyFingerprint'/.test(src), '引入 dirtyFingerprint');
  assert(/private savedFingerprint: string \| null = null;/.test(src), 'savedFingerprint 基准字段');
  assert(/private refreshDirty\(\)/.test(src) && /this\.setDirty\(this\.fingerprint\(\) !== this\.savedFingerprint\)/.test(src), 'refreshDirty: 指纹 !== 基准 => 脏');
  assert(/emit\(\) \{ this\.version\+\+; this\.dataVersion\+\+; this\.refreshDirty\(\);/.test(src), 'refreshDirty 挂 emit() 漏斗 (undo/redo/拖拽提交均经过)');
  // load/save 更新基准
  const li = src.indexOf('load(bm: Beatmap');
  assert(/this\.savedFingerprint = this\.fingerprint\(\); \/\/ v140: 载入内容成为干净基准/.test(src.slice(li, li + 800)), 'load: 载入内容成为干净基准');
  const si = src.indexOf('async save()');
  assert(/this\.savedFingerprint = this\.fingerprint\(\); \/\/ v140: 保存内容成为新的干净基准/.test(src.slice(si, si + 800)), 'save: 保存内容成为新基准');
  // pushUndo 不再盲置脏
  const pi = src.indexOf('pushUndo() {');
  assert(!/setDirty\(true\)/.test(src.slice(pi, pi + 400)), 'pushUndo 不再 setDirty(true) (无实际改动不脏)');
}

console.log(failures ? `\nV140_CHECK_FAILED: ${failures}` : '\nV140_CHECK_PASSED');
process.exit(failures ? 1 : 0);
