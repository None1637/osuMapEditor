// 验证器 v33: 选区变换 — 任意角度旋转/任意倍率缩放 + 三种原点 (选区/游玩区中心/自定义)
// 依据: lazer SelectionRotationHandler.Rotate(rotation, origin) / SelectionScaleHandler 的 origin 参数语义
// 运行: cd app && node verifier/v33/check.mjs; node verifier/v33/cdp-transform-origin.mjs (需 7100 dev server)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store.ts: 原点三模式');
{
  const src = readSrc('src/osu/store.ts');
  assert(/export type TransformOrigin = 'selection' \| 'playfield' \| Pt/.test(src), 'TransformOrigin 类型导出');
  assert(/resolveOrigin[\s\S]*?'playfield'\) return \{ x: 256, y: 192 \}/.test(src), 'playfield 原点 = (256,192)');
  assert(/rotateSelected\(deg: number, origin: TransformOrigin = 'selection'\)/.test(src), 'rotateSelected 任意角度 + origin');
  assert(/scaleSelected\(sx: number, sy: number \| TransformOrigin = sx, origin: TransformOrigin = 'selection'\)/.test(src), 'scaleSelected 任意倍率 + origin (v282 起双轴, 兼容旧调用)');
  assert(/flipSelected\(axis: 'h' \| 'v', origin: TransformOrigin = 'selection'\)/.test(src), 'flipSelected + origin');
}

section('Inspector.tsx: 变换面板 UI');
{
  const src = readSrc('src/components/Inspector.tsx');
  for (const t of ['origin-${m}', 'testid="custom-x"', 'testid="custom-y"', 'testid="angle"', 'testid="factor"', 'data-tf={testid}'])
    assert(src.includes(t), `面板控件 ${t}`);
  assert(/store\.rotateSelected\(Math\.abs\(angle\), origin\)/.test(src), '旋转按钮使用输入角度 + 原点');
  assert(/store\.scaleSelected\(factor, factorY, origin\)/.test(src), '缩放按钮使用输入倍率 + 原点 (v282 起双轴)');
  assert(/store\.flipSelected\('h', origin\)/.test(src), '镜像按钮使用原点');
}

if (failures) { console.error(`\nVERIFIER_V33_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V33_ALL_TESTS_PASSED');
