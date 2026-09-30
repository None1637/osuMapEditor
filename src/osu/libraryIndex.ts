// v290: 难度级元数据索引 — 轻量解析全曲库 .osu → 可搜索的扁平条目
//   parseIndexEntry     轻解析 (不做完整 parseOsu): 元数据/难度/标签/ID + 众数 BPM + 时长
//   buildLibraryIndex   逐目录枚举逐文件轻解析, 50 文件/批 yield 让出主线程;
//                       传入缓存即增量 reconcile (size+lastModified 比对, 新增/变更才重解析, 删除项剔除)
//   runStarQueue        后台星级队列: 仅 mode=0 且无 star 的条目, 每个 macrotask 算 1 张, 节流落库
// IndexedDB 持久化在 library.ts (DB_VERSION 3, store 'libraryIndex', key=rootName)
import { parseOsu } from './parser';
import { computeStarRating } from './starRating';
import type { FsDirLike, FsFileLike } from './library'; // type-only: 避免拉入 renderer 依赖链

export interface LibraryIndexEntry {
  dirName: string;
  fileName: string;
  title: string;
  titleUnicode: string;
  artist: string;
  artistUnicode: string;
  creator: string;
  version: string;
  mode: number;
  tags: string;
  source: string;
  beatmapID: string;
  beatmapSetID: string;
  hp: number;
  cs: number;
  od: number;
  ar: number;
  bpm: number;
  lengthMs: number;
  star: number | null;      // 仅 osu!standard 后台计算; 未算/非 std 为 null
  size: number;             // 增量比对用
  lastModified: number;     // 增量比对用
  /** v299: 文件名骨架条目 (纯枚举得到, 未读文件内容) — 条件搜索排除/详细参数待索引;
   *  key (dirName/fileName) 与索引后的真实条目一致, 升级不换 key */
  partial?: boolean;
}

