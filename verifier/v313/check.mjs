// 验证器 v313: 所有游玩区交互可拖到四侧 UI 下方 —
//   onMouseLeave 守卫补齐 nodeScale/nodeRotate/pan/标记类拖拽 (原漏接 → 出画布瞬间被 onMouseUp 结算,
//   CDP 复现: 节点 bc 拉伸手柄只剩画布内 3 步); window mousemove 转发补齐标记类拖拽 + 中键平移
// 运行: node verifier/v313/check.mjs (probe-nodescale.mjs 为 CDP 实机验证, 需 7100 dev server, 单独跑)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const src = readSrc('src/components/EditorCanvas.tsx');

section('onMouseLeave 守卫: 全部拖拽状态不终止');
{
  const guard = src.match(/onMouseLeave=\{\(\) => \{[\s\S]{0,1400}?onMouseUp\(\);/);
  assert(!!guard, 'onMouseLeave 守卫存在');
  for (const ref of ['scaleDragRef', 'rotateDragRef', 'nodeScaleDragRef', 'nodeRotateDragRef',
    'freehandRef', 'drawCandRef', 'dragRef', 'nodeDragRef', 'nodesMoveDragRef', 'marqueeRef', 'nodeMarqueeRef',
    'panDragRef', 'originDragRef', 'gridOriginDragRef', 'dupVectorDragRef',
    'symAnchorDragRef', 'symPointDragRef', 'symAxisPointDragRef']) {
    assert(!!guard && guard[0].includes(`!${ref}.current`), `守卫含 ${ref}`);
  }
}

section('window mousemove 转发: 标记类拖拽 + 中键平移');
{
  const fwd = src.match(/else if \(\((dragRef[\s\S]{0,600}?)&& e\.target !== canvasRef\.current\) \{/);
  assert(!!fwd, '拖拽转发分支存在');
  for (const ref of ['originDragRef', 'gridOriginDragRef', 'dupVectorDragRef',
    'symAnchorDragRef', 'symPointDragRef', 'symAxisPointDragRef', 'panDragRef']) {
    assert(!!fwd && fwd[0].includes(`${ref}.current`), `转发含 ${ref}`);
  }
  // 节点手柄拖拽已有独立转发分支 (v117)
  assert(/else if \(nodeScaleDragRef\.current\) \{[\s\S]{0,200}?applyNodeScaleUpdate/.test(src), 'nodeScaleDrag 转发分支 (v117 既有)');
  assert(/else if \(nodeRotateDragRef\.current\) \{[\s\S]{0,100}?applyNodeRotateUpdate/.test(src), 'nodeRotateDrag 转发分支 (v117 既有)');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv313 全部通过');
process.exit(failures ? 1 : 0);
