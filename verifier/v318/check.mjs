// 验证器 v318: F24a/b — 放置预览完全保真 + 右键完成滑条
//   F24a: 放置幽灵 (单点/滑条) 注入正常渲染管线 (mergedWithPreview 合并视图): 完整 note 外观
//     (皮肤贴图+combo 数字) / follow point / 后续物件连击数字实时重排; 视图按签名缓存;
//     drawPendingSlider 骨架模式 (身/头由幽灵绘制, 只补控制连线+手柄); 旧"光秃"幽灵移除
//   F24b: 放置滑条时右键 = 先落下当前幻影点 (与左键同一吸附) 再完成并保留滑条;
//     原仅头部时右键 pend<2 直接丢弃 = "右键不会放置点而是直接退出"
// 运行: node verifier/v318/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const r = readSrc('src/osu/renderer.ts');
const ec = readSrc('src/components/EditorCanvas.tsx');

section('renderer: drawPendingSlider 骨架模式');
{
  assert(/function drawPendingSlider\(rc: RenderCtx, pend[^)]*distanceLock: boolean, skeleton = false\)/.test(r), 'drawPendingSlider 第 5 参 skeleton');
  assert(/if \(!skeleton && raw\.length > 1\)/.test(r), '骨架模式跳过滑条身 (幽灵已画)');
  assert(/if \(!skeleton\) \{\n\s+\/\/ v150: 同 drawCircle/.test(r), '骨架模式跳过头部贴图 (幽灵已画含数字)');
  assert(/drawPendingSlider\(rc, pending, cursor \?\? null, pendingDistanceLock, pendingSkeleton\)/.test(r), 'renderPlayfield 透传 skeleton');
}

section('F24a: 放置幽灵注入渲染管线');
{
  assert(/ghostViewRef = useRef<\{ key: string; src: Beatmap; bmV: Beatmap \} \| null>\(null\)/.test(ec), 'ghostViewRef 合并视图缓存');
  const gh = ec.match(/F24a — 放置幽灵注入正常渲染管线[\s\S]{0,3400}?pendingSkeleton = true;[^\n]*\n/); // v363: 幽灵块加注释/钳制行变长, 窗口 2600→3400
  assert(!!gh, '幽灵构建块存在');
  assert(!!gh && /id: -1, type: 'circle'/.test(gh[0]) && /newCombo: store\.placeNewCombo/.test(gh[0]), '单点/滑条头幽灵 (id -1, 带放置态 NC/音效)');
  assert(!!gh && /id: -2, type: 'slider'/.test(gh[0]) && /computePendingPath\(store\.pendingSlider/.test(gh[0]), '滑条幽灵 (id -2, 与 finishSlider 同源路径)');
  assert(!!gh && /preserveArcsForBezier/.test(gh[0]) && /placementLength\(bm\.timingPoints/.test(gh[0]), '滑条幽灵长度/弧保留 = 落盘公式');
  assert(!!gh && /snapPlacementTime\(bm\.timingPoints, store\.currentTime, store\.beatSnap\)/.test(gh[0]), '幽灵起点时间 = snapPlacementTime (与落盘一致)');
  assert(/mergedWithPreview\(bmView, \{ hideIds: \[\], objects: ghosts \}\)/.test(ec), '幽灵并入渲染视图 (combo/followPoint 重排)');
  assert(/for \(const gh of ghosts\) if \(gh\.type === 'slider'\) invalidatePath\(gh\.id\);/.test(ec), '幽灵滑条路径随签名失效重建');
  assert(/bm: bmRender/.test(ec) && /comboInfo: getCombos\(bmRender\)/.test(ec), 'renderPlayfield 用合并视图 + 重算 combo');
  assert(/pendingSkeleton\); \/\/ v318/.test(ec), '幽灵滑条激活时 pending 只画骨架');
}

section('F24a: 旧光秃幽灵移除');
{
  assert(/光秃幽灵已移除/.test(ec), '旧幽灵块注明移除');
  assert(!/store\.tool === 'slider' && store\.pendingSlider\.length === 0\) \{\n\s+\/\/ 无锚点时预览起点/.test(ec), '滑条头光秃幽灵分支删除');
  assert(/if \(store\.tool === 'spinner'\) \{\n\s+g\.drawImage\(skin\.spinnerCircle/.test(ec), '转盘中心预览保留');
}

section('F24b: 右键 = 落幻影点 + 完成');
{
  const cm = ec.match(/store\.tool === 'slider' && store\.pendingSlider\.length\) \{[\s\S]{0,800}?finishSlider\(\);/);
  assert(!!cm, '右键滑条分支存在');
  assert(!!cm && /F24b/.test(cm[0]), '注明 F24b');
  assert(!!cm && /snapSliderCtrlPoint\(pR\)/.test(cm[0]) && /store\.pendingSlider\.push\(\{ x: Math\.round\(spR\.x\)/.test(cm[0]), '先落幻影点 (左键同一吸附)');
  assert(!!cm && /Math\.hypot\(pR\.x - lastR\.x, pR\.y - lastR\.y\) >= 8/.test(cm[0]), '末点 8px 内不重复落点');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv318 全部通过');
process.exit(failures ? 1 : 0);
