// 验证器 v232: 物件选中效果默认 stable (皮肤 hitcircleselect.png 圆角方框选框)。
// skin.ts: Skin 接口加 hitcircleselect (可选), SKIN_FILES 加载 hitcircleselect.png (@2x 走 fileVariants/skinScaleAdjust 既有通道),
//          无图时程序化生成浅蓝圆角方框回退 (drawHitcircleSelect, 256px/线宽~12/圆角~40);
// displaySettings 新增 selectionStyle ('stable'|'lazer', 默认 'stable', 白名单解析);
// renderer drawSelectionDecor: lazer = 旧行为 (滑条描边环/虚线环), stable = 滑条不画描边环,
//          改在滑条头 (x,y) 与尾 (路径终点) 各画一张 hitcircleselect, 其他物件在 (x,y) 画一张 (边长随圈半径, hiDpi 折半换算);
// DisplayPanel 增加「物件选中效果」下拉行 (stable 选框 / lazer 描边)。
// 运行: node verifier/v232/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('skin.ts: hitcircleselect 加载与程序化回退');
{
  const src = readSrc('src/osu/skin.ts');
  assert(/hitcircleselect\?: SkinImage;/.test(src), 'Skin 接口含可选 hitcircleselect');
  assert(/\['hitcircleselect', 'hitcircleselect\.png'\],/.test(src), 'SKIN_FILES 加载 hitcircleselect.png (@2x 走 fileVariants 既有通道)');
  assert(/function drawHitcircleSelect\(size: number\): HTMLCanvasElement/.test(src), '程序化回退生成函数 drawHitcircleSelect');
  assert(/g\.arcTo\(/.test(src) && /#99ccff/.test(src), '回退 = 浅蓝圆角方框描边 (arcTo 圆角)');
  assert(/hitcircleselect: drawHitcircleSelect\(256\),/.test(src), 'makeProceduralBase 默认生成 256px 选框');
}

section('displaySettings.ts: selectionStyle 字段 (默认 stable)');
{
  const src = readSrc('src/osu/displaySettings.ts');
  assert(/selectionStyle: 'stable' \| 'lazer';/.test(src), '接口含 selectionStyle 字符串枚举字段');
  assert(/selectionStyle: 'stable',/.test(src), '默认值 stable');
  assert(/p\.selectionStyle === 'stable' \|\| p\.selectionStyle === 'lazer' \? p\.selectionStyle : def\.selectionStyle/.test(src), 'load 白名单解析, 非法值回退默认');
}

section('renderer.ts: drawSelectionDecor 按 selectionStyle 分支');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/const stableSel = displaySettings\.selectionStyle === 'stable';/.test(src), 'stable 分支判断');
  assert(/if \(!stableSel\) drawSliderBodyOutline\(g, p\.points, radius\);/.test(src), 'stable 下滑条不画身体描边高亮环 (lazer 保留)');
  assert(/const img = skin\.hitcircleselect;\s*if \(!img\) return;/.test(src), 'drawSelectionBox 读皮肤图, 无图跳过');
  // v232 尺寸修正: 选中框与 hitcircle 族同公式 (stable 同款) — 与圆圈一样大, 取代初版 r*2.2 盒子
  assert(/const s = r \* 2 \* hitcircleSpriteWidth\(img\) \/ 128;/.test(src), '边长 = 圈直径 2r × 贴图固有宽/128 (与圆圈一样大)');
  {
    const skinSrc = readSrc('src/osu/skin.ts');
    assert(/INTRINSIC_SIZE_KEYS = new Set<keyof Skin>\(\[[\s\S]*?'hitcircleselect',/.test(skinSrc), 'hitcircleselect 登记固有宽度 (@2x 折半走既有通道)');
  }
  assert(/drawSelectionBox\(g, skin, o\.x, o\.y, radius\);\s*const tail = p\.points\[p\.points\.length - 1\];\s*if \(tail\) drawSelectionBox\(g, skin, tail\.x, tail\.y, radius\);/.test(src), 'stable 滑条: 头 (x,y) 与尾 (路径终点) 各画一张');
  assert(/else if \(stableSel\) \{[\s\S]*?drawSelectionBox\(g, skin, o\.x, o\.y, radius\);[\s\S]*?\} else \{[\s\S]*?#4df3ff/.test(src), 'stable 其他物件在 (x,y) 画一张; lazer 保留青色虚线环');
  assert(/drawSliderBodyOutline/.test(src) && /setLineDash\(\[6, 4\]\)/.test(src), 'lazer 描边环/虚线环旧行为未删');
}

section('DisplayPanel.tsx: 「物件选中效果」下拉行');
{
  const src = readSrc('src/components/DisplayPanel.tsx');
  assert(/key: 'selectionStyle', name: '物件选中效果/.test(src), 'SELECT_ROWS 含物件选中效果行');
  assert(/\['stable', 'stable 选框'\], \['lazer', 'lazer 描边'\]/.test(src), '选项 stable 选框 / lazer 描边');
}

if (failures) { console.error(`V232 FAILED: ${failures}`); process.exit(1); }
console.log('V232 ALL PASSED');
