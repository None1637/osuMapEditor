// 验证器 v211: 锁定间距移除 0.25 拍下限 (对齐 lazer DurationToDistance 无下限; 亚 0.25 拍间隔按比例缩放)
// 运行: node verifier/v211/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }

section('spacing 纯函数单测 (tests.ts)');
{
  const out = path.join(root, 'verifier/v211/_bundle.mjs');
  execSync(`npx esbuild "${path.join(root, 'verifier/v211/tests.ts')}" --bundle --platform=node --outfile="${out}"`, { cwd: root, stdio: 'pipe' });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '    ' + l).join('\n'));
}

section('spacing.ts: 下限移除');
{
  const src = fs.readFileSync(path.join(root, 'src/osu/spacing.ts'), 'utf8');
  assert(/const beats = Math\.max\(0, \(time - endTime\) \/ red\.beatLength\);/.test(src), '拍数下限 0');
  assert(!/Math\.max\(0\.25,/.test(src), '0.25 下限已删');
  // distanceLockDistance 仍是放置/拖拽共用入口 (EditorCanvas 两处调用不变)
  const canvas = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
  const n = (canvas.match(/distanceLockDistance\(bm, ref\.endTime/g) ?? []).length;
  assert(n === 2, `EditorCanvas 放置/拖拽两处共用 distanceLockDistance (实际 ${n})`);
}

if (failures) { console.error(`V211 FAILED: ${failures}`); process.exit(1); }
console.log('V211 ALL PASSED');
