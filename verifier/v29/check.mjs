// 验证器 v29: 滑条节点编辑体验 — 控制点可超出游玩区 + 红点拖拽成对移动不拆对 + 右键红点转白 (左键仅白切红)
// 运行: cd app && node verifier/v29/check.mjs; node verifier/v29/cdp-redpair.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v29/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v29/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// 纯函数测试 (redPairPartner)
await import('file://' + out);
fs.unlinkSync(out);

// ---- 源码接线断言 ----
section('sliderPath.ts');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(src.includes('export function redPairPartner'), '导出 redPairPartner');
}

section('EditorCanvas.tsx: v29 节点编辑手势');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/pairWith: redPairPartner\(ctrl, (i|hitIdx)\)/.test(src), 'mousedown 记录红点配对下标'); // v35: 命中下标经 nearestCtrlPoint 得名 hitIdx
  assert(/if \(nd\.pairWith !== null\) setPt\(nd\.pairWith\)/.test(src), '拖拽红点成对移动 (不拆对)');
  // 节点拖拽段不再钳制到游玩区: setPt 直接用吸附后的 round 坐标 (v76 起先经物件/网格吸附, 仍无 PW/PH 钳制)
  assert(/const nx = Math\.round\(sp\.x\), ny = Math\.round\(sp\.y\);/.test(src), '节点拖拽坐标不钳制 (可超出游玩区; v76 起经吸附)');
  assert(!/setPt[\s\S]{0,200}Math\.min\(PW, p\.x\)/.test(src), 'setPt 无 PW/PH 钳制');
  assert(/!isRedPairPoint\(ctrl, nd\.pointIndex\) \? toggleSliderPointRed/.test(src), '左键点击仅白->红 (红点点击无操作)');
  assert(/onContextMenu[\s\S]*?isRedPairPoint\(ctrl, i\)[\s\S]*?toggleSliderPointRed[\s\S]*?else[\s\S]*?deleteSliderPoint/.test(src),
    '右键: 红点合并转白 / 白点删除 分支');
}

if (failures) { console.error(`\nVERIFIER_V29_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V29_ALL_TESTS_PASSED');
