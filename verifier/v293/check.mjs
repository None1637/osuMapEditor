// 验证器 v293: 快捷键面板字体再调大 + 曲库优先为选中谱面建索引
// 依据: 用户反馈「快捷键设置面板字体还是太小」「优先为曲库界面中当前选中的谱面建立索引」。
//   HotkeyPanel: 分类 12→13px, 动作名 13→14px (text-sm, 列宽 w-44→w-48), 键位按钮/捕获提示
//   12→13px, 冲突提示/底部说明 10→11px, 行距 py-0.5→py-1, 面板 520→560。
//   libraryIndex.buildLibraryIndex: 目录先缓冲成表, 新增 prio 回调 — 每目录处理前取最新
//   优先目录名插队 (索引途中改选立即生效); SongLibrary 传入选中项 dirName。
// 运行: node verifier/v293/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v293/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v293/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V293_TESTS_*)
fs.unlinkSync(out);

const hp = readSrc('src/components/HotkeyPanel.tsx');
assert(/width=\{560\}/.test(hp), '面板加宽 520→560');
assert(/text-\[13px\] font-bold uppercase/.test(hp), '分类标题 13px');
assert(/w-48 shrink-0 text-sm/.test(hp), '动作名 14px (text-sm)');
assert(/font-mono text-\[13px\]/.test(hp), '键位按钮 13px');
assert(!/text-\[9px\]|text-\[10px\]/.test(hp), '面板内不再有 ≤10px 文本');

const li = readSrc('src/osu/libraryIndex.ts');
assert(/prio\?: \(\) => string \| null/.test(li), 'buildLibraryIndex 接受 prio 回调');
assert(/dirs\.splice\(idx, 1\)/.test(li), '优先目录插队 (每目录前取最新值)');

const sl = readSrc('src/components/SongLibrary.tsx');
assert(/prioDir/.test(sl) && /selKeyRef\.current/.test(sl), '曲库传入选中项为优先目录');

if (failures) { console.error(`\nV293_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV293_ALL_PASSED');
