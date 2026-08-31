// 验证器 v236: 对称滑条 — Inspector/作图菜单入口 + 参数弹窗 + computeSymSlider 纯函数。
// 行为断言 (esbuild 打包 tests.ts, 仿 v230): axisDir 三选 (v/h 过拼接锚点 / custom 两点) 镜像坐标 + axis/point 份节点反转,
//   二轮修正链式对齐平移 (拼尾 份1首→原尾 份i首→份i-1末; 拼头 份n末→原头 份i末→份i+1首; none 不平移),
//   旋转/平移按份累加, 缩放/份, join=none 副本字段, join=tail/head 拼接节点序列与接缝红锚点, endTime 延长 / time 提前。
// 源码断言: store conversionDialog 联合类型与锚点圈/对称轴字段 / App.tsx 挂载与 selSingleSlider 上报 /
//   Inspector 按钮 / electronBridge 命令 / electronMenu case / main.cjs 菜单项 / EditorCanvas 锚点圈+对称轴渲染拖拽。
// 运行: node verifier/v236/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v236/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v236/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 行为断言 (内部自报 V236_TESTS_*)
fs.unlinkSync(out);

section('symSlider.ts: 纯函数模块');
{
  const src = readSrc('src/osu/convert/symSlider.ts');
  assert(/export function computeSymSlider\(bm: Beatmap, o: HitObject, p: SymSliderParams\): HitObject\[\]/.test(src), 'computeSymSlider(bm, o, params) 导出');
  assert(/export const DEFAULT_SYM_SLIDER_PARAMS/.test(src), 'DEFAULT_SYM_SLIDER_PARAMS 导出');
  assert(/join: 'tail' \| 'head' \| 'none'/.test(src), 'join 三模式 (拼尾/拼头/独立副本)');
  // 二轮修正: 轴配置简化为 axisDir 三选 (v/h 过拼接锚点 / custom 两点直线), axisMode 删除
  assert(/axisDir: 'v' \| 'h' \| 'custom'/.test(src) && /axisP1: Vec2; axisP2: Vec2/.test(src), 'axisDir 三选 + axisP1/axisP2 参数');
  assert(!/axisMode/.test(src), 'axisMode 已移除');
  // 二轮修正: 拼接锚点 = 拼头?滑条头:滑条尾; axis/point 的中心与缩放锚点恒用它
  assert(/const joinAnchor = p\.join === 'head' \? \{ x: o\.x, y: o\.y \} : sliderTailPoint\(bm, o\)/.test(src), '拼接锚点 joinAnchor 解析');
  assert(/p\.mode === 'point' \? joinAnchor : symSliderAnchor\(bm, o, p\)/.test(src), 'point 中心 = 拼接锚点 (anchor 字段仅 rotate/translate)');
  assert(/p\.mode === 'axis' \|\| p\.mode === 'point' \? joinAnchor : anchor/.test(src), 'axis/point 缩放锚点 = 拼接锚点');
  assert(/2 \* \(axis\.p1\.x \+ t \* ax\) - n\.x/.test(src), '镜像公式 = 垂足 2q−p (reflectObjectsAcrossLine 同款)');
  // 修正1: axis/point 份节点序列反转
  assert(/const flip = p\.mode === 'axis' \|\| p\.mode === 'point'/.test(src) && /flip \? pts\.reverse\(\) : pts/.test(src), 'axis/point 份节点序列反转, rotate/translate 不反转');
  // 二轮修正: 链式对齐平移 (拼尾 份首→上一段末; 拼头 份末→下一段首, 从大到小)
  assert(/base\.x - pts\[0\]\.x/.test(src) && /base = pts\[pts\.length - 1\]/.test(src), '拼尾链式对齐 (份 i 首 → 份 i-1 末)');
  assert(/base\.x - pts\[pts\.length - 1\]\.x/.test(src) && /base = pts\[0\]/.test(src), '拼头链式对齐 (份 i 末 → 份 i+1 首)');
  assert(/p\.join === 'tail' \? \[orig, \.\.\.copies\] : \[\.\.\.copies, orig\]/.test(src), '拼头段序列 = [份1..份n, 原] (各份正向, 取代初版逆序)');
  assert(/sliderTailPoint\(bm, o\)/.test(src), "拼接锚点/锚点 'tail' 走 sliderTailPoint");
  assert(/curveType: 'B'/.test(src), '拼接滑条 curveType 转 B (红锚点分段)');
  assert(/1 \+ p\.scalePerCopy \* i/.test(src), '缩放/份: 第 i 份 = 1 + i×值');
}

