// 验证器 v469: ① 选中效果样式互换 — stable = 皮肤 hitcircleselect.png, lazer = 橙黄圆环
//   (用户指正: v305 方向反了, 默认皮肤的 hitcircleselect.png 恰是橙黄环, F03 截图的"黄圈"即它);
// ② 曲库索引并发池 — buildLibraryIndex/enumerateDifficultySkeletons 目录级 8 路 + 文件级 8 路,
//   exe 服务器直读模式每文件/每目录一次 HTTP roundtrip, 串行是"索引几分钟"的主因。
// 运行: cd app && node verifier/v469/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v469/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v469/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('索引并发池单元/时序测试 (tests.ts)');
await import('file://' + out);
fs.unlinkSync(out);

section('renderer.ts: stable = hitcircleselect.png / lazer = 橙黄圆环');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/v469: 用户指正/.test(src), 'v469 注释在');
  assert(/function drawHitcircleSelectMark\(rc: RenderCtx, x: number, y: number, r: number\)/.test(src)
    && /const img = rc\.skin\.hitcircleselect;/.test(src)
    && /if \(!img\) return;/.test(src)
    && /const w = r \* 2;/.test(src),
    'drawHitcircleSelectMark: 皮肤图 128 文件盒 = 2r (v470), 无图跳过');
  assert(/if \(stableSel\) \{\s*drawHitcircleSelectMark\(rc, o\.x, o\.y, radius\);\s*if \(tail\) drawHitcircleSelectMark\(rc, tail\.x, tail\.y, radius\);\s*\} else \{\s*drawSelectionRing\(g, o\.x, o\.y, radius\);\s*if \(tail\) drawSelectionRing\(g, tail\.x, tail\.y, radius\);/.test(src),
    '滑条头/尾标记: stable 皮肤图, lazer 橙黄环');
  assert(/else if \(stableSel\) \{\s*drawHitcircleSelectMark\(rc, o\.x, o\.y, radius\);/.test(src), 'stable 单点/spinner = 皮肤图');
  assert(/drawSelectionRing\(g, o\.x, o\.y, radius\); \/\/ v469: lazer 单点\/spinner = 橙黄圆环/.test(src), 'lazer 单点/spinner = 橙黄环');
  assert(!/setLineDash\(\[6, 4\]\)/.test(src.slice(src.indexOf('function drawSelectionDecor'), src.indexOf('function drawPendingSlider'))),
    'lazer 青色虚线环已移除 (drawSelectionDecor 内无 setLineDash)');
  assert(/sliderOutlineSprite\(p\.points, radius, stableSel \? '#4a90e2' : '#4df3ff', stableSel, o\.id/.test(src), '滑条身描边配色不变 (stable 蓝 / lazer 青)');
}

section('libraryIndex.ts: 并发池结构');
{
  const src = readSrc('src/osu/libraryIndex.ts');
  assert(/const DIR_CONCURRENCY = 8;/.test(src) && /const FILE_CONCURRENCY = 8;/.test(src), '并发度常量 (目录 8 / 文件 8)');
  assert(/Promise\.all\(Array\.from\(\{ length: DIR_CONCURRENCY \}, dirWorker\)\)/.test(src), 'buildLibraryIndex 目录级 worker 池');
  assert(/Promise\.all\(Array\.from\(\{ length: Math\.min\(FILE_CONCURRENCY, files\.length\) \}, fileWorker\)\)/.test(src), '文件级 worker 池');
  assert(/Promise\.all\(Array\.from\(\{ length: DIR_CONCURRENCY \}, worker\)\)/.test(src), '骨架枚举目录级 worker 池');
  assert(!/for await \(const \[name, f\] of dir\.entries\(\)\) \{\s*if \(isCancelled\(\)\) return;\s*if \(f\.kind !== 'file'/.test(src), '旧逐文件串行 await 循环移除');
  assert(/250ms 兜底唤醒/.test(src), '唤醒兜底 (取消不退不出死锁)');
  assert(/dirs\.findIndex\(\(\[n\], i\) => i >= nextDir && n === prioName\)/.test(src), 'prio 插队保留 (已认领不重复)');
  assert(/hit && hit\.size === file\.size && hit\.lastModified === file\.lastModified/.test(src), '增量比对语义不变');
  assert(/g\.names\.size === names\.length && names\.every\(n => g\.names\.has\(n\)\)/.test(src), 'trustNames 快路径不变');
}

section('显示设置/词典文案');
{
  const ds = readSrc('src/osu/displaySettings.ts');
  const dict = readSrc('src/i18n/dicts/zh-CN/display.ts');
  assert(/v469: 修正 — 'stable' = 皮肤 hitcircleselect\.png/.test(ds), 'displaySettings 注释更新');
  assert(/'display\.selection_style_option_stable': 'stable 皮肤图'/.test(dict), '词典 stable 皮肤图');
  assert(/'display\.selection_style_option_lazer': 'lazer 圆环'/.test(dict), '词典 lazer 圆环');
}

if (failures) { console.error(`\nV469_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV469_ALL_PASSED');
