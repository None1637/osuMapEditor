// 验证器 v427: Inspector 英文长文案缩短
//  - 旋转按钮: 文本只留 Rotate (方向靠 RotateCcw/RotateCw 图标), 完整文案进 title tooltip;
//  - 镜像按钮: 砍 ({key}) 修饰 (hotkey 挪进 tooltip, 仍随 v321 改键同步);
//  - 'Split at Selected Anchors' → 'Split at Anchors'; zh 词典同步。
// 词典断言为主 + en 长度巡检 (>25 字符只允许 tooltip/hint/整行按钮类)。
// 运行: cd app && node verifier/v427/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('Inspector.tsx: en 文案缩短');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert(/v427: 旋转按钮文本只留 Rotate/.test(src), 'v427 版本注释');
  assert(/t\('inspector\.rotate_ccw', 'Rotate'\)/.test(src), "rotate_ccw 按钮文本 'Rotate'");
  assert(/t\('inspector\.rotate_cw', 'Rotate'\)/.test(src), "rotate_cw 按钮文本 'Rotate'");
  assert(!/t\('inspector\.rotate_ccw', 'Counterclockwise'\)/.test(src) && !/t\('inspector\.rotate_cw', 'Clockwise'\)/.test(src), 'Counterclockwise/Clockwise 按钮文案清除');
  assert(/t\('inspector\.rotate_ccw_tip', 'Rotate 90° counterclockwise'\)/.test(src), 'ccw tooltip 完整文案');
  assert(/t\('inspector\.rotate_cw_tip', 'Rotate 90° clockwise'\)/.test(src), 'cw tooltip 完整文案');
  assert(/t\('inspector\.flip_h', 'Horizontal'\)/.test(src) && /t\('inspector\.flip_v', 'Vertical'\)/.test(src), '镜像按钮砍 ({key}) 修饰');
  assert(/t\('inspector\.flip_h_tip', 'Flip horizontally \(\{key\}\)', \{ key: hotkeyLabel\('flip-h'\) \}\)/.test(src), 'flip_h hotkey 挪进 tooltip (仍随改键同步)');
  assert(/t\('inspector\.flip_v_tip', 'Flip vertically \(\{key\}\)', \{ key: hotkeyLabel\('flip-v'\) \}\)/.test(src), 'flip_v hotkey 挪进 tooltip');
  assert((src.match(/t\('inspector\.split_at_anchors', 'Split at Anchors'\)/g) ?? []).length === 2, "'Split at Anchors' ×2 (单选/多选)");
  assert(!src.includes('Split at Selected Anchors'), "'Split at Selected Anchors' 清除");
  assert(src.includes('<RotateCcw className="w-3.5 h-3.5" />') && src.includes('<RotateCw className="w-3.5 h-3.5" />'), '方向图标保留');
}

section('zh-CN 词典同步');
{
  const zh = readSrc('src/i18n/dicts/zh-CN/inspector.ts');
  assert(/v427:/.test(zh), 'v427 版本注释');
  assert((zh.match(/'inspector\.rotate_ccw': '旋转'/g) ?? []).length === 1, "rotate_ccw zh '旋转'");
  assert(/'inspector\.rotate_cw': '旋转'/.test(zh), "rotate_cw zh '旋转'");
  assert(/'inspector\.rotate_ccw_tip': '逆时针旋转一次'/.test(zh), 'ccw tip zh');
  assert(/'inspector\.rotate_cw_tip': '顺时针旋转一次'/.test(zh), 'cw tip zh');
  assert(/'inspector\.flip_h': '水平'/.test(zh) && /'inspector\.flip_v': '垂直'/.test(zh), 'flip zh 砍 ({key})');
  assert(/'inspector\.flip_h_tip': '水平镜像 \(\{key\}\)'/.test(zh) && /'inspector\.flip_v_tip': '垂直镜像 \(\{key\}\)'/.test(zh), 'flip tip zh 带 hotkey');
  assert(/'inspector\.split_at_anchors': '在锚点处分割'/.test(zh), "split_at_anchors zh 不变 '在锚点处分割'");
}

section('en 长度巡检: >25 字符仅限 tooltip/hint/整行按钮类');
{
  const src = readSrc('src/components/Inspector.tsx');
  const RE = /t\('(inspector\.[\w]+)', '((?:[^'\\]|\\.)*)'/g;
  const long = [];
  for (const m of src.matchAll(RE)) {
    if (m[2].length > 25 && !/(_tip|hint|sample_file|sliders_to_stream|polygon_generate|split_slider|bspline)/.test(m[1]))
      long.push(`${m[1]} (${m[2].length})`);
  }
  assert(long.length === 0, `无遗漏长文案 (超 25 且非豁免: ${long.length}${long.length ? ': ' + long.join(', ') : ''})`);
}

if (failures) { console.error(`\nV427 FAILED (${failures})`); process.exit(1); }
console.log('\nV427 ALL PASSED');