section('store.ts: conversionDialog 联合类型含 symSlider + 锚点圈/对称轴字段');
{
  const src = readSrc('src/osu/store.ts');
  assert(/conversionDialog: 'stream' \| 'split' \| 'merge' \| 'polygon' \| 'duplicate' \| 'symSlider' \| null = null/.test(src), "conversionDialog 联合类型含 'symSlider'");
  // 修正3: 自定义锚点圈 store 字段 (dupVector 同款非响应式模式)
  assert(/symSliderAnchorView: \{ x: number; y: number \} \| null = null/.test(src), 'symSliderAnchorView 字段');
  assert(/symSliderAnchorDragHandler: \(\(x: number, y: number\) => void\) \| null = null/.test(src), 'symSliderAnchorDragHandler 字段');
  // 二轮修正: 自定义对称轴两点 store 字段 (v210 symP1/symP2 同款非响应式模式)
  assert(/symSliderAxisView: \{ p1: \{ x: number; y: number \}; p2: \{ x: number; y: number \} \} \| null = null/.test(src), 'symSliderAxisView 字段');
  assert(/symSliderAxisDragHandler: \(\(which: 1 \| 2, x: number, y: number\) => void\) \| null = null/.test(src), 'symSliderAxisDragHandler 字段');
}

section('SymSliderDialog.tsx: 参数面板 + 预览/应用接线');
{
  const src = readSrc('src/components/convert/SymSliderDialog.tsx');
  assert(/loadParams\('symSlider', DEFAULT_SYM_SLIDER_PARAMS\)/.test(src), '参数持久化 loadParams/saveParams');
  assert(/setConversionPreview\(obj && result\.length \? \{ hideIds: \[obj\.id\], objects: result \} : null\)/.test(src), '预览隐藏原滑条 + 幽灵渲染结果');
  assert(/store\.applyConversion\(params\.join === 'none' \? \[\] : \[obj\.id\], result\)/.test(src), 'none 保留原件纯新增 / 拼接替换原件');
  assert(/\[bm, obj, params, sig\]/.test(src), 'useMemo 依赖节点内容签名 sig (节点就地编辑后预览重算, 避免无限循环)');
  assert(src.includes('对称滑条') && /data-conv="apply"/.test(src), '标题/应用按钮');
  // 二轮修正: 轴配置一行三选 (v/h/custom); custom 时两点坐标输入; point 无参数行
  assert(/\[\['v', '竖直线'\], \['h', '水平线'\], \['custom', '自定义'\]\]/.test(src) && /data-conv=\{`dir-\$\{d\}`\}/.test(src), '对称轴三选 UI (dir-v/dir-h/dir-custom)');
  assert(/testid="axisP1x"/.test(src) && /testid="axisP2y"/.test(src), '自定义轴两点坐标输入');
  assert(!/axisMode/.test(src), 'axisMode UI 已移除');
  // 二轮修正: 锚点行只在 rotate/translate 显示 (axis/point 恒用拼接锚点)
  assert(/\(params\.mode === 'rotate' \|\| params\.mode === 'translate'\) && \(/.test(src), '锚点行只在 rotate/translate 显示');
  // 修正3: 自定义锚点圈接线 (仅 rotate/translate 且 anchor=custom 时显示, 拖拽回写 1 位小数, 卸载清理)
  assert(/\(params\.mode === 'rotate' \|\| params\.mode === 'translate'\) && params\.anchor === 'custom'/.test(src), '锚点圈显示条件 = rotate/translate + anchor custom');
  assert(/store\.symSliderAnchorView = anchorActive \? \{ x: params\.customX, y: params\.customY \} : null/.test(src), '锚点圈视图写入/清除');
  assert(/store\.symSliderAnchorDragHandler = \(x, y\) =>/.test(src) && /Math\.round\(x \* 10\) \/ 10/.test(src), '拖拽回写参数 (1 位小数)');
  assert(/store\.symSliderAnchorDragHandler = null; store\.symSliderAnchorView = null/.test(src), '卸载清理锚点圈');
  // 二轮修正: 自定义对称轴两点画布接线 (仅 axis + axisDir=custom 时显示, 拖拽按端点回写, 卸载清理)
  assert(/params\.mode === 'axis' && params\.axisDir === 'custom'/.test(src), '对称轴视图显示条件 = axis + dir custom');
  assert(/store\.symSliderAxisView = axisActive \? \{ p1: \{ \.\.\.params\.axisP1 \}, p2: \{ \.\.\.params\.axisP2 \} \} : null/.test(src), '对称轴视图写入/清除');
  assert(/store\.symSliderAxisDragHandler = \(which, x, y\) =>/.test(src) && /which === 1 \? \{ \.\.\.p, axisP1: q \} : \{ \.\.\.p, axisP2: q \}/.test(src), '轴端点拖拽回写参数 (按端点, 1 位小数)');
  assert(/store\.symSliderAxisDragHandler = null; store\.symSliderAxisView = null/.test(src), '卸载清理对称轴视图');
}

section('EditorCanvas.tsx: 自定义锚点圈/对称轴渲染与拖拽');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const sav = store\.symSliderAnchorView;[\s\S]{0,200}?store\.conversionDialog === 'symSlider'/.test(src)
    && /arc\(sav\.x, sav\.y, 7/.test(src), '锚点圈渲染 (symSlider 窗口打开时)');
  assert(/sav0 && store\.conversionDialog === 'symSlider' && Math\.hypot\(sav0\.x - p\.x, sav0\.y - p\.y\) <= 12/.test(src), 'mousedown 命中锚点圈 (优先于物件拖拽, 阈值 12 与自定义原点一致)');
  assert(/symAnchorDragRef\.current = true/.test(src), '命中开始拖拽');
  assert(/store\.symSliderAnchorDragHandler\(sp\.x, sp\.y\)/.test(src), 'mousemove 回写 (dupVector 同款吸附)');
  // 二轮修正: 自定义对称轴紫色虚线 + 两端点圈渲染, mousedown 命中, mousemove 拖拽回写
  assert(/const sax = store\.symSliderAxisView;[\s\S]{0,200}?store\.conversionDialog === 'symSlider'/.test(src)
    && /sax\.p1\.x - \(dx \/ len\) \* ext/.test(src) && /arc\(m\.x, m\.y, 7/.test(src), '对称轴虚线延长线 + 端点圈渲染');
  assert(/sax0 && store\.conversionDialog === 'symSlider'/.test(src)
    && /symAxisPointDragRef\.current = \(hit \+ 1\) as 1 \| 2/.test(src), 'mousedown 命中轴端点 (阈值 12)');
  assert(/store\.symSliderAxisDragHandler\(i, sp\.x, sp\.y\)/.test(src), 'mousemove 轴端点拖拽回写 (symPointDragRef 同款吸附)');
  assert(/symPointDragRef\.current = 0; symAxisPointDragRef\.current = 0;/.test(src), 'window mouseup 重置拖拽 ref (含对称轴端点)');
  assert(/dupVectorDragRef\.current = false; symAnchorDragRef\.current = false;/.test(src), 'window mouseup 重置拖拽 ref (锚点圈)');
}

section('Inspector.tsx: 单选滑条「转换」区按钮');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert(/data-conv-open="symSlider" onClick=\{\(\) => store\.openConversion\('symSlider'\)\}/.test(src), '「对称滑条」按钮 openConversion');
}

