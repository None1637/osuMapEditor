// 验证器 v45: 框选可见过滤 / 时间轴框选 / 游玩区放大 / 节拍 seek / 锁定间距控件 /
// 选区间距面板 / follow points — 纯函数 + 源码接线断言
// 运行: cd app && node verifier/v45/check.mjs; node verifier/v45/cdp-v45.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v45/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v45/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('EditorCanvas.tsx: 框选只选可见物件 + 游玩区放大 10%');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/objectsInRect\([\s\S]{0,200}isVisibleAt\(bm, o, store\.currentTime\)[\s\S]{0,200}getStackOffsets\(bm\)\)/.test(src),
    '框选 objectsInRect 前按 isVisibleAt 过滤 (与单击命中同一可见窗口)');
  assert(/\(availH \/ \(PH \+ PAD_Y \* 2\)\) \* 1\.2/.test(src), 'viewTransform 高度方向 * 1.2 (v130: 1.1→1.2, 间隔降至 ~1/5; v129: availH 扣除面板预留)');
  assert(/Math\.min\(r\.width \/ PW,/.test(src), '宽度适配兜底防溢出');
}

section('Timelines.tsx: 时间轴框选 + 选区信息面板');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/marqueeRef = useRef<\{[\s\S]*?tAnchor: number; px0: number; y0: number/.test(src), 'TopTimeline 有 marqueeRef (含 y 坐标; v102 锚定时间)');
  assert(/marqueeRef\.current = \{[\s\S]*?tAnchor: store\.currentTime/.test(src), '空白按下进入框选 (v102 起全高度可起手, 锚定按下时刻)');
  assert(/endOf\(o\) >= msA && o\.time <= msB/.test(fs.readFileSync(path.join(root, 'src/osu/timelineSelect.ts'), 'utf8')), '框选命中 = 时间区间与物件时长相交 (v102 抽纯函数 marqueeObjectIds)');
  assert(/bandHit\(mq\.y0, mq\.y1, 0, OBJ_H\)/.test(src), '纵向需覆盖物件行 (v102 bandHit)');
  assert(/base: e\.shiftKey \? \[\.\.\.store\.selected\]/.test(src), 'Shift 在现有选区上追加 (与游玩区一致)');
  assert(/if \(!mq\.base\.length && !mq\.baseGreens\.length\) store\.clearSelection\(\)/.test(src), '未拖出矩形且落空 = 单击空白: 仅清空选区 (v79 起不 seek; v80 条命中优先; v102 含绿线 base)');
  assert(/export function SelectionInfoPanel\(\)/.test(src), '导出 SelectionInfoPanel');
  assert(/selectionSpacingInfo\(bm, store\.selected\)/.test(src), '面板数据来自 selectionSpacingInfo');
  assert(/Prev: /.test(src) && /Next: /.test(src), '面板含 Prev/Next 行');
}

section('App.tsx: 节拍 seek + 锁定间距控件 + 顶部布局');
{
  const src = readSrc('src/App.tsx');
  assert(/seekByBeats\(bm\.timingPoints, store\.beatSnap, store\.currentTime, dir, e\.shiftKey \? 4 : 1\)/.test(src),
    '左右键 = seekByBeats (lazer EditorClock.seek, Shift=4 拍)');
  assert(!src.includes('dir * 250'), '移除旧的固定 250ms 步进');
  assert(/data-ds-input="range"/.test(src) && /data-ds-input="number"/.test(src), '锁定间距按钮旁滑条 + 数字输入');
  assert(/store\.beatmap\.editor\.distanceSpacing = parseFloat/.test(src), '滑条写回 editor.distanceSpacing');
  assert(/<SelectionInfoPanel \/>/.test(src), '选区信息面板与时间轴同行布局');
  assert(/flex-1 min-w-0[\s\S]{0,100}<TopTimeline \/>/.test(src), '时间轴 flex-1 让出右侧给面板');
}

