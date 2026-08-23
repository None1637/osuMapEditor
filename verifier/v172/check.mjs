// 验证器 v172: 皮肤窗口打开时滚动到当前选中皮肤 (尽量居中)
// 运行: node verifier/v172/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('SkinListPanel.tsx: 打开滚动定位');
{
  const src = readSrc('src/components/SkinListPanel.tsx');
  assert(/data-skin-current=\{current === name \? '1' : undefined\}/.test(src), '当前皮肤行带 data-skin-current 标记');
  assert(/const listRef = useRef<HTMLDivElement>\(null\);/.test(src), '列表容器 ref');
  assert(/ref=\{listRef\} className="max-h-80 overflow-y-auto/.test(src), 'ref 挂在滚动容器上');
  assert(/listRef\.current\?\.querySelector\('\[data-skin-current="1"\]'\)\?\.scrollIntoView\(\{ block: 'center' \}\)/.test(src),
    '加载后 scrollIntoView block:center (尽量居中, 贴边自动贴边)');
  assert(/\}, \[skins, current\]\);/.test(src), '依赖 skins+current (列表/选中加载完成才定位)');
  // v150 回归: Row 仍为模块级组件 (60fps 重渲染不重挂载)
  assert(/function Row\(\{ name, label, current, busy, onChoose \}/.test(src)
    && src.indexOf('function Row(') < src.indexOf('export function SkinListPanel'), 'Row 保持模块级 (v150)');
}

console.log(failures ? `\nV172 FAILED: ${failures}` : '\nV172 ALL PASSED');
process.exit(failures ? 1 : 0);
