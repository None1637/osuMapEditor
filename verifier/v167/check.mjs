// 验证器 v167: lazer osu!standard 星数 (Star Rating) 移植 + 游玩区左下角 ★ 显示
// 运行: node verifier/v167/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v167/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v167/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V167_TESTS_*)
fs.unlinkSync(out);

section('starRating.ts: 导出与结构');
{
  const src = readSrc('src/osu/starRating.ts');
  assert(/export function computeStarRating\(bm: Beatmap\): number/.test(src), '导出 computeStarRating(bm): number');
  assert(/export function computeStarRatingAttributes/.test(src), '导出 computeStarRatingAttributes (中间量对账)');
  assert(/computeStackOffsets\(bm\)/.test(src), '复用 stacking.ts 堆叠偏移 (lazer StackedPosition)');
  assert(/new Aim\(true\)[\s\S]*new Aim\(false\)[\s\S]*new Speed\(\)[\s\S]*new Reading\(\)/.test(src), 'CreateSkills = Aim(with)/Aim(without)/Speed/Reading (无 Flashlight)');
  assert(/PERFORMANCE_BASE_MULTIPLIER = 1\.12/.test(src) && /PERFORMANCE_NORM_EXPONENT = 1\.1/.test(src), 'PERFORMANCE_* 常量 (OsuPerformanceCalculator)');
  assert(fs.existsSync(path.join(root, 'src/osu/starrating/preprocessing.ts')), 'starrating/preprocessing.ts 存在');
  assert(fs.existsSync(path.join(root, 'src/osu/starrating/evaluators.ts')), 'starrating/evaluators.ts 存在');
  assert(fs.existsSync(path.join(root, 'src/osu/starrating/skills.ts')), 'starrating/skills.ts 存在');
  assert(fs.existsSync(path.join(root, 'src/osu/starrating/diffUtils.ts')), 'starrating/diffUtils.ts 存在');
}

section('store.ts: starRating 字段 + setter');
{
  const src = readSrc('src/osu/store.ts');
  assert(/starRating: number \| null = null/.test(src), 'starRating 字段 (null 初始)');
  assert(/setStarRating\(v: number \| null\)/.test(src), 'setStarRating (走 emitSelection, UI 状态不入 undo)');
}

section('App.tsx: 左下角谱面信息追加 ★ + 防抖异步计算');
{
  const src = readSrc('src/App.tsx');
  assert(/import \{ computeStarRating \} from '@\/osu\/starRating'/.test(src), '引入 computeStarRating');
  assert(/store\.starRating !== null && <> · <Star className="inline w-3 h-3 -mt-0\.5 fill-current" \/>/.test(src) && src.includes('starRating.toFixed(2)'), '谱面信息结尾追加 ★x.xx (toFixed(2); v181: ★ → lucide Star)');
  assert(/store\.getDataVersion\(\)/.test(src), '以数据版本驱动重算');
  assert(/setTimeout\(\(\) => \{[\s\S]*?computeStarRating\(store\.beatmap[\s\S]*?\}, 200\)/.test(src), 'setTimeout 200ms 防抖异步计算');
  assert(/return \(\) => clearTimeout\(timer\)/.test(src), 'effect 清理 (clearTimeout)');
}

console.log(failures ? `\nV167 FAILED: ${failures}` : '\nV167 ALL PASSED');
process.exit(failures ? 1 : 0);
