// 验证器 v407: 时间轴 Alt+拖滑条尾 = 增/改绿线 SV 调持续时间 (长度/折返不变)
// 运行: cd app && node verifier/v407/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v407/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v407/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('timingSv.ts: 纯函数模块');
{
  const src = readSrc('src/osu/timingSv.ts');
  assert(/v407/.test(src), 'v407 版本注释');
  assert(/SV_MIN = 0\.1/.test(src) && /SV_MAX = 10/.test(src), 'SV 钳制范围 [0.1, 10]');
  assert(/export function svForDuration\(/.test(src) && /lengthPx \* slides \* redBeatLength\) \/ \(100 \* sliderMultiplier \* targetDurMs\)/.test(src),
    'svForDuration 反解公式');
  assert(/export function beatLengthForSv/.test(src) && /-100 \/ sv/.test(src), 'beatLengthForSv');
  assert(/export function svAt/.test(src) && /svPointAt/.test(src), 'svAt 走 svPointAt (红线重置语义)');
  assert(/export function greenLineAt/.test(src), 'greenLineAt 同刻绿线查询');
  assert(/export function svRestoreTargetAt/.test(src), 'v454: svRestoreTargetAt 恢复绿线插入位置决策');
}

section('Timelines.tsx: Alt+拖尾 SV 模式接线');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/import \{ beatLengthForSv, svAt, greenLineAt, svRestoreTargetAt, svForDurationRaw, svRedlineBoost, bpmRestoreTargetAt, SV_MIN, SV_MAX \} from '@\/osu\/timingSv';/.test(src), '引入 timingSv (v454 +svRestoreTargetAt; v455 +红线扩程三件套)');
  assert(/mode: 'slides' \| 'sv';/.test(src), 'tailResizeRef 加 mode 字段');
  assert(/mode: e\.altKey \? 'sv' : 'slides', svOld: svAt\(bm\.timingPoints, o\.time\)/.test(src),
    '按下时 Alt 决定模式 + 记录旧 SV');
  assert(/if \(tr\.mode === 'sv'\) \{[\s\S]*?const targetEnd = Math\.round\(snapMs\(ms, sliderLengthSnapDivisor\(store\.beatSnap\)\)\);[\s\S]*?applySvTailDrag\(bm, o, tr, targetEnd\);/.test(src),
    'mousemove: SV 模式目标尾时间吸附节拍 + applySvTailDrag (v463 适配: 吸附走 sliderLengthSnapDivisor, 关=整格等价原 snapMs(ms))');
  // 应用函数要点
  const fn = src.match(/function applySvTailDrag[\s\S]*?\n\}\n/)?.[0] ?? '';
  // v455: 反解改 svForDurationRaw (不钳制) + tr.redOld 基准 (头红线会改 o.time beatLength, 不能再读 timingAt)
  assert(/svForDurationRaw\(o\.length \?\? 0, o\.slides \?\? 1, tr\.redOld/.test(fn), 'svReq 反解含 slides (v455: 不钳制+redOld 基准)');
  assert(/const exist = greenLineAt\(tps, o\.time\);/.test(fn) && /tr\.headCreated = true;/.test(fn), '头绿线: 已有则改/否则新建');
  assert(/uninherited: false, effects: 0/.test(fn), '新绿线字段 (继承采样设置, effects=0)');
  assert(/restored && tr\.headCreated/.test(fn), '拖回原时长摘除新建头绿线 (v455: restored 按未钳制 svReq 判定)');
  assert(/tr\.restore\) \{ const i = tps\.indexOf\(tr\.restore\);/.test(fn), '恢复绿线逐帧先摘后插');
  // v454: 恢复绿线改插后续滑条头 (不再插当前滑条尾); 插入位置决策抽至 timingSv.svRestoreTargetAt (v454 纯函数测试覆盖)
  assert(!/spanClear/.test(fn) && !/time: targetEnd/.test(fn), 'v454: 不再往当前滑条尾插恢复绿线');
  assert(/const restoreAt = svRestoreTargetAt\(tps, bm\.hitObjects, o\.time\);/.test(fn), 'v454: 插入位置走 svRestoreTargetAt (后续滑条头)');
  assert(/time: restoreAt, beatLength: beatLengthForSv\(tr\.svOld\)/.test(fn), 'v454: 恢复绿线还原 svOld');
  // 原折返模式保留
  assert(/Math\.min\(100, Math\.round\(\(ms - o\.time\) \/ tr\.dur\)\)/.test(src), '非 Alt 拖尾仍改折返次数 (v35 保留)');
  // 收尾: 单击尾端选中尾节点逻辑不受影响
  assert(/if \(to\?\.type === 'slider'\) store\.selectEdges\(tr\.objId, \[to\.slides \?\? 1\]\);/.test(src), '未拖动单击尾端 = 选中尾节点 (保留)');
}

if (failures) { console.error(`V407 FAILED (${failures})`); process.exit(1); }
console.log('V407 ALL PASSED');
