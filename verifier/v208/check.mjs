// 验证器 v208: 滑条节点放置 — 双击 = 末点置红 (stable 语义), 永不结束放置
// (v206 的 justPlaced 例外被取代: 双击空白第一击刚放的点也应被第二击置红, 而不是结束)
// 运行: node verifier/v208/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('EditorCanvas.tsx: 双击置红 (stable 语义)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  // 无待点时吞掉双击第二击 (防闭环后原地新起滑条)
  assert(/if \(e\.detail >= 2 && pendPts\.length === 0\) return;/.test(src), '无待点时 detail>=2 吞掉');
  // detail>=2 且命中末点 -> 置红 + skip 标记 + return (不再有"第一击刚放"例外, 不再 finishSlider)
  const iDbl = src.indexOf('if (e.detail >= 2) {', src.indexOf("store.tool === 'slider'"));
  const blk = src.slice(iDbl, src.indexOf('第二击落在末点', iDbl));
  assert(/lastPt\.redAnchor = true;/.test(blk) && /dblRedSkipRef\.current = true;/.test(blk) && /return;/.test(blk),
    'detail>=2 命中末点 -> redAnchor=true + skip + return');
  assert(!/justPlaced/.test(src), 'justPlaced 例外已删 (v208)');
  assert(!/lastPushRef/.test(src), 'lastPushRef 已删 (v208)');
  assert(!/finishSlider\(\)/.test(blk), '双击分支内不再 finishSlider()');
  // 单击点头闭环保留 (仅 detail===1)
  assert(/if \(e\.detail === 1 && pendPts\.length >= 2 && Math\.hypot\(p\.x - pendPts\[0\]\.x/.test(src), '单击头部闭环保留 (detail===1)');
}

section('EditorCanvas.tsx: onDoubleClick 吞掉');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/if \(dblRedSkipRef\.current\) \{ dblRedSkipRef\.current = false; return; \}/.test(src),
    'React onDoubleClick 检查并清除 dblRedSkipRef');
}

section('右键结束放置仍在');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/store\.tool === 'slider' && store\.pendingSlider\.length\) \{?\s*\n?\s*finishSlider\(\)/.test(src),
    'onContextMenu 右键 finishSlider 保留 (结束放置的入口)');
}

if (failures) { console.error(`V208 FAILED: ${failures}`); process.exit(1); }
console.log('V208 ALL PASSED');
