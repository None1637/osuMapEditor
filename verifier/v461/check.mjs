// 验证器 v461: 删除旧的保存成功反馈 (页签栏谱面信息变绿 + [已保存]/[已导出] 前缀)
// 需求: 成功反馈已由 v460 stable 风中央「地图已保存」横条取代, 旧绿字代码去掉。
// 范围: store.save() 成功路径不再写 saveMessage / 不再起 2.6s 清除定时器; 词典键
//   store.save_saved / store.save_exported 删除。保留: 失败红字 (save_failed) 与
//   B4 转换等 saveMessage 提示 (App.tsx 展示逻辑不动), lastSave 测试挂钩不动。
// 运行: cd app && node verifier/v461/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let failures = 0;
const assert = (cond, msg) => { if (cond) console.log(`  ok - ${msg}`); else { console.error(`  FAIL - ${msg}`); failures++; } };
const section = (s) => console.log(`== ${s}`);

section('store.ts: save() 成功路径不再写 saveMessage');
{
  const src = read('src/osu/store.ts');
  const save = src.match(/async save\(\): Promise<boolean> \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(save.length > 0, 'save() 存在');
  const tryPart = save.slice(0, save.indexOf('} catch'));
  const catchPart = save.slice(save.indexOf('} catch'));
  assert(!/saveMessage\s*=/.test(tryPart), '成功路径无 saveMessage 赋值');
  assert(!/setTimeout/.test(tryPart), '成功路径无 2.6s 清除定时器 (v461 一并删除)');
  assert(/this\.saveFlashSeq\+\+/.test(tryPart), 'v460 中央横条触发保留');
  assert(/this\.lastSave = r/.test(tryPart), 'lastSave 测试挂钩保留');
  assert(/saveMessage = tNow\('store\.save_failed'/.test(catchPart), '失败红字反馈保留');
  assert(/setTimeout/.test(catchPart), '失败反馈 2.6s 自动清除保留');
}

section('词典: 已保存/已导出 译文键删除');
{
  const dict = read('src/i18n/dicts/zh-CN/backend.ts');
  assert(!/'store\.save_saved'/.test(dict) && !/'store\.save_exported'/.test(dict), 'store.save_saved/save_exported 已删');
  assert(/'store\.save_failed': '保存失败/.test(dict), 'save_failed 译文保留');
  // 全 src 无残留引用
  const grep = (dir) => {
    const out = [];
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) out.push(...grep(p));
      else if (/\.(ts|tsx)$/.test(f.name)) {
        const c = fs.readFileSync(p, 'utf8');
        if (/store\.save_saved|store\.save_exported/.test(c)) out.push(p);
      }
    }
    return out;
  };
  const refs = grep(path.join(root, 'src'));
  assert(refs.length === 0, `src 无残留引用 (实际 ${refs.join(', ') || '无'})`);
}

section('App.tsx: saveMessage 展示逻辑保留 (失败红字 / B4 转换提示仍可用)');
{
  const src = read('src/App.tsx');
  assert(/store\.saveMessage\.startsWith\(t\('app\.save_failed'/.test(src), '失败红字判定保留');
  assert(/data-save-message/.test(src), 'data-save-message 属性保留 (失败/B4 提示仍挂)');
  assert(/store\.saveMessage && <b>/.test(src), '消息前缀渲染保留');
}

section('SavedFlash.tsx: 中央横条带测试钩子');
{
  const src = read('src/components/SavedFlash.tsx');
  assert(/data-saved-flash/.test(src), 'data-saved-flash 属性 (v461 CDP 断言用)');
}

if (failures) { console.error(`V461 FAILED: ${failures}`); process.exit(1); }
console.log('V461 ALL PASSED');
