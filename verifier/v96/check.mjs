// 验证器 v96: 辅助线默认关+localStorage 记忆 / 节点拖拽排除被拖滑条自身辅助
// 无新纯函数 (持久化 helper 依赖 localStorage, 由 CDP 覆盖) — 本批 = check 接线断言 + cdp 端到端
// 运行: cd app && node verifier/v96/check.mjs; node verifier/v96/cdp-v96.mjs (需 7100 dev server)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store.ts: 默认关 + 记忆');
{
  const store = readSrc('src/osu/store.ts');
  assert(/const LS_GEO_ENABLED = 'osu-editor:geo-enabled'/.test(store), 'LS key');
  assert(/function loadGeoEnabled\(\): boolean \{\s*try \{ return localStorage\.getItem\(LS_GEO_ENABLED\) === '1'; \} catch \{ return false; \}/.test(store), 'loadGeoEnabled 默认 false');
  assert(/geoEnabled = loadGeoEnabled\(\)/.test(store), 'geoEnabled 初值 = 记忆');
  assert(/localStorage\.setItem\(LS_GEO_ENABLED, b \? '1' : '0'\)/.test(store), 'setGeoEnabled 持久化');
}

section('EditorCanvas.tsx: 节点拖拽排除被拖滑条自身辅助');
{
  const ec = readSrc('src/components/EditorCanvas.tsx');
  assert(/snapWithGeo = \(bm: Beatmap, p: Pt, obj: Pt \| null, exclude\?: ReadonlySet<number>\)/.test(ec), 'snapWithGeo 加 exclude 参数');
  assert(/geoSnap\(bm, p, exclude\)/.test(ec), 'snapWithGeo 透传 exclude 到 geoSnap (v134 起为漏斗数组形式)');
  const nd = ec.slice(ec.indexOf('const nd = nodeDragRef.current'));
  assert(/snapWithGeo\(bm, p, snapToNearby[\s\S]{0,300}new Set\(\[nd\.objId\]\)\)/.test(nd), '节点拖拽传 new Set([nd.objId]) 排除自身');
}

if (failures) { console.error(`\nVERIFIER_V96_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V96_ALL_PASSED');
