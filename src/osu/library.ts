// osu! Songs 目录访问: File System Access API 选目录 + IndexedDB 持久化句柄
// 扫描歌曲文件夹 -> 懒解析各难度元数据 -> 加载选中难度 (.osu + 音频 + 背景)
import { parseOsu, type Beatmap } from './parser';
import { invalidatePath } from './renderer';
import { SAMPLE_FILE_RE } from './clock/hitSounds';

// ---------- 浏览器能力检测 ----------
export function isFileSystemAccessSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

// ---------- IndexedDB: 持久化目录句柄 ----------
const DB_NAME = 'osu-map-editor';
const DB_STORE = 'settings';
// v2: 兼容早期版本遗留的同名 v1 库 (可能不带 settings store) — 升级时按 contains 守卫补建,
// 否则 open 成功但 transaction('settings') 抛 NotFoundError, 表现为"每次都存不上/无记录"
const DB_VERSION = 2;
const KEY_SONGS_DIR = 'songsDirHandle';
const KEY_SKIN_DIR = 'skinDirHandle';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** 写入并立即读回校验: 句柄是否真正落库当场可知, 不再"以为存上了实际没存上" */
async function idbPutVerified(key: string, value: unknown): Promise<void> {
  await idbPut(key, value);
  const back = await idbGet<unknown>(key).catch(() => null);
  if (!back) throw new Error('写入后读回校验失败 (句柄未真正落库)');
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => { db.close(); resolve((req.result as T) ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

// ---------- 目录选择与授权 ----------
// 会话内记忆 (模块级): 组件卸载不丢失; IDB 不可用时保证同一会话内不必重选
interface RememberedDir { dir: FsDirLike; native: FileSystemDirectoryHandle | null }
let memSongsDir: RememberedDir | null = null;
let memSkinDir: RememberedDir | null = null;

export function rememberSongsDir(dir: FsDirLike, native: FileSystemDirectoryHandle | null) { memSongsDir = { dir, native }; }
export function rememberSkinDir(dir: FsDirLike, native: FileSystemDirectoryHandle | null) { memSkinDir = { dir, native }; }
export function getRememberedSongsDir(): RememberedDir | null { return memSongsDir; }
export function getRememberedSkinDir(): RememberedDir | null { return memSkinDir; }

// 持久化诊断 (UI 日志可见, 不再静默吞掉)
let lastPersistError: string | null = null;
let lastRestoreReason = '';
export function getLastPersistError(): string | null { return lastPersistError; }
export function getLastRestoreReason(): string { return lastRestoreReason; }

/** IDB 往返自检 (put/get/delete 哑值, 2.5s 超时), 用于诊断当前环境能否跨会话记忆 */
export async function idbSelfTest(): Promise<string> {
  let timedOut = false;
  try {
    const result = await Promise.race([
      (async () => {
        await idbPut('__selftest__', 1);
        const v = await idbGet<number>('__selftest__');
        await idbDel('__selftest__');
        return v === 1 ? 'ok' : 'fail: 读回值不符';
      })(),
      new Promise<string>(res => setTimeout(() => { timedOut = true; res('fail: 超时(当前环境 IndexedDB 挂起)'); }, 2500)),
    ]);
    return timedOut ? 'fail: 超时(当前环境 IndexedDB 挂起)' : result;
  } catch (e) {
    return 'fail: ' + (e instanceof Error ? `${e.name} ${e.message}` : String(e));
  }
}

/** 弹出目录选择器。用户取消返回 null; 其他错误直接抛出(由 UI 展示), 不再静默吞掉 */
async function pickDir(pickerId: string, idbKey: string | null): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as {
    showDirectoryPicker(opts?: { id?: string; mode?: string }): Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker.bind(window);
  let handle: FileSystemDirectoryHandle;
  const t0 = performance.now();
  try {
    handle = await picker({ id: pickerId, mode: 'read' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      const elapsed = performance.now() - t0;
      // 部分 Electron/webview 在带选项调用时, 用户真正选了目录后仍误报 AbortError。
      // 用户在对话框里停留过(>1s)说明不是快速取消, 用无参数形式重试一次。
      if (elapsed > 1000) {
        try {
          handle = await picker();
        } catch (e2) {
          if (e2 instanceof DOMException && e2.name === 'AbortError') return null;
          throw e2;
        }
      } else return null; // 快速取消, 视为用户主动取消
    } else throw e;
  }
  if (idbKey) await persistDirHandle(idbKey, handle);
  return handle;
}

/** 持久化目录句柄: 写入+读回校验, 有界等待(3s), 结果经 getLastPersistError 可见; 超时/失败不影响使用 */
async function persistDirHandle(idbKey: string, handle: FileSystemDirectoryHandle): Promise<void> {
  let timedOut = false;
  const put = idbPutVerified(idbKey, handle);
  put.catch(() => { /* 超时胜出后迟到的拒绝不污染环境控制台 */ });
  try {
    await Promise.race([
      put,
      new Promise<void>((_, rej) => setTimeout(() => { timedOut = true; rej(new Error('IndexedDB 写入超时')); }, 3000)),
    ]);
    lastPersistError = null;
  } catch (e) {
    const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
    lastPersistError = (timedOut ? 'IndexedDB 写入超时' : msg) + ' (本次会话内仍会记住, 但下次启动需重选)';
  }
}

/** 拖拽等非选择器通道拿到的原生句柄也走同一持久化 (UI 用, 返回是否落库成功) */
export async function persistSongsDirHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
  await persistDirHandle(KEY_SONGS_DIR, handle);
  return lastPersistError === null;
}
export async function persistSkinDirHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
  await persistDirHandle(KEY_SKIN_DIR, handle);
  return lastPersistError === null;
}

export async function pickSongsDir(): Promise<FileSystemDirectoryHandle | null> {
  const h = await pickDir('osu-songs', KEY_SONGS_DIR);
  if (h) rememberSongsDir(asDirLike(h), h);
  return h;
}

export async function pickSkinDir(): Promise<FileSystemDirectoryHandle | null> {
  const h = await pickDir('osu-skin', KEY_SKIN_DIR);
  if (h) rememberSkinDir(asDirLike(h), h);
  return h;
}

/** 带超时包装: IndexedDB 在部分内嵌浏览器会挂起, 避免永远等待 */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>(res => setTimeout(() => res(fallback), ms))]);
}

