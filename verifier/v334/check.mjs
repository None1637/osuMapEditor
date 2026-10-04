// 验证器 v334: 节拍切分吸附补齐 + Ctrl+滚轮 ×2/÷2 (soulten 反馈, 对齐 stable)
//   需求:
//   1) stable 的节拍细分全集为 1,2,3,4,5,6,7,8,9,12,16 —— BEAT_SNAP_OPTIONS 原缺 5/7/9;
//   2) Ctrl+滚轮由「循环相邻档」改为 ×2/÷2: 上滚 ×2 更密 / 下滚 ÷2 更疏;
//      结果不在配置中时, ÷2 往下(更小)取最近分割值, ×2 往上(更大)取最近分割值
//      (如 3÷2=1.5→1, 5×2=10→12; 边界钳到 1/16)。
// 修法:
//   - src/osu/sliderPath.ts: BEAT_SNAP_OPTIONS 补 5/7/9 (sliderLengthSnapDivisor 的 ×2 查找逻辑无需改);
//   - src/components/EditorCanvas.tsx: onWheel 的 Ctrl 分支换为 ×2/÷2 + find ≥ / reverse find ≤。
//   App.tsx 的 Shift+Digit1-8 位置索引映射与下拉框 BEAT_SNAP_OPTIONS.map 均自动跟随, 无需改。
// 运行: node verifier/v334/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const sp = readSrc('src/osu/sliderPath.ts');
const ec = readSrc('src/components/EditorCanvas.tsx');
const app = readSrc('src/App.tsx');

section('sliderPath.ts: 配置项对齐 stable 全集');
{
  const m = sp.match(/export const BEAT_SNAP_OPTIONS = \[([\d,\s]+)\]/);
  assert(!!m, '导出 BEAT_SNAP_OPTIONS 配置项常量');
  const opts = m ? m[1].split(',').map(s => parseInt(s.trim(), 10)) : [];
  assert(JSON.stringify(opts) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16]),
    `配置项 = [1,2,3,4,5,6,7,8,9,12,16] (实际 ${JSON.stringify(opts)})`);
  assert(opts.includes(5) && opts.includes(7) && opts.includes(9), '补齐 5/7/9');
  // 滑条长度 1/2 吸附查找逻辑不变
  assert(/BEAT_SNAP_OPTIONS\.includes\(half\) \? half : beatSnap/.test(sp), 'sliderLengthSnapDivisor ×2 查找逻辑保留');
}

section('EditorCanvas: Ctrl+滚轮 ×2/÷2');
{
  const wheel = ec.match(/onWheel=\{\(e\) => \{[\s\S]{0,2000}?\n      \}\}/);
  assert(!!wheel, 'EditorCanvas onWheel 存在');
  const ctrl = wheel && wheel[0].match(/if \(e\.ctrlKey\) \{[\s\S]{0,600}?\n        \}/);
  assert(!!ctrl, 'Ctrl 分支存在');
  assert(!!ctrl && /const cur = store\.beatSnap, up = e\.deltaY < 0, target = up \? cur \* 2 : cur \/ 2;/.test(ctrl[0]),
    '上滚 ×2 / 下滚 ÷2');
  assert(!!ctrl && /BEAT_SNAP_OPTIONS\.find\(v => v >= target\)/.test(ctrl[0]), '×2 往上(更大)取最近分割值');
  assert(!!ctrl && /\[\.\.\.BEAT_SNAP_OPTIONS\]\.reverse\(\)\.find\(v => v <= target\)/.test(ctrl[0]), '÷2 往下(更小)取最近分割值');
  assert(!!ctrl && /BEAT_SNAP_OPTIONS\[BEAT_SNAP_OPTIONS\.length - 1\]\)/.test(ctrl[0]) && /BEAT_SNAP_OPTIONS\[0\]\)/.test(ctrl[0]),
    '越界钳到最大/最小档');
  // 数值验证: 按源码规则重算映射
  const step = (cur, up) => {
    const target = up ? cur * 2 : cur / 2;
    const opts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16];
    return up ? (opts.find(v => v >= target) ?? opts[opts.length - 1])
              : ([...opts].reverse().find(v => v <= target) ?? opts[0]);
  };
  const cases = [[3, 0, 1], [5, 1, 12], [7, 0, 3], [9, 1, 16], [1, 0, 1], [16, 1, 16], [4, 0, 2], [6, 1, 12]];
  const bad = cases.filter(([c, up, want]) => step(c, !!up) !== want);
  assert(bad.length === 0, '映射正确: 3÷2→1, 5×2→12, 7÷2→3, 9×2→16, 边界钳 1/16');
}

section('App.tsx: Shift+数字与下拉框自动跟随');
{
  assert(/BEAT_SNAP_OPTIONS\[parseInt\(e\.code\.slice\(5\)\) - 1\]/.test(app), 'Shift+Digit1-8 位置索引映射保留');
  assert(/\{BEAT_SNAP_OPTIONS\.map\(n => <option/.test(app), '下拉框选项来自 BEAT_SNAP_OPTIONS');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv334 全部通过');
process.exit(failures ? 1 : 0);
