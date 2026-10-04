// 验证器 v333: Alt+左键框选中松开/按下 Alt 立即切换选区类型 (不等鼠标移动)
//   用户反馈: Alt+左键拖动框选后松开 Alt, 应切为物件框选 (选中单点), 但实际仍选中滑条锚点,
//   要移动一下鼠标才刷新。v309 的 syncMarqueeMode 只在 mousemove/mouseup 入口调用,
//   Alt 键事件不触发; 且转换后物件选区也要等 mousemove 才重算。
// 修法 (EditorCanvas):
//   1) 框选选区重算抽出 recomputeMarqueeSelection (光标取 cursorRef, mousemove/键盘共用);
//   2) keydown/keyup/blur 处理器在 altHeldRef 更新后即调 syncMarqueeMode + recomputeMarqueeSelection。
// 运行: node verifier/v333/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const ec = readSrc('src/components/EditorCanvas.tsx');

section('recomputeMarqueeSelection 抽出共用');
{
  assert(/const recomputeMarqueeSelection = \(\) => \{/.test(ec), 'recomputeMarqueeSelection 定义');
  const fn = ec.match(/const recomputeMarqueeSelection = \(\) => \{[\s\S]{0,2600}?\n  \};/);
  assert(!!fn && /const cp = cursorRef\.current;/.test(fn[0]), '光标取 cursorRef (非事件参数)');
  assert(!!fn && /nodesInRect\(sliders, getStackOffsets\(bm\), r\)/.test(fn[0]), '节点框选重算保留');
  assert(!!fn && /store\.select\(\[\.\.\.mq\.base, \.\.\.keepHidden, \.\.\.objectsInRect/.test(fn[0]), '物件框选重算保留 (v277 保留隐藏物件)');
}

section('keydown/keyup/blur 即时同步');
{
  const key = ec.match(/const key = \(e: KeyboardEvent\) => \{[\s\S]{0,900}?syncMarqueeMode\(\); recomputeMarqueeSelection\(\);/);
  assert(!!key, 'keydown/keyup: Alt 态更新后即切框选+重算');
  assert(/const blur = \(\) => \{ altHeldRef\.current = false; refreshHover\(\); syncMarqueeMode\(\); recomputeMarqueeSelection\(\); \};/.test(ec), 'blur 同样同步');
}

section('mousemove 走共用函数 (v309 入口保留)');
{
  assert(/syncMarqueeMode\(\); \/\/ v309[^\n]*\n[^\n]*\n?\s*if \(nodeMarqueeRef\.current \|\| marqueeRef\.current\) \{ recomputeMarqueeSelection\(\); return; \}/.test(ec),
    'mousemove: syncMarqueeMode 后走 recomputeMarqueeSelection');
  // 内联旧块已移除 (onMouseMove 内不再各写一份)
  const mv = ec.slice(ec.indexOf('const onMouseMove'));
  assert((mv.match(/nodesInRect\(sliders/g) ?? []).length === 0, 'onMouseMove 内联节点框选块移除');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv333 全部通过');
process.exit(failures ? 1 : 0);
