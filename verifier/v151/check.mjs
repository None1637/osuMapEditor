// 验证器 v151: 左侧栏控件大小/布局调整 (源码结构断言, 纯 UI 布局无纯函数)
//   ① 曲库/皮肤各半宽并排一行  ② 选择/单点/滑条/转盘一行一个 (整行宽)
//   ③ 网格吸附按钮与网格类型下拉各半宽放一行  ④ 网格间距与旋转放一行
// 运行: node verifier/v151/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }

const src = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

section('① 曲库/皮肤: 半宽并排一行');
{
  const anchor = src.indexOf('{/* 文件 (v151');
  const blk = src.slice(anchor, src.indexOf('</div>', src.indexOf('setShowSkin(true)')) + 6);
  assert(anchor > 0 && blk.includes('setShowLibrary(true)') && blk.includes('setShowSkin(true)'), '曲库/皮肤按钮存在');
  assert(blk.includes('flex gap-1.5'), '两按钮包在 flex 行内');
  assert((blk.match(/flex-1 min-w-0/g) ?? []).length >= 2, '两按钮各 flex-1 (半宽)');
  assert(!/<button[^>]*w-full[^>]*>📁 曲库/.test(src) && !/className="w-full[^"]*"[^>]*title="选择 osu! 皮肤文件夹/.test(src), '旧整行宽按钮已移除');
}

section('② 工具按钮: 一行一个 (整行宽)');
{
  const toolsIdx = src.indexOf('TOOLS.map');
  const containerStart = src.lastIndexOf('<div', toolsIdx);
  const containerTag = src.slice(containerStart, src.indexOf('>', containerStart) + 1);
  assert(/flex flex-col gap-1\.5/.test(containerTag), '工具容器改纵向 flex (一行一个)');
  assert(!/grid grid-cols-2/.test(containerTag), '旧两列网格已移除');
  const btnBlk = src.slice(toolsIdx, src.indexOf('</button>', toolsIdx));
  assert(/className=\{`w-full text-left px-3 py-1\.5 rounded/.test(btnBlk), '工具按钮整行宽 (原半宽 px-2)');
}

section('③ 网格吸附按钮 + 网格类型下拉: 各半宽一行');
{
  const anchor = src.indexOf('v151: 吸附开关与类型下拉各半宽放一行');
  const snapIdx = src.indexOf('Grid3x3 className'); // v181: ⊞ 网格吸附 → lucide Grid3x3
  const typeIdx = src.indexOf('data-grid-input="type"');
  assert(anchor > 0 && snapIdx > anchor && typeIdx > snapIdx, '吸附按钮与类型下拉存在且同行序');
  const rowBlk = src.slice(anchor, src.indexOf('</div>', typeIdx) + 6);
  assert(rowBlk.includes('flex gap-1.5'), '两者包在 flex 行内');
  const btnBlk = src.slice(src.lastIndexOf('<button', snapIdx), snapIdx); // 含 onClick/className (注意 => 里的 >, 不按标签截)
  assert(/flex-1 min-w-0/.test(btnBlk), '吸附按钮 flex-1 (半宽)');
  const selBlk = src.slice(src.lastIndexOf('<select', typeIdx), src.indexOf('</select>', typeIdx));
  assert(/flex-1 min-w-0/.test(selBlk), '类型下拉 flex-1 (半宽)');
  assert(!/store\.gridSnap = !store\.gridSnap; store\.emit\(\); \}\}\s*\n\s*className=\{`w-full/.test(src), '吸附按钮旧整行宽已移除');
}

section('④ 网格间距与旋转: 放一行');
{
  const spacingIdx = src.indexOf('<GridSpacingInput');
  const rotIdx = src.indexOf('data-grid-input="rotation"');
  assert(spacingIdx > 0 && rotIdx > spacingIdx, '间距输入与旋转输入存在且同行序');
  // 两者位于同一个 flex 行容器内 (同行容器内不再有第二个顶层 label/div 断开)
  const rowStart = src.lastIndexOf('<div className="flex items-center gap-1.5', spacingIdx);
  const rowEnd = src.indexOf('</div>', rotIdx);
  assert(rowStart > 0 && rowEnd > rotIdx, '间距与旋转在同一 flex 行容器内');
  const rowBlk = src.slice(rowStart, rowEnd);
  assert(rowBlk.includes('间距') && rowBlk.includes('旋转') && rowBlk.includes('px') && rowBlk.includes('°'), '行内含 间距..px 与 旋转..°');
  assert(!/<label[^>]*>\s*旋转/.test(src), '旧独立旋转行已移除');
}

if (failures) { console.error(`\nV151_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV151_ALL_PASSED');
