// 验证器 v287: 测试游玩功能 (参考 lazer EditorPlayer)
// 依据 (本地 lazer 源码 osu.Game 已核对):
//   EditorPlayer.cs — editorTime 前物件满分预填 (markPreviousObjectsHit) / 不判 Miss / 完成直接返回编辑器 / 永不失败;
//   OsuHitWindows.cs — great/ok/meh = floor(DR(od, range))-0.5; Judgement.cs — 分数/血量数值;
//   HitResult.cs — AffectsCombo (小 tick 不影响); SliderInputManager.cs — tracking = 2.4r + 按住;
//   Spinner.cs / DrawableSpinner.cs — 圈数需求与结束判定。
// 起始: editorTime-3s (用户需求, 前几秒开始); editorTime ≤ 首物件则从头 (lazer gameplayStart 语义)。
// 运行: node verifier/v287/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v287/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v287/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V287_TESTS_*)
fs.unlinkSync(out);

const pre = readSrc('src/osu/starrating/preprocessing.ts');
assert(/export function buildSliderData/.test(pre) && /export function difficultyRange/.test(pre) && /export const TAIL_LENIENCY/.test(pre) && /export function endTimeOf/.test(pre), 'preprocessing: 复用件已导出');

const judge = readSrc('src/osu/gameplay/judgement.ts');
assert(/Math\.floor\(difficultyRange\(od, 80, 50, 20\)\) - 0\.5/.test(judge), '判定窗 great 公式 (lazer)');
assert(/great: 0\.05, ok: 0\.025, meh: 0\.0025, miss: -0\.10/.test(judge), '血量数值 (lazer DEFAULT_MAX=0.05)');
assert(/smallTickHit: false, smallTickMiss: false/.test(judge), '小 tick 不影响 combo (lazer AffectsCombo)');
assert(/spinnerRequired/.test(judge) && /90, 150, 225/.test(judge), '转盘圈数需求 (lazer CLEAR_RPM)');

const sess = readSrc('src/osu/gameplay/testPlaySession.ts');
assert(/TESTPLAY_LEAD_BACK = 3000/.test(sess), 'lead-back 3 秒');
assert(/prefill\('great'\)/.test(sess), 'editorTime 前物件满分预填');
assert(/this\.radius \* 2\.4/.test(sess) && /keyHeld/.test(sess), 'tracking = 2.4r 内 + 按住 (lazer FOLLOW_AREA)');
assert(/TAIL_LENIENCY/.test(sess), '滑条尾 -36ms 宽限');

const rd = readSrc('src/osu/renderer.ts');
assert(/gameplay\?: Map<number, GameplayObjRender>/.test(rd), 'RenderCtx.gameplay 可选字段');
assert(/gi\?\.state === 'hit'\) hitFade/.test(rd), '单点爆炸锚定实际命中时刻');
assert(/st === 'miss' && time > t\.timeMs\) continue/.test(rd), 'tick 未跟踪到点即隐');
assert(/!rc\.gameplay \|\| rc\.gameplay\.get\(o\.id\)\?\.tracking/.test(rd), '跟随圈仅 tracking 显示');
assert(/giSpin && giSpin\.state !== 'prehit'/.test(rd), '转盘转角由玩家驱动');

const ov = readSrc('src/components/TestPlayOverlay.tsx');
assert(/data-testid="testplay-overlay"/.test(ov), '覆盖层挂载点');
assert(/store\.seek\(session\.startTime\)/.test(ov) && /store\.play\(\)/.test(ov), '进入: seek 起点 + 播放');
assert(/store\.pause\(\);\s*store\.seek\(editorTime\)/.test(ov), '退出: 暂停 + 回 editorTime (lazer quickExit)');
assert(/time > session\.lastEnd \+ 1500/.test(ov), '谱面结束延迟自动退出');
assert(/matchesHotkey\(e, 'test-hit-1'\) \|\| matchesHotkey\(e, 'test-hit-2'\)/.test(ov), 'Z/X 击打键 (v288: 注册表可改键)');

const app = readSrc('src/App.tsx');
assert(/data-testplay-btn/.test(app), '页签栏测试游玩按钮');
assert(/showLibrary \|\| showSkin \|\| testPlay\) return/.test(app), '全局热键门控含 testPlay');
assert(/testPlayRef\.current\) return/.test(app), '菜单命令门控 (F6 等不打断游玩)');
assert(/\{testPlay && <TestPlayOverlay/.test(app), 'App 挂载覆盖层');

const hk = readSrc('src/osu/hotkeys.ts');
assert(/id: 'test-play'[\s\S]*?defaults: \['F5'\]/.test(hk), 'F5 注册进快捷键表 (可改键)');
assert(/case 'test-play': e\.preventDefault\(\); setTestPlay\(true\)/.test(app), 'F5 派发 (preventDefault 防浏览器刷新)');

if (failures) { console.error(`\nV287_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV287_ALL_PASSED');
