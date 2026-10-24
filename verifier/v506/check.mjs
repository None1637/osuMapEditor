// 验证器 v506: 拍数占比 <3% 的短段不报疑似变速 (开头误报红线修复)
//   A: 纯函数 (<3% 短段不报 / 真变速段仍报)
//   B: 真实谱面 (Carnival 开头 30s 内无误报线)
//   C: 源码契约 (拍数占比过滤)
// 运行: npm run build 后 node verifier/v506/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('A: 纯函数 + B: 真实谱面 (本地 fixture)');
for (const [name, src, marker] of [['A 纯函数', 'tests', 'V506_PURE_PASSED'], ['B 真实谱面', 'real', 'V506_REAL_PASSED']]) {
  try {
    execSync(`npx esbuild verifier/v506/${src}.ts --bundle --format=esm --platform=node --outfile=verifier/v506/.${src}.mjs --log-level=error --alias:@=./src`, { cwd: root, stdio: 'pipe' });
    const out = execSync(`node verifier/v506/.${src}.mjs`, { cwd: root, encoding: 'utf8' });
    console.log(out.trim());
    assert(out.includes(marker), `${name}: ${marker}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL: ${name} 执行失败\n${e.stdout ?? ''}${e.message}`);
  }
}

section('C: 源码契约');
{
  const bp = read('src/osu/bpmDetect.ts');
  assert(/s\.beats < Math\.max\(8, result\.beats\.length \* 0\.03\)/.test(bp), '拍数占比 <3% 短段过滤');
  assert(/if \(bestFitRatio\(bs\) >= 0\.9\) continue;/.test(bp), 'bestFitRatio 阈值 0.9');
  assert(/if \(sVar < 0\.06\) continue;/.test(bp), 'sVar 绝对支撑阈值 0.06');
}

console.log(failures ? `\nVERIFIER_V506_FAILED: ${failures} 处失败` : '\nVERIFIER_V506_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
