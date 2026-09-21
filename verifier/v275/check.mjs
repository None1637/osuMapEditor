// 验证器 v275: 旋转/缩放拖拽中选中装饰层实时跟随。
// 需求: 用户反馈「旋转/缩放选中物件时, 物件选中效果没有跟着动」(截图: 物件已变形, 选中描边停在原位)。
// 根因: drawSelectionLayer 是缓存层 (v246), key 含 rc.cacheKey = String(store.getVersion()) (v250);
//   而 applyScaleUpdate/applyRotateUpdate/applyNodeScaleUpdate/applyNodeRotateUpdate 四个拖拽应用函数
//   只改数据 + invalidatePath, 从不 bump version → key 不变 → 装饰层停在 Begin 快照位置。
//   (物件本体每帧重画所以动了; 黄框每帧从 currentQuads 实时算所以也动了; 只有缓存装饰层不动。)
// 修复: 四个函数末尾 moved 时走 store.commitDragFrame() 轻量逐帧提交 (v264 通道:
//   bump version 但不 bump dataVersion/不算脏指纹); mouseup 仍走完整 commitDrag() 不变。
// 运行: node verifier/v275/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
const n = (src.match(/v275:/g) ?? []).length;
assert(n === 4, `四个拖拽应用函数各一处 v275 commitDragFrame (实际 ${n})`);
assert(/if \(sd\.moved\) store\.commitDragFrame\(\);/.test(src), '物件缩放拖拽 bump version');
assert(/if \(rd\.moved\) store\.commitDragFrame\(\);/.test(src), '物件/节点旋转拖拽 bump version');
// 回归保护: mouseup 完整提交不变
assert(/scaleDragRef\.current\.moved\) store\.commitDrag\(\)/.test(src), 'mouseup commitDrag 完整提交保留 (缩放)');
assert(/rotateDragRef\.current\.moved\) store\.commitDrag\(\)/.test(src), 'mouseup commitDrag 完整提交保留 (旋转)');
// 装饰层 key 含 version (v250)
const rd = fs.readFileSync(path.join(root, 'src/osu/renderer.ts'), 'utf8');
assert(/rc\.cacheKey \?\? '', rc\.selected\.size, sig/.test(rd), '装饰层缓存 key 含 cacheKey (= getVersion, v250)');

if (failures) { console.error(`\nV275_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV275_ALL_PASSED');
