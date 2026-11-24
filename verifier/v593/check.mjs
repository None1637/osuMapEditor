// v593: 菜单行与页签行均不再作为窗口拖拽区
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const menu = fs.readFileSync(path.join(root, 'src/components/MenuBar.tsx'), 'utf8');
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
assert(app.includes("style={hideTitleBar ? { WebkitAppRegion: 'no-drag' }"), '页签行 hideTitleBar 时 no-drag');
assert(!app.includes("testPlay ? 'no-drag' : 'drag'"), '页签行不再按游玩状态切换 drag');
assert(menu.includes("const DRAG = { WebkitAppRegion: 'drag' }"), 'v594: 菜单行 drag, 页签行 no-drag');
console.log(failures ? `\nVERIFIER_V593_FAILED: ${failures}` : '\nVERIFIER_V593_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