// v290: 限定 section 内逐键提取 (parseQuickMetadata 风格扩展)
function sectionOf(text: string, name: string): string {
  const head = text.match(new RegExp(`^\\[${name}\\]\\s*$`, 'mi'));
  if (!head || head.index == null) return '';
  const rest = text.slice(head.index + head[0].length);
  const next = rest.search(/^\[/m); // 下一个 section 头为界
  return next >= 0 ? rest.slice(0, next) : rest;
}

function getKey(section: string, k: string): string {
  return section.match(new RegExp(`^${k}:(.*)$`, 'm'))?.[1]?.trim() ?? '';
}

/** v290: 轻量解析单个 .osu → 索引条目 (损坏文件抛错由调用方跳过) */
export function parseIndexEntry(text: string, dirName: string, fileName: string, size = 0, lastModified = 0): LibraryIndexEntry {
  const meta = sectionOf(text, 'Metadata');
  const diff = sectionOf(text, 'Difficulty');
  const num = (s: string, dflt: number) => { const v = parseFloat(s); return Number.isFinite(v) ? v : dflt; };

  const od = num(getKey(diff, 'OverallDifficulty'), 5);
  // BPM: 扫 [TimingPoints] 非继承点 (beatLength>0), 取出现次数最多的 beatLength 换算 (lazer BPM 口径);
  // 无非继承点回退第一个正值
  let bpm = 0;
  const tp = sectionOf(text, 'TimingPoints');
  const counts = new Map<number, number>();
  let firstPositive = 0;
  for (const line of tp.split('\n')) {
    const bl = parseFloat(line.split(',')[1] ?? '');
    if (!(bl > 0)) continue;
    if (!firstPositive) firstPositive = bl;
    counts.set(bl, (counts.get(bl) ?? 0) + 1);
  }
  let bestBl = 0, bestN = 0;
  for (const [bl, n] of counts) if (n > bestN) { bestN = n; bestBl = bl; }
  if (!bestBl) bestBl = firstPositive;
  if (bestBl > 0) bpm = 60000 / bestBl;

  // lengthMs: 首/尾物件时间差 (spinner 取第 6 字段 end time; 滑条只算起点 → 长滑条谱偏短,
  // 与 lazer drain length 有差异, 近似值够用; 如需精确可后续用完整 parse 补)
  let lengthMs = 0;
  const ho = sectionOf(text, 'HitObjects');
  const lines = ho.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
  if (lines.length) {
    const t0 = parseInt(lines[0]!.split(',')[2] ?? '0') || 0;
    const lastFields = lines[lines.length - 1]!.split(',');
    let t1 = parseInt(lastFields[2] ?? '0') || 0;
    const end = parseInt(lastFields[5] ?? ''); // spinner end time (非 spinner 该字段不是时间, 仅 >t1 时采纳)
    if (Number.isFinite(end) && end > t1 && lastFields.length <= 7) t1 = end;
    lengthMs = Math.max(0, t1 - t0);
  }

  return {
    dirName, fileName,
    title: getKey(meta, 'Title'),
    titleUnicode: getKey(meta, 'TitleUnicode'),
    artist: getKey(meta, 'Artist'),
    artistUnicode: getKey(meta, 'ArtistUnicode'),
    creator: getKey(meta, 'Creator'),
    version: getKey(meta, 'Version'),
    mode: parseInt(getKey(sectionOf(text, 'General'), 'Mode') || '0') || 0,
    tags: getKey(meta, 'Tags'),
    source: getKey(meta, 'Source'),
    beatmapID: getKey(meta, 'BeatmapID') || '0',
    beatmapSetID: getKey(meta, 'BeatmapSetID') || '-1',
    hp: num(getKey(diff, 'HPDrainRate'), 5),
    cs: num(getKey(diff, 'CircleSize'), 4),
    od,
    ar: num(getKey(diff, 'ApproachRate'), od), // AR 缺省 = OD (osu! 惯例)
    bpm,
    lengthMs,
    star: null,
    size, lastModified,
  };
}

/**
 * v299: .osu 文件名 → 骨架条目 (osu! 命名约定: "Artist - Title (Creator) [Version].osu",
 * 各段均可缺)。纯字符串解析, 不读文件 — 索引前先按此显示完整难度列表,
 * 索引完成后同 key 升级为完整条目 (行外观/选中/滚动位置全程不变)。
 */
export function difficultyFromFileName(dirName: string, fileName: string): LibraryIndexEntry {
  const base = fileName.replace(/\.osu$/i, '');
  const m = base.match(/^(.*?)\s+-\s+(.*?)\s*\((.*?)\)\s*\[(.*?)\]\s*$/);
  return {
    dirName, fileName,
    title: m?.[2] ?? base, titleUnicode: '',
    artist: m?.[1] ?? '', artistUnicode: '',
    creator: m?.[3] ?? '', version: m?.[4] ?? '',
    mode: 0, tags: '', source: '',
    beatmapID: '0', beatmapSetID: dirName.match(/^(\d+)\s+/)?.[1] ?? '-1',
    hp: 0, cs: 0, od: 0, ar: 0, bpm: 0, lengthMs: 0, star: null,
    size: 0, lastModified: 0, partial: true,
  };
}

/**
 * v299: 骨架枚举 — 按目录纯枚举 .osu 文件名 (零 getFile/读文本), 每目录一批 yield。
 * dirs 为调用方已枚举的顶层目录表; prio 回调同 buildLibraryIndex (每目录前取最新值)。
 */
export async function* enumerateDifficultySkeletons(
  dirs: { name: string; handle: FsDirLike }[],
  isCancelled: () => boolean,
  prio?: () => string | null,
): AsyncGenerator<LibraryIndexEntry[]> {
  const rest = [...dirs];
  while (rest.length) {
    if (isCancelled()) return;
    let idx = 0;
    const prioName = prio?.();
    if (prioName) {
      const p = rest.findIndex(d => d.name === prioName);
      if (p >= 0) idx = p;
    }
    const [d] = rest.splice(idx, 1);
    const out: LibraryIndexEntry[] = [];
    for await (const [name, f] of d!.handle.entries()) {
      if (isCancelled()) return;
      if (f.kind === 'file' && name.toLowerCase().endsWith('.osu')) out.push(difficultyFromFileName(d!.name, name));
    }
    if (out.length) yield out;
    await new Promise(r => setTimeout(r)); // 让出主线程 (服务器直读模式每目录一次 HTTP)
  }
}

/**
 * v291: 目录名 → 占位条目 (索引建立前先按旧方式显示全部歌曲; fileName='' 标记占位,
 * 不入 IDB/会话缓存 — 扫描完成时剩余占位被剔除)。osu! 目录命名: "setid Artist - Title" (均可缺)
 */
export function placeholderFromDirName(dirName: string): LibraryIndexEntry {
  let rest = dirName;
  let setId = '';
  const mId = rest.match(/^(\d+)\s+/);
  if (mId) { setId = mId[1]!; rest = rest.slice(mId[0].length); }
  const dash = rest.indexOf(' - ');
  const artist = dash >= 0 ? rest.slice(0, dash) : '';
  const title = dash >= 0 ? rest.slice(dash + 3) : rest;
  return {
    dirName, fileName: '', title, titleUnicode: '', artist, artistUnicode: '',
    creator: '', version: '', mode: 0, tags: '', source: '',
    beatmapID: '0', beatmapSetID: setId || '-1',
    hp: 0, cs: 0, od: 0, ar: 0, bpm: 0, lengthMs: 0, star: null, size: 0, lastModified: 0,
  };
}

/** v297: 索引扫描选项 */
export interface IndexScanOpts {
  /** 信任文件名集合: 目录内 .osu 文件名集合与缓存一致即整体复用该目录缓存条目,
   *  完全不 getFile() stat (自动后台 reconcile 用; 同名内容变更检测不到,
   *  手动「重新扫描」传 false 做逐文件 size+lastModified 彻底校验) */
  trustNames?: boolean;
}

/**
 * v290: 构建索引 (async generator, 按 50 文件/批 yield 让出主线程)。
 * 传入 cached 即增量 reconcile: 只读 size+lastModified 比对, 未变更直接复用缓存条目 (保留已算 star),
 * 新增/变更才读文本重解析; 缓存里已删除的文件自然剔除; 完成由调用方写回 IDB。
 * v293: prio 回调返回当前应优先索引的目录名 (曲库选中项; 每目录前取最新值,
 * 用户在索引途中改选也生效), 已处理目录不重复。
 * v297: opts.trustNames 快路径 — 目录文件名集合与缓存一致即整体复用, 跳过全部 getFile()。
 */
export async function* buildLibraryIndex(
  root: FsDirLike,
  cached: LibraryIndexEntry[] | null,
  onProgress: ((done: number) => void) | null,
  isCancelled: () => boolean,
  prio?: () => string | null, // v293
  opts?: IndexScanOpts, // v297
): AsyncGenerator<LibraryIndexEntry[]> {
  const cacheMap = new Map<string, LibraryIndexEntry>();
  // v297: 目录 → 缓存条目组 (trustNames 快路径比对用)
  const cacheByDir = new Map<string, { names: Set<string>; entries: LibraryIndexEntry[] }>();
  for (const e of cached ?? []) {
    cacheMap.set(`${e.dirName}/${e.fileName}`, e);
    let g = cacheByDir.get(e.dirName);
    if (!g) { g = { names: new Set(), entries: [] }; cacheByDir.set(e.dirName, g); }
    g.names.add(e.fileName); g.entries.push(e);
  }
  let batch: LibraryIndexEntry[] = [];
  let done = 0;

  // v293: 先收集目录表 (仅名称/句柄, 不读文件), 支持优先目录插队
  const dirs: [string, FsDirLike][] = [];
  for await (const [dirName, child] of root.entries()) {
    if (isCancelled()) return;
    if (child.kind === 'directory') dirs.push([dirName, child as FsDirLike]);
  }

  const scanDir = async function* (dirName: string, dir: FsDirLike): AsyncGenerator<LibraryIndexEntry[]> {
    // v297: trustNames 快路径 — 仅枚举文件名 (entries() 不落盘 stat), 与缓存集合一致即整目录复用
    if (opts?.trustNames && cached) {
      const names: string[] = [];
      for await (const [name, f] of dir.entries()) {
        if (isCancelled()) return;
        if (f.kind === 'file' && name.toLowerCase().endsWith('.osu')) names.push(name);
      }
      const g = cacheByDir.get(dirName);
      if (g && g.names.size === names.length && names.every(n => g.names.has(n))) {
        batch.push(...g.entries);
        done += g.entries.length;
        onProgress?.(done);
        if (batch.length >= 50) {
          yield batch;
          batch = [];
          await new Promise(r => setTimeout(r));
        }
        return; // 集合不一致则落入下方慢路径 (重新枚举句柄, 逐文件 stat)
      }
    }
    for await (const [name, f] of dir.entries()) {
      if (isCancelled()) return;
      if (f.kind !== 'file' || !name.toLowerCase().endsWith('.osu')) continue;
      try {
        const file = await (f as FsFileLike).getFile();
        const key = `${dirName}/${name}`;
        const hit = cacheMap.get(key);
        if (hit && hit.size === file.size && hit.lastModified === file.lastModified) {
          batch.push(hit); // 未变更: 直接复用 (含已算星级)
        } else {
          const e = parseIndexEntry(await file.text(), dirName, name, file.size, file.lastModified);
          if (hit?.star != null && hit.mode === 0 && e.mode === 0) e.star = null; // 内容变更, 星级待重算
          batch.push(e);
        }
      } catch { /* 跳过损坏文件 */ }
      done++;
      onProgress?.(done);
      if (batch.length >= 50) {
        yield batch;
        batch = [];
        await new Promise(r => setTimeout(r)); // 让出主线程
      }
    }
  };

  while (dirs.length) {
    if (isCancelled()) return;
    let idx = 0;
    const prioName = prio?.(); // v293: 优先目录插队 (每目录前取最新值)
    if (prioName) {
      const p = dirs.findIndex(([n]) => n === prioName);
      if (p >= 0) idx = p;
    }
    const [[dirName, dir]] = dirs.splice(idx, 1);
    yield* scanDir(dirName!, dir!);
  }
  if (batch.length) yield batch;
}

/**
 * v290: 后台星级队列 — 仅 mode=0 且无 star 的条目入队; 每个 macrotask 算 1 张
 * (parseOsu 全文 + computeStarRating), 算完写回条目 + onTick; 每 20 张经 onFlush 节流落 IDB, 结束时落一次。
 * 切换目录/重扫时经 isCancelled 中断 (新扫描重启队列)。
 */
export async function runStarQueue(
  entries: LibraryIndexEntry[],
  readText: (e: LibraryIndexEntry) => Promise<string | null>,
  onTick: (done: number, total: number) => void,
  isCancelled: () => boolean,
  onFlush: (() => void) | null,
): Promise<void> {
  const queue = entries.filter(e => e.mode === 0 && e.star == null);
  const total = queue.length;
  if (!total) return;
  let done = 0, sinceFlush = 0;
  onTick(0, total);
  for (const e of queue) {
    if (isCancelled()) return;
    try {
      const text = await readText(e);
      if (text != null) e.star = computeStarRating(parseOsu(text));
      else e.star = null;
    } catch { e.star = null; /* 解析失败不留假数据, 下轮重试 */ }
    done++; sinceFlush++;
    onTick(done, total);
    if (sinceFlush >= 20) { // 节流落库 (每 20 张)
      sinceFlush = 0;
      onFlush?.();
    }
    await new Promise(r => setTimeout(r)); // 每个 macrotask 1 张
  }
  onFlush?.();
}

/**
 * v297: Worker 版全库索引入口 — 枚举/读文件/轻解析全部移出主线程
 * (FileSystemDirectoryHandle 可结构化克隆 postMessage 给 worker, worker 内直接复用
 *  buildLibraryIndex; 主线程只收批次结果, 索引期间界面不掉帧)。
 * native 为空 (服务器直读模式) 或 Worker 创建失败时回退主线程 generator。
 * prio 以批粒度推送最新值给 worker; isCancelled 命中即 terminate。
 */
export async function* buildLibraryIndexAuto(
  root: FsDirLike,
  native: FileSystemDirectoryHandle | null,
  cached: LibraryIndexEntry[] | null,
  onProgress: ((done: number) => void) | null,
  isCancelled: () => boolean,
  prio?: () => string | null,
  opts?: IndexScanOpts,
): AsyncGenerator<LibraryIndexEntry[]> {
  if (!native || typeof Worker === 'undefined') {
    yield* buildLibraryIndex(root, cached, onProgress, isCancelled, prio, opts);
    return;
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL('./libraryIndex.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    yield* buildLibraryIndex(root, cached, onProgress, isCancelled, prio, opts);
    return;
  }
  interface WMsg { type: string; entries?: LibraryIndexEntry[]; message?: string }
  const inbox: WMsg[] = [];
  let wake: (() => void) | null = null;
  let failed: string | null = null;
  worker.onmessage = (ev: MessageEvent<WMsg>) => { inbox.push(ev.data); wake?.(); };
  worker.onerror = (e) => { failed = e.message || '索引 worker 错误'; wake?.(); };
  worker.postMessage({ type: 'scan', root: native, cached, opts: opts ?? null });
  let lastPrio: string | null | undefined;
  try {
    for (;;) {
      if (isCancelled()) break;
      const p = prio?.() ?? null;
      if (p !== lastPrio) { lastPrio = p; worker.postMessage({ type: 'prio', name: p }); }
      while (inbox.length) {
        const m = inbox.shift()!;
        if (m.type === 'batch' && m.entries?.length) yield m.entries;
        else if (m.type === 'error') throw new Error(m.message ?? '索引 worker 失败');
        else if (m.type === 'done') return;
      }
      if (failed) throw new Error(failed);
      // 500ms 兜底唤醒: 无消息期间也能周期检查 isCancelled/prio
      await new Promise<void>(r => { wake = r; setTimeout(r, 500); });
      wake = null;
    }
  } finally {
    worker.terminate();
  }
}
