// v297: 曲库索引 worker — 目录枚举/getFile/读文本/轻解析全部在 worker 线程执行,
// 批次结果 postMessage 回主线程; 主线程可随时 cancel / 推送最新优先目录 (prio)。
// FileSystemDirectoryHandle 经结构化克隆传入, 结构上满足 FsDirLike (entries/getFileHandle)。
import { buildLibraryIndex } from './libraryIndex';

let cancelled = false;
let prioName: string | null = null;

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  if (m?.type === 'cancel') { cancelled = true; return; }
  if (m?.type === 'prio') { prioName = m.name ?? null; return; }
  if (m?.type !== 'scan') return;
  try {
    for await (const batch of buildLibraryIndex(m.root, m.cached ?? null, null, () => cancelled, () => prioName, m.opts ?? undefined)) {
      post({ type: 'batch', entries: batch });
      if (cancelled) return;
    }
    post({ type: 'done' });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? `${e.name} ${e.message}` : String(e) });
  }
};
