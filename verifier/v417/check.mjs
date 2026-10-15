// 验证器 v417: 测试游玩 HUD — 谱面背景图 cover 铺满 + 0.7 压暗
//  - 绘制编辑器已有的 store.backgroundImg, cover 铺满 512×384 osu 坐标区 (居中), 其上 0.7 黑压暗;
//  - 转盘期间 renderer drawSpinner 的额外压暗 (spinnerBackground) 照旧叠加;
//  - 背景未加载/不存在维持纯黑。
// 运行: node verifier/v417/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v417/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v417/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V417_TESTS_*)
fs.unlinkSync(out);

const hud = read('src/osu/gameplay/hud.ts');
assert(/export function coverRect/.test(hud) && /Math\.max\(boxW \/ imgW, boxH \/ imgH\)/.test(hud), 'coverRect cover 公式');

const ov = read('src/components/TestPlayOverlay.tsx');
assert(/store\.backgroundImg/.test(ov), '取编辑器已有背景图 (store.backgroundImg)');
assert(/coverRect\(bg\.width, bg\.height, PW, PH\)/.test(ov), 'cover 铺满 512×384 osu 区');
assert(/rgba\(0,0,0,0\.7\)/.test(ov), '0.7 黑压暗层');
assert(/if \(bg\) \{/.test(ov), '背景缺失维持纯黑 (条件绘制)');
// 背景在 renderPlayfield 之前 (物件在背景之上)
assert(ov.indexOf('store.backgroundImg') < ov.indexOf('renderPlayfield({'), '背景先于物件绘制');

// 转盘额外压暗保留 (renderer 既有逻辑不动)
const rd = read('src/osu/renderer.ts');
assert(/转盘期间压暗全屏/.test(rd) && /drawImage\(skin\.spinnerBackground, 0, 0, 512, 384\)/.test(rd), '转盘额外压暗照旧叠加');

console.log(failures ? `\nVERIFIER_V417_FAILED: ${failures} 处失败` : '\nVERIFIER_V417_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
