// 验证器 v301: F07 超长滑条冻结白屏+失色修复 + F05a 旋转/缩放窗口实时预览 (+F05b 回归)
// 运行: node verifier/v301/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store 纯函数单测 (tests.ts: F05b 回归 + F05a 预览会话)');
{
  const out = path.join(root, 'verifier/v301/_bundle.mjs');
  execSync(`npx esbuild "${path.join(root, 'verifier/v301/tests.ts')}" --bundle --platform=node --outfile="${out}"`, { cwd: root, stdio: 'pipe' });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '    ' + l).join('\n'));
}

section('renderer.ts: F07 滑条身离屏位图尺寸上限');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/const MAX_DIM = 8192, MAX_AREA = 8192 \* 4096;/.test(src), 'MAX_DIM/MAX_AREA 上限常量存在');
  // v306: q 表达式改为 min(4, max(1, ss, 0.005), 上限项) — 上限永远优先 (v148 末端延长数十万 px 时
  //   原 0.05 下限会顶破 MAX_AREA)
  assert(/Math\.min\(4, Math\.max\(1, ss, 0\.005\), MAX_DIM \/ w, MAX_DIM \/ h, Math\.sqrt\(MAX_AREA \/ \(w \* h\)\)/.test(src),
    '超采样倍数 q 按位图尺寸上限收紧 (v306: 上限永远优先)');
  assert(/if \(!\(w > 0\) \|\| !\(h > 0\)\) \{ minX = minY = 0; w = h = 1; \}/.test(src), '退化路径保底 1×1 (防 NaN 画布)');
}

section('EditorCanvas.tsx: F07 渲染主循环单帧异常兜底');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const loop = \(\) => \{[\s\S]{0,400}try \{/.test(src), 'RAF 循环体包裹 try');
  assert(/\} catch \(e\) \{ console\.error\('渲染帧异常 \(已跳过本帧\):', e\); \}[\s\S]{0,80}raf = requestAnimationFrame\(loop\);/.test(src),
    'catch 只跳过本帧, 循环继续');
}

section('store.ts: F05a 变换预览会话 API');
{
  const src = readSrc('src/osu/store.ts');
  assert(/beginTransformPreview\(\)/.test(src), 'beginTransformPreview 存在');
  assert(/previewTransform\(fn: \(objs: HitObject\[\], c: Pt\) => HitObject\[\], origin/.test(src), 'previewTransform 存在');
  assert(/commitTransformPreview\(fn/.test(src), 'commitTransformPreview 存在');
  assert(/endTransformPreview\(\)/.test(src), 'endTransformPreview 存在');
  assert(/this\.restoreTransformBackup\(\);\s*\n\s*this\.pushUndo\(\); \/\/ 快照 = 预览前/.test(src), '提交的 undo 快照 = 预览前状态');
  assert(!/private applyTransform[\s\S]{0,200}previewTransform[\s\S]{0,200}pushUndo/.test(src) ||
    /预览全程不碰 undo 栈/.test(src), '预览路径注释明确不入 undo');
}

section('TransformDialog.tsx: 实时预览接线');
{
  const src = readSrc('src/components/TransformDialog.tsx');
  assert(/store\.beginTransformPreview\(\);\s*\n\s*return \(\) => store\.endTransformPreview\(\);/.test(src), '开窗 begin / 关窗 end');
  assert(/store\.previewTransform\(\(objs, c\) => rotateObjects\(objs, c, angle\), origin\)/.test(src), '角度变化实时预览旋转');
  assert(/store\.previewTransform\(\(objs, c\) => scaleObjects\(objs, c, factor, factorY\), origin\)/.test(src), '倍率变化实时预览缩放');
  assert(/commit\(\(objs, c\) => rotateObjects\(objs, c, Math\.abs\(angle\)\)\)/.test(src), '顺时针按钮走 commit');
  assert(/commit\(\(objs, c\) => rotateObjects\(objs, c, -Math\.abs\(angle\)\)\)/.test(src), '逆时针按钮走 commit');
  assert(/commit\(\(objs, c\) => scaleObjects\(objs, c, factor, factorY\)\)/.test(src), '应用倍率走 commit');
  assert(!/store\.rotateSelected\(/.test(src) && !/store\.scaleSelected\(/.test(src), '对话框不再直接调 rotateSelected/scaleSelected');
  assert(/t\('transform\.footer_hint', 'Changing values previews instantly/.test(src)
    && readSrc('src/i18n/dicts/zh-CN/transform.ts').includes("'transform.footer_hint': '改数值即时预览"),
    '底部提示说明实时预览行为 (v346: i18n key transform.footer_hint + zh-CN 译文)');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv301 全部通过');
process.exit(failures ? 1 : 0);
