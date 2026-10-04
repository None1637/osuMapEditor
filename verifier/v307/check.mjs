// 验证器 v307: 缩放窗口 x:y 比例固定 (锁定时改任一轴, 另一轴按当前比例联动)
// 运行: node verifier/v307/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('TransformDialog.tsx: x:y 比例固定');
{
  const src = readSrc('src/components/TransformDialog.tsx');
  assert(/const \[lockRatio, setLockRatio\] = useState\(\(\) => loadParams\('tf-scale', \{ lockRatio: false \}\)\.lockRatio\);/.test(src), 'lockRatio state (v315: 默认关, localStorage 保持上次状态)');
  assert(/if \(lockRatio && factor !== 0\) setFactorY\(round4\(v \* factorY \/ factor\)\);\s*\n\s*setFactor\(v\);/.test(src),
    '改 x → y 按当前比例联动');
  assert(/if \(lockRatio && factorY !== 0\) setFactor\(round4\(v \* factor \/ factorY\)\);\s*\n\s*setFactorY\(v\);/.test(src),
    '改 y → x 按当前比例联动');
  assert(/const round4 = \(v: number\) => Math\.round\(v \* 10000\) \/ 10000;/.test(src), '联动值保留 4 位小数');
  assert(/data-tf="lock-ratio"/.test(src) && /x:y 固定/.test(src), '锁定复选框 UI (data-tf=lock-ratio)');
  // 联动在 changeFactor/changeFactorY 内 — DraftNum 拖动/滚轮 (F06) 同走该入口, 自动生效
  assert(/<DraftNum value=\{factor\} set=\{changeFactor\}/.test(src) && /<DraftNum value=\{factorY\} set=\{changeFactorY\}/.test(src),
    '两个 DraftNum 均走联动入口 (拖动/滚轮调值同步联动)');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv307 全部通过');
process.exit(failures ? 1 : 0);
