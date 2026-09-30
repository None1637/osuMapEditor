// v297: 曲库索引提速 — Worker 化 + trustNames 快路径 + UI 节流
// 方案 A+B (用户选定):
//   A) 秒开 + 后台索引: IDB 缓存立即显示; 后台 reconcile 走 trustNames 快路径
//      (目录文件名集合与缓存一致即整目录复用, 跳过全部 getFile() stat);
//      手动「重新扫描」传 thorough=true 做逐文件 size+lastModified 彻底校验;
//      索引批次 UI 更新节流到 250ms (消除每 50 文件整表拷贝+重渲染的风暴)。
//   B) Web Worker: FileSystemDirectoryHandle 结构化克隆给 worker, 枚举/读文件/解析
//      全部移出主线程 (libraryIndex.worker.ts 内直接复用 buildLibraryIndex);
//      服务器直读模式 (无 native 句柄) / Worker 不可用时回退主线程 generator。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const li = readFileSync(join(root, 'src/osu/libraryIndex.ts'), 'utf8');
const wk = readFileSync(join(root, 'src/osu/libraryIndex.worker.ts'), 'utf8');
const sl = readFileSync(join(root, 'src/components/SongLibrary.tsx'), 'utf8');

let fails = 0;
const check = (name, cond) => { if (!cond) { fails++; console.error('FAIL:', name); } };

// libraryIndex: trustNames 快路径
check('IndexScanOpts.trustNames 选项', /interface IndexScanOpts[\s\S]{0,300}trustNames\?:\s*boolean/.test(li));
check('buildLibraryIndex 接受 opts 参数', /prio\?: \(\) => string \| null,\s*\/\/ v293\s*opts\?: IndexScanOpts/.test(li));
check('trustNames 快路径: 文件名集合一致即整目录复用',
  /opts\?\.trustNames && cached[\s\S]{0,600}names\.every\(n => g\.names\.has\(n\)\)[\s\S]{0,200}batch\.push\(\.\.\.g\.entries\)/.test(li));

// worker 入口
check('buildLibraryIndexAuto 导出 + Worker 创建',
  /export async function\* buildLibraryIndexAuto/.test(li) && /new Worker\(new URL\('\.\/libraryIndex\.worker\.ts', import\.meta\.url\)/.test(li));
check('无 native/Worker 回退主线程 generator',
  /if \(!native \|\| typeof Worker === 'undefined'\)[\s\S]{0,200}yield\* buildLibraryIndex\(root/.test(li));
check('worker 取消 terminate + prio 批粒度推送',
  /worker\.terminate\(\)/.test(li) && /worker\.postMessage\(\{ type: 'prio', name: p \}\)/.test(li));

// worker 文件
check('worker: scan/prio/cancel 协议 + buildLibraryIndex 复用',
  /m\?\.type === 'cancel'/.test(wk) && /m\?\.type === 'prio'/.test(wk) && /buildLibraryIndex\(m\.root/.test(wk));
check('worker: batch/done/error 回传',
  /type: 'batch', entries: batch/.test(wk) && /type: 'done'/.test(wk) && /type: 'error'/.test(wk));

// SongLibrary 接入
check('startScan 签名 (h, native, thorough)', /startScan = useCallback\(async \(h: FsDirLike, native: FileSystemDirectoryHandle \| null = null, thorough = false\)/.test(sl));
check('索引进 buildLibraryIndexAuto + trustNames: !thorough',
  /buildLibraryIndexAuto\(h, native, cached, null,[\s\S]{0,120}\{ trustNames: !thorough \}\)/.test(sl));
check('UI 节流: pendingRef + 250ms flush (v299: scheduleFlush 封装)',
  /pendingEntriesRef\.current = \[\.\.\.all\]/.test(sl) && /\}, 250\)/.test(sl));
check('终态立即刷新 (v299: flushNow 清定时器 + setEntries)',
  /flushNow = \(list[\s\S]{0,150}clearTimeout\(flushTimerRef\.current\)[\s\S]{0,150}setEntries\(list\)/.test(sl) && /flushNow\(\[\.\.\.all\]\)/.test(sl));
check('手动重新扫描传 thorough=true', /startScan\(root, rootNative, true\)/.test(sl));
check('服务器模式传 native=null 回退', /startScan\(dir, null\)/.test(sl));

if (fails) { console.error(`v297: ${fails} check(s) failed`); process.exit(1); }
console.log('v297: all checks passed');
