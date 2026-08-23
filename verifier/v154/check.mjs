// 验证器 v154: 点击重叠物件优先选中离当前时间最近者
//   根因: hitTest 倒序遍历返回首个命中 = 恒选最晚上层物件; 修复 = 收集全部命中,
//   pickTimeNearestHit 挑 |time - currentTime| 最小者 (等差取数组靠后 = 上层, 兼容旧同刻堆叠行为)
// 运行: node verifier/v154/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v154/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v154/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V154_TESTS_*)
fs.unlinkSync(out);

section('hitPick.ts: pickTimeNearestHit 纯函数');
{
  const src = readSrc('src/osu/hitPick.ts');
  assert(/export function pickTimeNearestHit<T extends Pick<HitObject, 'time'>>/.test(src), '导出泛型纯函数');
  assert(/Math\.abs\(h\.time - currentTime\)/.test(src), '按 |time - currentTime| 比较');
  assert(/if \(dt <= bestDt\)/.test(src), '<= 同差值后者优先 (上层物件, 兼容旧行为)');
}

section('EditorCanvas.tsx: hitTest 收集全部命中 + 时间最近挑选');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/import \{ pickTimeNearestHit \} from '@\/osu\/hitPick';/.test(src), '导入 pickTimeNearestHit');
  const htIdx = src.indexOf('const hitTest = (px: number, py: number)');
  const blk = src.slice(htIdx, src.indexOf('};', htIdx));
  assert(/const hits: HitObject\[\] = \[\];/.test(blk), '命中收集数组');
  // v171 适配: 有已选命中时先在已选子集内挑时间最近, 无已选才走全命中时间最近
  assert(/return pickTimeNearestHit\(selHits\.length \? selHits : hits, store\.currentTime\);/.test(blk), '返回值走时间最近挑选 (v171: 已选优先)');
  assert(!blk.includes('for (let i = objs.length - 1; i >= 0; i--)'), '旧倒序首个命中已移除');
  // 命中几何不变 (滑条路径点 r / 转盘中心 170 / 单点 r*1.1)
  assert(/<= r\) \{ hits\.push\(o\); break; \}/.test(blk), '滑条命中几何不变 (r, 命中即收)');
  assert(/<= 170\) hits\.push\(o\)/.test(blk), '转盘命中几何不变 (170)');
  assert(/<= r \* 1\.1\) hits\.push\(o\)/.test(blk), '单点命中几何不变 (r*1.1)');
  assert(/isVisibleAt\(bm, o, store\.currentTime\)/.test(blk), '可见性过滤保留 (可见即可选)');
}

if (failures) { console.error(`\nV154_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV154_ALL_PASSED');
