// 验证器 v132: 显示设置 (顶栏「显示设置」面板, 5 个开关)
//   皮肤颜色 (skin.ini [Colours] vs 谱面自带, 默认关) / 滑条轨迹细实线 (默认关) /
//   缩圈 (默认开) / 滑条渐出 (默认开) / note 点击特效 (默认开)
// 运行: cd app && node verifier/v132/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v132/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v132/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V132_TESTS_*)
fs.unlinkSync(out);

section('displaySettings.ts: 数据层');
{
  const src = readSrc('src/osu/displaySettings.ts');
  assert(/export interface DisplaySettings/.test(src), 'DisplaySettings 接口导出');
  assert(/skinColors: false/.test(src) && /sliderPathLine: false/.test(src), '皮肤颜色/轨迹线默认关');
  assert(/approachCircle: true/.test(src) && /sliderFadeOut: true/.test(src) && /hitExplosion: true/.test(src), '缩圈/渐出/点击特效默认开');
  assert(/osu-editor:display-settings/.test(src), 'localStorage 持久化');
  assert(/export const displaySettings/.test(src) && /export function setDisplayFlag/.test(src), '可变单例 + setter 导出');
}

section('skin.ts: [Colours] 解析');
{
  const src = readSrc('src/osu/skin.ts');
  assert(/comboColors: string\[\]/.test(src) && /sliderBorder: string \| null/.test(src) && /sliderTrackOverride: string \| null/.test(src), 'Skin 接口新增三个颜色字段');
  assert(/export function parseSkinIniColours/.test(src), 'parseSkinIniColours 导出');
  assert(/\[Colours\]/.test(src) && /\^Combo\(\\d\+\)\$/i.test(src.replace(/\//g, '/')), '[Colours] 段 + Combo\d 键匹配');
  assert(/iniTextP/.test(src), 'skin.ini 文本共享读取 (帧率与颜色共用)');
}

section('renderer.ts: 开关接线');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/import \{ displaySettings \} from '\.\/displaySettings'/.test(src), '引入 displaySettings');
  assert(/comboColor\(bm: Beatmap, combo: number, override\?: string\[\]\)/.test(src), 'comboColor 增加可选 override (向后兼容)');
  assert(/override\?\.length \? override/.test(src), 'override 优先逻辑');
  assert(/function sliderBodyColors/.test(src), 'sliderBodyColors 皮肤 border/track 覆盖');
  assert(/displaySettings\.sliderPathLine && path\.points\.length > 1/.test(src), '滑条轨迹线绘制分支');
  assert(/if \(!displaySettings\.approachCircle\) return;/.test(src), '缩圈开关 (drawApproach 开头)');
}

section('lifecycle.ts: 渐出/点击特效分支');
{
  const src = readSrc('src/osu/lifecycle.ts');
  assert(/if \(!displaySettings\.sliderFadeOut && o\.type === 'slider'\) return 0;/.test(src), '关滑条渐出 -> 结束立即 0');
  assert(/if \(!displaySettings\.hitExplosion && o\.type === 'circle'\) return 0;/.test(src), '关点击特效 -> 命中立即 0');
  assert(src.indexOf('if (time <= end) return 1;') < src.indexOf("sliderFadeOut && o.type === 'slider'"), '分支在结束判定之后 (结束前不受影响)');
}

section('Timelines.tsx: combo 色同步皮肤开关');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/displaySettings\.skinColors \? getSkin\(\)\.comboColors : undefined/.test(src), '时间轴物件染色走皮肤颜色开关');
}

section('store/UI: 面板与按钮接线');
{
  const st = readSrc('src/osu/store.ts');
  assert(/displayPanelOpen = false;/.test(st) && /setDisplayPanelOpen/.test(st), 'store displayPanelOpen + setter');
  // v168 适配: 开关 setter 改 BoolDisplayKey (新增数值项 bgBrightness 走 setDisplayNumber)
  assert(/setDisplayFlag\(k: BoolDisplayKey, v: boolean\) \{ applyDisplayFlag\(k, v\); this\.emitSelection\(\); \}/.test(st), 'setDisplayFlag 转发 + emitSelection (v168: BoolDisplayKey)');
  const dp = readSrc('src/components/DisplayPanel.tsx');
  assert(/data-display-toggle=\{r\.key\}/.test(dp), '面板开关行 data 属性');
  assert((dp.match(/key: '/g) || []).length === 10, '10 个设置行 (v132 原 5 个 + v147 打击动画 + v231/v232 两个下拉行 + v253/254 两个开关行)'); // v147 适配: 原断言 5 行; v231/v232 适配: SELECT_ROWS +2; v253/254 适配: ROWS +2; v284 适配: v255 时间轴半透明开关移除 (-1)
  const app = readSrc('src/App.tsx');
  assert(/data-display-panel-btn/.test(app), '页签栏「显示设置」按钮');
  assert(/\{store\.displayPanelOpen && <DisplayPanel \/>\}/.test(app), '面板渲染挂载');
  assert(app.indexOf('data-display-panel-btn') > app.indexOf('<div className="flex-1" />'), '按钮在页签右侧 (flex-1 撑开之后)');
}

if (failures) { console.error(`\nVERIFIER_V132_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V132_ALL_PASSED');
