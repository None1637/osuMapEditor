// Ctrl+S 保存谱面 (lazer Editor Save 语义: 序列化当前难度写回 .osu)
// 三条通道按谱面来源自动选择:
//   server   — 服务器直读目录 (local-dirs.json / Electron), 经 /api/local-fs/write 写回原文件
//   native   — 浏览器 File System Access 授权目录, 请求 readwrite 权限写回原文件
//   download — 其他来源 (.osz/拖拽/演示谱面), 兜底下载 .osu (stable 命名规则)
import { serializeOsu, type Beatmap } from './parser';
import type { FsDirLike } from './library';

export interface MapSource {
  dir: FsDirLike;
  fileName: string;
}

export type SaveRoute = 'server' | 'native' | 'download';

/** stable 文件命名: "Artist - Title (Creator) [Version].osu", 剔除 Windows 非法字符 */
export function mapFileName(bm: Beatmap): string {
  const m = bm.metadata;
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').trim();
  const artist = clean(m.artist || m.artistUnicode) || 'Unknown Artist';
  const title = clean(m.title || m.titleUnicode) || 'Unknown Title';
  const creator = clean(m.creator) || 'mapper';
  const version = clean(m.version) || 'Normal';
  return `${artist} - ${title} (${creator}) [${version}].osu`;
}

/** 保存通道路由 (纯函数, 按目录对象能力判定) */
export function pickSaveRoute(source: MapSource | null | undefined): SaveRoute {
  if (!source) return 'download';
  const d = source.dir as unknown as { writeFile?: unknown; queryPermission?: unknown };
  if (typeof d.writeFile === 'function') return 'server';
  if (typeof d.queryPermission === 'function') return 'native';
  return 'download';
}

export function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface SaveOutcome {
  route: SaveRoute;
  fileName: string;
  /** 实际写出的全文 (测试断言用) */
  text: string;
}

export async function saveBeatmap(bm: Beatmap, source: MapSource | null | undefined): Promise<SaveOutcome> {
  const text = serializeOsu(bm);
  const route = pickSaveRoute(source);
  const fileName = route === 'download' ? mapFileName(bm) : source!.fileName;
  if (route === 'server') {
    await source!.dir.writeFile!(fileName, text);
  } else if (route === 'native') {
    // Ctrl+S 是用户手势, 可在此请求 readwrite 授权 (目录当初只按 read 授权)
    const dir = source!.dir as unknown as FileSystemDirectoryHandle & {
      requestPermission(o: { mode: string }): Promise<string>;
    };
    if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted')
      throw new Error('未获得歌曲目录写入授权');
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  } else {
    downloadText(fileName, text);
  }
  return { route, fileName, text };
}
