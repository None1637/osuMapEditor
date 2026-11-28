// v612: 文件菜单另存为新难度 + Song Setup 草稿 + 清空物件确认 + 跳转 0ms
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const main = read('electron/main.cjs');
const bridge = read('src/osu/electronBridge.ts');
const app = read('src/App.tsx');
const dialog = read('src/components/SaveAsDifficultyDialog.tsx');
const store = read('src/osu/store.ts');
const dict = read('src/i18n/dicts/zh-CN/setup.ts');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

ok(main.includes('"menu.save_as_difficulty"') && main.includes('send({ type: "save-as-difficulty" })'), '文件菜单新增另存为新难度并发送命令');
ok(bridge.includes("{ type: 'save-as-difficulty' }") && app.includes("cmd.type === 'save-as-difficulty'"), '菜单命令类型与 App 接线完整');
ok(app.includes('<SaveAsDifficultyDialog') && app.includes("setTab('edit')"), '打开独立 Song Setup, 成功后回到 compose');
ok(dialog.includes('structuredClone(store.beatmap!)') && dialog.includes('data-dialog="save-as-difficulty"'), 'Song Setup 使用独立草稿, 取消不修改当前谱面');
ok(dialog.includes('setup.save_as_version_same') && dialog.includes('mapFileName(draft) === store.mapSource?.fileName'), '强制不同难度名并防止覆盖原文件');
ok(dialog.includes('window.confirm') && dialog.includes('store.saveAsDifficulty(draft, clearObjects)'), '设置完成后询问是否清除所有物件');
ok(dict.includes("'setup.save_as_clear_confirm': '要清除所有物件并重新开始么？'"), '中文清空确认文案');
ok(store.includes('createDifficultyCopy(draft, clearObjects)') && store.includes('this.seek(0)'), '保存副本后无论是否清空都跳转 0ms');
ok(store.indexOf('const r = await saveBeatmap(beatmap, target);', store.indexOf('async saveAsDifficulty')) < store.indexOf('this.beatmap = beatmap;', store.indexOf('async saveAsDifficulty')), '新文件写入成功后才切换当前谱面');
ok(store.includes('if (fileName === source.fileName) return false;'), '底层禁止另存覆盖原文件');

const out = path.join(root, 'verifier/v612/_bundle.mjs');
await build({ entryPoints: [path.join(root, 'verifier/v612/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
console.log(failures ? `VERIFIER_V612_FAILED: ${failures}` : 'VERIFIER_V612_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
