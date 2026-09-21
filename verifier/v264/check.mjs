// 验证器 v264: 拖动滑条点性能优化 (用户反馈 100fps)。
// profile (verifier/v264/profile-nodedrag.mjs, 2000 物件谱面单滑条节点拖动画圆):
//   优化前 83.8fps / busyAvg 8.23ms — 热点: getBoundingClientRect (每 mousemove+每帧),
//   dirtyFingerprint (commitDrag→emit 全表指纹), React 全树重渲 (每 mousemove 全量 emit),
//   dataVersion 失效 (堆叠/combo/静态层/hitsound 事件表)。
//   优化后 196fps / busyAvg 1.03ms (dev 模式; 生产 exe 无 jsxDEV 更高)。
// 修复: 1) zoomRect 缓存 (resize/scroll 失效 + 2s TTL); 2) 节点拖动 rAF 节流
//   (mousemove 只记 pending, 帧循环每帧最多应用一次, mouseup 落点补齐);
//   3) store.commitDragFrame 轻量逐帧提交 (bump version 不 bump dataVersion, 不算脏指纹;
//   mouseup 完整 commitDrag 补齐)。
// 运行: node verifier/v264/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const uz = fs.readFileSync(path.join(root, 'src/osu/uiZoom.ts'), 'utf8');
assert(/v264: zoomRect 缓存/.test(uz), 'uiZoom: zoomRect 缓存注释');
assert(/rectCache = new WeakMap/.test(uz), 'uiZoom: WeakMap 缓存');
assert(/addEventListener\('resize', bump\)/.test(uz) && /addEventListener\('scroll', bump, true\)/.test(uz), 'uiZoom: resize/scroll 失效');
assert(/now - hit\.t < 2000/.test(uz), 'uiZoom: 2s TTL 兜底');

const st = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
assert(/commitDragFrame\(\) \{ this\.version\+\+; this\.listeners\.forEach/.test(st), 'store: commitDragFrame 轻量提交 (只 bump version)');
assert(/v264: 拖拽逐帧提交/.test(st), 'store: commitDragFrame 注释');

const ec = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
assert(/const applyNodesMoveDrag = \(cp: Pt\)/.test(ec) && /const applyNodeDrag = \(p: Pt\)/.test(ec), 'apply 函数抽出');
assert((ec.match(/store\.commitDragFrame\(\); \/\/ v264/g) ?? []).length === 2, '两个节点拖动路径走 commitDragFrame');
assert(/nmd\.pending = \{ x: cp\.x, y: cp\.y \}/.test(ec) && /nd\.pending = \{ x: cp\.x, y: cp\.y \}/.test(ec), 'mousemove 只记 pending');
assert(/if \(nmd0\?\.pending\) \{ const q = nmd0\.pending; nmd0\.pending = null; applyNodesMoveDrag\(q\); \}/.test(ec), '帧循环应用 nodesMoveDrag pending');
assert(/if \(nd0\?\.pending\) \{ const q = nd0\.pending; nd0\.pending = null; applyNodeDrag\(q\); \}/.test(ec), '帧循环应用 nodeDrag pending');
assert((ec.match(/pending = null; applyNodes?(Move)?Drag\(q\); \} \/\/ v264: 落点补齐/g) ?? []).length === 2, 'mouseup 落点补齐 ×2');
assert(!/if \(nmd && bm\) \{[\s\S]{0,200}store\.commitDrag\(\)/.test(ec), 'mousemove 内不再直接全量 commitDrag (节点拖动路径)');

if (failures) { console.error(`\nV264_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV264_ALL_PASSED');
