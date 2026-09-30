// v300: 测试游玩游玩区大小与编辑器一致 + acc 皮肤数字
// 1) TestPlayOverlay 的 osu 坐标变换改用 EditorCanvas 导出的 viewTransform
//    (RESERVED_TOP/BOTTOM 预留 + PAD_Y 40 + 1.2 系数, 与编辑器完全同一公式),
//    替换原 min(w/512,h/384)*0.95 居中公式 — 渲染与 toOsu 命中映射同改。
// 2) acc 走皮肤数字: skin 新增 scorePercent/scoreDot (score-percent.png/score-dot.png,
//    双通道加载, @2x 走 fileVariants 既有约定); drawSkinNumber 支持 '%'/'.' 字符,
//    任一字形缺失整串回退 monospace 文字。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ec = readFileSync(join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
const overlay = readFileSync(join(root, 'src/components/TestPlayOverlay.tsx'), 'utf8');
const skin = readFileSync(join(root, 'src/osu/skin.ts'), 'utf8');

let fails = 0;
const check = (name, cond) => { if (!cond) { fails++; console.error('FAIL:', name); } };

// viewTransform 导出与复用
check('EditorCanvas 导出 viewTransform', /export function viewTransform/.test(ec));
check('overlay import viewTransform', /import \{ viewTransform \} from '\.\/EditorCanvas'/.test(overlay));
check('overlay 渲染用 viewTransform (旧 0.95 公式移除)',
  /const \{ scale, ox, oy \} = viewTransform\(r\)/.test(overlay)
  && !/Math\.min\(r\.width \/ PW, r\.height \/ PH\) \* 0\.95/.test(overlay));
check('overlay toOsu 命中映射同用 viewTransform',
  (overlay.match(/viewTransform\(r\)/g) ?? []).length >= 2);

// acc 皮肤数字
check('skin: scorePercent/scoreDot 字段',
  /scorePercent\?:\s*SkinImage/.test(skin) && /scoreDot\?:\s*SkinImage/.test(skin));
check('skin: SKIN_FILES 含 score-percent/score-dot',
  /\['scorePercent', 'score-percent\.png'\]/.test(skin) && /\['scoreDot', 'score-dot\.png'\]/.test(skin));
check('overlay: drawSkinNumber 支持 % 和 .',
  /ch === '%'\) imgs\.push\(skin\.scorePercent/.test(overlay)
  && /ch === '\.'\) imgs\.push\(skin\.scoreDot/.test(overlay));
check('overlay: acc 走皮肤数字 + 文字回退',
  /drawSkinNumber\(`\$\{\(sc\.accuracy \* 100\)\.toFixed\(2\)\}%`/.test(overlay)
  && /fillText\(`\$\{\(sc\.accuracy \* 100\)\.toFixed\(2\)\}%`/.test(overlay));

if (fails) { console.error(`v300: ${fails} check(s) failed`); process.exit(1); }
console.log('v300: all checks passed');
