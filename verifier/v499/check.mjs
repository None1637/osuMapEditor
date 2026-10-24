// 验证器 v499: 变速/恒速高概率区分 (不再按碎段数误报)
//   判定: ① 每个 onset 落主网格 1/8 或 1/6 细分 (容差 min(15ms, P/24)) 即同 BPM,
//         无明确节拍段也豁免; ② 逐段复核: 最佳相位拟合 <90% 合网格 + ≥8 拍 +
//         周期差 >2% + 间隔 CV<0.1 + trackScore 证据复核 (主周期支撑 <0.7×) 才报;
//         ③ 8s 滑窗补逐拍连续变速 (ritardando 型) 判定。
//   A: 合成 (恒速/breakdown/大抖动/相位重置 不误报; 20 段变速至少报 1 段)
//   B: 真实谱面 (Yoko/Turupeta 恒速 0 误报; Carnival 信息输出)
// 运行: npm run build 后 node verifier/v499/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('A: 合成 + B: 真实谱面 (本地 fixture)');
for (const [name, src, marker] of [['A 合成', 'tests', 'V499_PURE_PASSED'], ['B 真实谱面', 'real', 'V499_REAL_PASSED']]) {
  try {
    execSync(`npx esbuild verifier/v499/${src}.ts --bundle --format=esm --platform=node --outfile=verifier/v499/.${src}.mjs --log-level=error --alias:@=./src`, { cwd: root, stdio: 'pipe' });
    const out = execSync(`node verifier/v499/.${src}.mjs`, { cwd: root, encoding: 'utf8' });
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
  assert(/variableSections: \{ time: number; bpm: number; beats: number \}\[\]/.test(bp), 'variableSections 字段');
  assert(/bestFitRatio/.test(bp) && /trackScore\(win, P \/ a0?\.hopMs\)/.test(bp), '最佳相位拟合 + 证据复核');
  assert(/winMs = 8000/.test(bp), '8s 滑窗逐拍变速判定');
  const dlg = read('src/components/BpmDetectDialog.tsx');
  assert(/constant\.variableSections\.length/.test(dlg) && !/segmentCount > 1/.test(dlg), '对话框提示改用 variableSections (不再按碎段数)');
}

console.log(failures ? `\nVERIFIER_V499_FAILED: ${failures} 处失败` : '\nVERIFIER_V499_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
