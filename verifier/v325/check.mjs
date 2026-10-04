// 验证器 v325: 菜单栏/快捷键面板文本补偿缩放 — 补全 v225 未覆盖的任意值字号
//   问题: v225 文本补偿 (textZoom = √uiZoom, CSS --fs-comp 覆盖) 只覆盖 text-[9/10/11px]
//   与 tailwind 标准字号类; MenuBar 用 text-[15px]/[13px], HotkeyPanel 用 text-[13px]/[12px],
//   这些任意值类未被覆盖 → 窗口缩小时菜单文本仍随 zoom 线性缩得过小。
// 修法: index.css 补 text-[12px]/[13px]/[15px] 三条 --fs-comp 覆盖 (与 v225 同机制)。
// 运行: node verifier/v325/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const css = readSrc('src/index.css');
const mb = readSrc('src/components/MenuBar.tsx');
const app = readSrc('src/App.tsx');

section('index.css: 任意值字号 --fs-comp 覆盖补全');
{
  for (const px of [9, 10, 11, 12, 13, 15]) {
    const re = new RegExp(`\\.ui-zoom-root \\.text-\\\\\\[${px}px\\\\\\]\\s+\\{ font-size: calc\\(${px}px\\s+\\* var\\(--fs-comp, 1\\)\\); \\}`);
    assert(re.test(css), `text-[${px}px] 覆盖存在`);
  }
}

section('MenuBar: 在 ui-zoom-root 内且使用被覆盖的字号类');
{
  assert(/className="ui-zoom-root /.test(app), 'App 根容器挂 ui-zoom-root');
  const rootIdx = app.indexOf('ui-zoom-root');
  const mbIdx = app.indexOf('<MenuBar');
  assert(rootIdx >= 0 && mbIdx > rootIdx, 'MenuBar 渲染在 ui-zoom-root 容器之后 (DOM 内)');
  assert(/text-\[15px\]/.test(mb) && /text-\[13px\]/.test(mb), 'MenuBar 使用 text-[15px]/[13px] (现已被 CSS 覆盖)');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv325 全部通过');
process.exit(failures ? 1 : 0);
