// v592: 多边形可选生成 n 角星 (内外顶点交替)
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v592/_bundle.mjs');
await build({ entryPoints: [path.join(root, 'verifier/v592/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const src = fs.readFileSync(path.join(root, 'src/osu/convert/polygon.ts'), 'utf8');
const dlg = fs.readFileSync(path.join(root, 'src/components/convert/PolygonDialog.tsx'), 'utf8');
const dict = fs.readFileSync(path.join(root, 'src/i18n/dicts/zh-CN/convert.ts'), 'utf8');
assert(src.includes('(p.star ? 2 : 1) * ((2 * Math.PI) / p.vertices)') && src.includes('const r = radius'), '全外半径的跨点星形连接');
assert(dlg.includes('data-conv="star"'), '勾选框');
assert(dict.includes("'convert.polygon_star': '生成 n 角星'"), '中文功能文案');
console.log(failures ? `\nVERIFIER_V592_FAILED: ${failures}` : '\nVERIFIER_V592_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