section('spacing.ts: 间距单位与锁定间距一致');
{
  const src = readSrc('src/osu/spacing.ts');
  assert(/export function selectionSpacingInfo/.test(src), '导出 selectionSpacingInfo');
  // v149 适配: 1x 基准含 SM*SV (lazer DurationToDistance 同源), 基准收敛到 distanceSnapPxPerBeat
  assert(/distPx \/ \(distanceSnapPxPerBeat\(bm, fromEndTime\) \* beats\)/.test(src), '1x = distanceSnapPxPerBeat*拍数 = DS*100*SM*SV*拍数 (同 snapPlacement)');
  assert(/stackedEndPosition\(bm, p\)/.test(src) && /stackedEndPosition\(bm, last\)/.test(src), '间距按前/末件结束位置算 (滑条取尾)');
}

section('followPoints.ts / renderer.ts / skin.ts: follow point 对齐 lazer');
{
  const fp = readSrc('src/osu/followPoints.ts');
  assert(/export const FP_SPACING = 32/.test(fp) && /export const FP_PREEMPT = 800/.test(fp), 'SPACING=32, PREEMPT=800');
  assert(/end\.newCombo \|\| start\.type === 'spinner' \|\| end\.type === 'spinner'/.test(fp), 'newCombo / 转盘断链 (FollowPointLifetimeEntry)');
  assert(/d = Math\.floor\(FP_SPACING \* 1\.5\); d < distance - FP_SPACING; d \+= FP_SPACING/.test(fp), '点距 32 首点 48 (lazer 循环)');
  assert(/fadeOutTime = startEndTime \+ fraction \* duration/.test(fp), 'GetFadeTimes 公式');
  assert(/FP_PREEMPT \* Math\.min\(1, startPreempt \/ PREEMPT_MIN\)/.test(fp), 'preempt = 800*min(1, TimePreempt/450)');
  assert(/fraction - 0\.1 \+ 0\.1 \* t/.test(fp), '位置从 fraction-0.1 滑入 (MoveTo Easing.Out)');
  assert(/1\.5 - 0\.5 \* t/.test(fp), '缩放 1.5 -> 1 (ScaleTo Easing.Out)');
  const rn = readSrc('src/osu/renderer.ts');
  assert(/drawFollowPoints\(rc, radius\)/.test(rn), 'renderPlayfield 调用 drawFollowPoints');
  const ri = rn.indexOf('drawFollowPoints(rc, radius)');
  const rl = rn.indexOf('for (let i = visible.length - 1');
  assert(ri > 0 && rl > ri, 'follow points 画在物件下层 (先于物件循环)');
  assert(/\(radius \/ 64\) \* p\.scale/.test(rn), '缩放 = end.Scale(radius/64) * 动画缩放, 保持贴图宽高比');
  const sk = readSrc('src/osu/skin.ts');
  assert(/followpoint: SkinImage/.test(sk), 'Skin 接口含 followpoint');
  assert(/\['followpoint', 'followpoint\.png'\]/.test(sk), 'SKIN_FILES 加载 followpoint.png (皮肤目录可覆盖)');
}

section('seekSnapping.ts: lazer EditorClock.seek 移植');
{
  const src = readSrc('src/osu/seekSnapping.ts');
  assert(/export function seekByBeats/.test(src), '导出 seekByBeats');
  assert(/tp\.beatLength \/ divisor\) \* amount/.test(src), '步长 = beatLength/divisor*amount');
  assert(/direction > 0[\s\S]{0,60}Math\.floor[\s\S]{0,120}Math\.ceil/.test(src), '向前 floor / 向后 ceil 吸附');
  assert(/direction < 0 && Math\.abs\(tp\.time - current\)/.test(src), '红线边界向后用目标侧红线');
  assert(/seekTime > next\.time/.test(src), '向前不越过下一条红线');
  assert(/Math\.abs\(seekTime - current\) < 0\.5/.test(src), '落回原地时多走一拍 (Precision.AlmostEquals)');
  assert(/seekTime < tp\.time && tp !== reds\[0\]/.test(src), '向后不越过本红线起点 (首条除外)');
}

if (failures) { console.error(`\nVERIFIER_V45_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V45_ALL_TESTS_PASSED');
