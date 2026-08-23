// 验证器 v15: 滑条编辑对齐 lazer + 皮肤文件夹选择与记忆
//  - computePendingPath 纯函数单测 (分段类型推断/红点加倍/几何全长/cursor 幻影点)
//  - renderer/EditorCanvas 滑条预览接线
//  - library.ts 皮肤目录选择/恢复/遗忘 (IndexedDB 持久化)
//  - skin.ts 用户皮肤目录加载与恢复默认
//  - store.ts 皮肤 hitsound 覆盖与重置
//  - SkinPicker/App.tsx UI 接线与启动自动恢复
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('computePendingPath 单元断言 (tests.ts)');
{
  const out = path.join(root, 'verifier/v15/_bundle.mjs');
  buildSync({
    entryPoints: [path.join(root, 'verifier/v15/tests.ts')],
    bundle: true, format: 'esm', platform: 'node', outfile: out,
  });
  await import('file://' + out);
  fs.unlinkSync(out);
}

section('sliderPath.ts: lazer 段类型推断与放置路径');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(src.includes('export function inferSegmentType'), 'inferSegmentType 导出');
  assert(src.includes("len <= 2 ? 'L' : len === 3 ? 'P' : 'B'"), '1~2点L/3点P/4+B (lazer updatePathType)');
  assert(src.includes('export function computePendingPath'), 'computePendingPath 导出');
  assert(src.includes('redAnchor && seg.length > 1'), '红点分段');
  assert(src.includes("hasRed ? 'B' : inferSegmentType"), '有红点导出 B');
}

section('renderer.ts: 放置预览画真实滑条身');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/renderPlayfield\(rc: RenderCtx, pending\?.*cursor\?/.test(src), 'renderPlayfield 接受 cursor 参数');
  assert(src.includes('drawPendingSlider'), 'drawPendingSlider 预览函数');
  assert(src.includes('sliderstartcircle') && src.includes('redAnchor'), '预览含头部贴图与红白锚点');
}

section('EditorCanvas.tsx: 滑条放置交互接线');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(src.includes('computePendingPath'), '引入 computePendingPath');
  assert(/store\.pendingSlider,\s*\n?[^\n]*\n?\s*cur\.inside && store\.tool === 'slider'/.test(src), 'renderPlayfield 传入 cursor (v207: 中间隔 v207 注释行)');
  assert(src.includes('last.redAnchor = !last.redAnchor'), '点末点切换红锚点');
  assert(src.includes('placementLength(bm.timingPoints'), '锁定间距吸附到整拍 (v83 起收敛到 sliderPath.placementLength)');
  assert(!src.includes("预览到鼠标的连线"), '旧直线幽灵预览已删除');
}

section('library.ts: 皮肤目录选择/恢复/遗忘');
{
  const src = readSrc('src/osu/library.ts');
  assert(src.includes("KEY_SKIN_DIR = 'skinDirHandle'"), '皮肤目录 IndexedDB key');
  assert(src.includes('async function pickDir(pickerId: string'), '泛化 pickDir');
  assert(src.includes('export async function pickSkinDir()'), 'pickSkinDir 导出');
  assert(src.includes('export function restoreSkinDir()'), 'restoreSkinDir 导出');
  assert(src.includes('export async function forgetSkinDir()'), 'forgetSkinDir 导出');
  assert(src.includes("pickDir('osu-songs', KEY_SONGS_DIR)"), '曲库目录沿用泛化通道');
}

section('skin.ts: 用户皮肤目录加载与恢复默认');
{
  const src = readSrc('src/osu/skin.ts');
  assert(src.includes('export async function applySkinFromDir'), 'applySkinFromDir 导出');
  assert(src.includes('export function resetSkinToDefault'), 'resetSkinToDefault 导出');
  assert(src.includes('skinObjectUrls') && src.includes('URL.revokeObjectURL'), 'objectURL 生命周期管理');
  assert(src.includes("'@2x.png'") || src.includes('@2x.png'), '@2x 高清皮肤候选名');
  assert(src.includes('makeProceduralBase'), '程序化回退底复用');
}

section('store.ts: 皮肤 hitsound 覆盖与重置');
{
  const src = readSrc('src/osu/store.ts');
  assert(src.includes('async applySkinSamples'), 'applySkinSamples');
  assert(src.includes('resetSkinSamples()'), 'resetSkinSamples');
  assert(src.includes('skinSampleStems'), '皮肤覆盖 stem 跟踪');
  assert(src.includes('if (!this.skinSampleStems.has(stem))'), '迟到的默认采样不回写皮肤采样');
}

section('SkinPicker/App: UI 接线与启动自动恢复');
{
  const picker = path.join(root, 'src/components/SkinPicker.tsx');
  assert(fs.existsSync(picker), 'SkinPicker.tsx 存在');
  const src = readSrc('src/components/SkinPicker.tsx');
  assert(src.includes('pickSkinDir') && src.includes('restoreSkinDir'), 'SkinPicker 选择/恢复');
  assert(src.includes('dirHandleFromDrop'), 'SkinPicker 拖拽通道');
  assert(src.includes('resetSkinToDefault') && src.includes('forgetSkinDir'), '恢复默认 + 清除记忆');
  assert(src.includes('collectSampleFiles') && src.includes('applySkinSamples'), '皮肤 hitsound 应用');
  const app = readSrc('src/App.tsx');
  assert(app.includes('SkinPicker'), 'App 引入 SkinPicker');
  assert(app.includes('Palette') && /Palette className="inline-block w-4 h-4 mr-1 -mt-0\.5" \/>皮肤/.test(app), '工具栏皮肤按钮 (v181: 🎨 → lucide Palette)');
  assert(app.includes('restoreSkinDir'), '启动时自动恢复皮肤目录');
  assert(app.includes('showLibrary || showSkin'), '皮肤面板打开时禁用快捷键');
}

if (failures) { console.error(`\nVERIFIER_V15_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V15_ALL_TESTS_PASSED');
