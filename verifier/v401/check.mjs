// 验证器 v401: Alt 框选后 Alt+点选不能取消红锚点 (太密红锚点: 三连以上/多对重合)
// 根因: v309 的 Alt 点选只切换 redPairPartner 一个配对; 同坐标下标 3 个及以上时
//   (三连重复点 / 两对红锚点同坐标重合), 剩余同坐标下标仍选中 — 锚点看起来仍选中,
//   而再点又只把那一对加回, 0->满 永远循环, 取消不掉 (soulten / None1637 反馈)。
// 修复: sliderPath.ts 新增 altNodeToggleGroup — 同坐标全部下标整组切换
//   (全选→全取消; 否则先补齐); EditorCanvas nodeAltPress 改用之。
// 运行: cd app && node verifier/v401/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v401/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v401/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('sliderPath.ts: altNodeToggleGroup');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/export function altNodeToggleGroup\(pts: Vec2\[\], idx: number, isSel/.test(src), 'altNodeToggleGroup 导出');
  assert(/samePt\(pts\[j\], pts\[idx\]\)/.test(src), '同坐标下标收为一组');
  assert(/group\.every\(isSel\)/.test(src), '全选→取消 / 否则补齐 的组语义');
  assert(/v401/.test(src), 'v401 版本注释');
}

section('EditorCanvas.tsx: nodeAltPress 整组切换');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/v401: 同坐标锚点整组切换/.test(src), 'v401 注释标注根因');
  assert(/for \(const j of altNodeToggleGroup\(hctrl, hitNode\.idx, jj => !!selN\?\.has\(jj\)\)\)\s*store\.toggleSelectedNode\(hitNode\.objId, j\);/.test(src),
    '命中锚点: 整组 toggle');
  assert(!/const partner = redPairPartner\(hctrl, hitNode\.idx\);/.test(src), 'v309 单配对切换已移除');
}

section('验证器适配标注');
{
  assert(/v401/.test(readSrc('verifier/v309/check.mjs')), 'v309 check 已适配 (bug2 段)');
}

if (failures) { console.error(`V401 FAILED (${failures})`); process.exit(1); }
console.log('V401 ALL PASSED');
