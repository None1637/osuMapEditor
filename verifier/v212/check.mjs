// 验证器 v212: Electron 原生「作图」菜单 (多边形生成 / 滑条转连打 / 合并滑条)
// 功能本体 (polygon/stream/merge) 各有历史 verifier 覆盖, 本批只验菜单接线与置灰状态
// 运行: node verifier/v212/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('electronBridge.ts: compose 命令 + 置灰状态扩展');
{
  const src = readSrc('src/osu/electronBridge.ts');
  for (const t of ['compose-polygon', 'compose-stream', 'compose-merge'])
    assert(src.includes(`'${t}'`), `ElectronMenuCommand 含 ${t}`);
  assert(/hasSlider: boolean/.test(src) && /selMulti: boolean/.test(src), 'ElectronEditMenuState 扩 hasSlider/selMulti');
}

section('electronMenu.ts: compose 命令分发');
{
  const src = readSrc('src/osu/electronMenu.ts');
  assert(/import \{ computeMerge \} from '\.\/convert\/merge'/.test(src), 'computeMerge 导入');
  assert(/case 'compose-polygon': store\.openConversion\('polygon'\)/.test(src), '多边形生成 → polygon 窗口 (无需选区)');
  assert(/case 'compose-stream':/.test(src) && /o\.type === 'slider'\)\) store\.openConversion\('stream'\)/.test(src), '转连打需选中滑条才开窗');
  assert(/if \(sel\.length < 2\) return;/.test(src), '合并需 >=2 选中');
  assert(/const slider = computeMerge\(bm, sel, store\.beatSnap\);[\s\S]*?store\.applyConversion\(sel\.map\(o => o\.id\), \[slider\]\)/.test(src), '合并 = computeMerge + applyConversion (同 Inspector onMerge)');
}

section('main.cjs: 作图菜单');
{
  const src = readSrc('electron/main.cjs');
  assert(/label: "作图",/.test(src), '作图菜单存在');
  assert(src.includes('e2("compose-polygon", "多边形生成...", "CmdOrCtrl+Shift+D", editState.hasMap)'), '多边形生成: 快捷键仅显示, 按谱面加载置灰');
  assert(src.includes('e2("compose-stream", "滑条转连打...", null, editState.hasSlider)'), '滑条转连打: 按选中含滑条置灰');
  assert(src.includes('e2("compose-merge", "合并滑条", null, editState.selMulti)'), '合并滑条: 按选中>=2 置灰');
  assert(/hasSlider: !!s\?\.hasSlider, selMulti: !!s\?\.selMulti/.test(src), 'edit-menu-state 接收新字段');
}

section('App.tsx: 置灰状态上报');
{
  const src = readSrc('src/App.tsx');
  assert(/hasSlider: !!bm && bm\.hitObjects\.some\(o => store\.selected\.has\(o\.id\) && o\.type === 'slider'\)/.test(src), 'hasSlider 计算');
  assert(/selMulti: selCount >= 2/.test(src), 'selMulti 计算');
  assert(/s\.hasSlider\}\|\$\{s\.selMulti\}/.test(src), '去重 key 含新字段');
}

if (failures) { console.error(`V212 FAILED: ${failures}`); process.exit(1); }
console.log('V212 ALL PASSED');
