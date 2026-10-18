// 验证器 v455: 设置「Alt拖尾 SV 超界插红线扩程」(editorPrefs.svRedlineBoost, 设置菜单 checkbox, 默认关) —
//   开: Alt+拖时间轴滑条尾反解 svReq 超界 (>10/<0.1) 时插 BPM×2^n 红线 + 绿线 sv/2^n 等效变速;
//   关: 钳制 [0.1,10] (v407 行为)。
// v466 适配: 红线落点改 MT 同款 1ms 窗口 (变速 T0-1 + 还原 T0 + 滑条前移 1ms, 由 verifier/v466 覆盖);
//   bpmRestoreTargetAt 已删 (BPM 在 T0 即还原, 不再泄漏到后续滑条头)。
// 运行: cd app && node verifier/v455/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v455/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v455/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('timingSv.ts: 扩程三件套');
{
  const src = readSrc('src/osu/timingSv.ts');
  assert(/export function svForDurationRaw\(/.test(src), 'svForDurationRaw (不钳制反解)');
  assert(/svForDuration[\s\S]{0,400}?svForDurationRaw\(lengthPx, slides, redBeatLength, sliderMultiplier, targetDurMs\)/.test(src), 'svForDuration = clamp(raw) 复用');
  assert(/export function svRedlineBoost\(svReq: number\)/.test(src)
    && /Math\.ceil\(Math\.log2\(svReq > SV_MAX \? svReq \/ SV_MAX : SV_MIN \/ svReq\)\)/.test(src), 'svRedlineBoost: n=ceil(log2(超界倍数))');
  assert(/svReq > SV_MAX \? 2 \*\* n : 2 \*\* -n/.test(src), 'sv>10 → BPM×2^n; sv<0.1 → BPM÷2^n');
  assert(!/export function bpmRestoreTargetAt/.test(src), 'v466: bpmRestoreTargetAt 已删 (1ms 窗口 T0 即还原 BPM, 无泄漏)');
}

section('editorPrefs: svRedlineBoost 开关 (默认关)');
{
  const ep = readSrc('src/osu/editorPrefs.ts');
  assert(/svRedlineBoost: boolean;/.test(ep), 'EditorPrefs 接口含 svRedlineBoost');
  assert(/svRedlineBoost: false,\s*\/\/ v455/.test(ep), '默认值 false');
  assert(/svRedlineBoost: p\.svRedlineBoost === true/.test(ep), '持久化读取默认 false (遗留数据无此键取关)');
}

section('设置菜单接线 (v386 通道, 仿 v443)');
{
  const br = readSrc('src/osu/electronBridge.ts');
  assert(/svRedlineBoost: boolean; \/\/ v455/.test(br), 'ElectronEditorPrefsState 含 svRedlineBoost');
  assert(/'sliderHalfSnap' \| 'svRedlineBoost'/.test(br), 'menu-cmd key 联合类型含 svRedlineBoost');
  const mc = readSrc('electron/main.cjs');
  assert(/svRedlineBoost: false, svTailRestore: true \}/.test(mc), '主进程勾选状态默认 false (v457: +svTailRestore 默认开)');
  assert(/svRedlineBoost: s\?\.svRedlineBoost === true/.test(mc), 'editor-prefs-state 上报解析默认 false');
  assert(/mT\("menu\.sv_redline_boost"\), type: "checkbox", checked: editorPrefsState\.svRedlineBoost, click: \(\) => send\(\{ type: "settings-toggle-editor-pref", key: "svRedlineBoost" \}\)/.test(mc), '设置菜单 checkbox 项');
  assert(/"menu\.sv_redline_boost": \{ en:/.test(mc) && /"zh-CN": "Alt拖滑条尾变速通过变BPM突破sv上限"/.test(mc) && /"zh-TW": "Alt拖滑條尾變速通過變BPM突破sv上限"/.test(mc), '菜单三语标签 (v456: 文案简化)');
  const app = readSrc('src/App.tsx');
  assert(/menuEditorPrefsState\(\{[^}]*svRedlineBoost: editorPrefs\.svRedlineBoost[^}]*\}\)/.test(app), 'App.tsx 勾选状态上报含 svRedlineBoost');
}

section('Timelines.tsx: applySvTailDrag 红线扩程 (v466 落点由 verifier/v466 覆盖)');
{
  const src = readSrc('src/components/Timelines.tsx');
  const fn = src.match(/function applySvTailDrag[\s\S]*?\n\}\n/)?.[0] ?? '';
  assert(fn.length > 0, 'applySvTailDrag 存在');
  assert(/svForDurationRaw\(o\.length \?\? 0, o\.slides \?\? 1, tr\.redOld/.test(fn), 'svReq 不钳制反解, 基准 = 拖拽前 redOld');
  assert(/const boost = \(!restored && editorPrefs\.svRedlineBoost\) \? svRedlineBoost\(svReq\) : null;/.test(fn), '扩程由设置开关门控 (拖回原时长不扩程)');
  assert(/const svNew = Math\.min\(SV_MAX, Math\.max\(SV_MIN, boost \? svReqA \/ boost\.redScale : svReqA\)\);/.test(fn), '绿线 sv = svReq/2^n 钳回边界; 关 = 钳制 [0.1,10] (v407 行为保留)');
  assert(/tr\.boostRedOn\.beatLength = tr\.redOld \/ boost\.redScale;/.test(fn), '变速红线 beatLength = redOld/2^n (BPM×2^n)');
  assert(/const sortTps = \(tps: TimingPoint\[\]\) =>\s*\n?\s*tps\.sort\(\(a, b\) => a\.time - b\.time \|\| Number\(b\.uninherited\) - Number\(a\.uninherited\)\);/.test(src),
    'sortTps 同刻红线排绿线前 (svPointAt 红重置→绿生效)');
  // 拖拽状态/init
  assert(/svOld: svAt\(bm\.timingPoints, o\.time\),\s*\n\s*redOld: redAt\.beatLength, redOldTp: \{ \.\.\.redAt \},/.test(src), '按下时记录 svOld + redOld + redOldTp (v466)');
  assert(/boostShifted: false, boostGreen: null, boostGreenCreated: false, boostGreenOrig: -100,\s*\n\s*boostRedOn: null, boostRedOnCreated: false, redOnOrig: 0, boostRedRestore: null,/.test(src), '拖拽状态含 v466 扩程字段');
}

if (failures) { console.error(`V455 FAILED (${failures})`); process.exit(1); }
console.log('V455 ALL PASSED');
