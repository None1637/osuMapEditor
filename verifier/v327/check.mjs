// 验证器 v327: 上方时间轴转盘改灰色 (spinner 不参与 combo 染色)
//   需求: 转盘本身不染色, 时间轴中不应按 combo 上色 → 固定灰。
// 修法: Timelines.tsx 物件绘制处 spinner 用 SPINNER_GRAY 常量, 其余物件 comboColor 逻辑不变。
// 运行: node verifier/v327/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const tl = readSrc('src/components/Timelines.tsx');

section('转盘固定灰');
{
  assert(/const SPINNER_GRAY = '#[0-9a-fA-F]{6}';/.test(tl), 'SPINNER_GRAY 常量定义');
  assert(/o\.type === 'spinner' \? SPINNER_GRAY/.test(tl), 'spinner 用固定灰');
  assert(/: comboColor\(bm, displaySettings\.skinColors \? ci\.combo : ci\.comboWithOffset/.test(tl), '其余物件 combo 染色逻辑保留 (v31/v132/v201)');
  // 灰常量确实接进绘制 (fill/barFill 均来自 col)
  const blk = tl.match(/SPINNER_GRAY[\s\S]{0,400}?drawTimelineObject\(g, sx, ex/);
  assert(!!blk, 'col → drawTimelineObject 链路保留');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv327 全部通过');
process.exit(failures ? 1 : 0);
