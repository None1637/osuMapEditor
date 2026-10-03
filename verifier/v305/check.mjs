// 验证器 v305: F03 stable 选中效果对齐实机截图 —
//   圆圈/转盘选中 = 橙黄圆环 (hover = 蓝环), 滑条选中 = 蓝色边框高亮描边 + 头尾橙黄圆环;
//   取代 v232 的皮肤 hitcircleselect 方框 (用户截图确认 stable 无方框)
// 运行: node verifier/v305/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer.ts: stable 选中圆环/描边');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(!/function drawSelectionBox/.test(src), 'v232 方框绘制已移除');
  assert(/export function drawSelectionRing[\s\S]{0,120}color = '#f5a623'/.test(src), '选中环默认橙黄 #f5a623');
  assert(/g\.arc\(x, y, r \* 1\.06, 0, Math\.PI \* 2\)/.test(src), '圆环半径 1.06r (贴圆圈外缘)');
  assert(/export function drawSliderBodyOutline\(g: CanvasRenderingContext2D, points: \{ x: number; y: number \}\[\], r: number, color = '#4df3ff'\)/.test(src),
    '滑条描边环支持颜色参数并导出');
  assert(/og\.strokeStyle = color;/.test(src), '描边环用传入颜色');
}

section('EditorCanvas.tsx: stable hover 蓝环');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const hoverObjRef = useRef<number \| null>\(null\);/.test(src), 'hoverObjRef 存在');
  assert(/hoverObjRef\.current = hit && !store\.selected\.has\(hit\.id\) \? hit\.id : null;/.test(src), '悬停未选中物件记录 id');
  assert(/if \(displaySettings\.selectionStyle === 'stable'\) \{[\s\S]{0,200}?hoverObjRef\.current/.test(src), '仅 stable 模式画 hover 蓝环');
  assert(/hoverObjRef\.current = null; \/\/ v305/.test(src), '光标出游玩区清 hover 环');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv305 全部通过');
process.exit(failures ? 1 : 0);
