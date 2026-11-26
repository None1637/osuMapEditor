// v596: 缩放弹窗的同一倍率直接应用于全部勾选轴
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const dlg = read('src/components/TransformDialog.tsx');
const zh = read('src/i18n/dicts/zh-CN/transform.ts');
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

assert(dlg.includes('axisScaleFactors(factor, factor, axisX, axisY)'), 'X/Y 勾选轴共用顶部同一 factor');
assert(dlg.includes('data-tf="axis-x"') && dlg.includes('data-tf="axis-y"'), '保留 X/Y 轴独立勾选');
assert(!dlg.includes('testid="factor-y"') && !dlg.includes('changeFactorY'), '移除独立 Y 倍率输入框及其状态逻辑');
assert(!dlg.includes('data-tf="lock-ratio"') && !zh.includes("'transform.lock_ratio'"), '移除不再需要的 x:y 固定控件与文案');
assert(dlg.includes("loadParams('tf-scale', { axisX: true, axisY: true })")
  && dlg.includes('return { axisX: p.axisX, axisY: p.axisY }'), '轴向勾选继续持久化, 旧 lockRatio 存档键被丢弃');

console.log(failures ? `\nVERIFIER_V596_FAILED: ${failures}` : '\nVERIFIER_V596_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
