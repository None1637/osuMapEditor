// v299: 曲库索引期可用性 — 文件名骨架列表 + 去自动滚动 + 行外观统一
// 用户反馈: 索引期间还是用不了 / 索引时不要自动滚动 / 谱面不要显示「索引中」/
//           索引前也该显示难度名 / 索引前后左侧表现基本相同。
// 方案: 无缓存时 Pass A 纯枚举 .osu 文件名 (零 getFile/读文本), 按 osu! 命名约定
//   "Artist - Title (Creator) [Version].osu" 解析出完整行信息 (difficultyFromFileName,
//   partial 标记); key = dirName/fileName 与索引后真实条目一致 → Pass B 全解析同 key
//   就地升级, 不换 key → 选中不丢/行不跳/外观不变; 定位回归一次性 (索引期间不滚动)。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const li = readFileSync(join(root, 'src/osu/libraryIndex.ts'), 'utf8');
const sl = readFileSync(join(root, 'src/components/SongLibrary.tsx'), 'utf8');

let fails = 0;
const check = (name, cond) => { if (!cond) { fails++; console.error('FAIL:', name); } };

// libraryIndex: 骨架
check('LibraryIndexEntry.partial 可选字段', /partial\?:\s*boolean/.test(li));
check('difficultyFromFileName 按 osu 命名约定解析 (Artist - Title (Creator) [Version])',
  /export function difficultyFromFileName/.test(li)
  && li.includes('base.match(/^(.*?)\\s+-\\s+(.*?)\\s*\\((.*?)\\)\\s*\\[(.*?)\\]')
  && /partial: true/.test(li));
check('enumerateDifficultySkeletons 纯枚举 (无 getFile) + prio + 让出主线程',
  /export async function\* enumerateDifficultySkeletons/.test(li)
  && !/enumerateDifficultySkeletons[\s\S]{0,900}getFile\(\)/.test(li)
  && /enumerateDifficultySkeletons[\s\S]{0,900}prio/.test(li));

// SongLibrary: 两阶段扫描
check('Pass A 骨架先行 (无缓存分支)',
  /enumerateDifficultySkeletons\(ds,/.test(sl));
check('Pass B 同 key 就地升级 (idxByKey)',
  /idxByKey\.get\(entryKey\(e\)\)/.test(sl) && /all\[i\] = e/.test(sl));
check('落库剔除骨架 (partial 不入 IDB)',
  /idbLibraryIndexPut\(h\.name, all\.filter\(e => !e\.partial\)\)/.test(sl));

// 选中/滚动
check('无占位迁移残留 (v296 机制废弃)', !/sk\.endsWith\('\/'\)/.test(sl));
check('定位一次性 (索引期间不自动滚动)',
  /if \(idx < 0\) return;\s*scrollToSelRef\.current = false/.test(sl) && !/!indexing\) scrollToSelRef/.test(sl));

// 行外观统一
check('行渲染无「索引中…」占位样式', !sl.includes('索引中…</span>'));
check('行渲染统一 (无 pending 分支)', !/const pending = e\.fileName === ''/.test(sl));
check('条件搜索排除骨架 (partial)', /queryHasConds && e\.partial/.test(sl));
check('详情面板骨架分支 (partial)', /selEntry\.partial \? \(/.test(sl));

if (fails) { console.error(`v299: ${fails} check(s) failed`); process.exit(1); }
console.log('v299: all checks passed');
