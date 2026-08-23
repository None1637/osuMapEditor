// 验证器 v71: timing 紧凑窗口内滚动条 + 切页签自动滚到生效绿线行
// 运行: cd app && node verifier/v71/check.mjs; node verifier/v71/cdp-v71.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v71/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v71/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('timingEdit.ts: scrollTargetIndex 纯函数');
{
  const src = readSrc('src/osu/timingEdit.ts');
  assert(/export function scrollTargetIndex/.test(src), '导出 scrollTargetIndex');
  assert(/activeGreenAt\(points, time\)/.test(src), '生效绿线优先');
  assert(/if \(!points\.length\) return -1/.test(src), '空表 => -1');
}

section('TimingPanel.tsx: 窗口内滚动条');
{
  const src = readSrc('src/components/TimingPanel.tsx');
  assert(/data-tp-scroll/.test(src), '滚动容器挂钩');
  assert(/max-h-\[65vh\]/.test(src) && /overflow-auto/.test(src), 'full 模式表格区限高滚动 (滚动条在窗口内)');
  assert(/ref={scrollRef}/.test(src), 'scrollRef 挂在滚动容器');
  // 控制栏 (cs/ar/od/hp + 按钮) 在滚动容器之外
  const ctrlIdx = src.indexOf("+ 红线(BPM)");
  const scrollIdx = src.indexOf('data-tp-scroll');
  assert(ctrlIdx > -1 && scrollIdx > -1 && ctrlIdx < scrollIdx, '顶部控制栏固定在滚动区外');
}

section('TimingPanel.tsx: 切页签滚动到生效绿线');
{
  const src = readSrc('src/components/TimingPanel.tsx');
  assert(/useEffect/.test(src) && /requestAnimationFrame/.test(src), '挂载后 rAF 滚动');
  assert(/scrollTargetIndex\(bm0\.timingPoints, store\.currentTime\)/.test(src), '滚动目标 = scrollTargetIndex');
  assert(/container\.scrollTop \+=/.test(src), '容器内滚动 (不滚外层页面)');
}

if (failures) { console.error(`\nVERIFIER_V71_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V71_ALL_PASSED');
