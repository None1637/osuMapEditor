// 验证器 v420: 测试游玩 — Hit lighting 命中泛光
//  - 物件命中时在命中位置画皮肤 hitlighting.png (@2x 优先, SKIN_FILES 既有通道),
//    加色混合 lighter, 240ms 内放大 (1→1.8x) 淡出, 画在物件爆炸下层;
//  - miss 不触发 (与爆炸同条件 gi.state==='hit'); 皮肤缺失不画。
// 运行: node verifier/v420/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v420/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v420/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V420_TESTS_*)
fs.unlinkSync(out);

const hud = read('src/osu/gameplay/hud.ts');
assert(/HIT_LIGHTING_MS = 240/.test(hud), '泛光时长 240ms');
assert(/export function hitLightingState/.test(hud) && /1 \+ 0\.8 \* k/.test(hud), '放大淡出状态函数');

const skin = read('src/osu/skin.ts');
assert(/hitlighting\?: SkinImage/.test(skin), 'Skin 接口加 hitlighting (可选)');
assert(/\['hitlighting', 'hitlighting\.png'\]/.test(skin), 'SKIN_FILES 注册 (@2x/默认皮肤既有通道)');
assert(/skin\.hitlighting = undefined/.test(skin), '换肤清场防旧肤残留');

const rd = read('src/osu/renderer.ts');
assert(/skin\.hitlighting/.test(rd) && /hitLightingState\(time - gi\.hitAt\)/.test(rd), '命中位置绘制泛光 (锚定实际命中时刻)');
assert(/globalCompositeOperation = 'lighter'/.test(rd), '加色混合 lighter');
assert(/gi\?\.state === 'hit' \? hitLightingState/.test(rd), '与爆炸同条件 (miss 不触发)');
assert(/skinScaleAdjust\.get\(skin\.hitlighting\)/.test(rd), '@2x 半尺寸绘制');
// 泛光画在物件本体 (爆炸) 下层: hitlighting 绘制出现在 drawCircle/drawSlider 分派之前
const li = rd.indexOf("skin.hitlighting") , di = rd.indexOf("drawCircle(rc, o, radius, color");
assert(li > 0 && li < di, '泛光在物件爆炸下层 (先画)');

console.log(failures ? `\nVERIFIER_V420_FAILED: ${failures} 处失败` : '\nVERIFIER_V420_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
