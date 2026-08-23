// 验证器 v198: 播放中滚轮 seek — 旧区间已预排程的 hitsound voice 全部停掉 (对齐 lazer seek 期间静音)
// 运行: node verifier/v198/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store.ts: seekWhilePlaying 停 voice');
{
  const src = readSrc('src/osu/store.ts');
  // resync 之前先 stopAllHitVoices, 否则 lookahead 内已 schedule 的旧区间音效照原时刻补响
  assert(/this\.stopAllHitVoices\(\);[^\n]*\n[^\n]*this\.scheduler\?\.resync\(\);/.test(src),
    'seekWhilePlaying 在 resync 前 stopAllHitVoices');
  assert(/v198: hitsound voices 全停/.test(src), 'v198 注释存在');
}

section('store.ts: stopAllHitVoices 定义 (v122)');
{
  const src = readSrc('src/osu/store.ts');
  assert(/private stopAllHitVoices\(\) \{[\s\S]{0,120}voiceLimiter\.drain\(\)/.test(src), 'stopAllHitVoices drain 全部 voice');
}

if (failures) { console.error(`V198 FAILED: ${failures}`); process.exit(1); }
console.log('V198 ALL PASSED');
