// v298: 测试游玩 HUD 皮肤贴图 + mod 持久化确认
// 1) mod 记住: v294 已有 localStorage 持久化 (osu-editor:testplay-mods), 本版加回归断言
//    (useState(loadTestMods) 初始化 = 下次打开/下次启动都恢复; 切换即 saveTestMods)。
// 2) HUD 皮肤化: skin.ts 新增 hit300/hit100/hit50/hit0 (判定弹出), scorebar-bg/scorebar-colour
//    (血条), score-0..9 + score-x (分数/combo 数字); 默认皮肤与用户皮肤目录双通道加载
//    (@2x 优先走 fileVariants/skinScaleAdjust 既有约定); 缺失项回退原程序化文字/色条。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skin = readFileSync(join(root, 'src/osu/skin.ts'), 'utf8');
const overlay = readFileSync(join(root, 'src/components/TestPlayOverlay.tsx'), 'utf8');
const mods = readFileSync(join(root, 'src/osu/gameplay/mods.ts'), 'utf8');

let fails = 0;
const check = (name, cond) => { if (!cond) { fails++; console.error('FAIL:', name); } };

// mod 持久化 (v294 已有, v298 回归断言)
check('mods: localStorage 键 + load/save',
  mods.includes("'osu-editor:testplay-mods'") && /export function loadTestMods/.test(mods) && /export function saveTestMods/.test(mods));
check('overlay: useState(loadTestMods) 初始化 (重开/重启恢复)',
  /useState<TestModId\[\]>\(loadTestMods\)/.test(overlay));
check('overlay: 切换即 saveTestMods',
  /saveTestMods\(next\)/.test(overlay));

// skin.ts 字段与加载
check('skin: hit300/hit100/hit50/hit0 可选字段',
  /hit300\?:\s*SkinImage/.test(skin) && /hit100\?:\s*SkinImage/.test(skin) && /hit50\?:\s*SkinImage/.test(skin) && /hit0\?:\s*SkinImage/.test(skin));
check('skin: scorebarBg/scorebarColour/scoreX 字段',
  /scorebarBg\?:\s*SkinImage/.test(skin) && /scorebarColour\?:\s*SkinImage/.test(skin) && /scoreX\?:\s*SkinImage/.test(skin));
check('skin: scoreDigits 字段 + 程序化回退为 null 数组',
  /scoreDigits:\s*\(SkinImage \| null\)\[\]/.test(skin) && /scoreDigits: Array\.from\(\{ length: 10 \}, \(\) => null\)/.test(skin));
check('skin: SKIN_FILES 含判定/血条/score-x',
  /\['hit300', 'hit300\.png'\]/.test(skin) && /\['hit0', 'hit0\.png'\]/.test(skin)
  && /\['scorebarBg', 'scorebar-bg\.png'\]/.test(skin) && /\['scorebarColour', 'scorebar-colour\.png'\]/.test(skin)
  && /\['scoreX', 'score-x\.png'\]/.test(skin));
check('skin: 默认皮肤通道加载 score-0..9 (pending +20)',
  /pending = SKIN_FILES\.length \+ 20/.test(skin) && /skin\/score-\$\{i\}\.png/.test(skin));
check('skin: 用户皮肤目录通道加载 score-0..9 (@2x 走 fileVariants)',
  /total = SKIN_FILES\.length \+ 20/.test(skin) && /fileVariants\(`score-\$\{i\}\.png`\)/.test(skin));

// TestPlayOverlay 渲染
check('overlay: 判定弹出皮肤贴图映射 + @2x 缩放修正 + 文字回退',
  /\{ great: skin\.hit300, ok: skin\.hit100, meh: skin\.hit50, miss: skin\.hit0 \}\[p\.result\]/.test(overlay)
  && /skinScaleAdjust\.get\(img\)/.test(overlay) && /RESULT_TEXT\[p\.result\]/.test(overlay));
check('overlay: 血条 scorebar 贴图 + hp 裁剪填充 + 色条回退',
  /skin\.scorebarBg && skin\.scorebarColour/.test(overlay) && /g\.clip\(\)/.test(overlay) && /PW \* scale \* sc\.hp/.test(overlay));
check('overlay: drawSkinNumber (数字+x, 缺字形整串回退)',
  /drawSkinNumber = \(text: string/.test(overlay) && /skin\.scoreDigits\[\+ch\]/.test(overlay)
  && /skin\.scoreX \?\? null/.test(overlay) && /imgs\.some\(i => !i\)\) return false/.test(overlay));
check('overlay: 分数/combo 走皮肤数字 (回退文字保留)',
  /drawSkinNumber\(String\(sc\.score\)\.padStart\(8, '0'\)/.test(overlay)
  && /drawSkinNumber\(`\$\{sc\.combo\}x`/.test(overlay)
  && /padStart\(8, '0'\), ox \+ PW \* scale - 8, oy \+ 30/.test(overlay));

if (fails) { console.error(`v298: ${fails} check(s) failed`); process.exit(1); }
console.log('v298: all checks passed');
