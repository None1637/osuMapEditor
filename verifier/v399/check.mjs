// 验证器 v399: 对称滑条开启时拖拽圆弧头节点旋转 n 圈崩溃 — 转换预览物件渲染缓存回收
// 根因: 转换预览 (computeSymSlider 等) 每次重算生成新 genId 物件, 渲染层按 id 缓存
//   滑条路径 (pathCache) / 滑条身贴图 (bodyCache) / 描边贴图 (outlineCache),
//   旧预览 id 的缓存条目永不失效无限累积 — 开着预览拖节点几千帧 = 内存暴涨页崩。
// 修复: store.ts setConversionPreview 换代 / applyConversion 应用 / closeConversion 关闭
//   三处都对上一代预览物件逐个 invalidatePath 回收缓存 (clearConversionPreviewCache)。
// 运行: cd app && node verifier/v399/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store.ts: 预览缓存回收');
{
  const src = readSrc('src/osu/store.ts');
  assert(/private clearConversionPreviewCache\(\) \{\s*if \(this\.conversionPreview\) for \(const o of this\.conversionPreview\.objects\) invalidatePath\(o\.id\);/.test(src),
    'clearConversionPreviewCache: 遍历预览物件 invalidatePath');
  assert(/setConversionPreview\([\s\S]*?this\.clearConversionPreviewCache\(\);[\s\S]*?this\.conversionPreview = p/.test(src),
    'setConversionPreview: 换代前回收上一代预览缓存');
  assert(/applyConversion\([\s\S]*?this\.clearConversionPreviewCache\(\);[\s\S]*?this\.conversionPreview = null/.test(src),
    'applyConversion: 应用前回收预览缓存');
  assert(/closeConversion\(\) \{ this\.clearConversionPreviewCache\(\); this\.conversionDialog = null; this\.conversionPreview = null;/.test(src),
    'closeConversion: 关闭时回收预览缓存');
  assert(/v399/.test(src), 'v399 版本注释');
}

section('renderer/sliderPath: 缓存按 id 键控 (根因前提)');
{
  const sp = readSrc('src/osu/sliderPath.ts');
  const rd = readSrc('src/osu/renderer.ts');
  assert(/pathCache/.test(sp), 'sliderPath.ts 存在 pathCache');
  assert(/bodyCache|outlineCache/.test(rd), 'renderer.ts 存在滑条身/描边贴图缓存');
}

if (failures) { console.error(`V399 FAILED (${failures})`); process.exit(1); }
console.log('V399 ALL PASSED');
