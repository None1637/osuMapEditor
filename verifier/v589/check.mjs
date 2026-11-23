// v589: 设置菜单配置拟合容差与最高贝塞尔阶数
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v589/_bundle.mjs');
await build({ entryPoints: [path.join(root, 'verifier/v589/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const conv = fs.readFileSync(path.join(root, 'src/osu/convert/convertB4.ts'), 'utf8');
const approx = fs.readFileSync(path.join(root, 'src/osu/freehand/pathApproximator.ts'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src/osu/electronBridge.ts'), 'utf8');
const route = fs.readFileSync(path.join(root, 'src/osu/electronMenu.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const dlg = fs.readFileSync(path.join(root, 'src/components/B4ConvertSettingsDialog.tsx'), 'utf8');
assert(conv.includes('setB4ConvertMaxDegree') && conv.includes('b4ConvertSettings.maxDegree'), '最高阶数持久化设置');
assert(approx.includes('maxError, maxDegree'), '高阶拟合使用阶数上限');
assert(main.includes('"menu.b4_convert_settings"') && main.includes('mT("menu.b4_convert_settings")'), '设置菜单项与三语文案');
assert(bridge.includes("settings-b4-convert") && route.includes('store.openB4ConvertSettings()'), 'bridge → 设置窗口路由');
assert(app.includes('store.b4ConvertSettingsOpen && <B4ConvertSettingsDialog />'), 'App 挂载设置窗口');
assert(dlg.includes('testid="fit-tolerance"') && dlg.includes('testid="max-degree"'), '窗口包含容差与阶数输入');
console.log(failures ? `\nVERIFIER_V589_FAILED: ${failures}` : '\nVERIFIER_V589_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
