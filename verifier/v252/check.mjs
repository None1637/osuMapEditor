// 验证器 v252: 左下角时间/百分比播放中实时刷新。
// 根因: BottomTimeline 只用 useEditor() 订阅; 播放逐帧走独立通道 playbackFrameVersion
//   (v245 性能设计, 不 bump 主 version), 导致播放中左下角文本静止不动 (用户反馈 bug)。
// 修复: BottomTimeline 增加 usePlaybackFrame() (与 TimingPanel.tsx 既有模式一致)。
// 运行: node verifier/v252/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'src/components/Timelines.tsx'), 'utf8');
assert(/import \{ store, useEditor, usePlaybackFrame \} from '@\/osu\/store'/.test(src), '引入 usePlaybackFrame');
const body = src.match(/export function BottomTimeline\(\) \{[\s\S]{0,200}/)?.[0] ?? '';
assert(/usePlaybackFrame\(\); \/\/ v252/.test(body), 'BottomTimeline 订阅播放逐帧刷新 (v252)');
assert(/data-bottom-time/.test(src), '左下角时间块仍在 (回归保护)');

if (failures) { console.error(`\nV252_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV252_ALL_PASSED');
