// 验证器 v460: stable 风「地图已保存」中央横条 (SavedFlash)
// 需求: Ctrl+S 后弹出屏幕中央横条黑底「地图已保存」; 动画 = 黑底从中间向上下迅速扩大
//   (scaleY 0.5 → 1.1 过冲 → 回到 1.0, 约 0.1s), 停留后淡出; 悬浮于所有控件之上。
// 实现: store.saveFlashSeq 保存成功自增 (快捷键/原生菜单 accelerator 都汇于 store.save) →
//   SavedFlash (App 外层, zoom 容器外) key 重挂载重播 CSS keyframes 动画。
// 运行: cd app && node verifier/v460/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let failures = 0;
const assert = (cond, msg) => { if (cond) console.log(`  ok - ${msg}`); else { console.error(`  FAIL - ${msg}`); failures++; } };
const section = (s) => console.log(`== ${s}`);

section('store.ts: saveFlashSeq 触发器');
{
  const src = read('src/osu/store.ts');
  assert(/saveFlashSeq = 0; \/\/ v460/.test(src), 'saveFlashSeq 字段 (v460 注记)');
  const save = src.match(/async save\(\): Promise<boolean> \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(save.length > 0, 'save() 存在');
  assert(/this\.saveFlashSeq\+\+; \/\/ v460/.test(save), '保存成功自增 saveFlashSeq');
  // 只在成功路径: catch 分支不得自增
  const catchPart = save.slice(save.indexOf('} catch'));
  assert(!/saveFlashSeq\+\+/.test(catchPart), '保存失败不触发横条');
}

section('SavedFlash.tsx: 中央横条组件');
{
  const src = read('src/components/SavedFlash.tsx');
  assert(/useEditor/.test(src) && /store\.saveFlashSeq/.test(src), '订阅 store.saveFlashSeq');
  assert(/fixed inset-0/.test(src) && /z-\[200\]/.test(src) && /pointer-events-none/.test(src), '全屏居中浮层, z 最高, 不挡点击');
  assert(/key=\{shownSeq\}/.test(src), 'key 重挂载 — 连续保存重播动画');
  assert(/w-full h-16 bg-black\/70/.test(src), '全宽横条黑底 (v476: 条高 h-14 → h-16 适配 28px 字号)');
  assert(/t\('app\.saved_flash', 'Map saved'\)/.test(src), '文案 i18n (zh-CN 地图已保存 / en Map saved)');
  // 动画: 0.5 → 1.1 过冲 → 1.0 在约 0.1s 内 (总时长 1600ms: 3.75%/6.25% 关键帧 ≈ 60ms/100ms)
  assert(/@keyframes saved-flash-bar/.test(src), 'keyframes 定义');
  assert(/0% \{ opacity: 0; transform: scaleY\(0\.5\); \}/.test(src), '起点: 一半高度');
  assert(/3\.75% \{ transform: scaleY\(1\.1\); \}/.test(src), '过冲 1.1 倍 (~60ms)');
  assert(/6\.25% \{ transform: scaleY\(1\); \}/.test(src), '回落 1 倍 (~100ms = 0.1s)');
  assert(/100% \{ opacity: 0;/.test(src), '末尾淡出');
  assert(/animation: `saved-flash-bar \$\{DURATION_MS\}ms linear both`/.test(src), '动画绑定');
}

section('App.tsx: 挂载 (zoom 容器外)');
{
  const src = read('src/App.tsx');
  assert(/import \{ SavedFlash \} from '@\/components\/SavedFlash';/.test(src), '导入 SavedFlash');
  const iFps = src.indexOf('{displaySettings.showFps && <FpsCounter />}');
  const iFlash = src.indexOf('<SavedFlash />');
  assert(iFps > 0 && iFlash > iFps, '挂在 FpsCounter 旁 (v217 zoom 容器外, 不随界面缩放)');
}

section('i18n: 文案键');
{
  const zhCN = read('src/i18n/dicts/zh-CN/app.ts');
  assert(/'app\.saved_flash': '地图已保存',/.test(zhCN), 'zh-CN 文案 (zh-TW 走 s2t 自动转换, en 走 t() 默认串)');
}

if (failures) { console.error(`V460 FAILED: ${failures}`); process.exit(1); }
console.log('V460 ALL PASSED');
