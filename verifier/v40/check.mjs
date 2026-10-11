// 验证器 v40: 转连打改进 (节拍间距/数量=1/曲线简化/数字输入) + 选中边框全时段渲染 + 预览选中效果/时间轴预览 + Ctrl 切换选中
// 运行: cd app && node verifier/v40/check.mjs; node verifier/v40/cdp-v40.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v40/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v40/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('stream.ts: 节拍间距 + 数量=1 + 曲线简化');
{
  const src = readSrc('src/osu/convert/stream.ts');
  assert(/spacingBeats: number;/.test(src) && !/^\s*spacingMs: number;/m.test(src), '间距参数为 spacingBeats (拍)');
  assert(/spacingMs = p\.spacingBeats \* red\.beatLength/.test(src), '拍 -> ms 按滑条起点 beatLength 解析');
  assert(/if \(n === 1\) return \[0\]/.test(src), 'count=1 -> 仅头部');
  // v398 适配: 曲线下拉/曲线枚举移除, bell/bellInv 由 重复次数+镜像重复 表达, 遗留值经 migrateStreamParams 迁移
  assert(src.includes("case 'bell'") && src.includes("case 'bellInv'"), '遗留 bell/bellInv 在迁移函数中处理');
  assert(/case 'bell':[\s\S]{0,120}repeats: 2, mirrorRepeat: true/.test(src), 'bell = 重复2+镜像 (与 bellInv 镜像)');
  assert(/case 'linear': case 'accel': case 'decel':[\s\S]{0,120}expoBase: 1/.test(src), '遗留 accel/decel/linear → 底数1 (线性)');
}

section('StreamDialog/DraggableDialog: 自定义间距勾选 + 草稿输入');
{
  const dlg = readSrc('src/components/convert/StreamDialog.tsx');
  // v398 适配: 曲线下拉框移除, 改「自定义连打间距」勾选框 + 指数底数/倍率/重复次数+镜像重复
  assert(dlg.includes('data-conv="custom-spacing"'), '自定义连打间距勾选框');
  const zhConvert = readSrc('src/i18n/dicts/zh-CN/convert.ts');
  assert(/'convert\.stream_custom_spacing':\s*'自定义连打间距'/.test(zhConvert), 'zh-CN 词典: 自定义连打间距');
  assert(!/curve_bell|curve_linear'/.test(dlg), '旧曲线下拉选项已移除');
  assert(dlg.includes('间距 (拍)') || dlg.includes("convert.stream_spacing"), '间距标签为拍');
  assert(dlg.includes('DraftNum'), '数字输入用 DraftNum');
  assert(/migrateStreamParams\(loadParams\('stream'/.test(dlg), '载入时遗留参数迁移 (v398)');
  const dd = readSrc('src/components/DraggableDialog.tsx');
  assert(/export function DraftNum/.test(dd) && dd.includes('onFocus') && dd.includes('onBlur'), 'DraftNum 草稿态输入');
}

section('renderer.ts: 选中装饰全时段渲染');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/function drawSelectionDecor/.test(src), '选中装饰抽为 drawSelectionDecor');
  assert(/for \(const o of bm\.hitObjects\) if \(rc\.selected\.has\(o\.id\)\) drawSelectionDecor\(lrc, o, radius\);/.test(src), '未出现的选中物件也画选中装饰 (v245: 统一在离屏层构建循环, 覆盖可见+不可见)');
}

section('EditorCanvas/Timelines: 预览选中效果 + 时间轴预览 + Ctrl 切换');
{
  const ec = readSrc('src/components/EditorCanvas.tsx');
  assert(/selView[\s\S]*?convPrev\.objects\.map\(o => o\.id\)/.test(ec), '预览物件按选中渲染');
  assert(/e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey\) store\.toggleSelect/.test(ec), '游玩区 Ctrl+点击 切换选中');
  const tl = readSrc('src/components/Timelines.tsx');
  assert(/mergedWithPreview\(bm, convPrev\)[\s\S]*?computeCombos\(bmView\)/.test(tl), '上方时间轴绘制转换预览 (v44 合并视图)');
  assert(/prevIds\.has\(o\.id\)/.test(tl), '时间轴预览物件选中样式 (黄环)');
  assert(/e\.shiftKey \|\| e\.ctrlKey \|\| e\.metaKey\) store\.toggleSelect/.test(tl), '时间轴 Ctrl+点击 切换选中');
}

if (failures) { console.error(`\nVERIFIER_V40_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V40_ALL_TESTS_PASSED');
