// 验证器 v98: 上方时间轴折返标记 = 皮肤 reversearrow 贴图 (替换白色圆点)
// 依据: 用户要求与游玩区折返箭头同图; renderer.ts:421 游玩区折返箭头 = skin.reversearrow 按切线角旋转
// 时间轴连体条水平: 奇数 repeat 节点在尾端 -> 箭头朝左 (rotate π), 偶数节点在头端 -> 朝右 (贴图原向)
// 运行: cd app && node verifier/v98/check.mjs; node verifier/v98/cdp-v98.mjs (需 7100 dev server)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('Timelines.tsx: 折返标记用皮肤 reversearrow (不再是白点)');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(src.includes("import { getSkin } from '@/osu/skin'"), '引入 getSkin');
  assert(src.includes('getSkin().reversearrow'), '取皮肤 reversearrow 贴图');
  assert(!src.includes("g.fillStyle = 'rgba(255,255,255,0.85)'"), '旧白点填充已删除');
  assert(!src.includes('arc(tx, cy, 3.5'), '旧折返圆点 (r=3.5) 已删除');
  assert(src.includes('g.drawImage(img,'), 'drawImage 绘制箭头贴图');
}

section('Timelines.tsx: 方向语义 (尾端朝左 / 头端朝右)');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(src.includes('g.rotate(s % 2 === 1 ? Math.PI : 0)'), '奇数节点 (尾端) 旋转 π 朝左, 偶数 (头端) 原向朝右');
  assert(src.includes('rad * 2'), '箭头尺寸 = rad*2 (v205 起与 note 圆等大; 原 rad*1.3)');
  assert(src.indexOf('drawTimelineObject') < src.indexOf('getSkin().reversearrow'), '箭头绘制在共用 drawTimelineObject 内 (真实物件与幻影共用入口)');
}

if (failures) { console.error(`\nVERIFIER_V98_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V98_ALL_TESTS_PASSED');
