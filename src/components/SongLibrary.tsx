import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Star, TriangleAlert, X } from 'lucide-react'; // v181: 📁/⚠/✕/★ → lucide
import { store } from '../osu/store';
import { fetchServerDirs, serverDir } from '../osu/serverFs';
import {
  asDirLike, dirHandleFromDropEx, getDirBackgroundUrl,
  getLastPersistError, getLastRestoreReason, getRememberedSongsDir, idbLibraryIndexGet, idbLibraryIndexPut,
  idbSelfTest, isFileSystemAccessSupported, listDifficulties, loadDifficulty,
  persistSongsDirHandle, pickSongsDir, rememberSongsDir, requestReadPermission, restoreSongsDir, scanSongDirs,
  type FsDirLike,
} from '../osu/library';
import { buildLibraryIndexAuto, enumerateDifficultySkeletons, type LibraryIndexEntry } from '../osu/libraryIndex'; // v290/v297 (worker 索引)/v299 (文件名骨架); v296: runStarQueue 移除 (全局星数计算太慢, 已屏蔽)
import { matchLibraryEntry, parseLibraryQuery } from '../osu/librarySearch'; // v290

type DirEntry = { name: string; handle: FsDirLike };

const ROW_H = 44; // v290: 扁平难度行高(px, 两行), 虚拟化渲染用; v303: F01 基础字号增大 (34→44 容纳 text-sm+text-sm 两行)
const entryKey = (e: LibraryIndexEntry) => `${e.dirName}/${e.fileName}`;

// v290: 排序选项 (目录=默认, 难度数=目录内难度计数)
type SortBy = 'dir' | 'title' | 'artist' | 'creator' | 'bpm' | 'star' | 'length' | 'diffs';

// v128: 曲库会话缓存 — 第二次打开免重新扫描, 并记住上次位置 (滚动/搜索词/选中难度)。
// v290: 缓存结构换为索引条目 (扁平难度列表), 规则不变:
// 仅在用户显式刷新时失效: 「重新扫描」/「更换目录」/拖拽导入/授权后首扫 (都会走 startScan → 顶部清缓存);
// 扫描中途关闭面板不写缓存 (scanDone=false), 下次打开重扫, 避免把残缺列表当成完整结果。
interface LibraryCache {
  rootName: string;                    // 与恢复出的目录名一致才生效 (防换了 Songs 目录还用旧列表)
  entries: LibraryIndexEntry[];
  filter: string;
  selKey: string | null;
  scrollTop: number;
}
let libraryCache: LibraryCache | null = null;

