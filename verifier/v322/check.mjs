// 验证器 v322: F27 — 左下角时间点击可输入/复制 (stable Jump to time) + Ctrl+C 系统剪贴板带时间
//   a) parser.ts: serializeHitObjectLine 单行序列化抽出 (serializeOsu 与剪贴板共用, 行为不变);
//      stableTimestamp "mm:ss:ms" (补零)
//   b) store.copy(): 内部剪贴板不变, 另向系统剪贴板写 stable 文本 "mm:ss:ms (hitobject行)" 每物件一行
//      (按时间排序; 权限拒绝/非安全上下文静默忽略)
//   c) BottomTimeline: 左下角时间点击 → 输入框 (初值 stableTimestamp 且全选可复制);
//      Enter 解析 parseJumpTime 跳转 (mm:ss:ms / ss:ms / 点分隔), Esc/失焦关闭
// 运行: node verifier/v322/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const parser = readSrc('src/osu/parser.ts');
const store = readSrc('src/osu/store.ts');
const tl = readSrc('src/components/Timelines.tsx');

section('a) parser.ts 单行序列化 + stable 时间戳');
{
  assert(/export function serializeHitObjectLine\(o: HitObject\): string/.test(parser), 'serializeHitObjectLine 导出');
  assert(/sections\['HitObjects'\] = bm\.hitObjects\.map\(o => serializeHitObjectLine\(o\)\)/.test(parser), 'serializeOsu 复用单行函数');
  assert(/export function stableTimestamp\(ms: number\): string/.test(parser), 'stableTimestamp 导出');
  assert(parser.includes("padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(r).padStart(3, '0')}"), 'mm:ss:ms 补零格式');
}

section('b) store.copy() 系统剪贴板带时间');
{
  const copy = store.match(/copy\(\) \{[\s\S]{0,1600}?\n  \}/);
  assert(!!copy, 'copy() 存在');
  assert(!!copy && /navigator\.clipboard\?\.writeText\(text\)/.test(copy[0]), '写系统剪贴板');
  assert(!!copy && /\$\{stableTimestamp\(sorted\[0\]\.time\)\} \(\$\{nums\.join\(','\)\}\) - /.test(copy[0]), 'v335b: lazer 格式 "mm:ss:fff (combo号,...) - "');
  assert(!!copy && /sort\(\(a, b\) => a\.time - b\.time\)/.test(copy[0]), '按时间排序');
  assert(!!copy && /computeCombos\(this\.beatmap\)/.test(copy[0]) && /combos\.get\(o\.id\)\?\.index/.test(copy[0]), 'combo 序号 = computeCombos index (lazer IndexInCurrentCombo+1)');
  assert(!!copy && /\.catch\(\(\) => \{/.test(copy[0]) && /try \{/.test(copy[0]), '权限拒绝/非安全上下文静默忽略');
  assert(/stableTimestamp/.test(store) && /computeCombos/.test(store), 'store 引入 stableTimestamp/computeCombos (v335b)');
}

section('c) 左下角跳转时间输入框');
{
  assert(/function parseJumpTime\(s: string\): number \| null/.test(tl), 'parseJumpTime 存在');
  assert(tl.includes("(?:(\\d+):)?(\\d{1,2})[:.](\\d{1,3})"), '解析 mm:ss:ms (分钟可省, :/. 分隔)');
  assert(/sec >= 60 \|\| ms >= 1000/.test(tl), '非法值拒绝');
  assert(/const \[jump, setJump\] = useState<string \| null>\(null\)/.test(tl), '输入框状态');
  assert(/data-jump-open/.test(tl) && /onClick=\{\(\) => setJump\(stableTimestamp\(store\.currentTime\)\)\}/.test(tl), '点击时间打开 (初值 stable 格式)');
  assert(/data-jump-input/.test(tl) && /onFocus=\{e => e\.target\.select\(\)\}/.test(tl), '打开即全选 (可复制)');
  assert(/e\.key === 'Enter'\) \{ if \(!submitJumpObjects\(jump\)\) \{ const t = parseJumpTime\(jump\); if \(t !== null\) store\.seek\(t\); \} setJump\(null\); \}/.test(tl), 'Enter 跳转 (v335: 先尝试物件文本, 再时间)');
  assert(/e\.key === 'Escape'\) setJump\(null\)/.test(tl) && /onBlur=\{\(\) => setJump\(null\)\}/.test(tl), 'Esc/失焦关闭');
  assert(/e\.stopPropagation\(\)/.test(tl), '输入框按键不触发全局快捷键');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv322 全部通过');
process.exit(failures ? 1 : 0);
