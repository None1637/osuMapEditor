// v594: 菜单行可拖/页签禁拖 + 对称实际尾拼接 + 合并长度不吸附
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v594/_bundle.mjs');
await build({ entryPoints: [path.join(root, 'verifier/v594/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const menu = fs.readFileSync(path.join(root, 'src/components/MenuBar.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const sym = fs.readFileSync(path.join(root, 'src/osu/convert/symSlider.ts'), 'utf8');
const merge = fs.readFileSync(path.join(root, 'src/osu/convert/merge.ts'), 'utf8');
assert(menu.includes("const DRAG = { WebkitAppRegion: 'drag' }"), '菜单行可拖动');
assert(app.includes("style={hideTitleBar ? { WebkitAppRegion: 'no-drag' }"), '页签行保持禁拖');
assert(sym.includes('let base = joinAnchor'), '最终拼接以实际滑条尾为链式对齐基准');
assert(merge.includes('length: Math.round(measureSegments(segs).total * 100) / 100') && !merge.includes('resnapSliderLength'), '合并长度不再节拍吸附');
console.log(failures ? `\nVERIFIER_V594_FAILED: ${failures}` : '\nVERIFIER_V594_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
