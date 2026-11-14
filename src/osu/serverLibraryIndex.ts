// v575/v576: exe 服务器曲库快速索引 — 分页 manifest + 每 16 文件一批, 不再逐目录/逐文件 HTTP
import { difficultyFromFileName, parseIndexEntry, type LibraryIndexEntry } from './libraryIndex';
import { fetchServerFileTreePage, readServerFileBatch, serverDir, type ServerFileManifestEntry } from './serverFs';
import type { FsDirLike } from './library';

const SERVER_READ_BATCH = 16;

function manifestName(rel: string): { dirName: string; fileName: string } {
  const parts = rel.split('/');
  return { dirName: parts.slice(0, -1).join('/'), fileName: parts[parts.length - 1] };
}

export function serverSkeletons(manifest: readonly ServerFileManifestEntry[]): LibraryIndexEntry[] {
  return manifest.map(f => {
    const { dirName, fileName } = manifestName(f.rel);
    return { ...difficultyFromFileName(dirName, fileName), size: f.size, lastModified: f.lastModified };
  });
}

/** 供打开谱面/背景复用的目录句柄; 由 manifest 直接构造, 不再逐目录 /list */
export function serverDirectories(manifest: readonly ServerFileManifestEntry[]): { name: string; handle: FsDirLike }[] {
  return [...new Set(manifest.map(f => manifestName(f.rel).dirName))].sort()
    .map(name => ({ name, handle: serverDir('songs', name, name) }));
}

/** v576: 分页清单生成器; 每次 yield 都可立即更新 UI, 大曲库不再长时间显示 0 */
export async function* scanServerFileManifest(isCancelled: () => boolean): AsyncGenerator<ServerFileManifestEntry[]> {
  let offset = 0;
  do {
    const page = await fetchServerFileTreePage(offset);
    if (isCancelled()) return;
    yield page.files;
    if (page.nextOffset === null) return;
    offset = page.nextOffset;
  } while (true);
}

export async function* scanServerLibraryIndex(
  manifest: readonly ServerFileManifestEntry[],
  cached: readonly LibraryIndexEntry[] | null,
  isCancelled: () => boolean,
): AsyncGenerator<LibraryIndexEntry[]> {
  const cache = new Map((cached ?? []).map(e => [`${e.dirName}/${e.fileName}`, e]));
  const changed: ServerFileManifestEntry[] = [];
  let batch: LibraryIndexEntry[] = [];
  const push = (e: LibraryIndexEntry) => { batch.push(e); };
  for (const f of manifest) {
    if (isCancelled()) return;
    const { dirName, fileName } = manifestName(f.rel);
    const hit = cache.get(`${dirName}/${fileName}`);
    if (hit && !hit.partial && hit.size === f.size && hit.lastModified === f.lastModified) push(hit);
    else changed.push(f);
    if (batch.length >= 50) { yield batch; batch = []; }
  }
  for (let i = 0; i < changed.length; i += SERVER_READ_BATCH) {
    if (isCancelled()) return;
    const files = await readServerFileBatch(changed.slice(i, i + SERVER_READ_BATCH).map(f => f.rel));
    for (const f of files) {
      const { dirName, fileName } = manifestName(f.rel);
      push(parseIndexEntry(f.text, dirName, fileName, f.size, f.lastModified));
      if (batch.length >= 50) { yield batch; batch = []; }
    }
    if (batch.length) { yield batch; batch = []; }
  }
  if (batch.length) yield batch;
}
