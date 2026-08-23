// 验证器 v136: 修复「废弃改动」无效 — 弹窗确认后动作重入 guardUnsaved 被二次拦截
// 根因: 切难度/开谱面/拖入文件的流程第一行都是 guardUnsaved(重入动作);
//   点「废弃改动」resolvePendingAction(true) 执行该动作 -> 重入 guardUnsaved -> 脏标记仍在 ->
//   再次拦截, pendingAction 重新设置, 弹窗重开 => 用户看来"点击没有任何效果"。
// 修复 (store.ts): bypassUnsavedOnce 一次性放行标记 — resolvePendingAction(true) 在标记下同步执行动作
//   (重入 guardUnsaved 首行消费标记直接放行; try/finally 保证动作未走 guard 时标记不外泄)。
// 运行: node verifier/v136/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const store = read('src/osu/store.ts');

assert(/private bypassUnsavedOnce = false;/.test(store), 'bypassUnsavedOnce 一次性放行标记');

// guardUnsaved: bypass 检查在脏检查之前 (重入先消费标记放行)
const gi = store.indexOf('guardUnsaved(action: () => void): boolean {');
const gbody = store.slice(gi, gi + 700);
assert(/if \(this\.bypassUnsavedOnce\) \{ this\.bypassUnsavedOnce = false; return true; \}/.test(gbody), 'guardUnsaved: bypass 命中 -> 消费标记放行');
assert(gbody.indexOf('bypassUnsavedOnce) { this.bypassUnsavedOnce = false') < gbody.indexOf('if (!this.beatmap || !this.dirty) return true;'), 'bypass 检查在脏检查之前');

// resolvePendingAction: run=true 时动作在标记下同步执行, try/finally 消费
const ri = store.indexOf('resolvePendingAction(run: boolean) {');
const rbody = store.slice(ri, ri + 500);
assert(/this\.bypassUnsavedOnce = true;/.test(rbody), 'resolvePendingAction: 执行动作前置位 bypass');
assert(/try \{ a\(\); \} finally \{ this\.bypassUnsavedOnce = false; \}/.test(rbody), '动作同步执行 + finally 消费标记 (不外泄)');
assert(rbody.indexOf('this.pendingAction = null') < rbody.indexOf('this.bypassUnsavedOnce = true'), '先清 pendingAction 再执行 (弹窗立即关闭)');

// 重入拦截点仍在 (修复依赖它们的重入第一行就是 guardUnsaved); v141: 拖入 .osz/.osu 两处随拖放导入功能废弃移除
const menu = read('src/osu/electronMenu.ts');
const lib = read('src/components/SongLibrary.tsx');
assert(/guardUnsaved\(\(\) => \{ void openServerDifficulty\(folderRel, file\); \}\)/.test(menu), '切难度 (菜单): 重入动作经 guardUnsaved (bypass 放行点)');
assert(/guardUnsaved\(\(\) => \{ void openDiff\(fileName\); \}\)/.test(lib), '曲库开难度: 重入动作经 guardUnsaved (bypass 放行点)');

console.log(failures ? `\nV136_CHECK_FAILED: ${failures}` : '\nV136_CHECK_PASSED');
process.exit(failures ? 1 : 0);
