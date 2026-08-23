// v124 源码接线断言: 未保存改动指示器 — 游玩区左下角谱面信息前 (与 [已保存] 同位置同样式)
// 运行: node verifier/v124/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const app = read('src/App.tsx');

// 位置: 游玩区左下角谱面信息 pill 内, 谱面名前的 [⚪ 未保存] 前缀 (与 [已保存] 前缀并列同位)
// v181: ⚪ → CSS 圆点 span (界面禁用 emoji 图标)
assert(/\{store\.dirty && <b className="text-white\/90" data-dirty-indicator>\[<span className="inline-block w-2 h-2 rounded-full bg-white\/90 align-middle" \/> 未保存\] <\/b>\}/.test(app), '指示器: [● 未保存] 前缀 (仅脏时显示; v181 CSS 圆点)');
const pill = app.slice(app.indexOf('flex-1 flex items-center justify-center gap-2 min-w-0'), app.indexOf('data-volume-panel-btn')); // v184/v186: 页签栏谱面信息容器 (song setup 右侧)
assert(pill.includes('data-dirty-indicator'), '指示器在页签栏谱面信息名称 Label 内 (v184)');
assert(pill.indexOf('data-dirty-indicator') < pill.indexOf('data-save-message') || !pill.includes('data-save-message') || pill.indexOf('data-dirty-indicator') < pill.indexOf('bm.metadata.artist'), '指示器在谱面信息前');
assert(pill.indexOf('data-dirty-indicator') < pill.indexOf('store.saveMessage && <b>'), '指示器在 [已保存] 前缀之前 (同位置, 未保存优先)');

console.log(failures ? `\nV124_CHECK_FAILED: ${failures}` : '\nV124_CHECK_PASSED');
process.exit(failures ? 1 : 0);
