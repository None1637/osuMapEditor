import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, TriangleAlert, X } from 'lucide-react'; // v181: 📁/⚠/✕ → lucide
import { store } from '../osu/store';
import { fetchServerDirs, serverDir } from '../osu/serverFs';
import {
  asDirLike, countDifficulties, dirHandleFromDropEx, getDirBackgroundUrl,
  getLastPersistError, getLastRestoreReason, getRememberedSongsDir, idbSelfTest,
  isFileSystemAccessSupported, listDifficulties, loadDifficulty,
  persistSongsDirHandle, pickSongsDir, rememberSongsDir, requestReadPermission, restoreSongsDir, scanSongDirs,
  type DifficultyInfo, type FsDirLike,
} from '../osu/library';

type DirEntry = { name: string; handle: FsDirLike };

const ROW_H = 26; // 左侧目录行高(px), 虚拟化渲染用
const collator = (a: DirEntry, b: DirEntry) => a.name.localeCompare(b.name);

// v128: 曲库会话缓存 — 第二次打开免重新扫描, 并记住上次位置 (滚动/搜索词/选中歌曲/难度列表/难度数徽标)。
// 仅在用户显式刷新时失效: 「重新扫描」/「更换目录」/拖拽导入/授权后首扫 (都会走 startScan → 顶部清缓存);
// 扫描中途关闭面板不写缓存 (scanDone=false), 下次打开重扫, 避免把残缺列表当成完整结果。
interface LibraryCache {
  rootName: string;                    // 与恢复出的目录名一致才生效 (防换了 Songs 目录还用旧列表)
  dirs: DirEntry[];
  meta: Map<string, number>;           // 难度数徽标 ('loading' 占位不入缓存)
  filter: string;
  selName: string | null;
  diffs: DifficultyInfo[] | null;
  scrollTop: number;
}
let libraryCache: LibraryCache | null = null;

