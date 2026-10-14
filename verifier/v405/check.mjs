// 验证器 v405: 旋转/缩放窗口布局对齐 stable (Rotate by / Scale by)
// 运行: cd app && node verifier/v405/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v405/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v405/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('transform.ts: v405 纯函数');
{
  const src = readSrc('src/osu/transform.ts');
  assert(/v405/.test(src), 'v405 版本注释');
  assert(/export function axisScaleFactors\(fx: number, fy: number, axisX: boolean, axisY: boolean\)/.test(src)
    && /sx: axisX \? fx : 1, sy: axisY \? fy : 1/.test(src), 'axisScaleFactors: 未勾选轴按 1');
  assert(/export function angleForDirection\(angle: number, dir: RotateDir\)/.test(src)
    && /dir === 'cw' \? Math\.abs\(angle\) : -Math\.abs\(angle\)/.test(src), 'angleForDirection: 方向取符号绝对值');
  assert(/export function directionForAngle\(angle: number, prev: RotateDir\)/.test(src)
    && /angle > 0 \? 'cw' : angle < 0 \? 'ccw' : prev/.test(src), 'directionForAngle: 角度反推方向 (0 保持)');
}

section('TransformDialog.tsx: stable 式布局');
{
  const src = readSrc('src/components/TransformDialog.tsx');
  assert(/v405/.test(src), 'v405 版本注释');
  // 滑条联动
  assert(/type="range" min=\{-180\} max=\{180\} step=\{1\}[\s\S]*?data-tf="angle-slider"[\s\S]*?changeAngle\(parseFloat/.test(src),
    '旋转: 角度滑条 (±180°) 联动 changeAngle');
  assert(/type="range" min=\{0\.1\} max=\{2\} step=\{0\.005\}[\s\S]*?data-tf="factor-slider"[\s\S]*?changeFactor\(parseFloat/.test(src),
    '缩放: 倍率滑条 (0.1..2) 联动 changeFactor');
  // 提示语
  assert(/t\('transform\.angle_prompt', 'Enter an angle to rotate by:'\)/.test(src), '旋转提示语');
  assert(/t\('transform\.scale_prompt', "Scale the selected objects' spacing by:"\)/.test(src), '缩放提示语');
  // 分组框
  assert(/function Group\(\{ label, children \}/.test(src) && /<fieldset className="border border-white\/15 rounded/.test(src)
    && /<legend/.test(src), 'stable 式分组框 (fieldset+legend)');
  assert(/t\('transform\.direction', 'Direction'\)/.test(src) && /data-tf=\{`dir-\$\{d\}`\}/.test(src), '方向分组 (dir-cw/dir-ccw 单选)');
  assert(/t\('transform\.apply_to', 'Apply to'\)/.test(src) && /data-tf="axis-x"/.test(src) && /data-tf="axis-y"/.test(src),
    '应用于分组 (X/Y 轴勾选)');
  // 原点分组 (游玩区中心/选区中心/自定义, 节点模式隐藏)
  assert(/\[\['playfield', t\('transform\.center'/.test(src) && /'selection', t\('transform\.selection'/.test(src),
    '原点分组: 游玩区中心/选区中心 顺序对齐 stable');
  // 实际倍率走 axisScaleFactors (预览 + 提交)
  assert(/const \{ sx, sy \} = axisScaleFactors\(factor, factorY, axisX, axisY\);/.test(src), 'sx/sy 来自 axisScaleFactors');
  assert(/scaleObjects\(objs, c, sx, sy\)/.test(src) && /scalePt\(p, c, sx, sy\)/.test(src), '预览/提交用 sx/sy');
  // 按钮改名
  assert(/t\('transform\.ccw_once', 'Rotate once counter-clockwise'\)/.test(src)
    && /t\('transform\.cw_once', 'Rotate once clockwise'\)/.test(src), '按钮改「逆/顺时针旋转一次」');
  assert(!/t\('transform\.ccw', 'Counter-clockwise'\)\}<\/button>/.test(src), '旧按钮文案已移除');
  // 方向与角度双向同步
  assert(/directionForAngle\(v, d\)/.test(src) && /angleForDirection\(angle, d\)/.test(src), 'changeAngle/changeDir 双向同步');
  // 持久化 (关窗落盘)
  assert(/loadParams\('tf-rotate', \{ dir: 'cw'/.test(src) && /useSaveParamsOnClose\('tf-rotate', \{ dir \}\)/.test(src),
    '方向关窗记忆 (tf-rotate)');
  assert(/loadParams\('tf-scale', \{ lockRatio: false, axisX: true, axisY: true \}\)/.test(src), '轴向勾选并入 tf-scale 持久化');
  // 保留旧功能锚点 (旧验证器兼容)
  assert(/data-tf="apply-rotate"/.test(src) && /data-tf="lock-ratio"/.test(src), 'apply-rotate/lock-ratio 保留');
  assert(/testid="factor" min=\{0\.01\} step=\{0\.005\} digits=\{3\}/.test(src)
    && /testid="factor-y" min=\{0\.01\} step=\{0\.005\} digits=\{3\}/.test(src), '倍率 x/y 框属性保留 (v367)');
}

section('zh-CN 词典');
{
  const zh = readSrc('src/i18n/dicts/zh-CN/transform.ts');
  assert(/'transform\.ccw_once': '逆时针旋转一次'/.test(zh) && /'transform\.cw_once': '顺时针旋转一次'/.test(zh),
    '逆/顺时针旋转一次');
  assert(/'transform\.direction': '方向'/.test(zh) && /'transform\.apply_to': '应用于'/.test(zh), '方向/应用于');
  assert(/'transform\.axis_x': 'X 轴'/.test(zh) && /'transform\.axis_y': 'Y 轴'/.test(zh), 'X/Y 轴');
  assert(/'transform\.angle_prompt': '输入旋转角度:'/.test(zh) && /'transform\.scale_prompt': '按倍率缩放选中物件的间距:'/.test(zh),
    '提示语');
  assert(/'transform\.selection': '选区中心'/.test(zh) && /'transform\.center': '游玩区中心'/.test(zh), '原点选项改「选区中心/游玩区中心」');
  assert(!/'transform\.angle':/.test(zh) && !/'transform\.factor':/.test(zh), '闲置 key angle/factor 已移除 (v346)');
}

if (failures) { console.error(`V405 FAILED (${failures})`); process.exit(1); }
console.log('V405 ALL PASSED');
