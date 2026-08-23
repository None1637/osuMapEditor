// 验证器 v147: 显示设置新增「note 打击动画」开关
//   开 (默认): 命中后 240ms 放大 1.4x 淡出 (lazer 同款, 维持旧行为)
//   关: 命中后不放大, 原大小残留 800ms 线性渐隐 (osu!stable 编辑器同款)
//   与「note 点击特效」关系: 点击特效关 = 命中立即消失 (优先); 打击动画仅在点击特效开时有意义
// 运行: node verifier/v147/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v147/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v147/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V147_TESTS_*)
fs.unlinkSync(out);

section('displaySettings.ts: hitAnimation 开关');
{
  const src = readSrc('src/osu/displaySettings.ts');
  assert(/hitAnimation: boolean;/.test(src), 'DisplaySettings.hitAnimation 字段');
  assert(/hitAnimation: true,/.test(src), '默认开 (维持旧行为)');
  assert(/hitAnimation: p\.hitAnimation !== false,/.test(src), '持久化读取 (缺省 true)');
}

section('lifecycle.ts: 800ms 残留渐隐');
{
  const src = readSrc('src/osu/lifecycle.ts');
  assert(/export const HIT_LINGER = 800;/.test(src), 'HIT_LINGER = 800ms');
  assert(/if \(!displaySettings\.hitAnimation && o\.type === 'circle'\) return Math\.max\(0, 1 - \(time - end\) \/ HIT_LINGER\);/.test(src), 'alphaAt: 关打击动画时 800ms 线性渐隐');
  const iExpl = src.indexOf("if (!displaySettings.hitExplosion && o.type === 'circle') return 0;");
  const iAnim = src.indexOf("if (!displaySettings.hitAnimation && o.type === 'circle')");
  assert(iExpl >= 0 && iAnim > iExpl, '点击特效判定在前 (关点击特效 = 立即消失, 优先于打击动画)');
  assert(/const linger = o\.type === 'circle' && displaySettings\.hitExplosion && !displaySettings\.hitAnimation \? HIT_LINGER : HIT_FADE;/.test(src), 'isVisibleAt: 可见窗口延长到 800ms (仅 点击特效开+打击动画关 的单点)');
}

section('renderer.ts: 关打击动画时不放大');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/const hitFade = o\.type === 'circle' && dt >= 0 && displaySettings\.hitAnimation \? dt \/ 240 : 0;/.test(src), 'hitFade 受 hitAnimation 门控 (关 = 不放大)');
  assert(/const scale = 1 \+ hitFade \* 0\.4;/.test(src), '放大公式不变 (lazer 240ms 1.4x)');
}

section('DisplayPanel: 新选项行');
{
  const src = readSrc('src/components/DisplayPanel.tsx');
  assert(/key: 'hitAnimation', name: 'note 打击动画 \(Hit Animation\)'/.test(src), '打击动画开关行');
  const iExpl = src.indexOf("key: 'hitExplosion'");
  const iAnim = src.indexOf("key: 'hitAnimation'");
  assert(iExpl >= 0 && iAnim > iExpl, '排在点击特效之后');
  // v132 回归: 原有 5 行保留
  for (const k of ['skinColors', 'sliderPathLine', 'approachCircle', 'sliderFadeOut', 'hitExplosion'])
    assert(src.includes(`key: '${k}'`), `v132 保留: ${k}`);
}

if (failures) { console.error(`\nV147_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV147_ALL_PASSED');
