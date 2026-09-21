// 验证器 v231: 滑条控制点默认 stable 样式 (红/白实心小方格, osu!stable 编辑器同款)。
// displaySettings 新增 sliderPointStyle ('stable'|'lazer', 默认 'stable', 白名单解析);
// renderer 两处控制点手柄 (选中装饰 + 放置预览) 经 drawControlPointHandle 按开关分支: stable=fillRect/strokeRect 方格, lazer=圆点 (旧行为);
// DisplayPanel 增加「滑条控制点样式」下拉行 (stable 方格 / lazer 圆点)。
// 运行: node verifier/v231/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('displaySettings.ts: sliderPointStyle 字段 (默认 stable)');
{
  const src = readSrc('src/osu/displaySettings.ts');
  assert(/sliderPointStyle: 'stable' \| 'lazer';/.test(src), '接口含 sliderPointStyle 字符串枚举字段');
  assert(/sliderPointStyle: 'stable',/.test(src), '默认值 stable');
  assert(/p\.sliderPointStyle === 'stable' \|\| p\.sliderPointStyle === 'lazer' \? p\.sliderPointStyle : def\.sliderPointStyle/.test(src), 'load 白名单解析, 非法值回退默认');
  assert(/StrDisplayKey = \{ \[K in keyof DisplaySettings\]: DisplaySettings\[K\] extends string \? K : never \}\[keyof DisplaySettings\]/.test(src), 'StrDisplayKey 字符串枚举键类型');
  assert(/export function setDisplayString<K extends StrDisplayKey>\(k: K, v: DisplaySettings\[K\]\)/.test(src), 'setDisplayString 持久化 setter');
}

section('renderer.ts: 控制点手柄按 sliderPointStyle 分支');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/function drawControlPointHandle\(g: CanvasRenderingContext2D, x: number, y: number, isRed: boolean, isHead: boolean\)/.test(src), 'drawControlPointHandle 统一手柄入口');
  assert(/displaySettings\.sliderPointStyle === 'stable'/.test(src), 'stable 分支判断');
  assert(/g\.fillRect\(x - s \/ 2, y - s \/ 2, s, s\);/.test(src) && /g\.strokeRect\(x - s \/ 2, y - s \/ 2, s, s\);/.test(src), 'stable = fillRect/strokeRect 实心方格');
  // v231 尺寸修正: 用户对照 stable 截图确认方格约 5 屏幕像素宽, 原 头14/其余12 过大, 统一为 5px
  // v231 尺寸修正: 屏幕像素目标 — 绘制时 g 带 dpr×zoom×scale 总变换, 从 getTransform 反算 osu 单位;
  // 实测 5/k 渲染约 4px, 用户对照 stable 截图确认目标 ~8x8, 边长翻倍为 10/k
  assert(/const m = g\.getTransform\(\);/.test(src) && /const s = 7 \/ k;/.test(src) && /g\.lineWidth = 1 \/ k;/.test(src),
    '方格边长 ~8 屏幕像素 (7/k 经 getTransform 反算 + 1/k 描边 ≈ 8px 总宽)'); // v257 适配: 10/k→7/k (用户反馈仍偏肥)
  assert(/g\.beginPath\(\); g\.arc\(x, y, isHead \? 7 : 6, 0, Math\.PI \* 2\); g\.fill\(\); g\.stroke\(\);/.test(src), 'lazer = 旧圆点行为保留');
  // 连线宽度: stable 1 屏幕像素 (getTransform 反算), lazer 保持 2 osu 单位
  assert(/g\.lineWidth = 1 \/ \(Math\.hypot\(m\.a, m\.b\) \|\| 1\);/.test(src) && /\} else \{\s*g\.lineWidth = 2;/.test(src),
    '控制点连线: stable = 1 屏幕像素, lazer = 2 osu 单位');
  const n = (src.match(/drawControlPointHandle\(g, /g) ?? []).length;
  assert(n === 3, `选中装饰 1 处 + 放置预览 2 处共用 (实际 ${n})`);
}

section('DisplayPanel.tsx: 「滑条控制点样式」下拉行');
{
  const src = readSrc('src/components/DisplayPanel.tsx');
  assert(/key: 'sliderPointStyle', name: '滑条控制点样式/.test(src), 'SELECT_ROWS 含滑条控制点样式行');
  assert(/\['stable', 'stable 方格'\], \['lazer', 'lazer 圆点'\]/.test(src), '选项 stable 方格 / lazer 圆点');
  assert(/data-display-select=\{r\.key\}/.test(src), '下拉带 data-display-select (CDP 可测)');
  assert(/store\.setDisplayString\(r\.key, e\.target\.value as 'stable' \| 'lazer'\)/.test(src), '变更走 store.setDisplayString 持久化');
}

section('store.ts: setDisplayString 透传');
{
  const src = readSrc('src/osu/store.ts');
  assert(/setDisplayString as applyDisplayString/.test(src), '导入 setDisplayString');
  assert(/setDisplayString<K extends StrDisplayKey>\(k: K, v: DisplaySettings\[K\]\) \{ applyDisplayString\(k, v\); this\.emitSelection\(\); \}/.test(src), 'store.setDisplayString 透传并触发重绘');
}

if (failures) { console.error(`V231 FAILED: ${failures}`); process.exit(1); }
console.log('V231 ALL PASSED');
