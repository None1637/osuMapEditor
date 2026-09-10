// 验证器 v245: 全选/播放两场景性能优化 (CDP 实测驱动)。
// 需求: 2000 物件全选 ≥60fps; 1000 绿线播放 ≥240fps。
// profile 基线 (verifier/v245/profile.mjs, 无头 Edge 软件渲染): A=2.8fps (帧忙 337ms, 几乎全是逐物件
//   选中装饰的软件光栅), B=60fps (帧忙 11.3ms; emitPlayback 每帧全量 React 重渲 + 时间轴全量重绘)。
// 优化 (GPU 复测: A/B 均达 rAF 上限 240fps, 帧忙 0.25ms):
//   A: renderer.ts 选中装饰离屏层缓存 (drawSelectionLayer — 键=数据版本+选区签名+变换+画布尺寸+样式+皮肤,
//     帧内 1 次 drawImage; v40 不可见选中物件画装饰语义保留在层构建循环) + followPointPairs 按谱面缓存;
//     EditorCanvas currentQuads/computeCombos 帧级 memo; 网格/背景/边框静态层缓存 (staticLayerRef)。
//   B: store.emitPlaybackFrame 逐帧独立通道 (usePlaybackFrame, TimingPanel 订阅; emitPlayback 保留给低频
//     轻量全量刷新); Timelines 红/绿线与节拍 tick 合批、药丸 measureText 缓存 (measureCached)、
//     svPoints/stackInfo/computeCombos 帧级 memo、BottomTimeline 静态层缓存 (只播放头逐帧画)。
// 运行: node verifier/v245/check.mjs; 实测: node verifier/v245/profile.mjs (需 7100 dev server)
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer.ts: 选中装饰离屏层 + followPoint 缓存');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/function drawSelectionLayer\(rc: RenderCtx, radius: number\)/.test(src), 'drawSelectionLayer 存在');
  assert(/let selLayer: \{ key: string; c: HTMLCanvasElement; x: number; y: number; empty: boolean \} \| null = null/.test(src), '层缓存单例 (v246: +层原点/空标记, 层裁剪到选区包围盒)');
  assert(/rc\.cacheKey \?\? ''/.test(src) && /displaySettings\.selectionStyle, displaySettings\.sliderPointStyle/.test(src)
    && /m\.a\.toFixed\(4\)/.test(src), '键 = 数据版本+选区+变换+样式');
  assert(/for \(const o of bm\.hitObjects\) if \(rc\.selected\.has\(o\.id\)\) drawSelectionDecor\(lrc, o, radius\);/.test(src),
    '层构建覆盖全部选中物件 (v40 语义)');
  assert(/g\.drawImage\(selLayer\.c, selLayer\.x, selLayer\.y\);/.test(src), '整层一次 drawImage 贴回 (v246: 带层原点偏移)');
  assert(!/if \(rc\.selected\.has\(o\.id\)\) drawSelectionDecor\(rc, o, radius\);/.test(src), '物件循环内逐物件装饰已移除');
  assert(/function followPointPairsMemo\(rc: RenderCtx\)/.test(src) && /fpPairsCache = new WeakMap/.test(src), 'followPointPairs 按谱面+键缓存');
  assert(/cacheKey\?: string;/.test(src), 'RenderCtx.cacheKey 字段');
}

section('EditorCanvas.tsx: 帧级 memo + 静态层');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/cacheKey: String\(store\.getDataVersion\(\)\)/.test(src), 'renderPlayfield 传 cacheKey (dataVersion)');
  assert(/const getCombos = \(bmView: Beatmap\)/.test(src) && /comboRef\.current = \{ ver, bm: bmView, map: computeCombos\(bmView\) \}/.test(src),
    'computeCombos 帧级 memo');
  assert(/const quadsRef = useRef/.test(src) && /selectionSig\(\)/.test(src) && /quadsRef\.current = \{ key, bm, v \}/.test(src),
    'currentQuads 帧级 memo (数据版本+选区签名)');
  assert(/const staticLayerRef = useRef<\{ key: string; c: HTMLCanvasElement; x: number; y: number \} \| null>/.test(src), '静态层 ref (v246: +层原点, 层裁剪到游玩区设备矩形)');
  assert(/staticLayerRef\.current\.key = key/.test(src) && /g\.drawImage\(staticLayerRef\.current\.c, staticLayerRef\.current\.x, staticLayerRef\.current\.y\)/.test(src),
    '网格/背景/边框静态层缓存 + 贴回 (v246: 带层原点偏移)');
  assert(/if \(store\.playing\) store\.emitPlaybackFrame\(\);/.test(src), '播放逐帧走 emitPlaybackFrame');
}

section('store.ts: 播放逐帧独立通道');
{
  const src = readSrc('src/osu/store.ts');
  assert(/emitPlaybackFrame\(\) \{ this\.playbackFrameVersion\+\+/.test(src), 'emitPlaybackFrame 只 bump 逐帧版本');
  assert(/subscribePlaybackFrame = \(fn/.test(src) && /getPlaybackFrameVersion = \(\)/.test(src), '订阅/取版本');
  assert(/export function usePlaybackFrame\(\)/.test(src), 'usePlaybackFrame hook 导出');
  assert(/emitPlayback\(\) \{ this\.version\+\+/.test(src), 'emitPlayback (低频轻量全量刷新) 保留');
}

section('TimingPanel.tsx: 订阅逐帧通道');
{
  const src = readSrc('src/components/TimingPanel.tsx');
  assert(/usePlaybackFrame\(\);/.test(src), 'TimingPanel 订阅播放逐帧 (生效绿线行/时间显示)');
}

section('Timelines.tsx: 合批 + memo + 静态层');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/function measureCached\(g: CanvasRenderingContext2D, text: string\)/.test(src), '药丸测宽缓存 measureCached');
  assert(/for \(const wantRed of \[true, false\]\)/.test(src), '上时间轴红/绿线合批');
  assert(/const groups = new Map<TickLevel, number\[\]>\(\)/.test(src), '节拍 tick 按级合批');
  assert(/memoSv = \{ ver: dataVer, pts: bm\.timingPoints, out: svPoints/.test(src), 'svPoints 帧级 memo');
  assert(/memoStacks = \{ ver: dataVer, arr: drawList, map: stackInfo\(drawList\) \}/.test(src), 'stackInfo 帧级 memo');
  assert(/memoCombos = \{ ver: dataVer, bm: bmView, map: computeCombos\(bmView\) \}/.test(src), 'computeCombos 帧级 memo');
  assert(/let layer: \{ key: string; c: HTMLCanvasElement \} \| null = null/.test(src)
    && /g\.drawImage\(layer\.c, 0, 0\)/.test(src), 'BottomTimeline 静态层缓存 + 贴回');
  assert(/g\.moveTo\(x\(store\.currentTime\), 0\); g\.lineTo\(x\(store\.currentTime\), r\.height\); g\.stroke\(\);/.test(src),
    'BottomTimeline 播放头仍逐帧绘制');
}

if (failures) { console.error(`\nV245_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV245_ALL_PASSED');
