// 验证器 v164: 曲库窗口 — 搜索框内按下拖选文本、鼠标移出窗口松开时误关修复
// 改为: 只有 mousedown 和 mouseup 都落在遮罩本体上才关闭
// 运行: node verifier/v164/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('SongLibrary.tsx: 遮罩关闭逻辑');
{
  const src = readSrc('src/components/SongLibrary.tsx');
  assert(/const backdropDownRef = useRef\(false\);/.test(src), 'backdropDownRef 记录 mousedown 落点');
  assert(/onMouseDown=\{e => \{ backdropDownRef\.current = e\.target === e\.currentTarget; \}\}/.test(src),
    'mousedown: 仅落在遮罩本体时置标记');
  assert(/onMouseUp=\{e => \{ if \(e\.target === e\.currentTarget && backdropDownRef\.current\) onClose\(\); backdropDownRef\.current = false; \}\}/.test(src),
    'mouseup: 按下+松开都在遮罩本体才关闭, 并复位标记');
  // 遮罩行不再用裸 onClick={onClose} (mousedown 在输入框/mouseup 在遮罩时 click 落共同祖先 = 误关根源)
  const backdropLine = src.split('\n').find(l => l.includes('fixed inset-0 z-50 bg-black/70'));
  assert(backdropLine && !/onClick=\{onClose\}/.test(backdropLine), '遮罩行不再裸用 onClick={onClose}');
  // ✕ 按钮关闭不受影响
  assert(/onClick=\{onClose\}><X className/.test(src), '✕ 关闭按钮保留 (v181: ✕ → lucide X)');
}

console.log(failures ? `\nV164 FAILED: ${failures}` : '\nV164 ALL PASSED');
process.exit(failures ? 1 : 0);