export function SongLibrary({ onClose }: { onClose: () => void }) {
  const supported = isFileSystemAccessSupported();
  const [root, setRoot] = useState<FsDirLike | null>(null);
  const [rootNative, setRootNative] = useState<FileSystemDirectoryHandle | null>(null); // 仅授权流程用
  const [permNeeded, setPermNeeded] = useState(false);
  const [entries, setEntries] = useState<LibraryIndexEntry[]>(() => libraryCache?.entries ?? []);
  const [indexing, setIndexing] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [filter, setFilter] = useState(() => libraryCache?.filter ?? '');
  const [sortBy, setSortBy] = useState<SortBy>('dir');
  // v291: 默认选中当前编辑器打开的谱面 (索引渐进到达, 条目出现后由定位 effect 补滚动/背景)
  const curMapKey = (() => { const s = store.mapSource; return s ? `${s.dir.name}/${s.fileName}` : null; })();
  const [selKey, setSelKey] = useState<string | null>(() => curMapKey ?? libraryCache?.selKey ?? null);
  const [loadingBeatmap, setLoadingBeatmap] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [selBg, setSelBg] = useState<string | null>(null);
  // v296: starProg 状态已随全局星数队列一并移除
  const scanGenRef = useRef(0);
  const dirsRef = useRef<DirEntry[]>([]);            // 目录名 → 句柄 (打开难度/取背景用, 不入缓存)
  const selKeyRef = useRef<string | null>(curMapKey ?? libraryCache?.selKey ?? null); // 双击同行 openDiff 时 state 尚未落地, 用 ref
  const scrollToSelRef = useRef(!libraryCache);      // v291: 初次定位选中项后置 false (缓存恢复走旧滚动位置, 用户操作后不打扰)
  const programmaticScrollRef = useRef(false);       // v296: 程序 scrollTo 标记 (onScroll 里区分用户滚动, 避免误脱离跟随)
  const bgDirRef = useRef<string | null>(null);      // 当前背景所属目录 (同目录选中复用, 不重取)
  // v164: 记录 mousedown 是否落在遮罩本体上 — 修复搜索框内按下、拖选文本到窗外松开时
  // click 落到共同祖先(遮罩)而误关窗口: 只有按下+松开都在遮罩本体上才关闭
  const backdropDownRef = useRef(false);
  // v128: 扫描完成标记 — 扫完/缓存恢复才允许写会话缓存
  const scanDoneRef = useRef(!!libraryCache);

  // 诊断日志(面板底部可见, 用于定位不同浏览器环境下的问题)
  const [log, setLog] = useState<string[]>([]);
  const say = useCallback((s: string) => {
    console.log('[曲库]', s);
    setLog(prev => [...prev.slice(-6), new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' ' + s]);
  }, []);

  // 虚拟滚动状态; v128: 滚动位置初值取会话缓存 (记住上次位置)
  const listRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: libraryCache?.scrollTop ?? 0, height: 400 });

  // 目录句柄枚举 (仅一层目录名, 不读文件 — 供打开难度/取背景)
  const collectDirs = useCallback(async (h: FsDirLike, myGen: number): Promise<DirEntry[] | null> => {
    const out: DirEntry[] = [];
    for await (const d of scanSongDirs(h)) {
      if (scanGenRef.current !== myGen) return null; // 已被新扫描取代
      out.push(d);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, []);

  // v297: 索引 UI 节流 — worker 批次只更新 pendingRef, 至多每 250ms 刷一次 setEntries
  // (此前每 50 文件一批就整表拷贝+重渲染, 索引期间主线程被占满, 界面卡死)
  const pendingEntriesRef = useRef<LibraryIndexEntry[] | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // v290: 扫描 = 构建/增量校验难度索引, 边扫边显示 (按批 yield, 让出主线程)
  // v297: native 句柄直传 worker (枚举/读文件/解析全在 worker); thorough=true 逐文件 stat
  // 彻底校验 (手动「重新扫描」), 否则 trustNames 快路径 (文件名集合一致即整目录复用缓存)
  const startScan = useCallback(async (h: FsDirLike, native: FileSystemDirectoryHandle | null = null, thorough = false) => {
    const myGen = ++scanGenRef.current;
    libraryCache = null; // v128: 任何显式扫描 (重新扫描/换目录/拖拽/授权) 都使会话缓存失效
    scanDoneRef.current = false;
    // v297: 清掉上一次扫描遗留的节流 flush (防过期列表覆盖新扫描)
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    pendingEntriesRef.current = null;
    setIndexing(true); setScanError(null);
    setEntries([]);
    // v291: 重扫后选中回退到当前打开的谱面, 并重置自动定位 (条目出现后滚动到位)
    const ck = (() => { const s = store.mapSource; return s ? `${s.dir.name}/${s.fileName}` : null; })();
    setSelKey(ck); selKeyRef.current = ck; scrollToSelRef.current = true;
    say('开始扫描…');
    try {
      const ds = await collectDirs(h, myGen);
      if (ds === null) return;
      dirsRef.current = ds;
      // v290: 索引缓存立即可搜 → 后台 reconcile (只读 size+lastModified 比对, 新增/变更才重解析)
      let cached: LibraryIndexEntry[] | null = null;
      try { cached = await idbLibraryIndexGet<LibraryIndexEntry>(h.name); } catch { /* 无缓存/读取失败则全量 */ }
      if (scanGenRef.current !== myGen) return;
      // v293: 优先为当前选中的谱面建索引 (回调取最新选中, 索引途中改选立即插队)
      const prioDir = () => { const k = selKeyRef.current; return k ? k.slice(0, k.lastIndexOf('/')) : null; };
      // v297: 节流 flush (至多 250ms 一次)
      const scheduleFlush = () => {
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            if (pendingEntriesRef.current) { setEntries(pendingEntriesRef.current); pendingEntriesRef.current = null; }
          }, 250);
        }
      };
      const flushNow = (list: LibraryIndexEntry[]) => {
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
        pendingEntriesRef.current = null;
        setEntries(list);
      };
      const all: LibraryIndexEntry[] = [];
      if (cached?.length) {
        setEntries(cached);
        say(`已从索引缓存恢复 ${cached.length} 难度, 后台校验更新…`);
        for await (const batch of buildLibraryIndexAuto(h, native, cached, null, () => scanGenRef.current !== myGen, prioDir, { trustNames: !thorough })) {
          if (scanGenRef.current !== myGen) return;
          all.push(...batch);
          pendingEntriesRef.current = [...all];
          scheduleFlush();
        }
      } else {
        // v299: 无缓存 — Pass A 先纯枚举文件名出骨架列表 (Artist - Title (Creator) [Version]
        // 从文件名解析, 行外观/选中 key 与索引后完全一致,  selectable/openable);
        // Pass B 后台全解析, 同 key 就地升级为完整条目 (不换 key → 不丢选中/不跳行)
        const idxByKey = new Map<string, number>();
        for await (const batch of enumerateDifficultySkeletons(ds, () => scanGenRef.current !== myGen, prioDir)) {
          if (scanGenRef.current !== myGen) return;
          for (const e of batch) { idxByKey.set(entryKey(e), all.length); all.push(e); }
          pendingEntriesRef.current = [...all];
          scheduleFlush();
        }
        flushNow([...all]);
        say(`已列出 ${all.length} 个难度 (文件名解析), 后台解析详细参数…`);
        for await (const batch of buildLibraryIndexAuto(h, native, null, null, () => scanGenRef.current !== myGen, prioDir, { trustNames: false })) {
          if (scanGenRef.current !== myGen) return;
          for (const e of batch) {
            const i = idxByKey.get(entryKey(e));
            if (i != null) all[i] = e; else { idxByKey.set(entryKey(e), all.length); all.push(e); }
          }
          pendingEntriesRef.current = [...all];
          scheduleFlush();
        }
      }
      // v297: 终态立即刷新 (清节流定时器)
      flushNow([...all]);
      scanDoneRef.current = true; // v128: 扫描完成, 允许写会话缓存
      say(`索引完成: ${all.length} 难度 / ${dirsRef.current.length} 目录`);
      // v299: 落库剔除骨架 (partial size=0 会导致下轮 reconcile 重解析; 损坏文件的骨架不入库)
      try { await idbLibraryIndexPut(h.name, all.filter(e => !e.partial)); } catch { say('索引缓存写入失败 (不影响本次使用)'); }
      // v296: 全局星数队列 (v290 runStarQueue) 已屏蔽 — 全库 parseOsu+computeStarRating 太慢且
      // 每张某处写回触发整表重排重渲染, 选中/滚动全被打断; 已缓存的星数仍随索引 reconcile 保留显示
    } catch (e) {
      console.error('扫描 Songs 目录失败:', e);
      if (scanGenRef.current === myGen) {
        const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
        setScanError(msg);
        say('扫描出错: ' + msg);
      }
    } finally {
      if (scanGenRef.current === myGen) setIndexing(false);
    }
  }, [collectDirs, say]);

  // v290: 取选中难度所在目录的背景 (同目录复用; objectURL 不跨挂载, 缓存恢复后需重建)
  const fetchBg = useCallback((dirName: string) => {
    if (bgDirRef.current === dirName) return;
    bgDirRef.current = dirName;
    const d = dirsRef.current.find(x => x.name === dirName);
    if (!d) { setSelBg(null); return; }
    getDirBackgroundUrl(d.handle).then(url => setSelBg(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    })).catch(() => setSelBg(null)); // 无背景则留空
  }, []);

  const selectEntry = useCallback((e: LibraryIndexEntry) => {
    scrollToSelRef.current = false; // v291: 用户手动选中后不再自动定位
    selKeyRef.current = entryKey(e);
    setSelKey(entryKey(e));
    fetchBg(e.dirName);
  }, [fetchBg]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 会话内记忆优先 (含服务器直读模式): 免浏览器权限, 直接开扫
      const mem = getRememberedSongsDir();
      if (mem) {
        say(`已从会话记忆恢复「${mem.dir.name}」`);
        setRootNative(mem.native);
        setRoot(mem.dir);
        // v128: 会话缓存命中 (同目录) → 免重扫, 列表/位置直接用挂载时的缓存初值
        if (libraryCache && libraryCache.rootName === mem.dir.name) {
          say('已从会话缓存恢复列表 (未重新扫描)');
          const myGen = ++scanGenRef.current;
          scanDoneRef.current = true;
          // 句柄不入缓存, 轻量重建目录表 + 补取选中难度背景
          void collectDirs(mem.dir, myGen).then(ds => {
            if (!ds || cancelled) return;
            dirsRef.current = ds;
            if (selKeyRef.current) {
              const entry = libraryCache?.entries.find(x => entryKey(x) === selKeyRef.current);
              if (entry) fetchBg(entry.dirName);
            }
          });
        } else {
          libraryCache = null;
          setFilter(''); setSelKey(null); selKeyRef.current = null; setEntries([]); // 清掉按旧缓存初始化的状态
          startScan(mem.dir, mem.native);
        }
        return;
      }
      // exe 启动即打开本面板时, App 的服务器配置恢复可能尚未完成 → 自己查一次, 消除竞态
      const server = await fetchServerDirs().catch(() => null);
      if (cancelled) return;
      if (server?.songsDir) {
        const dir = serverDir('songs', '', server.songsName ?? 'Songs');
        rememberSongsDir(dir, null);
        say(`已从服务器配置恢复「${dir.name}」`);
        setRootNative(null);
        setRoot(dir);
        startScan(dir, null); // v297: 服务器直读模式无 native 句柄 → 主线程回退路径
        return;
      }
      if (!supported) { say('不支持 File System Access API'); return; }
      const r = await restoreSongsDir(); // IndexedDB 恢复
      if (cancelled) return;
      if (!r) {
        const reason = getLastRestoreReason();
        say('无已保存的目录记录' + (reason ? ` (${reason})` : ''));
        idbSelfTest().then(t => { if (!cancelled) say('IndexedDB 自检: ' + t); });
        return;
      }
      say(`已恢复目录「${r.handle.name}」, 权限=${r.granted ? '已授权' : '待授权'}`);
      setRootNative(r.handle);
      setRoot(asDirLike(r.handle)); // 待授权也要设置: 授权按钮分支依赖 root 非空
      if (r.granted) {
        // 写入会话记忆: 本会话内再次打开直接走记忆快速通道, 不再查权限
        rememberSongsDir(asDirLike(r.handle), r.handle);
        startScan(asDirLike(r.handle), r.handle);
      } else setPermNeeded(true);
    })();
    return () => { cancelled = true; };
  }, [supported, startScan, collectDirs, fetchBg, say]);

  // v128: 缓存命中时恢复滚动位置 (root 就绪且列表挂载后, 一次性)
  const scrollRestoredRef = useRef(false);
  useEffect(() => {
    if (scrollRestoredRef.current || !root) return;
    scrollRestoredRef.current = true;
    if (libraryCache && listRef.current) {
      listRef.current.scrollTop = libraryCache.scrollTop;
      setView(v => ({ ...v, top: libraryCache!.scrollTop }));
    }
  }, [root]);

  // v128: 最新状态快照 → 卸载时写会话缓存 (扫描中途关闭不写, 防残缺列表被当成完整结果)
  const snapRef = useRef<{ rootName: string | null; entries: LibraryIndexEntry[]; filter: string; selKey: string | null; scrollTop: number }>({ rootName: null, entries: [], filter: '', selKey: null, scrollTop: 0 });
  useEffect(() => {
    snapRef.current = { rootName: root?.name ?? null, entries, filter, selKey, scrollTop: view.top };
  });
  useEffect(() => () => {
    // v323: 关闭面板即取消进行中的扫描 — 原实现只清 flush 定时器, 扫描生成器继续跑到完:
    // exe (服务器直读) 走主线程回退路径, 关闭曲库后仍在后台连发数千个文件请求 + 逐文件解析,
    // 用户在编辑器里"什么都没做"时界面被拖到未响应 (F: 曲库改搜索后经常卡死)
    scanGenRef.current++;
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; } // v297
    const s = snapRef.current;
    if (!s.rootName || !scanDoneRef.current) return;
    libraryCache = { rootName: s.rootName, entries: s.entries, filter: s.filter, selKey: s.selKey, scrollTop: s.scrollTop };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v290: 查询解析 + 匹配 (空串显示全部)
  const query = useMemo(() => parseLibraryQuery(filter), [filter]);
  // v291: 含键值条件/[diff] 段的搜索依赖索引字段 — 索引建立中提示等待; 占位条目 (fileName='') 不参与条件过滤
  // (纯文本搜索无此限制: 占位的目录名/解析出的 artist/title 直接可搜)
  const queryHasConds = query.filters.length > 0 || query.diff !== null;
  const needsIndexHint = indexing && filter.trim().length > 0 && queryHasConds;
  const filtered = useMemo(() => {
    const list = filter.trim()
      ? entries.filter(e => !(queryHasConds && e.partial) && matchLibraryEntry(query, e)) // v299: 骨架条目不参与条件过滤 (文件内容字段未解析)
      : [...entries];
    switch (sortBy) {
      case 'title': list.sort((a, b) => (a.titleUnicode || a.title).localeCompare(b.titleUnicode || b.title)); break;
      case 'artist': list.sort((a, b) => (a.artistUnicode || a.artist).localeCompare(b.artistUnicode || b.artist)); break;
      case 'creator': list.sort((a, b) => a.creator.localeCompare(b.creator)); break;
      case 'bpm': list.sort((a, b) => a.bpm - b.bpm); break;
      case 'star': list.sort((a, b) => (a.star ?? Infinity) - (b.star ?? Infinity)); break;
      case 'length': list.sort((a, b) => a.lengthMs - b.lengthMs); break;
      case 'diffs': {
        const cnt = new Map<string, number>();
        for (const e of entries) cnt.set(e.dirName, (cnt.get(e.dirName) ?? 0) + 1);
        list.sort((a, b) => (cnt.get(b.dirName)! - cnt.get(a.dirName)!) || a.dirName.localeCompare(b.dirName));
        break;
      }
      default: // dir: 目录名 → mode → 文件名 (沿用旧难度排序习惯)
        list.sort((a, b) => a.dirName.localeCompare(b.dirName) || a.mode - b.mode || a.fileName.localeCompare(b.fileName));
    }
    return list;
  }, [entries, query, queryHasConds, filter, sortBy]);

  const selEntry = useMemo(() => entries.find(e => entryKey(e) === selKey) ?? null, [entries, selKey]);
  const dirCount = useMemo(() => new Set(entries.map(e => e.dirName)).size, [entries]);

  // 虚拟化可见窗口
  const winStart = Math.max(0, Math.floor(view.top / ROW_H) - 10);
  const winEnd = Math.min(filtered.length, winStart + Math.ceil(view.height / ROW_H) + 20);

  // v291: 默认选中当前打开的谱面 — 条目出现后一次性滚动定位 + 补取背景
  // (缓存恢复走 v128 旧滚动位置不触发; 用户点击/滚动后 scrollToSelRef 置 false 不再打扰)
  // v299: 索引期间不再跟随滚动 (骨架条目与索引后同 key 同序, 行位置不再漂移, 无需跟随)
  useEffect(() => {
    if (!scrollToSelRef.current || !selKey) return;
    const idx = filtered.findIndex(e => entryKey(e) === selKey);
    if (idx < 0) return;
    scrollToSelRef.current = false;
    fetchBg(filtered[idx]!.dirName);
    programmaticScrollRef.current = true;
    listRef.current?.scrollTo({ top: Math.max(0, idx * ROW_H - view.height / 2) });
  }, [filtered, selKey, fetchBg, view.height]);

  // 列表容器实际高度 (ResizeObserver 持续跟踪, 初次 + 窗口变化都准确)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setView(v => ({ ...v, height: el.clientHeight || v.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [root, permNeeded, supported]);

  // 卸载时释放背景 objectURL
  useEffect(() => () => { if (selBg) URL.revokeObjectURL(selBg); }, [selBg]);

  const chooseDir = async () => {
    setUiError(null);
    say('打开目录选择器…');
    try {
      const h = await pickSongsDir();
      if (!h) {
        say('选择器被取消或被当前环境阻止 → 请改用拖拽: 把 Songs 文件夹直接拖进本窗口');
        return;
      }
      say(`已选择: ${h.name}`);
      const perr = getLastPersistError();
      say(perr ? '跨会话记忆写入失败: ' + perr : '目录已记住 (下次自动恢复)');
      setRootNative(h);
      setRoot(asDirLike(h)); setPermNeeded(false);
      startScan(asDirLike(h), h);
    } catch (e) {
      console.error('打开目录选择器失败:', e);
      const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
      setUiError('打开目录选择器失败: ' + msg + ' —— 可改用拖拽导入');
      say('选择器报错: ' + msg);
    }
  };

  const grantPerm = async () => {
    if (!rootNative) return;
    say('请求读取权限…');
    const ok = await requestReadPermission(rootNative);
    say('权限结果: ' + (ok ? '已授权' : '被拒绝'));
    setPermNeeded(!ok);
    if (ok) {
      // 授权成功后写入会话记忆: 部分环境 queryPermission 同会话也反复返回未授权,
      // 不记住的话每次打开面板都会再要一次授权
      rememberSongsDir(asDirLike(rootNative), rootNative);
      setRoot(asDirLike(rootNative));
      startScan(asDirLike(rootNative), rootNative);
    }
  };

  // 拖拽 Songs 文件夹导入 (getAsFileSystemHandle 通道可跨会话持久化)
  const onDropDir = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDropActive(false);
    const item = [...e.dataTransfer.items].find(i => i.kind === 'file');
    if (!item) return;
    const d = await dirHandleFromDropEx(item);
    if (!d) {
      say('拖入内容不是文件夹');
      setUiError('请拖入 Songs 文件夹本身（而不是文件）');
      return;
    }
    say(`拖入目录: ${d.dir.name}`);
    setUiError(null);
    if (d.native) {
      const ok = await persistSongsDirHandle(d.native);
      say(ok ? '目录已记住 (下次自动恢复)' : '跨会话记忆写入失败: ' + (getLastPersistError() ?? '未知错误'));
      setRootNative(d.native);
      rememberSongsDir(d.dir, d.native);
    } else {
      say('当前浏览器不支持拖拽句柄持久化, 仅本次会话内记住');
      setRootNative(null);
      rememberSongsDir(d.dir, null);
    }
    setRoot(d.dir); setPermNeeded(false);
    startScan(d.dir, d.native);
  };

  const openDiff = async (fileName: string) => {
    // v120: 有未保存改动先弹保存/废弃提示 (确认后重入本函数)
    if (!store.guardUnsaved(() => { void openDiff(fileName); })) return;
    const entry = snapRef.current.entries.find(x => entryKey(x) === selKeyRef.current);
    const d = entry ? dirsRef.current.find(x => x.name === entry.dirName) : undefined;
    if (!d || loadingBeatmap) return;
    setLoadingBeatmap(true);
    try {
      // v291: 占位条目 (索引未建到该目录, fileName='') → 懒解析目录, 打开第一个难度
      if (!fileName) {
        const diffs = await listDifficulties(d.handle).catch(() => []);
        if (!diffs.length) { say('该目录下没有 .osu 难度文件'); return; }
        fileName = diffs[0]!.fileName;
      }
      const r = await loadDifficulty(d.handle, fileName);
      if (!r) return;
      // v67: 记录谱面来源 (目录 + 原文件名), Ctrl+S 保存时写回该文件
      store.load(r.bm, r.audioUrl, r.bgUrl, r.samples, { dir: d.handle, fileName });
      say(`已加载: ${fileName}`);
      if (r.audioMissing) alert('已加载谱面，但未找到音频文件（将使用合成节拍音）。');
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      say('加载失败: ' + msg);
      alert('加载失败: ' + msg);
    } finally { setLoadingBeatmap(false); }
  };

  const modeBadge = (mode: number) =>
    mode === 0 ? null : ['', 'taiko', 'catch', 'mania'][mode] ?? `mode${mode}`;

  const fmtLen = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
         onMouseDown={e => { backdropDownRef.current = e.target === e.currentTarget; }}
         onMouseUp={e => { if (e.target === e.currentTarget && backdropDownRef.current) onClose(); backdropDownRef.current = false; }}>
      <div className="w-[1380px] max-w-[94vw] h-[78vh] bg-[#16161d] border border-[#333] rounded-lg flex flex-col overflow-hidden" // v291: 宽度 +50%
           onClick={e => e.stopPropagation()}
           onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropActive(true); }}
           onDragLeave={e => { e.stopPropagation(); setDropActive(false); }}
           onDrop={onDropDir}>
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#2c2c38] shrink-0">
          <span className="text-sm font-semibold flex items-center gap-1.5"><FolderOpen className="w-4 h-4" />歌曲库</span>
          {root && (
            <span className="text-sm text-slate-500 truncate">
              {root.name} · {entries.length} 难度 / {dirCount} 目录{indexing && ' · 索引中…'}
              {!rootNative && ' · 拖拽导入'}
            </span>
          )}
          <div className="flex-1" />
          <button className="text-sm px-2 py-1 rounded bg-[#2c2c38] hover:bg-[#3c3c4c]" onClick={chooseDir}>
            {root ? '更换目录' : '选择 Songs 目录'}
          </button>
          {root && (
            <button className="text-sm px-2 py-1 rounded bg-[#2c2c38] hover:bg-[#3c3c4c] disabled:opacity-40"
                    disabled={indexing} onClick={() => startScan(root, rootNative, true)}> {/* v297: 手动重扫 = 逐文件 stat 彻底校验 */}
              重新扫描
            </button>
          )}
          <button className="text-sm px-2 py-1 rounded bg-[#2c2c38] hover:bg-[#3c3c4c] flex items-center" onClick={onClose}><X className="w-3.5 h-3.5" /></button>
        </div>

        {uiError && (
          <div className="px-4 py-1.5 text-sm text-red-400 border-b border-[#2c2c38] shrink-0">{uiError}</div>
        )}

        <div className="flex-1 flex flex-col min-h-0 relative">
          {dropActive && (
            <div className="absolute inset-0 z-10 bg-[#e6437d]/15 border-2 border-dashed border-[#e6437d] flex items-center justify-center text-sm text-pink-200 pointer-events-none">
              松开以导入 Songs 文件夹
            </div>
          )}

        {!supported && !root ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-slate-400 p-8 text-center">
            <div className="text-lg flex items-center justify-center gap-2"><TriangleAlert className="w-5 h-5" />当前浏览器不支持目录选择器（File System Access API）</div>
            <div>可以<strong className="text-pink-300">直接把 Songs 文件夹拖进这个窗口</strong>，或用 Chrome / Edge 打开。</div>
          </div>
        ) : !root ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
            <div className="text-sm text-slate-400">选择 osu! 的 Songs 目录，即可浏览全部歌曲与难度</div>
            <button className="px-4 py-2 rounded bg-[#e6437d] hover:bg-[#f0558e] text-sm font-medium" onClick={chooseDir}>
              选择 Songs 目录…
            </button>
            <div className="text-sm text-slate-600 text-center">
              通常位于 osu! 安装目录下的 Songs 文件夹；选择后会记住，下次自动恢复
              <br />如果点了没反应，也可以<strong className="text-pink-300">直接把 Songs 文件夹拖进这个窗口</strong>
            </div>
          </div>
        ) : permNeeded ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="text-sm text-slate-400">已记住目录「{rootNative?.name ?? root.name}」，需要重新授权读取权限</div>
            <button className="px-4 py-2 rounded bg-[#e6437d] hover:bg-[#f0558e] text-sm font-medium" onClick={grantPerm}>授权访问</button>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
            {/* left: 扁平难度列表 (v290, 虚拟化; v291: 弹性宽度) */}
            <div className="flex-1 min-w-0 border-r border-[#2c2c38] flex flex-col min-h-0">
              <div className="p-2 border-b border-[#2c2c38] shrink-0 flex items-center gap-2">
                <input value={filter} onChange={e => { setFilter(e.target.value); listRef.current?.scrollTo({ top: 0 }); setView(v => ({ ...v, top: 0 })); }}
                       placeholder='搜索 (支持 ar>8 bpm<180 creator="短语")…'
                       className="flex-1 bg-[#0d0d12] border border-[#333] rounded px-2 py-1.5 text-sm outline-none focus:border-[#e6437d]" />
                <select value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}
                        className="bg-[#0d0d12] border border-[#333] rounded px-1 py-1.5 text-sm outline-none shrink-0">
                  <option value="dir">目录</option>
                  <option value="title">标题</option>
                  <option value="artist">艺术家</option>
                  <option value="creator">谱师</option>
                  <option value="bpm">BPM</option>
                  <option value="star">星级</option>
                  <option value="length">时长</option>
                  <option value="diffs">难度数</option>
                </select>
                {indexing && <span className="text-xs text-slate-500 shrink-0 animate-pulse">索引中 {entries.length}</span>}
              </div>
              {needsIndexHint && ( // v291: 含条件的搜索依赖索引 — 建立中提示等待
                <div className="px-3 py-1 text-xs text-amber-300/90 border-b border-[#2c2c38] shrink-0">
                  索引建立中：含条件的搜索暂只覆盖已索引部分，完整结果请等索引完成…
                </div>
              )}
              {scanError ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="text-sm text-red-400">扫描失败: {scanError}</div>
                  <button className="text-sm px-3 py-1.5 rounded bg-[#2c2c38] hover:bg-[#3c3c4c]" onClick={() => startScan(root, rootNative, true)}>重试</button>
                </div>
              ) : (
                <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto"
                     onScroll={e => {
                       setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight });
                       // v296: 用户手动滚动 → 脱离选中跟随; 程序 scrollTo 触发的 onScroll 不算
                       if (programmaticScrollRef.current) programmaticScrollRef.current = false;
                       else scrollToSelRef.current = false;
                     }}>
                  <div style={{ height: filtered.length * ROW_H, position: 'relative' }}>
                    {filtered.slice(winStart, winEnd).map((e, i) => {
                      const k = entryKey(e);
                      // v299: 骨架条目与索引后条目同 key 同外观 (文件名已解析出 artist/title/creator/version)
                      return (
                        <div key={k}
                             style={{ position: 'absolute', top: (winStart + i) * ROW_H, height: ROW_H, left: 0, right: 0 }}
                             className={`px-3 flex items-center gap-2 text-sm cursor-pointer ${selKey === k ? 'bg-[#e6437d]/25 text-white' : 'text-slate-300 hover:bg-[#22222c]'} ${loadingBeatmap ? 'pointer-events-none' : ''}`}
                             title={k}
                             onClick={() => selectEntry(e)}
                             onDoubleClick={() => { selectEntry(e); void openDiff(e.fileName); }}>
                          <div className="flex-1 min-w-0">
                            <div className="truncate">
                              {e.artistUnicode || e.artist || '?'} - {e.titleUnicode || e.title || e.fileName}
                              <span className="text-[#e6437d] ml-1.5">[{e.version || '?'}]</span>
                              {modeBadge(e.mode) && <span className="ml-1.5 text-xs px-1 rounded bg-[#2c2c38] text-slate-400">{modeBadge(e.mode)}</span>}
                            </div>
                            <div className="text-xs text-slate-500 truncate">{e.dirName}</div>
                          </div>
                          <div className="text-xs text-slate-500 shrink-0 text-right leading-tight">
                            <div>{e.creator || '?'}{e.bpm > 0 ? ` · ${Math.round(e.bpm)} BPM` : ''}</div>
                            {e.star != null && <div className="text-amber-300/80"><Star className="inline w-3 h-3 -mt-0.5 fill-current" />{e.star.toFixed(2)}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {!indexing && filtered.length === 0 && entries.length > 0 &&
                    <div className="px-3 py-2 text-sm text-slate-500">无匹配难度</div>}
                  {!indexing && entries.length === 0 &&
                    <div className="px-3 py-2 text-sm text-slate-500">未发现歌曲目录（Songs 下每个子文件夹对应一首歌）</div>}
                </div>
              )}
            </div>
            {/* right: 详情/预览 (v290: 选中难度的完整元数据 + 打开按钮) */}
            <div className="w-[380px] shrink-0 flex flex-col min-h-0"> {/* v291: 固定宽度, 不随谱面内容变化 */}
              {selBg && selEntry && (
                <div className="shrink-0 h-24 border-b border-[#2c2c38] bg-cover bg-center" style={{ backgroundImage: `url(${selBg})` }}>
                  <div className="h-full w-full bg-gradient-to-t from-[#16161d] via-transparent to-transparent flex items-end px-3 pb-1">
                    <span className="text-xs text-white/80 drop-shadow truncate">{selEntry.dirName}</span>
                  </div>
                </div>
              )}
              <div className="px-3 py-2 border-b border-[#2c2c38] text-sm text-slate-500 shrink-0 truncate">
                {selEntry ? selEntry.dirName : '选择左侧难度查看详情 (双击直接打开)'}
              </div>
              {selEntry ? (
                <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
                  {selEntry.partial ? ( // v299: 骨架条目 — 文件名已解析出标题/艺术家/难度名, 详细参数待索引
                    <>
                      <div className="text-base text-slate-100">{selEntry.title || selEntry.fileName}</div>
                      {selEntry.artist && <div className="text-sm text-slate-300 mt-0.5">{selEntry.artist}</div>}
                      <div className="text-sm mt-2 text-slate-400">难度: <span className="text-[#e6437d]">[{selEntry.version || '?'}]</span></div>
                      <div className="text-sm mt-1 text-slate-400">谱师: {selEntry.creator || '?'}</div>
                      <div className="text-sm mt-2 text-slate-500">详细参数 (BPM/CS/AR/时长…) 索引中，双击行或点「打开」可直接载入</div>
                    </>
                  ) : (
                    <>
                      <div className="text-base text-slate-100">{selEntry.titleUnicode || selEntry.title || selEntry.fileName}</div>
                      {selEntry.titleUnicode && selEntry.title && selEntry.title !== selEntry.titleUnicode &&
                        <div className="text-sm text-slate-400">{selEntry.title}</div>}
                      <div className="text-sm text-slate-300 mt-0.5">{selEntry.artistUnicode || selEntry.artist || '?'}</div>
                      {selEntry.artistUnicode && selEntry.artist && selEntry.artist !== selEntry.artistUnicode &&
                        <div className="text-sm text-slate-500">{selEntry.artist}</div>}
                      <div className="text-sm mt-2 space-y-1 text-slate-400">
                        <div>难度: <span className="text-[#e6437d]">[{selEntry.version || '?'}]</span>
                          {modeBadge(selEntry.mode) && <span className="ml-1.5 text-xs px-1 rounded bg-[#2c2c38]">{modeBadge(selEntry.mode)}</span>}
                        </div>
                        <div>谱师: {selEntry.creator || '?'}</div>
                        <div>BPM: {Math.round(selEntry.bpm * 100) / 100 || '?'} · 时长: {fmtLen(selEntry.lengthMs)}
                          {selEntry.star != null && <> · 星级: <span className="text-amber-300/90"><Star className="inline w-3 h-3 -mt-0.5 fill-current" />{selEntry.star.toFixed(2)}</span></>}
                        </div>
                        <div>HP{selEntry.hp} · CS{selEntry.cs} · OD{selEntry.od} · AR{selEntry.ar}</div>
                        {selEntry.source && <div className="truncate">来源: {selEntry.source}</div>}
                        {selEntry.tags && <div className="truncate">标签: {selEntry.tags}</div>}
                        <div className="text-slate-600 truncate">{selEntry.fileName} · ID {selEntry.beatmapID}/{selEntry.beatmapSetID}</div>
                      </div>
                    </>
                  )}
                  <button className="mt-3 px-4 py-1.5 rounded bg-[#e6437d] hover:bg-[#f0558e] text-sm font-medium disabled:opacity-40"
                          disabled={loadingBeatmap}
                          onClick={() => void openDiff(selEntry.fileName)}>
                    {loadingBeatmap ? '加载中…' : '打开'}
                  </button>
                </div>
              ) : (
                <div className="px-3 py-2 text-sm text-slate-500">单击行选中，双击行或点「打开」载入编辑器</div>
              )}
            </div>
          </div>
        )}
        </div>

        {/* 诊断日志: 帮助定位不同环境下的问题 */}
        <div className="shrink-0 border-t border-[#2c2c38] px-3 py-1 bg-[#101016]">
          {log.length === 0
            ? <div className="text-xs text-slate-600">诊断日志</div>
            : log.map((l, i) => <div key={i} className="text-xs text-slate-500 font-mono truncate">{l}</div>)}
        </div>
      </div>
    </div>
  );
}
