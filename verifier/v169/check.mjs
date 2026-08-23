// 验证器 v169: 谱面信息拆两个 Label — 名称 (艺术家-歌曲名[难度名]) 与数据 (CS/AR/物件数/★星数)
// v184 适配: 位置从游玩区左下角移到页签栏 (song setup 左侧, flex-1 居中); 顺序改 名称(左) → 数据(右)
// 运行: node verifier/v169/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('App.tsx: 两个 Label 拆分 (v184: 页签栏 song setup 左侧, 名称左 / 数据右)');
{
  const src = readSrc('src/App.tsx');
  assert(/flex-1 flex items-center justify-center gap-2 min-w-0 pointer-events-none/.test(src),
    '容器: 页签栏 flex-1 居中 (song setup 左侧)');
  assert(/CS\{bm\.difficulty\.cs\} AR\{bm\.difficulty\.ar\} · \{bm\.hitObjects\.length\} 物件/.test(src),
    '数据 Label: CS/AR/物件数');
  // v184: 顺序 = 名称 Label(左) → 数据 Label(右, CS/AR/物件数 → ★星数)
  const nameIdx = src.indexOf('{bm.metadata.artist} - {bm.metadata.title}');
  const statsIdx = src.indexOf('{bm.hitObjects.length} 物件');
  const starIdx = src.indexOf('starRating.toFixed(2)'); // v181: ★${...} → lucide Star + toFixed(2)
  assert(nameIdx > -1 && statsIdx > nameIdx && starIdx > statsIdx, '顺序: 艺术家-歌曲名 (左) → 物件数 → ★星数 (右)');
  // 名称 Label 不含 CS/AR/物件数
  const nameLine = src.slice(nameIdx, nameIdx + 120);
  assert(!/CS\{|物件/.test(nameLine), '名称 Label 纯名称 (不含 CS/AR/物件数)');
  // 指示器与保存反馈保留在名称 Label
  assert(/data-dirty-indicator/.test(src) && src.indexOf('data-dirty-indicator') < nameIdx,
    '[● 未保存] 指示器在名称前 (v181: ⚪ → CSS 圆点)');
  assert(/data-save-message/.test(src), '保存反馈 data-save-message 保留');
  assert(/max-w-\[28rem\]/.test(src), '长名称截断上限保留 (名称 Label)');
}

console.log(failures ? `\nV169 FAILED: ${failures}` : '\nV169 ALL PASSED');
process.exit(failures ? 1 : 0);
