// v111 源码接线断言: ①谱面信息/保存反馈移到游玩区左下角 ②频谱滚动簿记改 spectroScrollStep (修变速漂移)
// 运行: node verifier/v111/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const app = read('src/App.tsx');
// v127 适配: WaveformPanel 废弃, 绘制层移到 waveformDraw.ts (import 路径随之改 './waveformData')
const wp = read('src/osu/waveformDraw.ts');
const wd = read('src/osu/waveformData.ts');

// ---------- ① 谱面信息移到页签栏 (v184: 原游玩区左下角 → song setup 左侧居中) ----------
assert(app.includes("setTab('setup')"), 'App 含 song setup 页签');
// v184 适配: 容器 = flex-1 居中 (song setup 左侧), 名称 Label 带 data-save-message
assert(/flex-1 flex items-center justify-center gap-2 min-w-0 pointer-events-none/.test(app),
  '谱面信息容器: 页签栏 flex-1 居中 (v184)');
assert(app.indexOf("setTab('setup')") < app.indexOf('data-save-message'), 'v186: song setup 页签在谱面信息左边');
const toolbar = app.slice(app.indexOf('顶部工具栏'), app.indexOf('页签栏'));
assert(!/data-save-message/.test(toolbar) && !/ml-auto/.test(toolbar), '工具栏不再含谱面信息/保存反馈');
assert(/data-save-message/.test(app) && /store\.saveMessage/.test(app), '保存反馈 data-save-message 保留 (v67/v81 CDP 兼容)');
assert(/v184: 谱面信息从游玩区左下角移到页签栏/.test(app), 'v184 注释 (挪位目的)');

// ---------- ② 频谱滚动簿记 spectroScrollStep ----------
assert(/export function spectroScrollStep/.test(wd), 'waveformData 导出 spectroScrollStep 纯函数');
assert(/imgT0 \+ \(dx \* win\) \/ width/.test(wd), 'spectroScrollStep: newImgT0 = imgT0 + dx*win/width (残差留在 imgT0)');
assert(/spectroScrollStep/.test(wp), 'drawSpectro 使用 spectroScrollStep');
assert(/interface SpectroScroll \{ cv: HTMLCanvasElement; imgT0: number; win: number; w: number; h: number; bgA: number \}/.test(wp), '滚动缓存类型 = imgT0 簿记 (v127: SpectroScroll 接口; v271 适配: 补 bgA 缓存键)');
assert(!/frac: number/.test(wp) && !/sc\.frac/.test(wp), '旧 frac 双簿记已移除');
assert(/renderSpectroStrip\(sc\.cv, buf, newImgT0/.test(wp), '新露出列按位图自身时间基准 newImgT0 采样 (接缝无时间差)');
assert(/spectroScrollStep, WAVEFORM_VISUAL_OFFSET_MS \} from '.\/waveformData'/.test(wp) && !/pixelShift \} from '.\/waveformData'/.test(wp),
  '组件从 waveformData 导入 spectroScrollStep (不再导入 pixelShift; v112: +WAVEFORM_VISUAL_OFFSET_MS)');

console.log(failures ? `\nV111_CHECK_FAILED: ${failures}` : '\nV111_CHECK_PASSED');
process.exit(failures ? 1 : 0);
