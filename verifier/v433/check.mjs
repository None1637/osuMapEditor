// 验证器 v433: 快捷键速查面板补全固定手势 (纯文档, 无功能改动)
// 需求: 「Alt+左键拖上时间轴滑条尾改 SV」(v407) 等固定交互 (不在可改键注册表 hotkeys.ts 的
//   鼠标手势/修饰组合/固定按键) 在速查面板无处可查 → 系统盘点后全部补上。
// 盘点对照表: verifier/v433/inventory.md (41 项: ✅已有 5 / 📋注册表 10 / ➕新增 12 / — 不单列 4)
// 本验证器: 每个新增/更新条目 key ⊆ zh-CN 词典 且 App.tsx 面板引用; 面板有 v433 注释;
//   未动注册表/画布 (抽查 hotkeys.ts 无 v433 痕迹 = 纯文档); tsc。
// 运行: node verifier/v433/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const NEW_KEYS = [
  'app.hk_grp_playfield', 'app.hk_rc_delete', 'app.hk_handles', 'app.hk_anchor_select',
  'app.hk_anchor_ctrl', 'app.hk_anchor_rc', 'app.hk_snap_wheel', 'app.hk_slider_place',
  'app.hk_marker_drag', 'app.hk_grp_timeline', 'app.hk_tl_drag', 'app.hk_tl_tail',
  'app.hk_tl_pill', 'app.hk_tl_seek',
];
const UPDATED_KEYS = ['app.hk_copy_paste', 'app.hk_delete'];

section('源码: 新增条目 key ⊆ zh-CN 词典 且面板引用');
{
  const app = read('src/App.tsx');
  const dict = read('src/i18n/dicts/zh-CN/app.ts');
  assert(/v433: 固定手势盘点补全/.test(app), 'v433 面板注释');
  for (const k of NEW_KEYS) {
    assert(dict.includes(`'${k}':`), `词典含 ${k}`);
    assert(app.includes(`t('${k}'`), `面板引用 ${k}`);
  }
  for (const k of UPDATED_KEYS) {
    assert(dict.includes(`'${k}':`) && dict.match(new RegExp(`'${k}': '[^']*锚点`)), `${k} 词典文案含锚点`);
    assert(app.match(new RegExp(`t\\('${k}', '[^']*anchors?`)), `${k} 面板英文文案含 anchor`);
  }
  // 用户点名项: Alt+拖滑条尾改 SV 必须在面板文案里
  assert(/hk_tl_tail', '[^']*Alt\+drag tail: SV/.test(app), 'Alt+拖滑条尾改 SV (v407) 条目在面板');
}

section('源码: 纯文档改动 (注册表/交互逻辑无 v433 痕迹)');
{
  assert(!read('src/osu/hotkeys.ts').includes('v433'), 'hotkeys.ts 未动');
  assert(!read('src/components/EditorCanvas.tsx').includes('v433'), 'EditorCanvas 未动');
  assert(!read('src/components/Timelines.tsx').includes('v433'), 'Timelines 未动');
}

section('盘点对照表存在且覆盖用户候选');
{
  const inv = read('verifier/v433/inventory.md');
  for (const kw of ['Alt+拖滑条尾', 'Ctrl+点击插锚点', '在锚点处分割', 'Q/W/E/R', '中键平移', 'Ctrl+拖拽', '双击时间轴'])
    assert(inv.includes(kw), `对照表覆盖「${kw}」`);
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V433_FAILED: ${failures} 处失败` : '\nVERIFIER_V433_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
