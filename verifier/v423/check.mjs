// 验证器 v423: 测试游玩 — Break 休息段提示
//  - break 段从谱面 [Events] 原文解析 (2,start,end / Break,start,end; rawSections 既有保留,
//    无需改 parser — 改动最小方案);
//  - break 进行时画面中央偏上显示: 血量 pass/fail 三角 (>50% 绿向上, 否则红向下 — lazer break 末
//    pass/fail 箭头简化) + 「Break」字样 (i18n) + 剩余秒数; 无 break 段不显示任何内容。
// 运行: node verifier/v423/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v423/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v423/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V423_TESTS_*)
fs.unlinkSync(out);

const hud = read('src/osu/gameplay/hud.ts');
assert(/export function parseBreaks/.test(hud) && /\(2\|Break\)/.test(hud) || /\(\?:2\|Break\)/.test(hud), 'parseBreaks 解析 [Events] break 行');
assert(/export function breakAt/.test(hud), 'breakAt 查询');

const sess = read('src/osu/gameplay/testPlaySession.ts');
assert(/readonly breaks: BreakSpan\[\]/.test(sess), '会话暴露 breaks');
assert(/parseBreaks\(bm\.rawSections\?\.\['Events'\]\)/.test(sess), '从 [Events] 原文解析 (改动最小)');
assert(/inBreak\(time: number\)/.test(sess), 'inBreak 方法 (v422 drain 门控共用)');

const ov = read('src/components/TestPlayOverlay.tsx');
assert(/breakAt\(session\.breaks, time\)/.test(ov), '覆盖层按当前时间查 break');
assert(/t\('testplay\.break', 'Break'\)/.test(ov), 'Break 字样走 i18n');
assert(/Math\.ceil\(\(brk\.end - time\) \/ 1000\)/.test(ov), '剩余秒数');
assert(/sc\.hp > 0\.5/.test(ov) && /'#7fff7f'/.test(ov) && /'#ff5f5f'/.test(ov), '血量 pass/fail 三角 (绿上/红下)');
assert(/PW \* scale \/ 2/.test(ov) && /PH \* scale \* 0\.26/.test(ov), '画面中央偏上');

const dict = read('src/i18n/dicts/zh-CN/panels.ts');
assert(/'testplay\.break': '休息'/.test(dict), 'zh-CN 词典: 休息');

console.log(failures ? `\nVERIFIER_V423_FAILED: ${failures} 处失败` : '\nVERIFIER_V423_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
