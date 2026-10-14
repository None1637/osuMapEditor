// 验证器 v406: 滑条尾吸附节拍开关 (editorPrefs.sliderTailSnap)
// 运行: cd app && node verifier/v406/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v406/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v406/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('editorPrefs.ts: sliderTailSnap 字段');
{
  const src = readSrc('src/osu/editorPrefs.ts');
  assert(/v406/.test(src), 'v406 版本注释');
  assert(/sliderTailSnap: boolean;/.test(src), 'EditorPrefs 含 sliderTailSnap');
  assert(/sliderTailSnap: true,/.test(src) && /sliderTailSnap: p\.sliderTailSnap !== false/.test(src),
    '默认 true + localStorage 读回 (false 才算关)');
}

section('sliderPath.ts: 两个吸附入口受控');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/import \{ editorPrefs \} from '\.\/editorPrefs';/.test(src), '引入 editorPrefs');
  assert(/export function placementLength\([\s\S]*?\{[\s\S]*?if \(!editorPrefs\.sliderTailSnap\) return Math\.max\(1, Math\.floor\(geometryLength\)\);/.test(src),
    'placementLength: 关 = 直通几何全长 (预览/落盘同函数)');
  const resnap = src.match(/export function resnapSliderLength[\s\S]{0,700}?\n\}/)?.[0] ?? '';
  assert(/if \(!editorPrefs\.sliderTailSnap\) \{ o\.length = Math\.max\(1, Math\.floor\(geo\)\); return; \}/.test(resnap),
    'resnapSliderLength: 关 = 直通几何全长');
  assert(/o\.length = snapSliderLength\(bm\.timingPoints/.test(resnap), '开 = 原 snapSliderLength 路径保留');
}

section('App.tsx: 左栏开关按钮');
{
  const src = readSrc('src/App.tsx');
  assert(/data-slider-tail-snap="toggle"/.test(src), '按钮 data-slider-tail-snap');
  assert(/store\.setEditorPref\('sliderTailSnap', !editorPrefs\.sliderTailSnap\)/.test(src), '点击翻转 editorPrefs (经 store emit 重渲染)');
  assert(/t\('app\.slider_tail_snap', 'Slider Tail Snap'\)/.test(src) && /t\('app\.slider_tail_snap_title',/.test(src), 'i18n key');
}

section('zh-CN 词典');
{
  const zh = readSrc('src/i18n/dicts/zh-CN/app.ts');
  assert(/'app\.slider_tail_snap': '滑条尾吸附节拍'/.test(zh), 'app.slider_tail_snap');
  assert(/'app\.slider_tail_snap_title':/.test(zh), 'app.slider_tail_snap_title');
}

if (failures) { console.error(`V406 FAILED (${failures})`); process.exit(1); }
console.log('V406 ALL PASSED');
