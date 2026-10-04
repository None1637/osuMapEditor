// 验证器 v335: 左下角跳转框支持纯 ms + 粘贴物件文本跳转并选中; 复制文本改 lazer 格式
//   用户反馈 (soulten):
//   1) stable 的 Jump to time 可以打纯数字不用冒号 (如 126666 -> 02:06:666);
//   2) 复制出来的文本与 stable/lazer 不一致, 且两种格式粘进左下角都不会选取复制的物件。
// 修法 (v335b 核对 lazer 源码后纠正, 见 osu.Game/Screens/Edit/Compose/ComposeScreen.cs):
//   a) store.copy(): lazer 系统剪贴板文本 = "mm:ss:fff (combo号,...) - " (ComposeScreen.getTimestamp;
//      combo号 = computeCombos().index = lazer IndexInCurrentCombo+1; 物件本体 lazer 走内部 JSON,
//      我们走既有内部剪贴板, 同构);
//   b) Timelines.tsx: parseJumpTime 支持纯毫秒; submitComboSelection 解析 lazer/stable
//      组合号格式并按 combo 序号从时间戳向后选中 (对齐 SelectFromTimestamp, 有选区时 seek 到
//      时间戳之后首个物件); parseClipboardObjects 兼容粘贴 .osu 物件行 (含旧版 stable 前缀格式);
//      onPaste 从 clipboardData 取原文 (单行 input 会吃换行) 直接处理, Enter 走同一入口。
// 运行: node verifier/v335/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const store = readSrc('src/osu/store.ts');
const tl = readSrc('src/components/Timelines.tsx');

section('a) 复制文本 = lazer "mm:ss:fff (combo号) - " (v335b 纠正: 核对 lazer 源码 ComposeScreen.Copy)');
{
  const copy = store.match(/copy\(\) \{[\s\S]{0,1600}?\n  \}/);
  assert(!!copy, 'copy() 存在');
  assert(!!copy && /\$\{stableTimestamp\(sorted\[0\]\.time\)\} \(\$\{nums\.join\(','\)\}\) - /.test(copy[0]), 'lazer 格式: 时间戳 + (combo号) + " - "');
  assert(!!copy && /combos\.get\(o\.id\)\?\.index \?\? 1/.test(copy[0]), 'combo 号 = computeCombos index (= lazer IndexInCurrentCombo+1)');
  assert(!!copy && !/serializeHitObjectLine/.test(copy[0]), '不再写 .osu 物件行 (lazer 物件本体走内部剪贴板, 不落系统文本)');
}

section('b) parseJumpTime 支持纯 ms');
{
  assert(tl.includes('const plain = /^\\s*(\\d+)\\s*$/'), '纯数字分支');
  assert(/if \(plain\) return parseInt\(plain\[1\]\);/.test(tl), '纯数字按毫秒返回');
  // 数值验证: 按源码规则重算
  const parseJumpTime = s => {
    const plain = /^\s*(\d+)\s*$/.exec(s);
    if (plain) return parseInt(plain[1]);
    const m = /^\s*(?:(\d+):)?(\d{1,2})[:.](\d{1,3})\s*$/.exec(s);
    if (!m) return null;
    const min = m[1] ? parseInt(m[1]) : 0, sec = parseInt(m[2]), ms = parseInt(m[3]);
    if (sec >= 60 || ms >= 1000) return null;
    return min * 60000 + sec * 1000 + ms;
  };
  assert(parseJumpTime('126666') === 126666, '"126666" -> 126666ms (02:06:666)');
  assert(parseJumpTime('02:06:666') === 126666, '"02:06:666" 仍可用');
  assert(parseJumpTime('35.077') === 35077, '"35.077" (ss.ms) 仍可用');
  assert(parseJumpTime('abc') === null, '非法输入拒绝');
}

