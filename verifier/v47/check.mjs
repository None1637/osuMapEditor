// 验证器 v47: followpoint 序列帧动画 — followpoint-{n}.png 多帧加载 + skin.ini AnimationFramerate + 按点动画
// 运行: cd app && node verifier/v47/check.mjs; node verifier/v47/cdp-v47.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v47/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v47/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('skin.ts: 序列帧加载通道 (lazer GetAnimation 语义)');
{
  const src = readSrc('src/osu/skin.ts');
  assert(/followpointFrames: SkinImage\[\]/.test(src), 'Skin 接口含 followpointFrames');
  assert(/followpointFrameMs: number/.test(src), 'Skin 接口含 followpointFrameMs');
  assert(/followpointFrames: \[\]/.test(src) && /followpointFrameMs: 1000/.test(src), '程序化回退: 空帧组 + 1000ms');
  assert(/for \(const name of \['followpoint@2x\.png', 'followpoint\.png'\]\)/.test(src), '单图优先 (@2x 在前)');
  assert(/`followpoint-\$\{i\}@2x\.png`, `followpoint-\$\{i\}\.png`/.test(src), '序列帧候选 followpoint-{i}(@2x).png');
  assert(/if \(!got\) break/.test(src), '连续帧到首个缺失为止');
  assert(/AnimationFramerate\\s\*:\\s\*\(\\d\+\)/.test(src), '解析 skin.ini AnimationFramerate');
  assert(/iniRate > 0 \? 1000 \/ iniRate : 1000 \/ frames\.length/.test(src), '帧时长 = 1000/rate 或 1000/帧数 (v143 修正: lazer getFrameLength applyConfigFrameRate 无 ini 默认整组 1 秒/轮)');
  assert(/key === 'followpoint'\) continue/.test(src), 'followpoint 不走通用单图通道');
  assert(!/file === 'followpoint\.png'\) out\.push/.test(src), 'fileVariants 不再塞 followpoint (走专用通道)');
}

section('followPoints.ts / renderer.ts: 按点选帧');
{
  const fp = readSrc('src/osu/followPoints.ts');
  assert(/animStart: number/.test(fp), 'FollowPointDot 含 animStart (= fadeInTime)');
  assert(/animStart: fadeInTime/.test(fp), 'animStart 赋值为 fadeInTime (IAnimationTimeReference)');
  assert(/export function followPointFrameIndex/.test(fp), '导出 followPointFrameIndex');
  const rn = readSrc('src/osu/renderer.ts');
  assert(/frames\.length > 1[\s\S]{0,120}followPointFrameIndex\(frames\.length, skin\.followpointFrameMs, time, p\.animStart\)/.test(rn),
    '多帧时按 (time - animStart)/frameMs 取帧');
  assert(/frames\.length === 1 \? frames\[0\] : skin\.followpoint/.test(rn), '单帧组/单图回退');
}

if (failures) { console.error(`\nVERIFIER_V47_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V47_ALL_TESTS_PASSED');
