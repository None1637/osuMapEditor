// v577: 暂停滚轮短手势补步延迟 90ms → 16ms
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v577/_bundle.mjs');
const rawText = {
  name: 'raw-text',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'raw-text' }));
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, args => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
  },
};
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 短滚轮真实计时');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v577/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [rawText] });
  console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(out)) fs.unlinkSync(out); }

console.log('== B: 源码契约');
{
  const st = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
  assert(/WHEEL_GESTURE_END_MS = 16/.test(st), '短手势结束等待为一帧 16ms');
  assert(!/WHEEL_GESTURE_END_MS = 90/.test(st), '旧 90ms 固定延迟已移除');
  assert(st.includes('!this.wheelGestureHadSteps && this.wheelAccum.acc !== 0'), '仅未出刻度的手势补步, 防重复逻辑保留');
  assert(st.includes('this.wheelFlushTimer = setTimeout(() => this.finishWheelGesture(), WHEEL_GESTURE_END_MS)'), '仍经统一结束定时器补步');
}

console.log(failures ? `\nVERIFIER_V577_FAILED: ${failures} 处失败` : '\nVERIFIER_V577_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
