// 验证器 v68: 批量复制增强 — 复制绿线 / 向量箭头拖拽 / 自定义锚点吸附
// 运行: cd app && node verifier/v68/check.mjs; node verifier/v68/cdp-v68.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v68/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v68/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('duplicate.ts: copyGreenLines + computeDuplicateTiming');
{
  const src = readSrc('src/osu/duplicate.ts');
  assert(/copyGreenLines: boolean/.test(src) && /copyGreenLines: false/.test(src), '参数字段 + 默认关');
  assert(/export function computeDuplicateTiming/.test(src), '纯函数导出');
  assert(/filter\(t => !t\.uninherited\)/.test(src), '只取绿线 (未继承点)');
  assert(/g\.time >= o\.time && g\.time <= \(o\.endTime \?\? o\.time\)/.test(src), '范围 = 物件 [头,尾] (滑条整条)');
  assert(/advanceByBeats\(bm\.timingPoints, g\.time, p\.intervalBeats \* i\)/.test(src), '与物件相同的拍偏移');
  assert(/byTime\.set\(t, \{ \.\.\.g, time: t \}\)/.test(src), '同份目标时刻去重');
}

section('store.ts: 预览/应用支持绿线 + 向量视图');
{
  const src = readSrc('src/osu/store.ts');
  assert(/objects: HitObject\[\]; timingPoints\?: TimingPoint\[\]/.test(src), 'conversionPreview 带 timingPoints');
  assert(/applyConversion\(removeIds: number\[\], add: HitObject\[\], addTiming: TimingPoint\[\] = \[\]\)/.test(src), 'applyConversion 第三参');
  assert(/timingPoints = this\.beatmap\.timingPoints\.concat\(addTiming/.test(src), '绿线副本写入 + 排序');
  assert(/dupVectorView: \{ anchor/.test(src) && /dupVectorDragHandler/.test(src), '向量箭头视图/回调');
}

section('DuplicateDialog.tsx: 勾选框 + 预览 + 应用 + 箭头视图');
{
  const src = readSrc('src/components/convert/DuplicateDialog.tsx');
  assert(/data-conv="copyGreenLines"/.test(src) && /upd\(\{ copyGreenLines: e\.target\.checked \}\)/.test(src), '复制绿线勾选框');
  assert(/computeDuplicateTiming\(bm, objs, params\)/.test(src), '绿线预览计算');
  assert(/store\.applyConversion\(\[\], result, allTiming\)/.test(src), '应用带绿线 (v116: 复制绿线+缩放补偿绿线合并)');
  assert(/sliderTailPoint\(bm, last\)/.test(src) && /store\.dupVectorView = \{ anchor, dx: params\.dx, dy: params\.dy \}/.test(src), '箭头锚 = 最后源物件尾端');
  assert(/store\.dupVectorDragHandler = \(dx, dy\) => setParams/.test(src), '拖拽回写参数');
}

section('EditorCanvas.tsx: 箭头绘制/拖拽 + 锚点吸附');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const dv = store\.dupVectorView/.test(src) && /g\.arc\(hx, hy, 7/.test(src), '箭头 + 头部手柄绘制');
  assert(/dv0\.anchor\.x \+ dv0\.dx - p\.x.*<= 10/.test(src), '箭头头命中 (10px)');
  assert(/store\.dupVectorDragHandler\(sp\.x - dv\.anchor\.x, sp\.y - dv\.anchor\.y\)/.test(src), '拖拽改向量 (v91: 经 snapWithGeo 物件+辅助吸附)');
  const originDrag = src.slice(src.indexOf('if (originDragRef.current) {'));
  assert(/snapWithGeo\(bm, cp, snapToNearby\(cp, targets\)\) \?\? cp/.test(originDrag) && /gridSnapAt\(bm,/.test(originDrag), '自定义锚点: 物件+辅助吸附 + 网格吸附');
  assert(/originDragRef\.current = false/.test(src) && /dupVectorDragRef\.current = false/.test(src), 'window mouseup 清理');
}

section('Timelines.tsx / renderer.ts: 绿线预览 WYSIWYG');
{
  const tl = readSrc('src/components/Timelines.tsx');
  assert(/convPrev\?\.timingPoints\?\.length/.test(tl), '上时间轴合并预览绿线');
  const rd = readSrc('src/osu/renderer.ts');
  assert(/prev\.timingPoints\?\.length/.test(rd) && /\.\.\.bm\.timingPoints, \.\.\.prev\.timingPoints/.test(rd), 'mergedWithPreview 合并绿线');
}

if (failures) { console.error(`\nVERIFIER_V68_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V68_ALL_PASSED');
