// 验证器 v209: Electron 原生「编辑」菜单 (stable 同款) + 旋转/缩放独立窗口 + 配套 store 方法
// 运行: node verifier/v209/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store 纯函数单测 (tests.ts)');
{
  const out = path.join(root, 'verifier/v209/_bundle.mjs');
  execSync(`npx esbuild "${path.join(root, 'verifier/v209/tests.ts')}" --bundle --platform=node --outfile="${out}"`, { cwd: root, stdio: 'pipe' });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '    ' + l).join('\n'));
}

section('store.ts: 编辑菜单配套方法');
{
  const src = readSrc('src/osu/store.ts');
  assert(/selectAllObjects\(\)/.test(src), 'selectAllObjects 存在');
  assert(/cut\(\) \{[\s\S]*?this\.copy\(\);[\s\S]*?this\.deleteSelected\(\);/.test(src), 'cut = copy + deleteSelected');
  assert(/hasClipboard\(\): boolean/.test(src), 'hasClipboard 存在');
  assert(/nudgeSelectedBySnap\(dir: -1 \| 1\)/.test(src), 'nudgeSelectedBySnap 存在');
  assert(/clearHitSounds\(scope: 'selected' \| 'all'\)/.test(src), 'clearHitSounds 存在');
  assert(/o\.hitSound = 0; o\.hitSampleRaw = undefined; o\.edgeSoundsRaw = undefined; o\.edgeSetsRaw = undefined;/.test(src),
    'clearHitSounds 清零 hitSound + hitSample + 边缘音效');
  assert(/resetComboFlags\(\)/.test(src) && /o\.newCombo = false; o\.comboSkip = 0;/.test(src), 'resetComboFlags 存在');
  assert(/resetBreaks\(\)/.test(src) && /!\/\^\\s\*\(2\|Break\)\\s\*,\/\.test\(l\)/.test(src), 'resetBreaks 过滤 break 行');
  assert(/transformDialog: 'rotate' \| 'scale' \| 'symmetry' \| null/.test(src), 'transformDialog 字段存在 (v210 扩 symmetry)');
  assert(/openTransformDialog\(m: 'rotate' \| 'scale' \| 'symmetry'\) \{ if \(!this\.selected\.size\) return;/.test(src), '无选区不开窗');
  // 撤销支持: rawSections 入快照
  assert(/rawSections\?: Record<string, string\[\]>/.test(src), 'Snapshot 含 rawSections');
  assert(/bm\.rawSections = deepCopy\(s\.rawSections \?\? \{\}\)/.test(src), 'restore 恢复 rawSections');
  // copy 后 emitSelection (编辑菜单「粘贴」置灰刷新)
  assert(/this\.clipboardGreens = deepCopy\(greens\)[\s\S]*?\n\s*this\.emitSelection\(\);/.test(src), 'copy 后 emitSelection');
}

section('electronBridge.ts / preload.cjs: 命令与状态通道');
{
  const bridge = readSrc('src/osu/electronBridge.ts');
  for (const t of ['edit-undo', 'edit-redo', 'edit-cut', 'edit-copy', 'edit-paste', 'edit-delete', 'edit-select-all',
    'edit-duplicate', 'edit-reverse', 'edit-flip-h', 'edit-flip-v', 'edit-rot-cw', 'edit-rot-ccw',
    'edit-open-rotate', 'edit-open-scale', 'edit-clear-hs-selected', 'edit-clear-hs-all',
    'edit-reset-combo', 'edit-reset-breaks', 'edit-nudge-prev', 'edit-nudge-next'])
    assert(bridge.includes(`'${t}'`), `ElectronMenuCommand 含 ${t}`);
  assert(/menuEditState\(state: ElectronEditMenuState\): void/.test(bridge), 'ElectronAPI.menuEditState 存在');
  assert(/interface ElectronEditMenuState/.test(bridge), 'ElectronEditMenuState 类型存在');
  const preload = readSrc('electron/preload.cjs');
  assert(/menuEditState: \(s\) => ipcRenderer\.send\("edit-menu-state", s\)/.test(preload), 'preload 转发 edit-menu-state');
}

section('main.cjs: 编辑菜单 (快捷键仅显示不注册; 选中态置灰)');
{
  const src = readSrc('electron/main.cjs');
  assert(/ipcMain\.on\("edit-menu-state"/.test(src), 'edit-menu-state IPC 监听');
  assert(/label: "编辑",/.test(src), '编辑菜单存在');
  for (const l of ['撤消', '重做', '剪切', '复制', '粘贴', '删除', '全选', '批量复制...', '反选', // v210: 「仿制 (批量复制)...」改名「批量复制...」
    '左右翻转', '上下翻转', '顺时针旋转90°', '逆时针旋转90°', '旋转...', '缩放...',
    '清除所选物件的音效', '清除所有音效', '重置combo组的颜色', '重置休息时段', '前移', '后移'])
    assert(src.includes(`"${l}"`), `菜单项「${l}」存在`);
  assert(/registerAccelerator: false/.test(src), '快捷键 registerAccelerator: false (不全局截获, 输入框不受影响)');
  assert(/e\("edit-paste", "粘贴", "CmdOrCtrl\+V", clip\)/.test(src), '粘贴按剪贴板置灰');
  assert(/e\("edit-cut", "剪切", "CmdOrCtrl\+X", sel\)/.test(src), '剪切按选中置灰');
  assert(/e\("edit-select-all", "全选", "CmdOrCtrl\+A", map\)/.test(src), '全选按谱面加载置灰');
}

section('electronMenu.ts: 编辑命令分发');
{
  const src = readSrc('src/osu/electronMenu.ts');
  assert(/case 'edit-duplicate': if \(store\.selected\.size\) store\.openConversion\('duplicate'\)/.test(src), '仿制 → 批量复制窗口');
  assert(/case 'edit-open-rotate': store\.openTransformDialog\('rotate'\)/.test(src), '旋转... → 旋转窗口');
  assert(/case 'edit-open-scale': store\.openTransformDialog\('scale'\)/.test(src), '缩放... → 缩放窗口');
  assert(/case 'edit-paste': store\.paste\(store\.currentTime\)/.test(src), '粘贴到当前时间');
  assert(/case 'edit-rot-cw': store\.rotateSelected\(90, 'playfield'\)/.test(src), '旋转90° 围绕游玩区中心 (与快捷键一致)');
}

section('App.tsx: 快捷键 + 状态上报 + 窗口挂载');
{
  const src = readSrc('src/App.tsx');
  assert(/e\.shiftKey && e\.key\.toLowerCase\(\) === 'r'\) \{ e\.preventDefault\(\); store\.openTransformDialog\('rotate'\)/.test(src), 'Ctrl+Shift+R 旋转窗口');
  assert(/e\.shiftKey && e\.key\.toLowerCase\(\) === 's'\) \{ e\.preventDefault\(\); store\.openTransformDialog\('scale'\)/.test(src), 'Ctrl+Shift+S 缩放窗口');
  assert(/!e\.shiftKey && e\.key\.toLowerCase\(\) === 'd'\) \{ e\.preventDefault\(\); if \(store\.selected\.size\) store\.openConversion\('duplicate'\)/.test(src), 'Ctrl+D 仿制 → 批量复制');
  assert(/e\.key\.toLowerCase\(\) === 'x'\) \{ e\.preventDefault\(\); store\.cut\(\)/.test(src), 'Ctrl+X 剪切');
  assert(/e\.key\.toLowerCase\(\) === 'a'\) \{ e\.preventDefault\(\); store\.selectAllObjects\(\)/.test(src), 'Ctrl+A 全选');
  assert(/store\.nudgeSelectedBySnap\(k === 'j' \? -1 : 1\)/.test(src), 'J/K 走 store.nudgeSelectedBySnap');
  assert(/api\.menuEditState\(s\)/.test(src), 'edit-menu-state 上报');
  assert(/store\.transformDialog && <TransformDialog mode=\{store\.transformDialog\} \/>/.test(src), 'TransformDialog 挂载');
  // Ctrl+Shift+S 必须在 Ctrl+S 之前判定
  const iShiftS = src.indexOf("openTransformDialog('scale')");
  const iSave = src.indexOf("e.key.toLowerCase() === 's') { e.preventDefault(); store.save()");
  assert(iShiftS > 0 && iSave > 0 && iShiftS < iSave, 'Ctrl+Shift+S 判定在 Ctrl+S 之前');
}

section('TransformDialog.tsx: 旋转/缩放窗口 (复制左侧栏变换功能)');
{
  const src = readSrc('src/components/TransformDialog.tsx');
  assert(/DraggableDialog/.test(src), '可拖动窗口');
  assert(/store\.setOriginMode\(m\)/.test(src) && /originMode === 'custom'/.test(src), '原点选择 (选区/中心/自定义) 复制');
  assert(/store\.rotateSelected\(-Math\.abs\(angle\), origin\)/.test(src) && /store\.rotateSelected\(Math\.abs\(angle\), origin\)/.test(src), '逆/顺时针旋转按钮');
  assert(/store\.scaleSelected\(factor, origin\)/.test(src), '缩放应用按钮');
}

if (failures) { console.error(`V209 FAILED: ${failures}`); process.exit(1); }
console.log('V209 ALL PASSED');
