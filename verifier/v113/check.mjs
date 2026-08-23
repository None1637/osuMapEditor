// v113 源码接线断言: 绿线 Del/右键删除 + J/K 移动 + 复制粘贴绿线-滑条同刻对齐修复
// 运行: node verifier/v113/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const store = read('src/osu/store.ts');
const tl = read('src/components/Timelines.tsx');
const app = read('src/App.tsx');

// store: deleteSelected 支持绿线 (v115: 守卫重构为 delObjs/moveObjs 短路, 语义不变 — 仅绿线选区不再 early-return)
assert(/deleteSelected\(\) \{\s*if \(!this\.beatmap\) return;\s*const delObjs = this\.selected\.size > 0 && !this\.lockNotes;[\s\S]{0,150}if \(!delObjs && !this\.selectedGreenLines\.size\) return;/.test(store),
  'deleteSelected: 仅绿线选区不再 early-return (v115 结构)');
assert(/this\.beatmap\.timingPoints = this\.beatmap\.timingPoints\.filter\(tp => tp\.uninherited \|\| !this\.selectedGreenLines\.has\(tp\.time\)\);\s*this\.selectedGreenLines\.clear\(\);/.test(store),
  'deleteSelected: 按 time 键过滤绿线并清空选区 (红线不受影响)');

// store: 右键删除入口
assert(/deleteGreenLinesAt\(times: Iterable<number>\)/.test(store), 'store: deleteGreenLinesAt 方法');
assert(/const ts = new Set\(times\);[\s\S]{0,200}filter\(tp => tp\.uninherited \|\| !ts\.has\(tp\.time\)\)/.test(store),
  'deleteGreenLinesAt: 一次 undo + 过滤 + 选区同步');

// store: nudgeSelected 支持绿线 (v115: 同上 moveObjs 短路结构)
assert(/nudgeSelected\(ms: number\) \{\s*if \(!this\.beatmap \|\| !ms\) return;\s*const moveObjs = this\.selected\.size > 0 && !this\.lockNotes;\s*if \(!moveObjs && !this\.selectedGreenLines\.size\) return;/.test(store),
  'nudgeSelected: 仅绿线选区不再 early-return (v115 结构)');
assert(/if \(tp\.uninherited \|\| !this\.selectedGreenLines\.has\(tp\.time\)\) continue;\s*tp\.time \+= ms;\s*moved\.add\(tp\.time\);/.test(store),
  'nudgeSelected: 选中绿线平移并记录新键');
assert(/this\.beatmap\.timingPoints\.sort\(\(a, b\) => a\.time - b\.time\);\s*this\.selectedGreenLines = moved;/.test(store),
  'nudgeSelected: timingPoints 重排序 + 选区重键');

// store: 复制粘贴对齐修复 (v196 适配: 取整 round → floor, 与底部时间戳显示一致)
assert(/if \(c\.endTime !== undefined\) c\.endTime -= t0;/.test(store), 'copy: endTime 转相对时间');
assert(/o\.time = Math\.floor\(c\.time \+ atTime\);/.test(store), 'paste: 物件时间与绿线同路径取整 (v196: floor)');
assert(/o\.endTime = Math\.floor\(c\.endTime \+ atTime\)/.test(store), 'paste: endTime 同步平移取整 (v196: floor)');
assert(!/o\.time = c\.time \+ atTime;/.test(store), 'paste: 旧的不对称 (物件不取整) 已删');

// Timelines: 右键绿线药丸删除 (在物件命中之前, 红线不动作; v114 起选中药丸走 deleteSelected 删整个选区)
assert(/const pill = hitTestTimingPill\(e\);\s*if \(pill\) \{\s*if \(pill\.tp\.uninherited\) return;[\s\S]{0,250}if \(store\.selectedGreenLines\.has\(t\)\) store\.deleteSelected\(\);\s*else store\.deleteGreenLinesAt\(\[t\]\);[\s\S]{0,200}let id = hitTestMarker\(e\);/.test(tl),
  'onContextMenu: 绿线药丸右键删除 (选中->整区/未选中->该线, v114 语义), 先于物件命中');

// App: 快捷键路由不变 (Del -> deleteSelected, J/K -> nudgeSelectedBySnap, 两者内部已支持绿线)
assert(/if \(e\.key === 'Delete' \|\| e\.key === 'Backspace'\) \{ store\.deleteSelected\(\); return; \}/.test(app), 'App: Del/Backspace 路由');
// v209: 吸附步长公式下沉 store.nudgeSelectedBySnap (编辑菜单共用), App 只做路由; 公式本身在 store 断言
assert(/store\.nudgeSelectedBySnap\(k === 'j' \? -1 : 1\)/.test(app), 'App: J/K 路由 (nudgeSelectedBySnap)');
assert(/nudgeSelected\(Math\.round\(red\.beatLength \/ this\.beatSnap\) \* dir\)/.test(fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8')), 'store: 吸附步长公式不变');

console.log(failures ? `\nV113_CHECK_FAILED: ${failures}` : '\nV113_CHECK_PASSED');
process.exit(failures ? 1 : 0);