/** 从 IndexedDB 恢复目录句柄 (不主动请求权限, 返回授权状态); 2s 超时视为无记录, 原因经 getLastRestoreReason 可见 */
async function restoreDir(idbKey: string): Promise<{ handle: FileSystemDirectoryHandle; granted: boolean } | null> {
  try {
    let timedOut = false;
    const handle = await Promise.race([
      idbGet<FileSystemDirectoryHandle>(idbKey),
      new Promise<null>(res => setTimeout(() => { timedOut = true; res(null); }, 2000)),
    ]);
    if (timedOut) { lastRestoreReason = 'IndexedDB 读取超时 (当前环境可能不支持跨会话记忆)'; return null; }
    if (!handle) { lastRestoreReason = lastPersistError ? `写入时失败: ${lastPersistError}` : 'IndexedDB 中无记录'; return null; }
    const h = handle as unknown as { queryPermission(o: { mode: string }): Promise<string> };
    return { handle, granted: (await withTimeout(h.queryPermission({ mode: 'read' }), 2000, 'denied')) === 'granted' };
  } catch (e) {
    lastRestoreReason = 'IndexedDB 读取失败: ' + (e instanceof Error ? `${e.name} ${e.message}` : String(e));
    return null;
  }
}

export function restoreSongsDir(): Promise<{ handle: FileSystemDirectoryHandle; granted: boolean } | null> {
  if (memSongsDir?.native) return Promise.resolve({ handle: memSongsDir.native, granted: true });
  return restoreDir(KEY_SONGS_DIR);
}

export function restoreSkinDir(): Promise<{ handle: FileSystemDirectoryHandle; granted: boolean } | null> {
  if (memSkinDir?.native) return Promise.resolve({ handle: memSkinDir.native, granted: true });
  return restoreDir(KEY_SKIN_DIR);
}

