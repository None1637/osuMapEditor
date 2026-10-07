// 验证器 v309: 三 bug — Alt 松开框选逻辑跟随 / 红锚点 Alt 单击整对取消 / 节点黄框内按下整组拖
// 运行: node verifier/v309/check.mjs (probe-verify.mjs 为 CDP 实机验证, 需 7100 dev server, 单独跑)
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

section('bug1: 框选逻辑随 Alt 实时切换 (syncMarqueeMode)');
{
  assert(/const syncMarqueeMode = \(\) => \{/.test(src), 'syncMarqueeMode 存在');
  assert(/nodeMarqueeRef\.current && !altHeldRef\.current[\s\S]{0,200}?marqueeRef\.current = \{ x0: nmq\.x0/.test(src),
    'Alt 松开: 节点框选 → 物件框选 (起点/当前点迁移)');
  assert(/marqueeRef\.current && altHeldRef\.current && !store\.lockNotes[\s\S]{0,200}?nodeMarqueeRef\.current = \{ x0: mq\.x0/.test(src),
    'Alt 按下: 物件框选 → 节点框选');
  assert(/store\.setSelectedNodes\(\[\]\); \/\/ 蓝框 = 物件框选/.test(src), '转物件框选时清节点选区');
  // mousemove 与 mouseup 双入口 (松开 Alt 后直接松鼠标无 mousemove 也按当前 Alt 态收尾)
  assert(/节点框选拖拽: 实时更新节点选区[^\n]*\n\s*syncMarqueeMode\(\);/.test(src), 'mousemove 入口同步');
  assert(/节点框选收尾[^\n]*\n\s*syncMarqueeMode\(\);/.test(src), 'mouseup 入口同步');
}

section('bug2: 红锚点 Alt+单击整对切换');
{
  assert(/v309: 红锚点重复对视为整体切换/.test(src), 'Alt+单击查红锚点配对下标 (注释标注)');
  assert(/const partner = redPairPartner\(hctrl, hitNode\.idx\);/.test(src), 'redPairPartner 查配对');
  assert(/if \(hasI \|\| hasP\) \{ \/\/ 已选 → 整对取消/.test(src), '已选 → 整对取消 (两个下标都移除)');
  assert(/else \{ \/\/ 未选 → 整对加入/.test(src), '未选 → 整对加入 (重复对不拆散)');
}

section('bug3: 节点黄框内部按下 = 整组拖');
{
  const i266 = src.indexOf('const nodeGroupDragPress'); // v360: 抽函数 (穿透共用)
  const iHit = src.indexOf('const hit = hitTest(p.x, p.y);');
  const blk = i266 > 0 && iHit > i266 ? src.slice(i266, iHit) : '';
  assert(blk.length > 0, '节点整组拖分支在 hitTest 之前');
  assert(/currentQuads\(bm\)/.test(blk) && /nbox\.dq\.x/.test(blk), '按下点在节点黄框 dq 内 → 整组拖');
  assert(/!insideNode && !insideBox/.test(blk), '命中已选节点 或 框内 均触发 (v360 早返形态)');
  assert(/距按下点最近的已选节点/.test(blk), '框内按下时吸附锚 = 最近已选节点');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv309 全部通过');
process.exit(failures ? 1 : 0);
