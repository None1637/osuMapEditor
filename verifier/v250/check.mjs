// 验证器 v250: 多选拖动时选中标记 (装饰层/选中框) 不跟随修复。
// 根因: v245 性能优化把选中装饰层 (renderer.drawSelectionLayer) 与选中框 (EditorCanvas.currentQuads)
//   的缓存键定为 dataVersion; 但拖拽移动物件是原地改坐标 + emitSelection (只 bump version,
//   刻意不 bump dataVersion — 避免 hitsound 事件表重建), 拖动期间键不变 → 装饰层停在原位。
// 修复: 几何相关缓存键改用 store.getVersion() (emit/emitSelection/emitPlayback 都会 bump;
//   播放逐帧走独立的 playbackFrameVersion, 不会每帧冲掉缓存)。
// 运行: node verifier/v250/check.mjs; 实测: node verifier/v250/cdp-v250.mjs (需 7100 dev server)
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const key = `\$\{store\.getVersion\(\)\}\|\$\{selectionSig\(\)\}`/.test(src),
    '选中框 memo 键 = getVersion + 选区签名 (v250: 拖动中 emitSelection 即失效)');
  assert(/cacheKey: String\(store\.getVersion\(\)\)/.test(src),
    'renderPlayfield cacheKey = getVersion (选中装饰层/followPoint 跟随拖动)');
  assert(!/cacheKey: String\(store\.getDataVersion\(\)\)/.test(src), 'cacheKey 不再用 dataVersion');
  // 位置无关的派生数据仍用 dataVersion (拖动不触发重算)
  assert(/getStackOffsets[\s\S]{0,200}getDataVersion/.test(src) && /getCombos[\s\S]{0,200}getDataVersion/.test(src),
    '堆叠/combo memo 仍用 dataVersion (位置无关, 不受拖动影响)');
}
{
  const src = readSrc('src/osu/store.ts');
  assert(/emitSelection\(\) \{ this\.version\+\+/.test(src), 'emitSelection bump version (拖动通知链)');
  assert(/getVersion = \(\) => this\.version/.test(src), 'getVersion 导出');
}

if (failures) { console.error(`\nV250_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV250_ALL_PASSED');
