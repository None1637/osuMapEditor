// v115 源码接线断言: 锁定物件 (stable Lock Notes) — 左侧栏开关 + 全部物件变更入口守卫
// 运行: node verifier/v115/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const store = read('src/osu/store.ts');
const cv = read('src/components/EditorCanvas.tsx');
const tl = read('src/components/Timelines.tsx');
const insp = read('src/components/Inspector.tsx');
const app = read('src/App.tsx');

// store: 状态 + 方法级守卫
assert(/lockNotes = false;/.test(store), 'store: lockNotes 字段 (默认关)');
assert(/const delObjs = this\.selected\.size > 0 && !this\.lockNotes/.test(store), 'deleteSelected: 锁定时跳过物件 (绿线照删)');
assert(/const moveObjs = this\.selected\.size > 0 && !this\.lockNotes/.test(store), 'nudgeSelected: 锁定时跳过物件 (绿线照动)');
assert(/nudgeSelectedPosition\(dx: number, dy: number\) \{\s*if \(!this\.beatmap \|\| !this\.selected\.size \|\| \(!dx && !dy\) \|\| this\.lockNotes\) return;/.test(store), 'nudgeSelectedPosition: 锁定守卫');
assert(/private applyTransform[\s\S]{0,150}if \(this\.lockNotes\) return;/.test(store), 'applyTransform (旋转/镜像/缩放): 锁定守卫');
assert(/reverseSelected\(\) \{\s*const bm = this\.beatmap;\s*if \(!bm \|\| this\.lockNotes\) return;/.test(store), 'reverseSelected: 锁定守卫');
assert(/private applyToSelected[\s\S]{0,100}if \(this\.lockNotes\) return;/.test(store), 'applyToSelected (hitsound/newCombo/hitSample): 锁定守卫');
assert(/updateObject\(o: HitObject\) \{\s*if \(!this\.beatmap \|\| this\.lockNotes\) return;/.test(store), 'updateObject: 锁定守卫');
assert(/if \(this\.lockNotes && removeIds\.length\) return;/.test(store), 'applyConversion: 删源转换被拦, 纯新增放行');
assert(!/addObject[\s\S]{0,80}lockNotes/.test(store), 'addObject (放置新物件) 不加守卫');

// EditorCanvas: 拖拽/右键入口守卫
assert(/if \(quads0 && !store\.lockNotes\)/.test(cv), '画布: 旋转手柄锁定禁用');
assert(/if \(quads && !store\.lockNotes && scaleHandleAnchors/.test(cv), '画布: 缩放手柄锁定禁用');
assert(/if \(!store\.lockNotes && selObjs\.length === 1 && selObjs\[0\]\.type === 'slider'\)/.test(cv), '画布: 节点编辑锁定禁用');
assert(/if \(!store\.lockNotes\) \{ \/\/ v115: 锁定物件 — 可选中, 不可拖动/.test(cv), '画布: 物件拖拽锁定禁用 (选中保留)');
assert(/if \(store\.lockNotes\) return; \/\/ v115: 锁定物件 — 右键控制点操作与删除全禁/.test(cv), '画布: 右键 (select 工具) 锁定禁用');
assert(/if \(!hit \|\| store\.lockNotes\) return;/.test(cv), '画布: 通用右键删除锁定禁用');

// Timelines: 拖拽/右键入口守卫
assert(/const tailId = store\.lockNotes \? null : hitTestTail\(e\);/.test(tl), '时间轴: 拖尾改折返锁定禁用');
assert(/if \(!store\.lockNotes\) \{ \/\/ v115: 锁定物件 — 可选中, 不可拖动改时间/.test(tl), '时间轴: 物件拖拽锁定禁用 (选中保留)');
assert(/if \(store\.lockNotes\) return; \/\/ v115: 锁定物件 — 右键删除物件禁用 \(绿线不受影响\)/.test(tl), '时间轴: 右键删物件锁定禁用');

// Inspector: 直改路径守卫
assert(/const upd = \(patch: Partial<typeof o>\) => \{\s*if \(store\.lockNotes\) return;/.test(insp), 'Inspector: upd 锁定守卫');

// App: 左侧栏开关
assert(/data-lock-notes="toggle"/.test(app), '左侧栏: 锁定物件按钮 (测试挂钩)');
assert(/store\.lockNotes = !store\.lockNotes; store\.emitSelection\(\)/.test(app), '左侧栏: 开关切换 + emitSelection (UI 状态不 bump dataVersion)');
assert(/锁定物件 \(Lock Notes\): 开启后无法移动\/修改\/删除任何物件/.test(app), '左侧栏: 按钮提示文案');

console.log(failures ? `\nV115_CHECK_FAILED: ${failures}` : '\nV115_CHECK_PASSED');
process.exit(failures ? 1 : 0);