export function SongLibrary({ onClose }: { onClose: () => void }) {
  const supported = isFileSystemAccessSupported();
  const [root, setRoot] = useState<FsDirLike | null>(null);
  const [rootNative, setRootNative] = useState<FileSystemDirectoryHandle | null>(null); // 仅授权流程用
  const [permNeeded, setPermNeeded] = useState(false);
  const [dirs, setDirs] = useState<DirEntry[]>(() => libraryCache?.dirs ?? []);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [filter, setFilter] = useState(() => libraryCache?.filter ?? '');
  const [selName, setSelName] = useState<string | null>(() => libraryCache?.selName ?? null);
  const [diffs, setDiffs] = useState<DifficultyInfo[] | null>(() => libraryCache?.diffs ?? null);
  const [loadingDiffs, setLoadingDiffs] = useState(false);
  const [loadingBeatmap, setLoadingBeatmap] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [selBg, setSelBg] = useState<string | null>(null);
  const scanGenRef = useRef(0);
  // v164: 记录 mousedown 是否落在遮罩本体上 — 修复搜索框内按下、拖选文本到窗外松开时
  // click 落到共同祖先(遮罩)而误关窗口: 只有按下+松开都在遮罩本体上才关闭
  const backdropDownRef = useRef(false);
  // v128: 扫描完成标记 — 扫完/缓存恢复才允许写会话缓存
  const scanDoneRef = useRef(!!libraryCache);

  // 难度数徽标缓存 (会话内; 'loading' 占位防重复请求); v128: 初值取会话缓存
  const metaRef = useRef(new Map<string, number | 'loading'>(libraryCache?.meta ?? []));
  const [metaTick, setMetaTick] = useState(0);

  // 诊断日志(面板底部可见, 用于定位不同浏览器环境下的问题)
  const [log, setLog] = useState<string[]>([]);
  const say = useCallback((s: string) => {
    console.log('[曲库]', s);
    setLog(prev => [...prev.slice(-6), new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' ' + s]);
  }, []);

  // 虚拟滚动状态; v128: 滚动位置初值取会话缓存 (记住上次位置)
  const listRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: libraryCache?.scrollTop ?? 0, height: 400 });

  // 扫描: 边扫边显示, 按时间节流推送(200ms), 避免大曲库高频重渲染卡死
  const startScan = useCallback(async (h: FsDirLike) => {
    const myGen = ++scanGenRef.current;
    libraryCache = null; // v128: 任何显式扫描 (重新扫描/换目录/拖拽/授权) 都使会话缓存失效
    scanDoneRef.current = false;
    setScanning(true); setScanError(null);
    setDirs([]); setSelName(null); setDiffs(null);
    metaRef.current.clear();
    say('开始扫描…');
    let pending: DirEntry[] = [];
    let total = 0;
    let lastFlush = performance.now();
    let firstFlushed = false;
    const flush = () => {
      if (!pending.length) return;
      const push = pending; pending = [];
      setDirs(prev => [...prev, ...push].sort(collator));
      lastFlush = performance.now();
    };
    try {
      for await (const d of scanSongDirs(h)) {
        if (scanGenRef.current !== myGen) return; // 已被新扫描取代
        pending.push(d); total++;
        // 首条立即显示, 之后按 200 条/200ms 节流
        if (!firstFlushed || pending.length >= 200 || performance.now() - lastFlush > 200) {
          flush();
          if (!firstFlushed) say('开始收到目录…');
          firstFlushed = true;
        }
      }
      flush();
      scanDoneRef.current = true; // v128: 扫描完成, 允许写会话缓存
      say(`扫描完成: ${total} 个歌曲目录`);
    } catch (e) {
      console.error('扫描 Songs 目录失败:', e);
      if (scanGenRef.current === myGen) {
        const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
        setScanError(msg);
        say('扫描出错: ' + msg);
      }
    } finally {
      if (scanGenRef.current === myGen) setScanning(false);
    }
  }, [say]);

  // v128: 缓存命中后补取选中歌曲背景 (objectURL 不跨挂载, 需重建; 目录句柄会话内仍有效)
  const restoreSelBg = (cache: LibraryCache) => {
    if (!cache.selName) return;
    const d = cache.dirs.find(x => x.name === cache.selName);
    if (!d) return;
    getDirBackgroundUrl(d.handle).then(url => setSelBg(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    })).catch(() => { /* 无背景则留空 */ });
  };

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
          restoreSelBg(libraryCache);
        } else {
          libraryCache = null;
          setFilter(''); setSelName(null); setDiffs(null); setDirs([]); metaRef.current.clear(); // 清掉按旧缓存初始化的状态
          startScan(mem.dir);
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
        startScan(dir);
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
        startScan(asDirLike(r.handle));
      } else setPermNeeded(true);
    })();
    return () => { cancelled = true; };
  }, [supported, startScan, say]);

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
  const snapRef = useRef<{ rootName: string | null; dirs: DirEntry[]; filter: string; selName: string | null; diffs: DifficultyInfo[] | null; scrollTop: number }>({ rootName: null, dirs: [], filter: '', selName: null, diffs: null, scrollTop: 0 });
  useEffect(() => {
    snapRef.current = { rootName: root?.name ?? null, dirs, filter, selName, diffs, scrollTop: view.top };
  });
  useEffect(() => () => {
    const s = snapRef.current;
    if (!s.rootName || !scanDoneRef.current) return;
    const meta = new Map<string, number>();
    for (const [k, v] of metaRef.current) if (typeof v === 'number') meta.set(k, v);
    libraryCache = { rootName: s.rootName, dirs: s.dirs, meta, filter: s.filter, selName: s.selName, diffs: s.diffs, scrollTop: s.scrollTop };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return dirs;
    return dirs.filter(d => d.name.toLowerCase().includes(f));
  }, [dirs, filter]);

  // 虚拟化可见窗口
  const winStart = Math.max(0, Math.floor(view.top / ROW_H) - 10);
  const winEnd = Math.min(filtered.length, winStart + Math.ceil(view.height / ROW_H) + 20);

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

  // 可视行懒加载难度数徽标
  useEffect(() => {
    for (let i = winStart; i < winEnd; i++) {
      const d = filtered[i];
      if (!d || metaRef.current.has(d.name)) continue;
      metaRef.current.set(d.name, 'loading');
      countDifficulties(d.handle)
        .then(n => { metaRef.current.set(d.name, n); setMetaTick(t => t + 1); })
        .catch(() => { metaRef.current.set(d.name, 0); });
    }
  }, [winStart, winEnd, filtered]);

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
      startScan(asDirLike(h));
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
      startScan(asDirLike(rootNative));
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
    startScan(d.dir);
  };

  const selectDir = async (d: DirEntry) => {
    setSelName(d.name); setDiffs(null); setLoadingDiffs(true);
    getDirBackgroundUrl(d.handle).then(url => setSelBg(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    })).catch(() => setSelBg(null));
    try { setDiffs(await listDifficulties(d.handle)); }
    catch (e) {
      console.error('读取难度失败:', e);
      say('读取难度失败: ' + (e instanceof Error ? e.message : String(e)));
      setDiffs([]);
    }
    finally { setLoadingDiffs(false); }
  };

  const openDiff = async (fileName: string) => {
    // v120: 有未保存改动先弹保存/废弃提示 (确认后重入本函数)
    if (!store.guardUnsaved(() => { void openDiff(fileName); })) return;
    const d = dirs.find(x => x.name === selName);
    if (!d || loadingBeatmap) return;
    setLoadingBeatmap(true);
    try {
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

  void metaTick; // 徽标缓存更新时触发重渲染

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
         onMouseDown={e => { backdropDownRef.current = e.target === e.currentTarget; }}
         onMouseUp={e => { if (e.target === e.currentTarget && backdropDownRef.current) onClose(); backdropDownRef.current = false; }}>
      <div className="w-[920px] max-w-[94vw] h-[78vh] bg-[#16161d] border border-[#333] rounded-lg flex flex-col overflow-hidden"
           onClick={e => e.stopPropagation()}
           onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropActive(true); }}
           onDragLeave={e => { e.stopPropagation(); setDropActive(false); }}
           onDrop={onDropDir}>
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#2c2c38] shrink-0">
          <span className="text-sm font-semibold flex items-center gap-1.5"><FolderOpen className="w-4 h-4" />歌曲库</span>
          {root && (
            <span className="text-xs text-slate-500 truncate">
              {root.name} · {dirs.length} 个歌曲目录{scanning && ' · 扫描中…'}{!rootNative && ' · 拖拽导入'}
            </span>
          )}
          <div className="flex-1" />
          <button className="text-xs px-2 py-1 rounded bg-[#2c2c38] hover:bg-[#3c3c4c]" onClick={chooseDir}>
            {root ? '更换目录' : '选择 Songs 目录'}
          </button>
          {root && (
            <button className="text-xs px-2 py-1 rounded bg-[#2c2c38] hover:bg-[#3c3c4c] disabled:opacity-40"
                    disabled={scanning} onClick={() => startScan(root)}>
              重新扫描
            </button>
          )}
          <button className="text-xs px-2 py-1 rounded bg-[#2c2c38] hover:bg-[#3c3c4c] flex items-center" onClick={onClose}><X className="w-3.5 h-3.5" /></button>
        </div>

        {uiError && (
          <div className="px-4 py-1.5 text-xs text-red-400 border-b border-[#2c2c38] shrink-0">{uiError}</div>
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
            <div className="text-xs text-slate-600 text-center">
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
            {/* left: folders (虚拟化列表) */}
            <div className="w-[46%] border-r border-[#2c2c38] flex flex-col min-h-0">
              <div className="p-2 border-b border-[#2c2c38] shrink-0 flex items-center gap-2">
                <input value={filter} onChange={e => { setFilter(e.target.value); listRef.current?.scrollTo({ top: 0 }); setView(v => ({ ...v, top: 0 })); }} placeholder="搜索歌曲目录…"
                       className="flex-1 bg-[#0d0d12] border border-[#333] rounded px-2 py-1.5 text-xs outline-none focus:border-[#e6437d]" />
                {scanning && <span className="text-[10px] text-slate-500 shrink-0 animate-pulse">扫描中 {dirs.length}</span>}
              </div>
              {scanError ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="text-xs text-red-400">扫描失败: {scanError}</div>
                  <button className="text-xs px-3 py-1.5 rounded bg-[#2c2c38] hover:bg-[#3c3c4c]" onClick={() => startScan(root)}>重试</button>
                </div>
              ) : (
                <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto"
                     onScroll={e => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
                  <div style={{ height: filtered.length * ROW_H, position: 'relative' }}>
                    {filtered.slice(winStart, winEnd).map((d, i) => {
                      const meta = metaRef.current.get(d.name);
                      return (
                        <div key={d.name}
                             style={{ position: 'absolute', top: (winStart + i) * ROW_H, height: ROW_H, left: 0, right: 0 }}
                             className={`px-3 flex items-center gap-2 text-xs cursor-pointer ${selName === d.name ? 'bg-[#e6437d]/25 text-white' : 'text-slate-300 hover:bg-[#22222c]'}`}
                             title={d.name}
                             onClick={() => selectDir(d)}>
                          <span className="truncate flex-1">{d.name}</span>
                          {meta === 'loading'
                            ? <span className="text-[9px] text-slate-600 shrink-0">…</span>
                            : typeof meta === 'number' && meta > 0
                              ? <span className="text-[9px] px-1 rounded bg-[#2c2c38] text-slate-400 shrink-0">{meta} 难度</span>
                              : null}
                        </div>
                      );
                    })}
                  </div>
                  {!scanning && filtered.length === 0 && dirs.length > 0 &&
                    <div className="px-3 py-2 text-xs text-slate-500">无匹配目录</div>}
                  {!scanning && dirs.length === 0 &&
                    <div className="px-3 py-2 text-xs text-slate-500">未发现歌曲目录（Songs 下每个子文件夹对应一首歌）</div>}
                </div>
              )}
            </div>
            {/* right: difficulties + 背景预览 */}
            <div className="flex-1 flex flex-col min-h-0">
              {selBg && selName && (
                <div className="shrink-0 h-24 border-b border-[#2c2c38] bg-cover bg-center" style={{ backgroundImage: `url(${selBg})` }}>
                  <div className="h-full w-full bg-gradient-to-t from-[#16161d] via-transparent to-transparent flex items-end px-3 pb-1">
                    <span className="text-[10px] text-white/80 drop-shadow truncate">{selName}</span>
                  </div>
                </div>
              )}
              <div className="px-3 py-2 border-b border-[#2c2c38] text-xs text-slate-500 shrink-0 truncate">
                {selName ?? '选择左侧歌曲查看难度'}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {loadingDiffs && <div className="px-3 py-2 text-xs text-slate-500">读取难度…</div>}
                {diffs?.map(d => (
                  <div key={d.fileName}
                       className={`px-3 py-2 cursor-pointer hover:bg-[#22222c] border-b border-[#1d1d26] ${loadingBeatmap ? 'opacity-50 pointer-events-none' : ''}`}
                       onClick={() => openDiff(d.fileName)}>
                    <div className="text-xs text-slate-200 truncate">
                      {d.artist || '?'} - {d.title || d.fileName}
                      <span className="text-[#e6437d] ml-1.5">[{d.version || '?'}]</span>
                      {modeBadge(d.mode) && <span className="ml-1.5 text-[10px] px-1 rounded bg-[#2c2c38] text-slate-400">{modeBadge(d.mode)}</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">mapper: {d.creator || '?'} · {d.fileName}</div>
                  </div>
                ))}
                {diffs && diffs.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">该目录下没有 .osu 难度文件</div>}
              </div>
            </div>
          </div>
        )}
        </div>

        {/* 诊断日志: 帮助定位不同环境下的问题 */}
        <div className="shrink-0 border-t border-[#2c2c38] px-3 py-1 bg-[#101016]">
          {log.length === 0
            ? <div className="text-[10px] text-slate-600">诊断日志</div>
            : log.map((l, i) => <div key={i} className="text-[10px] text-slate-500 font-mono truncate">{l}</div>)}
        </div>
      </div>
    </div>
  );
}