async function idbDel(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** 清除已记住的皮肤目录 (恢复默认皮肤时调用, 含会话内记忆) */
export async function forgetSkinDir(): Promise<void> {
  memSkinDir = null;
  try { await withTimeout(idbDel(KEY_SKIN_DIR), 2000, undefined); } catch { /* 忽略 */ }
}

/** 用户手势中调用: 请求读权限 */
export async function requestReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const h = handle as unknown as { requestPermission(o: { mode: string }): Promise<string> };
    return (await h.requestPermission({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}

// ---------- 扫描与解析 ----------
/** 结构化目录接口: FileSystemDirectoryHandle 与拖拽来的 FileSystemDirectoryEntry 都适配到它 */
export interface FsFileLike {
  kind: string;
  name: string;
  getFile(): Promise<File>;
}

export interface FsDirLike {
  kind: string;
  name: string;
  entries(): AsyncIterableIterator<[string, FsDirLike | FsFileLike]>;
  getFileHandle(name: string): Promise<FsFileLike>;
  /** 可选写回能力 (目前仅服务器直读目录实现, 供 Ctrl+S 保存谱面); 原生句柄走 File System Access 另判 */
  writeFile?(name: string, content: string): Promise<void>;
  /** v77: 服务器直读目录在 songs/skin 根内的相对路径 (Electron 菜单 "打开歌曲文件夹/最近难度" 用) */
  serverRel?: string;
}

/** 拖拽导入: DataTransferItem.webkitGetAsEntry() -> FsDirLike (不依赖 showDirectoryPicker) */
export function dirHandleFromDrop(item: DataTransferItem): FsDirLike | null {
  const getAsEntry = (item as unknown as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry;
  if (typeof getAsEntry !== 'function') return null;
  const entry = getAsEntry.call(item);
  if (!entry || !entry.isDirectory) return null;
  return wrapEntry(entry) as FsDirLike;
}

/**
 * 拖拽导入 (优先现代 API): getAsFileSystemHandle 返回的原生句柄可持久化到 IndexedDB (跨会话记忆);
 * 旧 API webkitGetAsEntry 回退仅会话内有效 (native=null)
 */
export async function dirHandleFromDropEx(item: DataTransferItem): Promise<{ dir: FsDirLike; native: FileSystemDirectoryHandle | null } | null> {
  const getHandle = (item as unknown as { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle;
  if (typeof getHandle === 'function') {
    try {
      const h = await getHandle.call(item);
      if (h && h.kind === 'directory') return { dir: asDirLike(h as FileSystemDirectoryHandle), native: h as FileSystemDirectoryHandle };
      if (h) return null; // 拖入的是文件而不是文件夹
    } catch { /* 回退旧 API */ }
  }
  const d = dirHandleFromDrop(item);
  return d ? { dir: d, native: null } : null;
}

function wrapEntry(entry: FileSystemEntry): FsDirLike | FsFileLike {
  if (entry.isFile) {
    const fe = entry as FileSystemFileEntry;
    return {
      kind: 'file', name: fe.name,
      getFile: () => new Promise<File>((res, rej) => fe.file(res, rej)),
    };
  }
  const de = entry as FileSystemDirectoryEntry;
  return {
    kind: 'directory', name: de.name,
    async *entries() {
      const reader = de.createReader();
      // Chrome 每次 readEntries 最多 100 条, 必须循环读到空
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) yield [c.name, wrapEntry(c)] as [string, FsDirLike | FsFileLike];
      }
    },
    getFileHandle(name: string) {
      return new Promise<FsFileLike>((res, rej) => {
        de.getFile(name, {}, (f) => res(wrapEntry(f) as FsFileLike), rej);
      });
    },
  };
}

/** FileSystemDirectoryHandle -> FsDirLike (结构已兼容, 仅做类型适配) */
export function asDirLike(handle: FileSystemDirectoryHandle): FsDirLike {
  return handle as unknown as FsDirLike;
}

export interface SongDir {
  name: string;
  handle: FsDirLike;
}

/** 逐个产出歌曲文件夹 (渐进式, 大曲库不阻塞) */
export async function* scanSongDirs(root: FsDirLike): AsyncGenerator<SongDir> {
  for await (const [name, child] of root.entries()) {
    if (child.kind === 'directory') yield { name, handle: child as FsDirLike };
  }
}

export interface DifficultyInfo {
  fileName: string;
  title: string;
  artist: string;
  creator: string;
  version: string;
  mode: number; // 0=std
}

/** 快速元数据解析 (不完整 parse, 仅读关键键, 供难度列表显示) */
export function parseQuickMetadata(text: string): Omit<DifficultyInfo, 'fileName'> {
  const get = (k: string): string => text.match(new RegExp(`^${k}:(.*)$`, 'm'))?.[1]?.trim() ?? '';
  return {
    title: get('TitleUnicode') || get('Title'),
    artist: get('ArtistUnicode') || get('Artist'),
    creator: get('Creator'),
    version: get('Version'),
    mode: parseInt(get('Mode') || '0') || 0,
  };
}

/** 列出文件夹内全部难度 (懒解析, 点击文件夹时调用) */
export async function listDifficulties(dir: FsDirLike): Promise<DifficultyInfo[]> {
  const out: DifficultyInfo[] = [];
  for await (const [name, child] of dir.entries()) {
    if (child.kind !== 'file' || !name.toLowerCase().endsWith('.osu')) continue;
    try {
      const text = await (await (child as FsFileLike).getFile()).text();
      out.push({ fileName: name, ...parseQuickMetadata(text) });
    } catch { /* 跳过损坏文件 */ }
  }
  // std 排前, 其余按文件名
  out.sort((a, b) => a.mode - b.mode || a.fileName.localeCompare(b.fileName));
  return out;
}

/** 收集目录内全部 hitsound 采样文件: key = 小写 stem (如 "soft-hitnormal" / "drum-hitfinish2") */
export async function collectSampleFiles(dir: FsDirLike): Promise<Map<string, File>> {
  const out = new Map<string, File>();
  for await (const [name, child] of dir.entries()) {
    if (child.kind !== 'file') continue;
    const m = name.match(SAMPLE_FILE_RE);
    if (!m) continue;
    try {
      const stem = `${m[1]!.toLowerCase()}-${m[2]!.toLowerCase()}${m[3] ?? ''}`;
      if (!out.has(stem)) out.set(stem, await (child as FsFileLike).getFile());
    } catch { /* 跳过读取失败的文件 */ }
  }
  return out;
}

export interface LoadedSong {
  bm: Beatmap;
  audioUrl: string | null;
  bgUrl: string | null;
  audioMissing: boolean;
  /** 谱面目录自带的 hitsound 采样 (可能为空 Map) */
  samples: Map<string, File>;
}

/** 在目录里找文件: 精确名 -> 大小写不敏感 -> 扩展名兜底 */
export async function findFileInDir(dir: FsDirLike, name: string, re: RegExp): Promise<File | null> {
  if (name) {
    try { return await (await dir.getFileHandle(name)).getFile(); } catch { /* 继续兜底 */ }
    for await (const [n, child] of dir.entries()) {
      if (child.kind !== 'file') continue;
      if (n.toLowerCase() === name.toLowerCase()) return (child as FsFileLike).getFile();
    }
  }
  for await (const [n, child] of dir.entries()) {
    if (child.kind === 'file' && re.test(n)) return (child as FsFileLike).getFile();
  }
  return null;
}

/** 难度总数 (只数 .osu 文件, 不解析, 供列表徽标懒加载) */
export async function countDifficulties(dir: FsDirLike): Promise<number> {
  let n = 0;
  for await (const [name, child] of dir.entries()) {
    if (child.kind === 'file' && name.toLowerCase().endsWith('.osu')) n++;
  }
  return n;
}

/** 取歌曲背景图 objectURL (解析第一个含背景声明的 .osu; 无则 null) */
export async function getDirBackgroundUrl(dir: FsDirLike): Promise<string | null> {
  for await (const [name, child] of dir.entries()) {
    if (child.kind !== 'file' || !name.toLowerCase().endsWith('.osu')) continue;
    try {
      const text = await (await (child as FsFileLike).getFile()).text();
      const bg = parseOsu(text).general.background;
      if (!bg) continue;
      const f = await findFileInDir(dir, bg, /\.(jpe?g|png|bmp|webp)$/i);
      return f ? URL.createObjectURL(f) : null;
    } catch { /* 尝试下一个 */ }
  }
  return null;
}

/** 加载选中难度: 完整解析 + 音频/背景 objectURL */
export async function loadDifficulty(dir: FsDirLike, fileName: string): Promise<LoadedSong> {
  const fh = await dir.getFileHandle(fileName);
  const text = await (await fh.getFile()).text();
  const bm = parseOsu(text);

  const audio = await findFileInDir(dir, bm.general.audioFilename, /\.(mp3|ogg|wav|m4a)$/i);
  const bg = bm.general.background
    ? await findFileInDir(dir, bm.general.background, /\.(jpe?g|png|bmp|webp)$/i)
    : null;
  const samples = await collectSampleFiles(dir).catch(() => new Map<string, File>());
  invalidatePath();
  return {
    bm,
    audioUrl: audio ? URL.createObjectURL(audio) : null,
    bgUrl: bg ? URL.createObjectURL(bg) : null,
    audioMissing: !audio,
    samples,
  };
}
