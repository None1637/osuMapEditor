// 验证器 v158: 下方时间轴进一步对齐 osu!stable + ↑/↓ 跳转前/后书签
//   stable 差异点修复: 每拍节拍刻度 (小节首拍更长更亮) 替代秒刻度;
//   播放头改白色竖线 (去掉粉色进度填充); 物件粉点加大加亮; ↑/↓ 跳书签
// 运行: node verifier/v158/check.mjs (纯源码断言)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('Timelines.tsx: 节拍刻度替代秒刻度');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/节拍刻度 \(v158/.test(src), 'v158 节拍刻度层存在');
  assert(/rects\[k % meter === 0 \? 1 : 0\]\.push\(t\)/.test(src), '按 meter 判定小节首拍 (v245: 两级分组合批, down 布尔改数组下标)');
  assert(/const h = lv \? 10 : 5;/.test(src), '首拍刻度更长 (10 vs 5; v245: down 改 lv 下标)');
  assert(!/s \* 5000 < len/.test(src), '原 5 秒刻度已移除');
  // 刻度画在 kiai 橙区之后、timing 线之前 (可被红/绿线压住)
  assert(src.indexOf('节拍刻度 (v158: 对齐 stable') > src.indexOf("rgba(255,150,30,0.28)"), '节拍刻度在 kiai 橙区之后绘制');
  assert(src.indexOf('节拍刻度 (v158: 对齐 stable') < src.indexOf('timing 点竖线'), '节拍刻度在 timing 线之前绘制 (v159: 注释改名)');
}

section('Timelines.tsx: 白色播放头 + 粉点加亮');
{
  const src = readSrc('src/components/Timelines.tsx');
  const bt = src.slice(src.indexOf('export function BottomTimeline'));
  assert(/g\.strokeStyle = '#ffffff'; g\.lineWidth = 2;/.test(bt), '播放头白色 2px (stable 样式)');
  assert(!/rgba\(255,77,109,0\.25\)/.test(bt), '粉色进度填充已移除');
  assert(/rgba\(255,105,180,0\.9\)/.test(bt), '物件粉点加亮至 0.9');
  assert(/lg\.rect\(x\(o\.time\) - 1, mid - 1, 2, 2\)/.test(bt), '粉点半径 (v159 改为 1 并落在中线上, 对齐 stable; v245: 静态层内合批为 2px 方块)');
}

section('App.tsx: ↑/↓ 跳前/后书签');
{
  const src = readSrc('src/App.tsx');
  assert(/e\.key === 'ArrowUp' \|\| e\.key === 'ArrowDown'/.test(src), 'ArrowUp/Down 键绑定');
  assert(/bm\.editor\.bookmarks/.test(src), '读取书签数组');
  assert(/e\.key === 'ArrowUp'\s*\?\s*\[\.\.\.marks\]\.reverse\(\)\.find\(b => b < store\.currentTime - 1\)/.test(src), '↑ 找 currentTime 之前最近书签');
  assert(/marks\.find\(b => b > store\.currentTime \+ 1\)/.test(src), '↓ 找之后最近书签');
  // 不得抢走 Ctrl+↑/↓ 的选区逐 px 移动 (v55 分支在前且带 ctrl 判断)
  assert(src.indexOf("nudgeSelectedPosition") < src.indexOf("e.key === 'ArrowUp' || e.key === 'ArrowDown'"), 'Ctrl+方向键移动选区分支在书签跳转之前');
  assert(/↑\/↓ 跳到前\/后一条书签/.test(src), '快捷键帮助已补条目');
}

console.log(failures ? `\nV158 FAILED: ${failures}` : '\nV158 ALL PASSED');
process.exit(failures ? 1 : 0);
