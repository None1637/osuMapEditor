// 验证器 v81: 删除无用按钮 (打开/导出) + 谱面名称加宽 + 保存反馈挪右上角标题 (绿色 [已保存] 前缀)
// 无新增纯函数 (纯 UI 调整), 本批 = 接线断言 + CDP
// 运行: cd app && node verifier/v81/check.mjs; node verifier/v81/cdp-v81.mjs (需 7100 dev server)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('App.tsx: 无用按钮删除');
{
  const src = readSrc('src/App.tsx');
  assert(!/打开 \.osu \/ \.osz \/ 音频/.test(src), '「打开 .osu / .osz / 音频」按钮已删除');
  assert(!/导出 \.osu<\/button>/.test(src), '「导出 .osu」按钮已删除');
  assert(!/exportOsu/.test(src), 'exportOsu 函数已移除');
  assert(!/type="file"/.test(src), '隐藏 file input 已移除 (拖拽导入保留)');
}

section('App.tsx: 谱面名称加宽 + 保存反馈前缀');
{
  const src = readSrc('src/App.tsx');
  assert(/max-w-\[28rem\]/.test(src), '谱面名称宽度 max-w-72 -> 28rem (v184: 页签栏内限宽截断)');
  assert(!/max-w-72/.test(src), '旧 max-w-72 已移除');
  assert(/\[\{store\.saveMessage\.split\(':'\)\[0\]\}\]/.test(src), '保存反馈 = 名称前 [已保存]/[已导出]/[保存失败] 前缀');
  assert(/text-emerald-400/.test(src) && /text-red-400/.test(src), '成功绿 / 失败红');
  assert(/'data-save-message': store\.saveMessage/.test(src), 'data-save-message 挂在标题 span 上 (v67 CDP 兼容)');
}

section('TimingPanel.tsx: 帮助文本同步');
{
  const src = readSrc('src/components/TimingPanel.tsx');
  assert(/并通过 Ctrl\+S 保存/.test(src), '帮助文本改为 Ctrl+S (导出按钮已删)');
  assert(!/「导出 \.osu」/.test(src), '旧「导出 .osu」文本已移除');
}

if (failures) { console.error(`\nVERIFIER_V81_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V81_ALL_PASSED');
