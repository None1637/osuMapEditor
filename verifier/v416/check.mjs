// 验证器 v416: 测试游玩 HUD — 皮肤光标 + 光标拖尾 + 隐藏系统光标
//  - 皮肤 cursor.png (@2x 优先, 经 SKIN_FILES/fileVariants/skinScaleAdjust 既有通道) 居中绘制,
//    缺失回退程序化白圈; 尺寸 = 固有尺寸上限圈径 (与 v298 判定弹出同一取舍)。
//  - 皮肤 cursortrail.png 拖尾: 最近 ~120ms 轨迹渐缩渐隐, 按住击打键更密 (逐帧采样) 更不透明;
//    缺失不画拖尾。
//  - 覆盖层 cursor:none 隐藏系统光标; DOM 按钮 (mod 栏/退出/跳过) 显式 cursor-pointer。
// 运行: node verifier/v416/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v416/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v416/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V416_TESTS_*)
fs.unlinkSync(out);

const hud = read('src/osu/gameplay/hud.ts');
assert(/TRAIL_MS = 120/.test(hud), '拖尾窗 120ms');
assert(/export function updateTrail/.test(hud) && /held \|\| time - last\.t >= 8/.test(hud), '按住逐帧采样/未按住节流');
assert(/export function trailAlpha/.test(hud) && /held \? 0\.8 : 0\.45/.test(hud), '按住更不透明');
assert(/export function trailScale/.test(hud), '沿轨迹渐缩');

const skin = read('src/osu/skin.ts');
assert(/cursor\?: SkinImage/.test(skin) && /cursortrail\?: SkinImage/.test(skin), 'Skin 接口加 cursor/cursortrail (可选)');
assert(/\['cursor', 'cursor\.png'\]/.test(skin) && /\['cursortrail', 'cursortrail\.png'\]/.test(skin), 'SKIN_FILES 注册 (走 @2x/默认皮肤既有通道)');
assert(/skin\.cursor = undefined/.test(skin) && /skin\.cursortrail = undefined/.test(skin), '换肤清场防旧肤残留');

const ov = read('src/components/TestPlayOverlay.tsx');
assert(/skin\.cursor/.test(ov), '皮肤光标绘制');
assert(/skinScaleAdjust\.get\(cursorImg\)/.test(ov), '@2x 光标按半尺寸绘制');
assert(/skin\.cursortrail/.test(ov) && /updateTrail\(trail, cur\.x, cur\.y, time, held\)/.test(ov), '拖尾轨迹记录+绘制');
assert(/trailAlpha\(p\.t, time, held\)/.test(ov) && /trailScale\(p\.t, time\)/.test(ov), '拖尾渐隐渐缩');
// 拖尾先画, 光标后画 (光标在拖尾之上)
assert(ov.indexOf('skin.cursortrail') < ov.indexOf('const cursorImg = skin.cursor'), '拖尾在光标本体之下');
// 白圈回退保留
assert(/g\.arc\(cur\.x, cur\.y, held \? 7 : 10/.test(ov), '皮肤缺失回退白圈 (按住略缩)');
// 隐藏系统光标: 覆盖层与 canvas cursor-none, 按钮显式 cursor-pointer
assert(/data-testid="testplay-overlay"[\s\S]{0,120}?cursor-none/.test(ov) || /cursor-none"[^>]*data-testid="testplay-overlay"/.test(ov) || /className="fixed inset-0 z-\[80\] bg-black cursor-none"/.test(ov), '覆盖层 cursor:none');
assert(/<canvas[^>]*cursor-none/.test(ov), 'canvas cursor:none');
assert(/data-testid="testplay-exit"[\s\S]{0,400}?cursor-pointer/.test(ov) || /cursor-pointer[^>]*>\s*\{t\('testplay\.exit'/.test(ov) || /text-xs cursor-pointer"\s*\n?\s*data-testid="testplay-exit"/.test(ov), '退出按钮恢复 cursor:pointer');
assert(/rounded text-\[11px\] font-mono cursor-pointer/.test(ov), 'mod 栏按钮恢复 cursor:pointer');

console.log(failures ? `\nVERIFIER_V416_FAILED: ${failures} 处失败` : '\nVERIFIER_V416_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
