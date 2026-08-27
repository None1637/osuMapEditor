// 验证器 v230: 滑条转连打指数曲线修复 — 段末采样 (取代 v222 的段中点采样)。
// 根因: 段中点采样 p=(j+0.5)/(n-1) 恒 <1, 高指数时 w=1+d*p^exp ≈1 全程平坦
//   (n=4 末段仅采到 p=5/6, (5/6)^10≈0.16 远不到 k=0.05), 指数越大越"没效果" (用户反馈截图场景)。
// 修复: expo 曲线采样点改 (j+1)/(n-1) — 末段间距恰 = endPercent% (端点语义),
//   指数越大变化越集中在尾部; linear/bell/bellInv 保持段中点采样不变。
// 运行: node verifier/v230/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v230/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v230/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 行为断言 (内部自报 V230_TESTS_*)
fs.unlinkSync(out);

section('stream.ts: 段末采样仅作用 expo');
{
  const src = readSrc('src/osu/convert/stream.ts');
  assert(/p\.curve === 'expo' \? \(j \+ 1\) \/ \(n - 1\) : \(j \+ 0\.5\) \/ \(n - 1\)/.test(src), 'expo 段末采样, 其他曲线保持段中点');
}

if (failures) { console.error(`\nV230_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV230_ALL_PASSED');
