// v116 源码接线断言: 批量复制「缩放/份」+「添加绿线缩放滑条」
// 运行: node verifier/v116/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const dup = read('src/osu/duplicate.ts');
const dlg = read('src/components/convert/DuplicateDialog.tsx');

// duplicate.ts: 参数与默认值
assert(/scalePerCopy: number;\s*\/\/ v116/.test(dup), '参数 scalePerCopy (带语义注释)');
assert(/scaleSlidersGreenLines: boolean;\s*\/\/ v116/.test(dup), '参数 scaleSlidersGreenLines (带语义注释)');
assert(/scalePerCopy: 0, scaleSlidersGreenLines: false/.test(dup), '默认: 不缩放不勾选');

// duplicate.ts: 几何缩放 (先缩放再旋转再平移, 下限 0.1; 滑条由勾选门控; 长度同步)
assert(/const s = Math\.max\(0\.1, 1 \+ p\.scalePerCopy \* i\);/.test(dup), '第 i 份缩放 s = 1 + i×scalePerCopy (下限 0.1)');
assert(/const rot = \(p0: Pt, k: number\): Pt => \(\{[\s\S]{0,120}\(p0\.x - c\.x\) \* k \* cos/.test(dup), '缩放并入旋转平移矩阵');
assert(/const k = o\.type === 'slider' && !p\.scaleSlidersGreenLines \? 1 : s;/.test(dup), '滑条仅勾选时参与缩放 (否则 k=1)');
assert(/if \(k !== 1\) cl\.length = Math\.round\(\(o\.length \?\? 0\) \* k \* 100\) \/ 100;/.test(dup), '滑条像素长度同步缩放');

// duplicate.ts: 补偿绿线纯函数
assert(/export function computeDuplicateScaleTiming\(bm: Beatmap, objs: HitObject\[\], p: DuplicateParams, base: TimingPoint\[\]\)/.test(dup), 'computeDuplicateScaleTiming 导出 (base = 绿线副本)');
assert(/if \(!p\.scaleSlidersGreenLines \|\| !objs\.length \|\| p\.count < 1\) return \[\];/.test(dup), '未勾选 => 空');
assert(/g\.beatLength = -100 \/ sv;/.test(dup), '绿线 beatLength = -100/SV (头部 SV = 生效×s)');
assert(/const vel = sliderVelocityAt\(merged, head, sm\);/.test(dup), '尾时间按缩放后 SV 推导 (时长与原件一致)');
assert(/new Map<number, TimingPoint>\(\[\.\.\.restores, \.\.\.heads\]\)/.test(dup), '同刻冲突头部绿线优先');
assert(/defaultNewPoint\(basePts, time, false\)/.test(dup), '绿线字段克隆生效绿线 (lazer addNew)');

// DuplicateDialog: 输入行与接线
assert(/testid="scalePerCopy"/.test(dlg) && /upd\(\{ scalePerCopy: v \}\)/.test(dlg), '「缩放/份」输入框');
assert(/data-conv="scaleSlidersGreenLines"/.test(dlg) && /upd\(\{ scaleSlidersGreenLines: e\.target\.checked \}\)/.test(dlg), '「添加绿线缩放滑条」勾选框');
assert(/computeDuplicateScaleTiming\(bm, objs, params, timing\)/.test(dlg), '补偿绿线接入 (生效 SV 含绿线副本)');
assert(/timingPoints: allTiming/.test(dlg) && /applyConversion\(\[\], result, allTiming\)/.test(dlg), '预览与应用均用合并绿线');

console.log(failures ? `\nV116_CHECK_FAILED: ${failures}` : '\nV116_CHECK_PASSED');
process.exit(failures ? 1 : 0);
