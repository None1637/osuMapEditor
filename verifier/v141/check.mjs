// 验证器 v141: 废弃 贝塞尔→卡特姆 / 卡特姆→贝塞尔 / 拖文件开谱面, 新增 三点圆弧→贝塞尔
// 背景: 三个功能用不到 (曲线互转是 v39 F4 引入; 拖放导入含 .osz/.osu 打开与补音频/背景分支);
//   P->B 按钮复用 bezierPath 的 sliderToBezierSegments (P 型三点步进 circleToBezier) + segmentsToPoints
//   (段接缝重复点红锚点), 无参数不弹窗, 点击直接 applyConversion (一次 undo)。
// 运行: node verifier/v141/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v141/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v141/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // P->B 纯函数断言 (内部自报 V141_TESTS_*)
fs.unlinkSync(out);

section('废弃: 曲线互转 (c2b / b2c / CurveDialog / curveConvert.ts) 全部移除');
{
  assert(!fs.existsSync(path.join(root, 'src/components/convert/CurveDialog.tsx')), 'CurveDialog.tsx 已删除');
  assert(!fs.existsSync(path.join(root, 'src/osu/convert/curveConvert.ts')), 'curveConvert.ts 已删除');
  const insp = readSrc('src/components/Inspector.tsx');
  assert(!insp.includes('curveConvert') && !insp.includes('catmullToBezierSlider'), 'Inspector 不再引入 curveConvert');
  assert(!insp.includes('data-conv-apply="c2b"'), '卡特姆→贝塞尔 按钮移除');
  assert(!insp.includes('data-conv-open="curve"'), '贝塞尔→卡特姆 按钮移除');
  assert(!insp.includes("openConversion('curve')"), '不再打开 curve 窗口');
  const app = readSrc('src/App.tsx');
  assert(!app.includes('CurveDialog'), 'App 不再引入/挂载 CurveDialog');
  const store = readSrc('src/osu/store.ts');
  assert(!store.includes("'curve'"), "store conversionDialog 联合类型不含 'curve'");
}

section('废弃: 拖文件进窗口打开谱面 全部移除');
{
  const app = readSrc('src/App.tsx');
  assert(!app.includes('importFiles'), 'App importFiles 移除 (.osz/.osu/补音频背景)');
  assert(!app.includes('onDragOver') && !app.includes('onDrop'), '根 div 拖放事件移除');
  assert(!app.includes('dragOver'), '拖放遮罩 state 移除');
  assert(!app.includes('松开以打开'), '拖放遮罩 JSX 移除');
  assert(!app.includes('SAMPLE_FILE_RE') && !app.includes('parseOsu'), '拖放专属 import 移除');
  // 开谱面入口保留: 曲库 + 菜单
  const lib = readSrc('src/components/SongLibrary.tsx');
  const menu = readSrc('src/osu/electronMenu.ts');
  assert(lib.includes('openDiff'), '曲库开难度入口保留');
  assert(menu.includes('openServerDifficulty'), '菜单打开难度入口保留');
}

section('新增: 圆弧→贝塞尔 (p2b) 按钮接线');
{
  const insp = readSrc('src/components/Inspector.tsx');
  assert(insp.includes("from '@/osu/convert/bezierPath'"), '引入 sliderToBezierSegments/segmentsToPoints');
  assert(insp.includes('data-conv-apply="p2b"'), '按钮 data-conv-apply="p2b"');
  assert(insp.includes("o.curveType === 'P'"), '按钮按选区 P 滑条条件显示');
  assert(/sliderToBezierSegments\(o\)/.test(insp) && /segmentsToPoints\(segs\)/.test(insp), '转换走 sliderToBezierSegments + segmentsToPoints (circleToBezier 三点弧近似)');
  assert(/curveType: 'B', curvePoints: pts\.slice\(1\)/.test(insp), "输出 curveType 'B' (去头部)");
  assert(/store\.applyConversion\(selP\.map\(o => o\.id\), out\)/.test(insp), 'removeIds 只含 P 滑条 (其他选中物件不动), 一次 undo');
  // 其他转换按钮不动
  assert(insp.includes('data-conv-open="stream"') && insp.includes('data-conv-apply="merge"'), '转连打/合并为滑条按钮保留');
}

section('bezierPath.ts: P->B 复用件完好');
{
  const src = readSrc('src/osu/convert/bezierPath.ts');
  assert(src.includes('export function circleToBezier') && src.includes('export function sliderToBezierSegments') && src.includes('export function segmentsToPoints'), 'circleToBezier/sliderToBezierSegments/segmentsToPoints 导出');
  assert(/type === 'P'/.test(src), 'sliderToBezierSegments P 分支 (三点步进 circleToBezier)');
}

console.log(failures ? `\nV141_CHECK_FAILED: ${failures}` : '\nV141_CHECK_PASSED');
process.exit(failures ? 1 : 0);
