// 验证器 v249: 独立窗口抗全局缩放 — 分辨率缩小 (v217 zoom<1) 时保持自然大小,
// 仅视口小于窗口自然尺寸时才等比缩小容纳。
// 覆盖: DraggableDialog (显示设置/音量/多边形生成/批量复制/对称滑条/转连打/几何辅助/Timing点 等全部)
//   + 遮罩居中型 (UnsavedDialog/SkinListPanel/FirstRunWizard 经 useCounterZoom)。
// 坐标系依据 (Chromium 150 实测): fixed/absolute 的 left/top 与宽高被 祖先zoom×自身zoom 连乘,
//   故自身 zoom c=fit/z 时视觉=布局×fit, 定位 left=视觉px/fit。
// 运行: node verifier/v249/check.mjs; 实测: node verifier/v249/cdp-v249.mjs (需 7100 dev server;
//   TINY=1 WIN_W=360 WIN_H=280 跑极小窗口收缩场景)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v249/_bundle.mjs');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('dialogFit 纯函数');
{
  buildSync({
    entryPoints: [path.join(root, 'verifier/v249/tests.ts')],
    bundle: true, format: 'esm', platform: 'node', outfile: out,
    alias: { '@': path.join(root, 'src') },
  });
  await import('file://' + out);
  fs.unlinkSync(out);
  const src = readSrc('src/osu/uiZoom.ts');
  assert(/export function dialogFit\(natW: number, natH: number, vw: number, vh: number\)/.test(src), '导出 dialogFit');
  assert(/Math\.min\(1, \(vw - 8\) \/ natW, \(vh - 8\) \/ natH\)/.test(src), '公式: 留 8px 边距等比容纳');
  assert(/export function useCounterZoom/.test(src), '导出 useCounterZoom (遮罩居中型窗口用)');
}

section('DraggableDialog: 反缩放 + 视觉坐标定位');
{
  const src = readSrc('src/components/DraggableDialog.tsx');
  assert(/const c = fit \/ z/.test(src), '自身 zoom c = fit/z');
  assert(/zoom: c, '--fs-comp': 1/.test(src), '应用反缩放 + 覆盖 v225 文本补偿 (恢复自然字号)');
  assert(/left: pos \? pos\.x \/ fit : -9999/.test(src), '定位 left = 视觉px/fit (测量前藏屏外保留)');
  assert(/dialogFit\(r\.width \/ fit, r\.height \/ fit/.test(src), '按实测自然尺寸求容纳系数');
  assert(/window\.innerWidth - r\.width/.test(src), 'resize 后拖拽位置钳回视口');
}

section('遮罩居中型窗口: useCounterZoom');
{
  for (const u of ['UnsavedDialog.tsx', 'SkinListPanel.tsx', 'FirstRunWizard.tsx']) {
    const src = readSrc('src/components/' + u);
    assert(/useCounterZoom\(\)/.test(src) && /ref=\{cz\.ref\} style=\{cz\.style\}/.test(src), `${u} 应用反缩放`);
  }
}

if (failures) { console.error(`\nV249_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV249_ALL_PASSED');