section('electronBridge.ts: 命令 + 置灰状态');
{
  const src = readSrc('src/osu/electronBridge.ts');
  assert(src.includes(`| { type: 'compose-sym-slider' }`), 'ElectronMenuCommand 含 compose-sym-slider');
  assert(/selSingleSlider: boolean/.test(src), 'ElectronEditMenuState 扩 selSingleSlider');
}

section('electronMenu.ts: compose-sym-slider 分发');
{
  const src = readSrc('src/osu/electronMenu.ts');
  assert(/case 'compose-sym-slider':/.test(src), 'case compose-sym-slider 存在');
  assert(/store\.selected\.size !== 1\) return;/.test(src), '恰好选中 1 个物件才继续');
  assert(/o\?\.type === 'slider'\) store\.openConversion\('symSlider'\)/.test(src), '选中为滑条才开窗');
}

section('main.cjs: 作图菜单项 + editState');
{
  const src = readSrc('electron/main.cjs');
  assert(src.includes('e2("compose-sym-slider", "对称滑条...", null, editState.selSingleSlider)'), '作图菜单「对称滑条...」按 selSingleSlider 置灰');
  assert(/selSingleSlider: false/.test(src), 'editState 初始含 selSingleSlider');
  assert(/selSingleSlider: !!s\?\.selSingleSlider/.test(src), 'edit-menu-state 接收 selSingleSlider');
}

section('App.tsx: 弹窗挂载 + 置灰上报');
{
  const src = readSrc('src/App.tsx');
  assert(/import \{ SymSliderDialog \} from '@\/components\/convert\/SymSliderDialog'/.test(src), 'SymSliderDialog 导入');
  assert(/store\.conversionDialog === 'symSlider' && <SymSliderDialog \/>/.test(src), 'conversionDialog === symSlider 时挂载');
  assert(/selSingleSlider: selCount === 1 && !!bm && bm\.hitObjects\.some\(o => store\.selected\.has\(o\.id\) && o\.type === 'slider'\)/.test(src), 'selSingleSlider 计算上报');
  assert(/\$\{s\.selMulti\}\|\$\{s\.selSingleSlider\}/.test(src), '去重 key 含 selSingleSlider');
}

if (failures) { console.error(`\nV236_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV236_ALL_PASSED');
