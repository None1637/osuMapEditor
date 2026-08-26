// 验证器 v225: 文本补偿缩放 — 控件尺寸随 v217 zoom 线性缩, 文本按 sqrt 曲线缓缩 (方案A)。
// uiZoom.ts: TEXT_ZOOM_MIN=0.8, textZoom()=clamp(√uiZoom,0.8,1), textZoomComp()=textZoom/uiZoom;
// App.tsx: zoom 容器挂 ui-zoom-root + CSS 变量 --fs-comp (随 useUiZoom resize 重渲染更新);
// index.css: .ui-zoom-root 兜底字号 + text-xs..3xl/text-[9/10/11px] 覆盖 (calc(原值 * var(--fs-comp)))。
// 运行: node verifier/v225/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('uiZoom.ts: 补偿函数');
{
  const src = readSrc('src/osu/uiZoom.ts');
  assert(/export const TEXT_ZOOM_MIN = 0\.8/.test(src), 'TEXT_ZOOM_MIN = 0.8 (视觉字号下限 80%)');
  assert(/export function textZoom\(\)[\s\S]*?Math\.sqrt\(uiZoom\(\)\)/.test(src), 'textZoom = clamp(√uiZoom, 0.8, 1)');
  assert(/export function textZoomComp\(\)[\s\S]*?textZoom\(\) \/ uiZoom\(\)/.test(src), 'textZoomComp = textZoom/uiZoom');
}

section('App.tsx: --fs-comp 挂载');
{
  const src = readSrc('src/App.tsx');
  assert(/import \{ useUiZoom, textZoomComp \} from '@\/osu\/uiZoom'/.test(src), '引入 textZoomComp');
  assert(/const fsComp = textZoomComp\(\)/.test(src), '渲染期计算 fsComp (随 useUiZoom resize 更新)');
  assert(/className="ui-zoom-root flex flex-col/.test(src), 'zoom 容器挂 ui-zoom-root 类');
  assert(/'--fs-comp': fsComp/.test(src), 'zoom 容器 style 注入 --fs-comp 变量');
}

section('index.css: 补偿规则');
{
  const src = readSrc('src/index.css');
  assert(/\.ui-zoom-root \{\s*font-size: calc\(16px \* var\(--fs-comp, 1\)\);/.test(src), '容器兜底字号 calc(16px * --fs-comp)');
  for (const [cls, orig] of [['text-xs', '0.75rem'], ['text-sm', '0.875rem'], ['text-base', '1rem'], ['text-lg', '1.125rem'], ['text-xl', '1.25rem'], ['text-2xl', '1.5rem'], ['text-3xl', '1.875rem']]) {
    const o = orig.replace(/\./g, '\\.');
    assert(new RegExp(`\\.ui-zoom-root \\.${cls}\\s*\\{\\s*font-size: calc\\(${o}\\s*\\*\\s*var\\(--fs-comp, 1\\)\\);`).test(src), `${cls} 覆盖 (${orig} × comp)`);
  }
  for (const px of [9, 10, 11]) {
    assert(new RegExp(`\\.ui-zoom-root \\.text-\\\\\\[${px}px\\\\\\]\\s*\\{\\s*font-size: calc\\(${px}px\\s*\\*`).test(src), `text-[${px}px] 任意值覆盖`);
  }
  assert(!/\.ui-zoom-root[^\n]*\{[^}]*line-height/.test(src), '补偿规则不动 line-height (防裁剪)');
}

if (failures) { console.error(`V225 FAILED: ${failures}`); process.exit(1); }
console.log('V225 ALL PASSED');
