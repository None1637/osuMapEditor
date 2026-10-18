// 验证器 v454: Alt+拖滑条尾改 SV — 恢复绿线改插后续滑条头 (不再插当前滑条尾)
//   用户要求: 后续有滑条且 (当前滑条头, 后续滑条头] 内无红/绿线遮挡时, 把恢复 svOld 的绿线插到后续滑条头;
//   后续滑条头前已有绿线 (或任何硬 SV 边界) 则不插; 无后续滑条则完全不插。
// 运行: cd app && node verifier/v454/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v454/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v454/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('timingSv.ts: svRestoreTargetAt 纯函数');
{
  const src = readSrc('src/osu/timingSv.ts');
  assert(/v454/.test(src), 'v454 版本注释');
  assert(/export function svRestoreTargetAt\([\s\S]*?afterTime: number,[\s\S]*?\): number \| null/.test(src), '签名 (points, hitObjects, afterTime) → number|null');
  assert(/h\.type === 'slider' && h\.time > afterTime/.test(src), '后续滑条 = 起始时间晚于当前滑条的第一条滑条');
  assert(/points\.some\(p => p\.time > afterTime && p\.time <= nextHead\)/.test(src), '(afterTime, 后续滑条头] 内有线则不插');
}

section('Timelines.tsx: applySvTailDrag 接入');
{
  const src = readSrc('src/components/Timelines.tsx');
  const fn = src.match(/function applySvTailDrag[\s\S]*?\n\}\n/)?.[0] ?? '';
  assert(fn.length > 0, 'applySvTailDrag 存在');
  assert(!/spanClear/.test(fn) && !/time: targetEnd/.test(fn), '不再往当前滑条尾插恢复绿线');
  assert(/if \(tr\.restore\) \{ const i = tps\.indexOf\(tr\.restore\);/.test(fn), '逐帧先摘上一帧恢复线 (在遮挡查询之前)');
  assert(/const restoreAt = svRestoreTargetAt\(tps, bm\.hitObjects, o\.time\);/.test(fn), '插入位置 = svRestoreTargetAt (后续滑条头)');
  // v455: sameSv 更名 restored (按未钳制 svReq 判定), 且恢复线插入并入 !restored 块
  // v457: 插入再受 editorPrefs.svTailRestore 总开关门控 (关 = 不插还原线)
  assert(/if \(!restored && editorPrefs\.svTailRestore\) \{[\s\S]*?if \(restoreAt !== null\)/.test(fn), '拖回原时长 (restored) / svTailRestore 关 不插');
  assert(/time: restoreAt, beatLength: beatLengthForSv\(tr\.svOld\)/.test(fn), '恢复绿线还原 svOld 且插在 restoreAt');
}

if (failures) { console.error(`V454 FAILED (${failures})`); process.exit(1); }
console.log('V454 ALL PASSED');
