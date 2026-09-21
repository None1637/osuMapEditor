// 验证器 v278: 网格吸附旋转角度与网格中心持久化 (重启恢复)。
// 需求: 用户反馈「加上记住网格吸附旋转角度和网格中心的功能, 关闭exe后下次打开能恢复成上次设置的样子」。
// 实现: store.ts 新增 LS_GRID_SETTINGS = 'osu-editor:grid-settings' (localStorage, Electron renderer 同样持久):
//   · loadGridSettings 模块级加载 (rotation 钳 ±180 / origin 钳游玩区 0..512,0..384 / custom 布尔),
//     字段 gridRotation/gridOrigin/gridOriginCustom 初始化用持久化值;
//   · 新增 setGridRotation setter (原 App.tsx 两处直接字段赋值改走 setter);
//     setGridOrigin/setGridOriginCustom/setGridRotation 内 saveGridSettings() 即时写盘。
// 运行: node verifier/v278/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const st = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
assert(/v278: 网格吸附设置持久化/.test(st), 'v278 注释在');
assert(/const LS_GRID_SETTINGS = 'osu-editor:grid-settings'/.test(st), 'LS key 定义');
assert(/function loadGridSettings\(\): GridSettingsPersist/.test(st), '加载函数 (含钳制)');
assert(/gridRotation = persistedGrid\.rotation/.test(st), '旋转角度初始化自持久化值');
assert(/gridOrigin: Pt = persistedGrid\.origin/.test(st), '网格中心初始化自持久化值');
assert(/gridOriginCustom = persistedGrid\.custom/.test(st), '自定义开关初始化自持久化值');
assert(/setGridRotation\(deg: number\) \{ this\.gridRotation = deg; saveGridSettings\(\); this\.emit\(\); \}/.test(st), 'setGridRotation setter 持久化');
assert((st.match(/saveGridSettings\(\); this\.emitSelection\(\); \} \/\/ v278/g) ?? []).length === 2, 'setGridOrigin/setGridOriginCustom 均持久化');

const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
assert(!/store\.gridRotation = /.test(app), 'App.tsx 不再直接赋值 gridRotation');
assert((app.match(/store\.setGridRotation\(/g) ?? []).length === 2, '两处旋转写入走 setter (类型归一 + 数值输入)');

if (failures) { console.error(`\nV278_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV278_ALL_PASSED');
