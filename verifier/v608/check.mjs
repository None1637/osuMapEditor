// v608: n 角星支持隔点数 starStep
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v608/_bundle.mjs');
await build({ entryPoints: [path.join(root, 'verifier/v608/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const core = fs.readFileSync(path.join(root, 'src/osu/convert/polygon.ts'), 'utf8');
const dlg = fs.readFileSync(path.join(root, 'src/components/convert/PolygonDialog.tsx'), 'utf8');
const zh = fs.readFileSync(path.join(root, 'src/i18n/dicts/zh-CN/convert.ts'), 'utf8');
ok(core.includes('starStep: number') && core.includes('Math.max(1, Math.round(p.starStep)) + 1'), '角度步长 = starStep+1 且至少为 2');
ok(core.includes('starStep: 1') && core.includes('starStep: [1, 31]'), '默认隔点数 1, 范围 1..31');
ok(dlg.includes('params.star &&') && dlg.includes('testid="starStep"'), '仅 n 角星启用时显示隔点数输入框');
ok(zh.includes("'convert.polygon_star_step': '隔点数'"), '中文隔点数文案');
console.log(failures ? `VERIFIER_V608_FAILED: ${failures}` : 'VERIFIER_V608_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
