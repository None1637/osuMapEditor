// 验证器 v437: 批量复制窗口「镜像重复」选项 (soulten 需求: 重複次數&是否鏡像重複 — 批量复制也要)
// 语义 (用户确认): 隔份镜像 + 轴可选 — 第 2/4/6… 份绕锚点轴向几何镜像 (含滑条形状翻转),
//   平移向量不镜像; 轴 = vertical 竖直轴(左右翻转) / horizontal 水平轴(上下翻转)。
// 运行: node verifier/v437/check.mjs (纯源码+纯函数, 无需 build)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v437/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v437/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 纯函数断言 (内部自报 V437_TESTS_*)
fs.unlinkSync(out);

section('源码: duplicate.ts 参数与镜像逻辑');
{
  const dup = read('src/osu/duplicate.ts');
  assert(/mirrorRepeat: boolean;\s*\/\/ v437/.test(dup), 'DuplicateParams.mirrorRepeat (v437 注释)');
  assert(/mirrorAxis: 'vertical' \| 'horizontal';/.test(dup), 'DuplicateParams.mirrorAxis');
  assert(/mirrorRepeat: false, mirrorAxis: 'vertical', \/\/ v437/.test(dup), 'DEFAULT 默认关镜像/竖直轴');
  assert(/const mirrorOn = p\.mirrorRepeat && i % 2 === 0;/.test(dup), '隔份镜像 (第 2/4/6… 份)');
  assert(/2 \* c\.y - q\.y/.test(dup) && /2 \* c\.x - q\.x/.test(dup), '两轴镜像公式');
  assert(/return \{ x: q\.x \+ tx, y: q\.y \+ ty \};/.test(dup), '平移在镜像之后 (向量不镜像)');
}

section('源码: DuplicateDialog UI');
{
  const dlg = read('src/components/convert/DuplicateDialog.tsx');
  assert(/v437: 镜像重复/.test(dlg), 'v437 注释');
  assert(/data-conv="mirrorRepeat"/.test(dlg), '镜像重复 checkbox 钩子');
  assert(/data-conv="mirrorAxis"/.test(dlg), '轴向下拉钩子');
  assert(/params\.mirrorRepeat && \(/.test(dlg), '勾选后才显示轴向下拉');
  assert(/t\('convert\.dup_mirror', 'Mirror repeat'\)/.test(dlg), '行 label i18n');
}

section('源码: zh-CN 词典');
{
  const dict = read('src/i18n/dicts/zh-CN/convert.ts');
  for (const k of ['convert.dup_mirror', 'convert.dup_mirror_hint', 'convert.dup_mirror_v', 'convert.dup_mirror_h'])
    assert(dict.includes(`'${k}':`), `词典含 ${k}`);
}

section('编译');
{
  execSync('node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc 通过');
}

console.log(failures ? `\nVERIFIER_V437_FAILED: ${failures} 处失败` : '\nVERIFIER_V437_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