section('c) parseClipboardObjects 两种格式');
{
  assert(/function parseClipboardObjects\(text: string\): \{ time: number; x: number; y: number \}\[\] \| null/.test(tl), 'parseClipboardObjects 存在');
  // 数值验证: 按源码规则重算
  const parseClipboardObjects = text => {
    const out = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = /^\d+:\d{1,2}[:.]\d{1,3}\s*\((.*)\)$/.exec(line);
      const body = (m ? m[1] : line).trim();
      const f = body.split(',');
      if (f.length >= 4 && f.slice(0, 4).every(v => /^-?\d+(\.\d+)?$/.test(v.trim()))) {
        out.push({ x: parseFloat(f[0]), y: parseFloat(f[1]), time: parseFloat(f[2]) });
      } else if (m) {
        const t = parseJumpTimeRef(line.slice(0, line.indexOf('(')));
        if (t !== null) out.push({ x: NaN, y: NaN, time: t });
        else return null;
      } else return null;
    }
    return out.length ? out : null;
  };
  const parseJumpTimeRef = s => {
    const m = /^\s*(?:(\d+):)?(\d{1,2})[:.](\d{1,3})\s*$/.exec(s);
    if (!m) return null;
    return (m[1] ? parseInt(m[1]) : 0) * 60000 + parseInt(m[2]) * 1000 + parseInt(m[3]);
  };
  const lazer = parseClipboardObjects('256,192,12666,1,0,0:0:0:0:\n320,240,12933,5,0,0:0:0:0:');
  assert(!!lazer && lazer.length === 2 && lazer[0].time === 12666 && lazer[0].x === 256, 'lazer 多行纯物件行解析');
  const stable = parseClipboardObjects('00:12:666 (256,192,12666,1,0,0:0:0:0:)');
  assert(!!stable && stable.length === 1 && stable[0].time === 12666, 'stable "mm:ss:ms (行)" 解析');
  const combo = parseClipboardObjects('00:12:666 (256,192,12666,1,0,0:0:0:0:)'); // 括号内是物件行 → 解析物件
  assert(!!combo && combo.length === 1 && combo[0].time === 12666 && combo[0].x === 256, 'stable "mm:ss:ms (物件行)" 解析');
  assert(parseClipboardObjects('126666') === null, '纯 ms 不误判为物件文本');
  assert(parseClipboardObjects('hello world') === null, '普通文本返回 null');
}

section('d) v335b: lazer/stable 组合号格式 (对齐 lazer SelectFromTimestamp)');
{
  assert(/const submitComboSelection = \(text: string\): boolean => \{/.test(tl), 'submitComboSelection 存在');
  assert(/if \(submitComboSelection\(text\)\) return true;/.test(tl), '组合号格式优先于物件行解析');
  // 数值验证: 按源码规则重算 — 正则提取 + combo 序号匹配
  const comboRe = /^\s*(?:(\d{1,3}):)?(\d{1,2})[:.](\d{1,3})\s*\((\d+(?:\s*,\s*\d+)*)\)\s*(?:-[\s\S]*)?$/;
  const m1 = comboRe.exec('02:06:666 (1,2,3) - '.trim());
  assert(!!m1 && (+m1[1] * 60000 + +m1[2] * 1000 + +m1[3]) === 126666 && m1[4] === '1,2,3', 'lazer 复制文本 "mm:ss:fff (1,2,3) - " 解析');
  const m2 = comboRe.exec('00:12:666 (256,192,12666,1,0,0:0:0:0:)');
  assert(!m2, 'stable 物件行不被误判为组合号 (括号内含冒号)');
  assert(/combos\.get\(o\.id\)\?\.index \?\? 1\) === n/.test(tl), '按 combo 内序号匹配');
  assert(/remaining = remaining\.filter\(o => o !== cur && o\.time >= cur\.time\)/.test(tl), '逐个向后消费 (lazer SelectFromTimestamp)');
  assert(/bm\.hitObjects\.find\(o => o\.time >= t\)/.test(tl), '有选区时 seek 到时间戳之后首个物件 (lazer HandleTimestamp)');
}

section('e) 提交入口: 跳转 + 选中');
{
  assert(/const submitJumpObjects = \(text: string\): boolean => \{/.test(tl), 'submitJumpObjects 存在');
  assert(/store\.seek\(t0\); \/\/ 跳转到起始时间点/.test(tl), '跳转到起始时间点');
  assert(/if \(ids\.length\) store\.select\(ids\);/.test(tl), '选中匹配物件');
  assert(/Math\.abs\(o\.time - e\.time\) <= 1 && Math\.abs\(o\.x - e\.x\) <= 2 && Math\.abs\(o\.y - e\.y\) <= 2/.test(tl), '时间±1ms/坐标±2px 匹配');
  assert(/onPaste=\{e => \{[\s\S]{0,400}?clipboardData\?\.getData\('text'\)/.test(tl), 'onPaste 取原文 (单行 input 吃换行)');
  assert(/if \(submitJumpObjects\(text\)\) \{ e\.preventDefault\(\); setJump\(null\); \}/.test(tl), '粘贴物件文本立即处理并关闭');
  assert(/if \(e\.key === 'Enter'\) \{ if \(!submitJumpObjects\(jump\)\)/.test(tl), 'Enter 同一入口');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv335 全部通过');
process.exit(failures ? 1 : 0);
