// v296: 曲库屏蔽全局星数计算 + 修索引途中选中/滚动问题
// 背景: runStarQueue 全库 parseOsu+computeStarRating 太慢; 且星级就地写回经 starProg 依赖
//   每張触发整表重过滤/重排/重渲染。另有索引途中的两个选中问题:
//   1) 选中占位条目 (key='dir/') 后该目录被索引 → 占位剔除 → 选中凭空消失
//   2) 初始定位当前谱面后, 后续批次插入/剔除行使选中行被挤出屏幕
// 处理: 移除 runStarQueue 调用/starProg 状态/头部进度 (libraryIndex.ts 导出保留, v290 断言);
//   占位选中迁移到该目录第一个真实难度; 索引途中持续跟随选中项 (用户手动滚动/点击脱离)。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sl = readFileSync(join(root, 'src/components/SongLibrary.tsx'), 'utf8');
const li = readFileSync(join(root, 'src/osu/libraryIndex.ts'), 'utf8');

let fails = 0;
const check = (name, cond) => { if (!cond) { fails++; console.error('FAIL:', name); } };

// 星数队列屏蔽
check('SongLibrary 不再 import runStarQueue', !/import[^;]*runStarQueue/.test(sl));
check('SongLibrary 无 starProg 状态', !sl.includes('useState<{ done: number; total: number }'));
check('SongLibrary 无 runStarQueue 调用', !/runStarQueue\(/.test(sl));
check('libraryIndex.ts 仍导出 runStarQueue (v290 断言保留)',
  /export async function runStarQueue/.test(li));

// v299: 占位选中迁移已废弃 — 骨架条目 (文件名解析) 与索引后条目同 key, 选中不再消失;
// 索引期间也不再跟随滚动 (行位置不漂移), 定位恢复一次性
check('v299: 占位选中迁移移除 (骨架同 key, 无需迁移)', !/sk\.endsWith\('\/'\)/.test(sl));
check('v299: 定位一次性消费 scrollToSelRef (索引期间不自动滚动)',
  /if \(idx < 0\) return;\s*scrollToSelRef\.current = false/.test(sl) && !/if \(!indexing\) scrollToSelRef/.test(sl));
check('程序滚动标记 programmaticScrollRef', sl.includes('programmaticScrollRef'));
check('onScroll 区分程序/用户滚动 (用户滚动才取消定位)',
  /if \(programmaticScrollRef\.current\) programmaticScrollRef\.current = false;\s*else scrollToSelRef\.current = false/.test(sl));

if (fails) { console.error(`v296: ${fails} check(s) failed`); process.exit(1); }
console.log('v296: all checks passed');
